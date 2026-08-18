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
      const fresh = seedDataset();
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<Dataset>;
          if (parsed.profiles && parsed.ranking_weights) {
            // Merge, never wipe. A dataset saved before a collection existed
            // must not crash the app (a missing array is not iterable) and must
            // not be thrown away either — backfill only what is absent, so
            // every future schema addition is survivable.
            const merged = { ...fresh } as unknown as Record<string, unknown>;
            for (const key of Object.keys(fresh)) {
              const stored = (parsed as Record<string, unknown>)[key];
              if (key === 'ranking_weights') {
                if (stored) merged[key] = stored;
              } else if (Array.isArray(stored)) {
                merged[key] = stored;
              }
            }
            const out = merged as unknown as Dataset;
            // Credentials predate the password field on older saves.
            out.profiles = out.profiles.map((p) =>
              p.password
                ? p
                : { ...p, password: fresh.profiles.find((s) => s.email === p.email)?.password },
            );
            current = out;
            return out;
          }
        }
      } catch {}
      current = fresh;
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
