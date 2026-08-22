/**
 * Ink, as data.
 *
 * The portal could hold a typed word and a pasted picture and nothing in
 * between — no way to simply write on the screen with a pen. This is that
 * missing middle, and the rule it is built around is that **ink stays ink**:
 * nothing here recognises handwriting or turns a stroke into text. What you
 * drew is what is stored and what comes back.
 *
 * Strokes are vectors, not a picture, for four reasons that all mattered:
 *  - Size. A handwritten page is 10–50 KB as points and megabytes as a PNG,
 *    and a wiki page's whole `blocks` column is capped at 1 MB (0030).
 *  - Mock mode keeps the entire dataset in one localStorage entry and drops
 *    writes silently past quota, so a raster would lose data with no error.
 *  - Sharpness. A viewBox scales to any screen; a bitmap does not.
 *  - Theme. A stroke stores a *token key* ('teal'), never a hex value, so
 *    ink drawn in daylight is still legible in Deep Field and vice versa.
 *
 * Everything in this file is pure — no DOM, no clock, no randomness — which
 * is what lets it be tested properly in the node environment vitest runs in.
 */
import { FORMAT_COLORS } from './textFormat';

/**
 * The logical drawing space every stroke is expressed in.
 *
 * Fixed units rather than percentages on purpose: coordinates round to one
 * decimal in meaningful numbers, stroke widths and hit tolerances live in
 * the same unit system as the points, and the viewBox carries the aspect
 * ratio so no separate field can drift out of sync with the data.
 */
export const SKETCH_W = 1600;
export const SKETCH_H = 1200;

/**
 * Refuse a new stroke past this many bytes of serialized sketch.
 *
 * Sized against the tightest ceiling it has to live under: a wiki page's
 * `blocks` JSONB is capped at 1 MB for the *whole page*, so ~256 KB leaves
 * room for several sketches plus the rest of the page. The notes column
 * (0037) is checked at twice this, so the database constraint stays a
 * backstop rather than something a person ever runs into.
 */
export const SKETCH_BYTE_BUDGET = 256 * 1024;

/** Warn, but keep accepting strokes, past this share of the budget. */
export const SKETCH_WARN_RATIO = 0.8;

/** Pen widths, in logical units. Three is enough to be useful and few
 *  enough to fit a toolbar on a phone. */
export const SKETCH_SIZES = [3, 6, 12] as const;

/**
 * Ink colours: the app's own palette, plus plain ink as the default.
 *
 * Reusing FORMAT_COLORS rather than inventing a second colour system is the
 * same call textFormat.ts made — and storing the key means the renderer can
 * resolve it to `var(--teal)` at paint time, which is what makes a sketch
 * survive a theme switch.
 */
export const SKETCH_COLORS: { key: string; label: string }[] = [
  { key: 'ink', label: 'Ink' },
  ...FORMAT_COLORS,
];

export interface SketchStroke {
  id: string;
  /** A theme token key from SKETCH_COLORS — never a hex value. */
  color: string;
  /** Base width in logical units; one of SKETCH_SIZES. */
  size: number;
  /**
   * Flat triples: [x, y, pressure, x, y, pressure, …].
   *
   * Flat rather than `{x, y, p}[]` because the objects cost roughly three
   * times the JSON for the same numbers, and this column is size-capped.
   * Pressure is captured now and ignored by the v1 renderer, so a later
   * tapered-nib pass needs no data migration.
   */
  points: number[];
}

export interface SketchData {
  /** Schema version, so a future format can be told apart from this one. */
  v: 1;
  w: number;
  h: number;
  strokes: SketchStroke[];
}

export function makeSketch(): SketchData {
  return { v: 1, w: SKETCH_W, h: SKETCH_H, strokes: [] };
}

/** True for anything that looks like a sketch we can render. Rows written
 *  before this feature, or half-synced ones, must never crash a page. */
export function isSketchData(value: unknown): value is SketchData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<SketchData>;
  return Array.isArray(data.strokes) && typeof data.w === 'number' && typeof data.h === 'number';
}

export function sketchIsEmpty(data: SketchData | null | undefined): boolean {
  return !data || !data.strokes.length;
}

/** Resolve a stored token key to something CSS can paint. */
export function sketchColorVar(key: string): string {
  return SKETCH_COLORS.some((c) => c.key === key) ? `var(--${key})` : 'var(--ink)';
}

/** One decimal for position, two for pressure — enough precision to be
 *  invisible, and a large share of the bytes saved. */
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Thin out a captured stroke.
 *
 * A pen reports far more points than a curve needs — with coalesced events a
 * single letter can arrive as hundreds. Dropping points closer together than
 * `epsilon` costs nothing visible at this resolution and is what keeps a
 * page of handwriting in tens of kilobytes rather than hundreds.
 *
 * Deliberately plain decimation rather than Ramer–Douglas–Peucker: ten lines
 * against sixty, and the difference is not visible through a 3-unit nib.
 * First and last points are always kept so a stroke never shortens.
 */
