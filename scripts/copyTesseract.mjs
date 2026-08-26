/**
 * Vendor the OCR engine into public/ so the business-card scanner never talks
 * to a CDN.
 *
 * tesseract.js fetches its wasm core and its language data at runtime, and by
 * default it fetches them from jsdelivr and tessdata.projectnaptha.com. Three
 * reasons that default is wrong here:
 *
 *  - **Privacy.** A business card is somebody else's name, phone and address.
 *    The scan itself is local either way, but a third-party CDN request is
 *    still a request we do not need to make.
 *  - **It works offline**, which is the difference between scanning a card on
 *    a plane and not.
 *  - **Nothing can be pulled out from under us.** A CDN version disappearing
 *    breaks the feature silently, months later.
 *
 * These files are copied out of node_modules rather than committed, so the
 * repo stays free of ~7 MB of binaries and the versions can never drift from
 * the tesseract.js in package.json. public/tesseract/ is gitignored; this runs
 * on postinstall and again before every build, including on Vercel.
 *
 * Which files, and why only these:
 *
 *  - `worker.min.js` — the worker thread tesseract.js spawns.
 *  - `tesseract-core-simd-lstm.wasm.js` — one core, named explicitly rather
 *    than handing tesseract.js a directory to pick from. Given a directory it
 *    probes for relaxed-SIMD/SIMD/neither and would need all three variants
 *    vendored (~12 MB) to be safe. Naming the file skips the probe. SIMD is in
 *    every browser since 2021, and `-lstm` drops the legacy pre-neural engine
 *    we never ask for — 3.9 MB instead of 12.
 *  - `eng.traineddata.gz` — from `4.0.0_best_int`, the integerised model:
 *    2.9 MB against 10.9 MB for the float one it is quantised from, several
 *    times faster, and near-identical in accuracy. On a phone scanning a card,
 *    that trade is the right way round.
 */

import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'tesseract');

const FILES = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'eng.traineddata.gz'],
];

mkdirSync(out, { recursive: true });

let total = 0;
for (const [from, name] of FILES) {
  const src = join(root, from);
  try {
    copyFileSync(src, join(out, name));
    total += statSync(src).size;
  } catch (err) {
    // A missing source is not fatal at install time — `npm install` runs this
    // before an optional dependency tree is necessarily complete, and failing
    // the whole install over the OCR engine would be out of proportion. The
    // scanner reports it plainly at the point of use instead.
    console.warn(`[tesseract] could not vendor ${name}: ${err.message}`);
  }
}
console.log(`[tesseract] vendored ${FILES.length} files (${(total / 1048576).toFixed(1)} MB) into public/tesseract/`);
