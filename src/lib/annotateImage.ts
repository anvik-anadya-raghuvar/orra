import type { AnnotationPin } from '../types';

/**
 * Draws numbered pin markers onto a screenshot.
 *
 * Why this exists: the export used to ship the RAW screenshot plus a list of
 * "pin 1 at x 32.4%, y 41.0%". A reader — human or model — then had to compute
 * where 32.4% of the width falls and hope they got the right button. Burning
 * the markers in makes the image self-describing: marker ① sits exactly on the
 * thing pin 1 is talking about, and the markdown list explains what each
 * number means. Coordinates stay in the text for precision.
 *
 * Deterministic for the same input, so two exports still match byte for byte.
 */

const MARKER_R = 22; // px at the image's own scale, before size normalisation
const COLORS: Record<string, string> = {
  bug: '#C33055',
  logic: '#4A47D8',
  copy: '#0E8267',
  layout: '#CE6A10',
  styling: '#7E50DC',
  question: '#1D6FC4',
};
const DEFAULT_COLOR = '#CE6A10';

export interface AnnotatedResult {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * @param source  image data URL (or any URL the canvas may read same-origin)
 * @param pins    each carries `n`, its task-global number — the numbering runs
 *                across every screenshot of the task, so it is handed in
 *                rather than derived from this one image's array index
 */
export function annotateScreenshot(
  source: string,
  pins: (Pick<AnnotationPin, 'x_pct' | 'y_pct' | 'label' | 'is_resolved'> & { n: number })[],
): Promise<AnnotatedResult> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas is unavailable');
        ctx.drawImage(img, 0, 0, w, h);

        // Scale markers with the image so they stay legible on a 400px crop
        // and don't swamp a 3000px retina capture.
        const r = Math.max(14, Math.min(40, (Math.min(w, h) / 900) * MARKER_R));
        ctx.font = `600 ${Math.round(r * 1.05)}px "IBM Plex Mono", ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        pins.forEach((p) => {
          const x = (p.x_pct / 100) * w;
          const y = (p.y_pct / 100) * h;
          const color = COLORS[p.label] ?? DEFAULT_COLOR;

          // Halo first, so a marker stays visible on a busy screenshot.
          ctx.beginPath();
          ctx.arc(x, y, r + 3, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.92)';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.lineWidth = Math.max(2, r * 0.12);
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();

          // A resolved pin is struck through rather than removed — the export
          // should still show that the region was discussed.
          if (p.is_resolved) {
            ctx.beginPath();
            ctx.moveTo(x - r * 0.7, y + r * 0.7);
            ctx.lineTo(x + r * 0.7, y - r * 0.7);
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.stroke();
          }

          ctx.fillStyle = '#ffffff';
          ctx.fillText(String(p.n), x, y + r * 0.04);
        });

        resolve({ dataUrl: canvas.toDataURL('image/png'), width: w, height: h });
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Could not annotate the screenshot'));
      }
    };
    img.onerror = () => reject(new Error('Screenshot could not be read for annotation'));
    img.src = source;
  });
}
