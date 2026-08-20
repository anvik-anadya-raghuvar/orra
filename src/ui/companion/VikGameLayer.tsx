/**
 * The games, and their timers.
 *
 * Lazy-loaded in one chunk: none of this is needed to render a robot standing
 * in a corner, and most sessions never open it.
 *
 * Every control here is a real button with a real label. Two of these games are
 * played by tapping something small — a chest LED that is about five pixels
 * across at render size — so the hit target is always an overlay of at least
 * 44px, never the artwork itself.
 */
import { useEffect, useRef, useState } from 'react';
import type { GameId } from '../../lib/companionGames';
import * as decide from '../../lib/companionGames/decide';
import * as simon from '../../lib/companionGames/simon';
import * as blink from '../../lib/companionGames/blinkTap';

export interface GameHost {
  robotName: string;
  otherName: string;
  animate: boolean;
  seed: number;
  setChest: (c: string | null) => void;
  setBlink: (b: boolean) => void;
  say: (text: string) => void;
  finish: (score: number | null, won: boolean) => void;
  quit: () => void;
}

/* ── Let him decide ───────────────────────────────────────────────────── */

function Decide({ host }: { host: GameHost }) {
  const [kind, setKind] = useState<decide.DecideKind | null>(null);
  const [state, setState] = useState<decide.DecideState | null>(null);

  useEffect(() => {
    if (!state || state.phase === 'done') return;
    const t = window.setTimeout(
      () => {
        const done = decide.reveal(state);
        setState(done);
        host.say(decide.verdict(done));
        host.finish(null, false);
      },
      host.animate ? 700 : 0,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (state) {
    return (
      <div className="vik-game" role="status" aria-live="polite">
        <p className="vik-game-line">{decide.verdict(state)}</p>
      </div>
    );
  }

  return (
    <div className="vik-game">
      <p className="vik-game-line">What should he settle?</p>
      <div className="vik-game-row">
        {(
          [
            ['coin', 'Flip a coin'],
            ['die', 'Roll a die'],
            ['who', 'Pick one of us'],
          ] as [decide.DecideKind, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            className="vik-game-btn"
            onClick={() => {
              setKind(k);
              setState(decide.init(k, host.seed + k.length, {
                me: 'You',
                other: host.otherName,
              }));
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <button className="vik-game-quit" onClick={host.quit}>
        Never mind
      </button>
      <span className="sr-only">{kind}</span>
    </div>
  );
}

/* ── Follow his light ─────────────────────────────────────────────────── */

const LIGHT_LABEL: Record<simon.Light, string> = {
  teal: 'Green',
  rose: 'Pink',
  stamp: 'Amber',
  sky: 'Blue',
};

function Simon({ host }: { host: GameHost }) {
  const [state, setState] = useState(() => simon.init(host.seed));
  const timers = useRef<number[]>([]);

  // Play the round back on the chest LED, then hand over.
  useEffect(() => {
    if (state.phase !== 'showing') return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const run = simon.shown(state);
    const step = host.animate ? 620 : 420;
    run.forEach((light, i) => {
      timers.current.push(
        window.setTimeout(() => host.setChest(light), i * step),
        window.setTimeout(() => host.setChest(null), i * step + step * 0.6),
      );
    });
    timers.current.push(
      window.setTimeout(() => setState((s) => simon.ready(s)), run.length * step + 120),
    );
    return () => timers.current.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.round]);

  // The light is his again the moment it stops being the display.
  useEffect(() => {
    if (state.phase !== 'showing') host.setChest(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  // ...and on the way out, however the round ended.
  useEffect(
    () => () => host.setChest(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (!simon.isOver(state)) return;
    host.say(simon.verdict(state, host.robotName));
    host.finish(simon.score(state), state.phase === 'won');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  const awaiting = state.phase === 'awaiting';

  return (
    <div className="vik-game">
      <p className="vik-game-line" role="status" aria-live="polite">
        {awaiting
          ? `Your turn — ${state.round} to go`
          : `Watch. Round ${state.round}.`}
      </p>
      <div className="vik-game-lights">
        {simon.LIGHTS.map((light) => (
          <button
            key={light}
            className={`vik-light ${light}`}
            disabled={!awaiting}
            aria-label={LIGHT_LABEL[light]}
            onClick={() => {
              host.setChest(light);
              window.setTimeout(() => host.setChest(null), 180);
              setState((s) => simon.tap(s, light));
            }}
          />
        ))}
      </div>
      <button className="vik-game-quit" onClick={host.quit}>
        Stop
      </button>
    </div>
  );
}

/* ── Catch him blinking ───────────────────────────────────────────────── */

function BlinkTap({ host }: { host: GameHost }) {
  const [state, setState] = useState(() => blink.init(host.seed));
  const blinkAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (state.phase !== 'waiting') return;
    const t = window.setTimeout(() => {
      blinkAtRef.current = Date.now();
      host.setBlink(true);
      setState((s) => blink.blink(s));
    }, blink.waitFor(state));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.go]);

  // The blink ends whether you caught it or not.
  useEffect(() => {
    if (state.phase !== 'blinking') return;
    const t = window.setTimeout(() => {
      host.setBlink(false);
      blinkAtRef.current = null;
      setState((s) => blink.missed(s));
    }, blink.BLINK_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.go]);

  useEffect(
    () => () => host.setBlink(false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (state.phase !== 'over') return;
    host.setBlink(false);
    host.say(blink.verdict(state));
    host.finish(blink.score(state), blink.hits(state) === blink.GOES);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase]);

  const last = state.results[state.results.length - 1];

  return (
    <div className="vik-game">
      <p className="vik-game-line" role="status" aria-live="polite">
        {`Go ${Math.min(state.go + 1, blink.GOES)} of ${blink.GOES}`}
        {last ? ` — ${last.outcome === 'hit' ? `${last.ms}ms` : last.outcome}` : ''}
      </p>
      <button
        className="vik-game-tap"
        onClick={() => {
          const at = blinkAtRef.current;
          host.setBlink(false);
          blinkAtRef.current = null;
          setState((s) => blink.tap(s, at == null ? null : Date.now() - at));
        }}
      >
        Tap when his eyes shut
      </button>
      <button className="vik-game-quit" onClick={host.quit}>
        Stop
      </button>
    </div>
  );
}

/* ── Hide and seek ────────────────────────────────────────────────────── */

/**
 * The only game whose board is the page itself, so its chrome is just the
 * prompt and a way out. Placing and finding him happens in Companion, which is
 * the thing that owns where he stands.
 */
function Hide({ host, onGiveUp }: { host: GameHost; onGiveUp: () => void }) {
  return (
    <div className="vik-game">
      <p className="vik-game-line" role="status" aria-live="polite">
        He is hiding behind something on this page.
      </p>
      <button className="vik-game-quit" onClick={onGiveUp}>
        I give up
      </button>
    </div>
  );
}

export default function VikGameLayer({
  game,
  host,
  onGiveUp,
}: {
  game: GameId;
  host: GameHost;
  onGiveUp: () => void;
}) {
  if (game === 'decide') return <Decide host={host} />;
  if (game === 'simon') return <Simon host={host} />;
  if (game === 'blink') return <BlinkTap host={host} />;
  return <Hide host={host} onGiveUp={onGiveUp} />;
}
