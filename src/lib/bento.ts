/**
 * Bento row packing — no synthetic filler tile, ever.
 *
 * The naive fix for "the grid must close as a rectangle" is a fake tail tile
 * sized to whatever remainder is left over. That reads exactly as clinical as
 * it sounds: hide a widget and you get a bigger empty patch, not more room in
 * something real. This instead walks tiles in order, and whenever a row would
 * otherwise end with leftover width, GROWS the real tile that's already last
 * in that row to consume it. Every row closes flush using only real content,
 * on every render, so toggling a widget off makes its neighbours visibly
 * bigger rather than leaving a hole for something to patch.
 */

export interface PackInput {
  key: string;
  /** Preferred/minimum column span, before growth. */
  cols: number;
}

export interface PackedTile extends PackInput {
  /** Actual span to render, cols plus whatever its row had left over. */
  renderCols: number;
}

export function packBentoRow(tiles: PackInput[], width: number): PackedTile[] {
  const out: PackedTile[] = [];
  let rowStart = 0;
  let used = 0;

  const closeRow = () => {
    if (out.length === rowStart) return;
    const leftover = width - used;
    if (leftover > 0) out[out.length - 1].renderCols += leftover;
  };

  for (const t of tiles) {
    const cols = Math.max(1, Math.min(t.cols, width));
    if (used > 0 && used + cols > width) {
      closeRow();
      rowStart = out.length;
      used = 0;
    }
    out.push({ ...t, cols, renderCols: cols });
    used += cols;
  }
  closeRow();
  return out;
}

/** Convenience: packed spans for both grid widths this app actually uses. */
export function packBento(tiles: PackInput[]): { rc4: Map<string, number>; rc2: Map<string, number> } {
  const at4 = packBentoRow(tiles, 4);
  const at2 = packBentoRow(tiles, 2);
  return {
    rc4: new Map(at4.map((t) => [t.key, t.renderCols])),
    rc2: new Map(at2.map((t) => [t.key, t.renderCols])),
  };
}
