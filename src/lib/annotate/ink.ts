/**
 * Ink on a document page, as data.
 *
 * The sibling of lib/sketch.ts, with two deliberate differences:
 *
 *  - **Pressure is rendered.** A sketch is a 3–12 unit line on a blank card,
 *    where a tapered nib is barely visible. Marking up a contract with an
 *    S Pen or an Apple Pencil is exactly where it is: a light tick and a hard
 *    underline should look different, the way they do on paper. So a stroke
 *    here is painted as a *filled outline* whose half-width follows pressure
 *    (the perfect-freehand idea, written in-house in ~100 lines rather than
 *    pulled in as a dependency).
 *
 *  - **Colours are literal hex, not theme tokens.** A sketch lives on the
 *    app's own surface and must survive a theme switch. Ink here lives on a
 *    white page that gets flattened into a PDF someone else will print, so
 *    red has to be red in every theme and in every viewer.
 *
 * Every coordinate is in PAGE UNITS — PDF points for a PDF, and a normalised
 * page box for everything else — never screen pixels. That is what lets the
 * same stroke be drawn at any zoom, on any device, and written into the PDF
 * with no conversion beyond a flip (see pdfPaths.ts).
 *
 * Pure: no DOM, no clock, no randomness. Tested in node.
 */
import type { AnnotationInk, AnnotationInkStroke } from '../../types';

export type InkStroke = AnnotationInkStroke;
export type InkData = AnnotationInk;
export type InkTool = InkStroke['tool'];

/** Pen colours — dark enough to read on white, distinct enough to mean
 *  something ("red is a correction, blue is a question"). */
export const PEN_COLORS = [
  { hex: '#111827', label: 'Black' },
  { hex: '#dc2626', label: 'Red' },
  { hex: '#2563eb', label: 'Blue' },
  { hex: '#15803d', label: 'Green' },
] as const;

/** Highlighter colours — light, because they are painted with multiply. */
export const HIGHLIGHT_COLORS = [
  { hex: '#facc15', label: 'Yellow' },
  { hex: '#4ade80', label: 'Green' },
  { hex: '#f472b6', label: 'Pink' },
  { hex: '#60a5fa', label: 'Blue' },
] as const;

/** Nib widths in page units (≈ points). */
export const PEN_SIZES = [1.5, 3, 6] as const;
export const HIGHLIGHT_SIZES = [10, 16, 24] as const;

/** Highlighter opacity, on screen and in the PDF alike. */
export const HIGHLIGHT_OPACITY = 0.35;

/**
 * Serialized-size ceiling for one annotation's ink. The column CHECK in
 * 0054_annotations.sql is 2 MB; refusing at 1.8 MB keeps that a backstop
 * nobody ever meets rather than a failed save.
 */
export const INK_BYTE_BUDGET = 1.8 * 1024 * 1024;

export function makeInk(pages: { w: number; h: number }[]): InkData {
  return { v: 1, pages: pages.map((p) => ({ w: p.w, h: p.h })), strokes: pages.map(() => []) };
}

/** A row written by an older build, a half-synced one, or garbage — never crash. */
export function isInkData(value: unknown): value is InkData {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<InkData>;
  return Array.isArray(v.pages) && Array.isArray(v.strokes);
}

/**
 * Fit stored ink onto the pages the file has now. If the file was replaced
 * with one that has fewer pages, ink for the missing pages is dropped rather
 * than drawn onto the wrong page; more pages get empty layers.
 */
export function reconcileInk(stored: unknown, pages: { w: number; h: number }[]): InkData {
  const fresh = makeInk(pages);
  if (!isInkData(stored)) return fresh;
  for (let i = 0; i < pages.length; i += 1) {
    const layer = stored.strokes[i];
    const was = stored.pages[i];
    if (!Array.isArray(layer) || !layer.length) continue;
    // Same page, re-measured slightly differently (rounding, a crop box):
    // rescale rather than drift.
    const sx = was && was.w > 0 ? pages[i].w / was.w : 1;
    const sy = was && was.h > 0 ? pages[i].h / was.h : 1;
    fresh.strokes[i] = layer
      .filter((s) => s && Array.isArray(s.points) && s.points.length >= 3)
      .map((s) =>
        sx === 1 && sy === 1
          ? s
          : {
              ...s,
              points: s.points.map((n, k) => (k % 3 === 0 ? n * sx : k % 3 === 1 ? n * sy : n)),
            },
      );
  }
  return fresh;
}

