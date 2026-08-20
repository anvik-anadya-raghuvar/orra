/**
 * Documents, spreadsheets and PDFs — the general file path.
 *
 * The portal already had three ways to keep a picture and no way at all to
 * keep a document, which meant every PDF this pair actually depends on — visa
 * letters, contracts, fee statements, the spreadsheet a number came from —
 * lived in a chat app instead. This is the one path for all of them, and it
 * is deliberately not how images work: an image is compressed in the browser
 * and stored inline because it is part of the thing it is on, whereas a file
 * is arbitrary and can be tens of megabytes, so the bytes go to the private
 * `files` bucket and only a reference row goes to Postgres.
 *
 * Mock mode has no bucket, so it keeps a data URL in the same field, exactly
 * as moments.ts does — everything downstream treats a `storage_path` as
 * "either a path or a data URL" and asks `fileHref` which it is.
 */
import { getSupabase, supabaseConfigured } from './supabaseClient';

const BUCKET = 'files';

/** Long enough to open and read, short enough that a copied link goes stale. */
const SIGNED_URL_TTL_SEC = 60 * 60;

/**
 * The server-side cap in 0036_attachments.sql, repeated here so the browser
 * refuses first with a sentence instead of a 400. Changing one means changing
 * the other.
 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Mock mode holds the bytes as a base64 data URL in localStorage, which is a
 * few megabytes for the whole dataset — so a local file has to be far
 * smaller than a real one. It is a dev convenience, not the product.
 */
export const MAX_MOCK_FILE_BYTES = 1024 * 1024;

/** 1.4 MB, 903 KB, 12 KB — never "1400000". */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/**
 * A short, human word for what this is — the thing that goes on the row's
 * badge. Read from the extension rather than the MIME type because browsers
 * disagree wildly about spreadsheet and archive MIMEs, and because the
 * extension is what the person who saved the file actually sees.
 */
export function fileKind(filename: string, mime = ''): string {
  const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  const byExt: Record<string, string> = {
    pdf: 'PDF',
    doc: 'DOC', docx: 'DOC', odt: 'DOC', rtf: 'DOC', pages: 'DOC',
    xls: 'SHEET', xlsx: 'SHEET', ods: 'SHEET', csv: 'CSV', tsv: 'CSV', numbers: 'SHEET',
    ppt: 'SLIDES', pptx: 'SLIDES', odp: 'SLIDES', key: 'SLIDES',
    png: 'IMAGE', jpg: 'IMAGE', jpeg: 'IMAGE', gif: 'IMAGE', webp: 'IMAGE',
    heic: 'IMAGE', svg: 'IMAGE',
    zip: 'ZIP', rar: 'ZIP', '7z': 'ZIP', tar: 'ZIP', gz: 'ZIP',
    txt: 'TEXT', md: 'TEXT', json: 'DATA', xml: 'DATA', ics: 'DATA',
    mp3: 'AUDIO', wav: 'AUDIO', m4a: 'AUDIO',
    mp4: 'VIDEO', mov: 'VIDEO', webm: 'VIDEO',
  };
  if (byExt[ext]) return byExt[ext];
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('audio/')) return 'AUDIO';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime.includes('pdf')) return 'PDF';
  if (mime.includes('sheet') || mime.includes('excel')) return 'SHEET';
  if (mime.includes('word') || mime.includes('document')) return 'DOC';
  return ext ? ext.slice(0, 5).toUpperCase() : 'FILE';
}

/**
 * Strip a name down to something safe to put in a bucket path.
 *
 * Storage keys reject a good deal of what a filesystem allows — anything
 * non-ASCII, slashes above all, which would silently create a folder. The
 * original name is kept verbatim in the row, so the download is still called
 * what it was called; only the path is sanitised.
 */
export function safeStorageName(filename: string): string {
  const cleaned = filename
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._]+/, '')
    .slice(-120);
  return cleaned || 'file';
}

/** Why this file cannot be stored, or null if it can. */
export function rejectReason(
  file: { name: string; size: number },
  live = supabaseConfigured(),
): string | null {
  if (!file.size) return `"${file.name}" is empty.`;
  const cap = live ? MAX_FILE_BYTES : MAX_MOCK_FILE_BYTES;
  if (file.size > cap) {
    return `"${file.name}" is ${humanBytes(file.size)} — the limit is ${humanBytes(cap)}${
      live ? '' : ' in local mode'
    }.`;
  }
  return null;
}

/** Read a File as a data URL — the mock-mode store, and nothing else. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read "${file.name}"`));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

/**
 * Put the bytes somewhere and return what to store in `storage_path`: a bucket
 * path in production, the data URL itself in mock mode.
 *
 * The path starts with the uploader's id because the storage policies in 0036
 * only allow a write inside your own folder.
 */
export async function uploadFile(file: File, userId: string, id: string): Promise<string> {
  const reason = rejectReason(file);
  if (reason) throw new Error(reason);
  if (!supabaseConfigured()) return readAsDataUrl(file);
  const sb = await getSupabase();
  const path = `${userId}/${id}/${safeStorageName(file.name)}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: true,
  });
  // A failed upload must never become a row pointing at nothing — that reads
  // as "the file is there" right up until someone needs it.
  if (error) throw new Error(`Could not store "${file.name}" — ${error.message}`);
  return path;
}

/** A URL that will actually open. Data URLs pass through; paths are signed,
 *  because the bucket is private. */
export async function fileHref(storagePath: string): Promise<string | null> {
  if (!storagePath) return null;
  if (storagePath.startsWith('data:')) return storagePath;
  if (!supabaseConfigured()) return null;
  const sb = await getSupabase();
  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SEC);
  if (error || !data) return null;
  return data.signedUrl;
}

/**
 * Remove the bytes. Best-effort on purpose: the row is what the app reads, so
 * a failure here leaves an orphaned object costing a few kilobytes rather than
 * a file that still appears in a list nobody can delete.
 */
export async function deleteFile(storagePath: string): Promise<void> {
  if (!storagePath || storagePath.startsWith('data:')) return;
  if (!supabaseConfigured()) return;
  const sb = await getSupabase();
  await sb.storage.from(BUCKET).remove([storagePath]);
}
