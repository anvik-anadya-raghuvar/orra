/**
 * The friendliness meter's state, and getting it safely to disk.
 *
 * Three rules, all of them there for a reason:
 *
 *   Never write per poke. `store.update` appends an audit_trail row per changed
 *   field, and that table has UPDATE and DELETE revoked at the database — a
 *   chatty writer would permanently pollute the trail. Every write here is
 *   `silent`, and they are debounced besides.
 *
 *   Mirror to localStorage immediately. A crash between debounce and flush must
 *   not cost you a sulk you earned, or worse, a recovery you earned.
 *
 *   Patch through the store rather than spreading a captured profile, so a
 *   mood flush and a preference toggle in the same tick cannot drop each other.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useData, useStore } from '../../data/store';
import { todayIso } from '../../lib/dates';
import {
  applyDelta,
  behaviourFor,
  currentValue,
  emptyMood,
  type BandBehaviour,
  type MoodAction,
  type MoodState,
} from '../../lib/companionMood';

/** Long enough that a flurry of pokes is one write, short enough to survive. */
const FLUSH_MS = 5_000;
const KEY = (meId: string) => `anvik:vik:mood:${meId}`;

function readMirror(meId: string): MoodState | null {
  try {
    const raw = localStorage.getItem(KEY(meId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MoodState;
    if (parsed?.v !== 1 || typeof parsed.value !== 'number') return null;
    return { ...parsed, last: parsed.last ?? {} };
  } catch {
    return null;
  }
}

/** The newer of the two records wins; they only ever disagree across devices. */
function freshest(a: MoodState | null, b: MoodState | null): MoodState | null {
  if (!a) return b;
  if (!b) return a;
  return a.at >= b.at ? a : b;
}

export interface VikMood {
  /** The meter right now, drifted. 0..100. */
  value: number;
  behaviour: BandBehaviour;
  /** Record something that happened. Cooldowns and caps are applied for you. */
  feel: (action: MoodAction) => void;
}

export function useVikMood(bondLevel = 0): VikMood {
  const store = useStore();
  const meId = store.meId;
  const stored = useData((_, s) => s.me.personalization.companion?.mood ?? null);

  const stateRef = useRef<MoodState | null>(null);
  if (stateRef.current === null) {
    stateRef.current =
      freshest(readMirror(meId), (stored as MoodState | null) ?? null) ?? emptyMood(Date.now(), bondLevel);
  }

  // Re-render on change; the value itself lives in the ref so a flush does not
  // depend on React having caught up.
  const [tick, setTick] = useState(0);
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (!dirtyRef.current || !stateRef.current) return;
    dirtyRef.current = false;
    store.patchPersonalization(
      { companion: { ...store.me.personalization.companion, mood: stateRef.current } },
      // Silent: the audit trail is append-only and this is a toy's mood.
      store.asMe({ silent: true }),
    );
  }, [store]);

  const feel = useCallback(
    (action: MoodAction) => {
      const now = Date.now();
      const before = stateRef.current!;
      const after = applyDelta(before, action, bondLevel, now, todayIso());
      // applyDelta returns the same object when a cooldown swallowed it.
      if (after === before) return;
      stateRef.current = after;
      try {
        localStorage.setItem(KEY(meId), JSON.stringify(after));
      } catch {}
      dirtyRef.current = true;
      setTick((n) => n + 1);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(flush, FLUSH_MS);
    },
    [bondLevel, flush, meId],
  );

  // A closing tab must not lose the last five seconds.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  // Drift is time-based, so the value moves without anything happening. The
  // minute beat in Companion.tsx re-renders us; `tick` covers the rest.
  void tick;
  const value = currentValue(stateRef.current!, bondLevel, Date.now());

  return { value, behaviour: behaviourFor(value), feel };
}
