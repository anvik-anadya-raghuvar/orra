/**
 * The bond's state, and getting it safely to disk.
 *
 * Same three rules as the mood, for the same reasons: never write per poke
 * (the audit trail is append-only and this is a toy), mirror to localStorage
 * immediately so a crash costs nothing, and merge rather than clobber so two
 * tabs converge instead of one erasing the other.
 *
 * The merge is the important one here. The mood is a single value where the
 * newest write simply wins; the bond is a thing you have accumulated, and
 * losing an evening of it to a stale tab would be genuinely annoying.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useData, useStore } from '../../data/store';
import { todayIso } from '../../lib/dates';
import {
  award,
  emptyBond,
  levelOf,
  mergeBond,
  seen,
  type BondAction,
  type BondState,
} from '../../lib/companionBond';
import type { MoodAction } from '../../lib/companionMood';
import type { AccessoryId } from '../../lib/companionWardrobe';

const FLUSH_MS = 5_000;
const KEY = (meId: string) => `orra:vik:bond:${meId}`;

/** Which of the things the mood notices are also worth xp. */
const BOND_FOR: Partial<Record<MoodAction, BondAction>> = {
  pet: 'pet',
  'poke-dizzy': 'poke',
  'poke-grumpy': 'poke',
  'game-finished': 'game',
  caught: 'find',
};

function readMirror(meId: string): BondState | null {
  try {
    const raw = localStorage.getItem(KEY(meId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BondState;
    if (parsed?.v !== 1 || typeof parsed.xp !== 'number') return null;
    return mergeBond(parsed, null);
  } catch {
    return null;
  }
}

function yesterdayIso(now = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() - 1);
  return todayIso(d);
}

export interface VikBond {
  state: BondState;
  level: number;
  unlocked: AccessoryId[];
  /** Mirror of the mood's feel(), for the actions that also earn xp. */
  earn: (action: MoodAction) => void;
  /** A new personal best. Worth more than the game that produced it. */
  record: () => void;
}

export function useVikBond(): VikBond {
  const store = useStore();
  const meId = store.meId;
  const stored = useData((_, s) => s.me.personalization.companion?.bond ?? null);

  const stateRef = useRef<BondState | null>(null);
  if (stateRef.current === null) {
    // Both sides, merged: whichever is ahead on any field wins that field.
    stateRef.current = mergeBond(readMirror(meId), (stored as BondState | null) ?? null);
  }

  const [, setTick] = useState(0);
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (!dirtyRef.current || !stateRef.current) return;
    dirtyRef.current = false;
    // Merge against whatever is live right now, not against what we loaded —
    // another tab may have written in between.
    const live = (store.me.personalization.companion?.bond as BondState | null) ?? null;
    const merged = mergeBond(live, stateRef.current);
    stateRef.current = merged;
    store.patchPersonalization(
      { companion: { ...store.me.personalization.companion, bond: merged } },
      store.asMe({ silent: true }),
    );
  }, [store]);

  const commit = useCallback(
    (next: BondState) => {
      if (next === stateRef.current) return;
      stateRef.current = next;
      try {
        localStorage.setItem(KEY(meId), JSON.stringify(next));
      } catch {}
      dirtyRef.current = true;
      setTick((n) => n + 1);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(flush, FLUSH_MS);
    },
    [flush, meId],
  );

  const earn = useCallback(
    (action: MoodAction) => {
      const bondAction = BOND_FOR[action];
      if (!bondAction) return;
      commit(award(stateRef.current!, bondAction, todayIso()));
    },
    [commit],
  );

  const record = useCallback(() => {
    commit(award(stateRef.current!, 'record', todayIso()));
  }, [commit]);

  // He noticed you turned up. Once a day, plus whatever run it continues.
  useEffect(() => {
    commit(seen(stateRef.current!, todayIso(), yesterdayIso()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const state = stateRef.current ?? emptyBond();
  return { state, level: levelOf(state.xp), unlocked: state.unlocked, earn, record };
}
