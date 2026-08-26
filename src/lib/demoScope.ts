/**
 * Keeping the worked example inside the test workspace.
 *
 * The demo content (migration 0011) is attributed to test@orra.ops, but it
 * lives in the same tables as everything else — so the shared rooms showed it
 * to everyone: Ludhiana Steel sat in People, a ledger you never posted sat in
 * Money, and a conversation you never had sat in the Us thread.
 *
 * Now it is scoped. Signed in as the test account you get the whole prototype;
 * signed in as yourself you get your own workspace, empty until you fill it.
 * Nothing is deleted — the demo is a fixture to look at, not debris to clear.
 *
 * What counts as demo is `seedDataset()`, the same manifest purgeDemo.ts uses:
 * a row is demo only if its id came from the seed. Anything you create is
 * invisible to this by construction, whatever it is called.
 */
import type { CollectionKey, Dataset } from '../types';
import { PURGE_ORDER } from './purgeDemo';

/** The demo/test account seeded by 0004 and written to by 0011. */
export const DEMO_USER_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Collections the scope covers. PURGE_ORDER is the shared definition of
 * "content the worked example created"; `profiles`, `projects` and `sprints`
 * are deliberately outside it, being structure rather than content — hiding a
 * project would leave real tasks pointing at nothing.
 */
export const DEMO_SCOPED: CollectionKey[] = PURGE_ORDER;

export type DemoIds = Map<CollectionKey, Set<string>>;

/** Index the seed once, so filtering is a set lookup per row. */
export function demoIdIndex(seed: Dataset): DemoIds {
  const index: DemoIds = new Map();
  for (const key of DEMO_SCOPED) {
    const rows = (seed[key] ?? []) as { id: string }[];
    index.set(key, new Set(rows.map((r) => r.id)));
  }
  return index;
}

/**
 * A view of `ds` with the worked example removed. Returns the same object when
 * there is nothing to hide, so React sees no spurious change.
 */
export function withoutDemo<T extends Partial<Dataset>>(ds: T, demo: DemoIds): T {
  let changed = false;
  const out: Record<string, unknown> = { ...ds };
  for (const [key, ids] of demo) {
    const rows = (ds as Partial<Dataset>)[key] as { id: string }[] | undefined;
    if (!rows?.length) continue;
    const kept = rows.filter((r) => !ids.has(r.id));
    if (kept.length !== rows.length) {
      out[key] = kept;
      changed = true;
    }
  }
  return changed ? (out as T) : ds;
}

/** True when this person should see the worked example: only the test account. */
export function showsDemo(userId: string): boolean {
  return userId === DEMO_USER_ID;
}
