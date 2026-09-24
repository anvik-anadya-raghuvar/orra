/**
 * Strokes → PDF drawing instructions.
 *
 * The PDF writer (exportPdf.ts) draws every stroke as a filled vector path on
 * top of the page, so an annotated PDF stays a real PDF: its text is still
 * selectable and searchable, and the ink is as sharp at 400 % as at 100 %.
 *
 * The only real work is coordinates. Ink is stored in the page as SHOWN —
 * top-left origin, y down, after the page's /Rotate is applied (that is what
 * pdf.js's viewport gives the screen). A PDF draws in unrotated user space,
 * y up, offset by the crop box. `viewToUser` is that mapping, for all four
 * rotations; the rest is formatting.
 *
 * pdf-lib's drawSvgPath flips y itself (it scales by -1), so a user-space
 * point (ux, uy) is written as (ux, -uy) and drawn at origin 0,0.
 *
 * Pure and deterministic — same ink in, same string out — which is tested.
 */
import { HIGHLIGHT_OPACITY, polygonPath, strokeOutline, type InkStroke } from './ink';

export interface PdfBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Placement {
  /** Crop box in unrotated user space. */
  box: PdfBox;
  /** The page's /Rotate, normalised to 0 | 90 | 180 | 270. */
  rotation: number;
  /** The page size the ink was drawn against (rotated, as shown). */
  inkW: number;
  inkH: number;
}

export function normRotation(deg: number): 0 | 90 | 180 | 270 {
  const r = (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
  return r as 0 | 90 | 180 | 270;
}

/** The shown (rotated) size of a page, in points. */
export function shownSize(box: PdfBox, rotation: number): { w: number; h: number } {
  const r = normRotation(rotation);
  return r === 90 || r === 270 ? { w: box.height, h: box.width } : { w: box.width, h: box.height };
}

/**
 * A point on the page as shown (top-left, y down) → PDF user space (y up).
 *
 * Ink coordinates are first rescaled from the size they were drawn against to
 * the page's real shown size — pdf.js and pdf-lib agree to the point on
 * almost every file, and this makes the rare disagreement a resize rather
 * than an offset.
 */
export function viewToUser(vx0: number, vy0: number, p: Placement): { x: number; y: number } {
  const { box } = p;
  const r = normRotation(p.rotation);
  const shown = shownSize(box, r);
  const vx = p.inkW > 0 ? (vx0 * shown.w) / p.inkW : vx0;
  const vy = p.inkH > 0 ? (vy0 * shown.h) / p.inkH : vy0;
  switch (r) {
    case 90:
      return { x: box.x + vy, y: box.y + vx };
    case 180:
      return { x: box.x + box.width - vx, y: box.y + vy };
    case 270:
      return { x: box.x + box.width - vy, y: box.y + box.height - vx };
    default:
      return { x: box.x + vx, y: box.y + box.height - vy };
  }
}

export interface PdfStrokeOp {
  /** SVG path data for pdf-lib's drawSvgPath at x 0, y 0. */
  d: string;
  /** 0–1 channels, for pdf-lib's rgb(). */
  color: { r: number; g: number; b: number };
  opacity: number;
  /** Highlighters multiply, so text under them stays black. */
  multiply: boolean;
}

export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x111827;
  const q = (v: number) => Math.round((v / 255) * 1000) / 1000;
  return { r: q((n >> 16) & 255), g: q((n >> 8) & 255), b: q(n & 255) };
}

/** One stroke as a PDF path, or null if it has nothing to draw. */
export function strokeToPdfOp(stroke: InkStroke, placement: Placement): PdfStrokeOp | null {
  const poly = strokeOutline(stroke);
  if (poly.length < 6) return null;
  const mapped: number[] = new Array(poly.length);
  for (let i = 0; i < poly.length; i += 2) {
    const u = viewToUser(poly[i], poly[i + 1], placement);
    mapped[i] = u.x;
    mapped[i + 1] = -u.y; // drawSvgPath flips y back
  }
  const d = polygonPath(mapped);
  if (!d) return null;
  const highlighter = stroke.tool === 'highlighter';
  return {
    d,
    color: hexToRgb01(stroke.color),
    opacity: highlighter ? HIGHLIGHT_OPACITY : 1,
    multiply: highlighter,
  };
}

/** Every stroke on a page, highlighters first so pen ink sits on top. */
export function pageToPdfOps(strokes: InkStroke[], placement: Placement): PdfStrokeOp[] {
  const ordered = [
    ...strokes.filter((s) => s.tool === 'highlighter'),
    ...strokes.filter((s) => s.tool !== 'highlighter'),
  ];
  const out: PdfStrokeOp[] = [];
  for (const s of ordered) {
    const op = strokeToPdfOp(s, placement);
    if (op) out.push(op);
  }
  return out;
}
