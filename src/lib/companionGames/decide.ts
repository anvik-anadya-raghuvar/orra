/**
 * Let him decide — a coin, a die, or which of the two of you does the thing.
 *
 * Not really a game, and the most useful thing in the drawer. Two people
 * running a company argue about small stuff; handing it to the robot is
 * faster than either of you conceding.
 *
 * The result is fixed at `init` from the seed, and the phases only control
 * when it is revealed. That way the reveal can take as long as it likes
 * without the answer depending on the animation having run.
 */
import { pickFrom, rng } from './index';

export type DecideKind = 'coin' | 'die' | 'who';

export const COIN = ['Heads', 'Tails'] as const;
export const DIE = ['1', '2', '3', '4', '5', '6'] as const;

export interface DecideState {
  kind: DecideKind;
  phase: 'rolling' | 'done';
  /** Settled at init; `phase` only decides whether you may look yet. */
  result: string;
}

export interface DecideNames {
  me: string;
  other: string;
}

export function init(kind: DecideKind, seed: number, names: DecideNames): DecideState {
  const r = rng(seed)();
  const result =
    kind === 'coin'
      ? pickFrom(COIN, r)
      : kind === 'die'
        ? pickFrom(DIE, r)
        : pickFrom([names.me, names.other], r);
  return { kind, phase: 'rolling', result };
}

export function reveal(state: DecideState): DecideState {
  return state.phase === 'done' ? state : { ...state, phase: 'done' };
}

/** What he says when the answer lands. */
export function verdict(state: DecideState): string {
  if (state.phase !== 'done') return '…';
  if (state.kind === 'coin') return `${state.result}.`;
  if (state.kind === 'die') return `A ${state.result}.`;
  return `${state.result} does it. Sorry.`;
}
