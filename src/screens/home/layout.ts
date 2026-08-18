/**
 * Home grid arrangement — the user's own ordering and sizing of the bento.
 *
 * This is deliberately separate from src/lib/bento.ts. That module answers
 * "given these spans, where does everything sit so the rectangle closes with no
 * holes". This one answers "what spans does THIS user want, in what order",
 * which is a stored preference rather than a geometry problem. Keeping them
 * apart means dragging a tile cannot break the no-holes guarantee: the packer
 * still runs afterwards on whatever arrangement comes out of here.
 *
 * Everything below is a pure function of (declared tiles, stored layout) so the
 * arrangement is testable without mounting a grid.
 */

import type { HomeLayout } from '../../types';

export const MIN_COLS = 1;
export const MAX_COLS = 4;
export const MIN_ROWS = 1;
export const MAX_ROWS = 3;

export interface Span {
  cols: number;
  rows: number;
}

export interface BentoInput extends Span {
  key: string;
}

export const EMPTY_LAYOUT: HomeLayout = { order: [], size: {} };

/** A stored span can be anything — an older build, a hand-edited profile row,
 *  a tile that used to allow four columns and no longer does. Clamp on read so
 *  a bad value degrades to a small tile instead of blowing the grid open. */
export function clampSpan(cols: number, rows: number): Span {
  const c = Math.round(Number(cols));
  const r = Math.round(Number(rows));
  return {
    cols: Number.isFinite(c) ? Math.min(MAX_COLS, Math.max(MIN_COLS, c)) : MIN_COLS,
    rows: Number.isFinite(r) ? Math.min(MAX_ROWS, Math.max(MIN_ROWS, r)) : MIN_ROWS,
  };
}

/**
 * Apply a stored layout to the tiles a render actually produced.
 *
 * Order is the interesting case. A key in `order` that no longer exists is
 * dropped, which is trivial. A tile that is NOT in `order` — a widget shipped
 * after the user last arranged their Home — must not fall to the bottom of the
 * page, because that reads as a bug rather than as a new feature. So an
 * unplaced tile inherits the rank of the last placed tile before it in
 * declaration order and sorts immediately after it: the new widget shows up
 * beside the tile it was declared next to, and the user's own arrangement of
 * everything else is untouched.
 */
export function arrange<T extends BentoInput>(tiles: T[], layout?: HomeLayout | null): T[] {
  const sized = tiles.map((t) => {
    const stored = layout?.size?.[t.key];
    if (!stored) return t;
    return { ...t, ...clampSpan(stored[0], stored[1]) };
  });

  const order = layout?.order;
  if (!order?.length) return sized;

  const rank = new Map(order.map((k, i) => [k, i]));
  let anchor = -1;
  let drift = 0;
  const keyed = sized.map((t) => {
    const r = rank.get(t.key);
    if (r === undefined) {
      drift += 1;
      // Fractional so it lands after its anchor but before the next placed
      // tile, no matter how many consecutive new widgets there are.
      return { t, r: anchor + drift / (drift + 1) };
    }
    anchor = r;
    drift = 0;
    return { t, r };
  });

  // Index tiebreak keeps this a stable sort on every engine.
  return keyed
    .map((x, i) => ({ ...x, i }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.t);
}

/** Move `key` so it sits where `target` currently sits, closing the gap behind
 *  it. `visible` is the arranged order of what is on screen right now, so the
 *  result is a complete order for exactly the tiles the user can see. */
export function moveKey(visible: string[], key: string, target: string): string[] {
  if (key === target) return visible;
  const from = visible.indexOf(key);
  const to = visible.indexOf(target);
  if (from < 0 || to < 0) return visible;
  const next = visible.slice();
  next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}

/** Merge a fresh visible order into the stored one. Keys the user cannot
 *  currently see — a widget they toggled off — keep their stored position
 *  rather than being silently dropped, so toggling it back on restores it
 *  where it was rather than at the end. */
export function withOrder(layout: HomeLayout | undefined | null, visible: string[]): HomeLayout {
  const base = layout ?? EMPTY_LAYOUT;
  const shown = new Set(visible);
  // What is on screen is authoritative for the tiles on screen. Each hidden key
  // is then spliced back in directly after whatever it used to follow, so the
  // stored order stays a superset that survives toggling widgets on and off.
  const out = visible.slice();
  let anchor = 0;
  for (const k of base.order) {
    if (shown.has(k)) {
      anchor = out.indexOf(k) + 1;
      continue;
    }
    out.splice(anchor, 0, k);
    anchor += 1;
  }
  return { ...base, order: out };
}

export function withSize(
  layout: HomeLayout | undefined | null,
  key: string,
  span: Span,
): HomeLayout {
  const base = layout ?? EMPTY_LAYOUT;
  const { cols, rows } = clampSpan(span.cols, span.rows);
  return { ...base, size: { ...base.size, [key]: [cols, rows] } };
}

/** Drop every override for one tile, returning it to its declared span and
 *  leaving the order alone. */
export function clearSize(layout: HomeLayout | undefined | null, key: string): HomeLayout {
  const base = layout ?? EMPTY_LAYOUT;
  if (!base.size?.[key]) return base;
  const size = { ...base.size };
  delete size[key];
  return { ...base, size };
}

/** True when the user has actually arranged something, i.e. there is a layout
 *  worth offering to reset. */
export function isArranged(layout: HomeLayout | undefined | null): boolean {
  return Boolean(layout && (layout.order.length > 0 || Object.keys(layout.size ?? {}).length > 0));
}

/** Step a span by whole cells, clamped. Used by the keyboard and touch size
 *  controls, where a drag gesture is the wrong input. */
export function stepSpan(span: Span, dCols: number, dRows: number): Span {
  return clampSpan(span.cols + dCols, span.rows + dRows);
}