export function simplifyPoints(points: number[], epsilon = 1.5): number[] {
  if (points.length <= 6 || epsilon <= 0) return points.slice();
  const out: number[] = [points[0], points[1], points[2]];
  let lastX = points[0];
  let lastY = points[1];
  const min = epsilon * epsilon;
  // Every point but the last is a candidate; the last is appended verbatim
  // below so the stroke keeps its true end.
  for (let i = 3; i < points.length - 3; i += 3) {
    const dx = points[i] - lastX;
    const dy = points[i + 1] - lastY;
    if (dx * dx + dy * dy < min) continue;
    out.push(points[i], points[i + 1], points[i + 2]);
    lastX = points[i];
    lastY = points[i + 1];
  }
  const tail = points.length - 3;
  out.push(points[tail], points[tail + 1], points[tail + 2]);
  return out;
}

/** Round a captured stroke to storage precision. Applied once, on release. */
export function quantizeStroke(stroke: SketchStroke): SketchStroke {
  const points: number[] = new Array(stroke.points.length);
  for (let i = 0; i < stroke.points.length; i += 3) {
    points[i] = round1(stroke.points[i]);
    points[i + 1] = round1(stroke.points[i + 1]);
    points[i + 2] = round2(stroke.points[i + 2]);
  }
  return { ...stroke, points };
}

/** Trim a number for the path string: 812.4, not 812.4000000001. */
const fmt = (n: number) => String(Math.round(n * 10) / 10);

/**
 * An SVG path for one stroke.
 *
 * Quadratic smoothing through the midpoints: the line runs midpoint to
 * midpoint with each captured point as the control point, which rounds the
 * corners a hand naturally makes without needing to fit real splines.
 *
 * Rendered as a single-width stroked path rather than a filled outline. An
 * outline would let pressure taper the nib, but doubles both the geometry
 * code and the stored bytes for something barely visible at a 3–12 unit
 * width — pressure is kept in the data for the day that trade changes.
 *
 * Output is deterministic for a given stroke, which is what makes it
 * testable without a DOM.
 */
export function strokePathD(stroke: SketchStroke): string {
  const p = stroke.points;
  if (p.length < 3) return '';
  // A tap is a dot: zero-length lines are invisible even with a round cap,
  // so nudge the end a hair to give the cap something to paint.
  if (p.length === 3) return `M ${fmt(p[0])} ${fmt(p[1])} L ${fmt(p[0] + 0.01)} ${fmt(p[1])}`;
  if (p.length === 6) return `M ${fmt(p[0])} ${fmt(p[1])} L ${fmt(p[3])} ${fmt(p[4])}`;

  let d = `M ${fmt(p[0])} ${fmt(p[1])}`;
  for (let i = 3; i < p.length - 3; i += 3) {
    const midX = (p[i] + p[i + 3]) / 2;
    const midY = (p[i + 1] + p[i + 4]) / 2;
    d += ` Q ${fmt(p[i])} ${fmt(p[i + 1])} ${fmt(midX)} ${fmt(midY)}`;
  }
  const last = p.length - 3;
  d += ` L ${fmt(p[last])} ${fmt(p[last + 1])}`;
  return d;
}

/** Squared distance from a point to a segment — the inner loop of the
 *  eraser, kept allocation-free because it runs per segment per move. */
function distToSegmentSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/**
 * Does an eraser at (x, y) touch this stroke?
 *
 * A whole-stroke eraser rather than a pixel one: strokes are the unit the
 * data is stored in, and rubbing a hole through the middle of a pen line
 * would mean splitting strokes, which is a great deal of machinery for
 * something a person rarely wants. Touch a line, the line goes.
 */
export function strokeHit(stroke: SketchStroke, x: number, y: number, tolerance = 12): boolean {
  const p = stroke.points;
  if (p.length < 3) return false;
  const reach = stroke.size / 2 + tolerance;
  const reachSq = reach * reach;
  if (p.length === 3) {
    return (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y) <= reachSq;
  }
  for (let i = 0; i < p.length - 3; i += 3) {
    if (distToSegmentSq(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= reachSq) return true;
  }
  return false;
}

/** What this sketch costs in the database, measured the way the column is
 *  measured: serialized bytes. */
export function sketchBytes(data: SketchData): number {
  return new TextEncoder().encode(JSON.stringify(data)).length;
}

/** Whether one more stroke fits. Checked before committing, so a refusal
 *  costs the person the stroke they just drew and never their existing work. */
export function canAddStroke(data: SketchData, stroke: SketchStroke): boolean {
  const next: SketchData = { ...data, strokes: [...data.strokes, stroke] };
  return sketchBytes(next) <= SKETCH_BYTE_BUDGET;
}

/** 0–1, for the "nearly full" hint. */
export function sketchFullness(data: SketchData): number {
  return sketchBytes(data) / SKETCH_BYTE_BUDGET;
}
