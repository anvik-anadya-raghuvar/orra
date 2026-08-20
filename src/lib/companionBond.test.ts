import { describe, expect, it } from 'vitest';
import {
  award,
  DAILY_CAP,
  emptyBond,
  levelOf,
  levelProgress,
  LEVELS,
  MAX_LEVEL,
  mergeBond,
  runLength,
  seen,
  UNLOCKS,
  unlocksAt,
  XP,
  xpToNext,
  type BondAction,
  type BondState,
} from './companionBond';
import { ACCESSORY_PRIORITY, ACCESSORY_SLOT, resolveOutfit } from './companionWardrobe';
import { baselineFor } from './companionMood';
import type { WorldSignals } from './companionWorld';

const DAY = '2026-08-18';
const YESTERDAY = '2026-08-17';

const bond = (over: Partial<BondState> = {}): BondState => ({ ...emptyBond(), ...over });

/** Apply a list of actions on one day. */
const run = (start: BondState, actions: BondAction[], day = DAY) =>
  actions.reduce((s, a) => award(s, a, day), start);

describe('levels', () => {
  it('starts at nothing and climbs through every threshold', () => {
    expect(levelOf(0)).toBe(0);
    LEVELS.forEach((xp, i) => expect(levelOf(xp)).toBe(i));
    expect(levelOf(LEVELS[MAX_LEVEL] + 10_000)).toBe(MAX_LEVEL);
  });

  it('never goes backwards as xp climbs', () => {
    let prev = 0;
    for (let xp = 0; xp < 4000; xp += 17) {
      const level = levelOf(xp);
      expect(level).toBeGreaterThanOrEqual(prev);
      prev = level;
    }
  });

  it('reports progress through the current level, and none left at the top', () => {
    expect(levelProgress(0)).toBe(0);
    expect(levelProgress(30)).toBeCloseTo(0.5, 5);
    expect(levelProgress(LEVELS[MAX_LEVEL])).toBe(1);
    expect(xpToNext(0)).toBe(60);
    expect(xpToNext(LEVELS[MAX_LEVEL])).toBeNull();
  });
});

describe('earning', () => {
  it('awards what the table says', () => {
    expect(award(emptyBond(), 'game', DAY).xp).toBe(XP.game);
    expect(award(emptyBond(), 'find', DAY).xp).toBe(XP.find);
  });

  it('counts the things worth counting', () => {
    const s = run(emptyBond(), ['poke', 'poke', 'pet', 'game', 'find']);
    expect(s.counts).toEqual({ pokes: 2, pets: 1, games: 1, finds: 1 });
  });

  it('caps poking so an idle afternoon is not a shortcut', () => {
    const s = run(emptyBond(), Array<BondAction>(200).fill('poke'));
    expect(s.today.pokeXp).toBe(DAILY_CAP.poke);
    expect(s.xp).toBe(DAILY_CAP.poke);
  });

  it('caps petting too, but separately', () => {
    const s = run(emptyBond(), [
      ...Array<BondAction>(200).fill('pet'),
      ...Array<BondAction>(200).fill('poke'),
    ]);
    expect(s.today.petXp).toBe(DAILY_CAP.pet);
    expect(s.xp).toBe(DAILY_CAP.pet + DAILY_CAP.poke);
  });

  it('resets the caps on a new day', () => {
    const day1 = run(emptyBond(), Array<BondAction>(50).fill('poke'));
    const day2 = award(day1, 'poke', '2026-08-19');
    expect(day2.today.date).toBe('2026-08-19');
    expect(day2.xp).toBe(DAILY_CAP.poke + XP.poke);
  });

  it('never caps the things you cannot spam', () => {
    const s = run(emptyBond(), ['game', 'game', 'game', 'record', 'together']);
    expect(s.xp).toBe(XP.game * 3 + XP.record + XP.together);
  });

  it('only ever climbs, whatever you throw at it', () => {
    let s = emptyBond();
    let prev = 0;
    const actions: BondAction[] = ['poke', 'pet', 'game', 'record', 'together', 'find'];
    for (let i = 0; i < 300; i++) {
      s = award(s, actions[i % actions.length], DAY);
      expect(s.xp).toBeGreaterThanOrEqual(prev);
      prev = s.xp;
    }
  });
});

describe('showing up', () => {
  it('is worth something once a day and not twice', () => {
    const first = seen(emptyBond(), DAY, YESTERDAY);
    expect(first.xp).toBe(XP.hello);
    expect(seen(first, DAY, YESTERDAY)).toBe(first);
  });

  it('pays a bonus for coming back the next day', () => {
    const day1 = seen(emptyBond(), YESTERDAY, '2026-08-16');
    const day2 = seen(day1, DAY, YESTERDAY);
    expect(day2.xp).toBe(XP.hello * 2 + XP.streak);
  });

  it('pays no bonus after a gap', () => {
    const old = seen(emptyBond(), '2026-08-10', '2026-08-09');
    const now = seen(old, DAY, YESTERDAY);
    expect(now.xp).toBe(XP.hello * 2);
  });

  it('keeps the day list bounded however long you use it', () => {
    let s = emptyBond();
    const d = new Date('2026-01-01T00:00:00');
    for (let i = 0; i < 200; i++) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      s = seen(s, iso, '');
      d.setDate(d.getDate() + 1);
    }
    expect(s.seenDays.length).toBeLessThanOrEqual(30);
  });

  it('counts a run of consecutive days', () => {
    expect(runLength(['2026-08-16', '2026-08-17', '2026-08-18'], '2026-08-18')).toBe(3);
    expect(runLength(['2026-08-14', '2026-08-18'], '2026-08-18')).toBe(1);
  });
});

