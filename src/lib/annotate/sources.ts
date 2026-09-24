/**
 * Turning a file into pages you can draw on.
 *
 * One interface — a list of page sizes and "paint page N into this canvas at
 * this scale" — over four very different inputs:
 *
 *  - PDF via pdf.js (the legacy build, so iPads a few iOS versions back still
 *    work; it is behind a dynamic import and never in the main bundle). The
 *    worker is a Vite `?url` asset, so it is served from our own origin.
 *  - Images directly.
 *  - .xlsx through the existing no-dependency reader, cut into A4 pages by
 *    sheetPages.ts and painted as a ruled table.
 *  - .docx through mammoth (lazy) → semantic HTML → docLayout.ts → pages.
 *
 * Browser-only (canvas, DOMParser, workers). The geometry it relies on is in
 * the pure modules next to it, which is where the tests are.
 */
import { readXlsx, type SheetData } from '../xlsx';
import { annotateKind, unsupportedReason, type AnnotateKind } from './kinds';
import {
  SHEET_CHAR_W,
  SHEET_FOOTER_H,
  SHEET_HEADER_H,
  SHEET_MARGIN,
  SHEET_PAGE,
  SHEET_ROW_H,
  SHEET_TITLE_H,
  clipCell,
  paginateSheet,
  sheetPageLabel,
  type SheetLayout,
} from './sheetPages';
import {
  DOC_PAGE,
  fontFor,
  layoutDoc,
  type DocBlock,
  type DocOp,
  type DocRun,
  type Measure,
} from './docLayout';

export interface PageSize {
  w: number;
  h: number;
}

export interface LoadedSource {
  kind: AnnotateKind;
  pages: PageSize[];
  /** One line shown above the pages ("layout is approximate", "first 150 pages"). */
  note: string | null;
  /** Paint page `index` into `canvas` at `scale` device pixels per page unit. */
  render(index: number, canvas: HTMLCanvasElement, scale: number, signal?: AbortSignal): Promise<void>;
  /** PDF sources only: the original bytes, for drawing ink onto the real pages. */
  pdfBytes?: Uint8Array;
  /** Images only: whether the original has transparency worth keeping (PNG). */
  lossless?: boolean;
  destroy(): void;
}

export class UnsupportedFileError extends Error {}

/** The longest side of an image page, in page units — comparable to A4 in
 *  points, so a pen nib is the same visual weight on a photo as on a PDF. */
const IMAGE_LONG_SIDE = 1000;

function prepare(canvas: HTMLCanvasElement, w: number, h: number, scale: number) {
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not give us a canvas to draw the page into.');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  return ctx;
}

/* ── PDF ─────────────────────────────────────────────────────────────── */

async function loadPdf(bytes: ArrayBuffer): Promise<LoadedSource> {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  // pdf.js transfers (detaches) the buffer it is given, and the exporter
  // needs the original bytes afterwards — so it gets its own copy.
  const original = new Uint8Array(bytes.slice(0));
  const loading = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
  let doc;
  try {
    doc = await loading.promise;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'PasswordException') {
      throw new UnsupportedFileError('This PDF is password-protected. Remove the password (print it to PDF), attach that copy, and annotate it.');
    }
    throw new UnsupportedFileError('This PDF could not be opened — it may be damaged. Try re-saving it from the app that made it.');
  }
  const pages: PageSize[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pages.push({ w: Math.round(vp.width * 100) / 100, h: Math.round(vp.height * 100) / 100 });
  }
  return {
    kind: 'pdf',
    pages,
    note: null,
    pdfBytes: original,
    async render(index, canvas, scale, signal) {
      const page = await doc.getPage(index + 1);
      if (signal?.aborted) return;
      const vp = page.getViewport({ scale });
      // Render off to the side and copy in, so a cancelled render never
      // leaves a half-painted page on screen.
      const scratch = document.createElement('canvas');
      scratch.width = Math.max(1, Math.round(vp.width));
      scratch.height = Math.max(1, Math.round(vp.height));
      const task = page.render({ canvas: scratch, viewport: vp });
      const abort = () => task.cancel();
      signal?.addEventListener('abort', abort, { once: true });
      try {
        await task.promise;
      } catch (err) {
        if (signal?.aborted) return;
        throw err;
      } finally {
        signal?.removeEventListener('abort', abort);
      }
      if (signal?.aborted) return;
      canvas.width = scratch.width;
      canvas.height = scratch.height;
      canvas.getContext('2d')?.drawImage(scratch, 0, 0);
    },
    destroy() {
      void loading.destroy();
    },
  };
}

