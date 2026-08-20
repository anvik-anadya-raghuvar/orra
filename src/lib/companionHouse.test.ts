import { describe, expect, it } from 'vitest';
import { houseFor, PLACEMENT, type HouseContext } from './companionHouse';
import { BANDS } from './companionMood';

const ctx = (over: Partial<HouseContext> = {}): HouseContext => ({
  band: 'neutral',
  quiet: false,
  mailWaiting: false,
  animate: true,
  ...over,
});

describe('the house follows the band', () => {
  it('withdraws him to the doorway when he is sulking, but never out of reach', () => {
    const h = houseFor(ctx({ band: 'sulking' }));
    expect(h.door).toBe('ajar');
    expect(h.place).toBe('doorway');
  });

  it('leaves the door ajar while he is merely grumpy', () => {
    expect(houseFor(ctx({ band: 'grumpy' })).door).toBe('ajar');
    expect(houseFor(ctx({ band: 'grumpy' })).place).toBe('beside');
  });

  it('opens up and puts him on the roof when he is delighted', () => {
    const h = houseFor(ctx({ band: 'delighted' }));
    expect(h.door).toBe('open');
    expect(h.place).toBe('roof');
  });

  /**
   * The load-bearing rule of the whole meter. Petting him is the only way out
   * of a sulk, so a sulking robot you cannot reach is a robot you cannot
   * apologise to — and the recovery loop would be a wait timer instead of a
   * relationship. He is never anywhere you cannot put a finger on him.
   */
  it('is always somewhere you can reach him, in every band and at any hour', () => {
    for (const band of BANDS) {
      for (const quiet of [false, true]) {
        const h = houseFor(ctx({ band, quiet }));
        expect(PLACEMENT[h.place], `${band}/${quiet} has nowhere to stand`).toBeDefined();
      }
    }
  });

  it('lights the window in every band he is awake for', () => {
    for (const band of BANDS) expect(houseFor(ctx({ band })).lit).toBe(true);
  });

  it('gives every band somewhere to stand', () => {
    for (const band of BANDS) {
      expect(PLACEMENT[houseFor(ctx({ band })).place]).toBeDefined();
    }
  });
});

describe('bedtime', () => {
  it('puts the light out and shuts the door, whatever mood he is in', () => {
    for (const band of BANDS) {
      const h = houseFor(ctx({ band, quiet: true }));
      expect(h.lit).toBe(false);
      expect(h.door).toBe('shut');
      // Curled up beside the house, not behind the door: the first poke of the
      // morning still has to find him.
      expect(h.place).toBe('beside');
    }
  });

  it('still raises the flag for a note that arrived overnight', () => {
    expect(houseFor(ctx({ quiet: true, mailWaiting: true })).mailbox).toBe(true);
  });
});

describe('reduced motion', () => {
  it('drops the smoke, which is the only part that moves', () => {
    expect(houseFor(ctx({ quiet: true, animate: true })).smoke).toBe(true);
    expect(houseFor(ctx({ quiet: true, animate: false })).smoke).toBe(false);
    // Everything else is a state change, not an animation, so it survives.
    const still = houseFor(ctx({ band: 'sulking', animate: false }));
    expect(still.door).toBe('ajar');
    expect(still.lit).toBe(true);
    expect(still.place).toBe('doorway');
  });
});

describe('the chimney', () => {
  it('only smokes overnight, when the house is shut up', () => {
    for (const band of BANDS) expect(houseFor(ctx({ band })).smoke).toBe(false);
    expect(houseFor(ctx({ quiet: true })).smoke).toBe(true);
  });
});
