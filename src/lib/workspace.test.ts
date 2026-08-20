import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import {
  awaitingThem,
  handoffState,
  inboxTasks,
  isMyTask,
  myTasks,
  ownRows,
  priorityDiffers,
  unclaimedRows,
} from './workspace';

const ME = 'u-anadya';
const THEM = 'u-raghuvar';

const task = (p: Partial<Task>): Task =>
  ({
    id: 'T-1',
    title: 't',
    assignee_id: ME,
    created_by: ME,
    acknowledged_at: null,
    ...p,
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

describe('the handoff between the two people', () => {
  const pushed = (p: Partial<Task>) => ({ ...task({}), assignee_id: ME, created_by: THEM, ...p });

  it('calls work you assigned yourself "mine", never a pending handoff', () => {
    // otherwise half of everyone's own board would sit in an inbox
    expect(handoffState(task({ assignee_id: ME, created_by: ME }))).toBe('mine');
    expect(handoffState({ ...task({}), assignee_id: null, created_by: ME })).toBe('mine');
  });

  it('walks waiting → accepted', () => {
    expect(handoffState(pushed({}))).toBe('waiting');
    expect(handoffState(pushed({ acknowledged_at: '2026-08-19T04:00:00Z' }))).toBe('accepted');
  });

  it('reports a pushed-back task as pushed back, not as still waiting', () => {
    expect(handoffState(pushed({ pushback_reason: 'not this week' }))).toBe('pushed_back');
  });

  it('lets acceptance win over a stale pushback', () => {
    // accepting clears both columns, but a row that somehow carried each must
    // still resolve one way rather than reading as two live states
    const both = pushed({ acknowledged_at: '2026-08-19T04:00:00Z', pushback_reason: 'old' });
    expect(handoffState(both)).toBe('accepted');
  });

  it('shows the assigner what the other person has not taken yet', () => {
    const all = [
      // pushed at them, untouched
      { ...task({}), id: 'T-1', assignee_id: THEM, created_by: ME },
      // pushed at them and handed back — still mine to chase
      { ...task({}), id: 'T-2', assignee_id: THEM, created_by: ME, pushback_reason: 'busy' },
      // they accepted it, so it is off my plate
      { ...task({}), id: 'T-3', assignee_id: THEM, created_by: ME, acknowledged_at: 'x' },
      // my own work
      { ...task({}), id: 'T-4', assignee_id: ME, created_by: ME },
      // theirs entirely
      { ...task({}), id: 'T-5', assignee_id: THEM, created_by: THEM },
    ];
    expect(awaitingThem(all, ME).map((t) => t.id)).toEqual(['T-1', 'T-2']);
  });

  it('never lists a task in both inboxes at once', () => {
    const all = [
      { ...task({}), id: 'T-1', assignee_id: ME, created_by: THEM },
      { ...task({}), id: 'T-2', assignee_id: THEM, created_by: ME },
    ];
    const mine = new Set(inboxTasks(all, ME).map((t) => t.id));
    const chasing = new Set(awaitingThem(all, ME).map((t) => t.id));
    expect([...mine].filter((id) => chasing.has(id))).toEqual([]);
  });

  it('flags a priority disagreement only when there is one', () => {
    expect(priorityDiffers(task({ priority: 'urgent' }))).toBe(false);
    expect(priorityDiffers(task({ priority: 'urgent', accepted_priority: 'urgent' }))).toBe(false);
    expect(priorityDiffers(task({ priority: 'urgent', accepted_priority: 'normal' }))).toBe(true);
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
