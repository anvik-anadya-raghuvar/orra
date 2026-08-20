/**
 * The toy half: poking, petting, dragging, flinging.
 *
 * Play always wins over announcements — a queued moment waits its turn — so
 * everything here is free to interrupt the bubble, and does. The rules of the
 * ladder itself live in lib/companionPlay.ts; this hook is the timers, the
 * refs and the pointer plumbing that the rules cannot own.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMotionValue } from 'framer-motion';
import type { PanInfo } from 'framer-motion';
import type { RobotMood } from '../../lib/companionCopy';
import {
  FLING_SPEED,
  FORGIVE_MS,
  nextStreak,
  PET_HOLD_MS,
  POKE_LINES,
  pokeLevel,
} from '../../lib/companionPlay';
import type { Gesture } from '../../lib/companionPose';

const POS_KEY = 'anvik:companion:pos';
/** The tap cycle resets to "status" after this much quiet. */
const CYCLE_RESET_MS = 30_000;
/** A click lands right after a real drag ends — that release is not a poke. */
const CLICK_SUPPRESS_MS = 250;
/** How long he stays groggy after being woken mid-nap. */
const WAKE_GRACE_MS = 45_000;
/** The tenth fast poke is a secret. */
const SECRET_STREAK = 10;

function savedPos(): { x: number; y: number } {
  try {
    const raw = sessionStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.x === 'number' && typeof p.y === 'number') return p;
    }
  } catch {}
  return { x: 0, y: 0 };
}

const pick = (lines: string[]) => lines[Math.floor(Math.random() * lines.length)];

interface Options {
  /** Quiet hours in the reader's own timezone — he is asleep. */
  quiet: boolean;
  animate: boolean;
  /** Is an announcement on screen right now. */
  hasMoment: boolean;
  dismiss: () => void;
  /** Ask the engine for step 0/1/2 of the conversation cycle. */
  demand: (step: number) => void;
  doGesture: (g: Gesture, ms?: number) => void;
  say: (text: string) => void;
}

export function useVikPlay({
  quiet,
  animate,
  hasMoment,
  dismiss,
  demand,
  doGesture,
  say,
}: Options) {
  const [playMood, setPlayMood] = useState<RobotMood | null>(null);
  const [petting, setPetting] = useState(false);

  const wakeUntilRef = useRef(0);
  const streakRef = useRef({ count: 0, at: 0 });
  const grumpyUntilRef = useRef(0);
  const cycleRef = useRef({ step: 0, at: 0 });
  const petTimerRef = useRef<number | null>(null);
  const petHitRef = useRef(false);
  const playTimerRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const suppressClickUntilRef = useRef(0);

  const home = useRef(savedPos()).current;
  const x = useMotionValue(home.x);
  const y = useMotionValue(home.y);

  const setReaction = useCallback((mood: RobotMood, ms: number) => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    setPlayMood(mood);
    playTimerRef.current = window.setTimeout(() => setPlayMood(null), ms);
  }, []);

  const handleTap = () => {
    if (draggingRef.current || Date.now() < suppressClickUntilRef.current) return;
    if (petHitRef.current) {
      // The release at the end of a pet is not a poke.
      petHitRef.current = false;
      return;
    }
    const now = Date.now();

    // Napping through quiet hours: the first poke only wakes him, groggily.
    if (quiet && now > wakeUntilRef.current) {
      wakeUntilRef.current = now + WAKE_GRACE_MS;
      setReaction('sleepy', 900);
      say('…mm? Awake. Definitely awake.');
      return;
    }

    const streak = nextStreak(streakRef.current.count, streakRef.current.at, now);
    streakRef.current = { count: streak, at: now };

    // The secret: he stops sulking and breakdances. Counted before the grump
    // gate, or the sulk would make it unreachable.
    if (streak === SECRET_STREAK) {
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
      setPlayMood(null);
      grumpyUntilRef.current = 0;
      doGesture('spin');
      say('🕺');
      return;
    }

    // Poked past patience: just a huffy head-shake until forgiveness.
    if (grumpyUntilRef.current > now) {
      setReaction('grumpy', 600);
      return;
    }

    const level = pokeLevel(streak);

    if (level === 'tap') {
      // Conversation: status → tip → quote → hide, resetting after quiet.
      if (now - cycleRef.current.at > CYCLE_RESET_MS) cycleRef.current.step = 0;
      cycleRef.current.at = now;
      const step = cycleRef.current.step;
      cycleRef.current.step = (step + 1) % 4;
      if (step === 3) dismiss();
      else demand(step);
      return;
    }

    // Play wins over announcements.
    if (hasMoment) dismiss();
    if (level === 'giggle') setReaction('giggle', 900);
    if (level === 'dizzy') {
      setReaction('dizzy', 1_500);
      if (streak === 4) say(pick(POKE_LINES.dizzy!));
    }
    if (level === 'grumpy') {
      grumpyUntilRef.current = now + FORGIVE_MS;
      setReaction('grumpy', FORGIVE_MS);
      if (streak === 7) say(pick(POKE_LINES.grumpy!));
    }
  };

  /* Press-and-hold reads as a pet. Movement hands over to drag instead. */
  const petDown = () => {
    petHitRef.current = false;
    petTimerRef.current = window.setTimeout(() => {
      if (draggingRef.current) return;
      petHitRef.current = true;
      setPetting(true);
      // Hearts are the whole reaction; without them, he has to say it.
      if (!animate) say('♥');
    }, PET_HOLD_MS);
  };
  const petUp = () => {
    if (petTimerRef.current) clearTimeout(petTimerRef.current);
    if (petting) window.setTimeout(() => setPetting(false), 400);
  };

  const onDragStart = () => {
    draggingRef.current = true;
    if (petTimerRef.current) clearTimeout(petTimerRef.current);
    setPlayMood('excited');
  };

  const onDragEnd = (_: unknown, info: PanInfo) => {
    draggingRef.current = false;
    suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESS_MS;
    setPlayMood(null);
    try {
      sessionStorage.setItem(POS_KEY, JSON.stringify({ x: x.get(), y: y.get() }));
    } catch {}
    const speed = Math.hypot(info.velocity.x, info.velocity.y);
    if (speed > FLING_SPEED) setReaction('dizzy', 1_600);
  };

  useEffect(
    () => () => {
      if (petTimerRef.current) clearTimeout(petTimerRef.current);
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
    },
    [],
  );

  return {
    playMood,
    petting,
    x,
    y,
    isDragging: useCallback(() => draggingRef.current, []),
    handleTap,
    petDown,
    petUp,
    onDragStart,
    onDragEnd,
  };
}
