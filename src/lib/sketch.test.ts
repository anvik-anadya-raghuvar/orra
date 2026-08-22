import { describe, expect, it } from 'vitest';
import {
  SKETCH_BYTE_BUDGET,
  canAddStroke,
  isSketchData,
  makeSketch,
  quantizeStroke,
  simplifyPoints,
  sketchBytes,
  sketchColorVar,
  sketchIsEmpty,
  strokeHit,
  strokePathD,
  type SketchStroke,
} from './sketch';

const stroke = (points: number[], size = 6, color = 'ink'): SketchStroke => ({
  id: 's1',
  color,
  size,
  points,
});

describe('sketch data', () => {
  it('starts empty at the logical size', () => {
    const data = makeSketch();
    expect(data).toEqual({ v: 1, w: 1600, h: 1200, strokes: [] });
    expect(sketchIsEmpty(data)).toBe(true);
    expect(sketchIsEmpty(null)).toBe(true);
  });

  it('recognises only things it can actually render', () => {
    expect(isSketchData(makeSketch())).toBe(true);
    expect(isSketchData(null)).toBe(false);
    expect(isSketchData({})).toBe(false);
    expect(isSketchData({ strokes: [], w: 1600 })).toBe(false);
  });

  it('resolves colours to theme tokens, never hex', () => {
    expect(sketchColorVar('teal')).toBe('var(--teal)');
    expect(sketchColorVar('ink')).toBe('var(--ink)');
    // An unknown key must not become a broken var() reference.
    expect(sketchColorVar('#ff0000')).toBe('var(--ink)');
    expect(sketchColorVar('chartreuse')).toBe('var(--ink)');
  });
});

describe('strokePathD', () => {
  it('draws a tap as a dot the round cap can paint', () => {
    expect(strokePathD(stroke([10, 20, 0.5]))).toBe('M 10 20 L 10 20');
  });

  it('draws two points as a straight line', () => {
    expect(strokePathD(stroke([0, 0, 0.5, 100, 50, 0.5]))).toBe('M 0 0 L 100 50');
  });

  it('smooths three or more points through the midpoints', () => {
    const d = strokePathD(stroke([0, 0, 0.5, 100, 0, 0.5, 200, 100, 0.5]));
    expect(d).toBe('M 0 0 Q 100 0 150 50 L 200 100');
  });

  it('is deterministic and free of float noise', () => {
    const s = stroke([0.05, 0.05, 0.5, 33.333333, 66.666666, 0.5, 99.999999, 10, 0.5]);
    expect(strokePathD(s)).toBe(strokePathD(s));
    expect(strokePathD(s)).not.toMatch(/\d\.\d\d/);
  });

  it('returns nothing for an empty stroke', () => {
    expect(strokePathD(stroke([]))).toBe('');
  });
});

describe('simplifyPoints', () => {
  it('drops points closer together than epsilon', () => {
    // Ten points one unit apart, thinned at epsilon 5.
    const dense: number[] = [];
    for (let i = 0; i < 10; i += 1) dense.push(i, 0, 0.5);
    const thin = simplifyPoints(dense, 5);
    expect(thin.length).toBeLessThan(dense.length);
    expect(thin.length % 3).toBe(0);
  });

  it('always keeps the first and last point so a stroke never shortens', () => {
    const dense: number[] = [];
    for (let i = 0; i < 30; i += 1) dense.push(i * 0.1, 0, 0.5);
    const thin = simplifyPoints(dense, 5);
    expect(thin.slice(0, 3)).toEqual([0, 0, 0.5]);
    expect(thin.slice(-3)).toEqual(dense.slice(-3));
  });

  it('leaves a stroke alone at epsilon 0 or when it is already short', () => {
    const p = [0, 0, 0.5, 10, 10, 0.5, 20, 20, 0.5];
    expect(simplifyPoints(p, 0)).toEqual(p);
    expect(simplifyPoints([0, 0, 0.5, 1, 1, 0.5], 99)).toEqual([0, 0, 0.5, 1, 1, 0.5]);
  });

  it('keeps points that are genuinely far apart', () => {
    const p = [0, 0, 0.5, 100, 0, 0.5, 200, 0, 0.5, 300, 0, 0.5];
    expect(simplifyPoints(p, 1.5)).toEqual(p);
  });
});

describe('quantizeStroke', () => {
  it('rounds position to one decimal and pressure to two', () => {
    const q = quantizeStroke(stroke([1.26666, 2.34999, 0.512345]));
    expect(q.points).toEqual([1.3, 2.3, 0.51]);
  });

  it('leaves colour and size untouched', () => {
    const q = quantizeStroke(stroke([1.11, 2.22, 0.5], 12, 'rose'));
    expect(q.color).toBe('rose');
    expect(q.size).toBe(12);
  });
});

describe('strokeHit', () => {
  const line = stroke([0, 0, 0.5, 100, 0, 0.5], 6);

  it('hits a point sitting on the line', () => {
    expect(strokeHit(line, 50, 0)).toBe(true);
  });

  it('hits just inside the tolerance and misses just outside', () => {
    // reach = size/2 + tolerance = 3 + 12 = 15
    expect(strokeHit(line, 50, 14)).toBe(true);
    expect(strokeHit(line, 50, 16)).toBe(false);
  });

  it('misses a point well away from the line', () => {
    expect(strokeHit(line, 50, 400)).toBe(false);
    expect(strokeHit(line, 900, 0)).toBe(false);
  });

  it('hits a single-point dot within reach', () => {
    const dot = stroke([50, 50, 0.5], 6);
    expect(strokeHit(dot, 52, 52)).toBe(true);
    expect(strokeHit(dot, 90, 90)).toBe(false);
  });

  it('never hits an empty stroke', () => {
    expect(strokeHit(stroke([]), 0, 0)).toBe(false);
  });

  it('respects a wider nib', () => {
    const fat = stroke([0, 0, 0.5, 100, 0, 0.5], 40);
    // reach = 20 + 12 = 32, so a point the thin line missed now lands.
    expect(strokeHit(fat, 50, 30)).toBe(true);
  });
});

describe('size budget', () => {
  it('measures an empty sketch as tiny', () => {
    expect(sketchBytes(makeSketch())).toBeLessThan(100);
  });

  it('grows with every stroke', () => {
    const empty = makeSketch();
    const one: typeof empty = { ...empty, strokes: [stroke([0, 0, 0.5, 10, 10, 0.5])] };
    expect(sketchBytes(one)).toBeGreaterThan(sketchBytes(empty));
  });

  it('accepts a stroke that fits and refuses one that does not', () => {
    const small = stroke([0, 0, 0.5, 10, 10, 0.5]);
    expect(canAddStroke(makeSketch(), small)).toBe(true);

    const huge: number[] = [];
    for (let i = 0; i < 40_000; i += 1) huge.push(i % 1600, i % 1200, 0.5);
    const fat = stroke(huge);
    expect(sketchBytes({ ...makeSketch(), strokes: [fat] })).toBeGreaterThan(SKETCH_BYTE_BUDGET);
    expect(canAddStroke(makeSketch(), fat)).toBe(false);
  });

  it('survives a JSON round trip unchanged', () => {
    const data = { ...makeSketch(), strokes: [quantizeStroke(stroke([1.23, 4.56, 0.789], 12, 'teal'))] };
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });
});
