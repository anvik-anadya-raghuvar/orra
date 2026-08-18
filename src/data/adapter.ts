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
