/**
 * Getting an image back out of the portal.
 *
 * Every image in here is a base64 `data:` URL kept inline on the row that owns
 * it — a screenshot, a note image, a business card. That is a good way to
 * store something small that dies with its parent, and a terrible way to get
 * it into an email, because a data URL is not a file until somebody makes it
 * one. These are the parts of "download it" and "copy it" that are pure enough
 * to test: everything DOM-shaped lives in ui/ImageViewer.tsx.
 */

/** The mime a data URL declares, or a safe default when it declares nothing. */
export function mimeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl ?? '');
  return match ? match[1].toLowerCase() : 'image/png';
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

/** The file extension for a mime, defaulting to png rather than guessing. */
export function extensionForMime(mime: string): string {
  return EXTENSIONS[(mime ?? '').toLowerCase()] ?? 'png';
}

/** What Windows refuses in a filename. Everything else is somebody's choice. */
const ILLEGAL = new Set(['<', '>', ':', '"', '|', '?', '*']);
const SMALLEST_PRINTABLE = 32;

/**
 * A filename safe to hand to a download.
 *
 * Written as an explicit character walk rather than a regex character class.
 * The first version used a class with a control-character range in it, and the
 * escape sequences did not survive being written to disk — the file ended up
 * holding real NUL bytes, which made the class strip punctuation nobody meant
 * and silently left spaces and dashes in. A `Set` and a code-point test cannot
 * mean something different from what they read as.
 *
 * Spaces and dashes are kept: both are legal on every platform this pair uses,
 * and mangling them makes a file harder to recognise, not safer.
 *
 * The extension is corrected to match the actual bytes — an image stored as
 * JPEG but named `.png` saves as `.jpg`, because a name that lies about the
 * format is how you get a file that will not open.
 */
export function downloadName(filename: string, mime: string): string {
  const base = [...(filename ?? '')]
    .map((ch) => (ch === '/' || ch === '\\' ? '-' : ch))
    .filter((ch) => !ILLEGAL.has(ch) && ch.charCodeAt(0) >= SMALLEST_PRINTABLE)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .trim();
  // "Usable" means it still carries a letter or a digit — a name of nothing
  // but dashes and spaces saves as a file you will never find again.
  return `${/[A-Za-z0-9]/.test(base) ? base : 'image'}.${extensionForMime(mime)}`;
}

/**
 * Decode a data URL into bytes.
 *
 * Returns null rather than throwing for anything that is not a base64 data
 * URL, because the callers are click handlers and a broken image should
 * disable a button, not take the page down with it.
 */
export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const match = /^data:([^;,]*);base64,(.*)$/s.exec(dataUrl ?? '');
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { bytes, mime: (match[1] || 'image/png').toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * Which formats a browser will accept on the clipboard as an image.
 *
 * Chrome and Safari take PNG and nothing else worth relying on, and every
 * screenshot in this app is a browser-compressed JPEG. So anything not on
 * this list has to be redrawn as a PNG before it can be copied — see
 * ui/ImageViewer.tsx. Kept here so the rule is stated once.
 */
export const CLIPBOARD_SAFE = new Set(['image/png']);

export function needsPngForClipboard(mime: string): boolean {
  return !CLIPBOARD_SAFE.has((mime ?? '').toLowerCase());
}
