import { describe, expect, it } from 'vitest';
import {
  applyDelta,
  BAND_BEHAVIOUR,
  BANDS,
  bandOf,
  baselineFor,
  behaviourFor,
  currentValue,
  DELTAS,
  emptyMood,
  glowFor,
  MAX,
  MIN,
  RECOVER_PER_HOUR,
  type MoodAction,
  type MoodState,
} from './companionMood';

const T0 = new Date('2026-08-18T12:00:00.000Z').getTime();
const HOUR = 3_600_000;

const mood = (value: number, at = T0, over: Partial<MoodState> = {}): MoodState => ({
  v: 1,
  value,
  at,
  last: {},
  ...over,
});

/** Apply a list of actions back to back, spaced far enough to clear cooldowns. */
const run = (start: MoodState, actions: MoodAction[], bond = 0) =>
  actions.reduce((s, a, i) => applyDelta(s, a, bond, T0 + (i + 1) * HOUR * 2), start);

describe('bands', () => {
  it('covers the whole range with no gaps and no overlaps', () => {
    for (let v = MIN; v <= MAX; v++) expect(BANDS).toContain(bandOf(v));
  });

  it('puts the boundaries where the design says', () => {
    expect(bandOf(0)).toBe('sulking');
    expect(bandOf(14)).toBe('sulking');
    expect(bandOf(15)).toBe('grumpy');
    expect(bandOf(34)).toBe('grumpy');
    expect(bandOf(35)).toBe('neutral');
    expect(bandOf(59)).toBe('neutral');
    expect(bandOf(60)).toBe('happy');
    expect(bandOf(84)).toBe('happy');
    expect(bandOf(85)).toBe('delighted');
    expect(bandOf(100)).toBe('delighted');
  });

  it('rises monotonically in tolerance and never loses an antic on the way up', () => {
    let prevTolerance = -1;
    let prevAntics = -1;
    for (const band of BANDS) {
      const b = BAND_BEHAVIOUR[band];
      expect(b.pokeTolerance).toBeGreaterThan(prevTolerance);
      expect(b.antics.length).toBeGreaterThanOrEqual(prevAntics);
      prevTolerance = b.pokeTolerance;
      prevAntics = b.antics.length;
    }
  });

  it('never invites you to play while it is cross with you', () => {
    expect(BAND_BEHAVIOUR.sulking.invites).toBe(false);
    expect(BAND_BEHAVIOUR.grumpy.invites).toBe(false);
    expect(BAND_BEHAVIOUR.neutral.invites).toBe(true);
  });

  it('keeps the breakdance for the top band — something you earn by being kind', () => {
    expect(BAND_BEHAVIOUR.delighted.antics).toContain('spin');
    for (const band of BANDS.filter((b) => b !== 'delighted')) {
      expect(BAND_BEHAVIOUR[band].antics).not.toContain('spin');
    }
  });

  it('gives a sulking robot nothing to do at all', () => {
    expect(BAND_BEHAVIOUR.sulking.antics).toHaveLength(0);
  });
});

describe('the baseline is where the bond meets the mood', () => {
  it('lifts with the bond level and nothing else', () => {
    expect(baselineFor(0)).toBe(40);
    expect(baselineFor(7)).toBe(75);
  });

  it('starts a new robot at its baseline, not at zero', () => {
    expect(emptyMood(T0, 0).value).toBe(40);
    expect(bandOf(emptyMood(T0, 0).value)).toBe('neutral');
  });
});

describe('drift', () => {
  it('is computed on read — nothing has to tick', () => {
    const m = mood(10);
    expect(currentValue(m, 0, T0)).toBe(10);
    expect(currentValue(m, 0, T0 + HOUR)).toBe(10 + RECOVER_PER_HOUR);
    // The stored state never changed; only the reading did.
    expect(m.value).toBe(10);
  });

  it('climbs back to the baseline and stops there', () => {
    const m = mood(10);
    expect(currentValue(m, 0, T0 + 100 * HOUR)).toBe(40);
  });

  it('sinks back to the baseline too — delight is meant to be a visit', () => {
    const m = mood(95);
    expect(currentValue(m, 0, T0 + 100 * HOUR)).toBe(40);
    expect(currentValue(m, 0, T0 + HOUR)).toBe(95 - RECOVER_PER_HOUR);
  });

  it('never sinks below the baseline through neglect, however long you leave him', () => {
    for (const years of [1, 5, 50]) {
      expect(currentValue(mood(40), 0, T0 + years * 8760 * HOUR)).toBe(40);
      expect(currentValue(mood(12), 0, T0 + years * 8760 * HOUR)).toBe(40);
    }
  });

  it('recovers to a higher floor for a well-bonded robot', () => {
    expect(currentValue(mood(10), 7, T0 + 100 * HOUR)).toBe(75);
  });

  it('treats a clock that went backwards as no time passing', () => {
    expect(currentValue(mood(10), 0, T0 - 100 * HOUR)).toBe(10);
  });
});

