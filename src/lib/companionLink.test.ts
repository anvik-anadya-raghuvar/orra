import { describe, expect, it } from 'vitest';
import {
  arrivalEdge,
  decode,
  encode,
  EDGE_MARGIN,
  isFresh,
  landingPoint,
  messageId,
  NOTE_MAX,
  simultaneous,
  SIMULTANEOUS_MS,
  STALE_MS,
  THROW_SPEED,
  throwVector,
  type Edge,
  type VikMessage,
} from './companionLink';

const T = 1_800_000_000_000;
const VIEW = { width: 1200, height: 800 };
const EDGES: Edge[] = ['left', 'right', 'top', 'bottom'];

const throwMsg = (over: Partial<Extract<VikMessage, { k: 'throw' }>> = {}): VikMessage => ({
  id: 'a',
  from: 'u-anadya',
  at: T,
  k: 'throw',
  edge: 'right',
  frac: 0.5,
  speed: 2000,
  ...over,
});

describe('notes', () => {
  it('caps the length, because there is no server to do it', () => {
    const long = 'x'.repeat(500);
    const out = encode(throwMsg({ note: long }));
    expect((out as { note: string }).note).toHaveLength(NOTE_MAX);
  });

  it('drops a note that was only whitespace', () => {
    expect((encode(throwMsg({ note: '   ' })) as { note?: string }).note).toBeUndefined();
  });

  it('leaves a message with no note alone', () => {
    const m = throwMsg();
    expect(encode(m)).toBe(m);
  });
});

describe('decode', () => {
  it('accepts what we send', () => {
    const m = throwMsg({ note: 'bring milk' });
    expect(decode(JSON.parse(JSON.stringify(m)))).toMatchObject({ k: 'throw', note: 'bring milk' });
    expect(decode({ id: 'p', from: 'u', at: T, k: 'poke' })).toMatchObject({ k: 'poke' });
  });

  it('refuses anything it does not understand', () => {
    expect(decode(null)).toBeNull();
    expect(decode('hello')).toBeNull();
    expect(decode({})).toBeNull();
    expect(decode({ id: 'a', from: 'u', at: T })).toBeNull();
    expect(decode({ id: 'a', from: 'u', at: T, k: 'nonsense' })).toBeNull();
    expect(decode({ id: 'a', from: 'u', at: T, k: 'throw', edge: 'sideways', frac: 0.5 })).toBeNull();
    expect(decode({ id: 'a', from: 'u', at: T, k: 'throw', edge: 'left', frac: 'lots' })).toBeNull();
  });

  it('clamps a position that arrived out of range', () => {
    const out = decode({ id: 'a', from: 'u', at: T, k: 'throw', edge: 'left', frac: 9, speed: 1 });
    expect((out as { frac: number }).frac).toBe(1);
  });

  it('caps a note that arrived over-long rather than trusting it', () => {
    const out = decode({
      id: 'a',
      from: 'u',
      at: T,
      k: 'throw',
      edge: 'left',
      frac: 0.2,
      speed: 1,
      note: 'y'.repeat(999),
    });
    expect((out as { note: string }).note).toHaveLength(NOTE_MAX);
  });
});

describe('freshness', () => {
  it('accepts something that just happened', () => {
    expect(isFresh(throwMsg(), T + 100)).toBe(true);
  });

  it('drops something a backgrounded tab is catching up on', () => {
    expect(isFresh(throwMsg(), T + STALE_MS + 1)).toBe(false);
  });

  it('drops something from a clock that is badly ahead', () => {
    expect(isFresh(throwMsg({}), T - STALE_MS - 1)).toBe(false);
  });
});

describe('the simultaneous poke', () => {
  it('needs both of you inside the window', () => {
    expect(simultaneous(T, T + 500, T + 600)).toBe(true);
    expect(simultaneous(T, T + SIMULTANEOUS_MS + 1, T + SIMULTANEOUS_MS + 1)).toBe(false);
  });

  it('is not a high five if you have not poked at all', () => {
    expect(simultaneous(null, T, T)).toBe(false);
  });

  it('expires — an old poke of yours cannot be redeemed later', () => {
    expect(simultaneous(T, T + 100, T + SIMULTANEOUS_MS + 500)).toBe(false);
  });

  /**
   * The property the whole handshake-free design rests on: both screens run
   * this over the same numbers and must agree, or one of you gets a high five
   * on your own.
   */
  it('gives both sides the same answer from their own point of view', () => {
    for (const gap of [0, 500, 1500, 2999, 3001, 8000]) {
      const mine = T;
      const theirs = T + gap;
      const now = theirs + 50;
      expect(simultaneous(mine, theirs, now)).toBe(simultaneous(theirs, mine, now));
    }
  });
});

