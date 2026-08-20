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
import type { GameId } from '../../lib/companionGames';
import * as hideSeek from '../../lib/companionGames/hideSeek';
import { houseFor, PLACEMENT } from '../../lib/companionHouse';
import { bandOf, glowFor } from '../../lib/companionMood';
import { GESTURE_ANIM, GESTURE_REST } from '../../lib/companionPose';
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
import { useVikGame } from './useVikGame';
import { useAppPresence } from './useAppPresence';
import { useBubbleLife } from './useBubbleLife';
import { useCelebrations } from './useCelebrations';
import { useCompanionMoments } from './useCompanionMoments';
import { useCursorFollow } from './useCursorFollow';
import { useIdleAntics } from './useIdleAntics';
import { useVikGesture } from './useVikGesture';
import { useVikMood } from './useVikMood';
import { useVikPlay } from './useVikPlay';
import { useVikVoice } from './useVikVoice';
import { useWeatherSignal } from './useWeatherSignal';
import './companion.css';
import './companionHouse.css';

// The games and their timers are never needed to render a robot in a corner.
const VikGameLayer = lazy(() => import('./VikGameLayer'));

/** Money, Admin and People: he shrinks, stops volunteering, and leaves the house behind. */
const DENSE = ['/money', '/admin', '/people'];
const SIZE = { normal: 58, dense: 36 };

export default function Companion() {
  const store = useStore();
  const enabled = useData((_, s) => s.me.personalization.companion?.enabled !== false);
  const robotName = useData((_, s) => s.me.personalization.companion?.name?.trim() || 'Vik');
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

  // The bond arrives in its own phase; until then everyone settles at the floor.
  const bondLevel = 0;
  const mood = useVikMood(bondLevel);
  const band = bandOf(mood.value);

  // How the day is going: what he wears, and how he holds himself.
  const weather = useWeatherSignal();
  const world = useData((ds, s) =>
    readWorld({ ds, meId: s.meId, now, weather, otherTimeZone: s.other.time_zone ?? null }),
  );
  const outfit = resolveOutfit(world);

  const { quip, say } = useVikVoice();
  const { gesture, doGesture } = useVikGesture();
  const game = useVikGame(mood.feel);
  // Fixed when a round starts, not on every render — otherwise the machines
  // would be re-seeded underneath themselves and nothing could be replayed.
  const seedRef = useRef(1);

  // Hide and seek plays against the real page, so it needs the real geometry.
  const bounds = useVikBounds();
  const spriteW = dense ? SIZE.dense : SIZE.normal;
  const hideTarget = useHideTarget(bounds, spriteW, (spriteW * 74) / 64);
  const [hideState, setHideState] = useState<hideSeek.HideState | null>(null);
  const play = useVikPlay({
    quiet,
    animate,
    hasMoment: current != null,
    tolerance: mood.behaviour.pokeTolerance,
    dismiss,
    demand,
    doGesture,
    say,
    feel: mood.feel,
  });
  const celebration = useCelebrations(store, say);

  // Clearing every intention of the day is worth something to him too.
  const clearedRef = useRef(world.dayCleared);
  const feel = mood.feel;
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
  anticsRef.current = playful ? mood.behaviour.antics : [];
  useIdleAntics({ antics: () => anticsRef.current, doGesture, busy: () => busyRef.current });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const [statusOpen, setStatusOpen] = useState(false);

  const inputs: VikInputs = {
    playMood: play.playMood,
    petting: play.petting,
    dragging: play.isDragging(),
    celebrating: celebration != null,
    dozing: gesture === 'doze',
    momentMood: current?.mood ?? null,
    worldPose: restingPose(world),
    bandPose: mood.behaviour.pose,
    speaking: bubbleText != null,
    quiet,
    dense,
  };
  // A running game holds the floor: no antics over the top of it, and no
  // cursor chase either — two rAF loops on one sprite fight each other.
  busyRef.current = isBusy(inputs) || game.active != null;

  if (!enabled || myBlockUp) return null;

  // Dense rooms keep the old bare corner: no house, so no placement either.
  const house = houseFor({ band, quiet, mailWaiting: false, animate });
  // Dense rooms keep the bare corner: no house to stand beside, so no offset.
  const spot = dense ? { left: 0, lift: 0 } : PLACEMENT[house.place];
  // Hiding puts him against a card instead of the dock, clipped to his top half.
  const peek = hideState?.phase === 'seeking' ? hideTarget.spot : null;

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
    <div className={`companion${dense ? ' dense' : ''}`} ref={boundsRef}>
      {!dense && (
        <VikHouse
          state={house}
          band={band}
          glow={glowFor(mood.value)}
          robotName={robotName}
          animate={animate}
          onOpen={() => setStatusOpen(true)}
        />
      )}

      <motion.div
        className={`vik-wrap${peek ? ' peeking' : ''}`}
        drag={!peek}
        dragMomentum={false}
        dragElastic={0.12}
        dragConstraints={boundsRef}
        // Offsets on the dock, never absolute positions — see companion.css.
        // The cast is only to admit the two custom properties alongside the
        // motion values, which framer's style type does not model.
        style={
          (peek
            ? { x: 0, y: 0, left: peek.left, top: peek.top }
            : {
                x: play.x,
                y: play.y,
                '--vik-place-left': `${spot.left}px`,
                '--vik-place-lift': `${spot.lift}px`,
              }) as unknown as React.ComponentProps<typeof motion.div>['style']
        }
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
                  setChest: game.setChest,
                  setBlink: game.setBlink,
                  say,
                  finish: (score, won) => game.finish(game.active!, score, won),
                  quit: () => {
                    if (game.active === 'hide') endHide(false);
                    else game.abandon();
                  },
                }}
              />
            </Suspense>
          )}
        </AnimatePresence>

        <VikBubble
          text={game.active ? null : bubbleText}
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
            peek
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
          onClick={peek ? () => endHide(true) : play.handleTap}
          onPointerDown={play.petDown}
          onPointerUp={play.petUp}
          onPointerCancel={play.petUp}
          onPointerLeave={play.petUp}
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
        playful={playful}
        animate={animate}
        scores={game.scores}
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
