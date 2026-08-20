import { describe, expect, it } from 'vitest';
import { isPartyTime, resolveOutfit, SLOT_ORDER } from './companionWardrobe';

/** Local-time constructor — the wardrobe reads the reader's own clock. */
const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h, 0, 0);

describe('the Friday hat', () => {
  it('appears on Friday evening and not before', () => {
    expect(isPartyTime(at(2026, 8, 21, 17))).toBe(false); // Friday, 17:00
    expect(isPartyTime(at(2026, 8, 21, 18))).toBe(true); // Friday, 18:00
    expect(isPartyTime(at(2026, 8, 21, 23))).toBe(true);
  });

  it('does not appear on other evenings', () => {
    expect(isPartyTime(at(2026, 8, 20, 20))).toBe(false); // Thursday
    expect(isPartyTime(at(2026, 8, 22, 20))).toBe(false); // Saturday
  });
});

describe('resolveOutfit', () => {
  it('is deterministic for the same world', () => {
    const world = { now: at(2026, 8, 21, 20) };
    expect(resolveOutfit(world)).toEqual(resolveOutfit(world));
  });

  it('never puts two things in one slot', () => {
    for (const h of [0, 6, 12, 18, 22]) {
      for (const d of [17, 18, 19, 20, 21, 22, 23]) {
        const outfit = resolveOutfit({ now: at(2026, 8, d, h) });
        for (const [slot, id] of Object.entries(outfit)) {
          expect(SLOT_ORDER).toContain(slot);
          expect(typeof id).toBe('string');
        }
      }
    }
  });

  it('dresses him in nothing at all on a Tuesday morning', () => {
    expect(resolveOutfit({ now: at(2026, 8, 18, 9) })).toEqual({});
  });

  it('puts the party hat on his head, not anywhere else', () => {
    expect(resolveOutfit({ now: at(2026, 8, 21, 20) })).toEqual({ head: 'party' });
  });
});