describe('edges', () => {
  it('mirrors, so he arrives from the side he flew towards', () => {
    expect(arrivalEdge('right')).toBe('left');
    expect(arrivalEdge('left')).toBe('right');
    expect(arrivalEdge('top')).toBe('bottom');
    expect(arrivalEdge('bottom')).toBe('top');
  });

  it('is its own inverse', () => {
    for (const e of EDGES) expect(arrivalEdge(arrivalEdge(e))).toBe(e);
  });
});

describe('throwing', () => {
  it('needs real speed', () => {
    expect(throwVector({ x: 1190, y: 400, vx: 100, vy: 0 }, VIEW)).toBeNull();
    expect(throwVector({ x: 1190, y: 400, vx: THROW_SPEED + 1, vy: 0 }, VIEW)).not.toBeNull();
  });

  it('needs to be released near the edge it is heading for', () => {
    // Fast, but flung from the middle of the screen: that is a fling, not a post.
    expect(throwVector({ x: 600, y: 400, vx: 3000, vy: 0 }, VIEW)).toBeNull();
    expect(
      throwVector({ x: VIEW.width - EDGE_MARGIN + 10, y: 400, vx: 3000, vy: 0 }, VIEW),
    ).not.toBeNull();
  });

  it('picks the edge from the dominant direction', () => {
    expect(throwVector({ x: 30, y: 400, vx: -3000, vy: 100 }, VIEW)?.edge).toBe('left');
    expect(throwVector({ x: 600, y: 30, vx: 100, vy: -3000 }, VIEW)?.edge).toBe('top');
    expect(throwVector({ x: 600, y: 780, vx: 0, vy: 3000 }, VIEW)?.edge).toBe('bottom');
  });

  it('reports where along the edge he left, as a fraction', () => {
    const v = throwVector({ x: 1190, y: 200, vx: 3000, vy: 0 }, VIEW);
    expect(v?.frac).toBeCloseTo(0.25, 5);
  });

  it('never reports a fraction outside the edge', () => {
    for (const y of [-500, 0, 400, 800, 5000]) {
      const v = throwVector({ x: 1190, y, vx: 3000, vy: 0 }, VIEW);
      if (v) {
        expect(v.frac).toBeGreaterThanOrEqual(0);
        expect(v.frac).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('landing', () => {
  const inset = { top: 60, bottom: 90 };
  const size = { w: 58, h: 67 };

  it('puts him against the edge he arrives from', () => {
    expect(landingPoint('left', 0.5, VIEW, inset, size).left).toBe(8);
    expect(landingPoint('right', 0.5, VIEW, inset, size).left).toBe(VIEW.width - size.w - 8);
  });

  it('never lands him under the tabbar or behind the header', () => {
    for (const edge of EDGES) {
      for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
        const p = landingPoint(edge, frac, VIEW, inset, size);
        expect(p.top).toBeGreaterThanOrEqual(inset.top);
        expect(p.top + size.h).toBeLessThanOrEqual(VIEW.height - inset.bottom);
        expect(p.left).toBeGreaterThanOrEqual(0);
        expect(p.left + size.w).toBeLessThanOrEqual(VIEW.width);
      }
    }
  });

  it('copes with a phone so small the safe rect nearly vanishes', () => {
    const tiny = { width: 320, height: 300 };
    const p = landingPoint('bottom', 0.5, tiny, { top: 200, bottom: 90 }, size);
    expect(Number.isFinite(p.top)).toBe(true);
    expect(Number.isFinite(p.left)).toBe(true);
  });
});

describe('message ids', () => {
  it('differ for different moments and different salts', () => {
    expect(messageId('u', T, 0.1)).not.toBe(messageId('u', T + 1, 0.1));
    expect(messageId('u', T, 0.1)).not.toBe(messageId('u', T, 0.2));
    expect(messageId('u', T, 0.1)).toBe(messageId('u', T, 0.1));
  });
});
