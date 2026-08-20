import { describe, expect, it } from 'vitest';
import { GAME_IDS, GAMES, isBetter, playableGames, rng, SOLO_IDS } from './index';
import * as decide from './decide';
import * as simon from './simon';
import * as blink from './blinkTap';
import * as hide from './hideSeek';

describe('the registry', () => {
  it('is self-consistent — every entry keyed by its own id', () => {
    for (const id of GAME_IDS) expect(GAMES[id].id).toBe(id);
  });

  it('offers every solo game when motion is allowed and the pointer is fine', () => {
    // SOLO_IDS is what he may offer unprompted — it deliberately excludes
    // anything needing a fine pointer, since an invite has no way to know
    // what device you are on. The menu, which you opened yourself, does not
    // have that problem and may still list it.
    expect(playableGames(false)).toHaveLength(SOLO_IDS.length + 1);
    expect(playableGames(false).map((g) => g.id)).toContain('catch');
  });

  it('hides a game that needs a cursor from a coarse pointer', () => {
    const ids = playableGames(false, false, false).map((g) => g.id);
    expect(ids).not.toContain('catch');
    expect(ids).toHaveLength(SOLO_IDS.length);
  });

  it('only offers a two-player game when there is a second player', () => {
    const alone = playableGames(false).map((g) => g.id);
    const together = playableGames(false, true).map((g) => g.id);
    for (const id of alone) expect(GAMES[id].players).toBe(1);
    expect(together).toHaveLength(GAME_IDS.length);
    expect(together).toContain('rps');
  });

  it('offers only games that genuinely play under reduced motion', () => {
    for (const g of playableGames(true)) expect(g.reducedMotion).toBe('plays');
  });

  it('knows which way each score runs', () => {
    // Rounds survived: more is better. Reaction time: less is.
    expect(isBetter('simon', 9, 6)).toBe(true);
    expect(isBetter('simon', 4, 6)).toBe(false);
    expect(isBetter('blink', 210, 260)).toBe(true);
    expect(isBetter('blink', 310, 260)).toBe(false);
    expect(isBetter('hide', 2.1, undefined)).toBe(true);
  });
});

