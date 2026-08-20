/**
 * The games, as one table.
 *
 * The menu, the arbiter and the trophy shelf all read this rather than each
 * keeping their own list, because the moment they disagree you get a game
 * offered that cannot be played — a menu entry that does nothing under reduced
 * motion, or a score with nowhere to go.
 *
 * `reducedMotion` is the honest field. A game either genuinely plays with
 * animation switched off, or it is hidden from the menu with a note. Nothing
 * is ever offered in a broken state.
 */

export type GameId = 'decide' | 'simon' | 'blink' | 'hide' | 'rps' | 'catch';

export interface GameSpec {
  id: GameId;
  label: string;
  /** One line in the menu, written for the person choosing. */
  blurb: string;
  players: 1 | 2;
  /**
   * 'plays'  — state changes are instant; the game is unaffected.
   * 'hidden' — needs motion to be playable, so it is not offered at all.
   */
  reducedMotion: 'plays' | 'hidden';
  /** Does it produce a number worth remembering. */
  scored: boolean;
  /** Higher is better for this game's score. */
  higherIsBetter: boolean;
  /**
   * Needs a real cursor to flee from — a touch screen has no "hovering
   * nearby" to react to. Absent means it works anywhere pointer works.
   */
  requiresFinePointer?: boolean;
}

export const GAMES: Record<GameId, GameSpec> = {
  decide: {
    id: 'decide',
    label: 'Let him decide',
    blurb: 'Coin, die, or which of you does it.',
    players: 1,
    reducedMotion: 'plays',
    scored: false,
    higherIsBetter: true,
  },
  simon: {
    id: 'simon',
    label: 'Follow his light',
    blurb: 'He blinks a pattern on his chest. Tap it back.',
    players: 1,
    reducedMotion: 'plays',
    scored: true,
    higherIsBetter: true,
  },
  blink: {
    id: 'blink',
    label: 'Catch him blinking',
    blurb: 'Tap the moment his eyes shut. Five goes.',
    players: 1,
    reducedMotion: 'plays',
    scored: true,
    // A reaction time: lower is better, and the shelf has to know that.
    higherIsBetter: false,
  },
  rps: {
    id: 'rps',
    label: 'Rock paper scissors',
    blurb: 'Best of three, live. Settles arguments.',
    players: 2,
    reducedMotion: 'plays',
    scored: false,
    higherIsBetter: true,
  },
  hide: {
    id: 'hide',
    label: 'Hide and seek',
    blurb: 'He hides behind something on this page. Find him.',
    players: 1,
    reducedMotion: 'plays',
    scored: true,
    higherIsBetter: false,
  },
  catch: {
    id: 'catch',
    label: 'Catch him',
    blurb: "He runs from your cursor. Corner him in 20 seconds.",
    players: 1,
    // The whole game is him fleeing — with animation off it is just a robot
    // standing still, so it is not offered rather than offered broken.
    reducedMotion: 'hidden',
    scored: true,
    higherIsBetter: false,
    requiresFinePointer: true,
  },
};

export const GAME_IDS = Object.keys(GAMES) as GameId[];

/**
 * What the menu should offer right now. A two-player game needs someone on the
 * other end, so it is only listed when there is one.
 */
export function playableGames(
  reduced: boolean,
  otherOnline = false,
  finePointer = true,
): GameSpec[] {
  return GAME_IDS.map((id) => GAMES[id]).filter(
    (g) =>
      (!reduced || g.reducedMotion === 'plays') &&
      (g.players === 1 || otherOnline) &&
      (!g.requiresFinePointer || finePointer),
  );
}

/**
 * Games he may offer unprompted — never one that needs the other person, and
 * never one that needs equipment he cannot assume you have. Offering a chase
 * to someone on their phone is not an invitation, it is a dead end.
 */
export const SOLO_IDS = GAME_IDS.filter(
  (id) => GAMES[id].players === 1 && !GAMES[id].requiresFinePointer,
);

/** Is `next` an improvement on `best` for this game. */
export function isBetter(id: GameId, next: number, best: number | undefined): boolean {
  if (best == null) return true;
  return GAMES[id].higherIsBetter ? next > best : next < best;
}

/* ── Seeded randomness ────────────────────────────────────────────────── */

/**
 * mulberry32. The games have to be deterministic to be testable, and the
 * workflow rule against Math.random in a reproducible context applies just as
 * well here: a game that cannot be replayed cannot be debugged.
 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pickFrom = <T>(items: readonly T[], r: number): T =>
  items[Math.min(items.length - 1, Math.floor(r * items.length))];
