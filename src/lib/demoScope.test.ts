import { describe, expect, it } from 'vitest';
import { seedDataset } from '../data/seed';
import type { Dataset } from '../types';
import { DEMO_USER_ID, demoIdIndex, showsDemo, withoutDemo } from './demoScope';

const demo = demoIdIndex(seedDataset());

describe('who sees the worked example', () => {
  it('is the test account only', () => {
    expect(showsDemo(DEMO_USER_ID)).toBe(true);
    expect(showsDemo('u-anadya')).toBe(false);
    expect(showsDemo('u-raghuvar')).toBe(false);
  });
});

describe('the shared rooms are clean for a real member', () => {
  const seeded = seedDataset();

  it('empties People — a person you never met should not be in your contacts', () => {
    expect(seeded.people.length).toBeGreaterThan(0);
    expect(withoutDemo(seeded, demo).people).toHaveLength(0);
  });

  it('empties Money — a ledger you never posted should not be in your books', () => {
    expect(seeded.ledger.length).toBeGreaterThan(0);
    expect(withoutDemo(seeded, demo).ledger).toHaveLength(0);
  });

  it('empties the thread — a conversation you never had should not be in Us', () => {
    expect(seeded.messages.length).toBeGreaterThan(0);
    expect(withoutDemo(seeded, demo).messages).toHaveLength(0);
  });

  it('empties tasks, notes and decisions', () => {
    const clean = withoutDemo(seeded, demo);
    expect(clean.tasks).toHaveLength(0);
    expect(clean.notes).toHaveLength(0);
    expect(clean.decisions).toHaveLength(0);
  });
});

describe('what the scope must never take', () => {
  const clean = withoutDemo(seedDataset(), demo);

  it('keeps the projects — hiding one would leave real tasks pointing at nothing', () => {
    expect(clean.projects.length).toBeGreaterThan(0);
  });

  it('keeps both profiles', () => {
    expect(clean.profiles.length).toBeGreaterThan(0);
  });

  it('keeps anything created since, whatever it is called', () => {
    const withMine: Dataset = {
      ...seedDataset(),
      tasks: [
        ...seedDataset().tasks,
        { id: 'T-999', title: 'Rain-gear vendor shortlist' } as Dataset['tasks'][number],
      ],
    };
    // same title as a seeded task on purpose: matching is by id, never text
    const out = withoutDemo(withMine, demo);
    expect(out.tasks.map((t) => t.id)).toEqual(['T-999']);
  });
});

describe('filtering is cheap and stable', () => {
  it('returns the very same object when there is nothing to hide', () => {
    const mine = { tasks: [{ id: 'T-999' }] } as unknown as Partial<Dataset>;
    // React re-renders on identity, so an unchanged pass must not allocate
    expect(withoutDemo(mine, demo)).toBe(mine);
  });

  it('scopes a realtime partial the same way as a full load', () => {
    const partial = { people: seedDataset().people } as Partial<Dataset>;
    expect(withoutDemo(partial, demo).people).toHaveLength(0);
  });
});
