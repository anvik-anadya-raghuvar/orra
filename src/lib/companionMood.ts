/**
 * The friendliness meter — how Vik is feeling about you right now.
 *
 * This is deliberately not the bond. They are different clocks and they must
 * not collapse into one number:
 *
 *   mood  minutes to hours, moves both ways, driven by how you are treating
 *         him this session, and it decides what he will actually do
 *   bond  weeks to months, only ever goes up, driven by everything you have
 *         ever done together, and it decides the floor his mood settles to
 *
 * They meet at exactly one point: `baselineFor(bondLevel)`. A well-bonded Vik
 * is harder to upset and recovers faster. That single link is what makes
 * months of kindness mechanically real rather than a badge on a shelf.
 *
 * The meter only falls from things you actually did, and it always heals. It
 * never sinks below its baseline through neglect — being away for a fortnight
 * shows up as a shy face when you come back, not as a punished number. A pet
 * that guilt-trips you for working is a worse pet.
 *
 * Stored as `{ value, at }` and drifted on read, the warmth.ts pattern: no
 * ticking writer, no writes while the tab sits idle.
 */
import type { Gesture, VikPose } from './companionPose';

export type Band = 'sulking' | 'grumpy' | 'neutral' | 'happy' | 'delighted';

export const MIN = 0;
export const MAX = 100;

/** Points recovered (or shed) per hour, drifting toward the baseline. */
export const RECOVER_PER_HOUR = 6;

/** Where a level-0 bond settles, and how much each bond level lifts it. */
export const BASE_FLOOR = 40;
export const BASE_PER_LEVEL = 5;

export function baselineFor(bondLevel = 0): number {
  return Math.min(MAX, BASE_FLOOR + bondLevel * BASE_PER_LEVEL);
}

/* ── What moves it ────────────────────────────────────────────────────── */

export type MoodAction =
  | 'pet'
  | 'game-finished'
  | 'game-won'
  | 'hello'
  | 'day-cleared'
  | 'caught'
  | 'bubble-lived'
  | 'secret'
  | 'poke-dizzy'
  | 'poke-grumpy'
  | 'hard-fling'
  | 'game-abandoned'
  | 'snap-dismiss';

export const DELTAS: Record<MoodAction, number> = {
  pet: 8,
  'game-finished': 6,
  'game-won': 2,
  hello: 5,
  'day-cleared': 10,
  caught: 6,
  'bubble-lived': 1,
  // Ten fast pokes breaks the sulk and he dances. It should heal properly.
  secret: 15,
  'poke-dizzy': -3,
  'poke-grumpy': -10,
  'hard-fling': -4,
  'game-abandoned': -5,
  'snap-dismiss': -1,
};

/**
 * Affection is the lever that fixes things, so it is worth more when he most
 * needs it. Without this a sulk is a pit you have to wait out, which is not a
 * relationship, it is a cooldown timer.
 */
export const SULKING_PET_BONUS = 4;

/**
 * How long before the same action counts again. Continuous petting is one pet;
 * a poke ladder that already fires once per streak needs no extra guard, but a
 * second flurry a moment later should not stack.
 */
export const COOLDOWN_MS: Partial<Record<MoodAction, number>> = {
  pet: 20_000,
  'poke-dizzy': 20_000,
  'poke-grumpy': 30_000,
  'hard-fling': 10_000,
  'bubble-lived': 60_000,
  'snap-dismiss': 60_000,
  secret: 60_000,
  caught: 10_000,
};

export interface MoodState {
  v: 1;
  /** The value as at `at`; drift is applied on read, never by a writer. */
  value: number;
  at: number;
  /** When each action last counted, for the cooldowns above. */
  last: Partial<Record<MoodAction, number>>;
  /** Local ISO day of the last greeting — hello is worth points once a day. */
  helloDay?: string;
}

export function emptyMood(now = Date.now(), bondLevel = 0): MoodState {
  return { v: 1, value: baselineFor(bondLevel), at: now, last: {} };
}

const clamp = (n: number) => Math.max(MIN, Math.min(MAX, n));

/**
 * The meter as it stands right now: the stored value drifted toward the
 * baseline by however long it has been.
 */
export function currentValue(state: MoodState, bondLevel: number, now: number): number {
  const baseline = baselineFor(bondLevel);
  const hours = Math.max(0, (now - state.at) / 3_600_000);
  const drift = RECOVER_PER_HOUR * hours;
  if (state.value < baseline) return clamp(Math.min(baseline, state.value + drift));
  if (state.value > baseline) return clamp(Math.max(baseline, state.value - drift));
  return clamp(state.value);
}

