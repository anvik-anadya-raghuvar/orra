import type { Dataset, CollectionKey } from '../types';

/**
 * Single swappable data boundary (plan §4 Step 1 mock-data condition).
 * The store talks only to this interface. `mock` persists to localStorage;
 * `supabase` maps each collection to its table and mirrors realtime changes.
 */
export interface DataAdapter {
  readonly kind: 'mock' | 'supabase';
  load(): Promise<Dataset>;
  /** Persist one changed collection (mock: whole-set debounce; supabase: row upserts). */
  saveCollection<K extends CollectionKey>(key: K, rows: Dataset[K], changed?: unknown[]): void;
  saveWeights(w: Dataset['ranking_weights']): void;
  /** Called with a callback to receive externally-originated changes (realtime). */
  onRemoteChange?(cb: (partial: Partial<Dataset>) => void): () => void;
  /** Supabase only: the signed-in auth email, so the store can pick the right profile. */
  authedEmail?(): Promise<string | null>;
  /**
   * Called with a callback to receive background write/delete failures.
   * `saveCollection`/`saveWeights` are fire-and-forget (the UI updates
   * optimistically) — without this, a failed write is indistinguishable from
   * a successful one until the row silently reverts on the next reload.
   */
  onSyncError?(cb: (msg: string) => void): void;
  /**
   * Delete rows and WAIT for Postgres to confirm it, returning the error
   * message on failure or null on success. Supabase only — the mock adapter
   * has no network round trip to fail, so callers must treat a missing
   * `deleteRows` as "there is nothing to confirm, trust the optimistic path".
   *
   * `saveCollection`'s delete branch is deliberately NOT this: it is
   * fire-and-forget by design, for the common case of removing one row from
   * a screen where a rare failure surfaces via the sync-error banner. A bulk
   * purge across many collections needs the opposite guarantee — it must
   * never report success (or move a row into Trash) for a delete Postgres
   * actually rejected, e.g. a foreign key still pointing at it.
   */
  deleteRows?(key: CollectionKey, ids: string[]): Promise<string | null>;
}

export async function pickAdapter(): Promise<DataAdapter> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && key) {
    // One shared client — a second one would fight over the auth session and
    // break the password-recovery link.
    const [{ getSupabase }, m] = await Promise.all([
      import('../lib/supabaseClient'),
      import('./supabaseAdapter'),
    ]);
    return m.createSupabaseAdapter(await getSupabase());
  }
  const m = await import('./mockAdapter');
  return m.createMockAdapter();
}
