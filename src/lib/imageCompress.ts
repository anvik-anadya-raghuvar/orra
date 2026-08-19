/**
 * Client-side screenshot compression for the annotation surface.
 *
 * Everything stays in the browser: draw to a canvas capped at 1600px wide,
 * then step JPEG quality down 0.8 → 0.5 until the encoded payload is ≤300 KB.
 * If it is still over 2 MB after the last step we refuse the file rather than
 * pushing a huge data URL into the store (mock adapter) or Storage (Supabase).
 */

export const MAX_WIDTH = 1600;
export const TARGET_BYTES = 300 * 1024;
export const HARD_LIMIT_BYTES = 2 * 1024 * 1024;
const QUALITY_STEPS = [0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5];

export interface CompressedImage {
  /** image/jpeg data URL */
  data_url: string;
  /** natural (pre-cap) pixel dimensions — what the screenshot actually shows */
  width: number;
  height: number;
  /** encoded byte size of data_url */
  bytes: number;
  /** quality the encoder settled on */
  quality: number;
}

/** Decoded byte length of a data: URL payload. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

export function prettyBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function loadImage(file: File): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const revoke = () => URL.revokeObjectURL(url);
    img.onload = () => resolve({ img, revoke });
    img.onerror = () => {
      revoke();
      reject(new Error('That file could not be read as an image'));
    };
    img.src = url;
  });
}

export async function compressImage(file: File): Promise<CompressedImage> {
  if (!file.type.startsWith('image/')) throw new Error('Only image files can be annotated');

  const { img, revoke } = await loadImage(file);
  try {
    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;
    if (!naturalWidth || !naturalHeight) throw new Error('That image has no dimensions');

    const scale = Math.min(1, MAX_WIDTH / naturalWidth);
    const w = Math.max(1, Math.round(naturalWidth * scale));
    const h = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is unavailable in this browser');
    // white matte: JPEG has no alpha, and transparent PNGs would go black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    let data_url = '';
    let bytes = Number.POSITIVE_INFINITY;
    let quality = QUALITY_STEPS[QUALITY_STEPS.length - 1];
    for (const q of QUALITY_STEPS) {
      data_url = canvas.toDataURL('image/jpeg', q);
      bytes = dataUrlBytes(data_url);
      quality = q;
      if (bytes <= TARGET_BYTES) break;
    }

    if (bytes > HARD_LIMIT_BYTES) {
      throw new Error(
        `Still ${prettyBytes(bytes)} after compression — crop it or pick a smaller screenshot`,
      );
    }
    return { data_url, width: naturalWidth, height: naturalHeight, bytes, quality };
  } finally {
    revoke();
  }
}

/** Re-encoded as JPEG, so the stored asset name has to say so. */
export function jpegName(original: string): string {
  const base = original.replace(/\.[^./\\]+$/, '').replace(/[\\/]/g, '_').trim();
  return `${base || 'screenshot'}.jpg`;
}
