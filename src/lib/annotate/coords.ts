/**
 * Page units ↔ screen pixels.
 *
 * Ink is stored in page units (see ink.ts); the screen shows each page at
 * some zoom inside a scrolling box. Mapping through the page element's own
 * bounding rect — rather than tracking scroll offsets and zoom separately —
 * means every CSS transform, scroll position and zoom level is already
 * accounted for, and the maths is two lines each way.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PagePoint {
  x: number;
  y: number;
}

/** A client (screen) point → page units, for a page drawn into `rect`. */
export function screenToPage(
  clientX: number,
  clientY: number,
  rect: Rect,
  pageW: number,
  pageH: number,
): PagePoint {
  const sx = rect.width > 0 ? pageW / rect.width : 1;
  const sy = rect.height > 0 ? pageH / rect.height : 1;
  return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
}

/** Page units → client (screen) point. The exact inverse of screenToPage. */
export function pageToScreen(x: number, y: number, rect: Rect, pageW: number, pageH: number): PagePoint {
  return {
    x: rect.left + (pageW > 0 ? (x * rect.width) / pageW : 0),
    y: rect.top + (pageH > 0 ? (y * rect.height) / pageH : 0),
  };
}

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;

export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * CSS pixels per page unit at zoom 1: the widest page fills the available
 * width. Never below a floor, so a phone in portrait still gets a readable
 * page rather than a postage stamp.
 */
export function fitScale(pages: { w: number }[], boxWidth: number, padding = 24): number {
  const widest = pages.reduce((m, p) => Math.max(m, p.w), 0);
  if (!widest || boxWidth <= 0) return 1;
  return Math.max(0.2, (boxWidth - padding) / widest);
}

/**
 * Where to scroll so the content point under `anchor` (a position inside the
 * scroll box, in CSS px) stays under it after a zoom change — pinch-zoom and
 * ctrl+wheel both zoom *around the fingers*, not around the top-left corner.
 */
export function zoomScroll(
  scroll: number,
  anchor: number,
  oldScale: number,
  newScale: number,
): number {
  if (oldScale <= 0) return scroll;
  const content = (scroll + anchor) / oldScale;
  return Math.max(0, content * newScale - anchor);
}

/**
 * Canvas backing-store scale for a page shown at `cssScale`: device pixels
 * for sharpness, capped so one page never exceeds `maxPixels` (iOS Safari
 * refuses canvases past ~16.7 M pixels and silently paints nothing).
 */
export function renderScale(
  pageW: number,
  pageH: number,
  cssScale: number,
  dpr: number,
  maxPixels = 12_000_000,
): number {
  const want = cssScale * Math.min(Math.max(dpr, 1), 2.5);
  const pixels = pageW * pageH * want * want;
  if (pixels <= maxPixels) return want;
  return Math.sqrt(maxPixels / (pageW * pageH));
}
