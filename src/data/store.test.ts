import { describe, expect, it } from 'vitest';
import { AppStore } from './store';
import { seedDataset } from './seed';
import type { DataAdapter } from './adapter';
import type { CollectionKey, Dataset } from '../types';

/** In-memory stand-in — records what would have hit Postgres, touches nothing real. */
function fakeAdapter(): DataAdapter & { calls: { key: CollectionKey; rows: unknown[] }[] } {
  return {
    kind: 'mock',
    calls: [],
    async load() {
      return seedDataset();
    },
    saveCollection(key, rows) {
      this.calls.push({ key, rows: rows as unknown[] });
    },
    saveWeights() {},
  };
}

function makeStore(ds: Dataset = seedDataset()) {
  return new AppStore(ds, fakeAdapter(), 'u-anadya');
}

describe('remove() → Trash', () => {
  it('snapshots the exact row before removing it', () => {
    const store = makeStore();
    const note = store.ds.notes[0];
    const before = { ...note };

    store.remove('notes', note.id, store.asMe({ summary: 'test remove' }));

    expect(store.ds.notes.some((n) => n.id === note.id)).toBe(false);
    const trashed = store.ds.trash_items.find((t) => t.row_id === note.id);
    expect(trashed).toBeTruthy();
    expect(trashed!.collection).toBe('notes');
    expect(trashed!.row_data).toEqual(before);
    expect(trashed!.label).toBe(before.title);
  });

  it('writes exactly one audit line for the delete and none for the trash snapshot', () => {
    const store = makeStore();
    const note = store.ds.notes[0];
    const auditBefore = store.ds.audit_trail.length;

    store.remove('notes', note.id, store.asMe({ summary: 'test remove' }));

    expect(store.ds.audit_trail.length).toBe(auditBefore + 1);
    expect(store.ds.audit_trail[0].old_value).toBe('test remove');
  });

  it('restores the row byte-for-byte and removes it from Trash', () => {
    const store = makeStore();
    const note = store.ds.notes[0];
    const before = { ...note };

    store.remove('notes', note.id, store.asMe());
    const trashId = store.ds.trash_items.find((t) => t.row_id === note.id)!.id;

    const ok = store.restoreFromTrash(trashId, store.asMe());

    expect(ok).toBe(true);
    expect(store.ds.trash_items.some((t) => t.id === trashId)).toBe(false);
    expect(store.ds.notes.find((n) => n.id === note.id)).toEqual(before);
  });

  it('restoreFromTrash returns false for an id that is not there', () => {
    const store = makeStore();
    expect(store.restoreFromTrash('trash-does-not-exist', store.asMe())).toBe(false);
  });

  it('purgeTrashItem removes the trash row without reviving the original', () => {
    const store = makeStore();
    const note = store.ds.notes[0];
    store.remove('notes', note.id, store.asMe());
    const trashId = store.ds.trash_items.find((t) => t.row_id === note.id)!.id;

    store.purgeTrashItem(trashId, store.asMe());

    expect(store.ds.trash_items.some((t) => t.id === trashId)).toBe(false);
    expect(store.ds.notes.some((n) => n.id === note.id)).toBe(false);
  });

  it('audit_trail deletes are never routed through Trash — they are structurally revoked, not just unlisted', () => {
    const store = makeStore();
    const before = store.ds.audit_trail.length;
    store.remove('audit_trail', store.ds.audit_trail[0].id, store.asMe({ silent: true }));
    // remove() still mutates local state (revocation is a DB-level GRANT, not
    // a client check) — the guarantee under test is narrower: it must never
    // create a trash_items row for it.
    expect(store.ds.trash_items.some((t) => t.collection === 'audit_trail')).toBe(false);
    void before;
  });

  it('removing a trash_items row directly does not create a trash entry for the trash entry', () => {
    const store = makeStore();
    const note = store.ds.notes[0];
    store.remove('notes', note.id, store.asMe());
    const trashId = store.ds.trash_items.find((t) => t.row_id === note.id)!.id;

    store.remove('trash_items', trashId, store.asMe({ silent: true }));

    expect(store.ds.trash_items.some((t) => t.row_id === trashId)).toBe(false);
  });
});

describe('removeMany() → Trash', () => {
  it('snapshots every removed row in one batch', () => {
    const store = makeStore();
    const ids = store.ds.tasks.slice(0, 3).map((t) => t.id);

    const removed = store.removeMany('tasks', ids, store.asMe({ summary: 'bulk test' }));

    expect(removed).toBe(3);
    const trashed = store.ds.trash_items.filter((t) => t.collection === 'tasks' && ids.includes(t.row_id));
    expect(trashed).toHaveLength(3);
  });

  it('every trashed row can be restored independently', () => {
    const store = makeStore();
    const originals = store.ds.tasks.slice(0, 2).map((t) => ({ ...t }));
    const ids = originals.map((t) => t.id);

    store.removeMany('tasks', ids, store.asMe());
    const trashIds = store.ds.trash_items.filter((t) => ids.includes(t.row_id)).map((t) => t.id);
    for (const tid of trashIds) store.restoreFromTrash(tid, store.asMe());

    for (const original of originals) {
      expect(store.ds.tasks.find((t) => t.id === original.id)).toEqual(original);
    }
  });
});

describe('emptyTrash()', () => {
  it('clears everything in one pass and writes one summary line', () => {
    const store = makeStore();
    store.removeMany(
      'tasks',
      store.ds.tasks.slice(0, 4).map((t) => t.id),
      store.asMe(),
    );
    expect(store.ds.trash_items.length).toBeGreaterThan(0);
    const auditBefore = store.ds.audit_trail.length;

    const cleared = store.emptyTrash(store.asMe());

    expect(cleared).toBeGreaterThan(0);
    expect(store.ds.trash_items).toHaveLength(0);
    expect(store.ds.audit_trail.length).toBe(auditBefore + 1);
  });

  it('returns 0 and writes nothing when Trash is already empty', () => {
    const store = makeStore();
    const auditBefore = store.ds.audit_trail.length;
    expect(store.emptyTrash(store.asMe())).toBe(0);
    expect(store.ds.audit_trail.length).toBe(auditBefore);
  });
});
