import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { inboxTasks, isMyTask, myTasks, ownRows, unclaimedRows } from './workspace';

const ME = 'u-anadya';
const THEM = 'u-raghuvar';

const task = (p: Partial<Task>): Task =>
  ({
    id: 'T-1',
    title: 't',
    assignee_id: ME,
    created_by: ME,
    acknowledged_at: null,
  }) as Task;

describe('a task belongs to exactly one workspace', () => {
  it('follows the assignee', () => {
    expect(isMyTask(task({ assignee_id: ME }), ME)).toBe(true);
    expect(isMyTask({ ...task({}), assignee_id: THEM }, ME)).toBe(false);
  });

  it('falls back to the author when nobody is assigned', () => {
    // the alternative is a task owned by nobody, which shows on neither board
    const orphan = { ...task({}), assignee_id: null, created_by: ME };
    expect(isMyTask(orphan, ME)).toBe(true);
    expect(isMyTask(orphan, THEM)).toBe(false);
  });

  it('gives every task to one of the two boards, never both or neither', () => {
    const all = [
      { ...task({}), id: 'T-1', assignee_id: ME, created_by: THEM },
      { ...task({}), id: 'T-2', assignee_id: THEM, created_by: ME },
      { ...task({}), id: 'T-3', assignee_id: null, created_by: THEM },
    ];
    const mine = myTasks(all, ME).length;
    const theirs = myTasks(all, THEM).length;
    expect(mine + theirs).toBe(all.length);
  });
});

describe('the assignment inbox', () => {
  it('holds only unacknowledged work the other person pushed at me', () => {
    const all = [
      { ...task({}), id: 'T-1', assignee_id: ME, created_by: THEM },
      // mine already, not an arrival
      { ...task({}), id: 'T-2', assignee_id: ME, created_by: ME },
      // arrived, but I already said "got it"
      { ...task({}), id: 'T-3', assignee_id: ME, created_by: THEM, acknowledged_at: '2026-08-19T04:00:00Z' },
      // theirs
      { ...task({}), id: 'T-4', assignee_id: THEM, created_by: THEM },
    ];
    expect(inboxTasks(all, ME).map((t) => t.id)).toEqual(['T-1']);
  });

  it('leaves the task on my board either way', () => {
    const arrived = { ...task({}), assignee_id: ME, created_by: THEM };
    expect(isMyTask(arrived, ME)).toBe(true);
  });
});

describe('owned rows', () => {
  const rows = [
    { id: 'a', owner_id: ME },
    { id: 'b', owner_id: THEM },
    { id: 'c', owner_id: null },
  ];

  it('shows mine plus anything unclaimed', () => {
    expect(ownRows(rows, ME).map((r) => r.id)).toEqual(['a', 'c']);
    expect(ownRows(rows, THEM).map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('treats a missing owner_id like an unclaimed row', () => {
    // rows written before 0012 have no column value at all
    const legacy: { id: string; owner_id?: string | null }[] = [{ id: 'legacy' }];
    expect(ownRows(legacy, ME).map((r) => r.id)).toEqual(['legacy']);
  });

  it('lists what still needs claiming', () => {
    expect(unclaimedRows(rows).map((r) => r.id)).toEqual(['c']);
  });
});
