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

/**
 * Collections a delete must never route through Trash.
 *
 * `audit_trail` has DELETE revoked at the database (principle 3) — trashing
 * a row from it would be a lie, since it could never actually be removed.
 * `trash_items` is exempt so restoring one doesn't create a trash entry for
 * the trash entry.
 */
const TRASH_EXEMPT = new Set<CollectionKey>(['audit_trail', 'trash_items']);

/** Best-effort human label for a trashed row — whatever field reads like a title. */
function trashLabel(key: string, row: Record<string, unknown>): string {
  const candidates = ['title', 'name', 'subject', 'question', 'label', 'text', 'summary', 'item'];
  for (const f of candidates) {
    const v = row[f];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return `${key.replace(/_/g, ' ').replace(/s$/, '')} ${row.id ?? ''}`.trim();
}

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
  private syncErrorListeners = new Set<(msg: string | null) => void>();
  meId: UserId;
  /** Last background save/delete failure, if any — surfaced by a banner rather than swallowed. */
  syncError: string | null = null;

  constructor(ds: Dataset, adapter: DataAdapter, meId: UserId) {
    this.ds = ds;
    this.adapter = adapter;
    this.meId = meId;
  }

  subscribeSyncError = (cb: (msg: string | null) => void) => {
    this.syncErrorListeners.add(cb);
    return () => this.syncErrorListeners.delete(cb);
  };

  /** A write to the backend failed — every UI surface stays reactive to the store, so route it there. */
  reportSyncError(msg: string | null) {
    this.syncError = msg;
    this.syncErrorListeners.forEach((cb) => cb(msg));
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
      pulse_items: 'pulse_item',
      task_links: 'task_link',
      sprints: 'sprint',
      pages: 'page',
      page_comments: 'page_comment',
      integration_grants: 'integration_grant',
      trash_items: 'trash_item',
    };
    return irregular[key] ?? key.replace(/s$/, '');
  }

  /**
   * Render one field value for the trail.
   *
   * `String(value)` turns any object into the literal text "[object Object]",
   * and `audit_trail` has UPDATE and DELETE revoked at the database level
   * (principle 3), so a value logged wrong is logged wrong forever. Objects —
   * personalization, a win-condition list, a layout — serialise as JSON instead.
   */
  private auditValue(value: unknown): string | null {
    if (value == null) return null;
    if (Array.isArray(value)) {
      return value.every((v) => v == null || typeof v !== 'object')
        ? value.join(', ')
        : JSON.stringify(value);
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
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
          old_value: this.auditValue(oldVal),
          new_value: this.auditValue(newVal),
          source: meta.source ?? 'portal',
        });
      }
    }
    this.emit();
  }

  remove<K extends CollectionKey>(key: K, id: string, meta: MutationMeta) {
    const rows = this.ds[key] as Row[];
    const before = rows.find((r) => r.id === id);
    if (!before) return;
    this.ds = { ...this.ds, [key]: rows.filter((r) => r.id !== id) as Dataset[K] };
    this.adapter.saveCollection(key, this.ds[key]);
    if (!TRASH_EXEMPT.has(key)) this.snapshotToTrash(key, [before], meta);
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

  /**
   * Snapshot rows into Trash before they're gone for good.
   *
   * One state update and one `saveCollection` call for however many rows are
   * being removed — `removeMany` on 126 demo rows should not mean 126 writes
   * here either. Writes no audit line of its own: the delete this accompanies
   * already writes the visible one, and a second "trashed" line per row would
   * double every entry in the trail.
   */
  private snapshotToTrash(key: CollectionKey, rows: Row[], meta: MutationMeta) {
    if (!rows.length) return;
    const now = nowIso();
    const items = rows.map((row) => {
      const data = row as unknown as Record<string, unknown>;
      return {
        id: newId('trash'),
        collection: key,
        row_id: row.id,
        row_data: data,
        label: trashLabel(key, data),
        deleted_by: meta.actor,
        deleted_by_label: meta.actorLabel,
        deleted_at: now,
      };
    });
    this.ds = { ...this.ds, trash_items: [...this.ds.trash_items, ...items] };
    this.adapter.saveCollection('trash_items', this.ds.trash_items, items);
  }

  /** Put a trashed row back where it came from. False if it's gone from Trash already. */
  restoreFromTrash(trashId: string, meta: MutationMeta): boolean {
    const item = this.ds.trash_items.find((t) => t.id === trashId);
    if (!item) return false;
    const key = item.collection as CollectionKey;
    const rows = this.ds[key] as Row[];
    // The id could only collide if something new reused it — ids are
    // timestamp-derived, so treat that as "already handled" rather than clobber it.
    if (!rows.some((r) => r.id === item.row_id)) {
      const restored = item.row_data as unknown as Row;
      this.ds = { ...this.ds, [key]: [...rows, restored] as Dataset[CollectionKey] };
      this.adapter.saveCollection(key, this.ds[key], [restored]);
    }
    this.ds = { ...this.ds, trash_items: this.ds.trash_items.filter((t) => t.id !== trashId) };
    this.adapter.saveCollection('trash_items', this.ds.trash_items);
    if (!meta.silent) {
      this.audit({
        actor_id: meta.actor,
        actor_label: meta.actorLabel,
        entity_type: this.entityType(key),
        entity_id: item.row_id,
        field_name: null,
        old_value: null,
        new_value: meta.summary ?? `Restored from trash — ${item.label}`,
        source: meta.source ?? 'portal',
      });
    }
    this.emit();
    return true;
  }

  /** Delete a trash entry for good — the one action Trash cannot undo. */
  purgeTrashItem(trashId: string, meta: MutationMeta) {
    const item = this.ds.trash_items.find((t) => t.id === trashId);
    if (!item) return;
    this.ds = { ...this.ds, trash_items: this.ds.trash_items.filter((t) => t.id !== trashId) };
    this.adapter.saveCollection('trash_items', this.ds.trash_items);
    if (!meta.silent) {
      this.note('trash_item', meta.summary ?? `Permanently deleted — ${item.label}`, meta);
      return;
    }
    this.emit();
  }

  /** Empty the whole bin for good. Same single-line-not-a-hundred rule as removeMany. */
  emptyTrash(meta: MutationMeta) {
    const count = this.ds.trash_items.length;
    if (!count) return 0;
    this.ds = { ...this.ds, trash_items: [] };
    this.adapter.saveCollection('trash_items', this.ds.trash_items);
    if (!meta.silent) this.note('trash_item', meta.summary ?? `Trash emptied — ${count} rows gone for good`, meta);
    else this.emit();
    return count;
  }

  /**
   * Remove many rows from one collection in a single pass.
   *
   * One state update and one `saveCollection` call, so the Supabase adapter
   * issues a single `delete().in('id', …)` instead of one round-trip per row.
   * Row-level audit is deliberately skipped — a bulk purge writes one summary
   * line via `note()` rather than a hundred, which keeps the append-only trail
   * readable (and it cannot be tidied up afterwards).
   */
  removeMany<K extends CollectionKey>(key: K, ids: string[], meta: MutationMeta) {
    if (!ids.length) return 0;
    const drop = new Set(ids);
    const rows = this.ds[key] as Row[];
    const gone = rows.filter((r) => drop.has(r.id));
    const kept = rows.filter((r) => !drop.has(r.id));
    const removed = rows.length - kept.length;
    if (!removed) return 0;
    this.ds = { ...this.ds, [key]: kept as Dataset[K] };
    this.adapter.saveCollection(key, this.ds[key]);
    if (!TRASH_EXEMPT.has(key)) this.snapshotToTrash(key, gone, meta);
    if (!meta.silent) {
      this.audit({
        actor_id: meta.actor,
        actor_label: meta.actorLabel,
        entity_type: this.entityType(key),
        entity_id: `${removed} rows`,
        field_name: null,
        old_value: meta.summary ?? `${removed} rows removed`,
        new_value: null,
        source: meta.source ?? 'portal',
      });
    }
    this.emit();
    return removed;
  }

  /** Append one free-standing line to the trail — for things no single row owns. */
  note(entityType: string, summary: string, meta: MutationMeta) {
    this.audit({
      actor_id: meta.actor,
      actor_label: meta.actorLabel,
      entity_type: entityType,
      entity_id: '-',
      field_name: null,
      old_value: null,
      new_value: summary,
      source: meta.source ?? 'portal',
    });
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

/**
 * Boot state machine: 'loading' shows a skeleton, 'error' shows a retry
 * screen instead of hanging blank forever, 'ready' mounts the app.
 *
 * A blank white screen with nothing in it is the single worst failure mode
 * this app can have — it looks identical to "still loading" and to "broken",
 * and there is no way back in short of knowing to open devtools. Every path
 * through boot must end in one of these three states, never in limbo.
 */
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<AppStore | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setBootError(null);
    (async () => {
      try {
        const adapter = await pickAdapter();
        const ds = await adapter.load();
        if (!alive) return;
        let me = ds.profiles[0]?.id ?? 'u-anadya';
        // Real auth wins: the signed-in Supabase email decides who "me" is.
        const email = await adapter.authedEmail?.();
        const authed = email
          ? ds.profiles.find((p) => p.email.toLowerCase() === email.toLowerCase())
          : null;
        if (authed) {
          me = authed.id;
        } else {
          // A local "signed in" flag with no real Supabase session behind it
          // (expired token, revoked session) must not render an empty app as
          // if that were the truth — send it back to the sign-in screen,
          // where signing in again gets a token that actually works.
          if (adapter.kind === 'supabase') {
            try {
              localStorage.removeItem('anvik:signedin');
            } catch {}
          }
          try {
            const saved = localStorage.getItem('anvik:me');
            if (saved && ds.profiles.some((p) => p.id === saved)) me = saved;
          } catch {}
        }
        const s = new AppStore(ds, adapter, me);
        adapter.onRemoteChange?.((partial) => s.applyRemote(partial));
        adapter.onSyncError?.((msg) => s.reportSyncError(msg));
        setStore(s);
      } catch (e) {
        if (!alive) return;
        setBootError(e instanceof Error ? e.message : 'Could not load the portal.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (bootError) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>Couldn't load the portal</p>
          <p style={{ fontSize: 13.5, color: 'var(--slate)', marginBottom: 16 }}>{bootError}</p>
          <button className="btn solid" type="button" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!store) return null; // App shows its own skeleton until provider mounts
  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}

/** Reactive: the last background save/delete failure, or null once it clears. */
export function useSyncError(): string | null {
  const store = useStore();
  const [err, setErr] = useState(store.syncError);
  useEffect(() => {
    const unsub = store.subscribeSyncError(setErr);
    return () => {
      unsub();
    };
  }, [store]);
  return err;
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