export function inkBytes(ink: InkData): number {
  return new TextEncoder().encode(JSON.stringify(ink)).length;
}

export function inkStrokeCount(ink: InkData): number {
  return ink.strokes.reduce((n, layer) => n + layer.length, 0);
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

/**
 * Drop points closer than `epsilon` and round to storage precision, keeping
 * the true first and last point. Applied once, on pen-lift.
 */
export function finalizePoints(points: number[], epsilon = 0.6): number[] {
  if (points.length < 3) return [];
  const out: number[] = [round1(points[0]), round1(points[1]), round2(points[2])];
  let lx = points[0];
  let ly = points[1];
  const min = epsilon * epsilon;
  for (let i = 3; i < points.length - 3; i += 3) {
    const dx = points[i] - lx;
    const dy = points[i + 1] - ly;
    if (dx * dx + dy * dy < min) continue;
    out.push(round1(points[i]), round1(points[i + 1]), round2(points[i + 2]));
    lx = points[i];
    ly = points[i + 1];
  }
  if (points.length > 3) {
    const t = points.length - 3;
    out.push(round1(points[t]), round1(points[t + 1]), round2(points[t + 2]));
  }
  return out;
}

/**
 * Pressure to use for each point.
 *
 * A real pen reports it. A finger or a mouse does not (a mouse reports a flat
 * 0.5, most fingers 0 or 1), so for those the pressure is *simulated* from
 * speed — a quick flick thins out, a slow deliberate line stays full — which
 * is what makes finger ink look written rather than extruded. Smoothed so one
 * jittery sample cannot pinch the line.
 */
export function effectivePressures(points: number[], size: number, simulated: boolean): number[] {
  const n = Math.floor(points.length / 3);
  const out: number[] = new Array(n);
  if (!simulated) {
    let prev = clamp(points[2] || 0.5, 0.05, 1);
    for (let i = 0; i < n; i += 1) {
      const raw = clamp(points[i * 3 + 2] || 0, 0.05, 1);
      // Light easing — pens report in steps, and a step shows as a notch.
      prev = prev + (raw - prev) * 0.6;
      out[i] = prev;
    }
    return out;
  }
  let p = 0.55;
  for (let i = 0; i < n; i += 1) {
    if (i === 0) {
      out[i] = p;
      continue;
    }
    const dx = points[i * 3] - points[i * 3 - 3];
    const dy = points[i * 3 + 1] - points[i * 3 - 2];
    const speed = Math.min(1, Math.hypot(dx, dy) / Math.max(1, size * 2.5));
    const target = 0.62 - speed * 0.3;
    p = p + (target - p) * 0.35;
    out[i] = p;
  }
  return out;
}

/** Half-width at a given pressure. `thinning` 0 = constant width. */
export function radiusAt(size: number, pressure: number, thinning: number): number {
  return Math.max(0.3, (size / 2) * (1 - thinning + thinning * 2 * pressure));
}

/**
 * Pull each point part-way towards the previous one — a pen's own jitter is
 * visible at page zoom, and this is the cheapest smoothing that does not
 * shorten the stroke's end.
 */
export function streamline(points: number[], amount: number): number[] {
  if (amount <= 0 || points.length <= 6) return points.slice();
  const out = points.slice();
  const t = 1 - clamp(amount, 0, 0.95);
  for (let i = 3; i < out.length - 3; i += 3) {
    out[i] = out[i - 3] + (points[i] - out[i - 3]) * t;
    out[i + 1] = out[i - 2] + (points[i + 1] - out[i - 2]) * t;
  }
  return out;
}

/** Arc points around a centre, from angle a0 sweeping `sweep` radians. */
function arc(out: number[], cx: number, cy: number, r: number, a0: number, sweep: number, steps: number) {
  for (let k = 1; k < steps; k += 1) {
    const a = a0 + (sweep * k) / steps;
    out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
}

/**
 * The filled outline of a stroke, as a flat polygon [x0, y0, x1, y1, …].
 *
 * Left edge forward, a round cap, right edge back, a round cap — offset from
 * the centreline by a pressure-driven half-width along each point's normal.
 * A single tap is a dot.
 */
export function strokeOutline(stroke: Pick<InkStroke, 'points' | 'size' | 'tool' | 'sim'>): number[] {
  const highlighter = stroke.tool === 'highlighter';
  const thinning = highlighter ? 0 : 0.6;
  const pts = streamline(stroke.points, highlighter ? 0.2 : 0.35);
  const n = Math.floor(pts.length / 3);
  if (!n) return [];
  const pressures = effectivePressures(pts, stroke.size, !!stroke.sim);
  const r = pressures.map((p) => radiusAt(stroke.size, p, thinning));

  // Collapse consecutive duplicates — they have no direction.
  const xs: number[] = [];
  const ys: number[] = [];
  const rs: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = pts[i * 3];
    const y = pts[i * 3 + 1];
    const last = xs.length - 1;
    if (last >= 0 && Math.abs(xs[last] - x) < 1e-6 && Math.abs(ys[last] - y) < 1e-6) {
      rs[last] = Math.max(rs[last], r[i]);
      continue;
    }
    xs.push(x);
    ys.push(y);
    rs.push(r[i]);
  }

  const out: number[] = [];
  if (xs.length === 1) {
    const rr = rs[0];
    for (let k = 0; k < 12; k += 1) {
      const a = (Math.PI * 2 * k) / 12;
      out.push(xs[0] + Math.cos(a) * rr, ys[0] + Math.sin(a) * rr);
    }
    return out;
  }

  const m = xs.length;
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < m; i += 1) {
    const a = i === 0 ? 0 : i - 1;
    const b = i === m - 1 ? m - 1 : i + 1;
    let tx = xs[b] - xs[a];
    let ty = ys[b] - ys[a];
    const len = Math.hypot(tx, ty) || 1;
    tx /= len;
    ty /= len;
    const nx = -ty;
    const ny = tx;
    left.push(xs[i] + nx * rs[i], ys[i] + ny * rs[i]);
    right.push(xs[i] - nx * rs[i], ys[i] - ny * rs[i]);
  }

  out.push(...left);
  // End cap: from the left edge round to the right edge.
  const endA = Math.atan2(left[left.length - 1] - ys[m - 1], left[left.length - 2] - xs[m - 1]);
  arc(out, xs[m - 1], ys[m - 1], rs[m - 1], endA, -Math.PI, 8);
  for (let i = m - 1; i >= 0; i -= 1) out.push(right[i * 2], right[i * 2 + 1]);
  const startA = Math.atan2(right[1] - ys[0], right[0] - xs[0]);
  arc(out, xs[0], ys[0], rs[0], startA, -Math.PI, 8);
  return out;
}

