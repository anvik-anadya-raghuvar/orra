/**
 * Catch him blinking.
 *
 * He has blinked irregularly since the first version — every 3.8 to 7 seconds,
 * for 130ms. This game does nothing except make that blink worth catching:
 * five goes, tap while his eyes are shut, and your average reaction time is
 * the score.
 *
 * Under reduced motion a blink is an instant eye-state change rather than a
 * 90ms scale, which is still perfectly tappable — so this plays either way.
 */
import { rng } from './index';

export const GOES = 5;
/** How long the eyes stay shut. Matches the sprite's own blink. */
export const BLINK_MS = 320;
/** Waiting range before each blink. Long enough that you cannot pre-empt it. */
export const WAIT_MIN_MS = 1_200;
export const WAIT_SPREAD_MS = 2_600;

export type Outcome = 'hit' | 'early' | 'missed';

export interface BlinkState {
  /** Pre-rolled waits, so a run is replayable. */
  waits: number[];
  go: number;
  results: { outcome: Outcome; ms: number | null }[];
  phase: 'waiting' | 'blinking' | 'over';
}

export function init(seed: number): BlinkState {
  const r = rng(seed);
  const waits = Array.from({ length: GOES }, () => WAIT_MIN_MS + r() * WAIT_SPREAD_MS);
  return { waits, go: 0, results: [], phase: 'waiting' };
}

/** How long to wait before the current blink. */
export function waitFor(state: BlinkState): number {
  return state.waits[state.go] ?? WAIT_MIN_MS;
}

/** His eyes have just shut. */
export function blink(state: BlinkState): BlinkState {
  return state.phase === 'waiting' ? { ...state, phase: 'blinking' } : state;
}

/**
 * You tapped. `sinceBlinkMs` is null if his eyes were still open — tapping
 * early costs you the go, which is what stops mashing being a strategy.
 */
export function tap(state: BlinkState, sinceBlinkMs: number | null): BlinkState {
  if (state.phase === 'over') return state;
  const outcome: Outcome =
    sinceBlinkMs == null ? 'early' : sinceBlinkMs <= BLINK_MS ? 'hit' : 'missed';
  return advance(state, { outcome, ms: outcome === 'hit' ? sinceBlinkMs : null });
}

/** The blink ended and you never tapped. */
export function missed(state: BlinkState): BlinkState {
  if (state.phase !== 'blinking') return state;
  return advance(state, { outcome: 'missed', ms: null });
}

function advance(state: BlinkState, result: BlinkState['results'][number]): BlinkState {
  const results = [...state.results, result];
  const go = state.go + 1;
  return go >= GOES
    ? { ...state, results, go, phase: 'over' }
    : { ...state, results, go, phase: 'waiting' };
}

export function hits(state: BlinkState): number {
  return state.results.filter((r) => r.outcome === 'hit').length;
}

/**
 * Average reaction across the goes you actually caught, rounded to a
 * millisecond. Null if you caught none — there is nothing to average, and
 * recording a zero would look like a world record.
 */
export function score(state: BlinkState): number | null {
  const caught = state.results.filter((r) => r.ms != null).map((r) => r.ms as number);
  if (!caught.length) return null;
  return Math.round(caught.reduce((a, b) => a + b, 0) / caught.length);
}

export function verdict(state: BlinkState): string {
  const n = hits(state);
  const ms = score(state);
  if (n === 0) return 'Not one. I barely moved.';
  if (ms == null) return `${n} of ${GOES}.`;
  if (ms < 220) return `${n}/${GOES} at ${ms}ms. That is suspicious.`;
  if (ms < 350) return `${n}/${GOES}, ${ms}ms average. Sharp.`;
  return `${n}/${GOES}, ${ms}ms average.`;
}
