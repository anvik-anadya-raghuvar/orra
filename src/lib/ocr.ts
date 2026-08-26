/**
 * Reading text off an image, in the browser, with nothing leaving the device.
 *
 * The whole engine — a wasm core and a 3 MB English model — is vendored into
 * public/tesseract/ by scripts/copyTesseract.mjs and served from our own
 * origin. tesseract.js would otherwise fetch both from a CDN at first use,
 * which for a page of business cards means posting somebody else's contact
 * details' *container* to a third party we have no relationship with. It also
 * means the feature works on a plane, and cannot break because a CDN retired a
 * version.
 *
 * Everything here is loaded with a dynamic `import()`, so tesseract.js lands in
 * its own chunk and the main bundle never carries it. Nobody who does not scan
 * a card pays a byte for this.
 *
 * The worker is created once and kept. Spinning one up costs a few seconds of
 * wasm compile and model load; scanning the back of a card immediately after
 * the front should not pay that twice.
 */

import type { ScannedLine } from './cardScan';

/** Where the vendored engine lives, relative to the site root. */
const ASSETS = '/tesseract';

export interface OcrResult {
  text: string;
  /** Per-line bounding boxes, which is how `parseCardText` knows that the
   *  biggest line on a card is the person's name. */
  lines: ScannedLine[];
  /** 0–100, the engine's own confidence in the page. Below ~55 the read is
   *  usually too poor to suggest fields from, and the caller says so rather
   *  than filling a profile with noise. */
  confidence: number;
}

/** Progress, in the shape a progress bar wants: 0–1 plus something to read. */
export interface OcrProgress {
  status: string;
  progress: number;
}

type Worker = {
  recognize: (image: string) => Promise<{ data: unknown }>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<Worker> | null = null;
let listeners: ((p: OcrProgress) => void)[] = [];

/** Human wording for tesseract.js's own status strings. 'loading language
 *  traineddata' means nothing to anyone; 'Loading the reader' does. */
const STATUS_TEXT: Record<string, string> = {
  'loading tesseract core': 'Starting the reader',
  'initializing tesseract': 'Starting the reader',
  'loading language traineddata': 'Loading the reader',
  'initializing api': 'Getting ready',
  'recognizing text': 'Reading the card',
};

async function getWorker(): Promise<Worker> {
  if (workerPromise) return workerPromise;

  workerPromise = (async () => {
    const { createWorker, OEM } = await import('tesseract.js');
    return (await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: `${ASSETS}/worker.min.js`,
      langPath: ASSETS,
      // Named as a file rather than a directory on purpose. Given a directory,
      // tesseract.js probes for relaxed-SIMD/SIMD/neither and asks for a
      // matching build, which would mean vendoring all three (~12 MB) so that
      // whichever it picks exists. Naming the file skips the probe; SIMD has
      // been in every browser since 2021.
      corePath: `${ASSETS}/tesseract-core-simd-lstm.wasm.js`,
      // The model is shipped gzipped and is not unpacked on disk.
      gzip: true,
      logger: (m: { status?: string; progress?: number }) => {
        const status = m.status ?? '';
        for (const fn of listeners) {
          fn({
            status: STATUS_TEXT[status] ?? 'Working',
            progress: typeof m.progress === 'number' ? m.progress : 0,
          });
        }
      },
    })) as unknown as Worker;
  })();

  try {
    return await workerPromise;
  } catch (err) {
    // A failed start must not poison every later attempt: the commonest cause
    // is the vendored assets not being there yet (a dev server started before
    // `npm install` ran the copy), and that is fixed without a page reload.
    workerPromise = null;
    // The underlying failure is almost always a 404 on one of the vendored
    // files and is worth having in the console; what reaches the user is the
    // sentence that tells them what to do about it.
    console.error('[ocr] worker failed to start', err);
    throw new Error(
      'The card reader could not start. If this is a fresh checkout, run `npm install` so the OCR engine is copied into public/tesseract/.',
    );
  }
}

/** True when the browser can run the engine at all. */
export function ocrSupported(): boolean {
  return typeof WebAssembly === 'object' && typeof Worker === 'function';
}

/**
 * Read one image. `image` is a data URL — the same compressed JPEG that gets
 * stored on the card, so the picture kept and the picture read are the same
 * picture, and a field that looks wrong can be checked against it.
 */
export async function readCardImage(
  image: string,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrResult> {
  if (!ocrSupported()) {
    throw new Error('This browser cannot run the card reader.');
  }
  if (onProgress) listeners.push(onProgress);
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(image);
    const d = data as {
      text?: string;
      confidence?: number;
      lines?: { text?: string; bbox?: { y0: number; y1: number } }[];
    };
    const lines: ScannedLine[] = (d.lines ?? [])
      .map((l) => ({
        text: (l.text ?? '').trim(),
        height: l.bbox ? Math.abs(l.bbox.y1 - l.bbox.y0) : undefined,
      }))
      .filter((l) => l.text.length > 0);
    return {
      text: d.text ?? '',
      lines,
      confidence: typeof d.confidence === 'number' ? d.confidence : 0,
    };
  } finally {
    if (onProgress) listeners = listeners.filter((fn) => fn !== onProgress);
  }
}

/**
 * Let go of the worker and its memory.
 *
 * Worth calling when the scanner closes: the wasm heap plus the loaded model
 * is tens of megabytes, and holding it for the rest of the session to save a
 * few seconds on a card that may never be scanned is the wrong trade on a
 * phone. The next scan simply starts one again.
 */
export async function releaseOcr(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  listeners = [];
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    // Already gone, or never started. Either way there is nothing to release
    // and nothing a user could do about it.
  }
}
