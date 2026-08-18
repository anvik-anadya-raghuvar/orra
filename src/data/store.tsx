import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { AuditSource, CollectionKey, Dataset, RankingWeights, UserId } from '../types';
import type { DataAdapter } from './adapter';
import { pickAdapter } from './adapter';

let idCounter = 0;
export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export const nowIso = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);

type Row = { id: string };

export interface MutationMeta {
  actor: UserId | null;
  actorLabel: string;
  source?: AuditSource;
  /** Human summary for insert/remove audit rows. */
  summary?: string;
  /** Skip the audit trail (e.g. UI-only prefs like course expansion). */
  silent?: boolean;
}

/**
 * Central in-memory store. Every mutation goes through insert/update/remove,
 * which append audit_trail rows automatically (principle 3: append-only trail).
 */
export class AppStore {
  ds: Dataset;
  adapter: DataAdapter;
  private listeners = new Set<() => void>();
  meId: UserId;

  constructor(ds: Dataset, adapter: DataAdapter, meId: UserId) {
    this.ds = ds;
    this.adapter = adapter;
    this.meId = meId;
  }

  get me() {
    return this.ds.profiles.find((p) => p.id === this.meId) ?? this.ds.profiles[0];
  }
  get other() {
    return this.ds.profiles.find((p) => p.id !== this.meId) ?? this.ds.profiles[0];
  }
  setMe(id: UserId) {
    this.meId = id;
    try {
      localStorage.setItem('anvik:me', id);
    } catch {}
    this.emit();
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = () => this.ds;
  private emit() {
    this.listeners.forEach((cb) => cb());
  }

  /** Collection key → singular entity_type label for the trail. */
  private entityType(key: string): string {
    const irregular: Record<string, string> = {
      import_batches: 'import_batch',
      people: 'person',
      people_interactions: 'person_interaction',
      daily_closeouts: 'daily_closeout',
      audit_trail: 'audit_entry',
      ranking_weights: 'ranking_weights',
      reading_queue: 'reading_item',
      life_admin: 'life_admin_item',
      shared_daily: 'shared_daily',
      day_plans: 'day_plan',
      day_events: 'day_event',
    };
    return irregular[key] ?? key.replace(/s$/, '');
  }

  private audit(entry: Omit<Dataset['audit_trail'][number], 'id' | 'occurred_at'>) {
    const row = { ...entry, id: newId('a'), occurred_at: nowIso() };
    this.ds = { ...this.ds, audit_trail: [row, ...this.ds.audit_trail] };
    this.adapter.saveCollection('audit_trail', this.ds.audit_trail, [row]);
  }

  insert<K extends CollectionKey>(key: K, row: Dataset[K][number], meta: MutationMeta) {
    this.ds = { ...this.ds, [key]: [...(this.ds[key] as Row[]), row] as Dataset[K] };
    this.adapter.saveCollection(key, this.ds[key], [row]);
    if (!meta.silent) {
      this.audit({
        actor_id: meta.actor,
        actor_label: meta.actorLabel,
        entity_type: this.entityType(key),
        entity_id: (row as Row).id,
        field_name: null,
        old_value: null,
        new_value: meta.summary ?? `${key.replace(/_/g, ' ').replace(/s$/, '')} created`,
        source: meta.source ?? 'portal',
      });
    }
    this.emit();
    return row;
  }

  update<K extends CollectionKey>(
    key: K,
    id: string,
    patch: Partial<Dataset[K][number]>,
    meta: MutationMeta,
  ) {
    const rows = this.ds[key] as Row[];
    const before = rows.find((r) => r.id === id);
    if (!before) return;
    const after = { ...before, ...patch } as Row & Record<string, unknown>;
    if ('updated_at' in before) (after as Record<string, unknown>).updated_at = nowIso();
    this.ds = {
      ...this.ds,
      [key]: rows.map((r) => (r.id === id ? after : r)) as Dataset[K],
    };
    this.adapter.saveCollection(key, this.ds[key], [after]);
    if (!meta.silent) {
      for (const [field, newVal] of Object.entries(patch)) {
        const oldVal = (before as Record<string, unknown>)[field];
        if (JSON.stringify(oldVal) === JSON.stringify(newVal)) continue;
        this.audit({
          actor_id: meta.actor,
          actor_label: meta.actorLabel,
          entity_type: this.entityType(key),
          entity_id: id,
          field_name: field,
          old_value: oldVal == null ? null : String(Array.isArray(oldVal) ? oldVal.join(', ') : oldVal),
          new_value: newVal == null ? null : String(Array.isArray(newVal) ? newVal.join(', ') : newVal),
          source: meta.source ?? 'portal',
        });
      }
    }
    this.emit();
  }

  remove<K extends CollectionKey>(key: K, id: string, meta: MutationMeta) {
    const rows = this.ds[key] as Row[];
    if (!rows.some((r) => r.id === id)) return;
    this.ds = { ...this.ds, [key]: rows.filter((r) => r.id !== id) as Dataset[K] };
    this.adapter.saveCollection(key, this.ds[key]);
    if (!meta.silent) {
      this.audit({
        actor_id: meta.actor,
        actor_label: meta.actorLabel,
        entity_type: this.entityType(key),
        entity_id: id,
        field_name: null,
        old_value: meta.summary ?? 'removed',
        new_value: null,
        source: meta.source ?? 'portal',
      });
    }
    this.emit();
  }

  setWeights(patch: Partial<RankingWeights>, meta: MutationMeta) {
    const before = this.ds.ranking_weights;
    const after = { ...before, ...patch, updated_at: nowIso() };
    this.ds = { ...this.ds, ranking_weights: after };
    this.adapter.saveWeights(after);
    if (!meta.silent) {
      for (const f of ['objective_fit', 'unblocks', 'deadline'] as const) {
        if (before[f] !== after[f]) {
          this.audit({
            actor_id: meta.actor,
            actor_label: meta.actorLabel,
            entity_type: 'ranking_weights',
            entity_id: '1',
            field_name: f,
            old_value: String(before[f]),
            new_value: String(after[f]),
            source: meta.source ?? 'portal',
          });
        }
      }
    }
    this.emit();
  }

  /** Next visible task id — single global counter, T-### (matches prototype). */
  nextTaskId(): string {
    const max = this.ds.tasks
      .map((t) => parseInt(t.id.replace(/^T-/, ''), 10))
      .filter((n) => !isNaN(n))
      .reduce((a, b) => Math.max(a, b), 100);
    return `T-${max + 1}`;
  }

  /** Meta helper for the signed-in user. */
  asMe(extra?: Partial<MutationMeta>): MutationMeta {
    return { actor: this.meId, actorLabel: this.me.name, source: 'portal', ...extra };
  }

  applyRemote(partial: Partial<Dataset>) {
    this.ds = { ...this.ds, ...partial };
    this.emit();
  }
}

const StoreCtx = createContext<AppStore | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<AppStore | null>(null);
  useEffect(() => {
    let alive = true;
    pickAdapter().then(async (adapter) => {
      const ds = await adapter.load();
      if (!alive) return;
      let me = ds.profiles[0]?.id ?? 'u-anadya';
      try {
        const saved = localStorage.getItem('anvik:me');
        if (saved && ds.profiles.some((p) => p.id === saved)) me = saved;
      } catch {}
      const s = new AppStore(ds, adapter, me);
      adapter.onRemoteChange?.((partial) => s.applyRemote(partial));
      setStore(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!store) return null; // App shows its own skeleton until provider mounts
  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}

export function useStore(): AppStore {
  const s = useContext(StoreCtx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}

/** Reactive dataset hook — ds is referentially stable between mutations. */
export function useDataset(): Dataset {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** Reactive selector (applied outside the snapshot so fresh derived objects are fine). */
export function useData<T>(selector: (ds: Dataset, store: AppStore) => T): T {
  const store = useStore();
  const ds = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return selector(ds, store);
}