describe('seeded randomness', () => {
  it('replays exactly, so a round can be debugged', () => {
    const a = Array.from({ length: 8 }, rng(42));
    const b = Array.from({ length: 8 }, rng(42));
    expect(a).toEqual(b);
    expect(Array.from({ length: 8 }, rng(43))).not.toEqual(a);
  });

  it('stays inside the unit interval', () => {
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('let him decide', () => {
  const names = { me: 'Anadya', other: 'Raghuvar' };

  it('settles the answer at init, not at the reveal', () => {
    const s = decide.init('coin', 1, names);
    expect(decide.reveal(s).result).toBe(s.result);
  });

  it('only tells you once it is done', () => {
    const s = decide.init('die', 3, names);
    expect(decide.verdict(s)).toBe('…');
    expect(decide.verdict(decide.reveal(s))).toMatch(/^A [1-6]\.$/);
  });

  it('gives a coin two faces and a die six, across many seeds', () => {
    const coins = new Set<string>();
    const dice = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      coins.add(decide.init('coin', seed, names).result);
      dice.add(decide.init('die', seed, names).result);
    }
    expect([...coins].sort()).toEqual(['Heads', 'Tails']);
    expect([...dice].sort()).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('only ever picks one of the two of you', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect([names.me, names.other]).toContain(decide.init('who', seed, names).result);
    }
  });
});

describe('follow his light', () => {
  const play = (state: simon.SimonState, wrongAt?: number) => {
    let s = state;
    let taps = 0;
    while (!simon.isOver(s)) {
      s = simon.ready(s);
      const want = simon.shown(s);
      for (const light of want) {
        const other = simon.LIGHTS.find((l) => l !== light)!;
        s = simon.tap(s, wrongAt != null && taps === wrongAt ? other : light);
        taps += 1;
        if (simon.isOver(s)) break;
      }
      if (s.round > 6 && wrongAt == null) break; // don't grind to 24 in a test
    }
    return s;
  };

  it('grows the sequence by one each round', () => {
    let s = simon.init(1);
    expect(simon.shown(s)).toHaveLength(1);
    s = simon.ready(s);
    s = simon.tap(s, s.sequence[0]);
    expect(s.round).toBe(2);
    expect(simon.shown(s)).toHaveLength(2);
    expect(s.phase).toBe('showing');
  });

  it('replays the same sequence for the same seed', () => {
    expect(simon.init(9).sequence).toEqual(simon.init(9).sequence);
    expect(simon.init(9).sequence).not.toEqual(simon.init(10).sequence);
  });

  it('ignores taps until he has finished showing you', () => {
    const s = simon.init(2);
    expect(simon.tap(s, s.sequence[0])).toBe(s);
  });

  it('ends the moment you get one wrong', () => {
    const s = simon.init(3);
    const lost = play(s, 0);
    expect(lost.phase).toBe('lost');
    expect(simon.score(lost)).toBe(0);
  });

  it('scores the rounds you actually survived', () => {
    const s = play(simon.init(4));
    expect(s.round).toBeGreaterThan(6);
    expect(simon.score(s)).toBe(s.round);
  });

  it('keeps the round when you are only part way through it', () => {
    let s = simon.ready(simon.init(5));
    s = simon.tap(s, s.sequence[0]); // round 1 complete
    s = simon.ready(s);
    s = simon.tap(s, s.sequence[0]); // first of two
    expect(s.round).toBe(2);
    expect(s.input).toHaveLength(1);
    expect(s.phase).toBe('awaiting');
  });
});

describe('catch him blinking', () => {
  it('runs for exactly five goes', () => {
    let s = blink.init(1);
    for (let i = 0; i < blink.GOES; i++) {
      expect(s.phase).not.toBe('over');
      s = blink.tap(blink.blink(s), 120);
    }
    expect(s.phase).toBe('over');
    expect(s.results).toHaveLength(blink.GOES);
  });

  it('counts a tap inside the blink and rejects one after it', () => {
    const s = blink.blink(blink.init(2));
    expect(blink.tap(s, 100).results[0].outcome).toBe('hit');
    expect(blink.tap(s, blink.BLINK_MS + 1).results[0].outcome).toBe('missed');
  });

  it('punishes mashing — a tap before his eyes shut costs the go', () => {
    const s = blink.init(3);
    const early = blink.tap(s, null);
    expect(early.results[0].outcome).toBe('early');
    expect(early.results[0].ms).toBeNull();
    expect(early.go).toBe(1);
  });

  it('averages only the goes you caught', () => {
    let s = blink.init(4);
    s = blink.tap(blink.blink(s), 200);
    s = blink.tap(blink.blink(s), 300);
    s = blink.tap(s, null); // early, contributes nothing
    expect(blink.hits(s)).toBe(2);
    expect(blink.score(s)).toBe(250);
  });

  it('has no score at all if you caught none — a zero would read as a record', () => {
    let s = blink.init(5);
    for (let i = 0; i < blink.GOES; i++) s = blink.tap(s, null);
    expect(blink.score(s)).toBeNull();
    expect(blink.verdict(s)).toMatch(/Not one/);
  });

  it('lets a blink expire uncaught', () => {
    const s = blink.missed(blink.blink(blink.init(6)));
    expect(s.results[0].outcome).toBe('missed');
    expect(s.phase).toBe('waiting');
  });
});

describe('hide and seek', () => {
  const view = { width: 1200, height: 800, bottomInset: 0 };
  const box = (key: string, p: Partial<hide.Box> = {}): hide.Box => ({
    key,
    top: 200,
    left: 300,
    width: 300,
    height: 200,
    ...p,
  });

  it('rejects anything he could not fit behind', () => {
    expect(hide.isCandidate(box('a', { width: 60 }), view)).toBe(false);
    expect(hide.isCandidate(box('a', { height: 40 }), view)).toBe(false);
    expect(hide.isCandidate(box('a'), view)).toBe(true);
  });

  it('rejects anything with no room to peek above it', () => {
    expect(hide.isCandidate(box('a', { top: 10 }), view)).toBe(false);
  });

  it('rejects anything off the edges or under the tabbar', () => {
    expect(hide.isCandidate(box('a', { left: 4 }), view)).toBe(false);
    expect(hide.isCandidate(box('a', { left: 1000 }), view)).toBe(false);
    expect(hide.isCandidate(box('a', { top: 700 }), view)).toBe(false);
    expect(hide.isCandidate(box('a', { top: 500 }), { ...view, bottomInset: 200 })).toBe(false);
  });

  it('never hides inside an open modal', () => {
    expect(hide.isCandidate(box('a'), view, true)).toBe(false);
  });

  it('picks deterministically and avoids hiding twice in the same place', () => {
    const boxes = [box('a'), box('b', { left: 700 }), box('c', { top: 450 })];
    const first = hide.pickHideTarget(boxes, view, 1);
    expect(first).not.toBeNull();
    for (let seed = 0; seed < 30; seed++) {
      expect(hide.pickHideTarget(boxes, view, seed, first!.key)?.key).not.toBe(first!.key);
    }
  });

  /**
   * The actual bug: on this portal's real pages, tiles sit 16px from the
   * screen edge. The margin used to be 24px, which rejected every real card
   * on the site — hide-and-seek could never find anywhere to hide, ever.
   */
  it('accepts a card at the gutter the app actually uses (16px)', () => {
    const real = box('a', { left: 16, width: 343 }); // measured on Home at 375px wide
    expect(hide.isCandidate(real, { width: 375, height: 812, bottomInset: 49 })).toBe(true);
  });

  it('reuses the only place there is rather than refusing to play', () => {
    const only = [box('a')];
    expect(hide.pickHideTarget(only, view, 3, 'a')?.key).toBe('a');
  });

  it('concedes when the page has nothing to hide behind', () => {
    expect(hide.pickHideTarget([box('tiny', { width: 20, height: 20 })], view, 1)).toBeNull();
    const s = hide.start(null, 0);
    expect(s.phase).toBe('nowhere');
    expect(hide.verdict(s)).toMatch(/ran out of furniture/);
  });

  it('peeks over the top edge, centred on the card', () => {
    const at = hide.peekAt(box('a'), 58, 67);
    expect(at.left).toBe(300 + 150 - 29);
    expect(at.top).toBeLessThan(200);
  });

  it('re-hides once when the page moves, then gives up', () => {
    let s = hide.hidden(hide.start('a', 0));
    s = hide.rehide(s, 'b');
    expect(s.phase).toBe('seeking');
    expect(s.key).toBe('b');
    // A list that keeps re-rendering must not become an unwinnable game.
    s = hide.rehide(s, 'c');
    expect(s.phase).toBe('nowhere');
  });

  it('times the round only once he is actually found', () => {
    let s = hide.hidden(hide.start('a', 1_000));
    expect(hide.score(s)).toBeNull();
    s = hide.found(s, 4_200);
    expect(hide.score(s)).toBe(3.2);
    expect(hide.verdict(s)).toMatch(/3\.2s/);
  });

  it('cannot be found after you have given up', () => {
    const s = hide.giveUp(hide.hidden(hide.start('a', 0)));
    expect(hide.found(s, 500).phase).toBe('gave-up');
  });
});

/* ── Rock paper scissors ──────────────────────────────────────────────── */

import * as rps from './rps';

describe('rock paper scissors', () => {
  it('knows the three rules and nothing else', () => {
    expect(rps.resolve('rock', 'scissors')).toBe('win');
    expect(rps.resolve('paper', 'rock')).toBe('win');
    expect(rps.resolve('scissors', 'paper')).toBe('win');
    expect(rps.resolve('scissors', 'rock')).toBe('lose');
    expect(rps.resolve('rock', 'rock')).toBe('draw');
  });

  /**
   * The property both screens depend on. Nobody referees this game: each side
   * scores locally, so if `resolve` were not exactly mirrored the two of you
   * would end up with different results and no way to tell who was right.
   */
  it('gives the two of you mirrored answers on all nine pairs', () => {
    for (const mine of rps.MOVES) {
      for (const theirs of rps.MOVES) {
        const a = rps.resolve(mine, theirs);
        const b = rps.resolve(theirs, mine);
        if (a === 'draw') expect(b).toBe('draw');
        else expect(b).toBe(a === 'win' ? 'lose' : 'win');
      }
    }
  });

  it('waits for both of you before closing a round', () => {
    let s = rps.init();
    s = rps.play(s, 'rock');
    expect(s.round).toBe(0);
    s = rps.receive(s, 0, 'scissors');
    expect(s.round).toBe(1);
  });

  it('does not let you change your mind once committed', () => {
    let s = rps.play(rps.init(), 'rock');
    s = rps.play(s, 'paper');
    expect(s.rounds[0].mine).toBe('rock');
  });

  it('ignores a move that arrives for the wrong round', () => {
    const s = rps.init();
    expect(rps.receive(s, 9, 'rock')).toBe(s);
    expect(rps.receive(s, -1, 'rock')).toBe(s);
  });

  it('ignores a duplicate of their move for a round', () => {
    let s = rps.receive(rps.init(), 0, 'rock');
    s = rps.receive(s, 0, 'paper');
    expect(s.rounds[0].theirs).toBe('rock');
  });

  it('scores only decided rounds, and draws count for neither', () => {
    let s = rps.init();
    s = rps.receive(rps.play(s, 'rock'), 0, 'scissors'); // win
    s = rps.receive(rps.play(s, 'rock'), 1, 'rock'); // draw
    s = rps.receive(rps.play(s, 'rock'), 2, 'paper'); // lose
    expect(rps.score(s)).toEqual({ mine: 1, theirs: 1 });
    expect(s.phase).toBe('over');
    expect(rps.verdict(s, 'Raghuvar')).toMatch(/draw/i);
  });

  it('ends after three rounds and stops accepting moves', () => {
    let s = rps.init();
    for (let i = 0; i < rps.ROUNDS; i++) s = rps.receive(rps.play(s, 'rock'), i, 'scissors');
    expect(s.phase).toBe('over');
    expect(rps.play(s, 'paper')).toBe(s);
    expect(rps.verdict(s, 'Raghuvar')).toMatch(/You win/);
  });
});

/* ── Catch him ────────────────────────────────────────────────────────── */

import * as catchGame from './catch';

describe('catch him', () => {
  const bounds = { width: 800, height: 600, margin: 30 };

  it('does not move without a pointer', () => {
    const pos = { x: 400, y: 300 };
    expect(catchGame.fleeStep(pos, null, bounds, 0.1)).toEqual(pos);
  });

  it('ignores a pointer that is not close enough to matter', () => {
    const pos = { x: 400, y: 300 };
    const far = { x: 400, y: 300 - catchGame.TRIGGER_RADIUS - 10 };
    expect(catchGame.fleeStep(pos, far, bounds, 0.1)).toEqual(pos);
  });

  it('moves directly away from a close pointer', () => {
    const pos = { x: 400, y: 300 };
    const pointer = { x: 400, y: 320 }; // 20px below
    const next = catchGame.fleeStep(pos, pointer, bounds, 0.05);
    expect(next.y).toBeLessThan(pos.y); // fled upward, away from the pointer
    expect(next.x).toBe(pos.x); // no sideways component when directly below
  });

  it('moves fastest right up close and tapers to nothing at the trigger radius', () => {
    const pos = { x: 400, y: 300 };
    const close = { x: 400, y: 310 };
    const edge = { x: 400, y: 300 + catchGame.TRIGGER_RADIUS };
    const closeStep = Math.abs(catchGame.fleeStep(pos, close, bounds, 0.05).y - pos.y);
    const edgeStep = Math.abs(catchGame.fleeStep(pos, edge, bounds, 0.05).y - pos.y);
    expect(closeStep).toBeGreaterThan(edgeStep);
    expect(edgeStep).toBeCloseTo(0, 1);
  });

  it('never places him outside the margin, however hard he is pressed', () => {
    // Standing right in the corner with the pointer right on top of him.
    const pos = { x: bounds.margin + 1, y: bounds.margin + 1 };
    const pointer = { x: bounds.margin, y: bounds.margin };
    const next = catchGame.fleeStep(pos, pointer, bounds, 0.2);
    expect(next.x).toBeGreaterThanOrEqual(bounds.margin);
    expect(next.y).toBeGreaterThanOrEqual(bounds.margin);
  });

  it('is exactly this clamping that makes cornering the whole mechanic', () => {
    // Pinned into the corner: both axes are already at their clamp, so a
    // pointer bearing down on him produces no further motion at all — which
    // is the moment he becomes catchable.
    const cornered = { x: bounds.margin, y: bounds.margin };
    const pointer = { x: bounds.margin + 5, y: bounds.margin + 5 };
    expect(catchGame.fleeStep(cornered, pointer, bounds, 0.2)).toEqual(cornered);
  });

  it('starts away from every edge', () => {
    const p = catchGame.startPosition(bounds);
    expect(p.x).toBeGreaterThan(bounds.margin);
    expect(p.x).toBeLessThan(bounds.width - bounds.margin);
    expect(p.y).toBeGreaterThan(bounds.margin);
    expect(p.y).toBeLessThan(bounds.height - bounds.margin);
  });

  it('scores the seconds it took, and nothing if he was never caught', () => {
    let s = catchGame.start(1_000);
    s = catchGame.caught(s, 4_300);
    expect(catchGame.score(s)).toBe(3.3);

    const timedOut = catchGame.timeout(catchGame.start(1_000));
    expect(catchGame.score(timedOut)).toBeNull();
    expect(catchGame.verdict(timedOut)).toMatch(/empty-handed/);
  });

  it('cannot be caught twice, and a timeout cannot overwrite a catch', () => {
    let s = catchGame.caught(catchGame.start(0), 500);
    expect(catchGame.caught(s, 900)).toBe(s);
    expect(catchGame.timeout(s)).toBe(s);
  });

  it('writes a verdict that actually reflects how it went', () => {
    expect(catchGame.verdict(catchGame.caught(catchGame.start(0), 1_500))).toMatch(/barely/);
    expect(catchGame.verdict(catchGame.caught(catchGame.start(0), 6_000))).toMatch(/Cornered/);
    expect(catchGame.verdict(catchGame.caught(catchGame.start(0), 15_000))).toMatch(/earned/);
  });
});
