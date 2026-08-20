/**
 * The toy half of the companion — pure decisions for poking, petting and
 * forgiveness, kept out of the component so the escalation ladder is testable.
 *
 * A "poke" is a tap that lands within POKE_WINDOW_MS of the previous one.
 * One tap is conversation (the status/tip/quote cycle); a flurry is play, and
 * the robot reacts on a ladder that ends, like all good slapstick, in huff.
 */

export const POKE_WINDOW_MS = 1600;
/** How long the robot stays cross after being poked past its patience. */
export const FORGIVE_MS = 20_000;
/** Press-and-hold this long reads as a pet, not a tap. */
export const PET_HOLD_MS = 600;
/** A single reaction gesture never runs longer than the motion budget allows. */
export const REACTION_MS = 500;

export type PokeLevel = 'tap' | 'giggle' | 'dizzy' | 'grumpy';

/** Streak accounting: consecutive only while taps stay inside the window. */
export function nextStreak(prevCount: number, prevAt: number, now: number): number {
  return now - prevAt <= POKE_WINDOW_MS ? prevCount + 1 : 1;
}

export function pokeLevel(streak: number): PokeLevel {
  if (streak >= 7) return 'grumpy';
  if (streak >= 4) return 'dizzy';
  if (streak >= 2) return 'giggle';
  return 'tap';
}

/** What the robot mutters at each rung. Sparse on purpose — reactions are
 *  mostly physical; words every time would blunt them. */
export const POKE_LINES: Partial<Record<PokeLevel, string[]>> = {
  dizzy: ['Whoa— okay, spinning now.', 'I am a precision instrument, you know.'],
  grumpy: ['😤 Fine. Not talking to you for a bit.', 'Hmph.'],
};

export const PET_LINES = ['♥', 'Ooh. Do continue.', '*contented whirring*'];

/** A fling is a release above this speed — the robot tumbles and lands dizzy. */
export const FLING_SPEED = 900;
