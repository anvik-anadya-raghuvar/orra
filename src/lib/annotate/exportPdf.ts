/**
 * Flatten ink into a PDF someone can review anywhere.
 *
 * Two paths, chosen per file:
 *
 *  - **Vector onto the original** (PDF sources). The original pages are kept
 *    byte-for-byte and each stroke is added as a filled path on top, so the
 *    text stays selectable and the file barely grows.
 *  - **Raster underlay** (images, spreadsheets, Word files — and any PDF that
 *    pdf-lib cannot modify, such as an encrypted one). Each page is painted
 *    exactly as it looked while drawing, embedded as an image, and the ink
 *    still goes on top as vectors.
 *
 * pdf-lib is imported here and only here, dynamically — it is never in the
 * main bundle.
 */
import type { InkData } from './ink';
import { pageToPdfOps, type Placement } from './pdfPaths';
import { rasterPage, type LoadedSource } from './sources';

type PdfLib = typeof import('pdf-lib');

export interface ExportProgress {
  (done: number, total: number): void;
}

/** Device pixels per page unit for rasterised pages — 2× is print-sharp for
 *  text at A4 without making a 40-page spreadsheet a 40 MB file. */
const RASTER_SCALE = 2;

function stamp(doc: import('pdf-lib').PDFDocument, title: string) {
  // So a PDF viewer's tab says what this is.
  doc.setTitle(title);
  doc.setProducer('ORRA');
  doc.setCreator('ORRA annotate');
}

function drawInk(lib: PdfLib, page: import('pdf-lib').PDFPage, ops: ReturnType<typeof pageToPdfOps>) {
  for (const op of ops) {
    page.drawSvgPath(op.d, {
      x: 0,
      y: 0,
      color: lib.rgb(op.color.r, op.color.g, op.color.b),
      opacity: op.opacity,
      blendMode: op.multiply ? lib.BlendMode.Multiply : undefined,
    });
  }
}

async function vectorOnto(
  lib: PdfLib,
  bytes: Uint8Array,
  ink: InkData,
  title: string,
  progress?: ExportProgress,
): Promise<Uint8Array | null> {
  let doc;
  try {
    doc = await lib.PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    return null; // encrypted or unparseable by pdf-lib → raster fallback
  }
  if (doc.isEncrypted) return null;
  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((page, i) => {
    const strokes = ink.strokes[i] ?? [];
    if (strokes.length) {
      const drawnOn = ink.pages[i];
      const placement: Placement = {
        box: page.getCropBox(),
        rotation: page.getRotation().angle,
        inkW: drawnOn?.w ?? 0,
        inkH: drawnOn?.h ?? 0,
      };
      // Isolate the page's own content in q…Q first. Some producers leave
      // the transform matrix changed at the end of a page, and without this
      // every stroke would land scaled or offset.
      page.node.normalize();
      page.node.wrapContentStreams(
        doc.context.getPushGraphicsStateContentStream(),
        doc.context.getPopGraphicsStateContentStream(),
      );
      drawInk(lib, page, pageToPdfOps(strokes, placement));
    }
    progress?.(i + 1, total);
  });
  stamp(doc, title);
  return doc.save();
}

async function rasterUnder(
  lib: PdfLib,
  src: LoadedSource,
  ink: InkData,
  title: string,
  progress?: ExportProgress,
): Promise<Uint8Array> {
  const doc = await lib.PDFDocument.create();
  const total = src.pages.length;
  for (let i = 0; i < total; i += 1) {
    const size = src.pages[i];
    // Photos stay JPEG (a PNG of a phone photo is enormous); drawn pages —
    // text, grids — stay PNG so the letters do not ring.
    const jpeg = src.kind === 'image' && !src.lossless;
    const scale =
      src.kind === 'image'
        ? Math.min(4, 3000 / Math.max(size.w, size.h)) // up to ~3000 px on the long side
        : RASTER_SCALE;
    const bytes = await rasterPage(src, i, scale, jpeg ? 'image/jpeg' : 'image/png');
    const img = jpeg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
    const page = doc.addPage([size.w, size.h]);
    page.drawImage(img, { x: 0, y: 0, width: size.w, height: size.h });
    const strokes = ink.strokes[i] ?? [];
    if (strokes.length) {
      drawInk(
        lib,
        page,
        pageToPdfOps(strokes, {
          box: { x: 0, y: 0, width: size.w, height: size.h },
          rotation: 0,
          inkW: ink.pages[i]?.w ?? size.w,
          inkH: ink.pages[i]?.h ?? size.h,
        }),
      );
    }
    progress?.(i + 1, total);
  }
  stamp(doc, title);
  return doc.save();
}

/** The annotated PDF, as bytes. */
export async function buildAnnotatedPdf(
  src: LoadedSource,
  ink: InkData,
  title: string,
  progress?: ExportProgress,
): Promise<Uint8Array> {
  const lib = await import('pdf-lib');
  let out: Uint8Array | null = null;
  if (src.kind === 'pdf' && src.pdfBytes) out = await vectorOnto(lib, src.pdfBytes, ink, title, progress);
  return out ?? rasterUnder(lib, src, ink, title, progress);
}
