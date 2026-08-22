import type { Dataset } from '../types';
import type { DataAdapter } from './adapter';
import { seedDataset, seedTestDataset, TEST } from './seed';

const MAIN_LS_KEY = 'orra:dataset:v1';
// Bump only when the disposable fixture schema changes. Main-account storage
// deliberately keeps its original key and is never reset by test work.
const TEST_LS_KEY = 'orra:dataset:test:v2';
const LEGACY_TEST_ID = 'u-test';

/**
 * Local mock adapter — the approved build accelerator. Whole dataset lives in
 * localStorage; BroadcastChannel mirrors changes across tabs so the Us chat
 * behaves like realtime locally.
 */
export function createMockAdapter(): DataAdapter {
  const selectedId = (() => {
    try {
      return localStorage.getItem('orra:me');
    } catch {
      return null;
    }
  })();
  const testWorkspace = selectedId === TEST || selectedId === LEGACY_TEST_ID;
  const storageKey = testWorkspace ? TEST_LS_KEY : MAIN_LS_KEY;
  let pending: number | undefined;
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('orra-mock') : null;
  let current: Dataset | null = null;

  const persist = () => {
    if (pending) clearTimeout(pending);
    pending = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(current));
      } catch {}
      channel?.postMessage({ type: 'sync' });
    }, 150);
  };

  return {
    kind: 'mock',
    async load() {
      const fresh = testWorkspace ? seedTestDataset() : seedDataset();
      try {
        const raw = localStorage.getItem(storageKey);
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
            // Development identities can be added after a browser has already
            // saved its mock dataset. Backfill those profiles without clearing
            // or replacing any of the user's local test data.
            if (import.meta.env.DEV) {
              const savedEmails = new Set(out.profiles.map((p) => p.email.toLowerCase()));
              out.profiles = [
                ...out.profiles,
                ...fresh.profiles.filter((p) => !savedEmails.has(p.email.toLowerCase())),
              ];
            }
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
          const raw = localStorage.getItem(storageKey);
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
