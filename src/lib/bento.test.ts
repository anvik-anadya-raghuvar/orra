import { describe, expect, it } from 'vitest';
import { hasNoHoles, packBentoRow, type PackInput } from './bento';

const area = (tiles: ReturnType<typeof packBentoRow>) =>
  tiles.reduce((n, t) => n + t.renderCols * t.renderRows, 0);

describe('bento packing', () => {
  it('never invents a filler tile — every packed key is a real one', () => {
    const input: PackInput[] = [
      { key: 'a', cols: 2 },
      { key: 'b', cols: 1 },
      { key: 'c', cols: 1 },
    ];
    const packed = packBentoRow(input, 4);
    expect(packed.map((t) => t.key).sort()).toEqual(['a', 'b', 'c']);
  });

  it('closes a row by growing the real tile that ends it', () => {
    const packed = packBentoRow([{ key: 'a', cols: 2 }, { key: 'b', cols: 1 }], 4);
    expect(packed.find((t) => t.key === 'b')!.renderCols).toBe(2);
  });

  it('leaves no hole when a tall tile eats into the row below', () => {
    // the case that used to fail: a 2x2 plus odd singles
    expect(hasNoHoles([{ key: 'a', cols: 2, rows: 2 }, { key: 'b', cols: 1 }, { key: 'c', cols: 1 }], 4)).toBe(true);
  });

  it('hiding a widget gives its neighbour more room, not a gap', () => {
    const withWidget: PackInput[] = [
      { key: 'money', cols: 1 },
      { key: 'song', cols: 1 },
      { key: 'photo', cols: 2 },
    ];
    const withoutWidget: PackInput[] = [
      { key: 'money', cols: 1 },
      { key: 'photo', cols: 2 },
    ];
    const before = packBentoRow(withWidget, 4).find((t) => t.key === 'money')!.renderCols;
    const after = packBentoRow(withoutWidget, 4).find((t) => t.key === 'money')!.renderCols;
    expect(after).toBeGreaterThanOrEqual(before);
    expect(hasNoHoles(withoutWidget, 4)).toBe(true);
  });

  it('stays hole-free across many random layouts, tall tiles included', () => {
    // Property check: the exact tile mix changes as widgets are toggled, so the
    // invariant has to hold for shapes nobody enumerated by hand.
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let n = 1; n <= 40; n++) {
      const tiles: PackInput[] = Array.from({ length: n }, (_, i) => ({
        key: `t${i}`,
        cols: rnd() < 0.4 ? 2 : 1,
        rows: rnd() < 0.25 ? 2 : 1,
      }));
      for (const width of [4, 2]) {
        expect(hasNoHoles(tiles, width)).toBe(true);
      }
    }
  });

  it('a tile never spills past the grid width', () => {
    const packed = packBentoRow(
      [{ key: 'a', cols: 2, rows: 2 }, { key: 'b', cols: 2 }, { key: 'c', cols: 1 }],
      4,
    );
    for (const t of packed) expect(t.col - 1 + t.renderCols).toBeLessThanOrEqual(4);
    expect(area(packed) % 4).toBe(0);
  });
});
