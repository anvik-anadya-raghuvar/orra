/**
 * The bond — how well he knows you.
 *
 * The long clock, against the mood's short one. It only ever climbs, it is
 * never spent, and it does exactly two things:
 *
 *   1. Sets `baselineFor(level)`, the value his mood settles back to. A
 *      well-bonded Vik is harder to upset and recovers faster. This is the
 *      only place the two clocks touch, and it is what makes months of
 *      kindness mechanically real rather than a number on a shelf.
 *   2. Unlocks vanity — a bowtie, a monocle, a cape, a top hat.
 *
 * Vanity *only*. Everything the wardrobe does in response to the real world —
 * an umbrella when it is raining, a hard hat when something is stuck — stays
 * ungated forever. Gating functional behaviour behind a personal counter is
 * the shape principle 2 exists to prevent, and hiding the reactive items
 * behind grind would gut the feature in its first week.
 *
 * Everything here is pure and bounded: `seenDays` is capped, `unlocked` is a
 * short set, and `mergeBond` is commutative and idempotent so two tabs or two
 * devices converge instead of one erasing the other.
 */
import type { AccessoryId } from './companionWardrobe';

export interface BondCounts {
  pokes: number;
  pets: number;
  games: number;
  finds: number;
}

export interface BondState {
  v: 1;
  xp: number;
  /** Local ISO days he has seen you, most recent last. Bounded. */
  seenDays: string[];
  counts: BondCounts;
  /** Per-day grant caps, so a quiet afternoon of poking is not a shortcut. */
  today: { date: string; pokeXp: number; petXp: number };
  /**
   * Materialised on write, never derived from the level. Retuning the
   * thresholds later must not confiscate something already earned.
   */
  unlocked: AccessoryId[];
}

export const SEEN_DAYS_KEPT = 30;

export type BondAction =
  | 'poke'
  | 'pet'
  | 'game'
  | 'record'
  | 'together'
  | 'find'
  | 'hello'
  | 'streak';

export const XP: Record<BondAction, number> = {
  poke: 1,
  pet: 3,
  game: 10,
  record: 15,
  /** Something played with the other person — worth more than playing alone. */
  together: 15,
  find: 12,
  /** First interaction of a local day. */
  hello: 25,
  /** Consecutive-day bonus, per day of the run. */
  streak: 10,
};

/** Daily ceilings on the two things you can do endlessly. */
export const DAILY_CAP = { poke: 20, pet: 15 };
/** The consecutive-day bonus stops compounding here. */
export const STREAK_CAP = 7;

/** Cumulative xp at which each level begins. */
export const LEVELS = [0, 60, 180, 400, 800, 1400, 2200, 3200];
export const MAX_LEVEL = LEVELS.length - 1;

export function levelOf(xp: number): number {
  let level = 0;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i]) level = i;
  return level;
}

/** How far through the current level, 0..1. Full at the top. */
export function levelProgress(xp: number): number {
  const level = levelOf(xp);
  if (level >= MAX_LEVEL) return 1;
  const from = LEVELS[level];
  const to = LEVELS[level + 1];
  return Math.max(0, Math.min(1, (xp - from) / (to - from)));
}

export function xpToNext(xp: number): number | null {
  const level = levelOf(xp);
  return level >= MAX_LEVEL ? null : LEVELS[level + 1] - xp;
}

/* ── Unlocks ──────────────────────────────────────────────────────────── */

/**
 * Vanity, and only vanity. Each sits at a lower priority than anything
 * reactive in the same slot, so a scarf still beats a bowtie when it is cold —
 * you never lose a real signal to a trinket.
 */
export const UNLOCKS: { level: number; id: AccessoryId; label: string }[] = [
  { level: 2, id: 'bowtie', label: 'Bowtie' },
  { level: 3, id: 'monocle', label: 'Monocle' },
  { level: 5, id: 'cape', label: 'Cape' },
  { level: 7, id: 'tophat', label: 'Top hat' },
];

export function unlocksAt(level: number): AccessoryId[] {
  return UNLOCKS.filter((u) => u.level <= level).map((u) => u.id);
}

export function emptyBond(): BondState {
  return {
    v: 1,
    xp: 0,
    seenDays: [],
    counts: { pokes: 0, pets: 0, games: 0, finds: 0 },
    today: { date: '', pokeXp: 0, petXp: 0 },
    unlocked: [],
  };
}

/* ── Earning ──────────────────────────────────────────────────────────── */

