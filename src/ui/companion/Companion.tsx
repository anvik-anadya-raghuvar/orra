/**
 * Vik, the companion — a robot in the corner that talks a little and plays a
 * lot. Mounted once in App.tsx beside BlockOverlay; renders nothing while the
 * user's own block runs (never talk over focus) or when switched off in
 * Customise (a preference on profiles.personalization, never a permission).
 *
 * This file is wiring only. Each behaviour lives in its own hook, what he looks
 * like is decided by lib/companionState.ts, and how that draws is
 * lib/companionPose.ts. Nothing below picks a face.
 */
import { motion, type TargetAndTransition } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useData, useStore } from '../../data/store';
import { quietHoursFor } from '../../lib/companion';
import { GESTURE_ANIM, GESTURE_REST, type Gesture } from '../../lib/companionPose';
import { isBusy, isSleeping, poseFor, type VikInputs } from '../../lib/companionState';
import { resolveOutfit } from '../../lib/companionWardrobe';
import { readWorld, restingPose } from '../../lib/companionWorld';
import { spring, useAnimateIn } from '../motion';
import RobotSprite from './RobotSprite';
import VikBubble from './VikBubble';
import { Confetti, Hearts, Zzz } from './VikEffects';
import { useAppPresence } from './useAppPresence';
import { useBubbleLife } from './useBubbleLife';
import { useCelebrations } from './useCelebrations';
import { useCompanionMoments } from './useCompanionMoments';
import { useCursorFollow } from './useCursorFollow';
import { useIdleAntics } from './useIdleAntics';
import { useVikGesture } from './useVikGesture';
import { useVikPlay } from './useVikPlay';
import { useVikVoice } from './useVikVoice';
import { useWeatherSignal } from './useWeatherSignal';
import './companion.css';

/** Money, Admin and People: he shrinks and stops volunteering. */
const DENSE = ['/money', '/admin', '/people'];
const ANTICS: Gesture[] = ['stretch', 'tilt', 'doze'];
const SIZE = { normal: 58, dense: 36 };

export default function Companion() {
  const store = useStore();
  const enabled = useData((_, s) => s.me.personalization.companion?.enabled !== false);
  const robotName = useData((_, s) => s.me.personalization.companion?.name?.trim() || 'Vik');
  const follow = useData((_, s) => s.me.personalization.companion?.follow === true);
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

  // Re-render each minute so quiet hours and the wardrobe stay current.
  const [, setMinuteBeat] = useState(0);
  useEffect(() => {
    const iv = window.setInterval(() => setMinuteBeat((n) => n + 1), 60_000);
    return () => clearInterval(iv);
  }, []);
  const now = new Date();
  const quiet = quietHoursFor(store.me.time_zone, now);

  // How the day is going: what he wears, and how he holds himself when nothing
  // else is claiming his face.
  const weather = useWeatherSignal();
  // Through useData so a task closing or a song landing re-renders him; the
  // selector runs outside the snapshot, so a fresh object each render is fine.
  const world = useData((ds, s) =>
    readWorld({
      ds,
      meId: s.meId,
      now,
      weather,
      otherTimeZone: s.other.time_zone ?? null,
    }),
  );
  const outfit = resolveOutfit(world);

  const { quip, say } = useVikVoice();
  const { gesture, doGesture } = useVikGesture();
  const play = useVikPlay({
    quiet,
    animate,
    hasMoment: current != null,
    dismiss,
    demand,
    doGesture,
    say,
  });
  const celebration = useCelebrations(store, say);

  const boundsRef = useRef<HTMLDivElement>(null);
  useCursorFollow({
    enabled: follow && animate && !dense,
    boundsRef,
    x: play.x,
    y: play.y,
    dragging: play.isDragging,
  });

  // Read at fire time, not at schedule time — see useIdleAntics.
  const busyRef = useRef(false);
  useIdleAntics({ antics: ANTICS, doGesture, busy: () => busyRef.current });

  const bubbleText = quip ?? current?.text ?? null;
  const { hoverProps } = useBubbleLife({ ttlMs: current?.ttlMs ?? null, onExpire: dismiss });

  const inputs: VikInputs = {
    playMood: play.playMood,
    petting: play.petting,
    dragging: play.isDragging(),
    celebrating: celebration != null,
    dozing: gesture === 'doze',
    momentMood: current?.mood ?? null,
    worldPose: restingPose(world),
    speaking: bubbleText != null,
    quiet,
    dense,
  };
  busyRef.current = isBusy(inputs);

  if (!enabled || myBlockUp) return null;

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
      <motion.div
        className="vik-wrap"
        drag
        dragMomentum={false}
        dragElastic={0.12}
        dragConstraints={boundsRef}
        style={{ x: play.x, y: play.y }}
        onDragStart={play.onDragStart}
        onDragEnd={play.onDragEnd}
      >
        <VikBubble
          text={bubbleText}
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
          aria-label={`${robotName}, your companion — tap for what's happening`}
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
          onClick={play.handleTap}
          onPointerDown={play.petDown}
          onPointerUp={play.petUp}
          onPointerCancel={play.petUp}
          onPointerLeave={play.petUp}
        >
          <motion.div animate={moving} style={{ transformOrigin: '50% 85%' }}>
            <RobotSprite
              pose={poseFor(inputs)}
              animate={animate}
              size={dense ? SIZE.dense : SIZE.normal}
              outfit={outfit}
            />
          </motion.div>

          {sleeping && animate && <Zzz />}
          {celebration && animate && <Confetti celebration={celebration} />}
          <Hearts show={play.petting && animate} />
        </motion.button>
      </motion.div>
    </div>
  );
}
