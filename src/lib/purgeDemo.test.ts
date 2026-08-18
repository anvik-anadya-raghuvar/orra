import { describe, expect, it } from 'vitest';
import { AppStore } from '../data/store';
import { seedDataset } from '../data/seed';
import type { DataAdapter } from '../data/adapter';
import type { CollectionKey } from '../types';
import { PURGE_ORDER, planPurge, purgeDemo } from './purgeDemo';

describe('PURGE_ORDER', () => {
  it('deletes tasks before objectives and key_results', () => {
    // tasks.objective_id has no ON DELETE CASCADE (migration 0001) — a demo
    // task still pointing at a demo objective makes Postgres reject the
    // objective's delete. Regression guard for the exact bug that made purged
    // objectives silently reappear on reload: this order used to be reversed.
    const at = (k: CollectionKey) => PURGE_ORDER.indexOf(k);
    expect(at('tasks')).toBeGreaterThanOrEqual(0);
    expect(at('tasks')).toBeLessThan(at('objectives'));
    expect(at('tasks')).toBeLessThan(at('key_results'));
  });
});

/** Confirms every delete, recording the order collections were actually awaited in. */
function sequencedAdapter(log: CollectionKey[], failFor: CollectionKey | null = null): DataAdapter {
  return {
    kind: 'mock',
    async load() {
      return seedDataset();
    },
    saveCollection() {},
    saveWeights() {},
    async deleteRows(key) {
      log.push(key);
      if (key === failFor) return `foreign key violation on ${key}`;
      return null;
    },
  };
}

describe('purgeDemo()', () => {
  it('awaits each collection before starting the next, in PURGE_ORDER', async () => {
    const log: CollectionKey[] = [];
    const store = new AppStore(seedDataset(), sequencedAdapter(log), 'u-anadya');
    const plan = await planPurge(store);

    await purgeDemo(store);

    const expectedOrder = plan.hits.map((h) => h.key);
    expect(log).toEqual(expectedOrder);
  });

  it('removes everything and reports no failures when every delete is confirmed', async () => {
    const store = new AppStore(seedDataset(), sequencedAdapter([]), 'u-anadya');
    const plan = await planPurge(store);

    const result = await purgeDemo(store);

    expect(result.removed).toBe(plan.total);
    expect(result.failures).toHaveLength(0);
    expect(store.ds.trash_items.length).toBe(plan.total);
  });

  it('a blocked collection is reported and left untouched; everything else still goes through', async () => {
    const log: CollectionKey[] = [];
    const store = new AppStore(seedDataset(), sequencedAdapter(log, 'objectives'), 'u-anadya');
    const plan = await planPurge(store);
    const objectivesHit = plan.hits.find((h) => h.key === 'objectives')!;

    const result = await purgeDemo(store);

    expect(result.failures).toEqual([
      { key: 'objectives', ids: objectivesHit.ids, error: 'foreign key violation on objectives' },
    ]);
    expect(result.removed).toBe(plan.total - objectivesHit.ids.length);
    // The one thing this whole fix exists for: a failed collection keeps its rows.
    expect(store.ds.objectives).toHaveLength(objectivesHit.ids.length);
    expect(store.ds.trash_items.some((t) => t.collection === 'objectives')).toBe(false);
  });

  it('writes one audit line that names the failure count, not a silent full-success claim', async () => {
    const store = new AppStore(seedDataset(), sequencedAdapter([], 'objectives'), 'u-anadya');
    await purgeDemo(store);
    const line = store.ds.audit_trail.find((a) => a.entity_type === 'demo_data');
    expect(line?.new_value).toContain('1 collection failed');
  });
});