/* ── Images ──────────────────────────────────────────────────────────── */

async function decodeImage(blob: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through to <img> — some browsers refuse some formats here */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadImage(bytes: ArrayBuffer, mime: string, filename: string): Promise<LoadedSource> {
  let bitmap;
  try {
    bitmap = await decodeImage(new Blob([bytes], { type: mime || 'image/*' }));
  } catch {
    throw new UnsupportedFileError(`"${filename}" could not be decoded as an image in this browser.`);
  }
  const { width, height } = bitmap;
  if (!width || !height) throw new UnsupportedFileError('That image has no pixels in it.');
  const s = IMAGE_LONG_SIDE / Math.max(width, height);
  const page = { w: Math.round(width * s * 10) / 10, h: Math.round(height * s * 10) / 10 };
  return {
    kind: 'image',
    pages: [page],
    note: null,
    lossless: /png|gif|webp/i.test(mime) || /\.(png|gif|webp)$/i.test(filename),
    async render(_index, canvas, scale) {
      const ctx = prepare(canvas, page.w, page.h, scale);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, page.w, page.h);
    },
    destroy() {
      if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();
    },
  };
}

/* ── Spreadsheets ────────────────────────────────────────────────────── */

function paintSheetPage(
  ctx: CanvasRenderingContext2D,
  sheet: SheetData,
  layout: SheetLayout,
  index: number,
  title: string,
) {
  const page = layout.pages[index];
  const x0 = SHEET_MARGIN;
  let y = SHEET_MARGIN;
  ctx.fillStyle = '#111827';
  ctx.font = `600 11px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(clipCell(title, SHEET_PAGE.w - SHEET_MARGIN * 2, 6), x0, y + 12);
  y += SHEET_TITLE_H;

  const cols = layout.colWidths.slice(page.colStart, page.colEnd);
  const headers = sheet.headers.slice(page.colStart, page.colEnd);
  const tableW = cols.reduce((a, b) => a + b, 0);

  // Header band, repeated on every page.
  ctx.fillStyle = '#eef1f6';
  ctx.fillRect(x0, y, tableW, SHEET_HEADER_H);
  ctx.fillStyle = '#111827';
  ctx.font = `600 8.5px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  let x = x0;
  headers.forEach((h, i) => {
    ctx.fillText(clipCell(h, cols[i], SHEET_CHAR_W * 1.08), x + 5, y + 13);
    x += cols[i];
  });
  const headTop = y;
  y += SHEET_HEADER_H;

  ctx.font = `400 8.5px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  for (let r = page.rowStart; r < page.rowEnd; r += 1) {
    if ((r - page.rowStart) % 2 === 1) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(x0, y, tableW, SHEET_ROW_H);
    }
    ctx.fillStyle = '#1f2937';
    x = x0;
    const row = sheet.rows[r];
    headers.forEach((h, i) => {
      const v = row[h] ?? '';
      const text = clipCell(v, cols[i]);
      // Numbers right-aligned, as a spreadsheet shows them.
      if (v && /^-?[\d,.]+%?$/.test(v)) {
        const w = ctx.measureText(text).width;
        ctx.fillText(text, x + cols[i] - 5 - w, y + 11);
      } else {
        ctx.fillText(text, x + 5, y + 11);
      }
      x += cols[i];
    });
    y += SHEET_ROW_H;
  }

  // Grid.
  ctx.strokeStyle = '#d5dbe5';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(x0, headTop, tableW, y - headTop);
  x = x0;
  for (const w of cols.slice(0, -1)) {
    x += w;
    ctx.beginPath();
    ctx.moveTo(x, headTop);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(x0, headTop + SHEET_HEADER_H);
  ctx.lineTo(x0 + tableW, headTop + SHEET_HEADER_H);
  ctx.stroke();

  ctx.fillStyle = '#6b7280';
  ctx.font = `400 7.5px system-ui, -apple-system, 'Segoe UI', sans-serif`;
  ctx.fillText(
    sheetPageLabel(page, index, layout.pages.length),
    x0,
    SHEET_PAGE.h - SHEET_MARGIN - SHEET_FOOTER_H / 2 + 8,
  );
}

async function loadSheet(bytes: ArrayBuffer, filename: string): Promise<LoadedSource> {
  let sheet: SheetData;
  try {
    sheet = await readXlsx(bytes);
  } catch (err) {
    throw new UnsupportedFileError((err as Error).message);
  }
  const layout = paginateSheet(sheet);
  const size = { w: SHEET_PAGE.w, h: SHEET_PAGE.h };
  return {
    kind: 'xlsx',
    pages: layout.pages.map(() => ({ ...size })),
    note: layout.truncated
      ? `Showing the first ${layout.pages.length} pages of the first sheet.`
      : 'First sheet, laid out as printed pages — formatting and formulas are not shown.',
    async render(index, canvas, scale) {
      const ctx = prepare(canvas, size.w, size.h, scale);
      paintSheetPage(ctx, sheet, layout, index, filename);
    },
    destroy() {},
  };
}

/* ── Word ────────────────────────────────────────────────────────────── */

/** Semantic HTML (from mammoth) → the blocks docLayout understands. */
function htmlToBlocks(html: string): { blocks: DocBlock[]; images: string[] } {
  const dom = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const blocks: DocBlock[] = [];
  const images: string[] = [];

  const runsOf = (el: Node, bold = false, italic = false, out: DocRun[] = []): DocRun[] => {
    el.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        if (n.textContent) out.push({ text: n.textContent, bold, italic });
        return;
      }
      if (!(n instanceof HTMLElement)) return;
      const tag = n.tagName.toLowerCase();
      if (tag === 'br') {
        out.push({ text: ' ' });
        return;
      }
      if (tag === 'img') return; // lifted out as its own block
      runsOf(n, bold || tag === 'strong' || tag === 'b', italic || tag === 'em' || tag === 'i', out);
    });
    return out;
  };

  const liftImages = (el: Element) => {
    const found = el.tagName.toLowerCase() === 'img' ? [el] : Array.from(el.querySelectorAll('img'));
    found.forEach((img) => {
      const src = img.getAttribute('src') ?? '';
      if (src.startsWith('data:image/')) {
        images.push(src);
        blocks.push({ kind: 'image', src, w: 0, h: 0 });
      }
    });
  };

  const list = (el: Element, depth: number) => {
    let n = 0;
    for (const li of Array.from(el.children)) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      n += 1;
      const nested = Array.from(li.children).filter((c) => /^(ul|ol)$/i.test(c.tagName));
      const clone = li.cloneNode(true) as Element;
      clone.querySelectorAll('ul, ol').forEach((x) => x.remove());
      blocks.push({
        kind: 'text',
        style: 'li',
        runs: runsOf(clone),
        bullet: el.tagName.toLowerCase() === 'ol' ? `${n}.` : '•',
        depth,
      });
      nested.forEach((sub) => list(sub, depth + 1));
    }
  };

  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const style = tag === 'h1' ? 'h1' : tag === 'h2' ? 'h2' : 'h3';
        blocks.push({ kind: 'text', style, runs: runsOf(child) });
      } else if (tag === 'p') {
        const runs = runsOf(child);
        if (runs.some((r) => r.text.trim())) blocks.push({ kind: 'text', style: 'p', runs });
        else if (!child.querySelector('img')) blocks.push({ kind: 'text', style: 'p', runs: [] });
        liftImages(child);
      } else if (tag === 'ul' || tag === 'ol') {
        list(child, 0);
      } else if (tag === 'table') {
        child.querySelectorAll('tr').forEach((tr, ri) => {
          const cells = Array.from(tr.children).filter((c) => /^(td|th)$/i.test(c.tagName));
          if (!cells.length) return;
          blocks.push({
            kind: 'row',
            cells: cells.map((c) => runsOf(c)),
            header: ri === 0 && (cells.some((c) => c.tagName.toLowerCase() === 'th') || !!tr.closest('thead')),
          });
        });
        blocks.push({ kind: 'text', style: 'p', runs: [] });
      } else if (tag === 'img') {
        liftImages(child);
      } else {
        walk(child);
      }
    }
  };
  walk(dom.body);
  return { blocks, images };
}

async function loadDocx(bytes: ArrayBuffer): Promise<LoadedSource> {
  const mod = await import('mammoth');
  const mammoth = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  let html: string;
  try {
    html = (await mammoth.convertToHtml({ arrayBuffer: bytes })).value;
  } catch {
    throw new UnsupportedFileError(
      'This Word file could not be read. Open it in Word or Google Docs, save it as PDF, attach that, and annotate the PDF.',
    );
  }
  const { blocks, images } = htmlToBlocks(html);

  // Decode embedded pictures once, both for their size and for painting.
  const decoded = new Map<string, HTMLImageElement>();
  await Promise.all(
    [...new Set(images)].map(async (src) => {
      const img = new Image();
      img.src = src;
      try {
        await img.decode();
        decoded.set(src, img);
      } catch {
        /* an image we cannot decode is skipped, never fatal */
      }
    }),
  );
  const sized: DocBlock[] = [];
  for (const b of blocks) {
    if (b.kind !== 'image') {
      sized.push(b);
      continue;
    }
    const img = decoded.get(b.src);
    // CSS pixels → points.
    if (img) sized.push({ ...b, w: img.naturalWidth * 0.75, h: img.naturalHeight * 0.75 });
  }

  const probe = document.createElement('canvas').getContext('2d');
  const measure: Measure = (text, size, bold, italic) => {
    if (!probe) return text.length * size * 0.5;
    probe.font = fontFor(size, bold, italic);
    return probe.measureText(text).width;
  };
  const layout = layoutDoc(sized, measure);
  if (!sized.length) {
    throw new UnsupportedFileError('This Word file has no text or pictures in it that could be shown.');
  }

  const paint = (ctx: CanvasRenderingContext2D, ops: DocOp[]) => {
    ctx.textBaseline = 'alphabetic';
    for (const op of ops) {
      if (op.t === 'text') {
        ctx.fillStyle = '#111827';
        ctx.font = fontFor(op.size, op.bold, op.italic);
        ctx.fillText(op.text, op.x, op.y);
      } else if (op.t === 'rect') {
        if (op.fill) {
          ctx.fillStyle = '#eef1f6';
          ctx.fillRect(op.x, op.y, op.w, op.h);
        }
        ctx.strokeStyle = '#c9d1dd';
        ctx.lineWidth = 0.6;
        ctx.strokeRect(op.x, op.y, op.w, op.h);
      } else {
        const img = decoded.get(op.src);
        if (img) ctx.drawImage(img, op.x, op.y, op.w, op.h);
      }
    }
  };

  return {
    kind: 'docx',
    pages: layout.pages.map(() => ({ w: DOC_PAGE.w, h: DOC_PAGE.h })),
    note: layout.truncated
      ? `Approximate layout — showing the first ${layout.pages.length} pages. For an exact copy, save it as PDF in Word or Google Docs first.`
      : 'Approximate layout of the text, tables and pictures. For an exact copy, save it as PDF in Word or Google Docs first.',
    async render(index, canvas, scale) {
      const ctx = prepare(canvas, DOC_PAGE.w, DOC_PAGE.h, scale);
      paint(ctx, layout.pages[index] ?? []);
    },
    destroy() {
      decoded.clear();
    },
  };
}

/** Load any supported file. Throws UnsupportedFileError with a sentence for
 *  anything that cannot be drawn on. */
export async function loadSource(bytes: ArrayBuffer, filename: string, mime: string): Promise<LoadedSource> {
  const kind = annotateKind(filename, mime);
  if (!kind) throw new UnsupportedFileError(unsupportedReason(filename));
  if (kind === 'pdf') return loadPdf(bytes);
  if (kind === 'image') return loadImage(bytes, mime, filename);
  if (kind === 'xlsx') return loadSheet(bytes, filename);
  return loadDocx(bytes);
}

/** Paint a page into a fresh canvas and encode it — the exporter's raster path. */
export async function rasterPage(
  src: LoadedSource,
  index: number,
  scale: number,
  type: 'image/png' | 'image/jpeg',
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  await src.render(index, canvas, scale);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error(`Page ${index + 1} could not be flattened.`);
  return new Uint8Array(await blob.arrayBuffer());
}
