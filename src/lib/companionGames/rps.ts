/**
 * Rock paper scissors, across two countries.
 *
 * His arms make the shapes. Best of three, and the point of it is settling
 * arguments — which of you writes the update, which of you calls the vendor.
 *
 * Moves go on the wire in the clear. Commit-and-reveal would be correct against
 * an adversary, and there are two co-founders here: the extra round trip costs
 * more than the cheating it prevents. Stated plainly rather than hidden.
 *
 * Both sides score locally once both moves for a round are in. Nobody referees,
 * and because `resolve` is symmetric by construction the two screens cannot
 * disagree.
 */

export type Move = 'rock' | 'paper' | 'scissors';
export const MOVES: Move[] = ['rock', 'paper', 'scissors'];

export const ROUNDS = 3;

/** What each move defeats. One table, so the rules exist in exactly one place. */
const DEFEATS: Record<Move, Move> = {
  rock: 'scissors',
  paper: 'rock',
  scissors: 'paper',
};

export type Outcome = 'win' | 'lose' | 'draw';

export function resolve(mine: Move, theirs: Move): Outcome {
  if (mine === theirs) return 'draw';
  return DEFEATS[mine] === theirs ? 'win' : 'lose';
}

export interface Round {
  mine: Move | null;
  theirs: Move | null;
}

export interface RpsState {
  rounds: Round[];
  /** 0-based index of the round being played. */
  round: number;
  phase: 'playing' | 'over';
}

export function init(): RpsState {
  return {
    rounds: Array.from({ length: ROUNDS }, () => ({ mine: null, theirs: null })),
    round: 0,
    phase: 'playing',
  };
}

function advance(state: RpsState): RpsState {
  const current = state.rounds[state.round];
  // A round only closes once both of you have committed.
  if (!current || current.mine == null || current.theirs == null) return state;
  const round = state.round + 1;
  return round >= ROUNDS
    ? { ...state, round: ROUNDS - 1, phase: 'over' }
    : { ...state, round };
}

export function play(state: RpsState, move: Move): RpsState {
  if (state.phase === 'over') return state;
  const rounds = state.rounds.map((r, i) =>
    i === state.round && r.mine == null ? { ...r, mine: move } : r,
  );
  return advance({ ...state, rounds });
}

/**
 * Their move landed. `round` is carried on the wire so a message that arrives
 * late cannot be applied to the wrong one.
 */
export function receive(state: RpsState, round: number, move: Move): RpsState {
  if (state.phase === 'over') return state;
  if (round < 0 || round >= ROUNDS) return state;
  const rounds = state.rounds.map((r, i) =>
    i === round && r.theirs == null ? { ...r, theirs: move } : r,
  );
  return advance({ ...state, rounds });
}

/** Rounds decided so far. Draws count for neither. */
export function score(state: RpsState): { mine: number; theirs: number } {
  let mine = 0;
  let theirs = 0;
  for (const r of state.rounds) {
    if (r.mine == null || r.theirs == null) continue;
    const out = resolve(r.mine, r.theirs);
    if (out === 'win') mine += 1;
    if (out === 'lose') theirs += 1;
  }
  return { mine, theirs };
}

export function verdict(state: RpsState, otherName: string): string {
  const { mine, theirs } = score(state);
  if (state.phase !== 'over') return `${mine}–${theirs}`;
  if (mine > theirs) return `${mine}–${theirs}. You win. Tell ${otherName}.`;
  if (theirs > mine) return `${mine}–${theirs}. ${otherName} wins. Bad luck.`;
  return `${mine}–${theirs}. A draw. Useless, that.`;
}

/** Which body pose shows a move. Reuses hands he already has. */
export const MOVE_POSE: Record<Move, 'rock' | 'paper' | 'scissors'> = {
  rock: 'rock',
  paper: 'paper',
  scissors: 'scissors',
};
