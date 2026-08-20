/**
 * Vik, the companion — a robot in the corner with a house, a temperament and
 * opinions about your day. Mounted once in App.tsx beside BlockOverlay; renders
 * nothing while the user's own block runs (never talk over focus) or when
 * switched off in Customise (a preference on profiles.personalization, never a
 * permission).
 *
 * This file is wiring only. Each behaviour lives in its own hook, what he looks
 * like is decided by lib/companionState.ts, how that draws is
 * lib/companionPose.ts, and how he is feeling is lib/companionMood.ts. Nothing
 * below picks a face.
 */
import { AnimatePresence, motion, type TargetAndTransition } from 'framer-motion';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useData, useStore } from '../../data/store';
import { quietHoursFor } from '../../lib/companion';
import { todayIso } from '../../lib/dates';
import { GAMES, type GameId } from '../../lib/companionGames';
import * as catchGame from '../../lib/companionGames/catch';
import * as hideSeek from '../../lib/companionGames/hideSeek';
import * as rps from '../../lib/companionGames/rps';
import {
  canInvite,
  emptyInvites,
  noteInvite,
  pickInvite,
  type InviteMemory,
} from '../../lib/companionInvite';
import { houseFor, PLACEMENT } from '../../lib/companionHouse';
import {
  arrivalEdge,
  landingPoint,
  RETURN_MS,
  TRANSIT_MS,
  throwVector,
} from '../../lib/companionLink';
import { bandOf, glowFor } from '../../lib/companionMood';
import { GESTURE_ANIM, GESTURE_REST, type VikPose } from '../../lib/companionPose';
import { isBusy, isSleeping, poseFor, type VikInputs } from '../../lib/companionState';
import { resolveOutfit } from '../../lib/companionWardrobe';
import { readWorld, restingPose } from '../../lib/companionWorld';
import { spring, useAnimateIn } from '../motion';
import RobotSprite from './RobotSprite';
import VikBubble from './VikBubble';
import { Confetti, Hearts, Zzz } from './VikEffects';
import VikHouse from './VikHouse';
import VikStatus from './VikStatus';
import { useHideTarget } from './useHideTarget';
import { useVikBounds } from './useVikBounds';
import { useVikChase } from './useVikChase';
import { useVikGame } from './useVikGame';
import { useAppPresence } from './useAppPresence';
import { useAppReactions, type Reaction } from './useAppReactions';
import { useBubbleLife } from './useBubbleLife';
import { useCelebrations } from './useCelebrations';
import { useCompanionMoments } from './useCompanionMoments';
import { useCursorFollow } from './useCursorFollow';
import { useIdleAntics } from './useIdleAntics';
import { useVikBond } from './useVikBond';
import { useVikLink, type Arrival } from './useVikLink';
import { useVikGesture } from './useVikGesture';
import { useVikMood } from './useVikMood';
import { useVikPlay } from './useVikPlay';
import { useVikVoice } from './useVikVoice';
import { useWeatherSignal } from './useWeatherSignal';
import './companion.css';
import './companionHouse.css';
import './companionGames.css';

// The games and their timers are never needed to render a robot in a corner.
const VikGameLayer = lazy(() => import('./VikGameLayer'));

/** Money, Admin and People: he shrinks, stops volunteering, and leaves the house behind. */
const DENSE = ['/money', '/admin', '/people'];
const SIZE = { normal: 58, dense: 36 };

/** How he looks while you are busy with something else. */
const REACTION_POSE: Record<string, VikPose | null> = {
  none: null,
  typing: { expression: 'soft', body: 'stand' },
  searching: { expression: 'thinking', body: 'think' },
  dragging: { expression: 'curious', body: 'point' },
};

