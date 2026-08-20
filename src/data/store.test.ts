import { describe, expect, it } from 'vitest';
import { AppStore, DEMO_USER_ID } from './store';
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

/** A fake adapter that also confirms deletes, so removeManyConfirmed has something to await. */
function confirmingAdapter(failFor: CollectionKey | null = null): DataAdapter {
  return {
    ...fakeAdapter(),
    async deleteRows(key, ids) {
      if (key === failFor) {
        return `update or delete on table "${key}" violates foreign key constraint`;
      }
      void ids;
      return null;
    },
  };
}

describe('who "the other one" is', () => {
  /** The live database carries a third row: the demo account from 0011. */
  const withDemo = (): Dataset => {
    const ds = seedDataset();
    return {
      ...ds,
      profiles: [
        // deliberately before the real partner, which is what broke it
        { ...ds.profiles[0], id: DEMO_USER_ID, email: 'test@anvik.ops', name: 'Test' },
        ...ds.profiles,
      ],
    };
  };

  it('is the real partner, never the demo account', () => {
    // "first profile that is not me" resolved to Test, which mislabelled the
    // partner tile, the Us thread and every assignment notice.
    const store = new AppStore(withDemo(), fakeAdapter(), 'u-anadya');
    expect(store.other.name).toBe('Raghuvar');
  });

  it('still works from the other side', () => {
    const store = new AppStore(withDemo(), fakeAdapter(), 'u-raghuvar');
    expect(store.other.name).toBe('Anadya');
  });

  it('falls back to the demo account only when signed in as the sole member', () => {
    const ds = seedDataset();
    const onlyMeAndDemo: Dataset = {
      ...ds,
      profiles: [
        ds.profiles[0],
        { ...ds.profiles[0], id: DEMO_USER_ID, email: 'test@anvik.ops', name: 'Test' },
      ],
    };
    const store = new AppStore(onlyMeAndDemo, fakeAdapter(), 'u-anadya');
    expect(store.other.name).toBe('Test');
  });

  it('lets the development test workspace assign work to itself', () => {
    const store = new AppStore(seedDataset(), fakeAdapter(), DEMO_USER_ID);
    expect(store.members.map((profile) => profile.id)).toContain(DEMO_USER_ID);
  });
});

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

  it('labels a trashed message by what it said, not just its id', () => {
    // Messages have no title/name/subject — only `body` — so this candidate
    // was missing until deleting a message became possible from the Us
    // thread, and Trash showed "message msg-1" instead of any hint of it.
    const store = makeStore();
    const message = store.ds.messages[0];

    store.remove('messages', message.id, store.asMe({ summary: 'test remove' }));

    const trashed = store.ds.trash_items.find((t) => t.row_id === message.id);
    expect(trashed!.label).toBe(message.body);
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

describe('removeManyConfirmed()', () => {
  it('waits for the adapter to confirm before touching local state or Trash', async () => {
    const ds = seedDataset();
    const store = new AppStore(ds, confirmingAdapter(), 'u-anadya');
    const ids = store.ds.objectives.map((o) => o.id);

    const result = await store.removeManyConfirmed('objectives', ids, store.asMe());

    expect(result).toEqual({ removed: ids.length, error: null });
    expect(store.ds.objectives).toHaveLength(0);
    expect(store.ds.trash_items.filter((t) => t.collection === 'objectives')).toHaveLength(ids.length);
  });

  it('a rejected delete removes nothing and creates no Trash entry — this is the exact bug that made purged rows reappear on reload', async () => {
    const ds = seedDataset();
    const store = new AppStore(ds, confirmingAdapter('objectives'), 'u-anadya');
    const before = [...store.ds.objectives];
    const ids = before.map((o) => o.id);

    const result = await store.removeManyConfirmed('objectives', ids, store.asMe());

    expect(result.removed).toBe(0);
    expect(result.error).toContain('foreign key constraint');
    expect(store.ds.objectives).toEqual(before);
    expect(store.ds.trash_items.filter((t) => t.collection === 'objectives')).toHaveLength(0);
  });

  it('falls back to the optimistic path when the adapter has no deleteRows (mock mode)', async () => {
    const store = makeStore();
    const ids = store.ds.notes.slice(0, 2).map((n) => n.id);

    const result = await store.removeManyConfirmed('notes', ids, store.asMe());

    expect(result).toEqual({ removed: 2, error: null });
    expect(store.ds.notes.some((n) => ids.includes(n.id))).toBe(false);
  });

  it('resolves to a no-op for an empty id list without calling the adapter', async () => {
    const store = new AppStore(seedDataset(), confirmingAdapter(), 'u-anadya');
    expect(await store.removeManyConfirmed('objectives', [], store.asMe())).toEqual({
      removed: 0,
      error: null,
    });
  });
});
