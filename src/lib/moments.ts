/**
 * Photo storage for sent moments.
 *
 * Photos go to the private `moments` bucket rather than into a Postgres row.
 * `shared_daily` has been holding ~200KB base64 data URLs inline; that is fine
 * for one a day and not fine for a year of sends on a 500MB free tier.
 *
 * Mock mode has no Supabase to talk to, so it keeps the data URL as-is and
 * everything downstream treats the two the same: `attachment_url` is either a
 * storage path or a data URL, and `momentSrc` resolves whichever it is.
 */
import { getSupabase, supabaseConfigured } from './supabaseClient';

const BUCKET = 'moments';
/** Long enough to view and reply, short enough that a leaked link goes stale. */
const SIGNED_URL_TTL_SEC = 60 * 60;

const isDataUrl = (s: string) => s.startsWith('data:');

/** data: URL → Blob, so the same compressed bytes can be uploaded. */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/jpeg';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * Store a compressed photo and return what to put in `attachment_url`:
 * a bucket path in production, the data URL itself in mock mode.
 *
 * The path starts with the sender's id because the storage policies only let
 * someone write inside their own folder (0017).
 */
export async function uploadMoment(dataUrl: string, userId: string, id: string): Promise<string> {
  if (!supabaseConfigured()) return dataUrl;
  const sb = await getSupabase();
  const path = `${userId}/${id}.jpg`;
  const { error } = await sb.storage.from(BUCKET).upload(path, dataUrlToBlob(dataUrl), {
    contentType: 'image/jpeg',
    upsert: true,
  });
  // A failed upload must not silently become a message with no picture in it.
  if (error) throw new Error(`Could not store that photo — ${error.message}`);
  return path;
}

/**
 * A URL the <img> can actually load. Data URLs pass straight through; storage
 * paths are signed on demand, because the bucket is private.
 */
export async function momentSrc(attachment: string): Promise<string | null> {
  if (!attachment) return null;
  if (isDataUrl(attachment)) return attachment;
  if (!supabaseConfigured()) return null;
  const sb = await getSupabase();
  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(attachment, SIGNED_URL_TTL_SEC);
  if (error || !data) return null;
  return data.signedUrl;
}