/**
 * Apply an action. Returns the same state object when nothing happened — a
 * cooled-down action is a no-op, not a zero-delta write, so callers can skip
 * persisting on identity.
 */
export function applyDelta(
  state: MoodState,
  action: MoodAction,
  bondLevel: number,
  now: number,
  todayIsoDay?: string,
): MoodState {
  // Hello is worth points once per local day, not once per cooldown.
  if (action === 'hello') {
    if (todayIsoDay && state.helloDay === todayIsoDay) return state;
  } else {
    const cooldown = COOLDOWN_MS[action];
    const last = state.last[action];
    if (cooldown && last != null && now - last < cooldown) return state;
  }

  const value = currentValue(state, bondLevel, now);
  let delta = DELTAS[action];
  if (action === 'pet' && bandOf(value) === 'sulking') delta += SULKING_PET_BONUS;

  return {
    ...state,
    value: clamp(value + delta),
    at: now,
    last: action === 'hello' ? state.last : { ...state.last, [action]: now },
    helloDay: action === 'hello' && todayIsoDay ? todayIsoDay : state.helloDay,
  };
}

/* ── Bands ────────────────────────────────────────────────────────────── */

/** Upper bound of each band, walked in order. */
const BAND_TOPS: [Band, number][] = [
  ['sulking', 15],
  ['grumpy', 35],
  ['neutral', 60],
  ['happy', 85],
  ['delighted', MAX],
];

export function bandOf(value: number): Band {
  for (const [band, top] of BAND_TOPS) if (value < top) return band;
  return 'delighted';
}

export const BANDS: Band[] = BAND_TOPS.map(([b]) => b);

/**
 * Where he stands relative to his house.
 *
 * There is deliberately no "inside". A sulking robot you cannot reach is a
 * robot you cannot apologise to, and petting him is the only way out of a
 * sulk — so the worst he ever does is retreat to the doorway and glower.
 */
export type Place = 'doorway' | 'beside' | 'roaming' | 'roof';

export interface BandBehaviour {
  /** His demeanour when nothing else claims his face. Null = plain idle. */
  pose: VikPose | null;
  /** Will he ever start something himself in this band. */
  invites: boolean;
  /** Which idle antics are unlocked here. */
  antics: Gesture[];
  /** How many fast pokes before he sulks. */
  pokeTolerance: number;
  place: Place;
  /** Shown in his status panel. Written for the person reading it. */
  blurb: string;
}

/**
 * The payoff. The meter gates content, so you can feel where it is without
 * ever being shown a number — a Vik who cartwheels is one you have been kind
 * to, and that is a better unlock than a hat.
 */
export const BAND_BEHAVIOUR: Record<Band, BandBehaviour> = {
  sulking: {
    pose: { expression: 'cross', body: 'stand' },
    invites: false,
    antics: [],
    pokeTolerance: 3,
    place: 'doorway',
    blurb: 'Withdrawn to the doorway. Try being gentle with him.',
  },
  grumpy: {
    pose: { expression: 'cross', body: 'stand' },
    invites: false,
    antics: ['doze'],
    pokeTolerance: 5,
    place: 'beside',
    blurb: 'Hovering by the door, not quite over it.',
  },
  neutral: {
    pose: null,
    invites: true,
    antics: ['stretch', 'tilt', 'doze'],
    pokeTolerance: 7,
    place: 'beside',
    blurb: 'Pottering about near his house.',
  },
  happy: {
    pose: { expression: 'smile', body: 'stand' },
    invites: true,
    antics: ['stretch', 'tilt', 'doze'],
    pokeTolerance: 9,
    place: 'roaming',
    blurb: 'In good spirits and wandering a bit further.',
  },
  delighted: {
    pose: { expression: 'happy', body: 'stand' },
    invites: true,
    // The breakdance stops being a secret and becomes something he just does.
    antics: ['stretch', 'tilt', 'spin', 'doze'],
    pokeTolerance: 12,
    place: 'roof',
    blurb: 'Sitting on the roof, thoroughly pleased with you.',
  },
};

export function behaviourFor(value: number): BandBehaviour {
  return BAND_BEHAVIOUR[bandOf(value)];
}

/** 0..1 across the whole meter — what the window light is set from. */
export function glowFor(value: number): number {
  return clamp(value) / MAX;
}
