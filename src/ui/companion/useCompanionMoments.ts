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
  type CompanionEvent,
  type CompanionMemory,
  type Moment,
} from '../../lib/companion';
import type { PresenceBlock } from './useAppPresence';

const SNOOZE_MS = 4 * 3_600_000;
const TICK_MS = 60_000;
/** First look shortly after load, so a greeting lands as the page settles. */
const FIRST_TICK_MS = 2_500;
/** Presence seen inside this window after mount is steady state, not news. */
const JOIN_GRACE_MS = 10_000;
/** An event nobody managed to announce goes stale rather than queuing up. */
const EVENT_TTL_MS = 5 * 60_000;

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
  /** null while presence is unknown (mock single tab, channel still joining). */
  otherOnline: boolean | null;
  otherBlock: PresenceBlock | null;
}): CompanionMomentsApi {
  const store = useStore();
  const [current, setCurrent] = useState<Moment | null>(null);

  const memRef = useRef<CompanionMemory | null>(null);
  const memForRef = useRef<string | null>(null);
  const currentRef = useRef<Moment | null>(null);
  currentRef.current = current;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  /** Live transitions waiting to be announced. One shot: every tick they are
   *  offered to the engine once and then dropped, announced or not — a join
   *  the debounce declined must not retry forever. */
  const pendingRef = useRef<{ at: number; event: CompanionEvent }[]>([]);
  const mountAtRef = useRef(Date.now());
  const tickRef = useRef<() => void>(() => {});
  const soonRef = useRef<number | null>(null);
  const scheduleSoon = (ms: number) => {
    if (soonRef.current) clearTimeout(soonRef.current);
    soonRef.current = window.setTimeout(() => tickRef.current(), ms);
  };

  const memory = (): CompanionMemory => {
    if (memRef.current == null || memForRef.current !== store.meId) {
      memForRef.current = store.meId;
      memRef.current = loadMemory(store.meId);
    }
    return memRef.current;
  };

  const buildCtx = (): CompanionContext => {
    const now = Date.now();
    return {
      now: new Date(now),
      me: store.me,
      other: store.other,
      route: optsRef.current.route,
      dense: optsRef.current.dense,
      otherOnline: optsRef.current.otherOnline,
      events: pendingRef.current.filter((p) => now - p.at < EVENT_TTL_MS).map((p) => p.event),
      memory: memory(),
      chattiness: (store.me.personalization.companion?.chattiness ?? 'normal') as Chattiness,
    };
  };

  /* Presence transitions → events. A change seen right after mount is steady
     state (they were already there), not an arrival. */
  const prevOnlineRef = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevOnlineRef.current;
    prevOnlineRef.current = opts.otherOnline;
    if (opts.otherOnline !== true || prev === true) return;
    if (Date.now() - mountAtRef.current < JOIN_GRACE_MS) return;
    if (prev == null) return; // unknown → online: no evidence they just arrived
    pendingRef.current.push({ at: Date.now(), event: { type: 'join' } });
    scheduleSoon(600);
  }, [opts.otherOnline]);

  const prevBlockRef = useRef<{ known: boolean; block: PresenceBlock | null }>({
    known: false,
    block: null,
  });
  useEffect(() => {
    const prev = prevBlockRef.current;
    prevBlockRef.current = { known: true, block: opts.otherBlock };
    // Announce only the null → running edge, observed live (not first paint).
    if (!prev.known || prev.block != null || opts.otherBlock == null) return;
    pendingRef.current.push({
      at: Date.now(),
      event: {
        type: 'block',
        taskRef: opts.otherBlock.task_ref,
        scope: opts.otherBlock.scope,
      },
    });
    scheduleSoon(600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.otherBlock?.scope, opts.otherBlock?.task_ref, opts.otherBlock == null]);

  /* Songs from the other person → events, on the notifications seen-baseline
     pattern: everything present at subscribe time is history, not news. The
     announcement waits 2s so the bell popup (which owns message notification)
     lands first — Vik garnishes, he doesn't double-announce. */
  useEffect(() => {
    const seen = new Set(store.ds.messages.map((m) => m.id));
    const unsub = store.subscribe(() => {
      for (const m of store.ds.messages) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        if (m.kind === 'song' && m.sender_id !== store.meId && m.song_ref) {
          pendingRef.current.push({
            at: Date.now(),
            event: {
              type: 'song',
              messageId: m.id,
              title: m.song_ref.title,
              artist: m.song_ref.artist || null,
              url: m.song_ref.url || null,
            },
          });
          scheduleSoon(2_000);
        }
      }
    });
    return () => {
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  useEffect(() => {
    if (!opts.active) return;
    const tick = () => {
      // Never talk over a bubble that is already up.
      if (currentRef.current) {
        pendingRef.current = pendingRef.current.filter(
          (p) => Date.now() - p.at < EVENT_TTL_MS,
        );
        return;
      }
      const ctx = buildCtx();
      const moment = pickMoment(store.ds, ctx);
      // Events got their one chance this tick, announced or not.
      pendingRef.current = [];
      if (!moment) return;
      memRef.current = commitMoment(ctx.memory, moment, ctx.now);
      saveMemory(store.meId, memRef.current);
      setCurrent(moment);
    };
    tickRef.current = tick;
    const first = window.setTimeout(tick, FIRST_TICK_MS);
    const every = window.setInterval(tick, TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(every);
      if (soonRef.current) clearTimeout(soonRef.current);
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
