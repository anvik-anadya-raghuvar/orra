import { describe, expect, it } from 'vitest';
import { createProject, defaultProjectId, ensurePersonalProjectId, personalProjectIds } from './projects';
import type { AppStore } from './store';
import type { Project } from '../types';

const project = (over: Partial<Project>): Project => ({
  id: 'p1',
  name: 'Anvik',
  color: 'var(--indigo)',
  description: '',
  is_personal: false,
  created_at: '2026-06-01T09:00:00.000Z',
  ...over,
});

/** Just enough store to watch what gets written. */
function stubStore() {
  const inserted: { table: string; row: Record<string, unknown> }[] = [];
  const store = {
    insert: (table: string, row: Record<string, unknown>) => inserted.push({ table, row }),
    asMe: () => ({}),
  } as unknown as AppStore;
  return { store, inserted };
}

describe('createProject', () => {
  it('makes a shared project by default — that is what every picker means', () => {
    const { store, inserted } = stubStore();
    createProject(store, [], 'Registry');
    expect(inserted[0].table).toBe('projects');
    expect(inserted[0].row.is_personal).toBe(false);
    expect(inserted[0].row.name).toBe('Registry');
  });

  it('can make a personal one — the flag no writer could set before', () => {
    const { store, inserted } = stubStore();
    createProject(store, [], 'Personal', true);
    expect(inserted[0].row.is_personal).toBe(true);
  });

  it('trims the typed name', () => {
    const { store, inserted } = stubStore();
    createProject(store, [], '  Consumer  ');
    expect(inserted[0].row.name).toBe('Consumer');
  });
});

describe('ensurePersonalProjectId', () => {
  it('creates one named Personal when the workspace has none', () => {
    // Production's actual state: business projects exist, personal ones do not,
    // so every is_personal filter in the app reads an empty set.
    const { store, inserted } = stubStore();
    const projects = [project({ id: 'p1' }), project({ id: 'p2', name: 'Registry' })];
    const id = ensurePersonalProjectId(store, projects);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].row.name).toBe('Personal');
    expect(inserted[0].row.is_personal).toBe(true);
    expect(id).toBe(inserted[0].row.id);
  });

  it('reuses the existing one rather than making a second', () => {
    const { store, inserted } = stubStore();
    const projects = [project({ id: 'mine', name: 'Life', is_personal: true })];
    expect(ensurePersonalProjectId(store, projects)).toBe('mine');
    expect(inserted).toHaveLength(0);
  });

  it('keeps a renamed personal project — oldest wins, no re-auto-naming', () => {
    const { store, inserted } = stubStore();
    const projects = [
      project({ id: 'newer', name: 'Milan', is_personal: true, created_at: '2026-08-01T09:00:00.000Z' }),
      project({ id: 'older', name: 'Life', is_personal: true, created_at: '2026-06-01T09:00:00.000Z' }),
    ];
    expect(ensurePersonalProjectId(store, projects)).toBe('older');
    expect(inserted).toHaveLength(0);
  });

  it('never hands back a business project', () => {
    const { store } = stubStore();
    const projects = [project({ id: 'biz' })];
    expect(ensurePersonalProjectId(store, projects)).not.toBe('biz');
  });
});

describe('the personal/business fence', () => {
  it('defaultProjectId stays on the business side, personalProjectIds on the other', () => {
    const projects = [
      project({ id: 'life', name: 'Life', is_personal: true, created_at: '2026-05-01T09:00:00.000Z' }),
      project({ id: 'biz', name: 'Anvik' }),
    ];
    expect(defaultProjectId(projects)).toBe('biz');
    expect([...personalProjectIds(projects)]).toEqual(['life']);
  });
});
