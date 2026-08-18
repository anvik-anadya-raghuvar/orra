/**
 * Client-side photo compression for "Photo of the day".
 * Draws to a canvas capped at 640px wide, then steps JPEG quality down until
 * the encoded payload is ≤200KB. Shared: both the Us sidebar and the Home
 * tile upload in place, so neither has to bounce the user to the other.
 */

const MAX_WIDTH = 640;
const TARGET_BYTES = 200 * 1024;
const QUALITY_STEPS = [0.82, 0.72, 0.62, 0.52, 0.42, 0.32];

/** Decoded byte length of a data: URL payload. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  const b64 = comma === -1 ? dataUrl : dataUrl.slice(comma + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

export function compressPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Pick an image file'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;
        const scale = Math.min(1, MAX_WIDTH / naturalWidth);
        const w = Math.max(1, Math.round(naturalWidth * scale));
        const h = Math.max(1, Math.round(naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas is unavailable in this browser');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        let dataUrl = canvas.toDataURL('image/jpeg', QUALITY_STEPS[QUALITY_STEPS.length - 1]);
        for (const q of QUALITY_STEPS) {
          dataUrl = canvas.toDataURL('image/jpeg', q);
          if (dataUrlBytes(dataUrl) <= TARGET_BYTES) break;
        }
        if (dataUrlBytes(dataUrl) > TARGET_BYTES) {
          reject(new Error('Still too large after compression — try a smaller photo'));
          return;
        }
        resolve(dataUrl);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Could not process that image'));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image'));
    };
    img.src = url;
  });
}
