/**
 * Which files can be drawn on, and what the flattened copy is called.
 *
 * Kept tiny and dependency-free on purpose: attachments.tsx imports this to
 * decide whether a row gets an Annotate button, and attachments.tsx is in the
 * main bundle. Everything heavy (pdf.js, pdf-lib, mammoth) is behind the
 * lazy Annotator chunk.
 */

export type AnnotateKind = 'pdf' | 'image' | 'xlsx' | 'docx';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif']);

function ext(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/**
 * What the annotator would render this as, or null if it cannot.
 *
 * Deliberately not .doc / .xls / .heic: the old binary Office formats need a
 * real parser, and HEIC only decodes in Safari. Those get a clear message
 * (see unsupportedReason) instead of a blank page.
 */
export function annotateKind(filename: string, mime = ''): AnnotateKind | null {
  const e = ext(filename);
  if (e === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (e === 'xlsx' || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (e === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (IMAGE_EXT.has(e)) return 'image';
  if (mime.startsWith('image/') && mime !== 'image/heic' && mime !== 'image/heif' && mime !== 'image/svg+xml') {
    return 'image';
  }
  return null;
}

/** A sentence for the file types that cannot be drawn on — never a blank page. */
export function unsupportedReason(filename: string): string {
  const e = ext(filename);
  if (e === 'doc' || e === 'odt' || e === 'rtf' || e === 'pages') {
    return 'This is an older document format. Open it in Word or Google Docs, save it as PDF (or .docx), and attach that.';
  }
  if (e === 'xls' || e === 'ods' || e === 'numbers' || e === 'csv') {
    return 'This spreadsheet format cannot be drawn on here. Save it as .xlsx or PDF first.';
  }
  if (e === 'ppt' || e === 'pptx' || e === 'key' || e === 'odp') {
    return 'Slides cannot be drawn on directly. Export the deck as PDF, attach that, and annotate it.';
  }
  if (e === 'heic' || e === 'heif') {
    return 'HEIC photos only open in Safari. Export it as JPEG (or take a screenshot) and attach that.';
  }
  return 'This file type cannot be drawn on. PDFs, images, .xlsx and .docx can.';
}

/** "Lease.pdf" → "Lease.annotated.pdf"; "scan" → "scan.annotated.pdf". */
export function annotatedName(filename: string): string {
  const base = filename.replace(/\.annotated\.pdf$/i, '').replace(/\.[^./\\]{1,8}$/, '');
  return `${base || 'document'}.annotated.pdf`;
}

/** What the file picker for "Draw on a file" should offer. */
export const ANNOTATE_ACCEPT =
  '.pdf,.xlsx,.docx,.png,.jpg,.jpeg,.gif,.webp,.bmp,application/pdf,image/png,image/jpeg,image/gif,image/webp';
