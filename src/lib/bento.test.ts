import { describe, expect, it } from 'vitest';
import { packBentoRow } from './bento';

const sum = (tiles: { renderCols: number }[]) => tiles.reduce((a, t) => a + t.renderCols, 0);
/** Group the packed output back into rows the same way the algorithm did. */
function rows(tiles: { cols: number; renderCols: number }[], width: number) {
  const out: number[][] = [];
  let row: number[] = [];
  let used = 0;
  for (const t of tiles) {
    if (used > 0 && used + t.cols > width) {
      out.push(row);
      row = [];
      used = 0;
    }
    row.push(t.renderCols);
    used += t.cols;
  }
  if (row.length) out.push(row);
  return out;
}

describe('bento row packing — real tiles grow, no filler tile', () => {
  it('every row sums to exactly the grid width', () => {
    const tiles = [
      { key: 'a', cols: 4 },
      { key: 'b', cols: 2 },
      { key: 'c', cols: 2 },
      { key: 'd', cols: 1 },
      { key: 'e', cols: 1 },
      { key: 'f', cols: 1 },
    ];
    const packed = packBentoRow(tiles, 4);
    for (const row of rows(packed, 4)) {
      expect(row.reduce((a, b) => a + b, 0)).toBe(4);
    }
  });

  it('grows the last real tile in a short trailing row instead of adding a filler', () => {
    // b+c+d = 4 exactly, e is alone in the next row and must absorb the rest
    const tiles = [
      { key: 'b', cols: 2 },
      { key: 'c', cols: 1 },
      { key: 'd', cols: 1 },
      { key: 'e', cols: 1 },
    ];
    const packed = packBentoRow(tiles, 4);
    expect(packed).toHaveLength(4); // no extra tile was invented
    expect(packed.find((t) => t.key === 'e')!.renderCols).toBe(4); // alone → takes the full row
  });

  it('reflows when a widget is hidden: the new trailing tile grows to fill it', () => {
    const withWidget = [
      { key: 'a', cols: 2 },
      { key: 'money', cols: 1 },
      { key: 'song', cols: 1 },
    ];
    const withoutWidget = withWidget.filter((t) => t.key !== 'song');
    const before = packBentoRow(withWidget, 4).find((t) => t.key === 'money')!.renderCols;
    const after = packBentoRow(withoutWidget, 4).find((t) => t.key === 'money')!.renderCols;
    expect(after).toBeGreaterThan(before); // money tile visibly grows into the freed space
  });

  it('never renders a span wider than the grid', () => {
    const tiles = Array.from({ length: 9 }, (_, i) => ({ key: `t${i}`, cols: 1 }));
    const packed = packBentoRow(tiles, 4);
    for (const t of packed) expect(t.renderCols).toBeLessThanOrEqual(4);
  });

  it('clamps an over-wide tile to the grid width instead of overflowing it', () => {
    const packed = packBentoRow([{ key: 'wide', cols: 4 }], 2);
    expect(packed[0].renderCols).toBe(2);
  });

  it('a single tile alone in its row always fills the row completely', () => {
    const tiles = [{ key: 'a', cols: 4 }, { key: 'b', cols: 1 }];
    const packed = packBentoRow(tiles, 4);
    expect(packed.find((t) => t.key === 'b')!.renderCols).toBe(4);
  });

  it('total rendered width across the whole grid is always a multiple of width', () => {
    const tiles = [
      { key: 'a', cols: 4 },
      { key: 'b', cols: 2 },
      { key: 'c', cols: 1 },
      { key: 'd', cols: 2 },
      { key: 'e', cols: 1 },
      { key: 'f', cols: 1 },
      { key: 'g', cols: 1 },
    ];
    const packed = packBentoRow(tiles, 4);
    expect(sum(packed) % 4).toBe(0);
  });
});