describe('what moves it', () => {
  it('rewards petting and punishes a poke-storm', () => {
    expect(applyDelta(mood(50), 'pet', 0, T0).value).toBe(58);
    expect(applyDelta(mood(50), 'poke-grumpy', 0, T0).value).toBe(40);
  });

  it('pays extra for affection while he is sulking — a sulk is not a timer', () => {
    const sulking = applyDelta(mood(10), 'pet', 0, T0);
    const content = applyDelta(mood(50), 'pet', 0, T0);
    expect(sulking.value - 10).toBeGreaterThan(content.value - 50);
  });

  it('heals properly when you break the sulk with the secret', () => {
    const before = mood(8);
    const after = applyDelta(before, 'secret', 0, T0);
    expect(bandOf(before.value)).toBe('sulking');
    expect(after.value).toBe(8 + DELTAS.secret);
  });

  it('clamps at both ends', () => {
    expect(applyDelta(mood(5), 'poke-grumpy', 0, T0).value).toBe(MIN);
    expect(applyDelta(mood(96), 'pet', 0, T0).value).toBe(MAX);
  });

  it('lets recovery outrun you if you spread the damage out', () => {
    // Two hours between sulks is twelve points of healing. Being unpleasant
    // has to be sustained to land, which is the intended shape.
    const spread = run(mood(30), ['poke-grumpy', 'poke-grumpy', 'poke-grumpy']);
    expect(spread.value).toBeGreaterThan(mood(30).value - 3 * 10);
  });

  it('ignores a repeat inside its cooldown, and returns the same object', () => {
    const first = applyDelta(mood(50), 'pet', 0, T0);
    const again = applyDelta(first, 'pet', 0, T0 + 1_000);
    expect(again).toBe(first);
    const later = applyDelta(first, 'pet', 0, T0 + 60_000);
    expect(later.value).toBeGreaterThan(first.value);
  });

  it('counts a greeting once a day, not once a cooldown', () => {
    const first = applyDelta(mood(50), 'hello', 0, T0, '2026-08-18');
    expect(first.value).toBe(55);
    // Same day, six hours later: nothing, and the same object back.
    expect(applyDelta(first, 'hello', 0, T0 + 6 * HOUR, '2026-08-18')).toBe(first);
    // Next day it counts again, on top of wherever the drift has left him.
    const tomorrow = T0 + 24 * HOUR;
    const next = applyDelta(first, 'hello', 0, tomorrow, '2026-08-19');
    expect(next.value).toBe(currentValue(first, 0, tomorrow) + DELTAS.hello);
    expect(next.helloDay).toBe('2026-08-19');
  });

  it('applies drift before the delta, not after', () => {
    // From 10, an hour of recovery lands him on 16 — which is out of the
    // sulking band, so the affection bonus correctly no longer applies and the
    // pet is worth its plain 8. The bonus reads the drifted value, not the
    // stored one, which is the whole reason this ordering matters.
    const m = mood(10);
    expect(applyDelta(m, 'pet', 0, T0 + HOUR).value).toBe(10 + RECOVER_PER_HOUR + DELTAS.pet);
  });

  it('only ever falls from something you did', () => {
    const harmful = (Object.keys(DELTAS) as MoodAction[]).filter((a) => DELTAS[a] < 0);
    expect(harmful.sort()).toEqual(
      ['game-abandoned', 'hard-fling', 'poke-dizzy', 'poke-grumpy', 'snap-dismiss'].sort(),
    );
  });
});

describe('a round trip you could actually have', () => {
  it('poke him into a sulk, then pet him back out of it', () => {
    let m = mood(50);
    let t = T0;
    // A sustained poke-storm: four sulk-level flurries, each past its cooldown.
    for (let i = 0; i < 4; i++) {
      t += 31_000;
      m = applyDelta(m, 'poke-grumpy', 0, t);
    }
    expect(bandOf(m.value)).toBe('sulking');
    expect(behaviourFor(m.value).antics).toHaveLength(0);
    expect(behaviourFor(m.value).invites).toBe(false);
    expect(behaviourFor(m.value).pokeTolerance).toBe(3);

    // Three patient pets, spaced past the cooldown, and he comes back.
    for (let i = 0; i < 3; i++) {
      t += 25_000;
      m = applyDelta(m, 'pet', 0, t);
    }
    expect(bandOf(m.value)).toBe('neutral');
    expect(behaviourFor(m.value).antics.length).toBeGreaterThan(0);
    expect(behaviourFor(m.value).pokeTolerance).toBe(7);
  });
});

describe('the window light', () => {
  it('runs the whole meter from nothing to full', () => {
    expect(glowFor(0)).toBe(0);
    expect(glowFor(50)).toBe(0.5);
    expect(glowFor(100)).toBe(1);
  });
});
