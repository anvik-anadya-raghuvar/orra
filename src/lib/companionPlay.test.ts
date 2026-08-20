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
