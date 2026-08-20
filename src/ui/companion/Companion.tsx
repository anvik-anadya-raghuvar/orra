/**
 * Vik, the companion — a robot in the corner that talks a little and plays a
 * lot. Mounted once in App.tsx beside BlockOverlay; renders nothing while the
 * user's own block runs (never talk over focus) or when switched off in
 * Customise (a preference on profiles.personalization, never a permission).
 *
 * Two mouths, one voice: ambient/announced moments come from the pure engine
 * via useCompanionMoments; play (poking, petting, dragging) is handled here
 * and always wins over announcements — a queued moment waits its turn.
 */
import { AnimatePresence, motion, useMotionValue } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useData, useStore } from '../../data/store';
import type { RobotMood } from '../../lib/companionCopy';
import {
  FLING_SPEED,
  FORGIVE_MS,
  nextStreak,
  PET_HOLD_MS,
  POKE_LINES,
  pokeLevel,
} from '../../lib/companionPlay';
import { entrance, micro, spring, useAnimateIn } from '../motion';
import { isMyTask } from '../../lib/workspace';
import { intentionsFor, itemDone } from '../../lib/dayPlan';
import { todayIso } from '../../lib/dates';
import RobotSprite from './RobotSprite';
import { useAppPresence } from './useAppPresence';
import { useCompanionMoments } from './useCompanionMoments';
import './companion.css';

const POS_KEY = 'anvik:companion:pos';
const QUIP_MS = 2_600;
/** The tap cycle resets to "status" after this much quiet. */
const CYCLE_RESET_MS = 30_000;

/** Confetti vectors, precomputed and deterministic — a burst, not a library.
 *  Angles fan the full circle with an upward bias; distances vary by index. */
const CONFETTI = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  const d = 46 + (i % 4) * 9;
  return {
    x: Math.round(Math.cos(a) * d),
    y: Math.round(Math.sin(a) * d - 34),
    r: 140 + i * 22,
  };
});

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