/** Trim a coordinate for a path string — two decimals, no trailing zeros. */
export const fmt = (n: number) => String(Math.round(n * 100) / 100);

/**
 * A closed polygon as a smooth SVG path: quadratic segments through the
 * midpoints, so the outline's facets never show. Deterministic.
 *
 * `mapY` lets the PDF writer flip the axis without a second implementation.
 */
export function polygonPath(poly: number[], mapX = (x: number) => x, mapY = (y: number) => y): string {
  const n = Math.floor(poly.length / 2);
  if (n < 2) return '';
  const X = (i: number) => mapX(poly[(i % n) * 2]);
  const Y = (i: number) => mapY(poly[(i % n) * 2 + 1]);
  let d = `M${fmt((X(0) + X(1)) / 2)} ${fmt((Y(0) + Y(1)) / 2)}`;
  for (let i = 1; i <= n; i += 1) {
    d += ` Q${fmt(X(i))} ${fmt(Y(i))} ${fmt((X(i) + X(i + 1)) / 2)} ${fmt((Y(i) + Y(i + 1)) / 2)}`;
  }
  return `${d} Z`;
}

/** The SVG path for a stroke, in page units. */
export function strokeSvgPath(stroke: Pick<InkStroke, 'points' | 'size' | 'tool' | 'sim'>): string {
  return polygonPath(strokeOutline(stroke));
}

/** Squared distance from a point to a segment. */
function distSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l = dx * dx + dy * dy;
  let t = l === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / l;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** Stroke-level eraser hit test, in page units. */
export function inkHit(stroke: InkStroke, x: number, y: number, tolerance: number): boolean {
  const p = stroke.points;
  const reach = stroke.size / 2 + tolerance;
  const reachSq = reach * reach;
  if (p.length < 3) return false;
  if (p.length === 3) return (p[0] - x) ** 2 + (p[1] - y) ** 2 <= reachSq;
  for (let i = 0; i < p.length - 3; i += 3) {
    if (distSq(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= reachSq) return true;
  }
  return false;
}