export default function Companion() {
  const store = useStore();
  const enabled = useData((_, s) => s.me.personalization.companion?.enabled !== false);
  const robotName = useData((_, s) => s.me.personalization.companion?.name?.trim() || 'Vik');
  const color = useData((_, s) => s.me.personalization.companion?.color);
  const follow = useData((_, s) => s.me.personalization.companion?.follow === true);
  const playful = useData((_, s) => s.me.personalization.companion?.playful !== false);
  const myBlockUp = useData((ds, s) => ds.active_blocks.some((b) => b.user_id === s.meId));
  const { pathname } = useLocation();
  const animate = useAnimateIn();

  const dense = DENSE.some((p) => pathname.startsWith(p));
  const presence = useAppPresence(pathname);

  const { current, dismiss, snooze, demand } = useCompanionMoments({
    active: enabled && !myBlockUp,
    route: pathname,
    dense,
    otherOnline: presence.otherOnline,
    otherBlock: presence.otherPayload?.block ?? null,
  });

  // Re-render each minute so quiet hours, the wardrobe and the meter's drift
  // all stay current without anything having to tick faster.
  const [, setMinuteBeat] = useState(0);
  useEffect(() => {
    const iv = window.setInterval(() => setMinuteBeat((n) => n + 1), 60_000);
    return () => clearInterval(iv);
  }, []);
  const now = new Date();
  const quiet = quietHoursFor(store.me.time_zone, now);

  // The two clocks. The bond only ever climbs and does exactly one mechanical
  // thing: it raises the floor his mood settles back to. Everything else it
  // unlocks is a trinket.
  const bond = useVikBond();
  const bondLevel = bond.level;
  const mood = useVikMood(bondLevel);
  const band = bandOf(mood.value);

  // One call site for "something happened to him" — both clocks hear it.
  const moodFeel = mood.feel;
  const bondEarn = bond.earn;
  const feel = useCallback(
    (action: Parameters<typeof moodFeel>[0]) => {
      moodFeel(action);
      bondEarn(action);
    },
    [moodFeel, bondEarn],
  );

  // How the day is going: what he wears, and how he holds himself.
  const weather = useWeatherSignal();
  const world = useData((ds, s) =>
    readWorld({ ds, meId: s.meId, now, weather, otherTimeZone: s.other.time_zone ?? null }),
  );
  const baseOutfit = resolveOutfit(world, bond.unlocked);

  const { quip, say } = useVikVoice();
  const { gesture, doGesture } = useVikGesture();
  const game = useVikGame(feel, bond.record);
  /* ── Asking you to play ─────────────────────────────────────────────── */

  // He is playful by default, which only survives a working day because the
  // gate around it is strict. Every clause lives in lib/companionInvite.ts.
  const invitesRef = useRef<InviteMemory>(emptyInvites());
  const lastTouchRef = useRef(Date.now());
  const [invited, setInvited] = useState<GameId | null>(null);
  // Fixed when a round starts, not on every render — otherwise the machines
  // would be re-seeded underneath themselves and nothing could be replayed.
  const seedRef = useRef(1);

  // Hide and seek plays against the real page, so it needs the real geometry.
  const bounds = useVikBounds();
  const spriteW = dense ? SIZE.dense : SIZE.normal;
  const hideTarget = useHideTarget(bounds, spriteW, (spriteW * 74) / 64);
  const [hideState, setHideState] = useState<hideSeek.HideState | null>(null);
  // Catch him: he flees the cursor across the whole safe area, not just the dock.
  const [catchState, setCatchState] = useState<catchGame.CatchState | null>(null);
  const chase = useVikChase({
    active: game.active === 'catch',
    bounds,
    spriteW,
    spriteH: (spriteW * 74) / 64,
    onTimeoutMs: catchGame.ROUND_MS,
    onTimeout: () =>
      setCatchState((s) => {
        if (!s || s.phase !== 'fleeing') return s;
        const next = catchGame.timeout(s);
        say(catchGame.verdict(next));
        game.finish('catch', null, false);
        return null;
      }),
  });
  const handleCatch = () => {
    setCatchState((s) => {
      if (!s || s.phase !== 'fleeing') return s;
      const next = catchGame.caught(s, Date.now());
      say(catchGame.verdict(next));
      game.finish('catch', catchGame.score(next), true);
      return null;
    });
  };
  /* ── The two of you ─────────────────────────────────────────────────── */

  // He is in the air: hidden here, on his way there.
  const [inFlight, setInFlight] = useState(false);
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [mail, setMail] = useState<Arrival | null>(null);
  // Tag: whoever was hit last is it, until they throw him back.
  const [isIt, setIsIt] = useState(false);
  // Rock paper scissors, live. Null when nobody has asked.
  const [rpsState, setRpsState] = useState<rps.RpsState | null>(null);
  const [rpsAsked, setRpsAsked] = useState(false);
  const otherName = store.other.name;

  /* ── Do not disturb ────────────────────────────────────────────────────
     Drag him onto the Home link and he clocks off — hidden everywhere,
     nothing running — until you next open Home, where he wakes with a line.
     Session-scoped like his drag position: a fresh session starts awake. */
  const restKey = `anvik:vik:resting:${store.meId}`;
  const [resting, setResting] = useState(() => {
    try {
      return sessionStorage.getItem(restKey) === '1';
    } catch {
      return false;
    }
  });
  const setRestingPersisted = (next: boolean) => {
    setResting(next);
    try {
      if (next) sessionStorage.setItem(restKey, '1');
      else sessionStorage.removeItem(restKey);
    } catch {}
  };
  // Woken by landing on Home. A route change covers the common case — you
  // rest him from some other page, then later navigate to Home — but if you
  // dropped him on Home while already there, the route never changes, so a
  // click on the Home link itself is the second, independent way to wake him.
  // React Router does not re-fire on a click to the already-current route.
  useEffect(() => {
    if (resting && pathname === '/') {
      setRestingPersisted(false);
      say(`I'm back. Recharged and ready.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!resting) return;
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest('a[href="/"]');
      if (!el) return;
      setRestingPersisted(false);
      say(`I'm back. Recharged and ready.`);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resting]);

  const link = useVikLink({
    // Asleep or heads-down: he waits in the mailbox rather than tumbling in
    // at three in the morning.
    reachable: () => !quiet && !myBlockUp && !resting && document.visibilityState === 'visible',
    onArrive: (a) => {
      setArrival(a);
      dismiss();
      if (a.tag) setIsIt(true);
      say(
        a.note
          ? `${otherName}: “${a.note}”`
          : a.tag
            ? `Tag — you're it.`
            : `${otherName} threw me at you.`,
      );
      feel('caught');
    },
    onMail: (a) => setMail(a),
    onHighFive: () => {
      doGesture('spin');
      say('✋ Snap.');
      feel('secret');
    },
    onGreeted: (speak) => {
      doGesture('tilt');
      if (speak) say(`${otherName} says hi 👋`);
    },
    onRpsInvite: () => {
      setRpsAsked(true);
      say(`${otherName} wants rock paper scissors.`);
    },
    onRpsDecline: () => {
      setRpsState(null);
      setRpsAsked(false);
      say(`${otherName} passed.`);
    },
    onRpsMove: (round, move) => setRpsState((s) => (s ? rps.receive(s, round, move) : s)),
  });

  // Landing puts him where he came in, then he walks back to his dock.
  useEffect(() => {
    if (!arrival) return;
    const t = window.setTimeout(() => setArrival(null), 2_600);
    return () => clearTimeout(t);
  }, [arrival]);

  const play = useVikPlay({
    quiet,
    animate,
    hasMoment: current != null,
    tolerance: mood.behaviour.pokeTolerance,
    dismiss,
    demand,
    doGesture,
    say,
    feel,
    // Not the poke — the hold. See useVikPlay's onGreet doc.
    onGreet: () => link.sayHi(),
    onThrow: (release, view) => {
      const vector = throwVector(release, view);
      if (!vector) return false;
      // Throwing him back is how you stop being it.
      link.throwHim(vector.edge, vector.frac, vector.speed, undefined, isIt);
      if (isIt) setIsIt(false);
      setInFlight(true);
      // Fire and forget: he always comes back, whether or not anyone caught
      // him. A robot permanently lost to a dropped packet is the one failure
      // that would make this feel broken rather than whimsical.
      window.setTimeout(() => {
        setInFlight(false);
        say(`…nobody was home.`);
      }, RETURN_MS);
      return true;
    },
    onHomeDrop: (x, y) => {
      // The Home link renders twice — a desktop side rail and a mobile
      // tabbar — and only one of the two is ever actually visible. A
      // display:none copy has a zero-size rect, so it never wins the hit
      // test; no need to filter for visibility explicitly.
      const links = document.querySelectorAll<HTMLElement>('a[href="/"]');
      const pad = 10;
      for (const el of links) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) {
          setRestingPersisted(true);
          return true;
        }
      }
      return false;
    },
  });
  const celebration = useCelebrations(store, say);

  // Clearing every intention of the day is worth something to him too.
  const clearedRef = useRef(world.dayCleared);
  useEffect(() => {
    if (world.dayCleared && !clearedRef.current) feel('day-cleared');
    clearedRef.current = world.dayCleared;
  }, [world.dayCleared, feel]);

  const boundsRef = useRef<HTMLDivElement>(null);
  useCursorFollow({
    enabled: follow && animate && !dense && game.active == null,
    boundsRef,
    x: play.x,
    y: play.y,
    dragging: play.isDragging,
  });

  // Read at fire time, not at schedule time — see useIdleAntics. The pool is
  // whatever this band has unlocked, so a sulking robot simply has nothing.
  const busyRef = useRef(false);
  const anticsRef = useRef(mood.behaviour.antics);
  anticsRef.current = playful && !resting ? mood.behaviour.antics : [];
  useIdleAntics({ antics: () => anticsRef.current, doGesture, busy: () => busyRef.current });

  // What you are doing elsewhere in the portal. Small on purpose: a companion
  // that reacts to everything is a distraction, not a companion.
  const [reaction, setReaction] = useState<Reaction>(null);
  useAppReactions({
    enabled: !dense && !quiet && playful && !resting,
    doGesture,
    busy: () => busyRef.current,
    onReaction: setReaction,
  });

  // One check a minute is plenty for something that happens twice a day.
  useEffect(() => {
    const iv = window.setInterval(() => {
      if (invited || game.active || resting) return;
      const ctx = {
        now: Date.now(),
        today: todayIso(),
        chattiness: store.me.personalization.companion?.chattiness ?? 'normal',
        band,
        memory: invitesRef.current,
        playful,
        dense,
        quiet,
        busy: busyRef.current,
        blocked: myBlockUp,
        idleMs: Date.now() - lastTouchRef.current,
        disabled: store.me.personalization.companion?.games,
        animate,
      };
      if (!canInvite(ctx)) return;
      const pick = pickInvite(ctx);
      if (!pick) return;
      invitesRef.current = noteInvite(invitesRef.current, ctx.today, ctx.now);
      setInvited(pick);
    }, 60_000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [band, playful, dense, quiet, myBlockUp, animate, invited, game.active]);

  const bubbleText = quip ?? current?.text ?? null;
  const { hoverProps } = useBubbleLife({ ttlMs: current?.ttlMs ?? null, onExpire: dismiss });

  const endHide = useCallback(
    (found: boolean) => {
      setHideState((h) => {
        if (!h) return null;
        const next = found ? hideSeek.found(h, Date.now()) : hideSeek.giveUp(h);
        say(hideSeek.verdict(next));
        game.finish('hide', hideSeek.score(next), found);
        return null;
      });
      hideTarget.clear();
    },
    [game, hideTarget, say],
  );

  const startGame = useCallback(
    (id: GameId) => {
      setStatusOpen(false);
      dismiss();
      if (id === 'rps') {
        // Not something you can start on your own: it is an ask.
        link.inviteRps();
        setRpsState(rps.init());
        say(`Asked ${otherName}.`);
        return;
      }
      seedRef.current = Date.now() % 100000;
      if (id === 'hide') {
        const key = hideTarget.choose(Date.now() % 9973);
        const started = hideSeek.hidden(hideSeek.start(key, Date.now()));
        setHideState(started);
        if (!key) {
          say(hideSeek.verdict(started));
          return;
        }
      }
      if (id === 'catch') setCatchState(catchGame.start(Date.now()));
      game.start(id);
    },
    [dismiss, game, hideTarget, say],
  );

  // His hiding place scrolled away or was re-rendered out from under him.
  const seeking = hideState?.phase === 'seeking';
  useEffect(() => {
    if (!seeking || hideTarget.spot) return;
    setHideState((h) => {
      if (!h) return h;
      const next = hideSeek.rehide(h, hideTarget.choose(Date.now() % 7919, h.key ?? undefined));
      if (next.phase === 'nowhere') {
        say(hideSeek.verdict(next));
        game.finish('hide', null, false);
        return null;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeking, hideTarget.spot]);

  // Leaving the room abandons whatever was running — he does not follow you.
  useEffect(() => {
    if (!game.active) return;
    game.abandon();
    setHideState(null);
    hideTarget.clear();
    setCatchState(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const [statusOpen, setStatusOpen] = useState(false);

  // Tag is live game state rather than weather or a reward, so it is layered
  // on last and outranks everything in its slot.
  const outfit = isIt ? resolveOutfit(world, bond.unlocked, ['tagmark']) : baseOutfit;

  const inputs: VikInputs = {
    playMood: play.playMood,
    petting: play.petting,
    dragging: play.isDragging(),
    celebrating: celebration != null,
    dozing: gesture === 'doze',
    momentMood: current?.mood ?? null,
    worldPose: restingPose(world),
    reactionPose: REACTION_POSE[reaction ?? 'none'] ?? null,
    bandPose: mood.behaviour.pose,
    speaking: bubbleText != null,
    quiet,
    dense,
  };
  // A running game holds the floor: no antics over the top of it, and no
  // cursor chase either — two rAF loops on one sprite fight each other.
  busyRef.current = isBusy(inputs) || game.active != null;

  if (!enabled || myBlockUp || resting) return null;

  // Dense rooms keep the old bare corner: no house, so no placement either.
  const house = houseFor({ band, quiet, mailWaiting: mail != null, animate });
  // Dense rooms keep the bare corner: no house to stand beside, so no offset.
  const spot = dense ? { left: 0, lift: 0 } : PLACEMENT[house.place];
  // Hiding puts him against a card instead of the dock, clipped to his top half.
  const peek = hideState?.phase === 'seeking' ? hideTarget.spot : null;
  // An arrival puts him wherever he came in, clamped inside the safe rect.
  const landed = arrival
    ? landingPoint(
        arrivalEdge(arrival.edge),
        arrival.frac,
        { width: bounds.width, height: bounds.height },
        { top: bounds.topInset, bottom: bounds.bottomInset },
        { w: spriteW, h: (spriteW * 74) / 64 },
      )
    : null;
  const placed = peek ?? landed;
  // He is fleeing across the whole safe area, tracked frame by frame.
  const chasing = game.active === 'catch';

  const sleeping = isSleeping(inputs);
  // GESTURE_ANIM is a framer-free structural type by design (lib stays testable
  // without a renderer); this is the one place it meets a motion component.
  const moving = (
    animate && gesture && gesture !== 'doze' ? GESTURE_ANIM[gesture] : GESTURE_REST
  ) as TargetAndTransition;
  // A quip borrows the bubble but owns none of its controls.
  const spoken = quip ? null : current;
  const snoozable =
    spoken != null && spoken.kind !== 'status-check' && !spoken.id.startsWith('ondemand:');

  return (
    <div
      className={`companion${dense ? ' dense' : ''}`}
      ref={boundsRef}
      // His own accent colour, picked in Customise. Unset falls back to the
      // theme's --indigo inside companion.css, so this is a no-op by default.
      style={color ? ({ '--vik-accent': `var(--${color})` } as React.CSSProperties) : undefined}
    >
      {!dense && (
        <VikHouse
          state={house}
          band={band}
          glow={glowFor(mood.value)}
          robotName={robotName}
          animate={animate}
          onOpen={() => {
            if (mail) {
              // Whatever arrived while you were unreachable, delivered now.
              say(mail.note ? `${otherName}: “${mail.note}”` : `${otherName} threw me at you.`);
              feel('caught');
              setMail(null);
              return;
            }
            setStatusOpen(true);
          }}
        />
      )}

      <motion.div
        className={`vik-wrap${peek ? ' peeking' : ''}${landed ? ' landed' : ''}${chasing ? ' chasing' : ''}`}
        drag={!placed && !chasing}
        dragMomentum={false}
        dragElastic={0.12}
        dragConstraints={boundsRef}
        // Offsets on the dock, never absolute positions — see companion.css.
        // The cast is only to admit the two custom properties alongside the
        // motion values, which framer's style type does not model.
        style={
          (chasing
            ? { x: 0, y: 0, left: chase.left, top: chase.top }
            : placed
              ? { x: 0, y: 0, left: placed.left, top: placed.top }
              : {
                  x: play.x,
                  y: play.y,
                  '--vik-place-left': `${spot.left}px`,
                  '--vik-place-lift': `${spot.lift}px`,
                }) as unknown as React.ComponentProps<typeof motion.div>['style']
        }
        animate={{ opacity: inFlight ? 0 : 1, scale: inFlight ? 0.4 : 1 }}
        transition={animate ? { duration: 0.22 } : { duration: 0 }}
        onDragStart={play.onDragStart}
        onDragEnd={play.onDragEnd}
      >
        <AnimatePresence>
          {game.active && (
            <Suspense fallback={null}>
              <VikGameLayer
                game={game.active}
                onGiveUp={() => endHide(false)}
                host={{
                  robotName,
                  otherName: store.other.name,
                  animate,
                  seed: seedRef.current,
                  chaseStartedAt: catchState?.startedAt,
                  setChest: game.setChest,
                  setBlink: game.setBlink,
                  say,
                  finish: (score, won) => game.finish(game.active!, score, won),
                  quit: () => {
                    if (game.active === 'hide') endHide(false);
                    else if (game.active === 'catch') {
                      setCatchState(null);
                      game.abandon();
                    } else game.abandon();
                  },
                }}
              />
            </Suspense>
          )}
        </AnimatePresence>

        {/* An offer, and the two ways out of it. */}
        {invited && !game.active && (
          <div className="vik-game" role="status" aria-live="polite">
            <p className="vik-game-line">{GAMES[invited].label}?</p>
            <div className="vik-game-row">
              <button
                className="vik-game-btn"
                onClick={() => {
                  const id = invited;
                  setInvited(null);
                  startGame(id);
                }}
              >
                Go on then
              </button>
            </div>
            <button className="vik-game-quit" onClick={() => setInvited(null)}>
              Not now
            </button>
          </div>
        )}

        {/* Rock paper scissors, live. */}
        {(rpsAsked || rpsState) && !game.active && (
          <div className="vik-game" role="status" aria-live="polite">
            {rpsState ? (
              <>
                <p className="vik-game-line">
                  {rpsState.phase === 'over'
                    ? rps.verdict(rpsState, otherName)
                    : rpsState.rounds[rpsState.round]?.mine
                      ? `Waiting for ${otherName}…`
                      : `Round ${rpsState.round + 1} of ${rps.ROUNDS}`}
                </p>
                {rpsState.phase === 'over' ? (
                  <button className="vik-game-quit" onClick={() => setRpsState(null)}>
                    Done
                  </button>
                ) : (
                  <div className="vik-game-row">
                    {rps.MOVES.map((m) => (
                      <button
                        key={m}
                        className="vik-game-btn"
                        disabled={Boolean(rpsState.rounds[rpsState.round]?.mine)}
                        onClick={() => {
                          link.sendMove(rpsState.round, m);
                          setRpsState((st) => (st ? rps.play(st, m) : st));
                        }}
                      >
                        {m[0].toUpperCase() + m.slice(1)}
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="vik-game-line">{otherName} wants rock paper scissors.</p>
                <div className="vik-game-row">
                  <button
                    className="vik-game-btn"
                    onClick={() => {
                      setRpsAsked(false);
                      setRpsState(rps.init());
                    }}
                  >
                    Play
                  </button>
                </div>
                <button
                  className="vik-game-quit"
                  onClick={() => {
                    setRpsAsked(false);
                    link.declineRps();
                  }}
                >
                  Pass
                </button>
              </>
            )}
          </div>
        )}

        <VikBubble
          text={game.active || invited || rpsAsked || rpsState ? null : bubbleText}
          moment={spoken}
          snoozable={snoozable}
          robotName={robotName}
          animate={animate}
          dismiss={dismiss}
          snooze={snooze}
          hoverProps={hoverProps}
        />

        <motion.button
          className="vik-btn"
          aria-label={
            chasing
              ? `Catch ${robotName}!`
              : peek
                ? `Found ${robotName}!`
                : `${robotName}, your companion — tap for what's happening`
          }
          initial={animate ? { scale: 0, y: 24 } : false}
          animate={
            celebration && animate
              ? {
                  scale: 1,
                  y: [0, celebration.big ? -18 : -12, 0, -7, 0],
                  transition: { duration: 0.55 },
                }
              : { scale: 1, y: 0, transition: spring }
          }
          whileTap={animate ? { scale: 0.9 } : undefined}
          onClick={
            chasing
              ? handleCatch
              : peek
                ? () => endHide(true)
                : () => {
                    lastTouchRef.current = Date.now();
                    play.handleTap();
                  }
          }
          // Holding him down while he is fleeing would start the pet/greet
          // timer underneath the chase — a catch is a click, not a hold.
          onPointerDown={chasing ? undefined : play.petDown}
          onPointerUp={chasing ? undefined : play.petUp}
          onPointerCancel={chasing ? undefined : play.petUp}
          onPointerLeave={chasing ? undefined : play.petUp}
        >
          <motion.div animate={moving} style={{ transformOrigin: '50% 85%' }}>
            <RobotSprite
              pose={poseFor(inputs)}
              animate={animate}
              size={spriteW}
              outfit={outfit}
              chestLight={game.override.chest}
              forceBlink={game.override.blink}
            />
          </motion.div>

          {sleeping && animate && <Zzz />}
          {celebration && animate && <Confetti celebration={celebration} />}
          <Hearts show={play.petting && animate} />
        </motion.button>
      </motion.div>

      <VikStatus
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        robotName={robotName}
        value={mood.value}
        bondLevel={bondLevel}
        bond={bond.state}
        playful={playful}
        animate={animate}
        scores={game.scores}
        otherOnline={presence.otherOnline}
        finePointer={typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches}
        onPlay={startGame}
        onPlayful={(next) =>
          store.patchPersonalization(
            { companion: { ...store.me.personalization.companion, playful: next } },
            store.asMe({ summary: `${robotName} ${next ? 'playful' : 'calmed down'}` }),
          )
        }
      />
    </div>
  );
}
