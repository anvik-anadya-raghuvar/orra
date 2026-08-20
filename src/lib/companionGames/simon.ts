/**
 * Follow his light.
 *
 * He blinks a colour pattern on the chest LED he already has, and you tap it
 * back. The sequence grows by one each round. No new art at all — the LED has
 * been pulsing since the day he was drawn.
 *
 * The whole sequence is generated at init from the seed rather than one colour
 * at a time, so a round is replayable and a test can assert an exact run.
 */
import { pickFrom, rng } from './index';

export const LIGHTS = ['teal', 'rose', 'stamp', 'sky'] as const;
export type Light = (typeof LIGHTS)[number];

/** Nobody is beating this, but a sequence has to end somewhere. */
export const MAX_ROUNDS = 24;

export interface SimonState {
  /** The full run, generated up front; only the first `round` are in play. */
  sequence: Light[];
  round: number;
  /** What you have tapped back so far this round. */
  input: Light[];
  phase: 'showing' | 'awaiting' | 'lost' | 'won';
}

export function init(seed: number): SimonState {
  const r = rng(seed);
  const sequence = Array.from({ length: MAX_ROUNDS }, () => pickFrom(LIGHTS, r()));
  return { sequence, round: 1, input: [], phase: 'showing' };
}

/** The colours to play back this round. */
export function shown(state: SimonState): Light[] {
  return state.sequence.slice(0, state.round);
}

/** He has finished blinking; your turn. */
export function ready(state: SimonState): SimonState {
  return state.phase === 'showing' ? { ...state, phase: 'awaiting' } : state;
}

export function tap(state: SimonState, light: Light): SimonState {
  if (state.phase !== 'awaiting') return state;

  const index = state.input.length;
  if (state.sequence[index] !== light) return { ...state, phase: 'lost' };

  const input = [...state.input, light];
  if (input.length < state.round) return { ...state, input };

  // Round complete.
  if (state.round >= MAX_ROUNDS) return { ...state, input, phase: 'won' };
  return { ...state, input: [], round: state.round + 1, phase: 'showing' };
}

export function isOver(state: SimonState): boolean {
  return state.phase === 'lost' || state.phase === 'won';
}

/** Rounds survived — the number worth remembering. */
export function score(state: SimonState): number {
  return state.phase === 'lost' ? state.round - 1 : state.round;
}

export function verdict(state: SimonState, robotName: string): string {
  if (state.phase === 'won') return `You beat me. Genuinely.`;
  const n = score(state);
  if (n === 0) return 'Oh dear. Again?';
  if (n < 4) return `${n} rounds. ${robotName} is unimpressed.`;
  if (n < 8) return `${n} rounds — not bad at all.`;
  return `${n} rounds. Are you writing them down?`;
}
