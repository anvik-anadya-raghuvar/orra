/**
 * Removing the seeded demo content.
 *
 * The portal shipped with a worked example — Ludhiana Steel, the Milan
 * consulate mail, T-42 — so no screen was ever blank while it was being built.
 * That content is attributed to the two real profiles, which is exactly wrong
 * once the portal is actually in use: a person you never met should not sit in
 * People, and a mail you never received should not sit above your real inbox.
 *
 * How it decides what is demo: `seedDataset()` IS the manifest. A row is demo
 * only if its id appears in the seed, so anything created since — a task you
 * typed, a message you sent, a mail Gmail synced — can never be caught by it.
 * There is no pattern matching and no date heuristic.
 */

import type { AppStore } from '../data/store';
import type { CollectionKey, Dataset } from '../types';

/**
 * Leaf-first, so a child row is gone before its parent. Postgres would cascade
 * most of these anyway, but ordering means we never depend on that.
 *
 * Deliberately absent:
 *  - `profiles`, `projects`, `sprints` — structure, not content (principle 8:
 *    projects are seeded rows, never enum constants)
 *  - `tags` — free-form and possibly already in use on rows you created
 *  - `integration_grants` — your live Google connection
 *  - `audit_trail` — append-only at the database level; DELETE is revoked
 */
export const PURGE_ORDER: CollectionKey[] = [
  'annotation_pins',
  'screenshot_attachments',
  'comments',
  'subtasks',
  'task_links',
  'time_logs',
  'key_results',
  'objectives',
  'course_items',
  'courses',
  'page_comments',
  'pages',
  'people_interactions',
  'people',
  'mail_items',
  'notes',
  'decisions',
  'documents',
  'messages',
  'shared_daily',
  'reading_queue',
  'life_admin',
  'fixed_dates',
  'ledger',
  'import_batches',
  'automation_rules',
  'daily_closeouts',
  'day_events',
  'day_plans',
  'pulse_items',
  'tasks',
];

export interface PurgePlan {
  /** Per collection: the ids present in your data that came from the seed. */
  hits: { key: CollectionKey; ids: string[] }[];
  total: number;
}

let seedCache: Dataset | null = null;

/** The seed, loaded on demand — it is data, and no screen should pay for it. */
async function loadSeed(): Promise<Dataset> {
  if (!seedCache) {
    const m = await import('../data/seed');
    seedCache = m.seedDataset();
  }
  return seedCache;
}

/** What a purge would remove, without removing anything. */
export async function planPurge(store: AppStore): Promise<PurgePlan> {
  const seed = await loadSeed();
  const hits: PurgePlan['hits'] = [];
  let total = 0;
  for (const key of PURGE_ORDER) {
    const seeded = new Set((seed[key] as { id: string }[]).map((r) => r.id));
    const ids = (store.ds[key] as { id: string }[]).filter((r) => seeded.has(r.id)).map((r) => r.id);
    if (ids.length) {
      hits.push({ key, ids });
      total += ids.length;
    }
  }
  return { hits, total };
}

/** Remove every seeded row still present. Returns how many actually went. */
export async function purgeDemo(store: AppStore): Promise<number> {
  const plan = await planPurge(store);
  let removed = 0;
  for (const { key, ids } of plan.hits) {
    removed += store.removeMany(key, ids, store.asMe({ silent: true }));
  }
  if (removed) {
    store.note(
      'demo_data',
      `Demo content removed — ${removed} seeded rows across ${plan.hits.length} collections`,
      store.asMe(),
    );
  }
  return removed;
}

/** "mail_items" → "mail items", for the confirmation list. */
export const prettyKey = (k: CollectionKey | string) => k.replace(/_/g, ' ');
