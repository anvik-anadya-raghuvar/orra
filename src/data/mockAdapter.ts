import type { Dataset } from '../types';
import type { DataAdapter } from './adapter';
import { seedDataset } from './seed';

const LS_KEY = 'anvik:dataset:v1';

/**
 * Local mock adapter — the approved build accelerator. Whole dataset lives in
 * localStorage; BroadcastChannel mirrors changes across tabs so the Us chat
 * behaves like realtime locally.
 */
export function createMockAdapter(): DataAdapter {
  let pending: number | undefined;
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('anvik-mock') : null;
  let current: Dataset | null = null;

  const persist = () => {
    if (pending) clearTimeout(pending);
    pending = window.setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(current));
      } catch {}
      channel?.postMessage({ type: 'sync' });
    }, 150);
  };

  return {
    kind: 'mock',
    async load() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Dataset;
          // Reseed if the stored shape predates the current schema
          if (parsed.profiles && parsed.ranking_weights && parsed.daily_closeouts) {
            current = parsed;
            return parsed;
          }
        }
      } catch {}
      current = seedDataset();
      return current;
    },
    saveCollection(key, rows) {
      if (!current) return;
      current = { ...current, [key]: rows };
      persist();
    },
    saveWeights(w) {
      if (!current) return;
      current = { ...current, ranking_weights: w };
      persist();
    },
    onRemoteChange(cb) {
      if (!channel) return () => {};
      const handler = () => {
        try {
          const raw = localStorage.getItem(LS_KEY);
          if (raw) {
            current = JSON.parse(raw) as Dataset;
            cb(current);
          }
        } catch {}
      };
      channel.addEventListener('message', handler);
      return () => channel.removeEventListener('message', handler);
    },
  };
}
