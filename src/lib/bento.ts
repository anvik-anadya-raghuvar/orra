/**
 * Bento packing — no synthetic filler tile, ever, and no trailing holes.
 *
 * Two naive approaches both fail:
 *
 *  - A fake tail tile sized to the remainder reads exactly as clinical as it
 *    sounds: hide a widget and you get a bigger empty patch, not more room in
 *    something real.
 *  - Closing each row horizontally and trusting `grid-auto-flow: dense` looks
 *    right until a tile is two rows tall, because that tile also consumes a
 *    cell in the row beneath it. The leftovers surface as empty cells at the
 *    end of the grid, and simple area arithmetic cannot fix it — widening a
 *    tile to balance the total can push it onto a new row and open more holes
 *    than it closed.
 *
 * So placement is computed here rather than delegated: tiles are laid out
 * first-fit into an occupancy map, then any hole is closed by growing the real
 * tile immediately to its left (or above), and callers position each tile
 * explicitly. The result is a full rectangle built only from real content.
 */

export interface PackInput {
  key: string;
  /** Preferred/minimum column span, before growth. */
  cols: number;
  /** Row span; a tall tile is 2. */
  rows?: number;
}

export interface PackedTile extends PackInput {
  /** Final column span after growing to close holes. */
  renderCols: number;
  /** Final row span. */
  renderRows: number;
  /** 1-based CSS grid line where this tile starts. */
  col: number;
  row: number;
}

interface Cell {
  key: string;
}

/** Lay tiles out first-fit and close any hole by growing a real neighbour. */
export function packBentoRow(tiles: PackInput[], width: number): PackedTile[] {
  const grid: (Cell | null)[][] = [];
  const out: PackedTile[] = [];

  const ensureRow = (r: number) => {
    while (grid.length <= r) grid.push(Array<Cell | null>(width).fill(null));
  };
  const fits = (r: number, c: number, cw: number, rh: number) => {
    if (c + cw > width) return false;
    for (let y = r; y < r + rh; y++) {
      ensureRow(y);
      for (let x = c; x < c + cw; x++) if (grid[y][x]) return false;
    }
    return true;
  };
  const occupy = (r: number, c: number, cw: number, rh: number, key: string) => {
    for (let y = r; y < r + rh; y++) {
      ensureRow(y);
      for (let x = c; x < c + cw; x++) grid[y][x] = { key };
    }
  };

  for (const t of tiles) {
    const cw = Math.max(1, Math.min(t.cols, width));
    const rh = Math.max(1, t.rows ?? 1);
    let placed = false;
    for (let r = 0; !placed; r++) {
      ensureRow(r + rh - 1);
      for (let c = 0; c <= width - cw; c++) {
        if (fits(r, c, cw, rh)) {
          occupy(r, c, cw, rh, t.key);
          out.push({ ...t, cols: cw, renderCols: cw, renderRows: rh, col: c + 1, row: r + 1 });
          placed = true;
          break;
        }
      }
    }
  }

  // Close leftovers by growing whichever real tile already borders the hole.
  const byKey = new Map(out.map((t) => [t.key, t]));
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < width; x++) {
      if (grid[y][x]) continue;
      // Prefer the tile to the left: growing sideways never changes row count.
      const left = x > 0 ? grid[y][x - 1] : null;
      if (left) {
        const t = byKey.get(left.key)!;
        // Only if this hole sits on every row the tile spans, so it stays rectangular.
        const spansAll = Array.from({ length: t.renderRows }, (_, i) => t.row - 1 + i).every(
          (ry) => ry < grid.length && !grid[ry][x],
        );
        if (spansAll && t.col - 1 + t.renderCols === x) {
          t.renderCols += 1;
          for (let i = 0; i < t.renderRows; i++) grid[t.row - 1 + i][x] = { key: t.key };
          continue;
        }
      }
      // Otherwise extend the tile directly above downwards.
      const above = y > 0 ? grid[y - 1][x] : null;
      if (above) {
        const t = byKey.get(above.key)!;
        const spansAll = Array.from({ length: t.renderCols }, (_, i) => t.col - 1 + i).every(
          (cx) => !grid[y][cx],
        );
        if (spansAll && t.row - 1 + t.renderRows === y) {
          t.renderRows += 1;
          for (let i = 0; i < t.renderCols; i++) grid[y][t.col - 1 + i] = { key: t.key };
        }
      }
    }
  }

  return out;
}

/** Packed spans and positions for both grid widths this app actually uses. */
export function packBento(tiles: PackInput[]): {
  rc4: Map<string, PackedTile>;
  rc2: Map<string, PackedTile>;
} {
  return {
    rc4: new Map(packBentoRow(tiles, 4).map((t) => [t.key, t])),
    rc2: new Map(packBentoRow(tiles, 2).map((t) => [t.key, t])),
  };
}

/** True when the layout is a complete rectangle — used by the tests. */
export function hasNoHoles(tiles: PackInput[], width: number): boolean {
  const packed = packBentoRow(tiles, width);
  const rows = Math.max(...packed.map((t) => t.row - 1 + t.renderRows));
  const seen = new Set<string>();
  for (const t of packed) {
    for (let y = t.row - 1; y < t.row - 1 + t.renderRows; y++) {
      for (let x = t.col - 1; x < t.col - 1 + t.renderCols; x++) seen.add(`${y},${x}`);
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < width; x++) if (!seen.has(`${y},${x}`)) return false;
  }
  return true;
}
