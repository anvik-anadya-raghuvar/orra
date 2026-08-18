import { describe, expect, it } from 'vitest';
import {
  MAX_COLS,
  MAX_ROWS,
  arrange,
  clampSpan,
  clearSize,
  isArranged,
  moveKey,
  stepSpan,
  withOrder,
  withSize,
  type BentoInput,
} from './layout';
import type { HomeLayout } from '../../types';

const tile = (key: string, cols = 1, rows = 1): BentoInput => ({ key, cols, rows });
const keys = (ts: BentoInput[]) => ts.map((t) => t.key);

describe('clampSpan', () => {
  it('keeps a legal span untouched', () => {
    expect(clampSpan(2, 2)).toEqual({ cols: 2, rows: 2 });
  });

  it('clamps past the edges of the grid rather than trusting stored data', () => {
    expect(clampSpan(9, 9)).toEqual({ cols: MAX_COLS, rows: MAX_ROWS });
    expect(clampSpan(0, -3)).toEqual({ cols: 1, rows: 1 });
  });

  it('degrades garbage to the smallest tile instead of NaN spans', () => {
    expect(clampSpan(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ cols: 1, rows: 1 });
  });
});

describe('arrange', () => {
  const declared = [tile('a'), tile('b'), tile('c'), tile('d')];

  it('is a no-op without a stored layout', () => {
    expect(keys(arrange(declared))).toEqual(['a', 'b', 'c', 'd']);
    expect(keys(arrange(declared, { order: [], size: {} }))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('applies the stored order', () => {
    const layout: HomeLayout = { order: ['d', 'c', 'b', 'a'], size: {} };
    expect(keys(arrange(declared, layout))).toEqual(['d', 'c', 'b', 'a']);
  });

  it('ignores stored keys for tiles that no longer render', () => {
    const layout: HomeLayout = { order: ['gone', 'c', 'a'], size: {} };
    // b and d are unplaced; they follow whatever placed tile they were declared after.
    expect(keys(arrange([tile('a'), tile('c')], layout))).toEqual(['c', 'a']);
  });

  it('drops a newly shipped widget beside its declared neighbour, not at the bottom', () => {
    // The user arranged a/c/d before "b" existed. b was declared after a.
    const layout: HomeLayout = { order: ['d', 'a', 'c'], size: {} };
    expect(keys(arrange(declared, layout))).toEqual(['d', 'a', 'b', 'c']);
  });

  it('keeps several consecutive new widgets in their declared order', () => {
    const layout: HomeLayout = { order: ['a', 'd'], size: {} };
    expect(keys(arrange(declared, layout))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('places a new widget declared before anything stored at the very front', () => {
    const layout: HomeLayout = { order: ['b', 'c', 'd'], size: {} };
    expect(keys(arrange(declared, layout))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('applies stored spans and clamps them', () => {
    const layout: HomeLayout = { order: [], size: { a: [2, 2], b: [99, 99] } };
    const out = arrange(declared, layout);
    expect(out[0]).toMatchObject({ key: 'a', cols: 2, rows: 2 });
    expect(out[1]).toMatchObject({ key: 'b', cols: MAX_COLS, rows: MAX_ROWS });
    expect(out[2]).toMatchObject({ key: 'c', cols: 1, rows: 1 });
  });

  it('does not mutate the tiles it was handed', () => {
    const input = [tile('a')];
    arrange(input, { order: [], size: { a: [3, 2] } });
    expect(input[0]).toEqual({ key: 'a', cols: 1, rows: 1 });
  });
});

describe('moveKey', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('moves a tile forward into the target position', () => {
    expect(moveKey(order, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves a tile backward into the target position', () => {
    expect(moveKey(order, 'a', 'c')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('is a no-op onto itself or onto something absent', () => {
    expect(moveKey(order, 'a', 'a')).toEqual(order);
    expect(moveKey(order, 'a', 'zz')).toEqual(order);
    expect(moveKey(order, 'zz', 'a')).toEqual(order);
  });

  it('never loses or duplicates a key', () => {
    const out = moveKey(order, 'c', 'a');
    expect([...out].sort()).toEqual([...order].sort());
  });
});

describe('withOrder', () => {
  it('records the visible order when nothing was stored', () => {
    expect(withOrder(null, ['b', 'a']).order).toEqual(['b', 'a']);
  });

  it('keeps a toggled-off widget parked where it was, not appended', () => {
    const stored: HomeLayout = { order: ['a', 'hidden', 'b', 'c'], size: {} };
    // The user hid "hidden", then dragged c to the front.
    const next = withOrder(stored, ['c', 'a', 'b']);
    expect(next.order).toEqual(['c', 'a', 'hidden', 'b']);
    // Toggling it back on restores it between a and b rather than at the end.
    expect(keys(arrange([tile('a'), tile('b'), tile('c'), tile('hidden')], next))).toEqual([
      'c',
      'a',
      'hidden',
      'b',
    ]);
  });

  it('leaves stored spans alone', () => {
    const stored: HomeLayout = { order: ['a'], size: { a: [2, 1] } };
    expect(withOrder(stored, ['a', 'b']).size).toEqual({ a: [2, 1] });
  });
});

describe('withSize / clearSize', () => {
  it('stores a clamped span', () => {
    expect(withSize(null, 'a', { cols: 7, rows: 1 }).size).toEqual({ a: [MAX_COLS, 1] });
  });

  it('replaces only the tile it was given', () => {
    const l = withSize({ order: [], size: { a: [1, 1] } }, 'b', { cols: 2, rows: 2 });
    expect(l.size).toEqual({ a: [1, 1], b: [2, 2] });
  });

  it('clearSize returns the tile to its declared span', () => {
    const l = clearSize({ order: ['a'], size: { a: [2, 2], b: [1, 1] } }, 'a');
    expect(l.size).toEqual({ b: [1, 1] });
    expect(l.order).toEqual(['a']);
    expect(keys(arrange([tile('a', 4, 1)], l))).toEqual(['a']);
    expect(arrange([tile('a', 4, 1)], l)[0].cols).toBe(4);
  });
});

describe('isArranged', () => {
  it('is false for an untouched Home', () => {
    expect(isArranged(null)).toBe(false);
    expect(isArranged({ order: [], size: {} })).toBe(false);
  });

  it('is true once anything has been moved or resized', () => {
    expect(isArranged({ order: ['a'], size: {} })).toBe(true);
    expect(isArranged({ order: [], size: { a: [2, 1] } })).toBe(true);
  });
});

describe('stepSpan', () => {
  it('steps by whole cells and clamps at both ends', () => {
    expect(stepSpan({ cols: 1, rows: 1 }, 1, 0)).toEqual({ cols: 2, rows: 1 });
    expect(stepSpan({ cols: 1, rows: 1 }, -1, -1)).toEqual({ cols: 1, rows: 1 });
    expect(stepSpan({ cols: 4, rows: 3 }, 1, 1)).toEqual({ cols: MAX_COLS, rows: MAX_ROWS });
  });
});
