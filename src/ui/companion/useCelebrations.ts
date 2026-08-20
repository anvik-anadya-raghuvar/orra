/**
 * A task crossing into done, watched with a prev-status ledger so a reload
 * replays nothing. Mine earns a jump and confetti — the day's last intention
 * closing earns the big one. The other person landing something urgent gets
 * applause: shared wins are the point of the Us rooms, and a robot clapping
 * costs nothing.
 */
import { useEffect, useRef, useState } from 'react';
import type { AppStore } from '../../data/store';
import { isMyTask } from '../../lib/workspace';
import { intentionsFor, itemDone } from '../../lib/dayPlan';
import { todayIso } from '../../lib/dates';

const CELEBRATION_MS = 1_800;

export interface Celebration {
  key: number;
  /** Every intention of the day closed — a bigger jump, more confetti. */
  big: boolean;
}

export function useCelebrations(store: AppStore, say: (text: string) => void) {
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const timerRef = useRef<number | null>(null);
  // `say` changes identity on nothing, but keep it off the effect's deps so a
  // re-subscribe never rebuilds the ledger and replays a done task.
  const sayRef = useRef(say);
  sayRef.current = say;

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
          if (big) sayRef.current('Day: cleared. 🎉');
        } else {
          sayRef.current(`${store.other.name} just landed ${t.id} 👏`);
        }
        setCelebration({ key: Date.now(), big });
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => setCelebration(null), CELEBRATION_MS);
      }
    });
    return () => {
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return celebration;
}
