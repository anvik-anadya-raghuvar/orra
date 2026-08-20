import { describe, expect, it } from 'vitest';
import { nextStreak, pokeLevel, POKE_WINDOW_MS } from './companionPlay';

describe('the poke ladder', () => {
  it('one tap is conversation, not play', () => {
    expect(pokeLevel(1)).toBe('tap');
  });

  it('escalates: giggle, then dizzy, then grumpy', () => {
    expect(pokeLevel(2)).toBe('giggle');
    expect(pokeLevel(3)).toBe('giggle');
    expect(pokeLevel(4)).toBe('dizzy');
    expect(pokeLevel(6)).toBe('dizzy');
    expect(pokeLevel(7)).toBe('grumpy');
    expect(pokeLevel(20)).toBe('grumpy');
  });
});

describe('streak accounting', () => {
  it('taps inside the window chain up', () => {
    expect(nextStreak(1, 1000, 1000 + POKE_WINDOW_MS)).toBe(2);
  });

  it('a pause resets the streak to one', () => {
    expect(nextStreak(5, 1000, 1001 + POKE_WINDOW_MS)).toBe(1);
  });
});

describe('the ladder bends to his mood', () => {
  it('keeps the original 2 / 4 / 7 shape at the default tolerance', () => {
    expect(pokeLevel(1)).toBe('tap');
    expect(pokeLevel(2)).toBe('giggle');
    expect(pokeLevel(4)).toBe('dizzy');
    expect(pokeLevel(7)).toBe('grumpy');
  });

  it('gives a sulking robot a short fuse, and no sense of humour', () => {
    // At tolerance 3 the giggle rung is squeezed out entirely: one tap is
    // still conversation, the second already makes him dizzy, the third is a
    // sulk. A robot who is cross with you does not find it funny.
    expect(pokeLevel(1, 3)).toBe('tap');
    expect(pokeLevel(2, 3)).toBe('dizzy');
    expect(pokeLevel(3, 3)).toBe('grumpy');
  });

  it('lets a delighted robot put up with far more', () => {
    expect(pokeLevel(7, 12)).toBe('dizzy');
    expect(pokeLevel(11, 12)).toBe('dizzy');
    expect(pokeLevel(12, 12)).toBe('grumpy');
  });

  it('keeps the rungs in order at every tolerance a band can produce', () => {
    const order = { tap: 0, giggle: 1, dizzy: 2, grumpy: 3 };
    for (const tolerance of [3, 5, 7, 9, 12]) {
      let prev = -1;
      for (let streak = 1; streak <= tolerance + 2; streak++) {
        const rung = order[pokeLevel(streak, tolerance)];
        expect(rung, `tolerance ${tolerance} went backwards at ${streak}`).toBeGreaterThanOrEqual(prev);
        prev = rung;
      }
      // The top rung is always reachable at exactly the tolerance.
      expect(pokeLevel(tolerance, tolerance)).toBe('grumpy');
    }
  });
});
