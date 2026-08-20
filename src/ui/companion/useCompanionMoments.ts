/**
 * The companion's scheduler — the impure shell around the pure engine.
 *
 * Owns the clock tick, the localStorage ledger (per person, pruned on load)
 * and the currently-displayed moment. Everything decided here is decided by
 * lib/companion.ts; this file only feeds it the world and remembers what it
 * said. Lives next to the component, like wikiPresence does, because it needs
 * the store and the browser.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../data/store';
import {
  commitMoment,
  emptyMemory,
  pickMoment,
  pickOnDemand,
  pruneMemory,
  type Chattiness,
  type CompanionContext,
  type CompanionMemory,
  type Moment,
} from '../../lib/companion';

const SNOOZE_MS = 4 * 3_600_000;
const TICK_MS = 60_000;
/** First look shortly after load, so a greeting lands as the page settles. */
const FIRST_TICK_MS = 2_500;

const memKey = (meId: string) => `anvik:companion:${meId}`;

function loadMemory(meId: string): CompanionMemory {
  try {
    const raw = localStorage.getItem(memKey(meId));
    if (!raw) return emptyMemory();
    return pruneMemory({ ...emptyMemory(), ...JSON.parse(raw) }, new Date());
  } catch {
    return emptyMemory();
  }
}

function saveMemory(meId: string, memory: CompanionMemory) {
  try {
    localStorage.setItem(memKey(meId), JSON.stringify(memory));
  } catch {}
}

export interface CompanionMomentsApi {
  current: Moment | null;
  dismiss: () => void;
  /** Four hours of quiet, this device only. */
  snooze: () => void;
  /** The tap cycle — status, tip, quote. Bypasses ambient cooldowns. */
  demand: (step: number) => void;
}

export function useCompanionMoments(opts: {
  active: boolean;
  route: string;
  dense: boolean;
}): CompanionMomentsApi {
  const store = useStore();
  const [current, setCurrent] = useState<Moment | null>(null);

  const memRef = useRef<CompanionMemory | null>(null);
  const memForRef = useRef<string | null>(null);
  const currentRef = useRef<Moment | null>(null);
  currentRef.current = current;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const memory = (): CompanionMemory => {
    if (memRef.current == null || memForRef.current !== store.meId) {
      memForRef.current = store.meId;
      memRef.current = loadMemory(store.meId);
    }
    return memRef.current;
  };

  const buildCtx = (): CompanionContext => ({
    now: new Date(),
    me: store.me,
    other: store.other,
    route: optsRef.current.route,
    dense: optsRef.current.dense,
    otherOnline: null, // Phase 2 wires presence in here
    events: [], // Phase 3 wires live events in here
    memory: memory(),
    chattiness: (store.me.personalization.companion?.chattiness ?? 'normal') as Chattiness,
  });

  useEffect(() => {
    if (!opts.active) return;
    const tick = () => {
      // Never talk over a bubble that is already up.
      if (currentRef.current) return;
      const ctx = buildCtx();
      const moment = pickMoment(store.ds, ctx);
      if (!moment) return;
      memRef.current = commitMoment(ctx.memory, moment, ctx.now);
      saveMemory(store.meId, memRef.current);
      setCurrent(moment);
    };
    const first = window.setTimeout(tick, FIRST_TICK_MS);
    const every = window.setInterval(tick, TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
    // store is stable for the app's lifetime; active flips on sign-in/block.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.active, store]);

  const dismiss = () => setCurrent(null);

  const snooze = () => {
    memRef.current = { ...memory(), snoozedUntil: Date.now() + SNOOZE_MS };
    saveMemory(store.meId, memRef.current);
    setCurrent(null);
  };

  const demand = (step: number) => {
    const ctx = buildCtx();
    const moment = pickOnDemand(store.ds, ctx, step);
    memRef.current = commitMoment(ctx.memory, moment, ctx.now, { onDemand: true });
    saveMemory(store.meId, memRef.current);
    setCurrent(moment);
  };

  return { current, dismiss, snooze, demand };
}