export default function Companion() {
  const store = useStore();
  const enabled = useData((_, s) => s.me.personalization.companion?.enabled !== false);
  const robotName = useData((_, s) => s.me.personalization.companion?.name?.trim() || 'Vik');
  const myBlockUp = useData((ds, s) => ds.active_blocks.some((b) => b.user_id === s.meId));
  const { pathname } = useLocation();
  const animate = useAnimateIn();

  const dense =
    pathname.startsWith('/money') || pathname.startsWith('/admin') || pathname.startsWith('/people');

  const presence = useAppPresence(pathname);

  const { current, dismiss, snooze, demand } = useCompanionMoments({
    active: enabled && !myBlockUp,
    route: pathname,
    dense,
    otherOnline: presence.otherOnline,
    otherBlock: presence.otherPayload?.block ?? null,
  });

  /* ── Play state ──────────────────────────────────────────────────────── */
  const [playMood, setPlayMood] = useState<RobotMood | null>(null);
  const [petting, setPetting] = useState(false);
  const [quip, setQuip] = useState<string | null>(null);
  const streakRef = useRef({ count: 0, at: 0 });
  const grumpyUntilRef = useRef(0);
  const cycleRef = useRef({ step: 0, at: 0 });
  const petTimerRef = useRef<number | null>(null);
  const petHitRef = useRef(false);
  const playTimerRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  /** A click lands right after a real drag ends — that release is not a poke. */
  const suppressClickUntilRef = useRef(0);

  const boundsRef = useRef<HTMLDivElement>(null);
  const pos = useRef(savedPos()).current;
  const x = useMotionValue(pos.x);
  const y = useMotionValue(pos.y);

  const setReaction = (mood: RobotMood, ms: number) => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    setPlayMood(mood);
    playTimerRef.current = window.setTimeout(() => setPlayMood(null), ms);
  };

  const say = (text: string) => {
    setQuip(text);
    window.setTimeout(() => setQuip((q) => (q === text ? null : q)), QUIP_MS);
  };

  const handleTap = () => {
    if (draggingRef.current || Date.now() < suppressClickUntilRef.current) return;
    if (petHitRef.current) {
      // The release at the end of a pet is not a poke.
      petHitRef.current = false;
      return;
    }
    const now = Date.now();

    // Poked past patience: just a huffy head-shake until forgiveness.
    if (grumpyUntilRef.current > now) {
      setReaction('grumpy', 600);
      return;
    }

    const streak = nextStreak(streakRef.current.count, streakRef.current.at, now);
    streakRef.current = { count: streak, at: now };
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
    if (current) dismiss();
    if (level === 'giggle') setReaction('giggle', 900);
    if (level === 'dizzy') {
      setReaction('dizzy', 1_500);
      const lines = POKE_LINES.dizzy!;
      if (streak === 4) say(lines[Math.floor(Math.random() * lines.length)]);
    }
    if (level === 'grumpy') {
      grumpyUntilRef.current = now + FORGIVE_MS;
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
      setPlayMood('grumpy');
      playTimerRef.current = window.setTimeout(() => setPlayMood(null), FORGIVE_MS);
      const lines = POKE_LINES.grumpy!;
      if (streak === 7) say(lines[Math.floor(Math.random() * lines.length)]);
    }
  };

  /* ── Celebrations — a task crossing into done, watched with a prev-status
     ledger so a reload replays nothing. Mine → jump and confetti (the day's
     last intention closing earns the big one). The other person landing
     something urgent gets applause — shared wins are the point of the Us
     rooms, and a robot clapping costs nothing. ─────────────────────────── */
  const [celebration, setCelebration] = useState<null | { key: number; big: boolean }>(null);
  const celebTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = new Map(store.ds.tasks.map((t) => [t.id, t.status]));
    const unsub = store.subscribe(() => {
      for (const t of store.ds.tasks) {
        const was = prev.get(t.id);
        prev.set(t.id, t.status);
        if (was === undefined || was === t.status || t.status !== 'done') continue;
        const mine = isMyTask(t, store.meId);
        if (!mine && t.priority !== 'urgent' && t.priority !== 'high') continue;
        let big = false;
        if (mine) {
          const items = intentionsFor(store.ds, store.meId, todayIso());
          big = items.length > 0 && items.every((i) => itemDone(i, store.ds.tasks));
          if (big) say('Day: cleared. 🎉');
        } else {
          say(`${store.other.name} just landed ${t.id} 👏`);
        }
        setCelebration({ key: Date.now(), big });
        if (celebTimerRef.current) clearTimeout(celebTimerRef.current);
        celebTimerRef.current = window.setTimeout(() => setCelebration(null), 1_800);
      }
    });
    return () => {
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);
  useEffect(
    () => () => {
      if (celebTimerRef.current) clearTimeout(celebTimerRef.current);
    },
    [],
  );

  /* Press-and-hold reads as a pet. Movement hands over to drag instead. */
  const petDown = () => {
    petHitRef.current = false;
    petTimerRef.current = window.setTimeout(() => {
      if (draggingRef.current) return;
      petHitRef.current = true;
      setPetting(true);
      if (!animate) say('♥');
    }, PET_HOLD_MS);
  };
  const petUp = () => {
    if (petTimerRef.current) clearTimeout(petTimerRef.current);
    if (petting) window.setTimeout(() => setPetting(false), 400);
  };

  useEffect(
    () => () => {
      if (petTimerRef.current) clearTimeout(petTimerRef.current);
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
    },
    [],
  );

  /* ── Bubble lifetime — pauses while hovered or focused ───────────────── */
  const pausedRef = useRef(false);
  useEffect(() => {
    if (!current) return;
    let deadline = Date.now() + current.ttlMs;
    const iv = window.setInterval(() => {
      if (pausedRef.current) deadline = Math.max(deadline, Date.now() + 1_200);
      else if (Date.now() >= deadline) dismiss();
    }, 400);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  if (!enabled || myBlockUp) return null;

  const mood: RobotMood =
    playMood ??
    (celebration
      ? 'excited'
      : petting
        ? 'happy'
        : draggingRef.current
          ? 'excited'
          : (current?.mood ?? 'idle'));

  const bubbleText = quip ?? current?.text ?? null;
  const showControls = !quip && current != null;
  const ambient = current != null && current.kind !== 'status-check' && !current.id.startsWith('ondemand:');

  return (
    <div className={`companion${dense ? ' dense' : ''}`} ref={boundsRef}>
      <motion.div
        className="vik-wrap"
        drag
        dragMomentum={false}
        dragElastic={0.12}
        dragConstraints={boundsRef}
        style={{ x, y }}
        onDragStart={() => {
          draggingRef.current = true;
          if (petTimerRef.current) clearTimeout(petTimerRef.current);
          setPlayMood('excited');
        }}
        onDragEnd={(_, info) => {
          draggingRef.current = false;
          suppressClickUntilRef.current = Date.now() + 250;
          setPlayMood(null);
          try {
            sessionStorage.setItem(POS_KEY, JSON.stringify({ x: x.get(), y: y.get() }));
          } catch {}
          const speed = Math.hypot(info.velocity.x, info.velocity.y);
          if (speed > FLING_SPEED) setReaction('dizzy', 1_600);
        }}
      >
        <AnimatePresence>
          {bubbleText && (
            <motion.div
              className="vik-bubble"
              role="status"
              aria-live="polite"
              initial={animate ? { opacity: 0, y: 8, scale: 0.92 } : false}
              animate={{ opacity: 1, y: 0, scale: 1, transition: entrance }}
              exit={animate ? { opacity: 0, y: 6, transition: micro } : { opacity: 0, transition: { duration: 0 } }}
              onMouseEnter={() => (pausedRef.current = true)}
              onMouseLeave={() => (pausedRef.current = false)}
              onFocusCapture={() => (pausedRef.current = true)}
              onBlurCapture={() => (pausedRef.current = false)}
            >
              <span>{bubbleText}</span>
              {showControls && (
                <div className="vik-actions">
                  {current!.action?.to && (
                    <Link className="chip go" to={current!.action.to} onClick={dismiss}>
                      {current!.action.label}
                    </Link>
                  )}
                  {current!.action?.url && (
                    <a
                      className="chip go"
                      href={current!.action.url}
                      target="_blank"
                      rel="noreferrer"
                      onClick={dismiss}
                    >
                      {current!.action.label}
                    </a>
                  )}
                  {ambient && (
                    <button
                      className="vik-iconbtn"
                      aria-label={`Snooze ${robotName} for four hours`}
                      title="Snooze for 4 hours"
                      onClick={snooze}
                    >
                      zZ
                    </button>
                  )}
                  <button className="vik-iconbtn" aria-label="Dismiss" onClick={dismiss}>
                    ✕
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

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
          onClick={handleTap}
          onPointerDown={petDown}
          onPointerUp={petUp}
          onPointerCancel={petUp}
          onPointerLeave={petUp}
        >
          <RobotSprite mood={mood} animate={animate} size={dense ? 36 : 58} />
          {celebration && animate && (
            <span aria-hidden key={celebration.key}>
              {CONFETTI.map((c, i) => (
                <motion.span
                  key={i}
                  className={`vik-cf c${i % 5}`}
                  initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
                  animate={{
                    x: c.x * (celebration.big ? 1.5 : 1),
                    y: c.y * (celebration.big ? 1.5 : 1),
                    opacity: 0,
                    rotate: c.r,
                  }}
                  transition={{ duration: 0.9, ease: 'easeOut' }}
                />
              ))}
            </span>
          )}
          <AnimatePresence>
            {petting && animate && (
              <span aria-hidden>
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="vik-float"
                    initial={{ opacity: 0, y: 0, x: (i - 1) * 12 }}
                    animate={{ opacity: [0, 1, 0], y: -28 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 1.1, delay: i * 0.22, repeat: Infinity }}
                  >
                    ♥
                  </motion.span>
                ))}
              </span>
            )}
          </AnimatePresence>
        </motion.button>
      </motion.div>
    </div>
  );
}
