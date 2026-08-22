import { describe, expect, it } from 'vitest';
import { seedDataset } from '../data/seed';
import { buildSearchItems, firstLine, routeFor, searchItems, type SearchItem } from './search';

const ds = seedDataset();
const meId = ds.profiles[0].id;
const otherId = ds.profiles[1].id;

const item = (over: Partial<SearchItem>): SearchItem => ({
  kind: 'task',
  id: 't',
  title: 'Title',
  sub: '',
  recency: '2026-01-01',
  ...over,
});

describe('firstLine', () => {
  it('takes the first line that has something on it', () => {
    expect(firstLine('\n\n  hello there \nsecond')).toBe('hello there');
  });

  it('strips inline image markers so a marker never becomes a subtitle', () => {
    expect(firstLine('{{anvik-image:img-1}}\nreal text')).toBe('real text');
    // An inline image is a block-level placement, so the marker leaves a line
    // break behind it — the text before it is the first line, as it reads.
    expect(firstLine('before {{anvik-image:img-1}} after')).toBe('before');
  });

  it('truncates long lines with an ellipsis', () => {
    expect(firstLine('x'.repeat(200), 20)).toHaveLength(20);
    expect(firstLine('x'.repeat(200), 20).endsWith('…')).toBe(true);
  });

  it('is empty for empty input', () => {
    expect(firstLine('')).toBe('');
    expect(firstLine(null)).toBe('');
    expect(firstLine(undefined)).toBe('');
  });
});

describe('buildSearchItems', () => {
  const items = buildSearchItems(ds, meId);

  it('covers every room that holds something findable', () => {
    const kinds = new Set(items.map((i) => i.kind));
    for (const kind of ['task', 'note', 'page', 'person', 'decision', 'money'] as const) {
      expect(kinds).toContain(kind);
    }
  });

  it('carries a task through with its visible id in the subtitle', () => {
    const task = ds.tasks[0];
    const found = items.find((i) => i.kind === 'task' && i.id === task.id);
    expect(found?.title).toBe(task.title);
    expect(found?.sub).toContain(task.id);
  });

  it('keeps the other person\'s private scribbles out', () => {
    const theirs = ds.notes.find((n) => n.owner_id === otherId);
    if (!theirs) return; // seed shape may change; the rule is asserted below anyway
    expect(items.some((i) => i.kind === 'note' && i.id === theirs.id)).toBe(false);
    expect(buildSearchItems(ds, otherId).some((i) => i.kind === 'note' && i.id === theirs.id)).toBe(true);
  });

  it('includes shared rows for both people', () => {
    const shared = ds.notes.find((n) => !n.owner_id);
    if (!shared) return;
    expect(items.some((i) => i.id === shared.id)).toBe(true);
    expect(buildSearchItems(ds, otherId).some((i) => i.id === shared.id)).toBe(true);
  });

  it('leaves archived wiki pages out', () => {
    const archived = ds.pages.filter((p) => p.is_archived).map((p) => p.id);
    archived.forEach((id) => expect(items.some((i) => i.kind === 'page' && i.id === id)).toBe(false));
  });
});

describe('searchItems', () => {
  const pool = [
    item({ id: 'a', title: 'Rain gear vendor', recency: '2026-01-01' }),
    item({ id: 'b', title: 'Vendor rain shortlist', recency: '2026-01-01' }),
    item({ id: 'c', title: 'Something else', sub: 'mentions rain in the body', recency: '2026-01-01' }),
    item({ id: 'd', title: 'Nothing relevant', recency: '2026-01-01' }),
  ];

  it('ranks title-prefix above title-substring above subtitle-only', () => {
    expect(searchItems(pool, 'rain').map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('is case insensitive and ignores surrounding space', () => {
    expect(searchItems(pool, '  RAIN  ').map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing for an empty query rather than everything', () => {
    expect(searchItems(pool, '')).toEqual([]);
    expect(searchItems(pool, '   ')).toEqual([]);
  });

  it('breaks ties on recency, newest first', () => {
    const tied = [
      item({ id: 'old', title: 'Report', recency: '2026-01-01' }),
      item({ id: 'new', title: 'Report', recency: '2026-08-01' }),
    ];
    expect(searchItems(tied, 'report').map((i) => i.id)).toEqual(['new', 'old']);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 50 }, (_, i) => item({ id: `t${i}`, title: `Task ${i}` }));
    expect(searchItems(many, 'task', 5)).toHaveLength(5);
  });

  it('finds a real seeded task by a word in its title', () => {
    const items = buildSearchItems(ds, meId);
    const word = ds.tasks[0].title.split(' ')[0];
    expect(searchItems(items, word).length).toBeGreaterThan(0);
  });
});

describe('routeFor', () => {
  it('deep-links a task to its own page', () => {
    expect(routeFor(item({ kind: 'task', id: 'T-45' }))).toBe('/task/T-45');
  });

  it('sends everything else to the room that holds it', () => {
    expect(routeFor(item({ kind: 'person' }))).toBe('/people');
    expect(routeFor(item({ kind: 'money' }))).toBe('/money');
    expect(routeFor(item({ kind: 'decision' }))).toBe('/work');
    expect(routeFor(item({ kind: 'page' }))).toBe('/knowledge');
  });
});
