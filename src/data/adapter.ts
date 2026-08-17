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
}

export function pickAdapter(): Promise<DataAdapter> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (url && key) {
    return import('./supabaseAdapter').then((m) => m.createSupabaseAdapter(url, key));
  }
  return import('./mockAdapter').then((m) => m.createMockAdapter());
}