describe('unlocks', () => {
  it('hands them out at their level and keeps them', () => {
    expect(unlocksAt(0)).toEqual([]);
    expect(unlocksAt(2)).toEqual(['bowtie']);
    expect(unlocksAt(MAX_LEVEL)).toHaveLength(UNLOCKS.length);
  });

  it('materialises on write, so retuning a threshold cannot confiscate one', () => {
    const earned = award(bond({ xp: LEVELS[2] - XP.game }), 'game', DAY);
    expect(earned.unlocked).toContain('bowtie');
    // Even if the level were later recomputed lower, the item is already held.
    expect(mergeBond(earned, bond({ xp: 0 })).unlocked).toContain('bowtie');
  });

  it('is vanity only — never anything the world uses to tell you something', () => {
    const reactive = ['umbrella', 'scarf', 'sunglasses', 'headphones', 'hardhat', 'graduation', 'crown'];
    for (const u of UNLOCKS) expect(reactive).not.toContain(u.id);
  });

  it('always loses a contested slot to the reactive item that shares it', () => {
    for (const u of UNLOCKS) {
      const slot = ACCESSORY_SLOT[u.id];
      const rivals = (Object.keys(ACCESSORY_SLOT) as (keyof typeof ACCESSORY_SLOT)[]).filter(
        (id) => ACCESSORY_SLOT[id] === slot && !UNLOCKS.some((x) => x.id === id),
      );
      for (const rival of rivals) {
        expect(
          ACCESSORY_PRIORITY[rival],
          `${u.id} must not out-dress ${rival}`,
        ).toBeGreaterThan(ACCESSORY_PRIORITY[u.id]);
      }
    }
  });
});

describe('the wardrobe with a bond', () => {
  const CALM: WorldSignals = {
    now: new Date(2026, 7, 18, 12),
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

  it('wears what you have earned when nothing else needs the slot', () => {
    expect(resolveOutfit(CALM, ['bowtie', 'monocle']).neck).toBe('bowtie');
    expect(resolveOutfit(CALM, ['bowtie', 'monocle']).face).toBe('monocle');
  });

  it('gives the slot straight back the moment the world needs it', () => {
    const cold = { ...CALM, cold: true, hot: true };
    const outfit = resolveOutfit(cold, ['bowtie', 'monocle']);
    expect(outfit.neck).toBe('scarf');
    expect(outfit.face).toBe('sunglasses');
  });

  it('changes nothing at all for someone with no bond yet', () => {
    expect(resolveOutfit(CALM, [])).toEqual(resolveOutfit(CALM));
  });
});

describe('the bond meets the mood', () => {
  it('lifts the floor his mood settles back to, and nothing else', () => {
    expect(baselineFor(levelOf(0))).toBe(40);
    expect(baselineFor(levelOf(LEVELS[MAX_LEVEL]))).toBe(40 + MAX_LEVEL * 5);
  });
});

describe('merging', () => {
  const a = run(seen(emptyBond(), DAY, YESTERDAY), ['poke', 'pet', 'game']);
  const b = run(seen(emptyBond(), YESTERDAY, '2026-08-16'), ['find', 'find'], YESTERDAY);

  it('is commutative — order of arrival cannot change the answer', () => {
    expect(mergeBond(a, b)).toEqual(mergeBond(b, a));
  });

  it('is idempotent — a replayed write changes nothing', () => {
    const once = mergeBond(a, b);
    expect(mergeBond(once, once)).toEqual(once);
    expect(mergeBond(once, a)).toEqual(once);
  });

  it('never loses xp to a stale writer arriving late', () => {
    const ahead = bond({ xp: 900 });
    const behind = bond({ xp: 10 });
    expect(mergeBond(behind, ahead).xp).toBe(900);
    expect(mergeBond(ahead, behind).xp).toBe(900);
  });

  it('unions everything that is a set', () => {
    const m = mergeBond(a, b);
    expect(m.seenDays).toContain(DAY);
    expect(m.seenDays).toContain(YESTERDAY);
  });

  it('takes the higher spend when both sides worked on the same day', () => {
    const x = run(emptyBond(), Array<BondAction>(5).fill('poke'));
    const y = run(emptyBond(), Array<BondAction>(12).fill('poke'));
    // A cap cannot be dodged by poking from two places at once.
    expect(mergeBond(x, y).today.pokeXp).toBe(12);
  });

  it('copes with either side being absent', () => {
    expect(mergeBond(null, null)).toEqual(emptyBond());
    expect(mergeBond(a, null)).toEqual(a);
    expect(mergeBond(null, a)).toEqual(a);
  });
});