const COUNT_FOR: Partial<Record<BondAction, keyof BondCounts>> = {
  poke: 'pokes',
  pet: 'pets',
  game: 'games',
  find: 'finds',
};

function withUnlocks(state: BondState): BondState {
  const earned = unlocksAt(levelOf(state.xp));
  const merged = [...new Set([...state.unlocked, ...earned])];
  return merged.length === state.unlocked.length ? state : { ...state, unlocked: merged };
}

/**
 * Award xp for something that happened. Returns the same object when a cap
 * swallowed it, so callers can skip persisting on identity.
 */
export function award(state: BondState, action: BondAction, todayIsoDay: string): BondState {
  const today =
    state.today.date === todayIsoDay ? state.today : { date: todayIsoDay, pokeXp: 0, petXp: 0 };

  let gain = XP[action];
  let next = { ...state, today };

  if (action === 'poke') {
    const room = DAILY_CAP.poke - today.pokeXp;
    if (room <= 0) return state.today.date === todayIsoDay ? state : next;
    gain = Math.min(gain, room);
    next = { ...next, today: { ...today, pokeXp: today.pokeXp + gain } };
  } else if (action === 'pet') {
    const room = DAILY_CAP.pet - today.petXp;
    if (room <= 0) return state.today.date === todayIsoDay ? state : next;
    gain = Math.min(gain, room);
    next = { ...next, today: { ...today, petXp: today.petXp + gain } };
  }

  const countKey = COUNT_FOR[action];
  if (countKey) {
    next = { ...next, counts: { ...next.counts, [countKey]: next.counts[countKey] + 1 } };
  }

  return withUnlocks({ ...next, xp: next.xp + gain });
}

/**
 * Mark that he saw you today, awarding the greeting and whatever consecutive
 * -day run it continues. Idempotent within a day.
 */
export function seen(state: BondState, todayIsoDay: string, yesterdayIsoDay: string): BondState {
  if (state.seenDays.includes(todayIsoDay)) return state;

  const seenDays = [...state.seenDays, todayIsoDay].slice(-SEEN_DAYS_KEPT);
  let next: BondState = { ...state, seenDays };
  next = award(next, 'hello', todayIsoDay);

  // A run only continues if yesterday is actually in the list.
  if (state.seenDays.includes(yesterdayIsoDay)) {
    const run = Math.min(STREAK_CAP, runLength(seenDays, todayIsoDay));
    next = { ...next, xp: next.xp + XP.streak * (run > 1 ? 1 : 0) };
    next = withUnlocks(next);
  }
  return next;
}

/** How many consecutive days end at `day`, counting back through `days`. */
export function runLength(days: string[], day: string): number {
  const set = new Set(days);
  let run = 0;
  const cursor = new Date(`${day}T00:00:00`);
  for (;;) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(
      cursor.getDate(),
    ).padStart(2, '0')}`;
    if (!set.has(iso)) break;
    run += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return run;
}

/* ── Merging ──────────────────────────────────────────────────────────── */

/**
 * Two records of the same bond, reconciled.
 *
 * Commutative and idempotent by construction: max on everything that counts
 * up, union on everything that is a set. Two tabs, or a laptop and a phone,
 * converge on the same answer whichever order they write in — and nothing
 * already earned can be lost by a stale writer arriving late.
 */
export function mergeBond(a: BondState | null, b: BondState | null): BondState {
  if (!a) return b ? { ...b } : emptyBond();
  if (!b) return { ...a };

  const newerToday = a.today.date >= b.today.date ? a : b;

  return {
    v: 1,
    xp: Math.max(a.xp, b.xp),
    seenDays: [...new Set([...a.seenDays, ...b.seenDays])].sort().slice(-SEEN_DAYS_KEPT),
    counts: {
      pokes: Math.max(a.counts.pokes, b.counts.pokes),
      pets: Math.max(a.counts.pets, b.counts.pets),
      games: Math.max(a.counts.games, b.counts.games),
      finds: Math.max(a.counts.finds, b.counts.finds),
    },
    // Same day on both sides: take the higher spend, so a cap cannot be
    // dodged by writing from two places. Different days: the newer one stands.
    today:
      a.today.date === b.today.date
        ? {
            date: a.today.date,
            pokeXp: Math.max(a.today.pokeXp, b.today.pokeXp),
            petXp: Math.max(a.today.petXp, b.today.petXp),
          }
        : { ...newerToday.today },
    unlocked: [
      ...new Set([...a.unlocked, ...b.unlocked, ...unlocksAt(levelOf(Math.max(a.xp, b.xp)))]),
    ],
  };
}
