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
 * Leaf-first, so a child row is gone before its parent it would otherwise
 * block. Most of these relationships are `ON DELETE CASCADE` in the schema,
 * where order genuinely doesn't matter — but `tasks.objective_id` has no
 * cascade (migration 0001), so a task still pointing at a demo objective
 * makes Postgres reject the objective's delete outright. `tasks` therefore
 * has to go before `objectives` and `key_results`, not after: the previous
 * order had it last, which meant every purge attempt deleted the objective
 * while a demo task still referenced it, failed with a foreign-key
 * violation, and — because the delete wasn't confirmed before the UI
 * updated — looked like it had worked until the next reload proved it hadn't.
 *
 * Deliberately absent:
 *  - `profiles`, `projects`, `sprints` — structure, not content (principle 8:
 *    projects are seeded rows, never enum constants)
 *  - `tags` — free-form and possibly already in use on rows you created
 *  - `integration_grants` — your live Google connection
 *  - `audit_trail` — append-only at the database level; DELETE is revoked
 *  - `personal_order_events` — immutable parsed evidence; DELETE is revoked
 */
export const PURGE_ORDER: CollectionKey[] = [
  'annotation_pins',
  'screenshot_attachments',
  'comments',
  'subtasks',
  'task_links',
  'day_events',
  'day_plans',
  'tasks',
  'time_logs',
  'key_results',
  'objectives',
  'course_items',
  'courses',
  'page_comments',
  'pages',
  'people_interactions',
  'people',
  'personal_orders',
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
  'pulse_items',
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

export interface PurgeFailure {
  key: CollectionKey;
  ids: string[];
  /** The real Postgres error, so "it came back" has an answer instead of a shrug. */
  error: string;
}

export interface PurgeResult {
  removed: number;
  failures: PurgeFailure[];
}

/**
 * Remove every seeded row still present — one collection at a time, each
 * delete awaited and confirmed before the next starts.
 *
 * Sequential and awaited on purpose: collections in `PURGE_ORDER` are ordered
 * so a child clears before a parent that would otherwise block it, and that
 * ordering only holds if each delete actually finishes before the next one
 * fires. The previous version fired all of them at once and trusted every
 * one had worked — this one only ever calls a row "removed" once Postgres
 * has said so, and reports exactly which collections it couldn't and why,
 * rather than a silent partial success that quietly undoes itself on reload.
 */
export async function purgeDemo(store: AppStore): Promise<PurgeResult> {
  const plan = await planPurge(store);
  let removed = 0;
  const failures: PurgeFailure[] = [];
  for (const { key, ids } of plan.hits) {
    const result = await store.removeManyConfirmed(key, ids, store.asMe({ silent: true }));
    removed += result.removed;
    if (result.error) failures.push({ key, ids, error: result.error });
  }
  if (removed) {
    const summary = failures.length
      ? `Demo content removed — ${removed} rows across ${plan.hits.length - failures.length} collections (${failures.length} collection${failures.length === 1 ? '' : 's'} failed, see below)`
      : `Demo content removed — ${removed} seeded rows across ${plan.hits.length} collections`;
    store.note('demo_data', summary, store.asMe());
  }
  return { removed, failures };
}

/** "mail_items" → "mail items", for the confirmation list. */
export const prettyKey = (k: CollectionKey | string) => k.replace(/_/g, ' ');
