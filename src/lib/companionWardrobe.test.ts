import { describe, expect, it } from 'vitest';
import {
  ACCESSORY_PRIORITY,
  ACCESSORY_SLOT,
  isPartyTime,
  resolveOutfit,
  SLOT_ORDER,
  type AccessoryId,
} from './companionWardrobe';
import type { WorldSignals } from './companionWorld';

/** Local-time constructor — the wardrobe reads the reader's own clock. */
const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h, 0, 0);

const CALM: WorldSignals = {
  now: at(2026, 8, 18, 12), // a Tuesday lunchtime, nothing happening
  raining: false,
  snowing: false,
  cold: false,
  hot: false,
  windy: false,
  stuck: false,
  overdue: 0,
  dayCleared: false,
  studyStreak: 0,
  songPlaying: false,
  otherAsleep: false,
  party: false,
};

const world = (over: Partial<WorldSignals>): WorldSignals => ({ ...CALM, ...over });

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

describe('the wardrobe is well formed', () => {
  it('gives every accessory a slot and a priority', () => {
    for (const id of Object.keys(ACCESSORY_SLOT) as AccessoryId[]) {
      expect(SLOT_ORDER).toContain(ACCESSORY_SLOT[id]);
      expect(ACCESSORY_PRIORITY[id]).toBeGreaterThan(0);
    }
  });

  it('is deterministic for the same world', () => {
    const w = world({ raining: true, cold: true });
    expect(resolveOutfit(w)).toEqual(resolveOutfit(w));
  });

  it('never puts two things in one slot, across every combination', () => {
    const flags = ['raining', 'cold', 'hot', 'stuck', 'dayCleared', 'songPlaying'] as const;
    for (let mask = 0; mask < 1 << flags.length; mask++) {
      const over: Partial<WorldSignals> = { studyStreak: mask % 5 };
      flags.forEach((f, i) => ((over as Record<string, unknown>)[f] = Boolean(mask & (1 << i))));
      for (const hour of [8, 12, 16, 20]) {
        const outfit = resolveOutfit(world({ ...over, now: at(2026, 8, 21, hour) }));
        for (const [slot, id] of Object.entries(outfit)) {
          expect(SLOT_ORDER).toContain(slot);
          // The item is in the slot the table says it belongs to.
          expect(ACCESSORY_SLOT[id as AccessoryId]).toBe(slot);
        }
      }
    }
  });
});

describe('what the weather puts on him', () => {
  it('hands him an umbrella when it is actually raining', () => {
    expect(resolveOutfit(world({ raining: true })).hand).toBe('umbrella');
    expect(resolveOutfit(world({ snowing: true })).hand).toBe('umbrella');
    expect(resolveOutfit(world({})).hand).not.toBe('umbrella');
  });

  it('wraps him up when it is cold and shades him when it is hot', () => {
    expect(resolveOutfit(world({ cold: true })).neck).toBe('scarf');
    expect(resolveOutfit(world({ hot: true })).face).toBe('sunglasses');
  });

  it('lets a scarf and an umbrella coexist — different slots, no argument', () => {
    const outfit = resolveOutfit(world({ cold: true, raining: true }));
    expect(outfit).toMatchObject({ neck: 'scarf', hand: 'umbrella' });
  });

  it('drops the drink when he needs the hand for an umbrella', () => {
    const dry = resolveOutfit(world({ now: at(2026, 8, 18, 9) }));
    const wet = resolveOutfit(world({ now: at(2026, 8, 18, 9), raining: true }));
    expect(dry.hand).toBe('chai');
    expect(wet.hand).toBe('umbrella');
  });

  it('pours chai in the morning and espresso in the afternoon', () => {
    expect(resolveOutfit(world({ now: at(2026, 8, 18, 8) })).hand).toBe('chai');
    expect(resolveOutfit(world({ now: at(2026, 8, 18, 16) })).hand).toBe('espresso');
    expect(resolveOutfit(world({ now: at(2026, 8, 18, 13) })).hand).toBeUndefined();
  });
});

describe('what the work puts on him', () => {
  it('crowns a cleared day over everything else on his head', () => {
    const outfit = resolveOutfit(
      world({ dayCleared: true, studyStreak: 9, stuck: true, now: at(2026, 8, 21, 20) }),
    );
    expect(outfit.head).toBe('crown');
  });

  it('gives him a hard hat when something is stuck', () => {
    expect(resolveOutfit(world({ stuck: true })).head).toBe('hardhat');
  });

  it('caps a study streak once it has survived three days', () => {
    expect(resolveOutfit(world({ studyStreak: 2 })).head).toBeUndefined();
    expect(resolveOutfit(world({ studyStreak: 3 })).head).toBe('graduation');
  });

  it('puts headphones on while a song is playing', () => {
    expect(resolveOutfit(world({ songPlaying: true })).head).toBe('headphones');
  });

  it('dresses him in nothing at all on a quiet Tuesday lunchtime', () => {
    expect(resolveOutfit(CALM)).toEqual({});
  });
});
