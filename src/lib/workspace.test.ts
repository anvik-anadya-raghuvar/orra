import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import {
  assignedOut,
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

describe('what I handed to the other person', () => {
  it('keeps listing a task after they accept it', () => {
    // the whole point: awaitingThem drops this row, assignedOut must not
    const accepted = {
      ...task({}),
      id: 'T-1',
      assignee_id: THEM,
      created_by: ME,
      acknowledged_at: '2026-08-20T09:00:00Z',
    };
    expect(awaitingThem([accepted], ME)).toEqual([]);
    expect(assignedOut([accepted], ME).map((t) => t.id)).toEqual(['T-1']);
  });

  it('excludes my own work and work they assigned themselves', () => {
    const all = [
      { ...task({}), id: 'T-1', assignee_id: THEM, created_by: ME },
      { ...task({}), id: 'T-2', assignee_id: ME, created_by: ME },
      { ...task({}), id: 'T-3', assignee_id: THEM, created_by: THEM },
      { ...task({}), id: 'T-4', assignee_id: null, created_by: ME },
    ];
    expect(assignedOut(all, ME).map((t) => t.id)).toEqual(['T-1']);
  });

  it('is the mirror image for the other person', () => {
    const all = [
      { ...task({}), id: 'T-1', assignee_id: THEM, created_by: ME },
      { ...task({}), id: 'T-2', assignee_id: ME, created_by: THEM },
    ];
    expect(assignedOut(all, ME).map((t) => t.id)).toEqual(['T-1']);
    expect(assignedOut(all, THEM).map((t) => t.id)).toEqual(['T-2']);
  });

  it('never overlaps with my own board', () => {
    const all = [
      { ...task({}), id: 'T-1', assignee_id: THEM, created_by: ME },
      { ...task({}), id: 'T-2', assignee_id: ME, created_by: ME },
    ];
    const mine = new Set(myTasks(all, ME).map((t) => t.id));
    expect(assignedOut(all, ME).filter((t) => mine.has(t.id))).toEqual([]);
  });
});

describe('a task shared by both of them (0045)', () => {
  const both = (p: Partial<Task> = {}) =>
    task({ assignee_id: ME, assignee_ids: [ME, THEM], ...p });

  it('shows on both boards — that is the point of allowing it', () => {
    expect(isMyTask(both(), ME)).toBe(true);
    expect(isMyTask(both(), THEM)).toBe(true);
  });

  it('still keeps a single-assignee task off the other board', () => {
    const only = task({ assignee_id: ME, assignee_ids: [ME] });
    expect(isMyTask(only, THEM)).toBe(false);
  });

  it('reads a row written before 0045 from its primary alone', () => {
    const legacy = task({ assignee_id: THEM, assignee_ids: undefined });
    expect(isMyTask(legacy, THEM)).toBe(true);
    expect(isMyTask(legacy, ME)).toBe(false);
  });

  it('needs no acceptance when the author is one of the holders', () => {
    // Sharing a task with someone is not handing it to them.
    expect(handoffState(both({ created_by: ME }))).toBe('mine');
  });

  it('is still a handoff when the author kept none of it', () => {
    expect(handoffState(task({ assignee_id: THEM, assignee_ids: [THEM], created_by: ME }))).toBe('waiting');
  });

  it('puts a shared task in the other person’s inbox only if they did not write it', () => {
    expect(inboxTasks([both({ created_by: ME })], THEM).map((t) => t.id)).toEqual(['T-1']);
    expect(inboxTasks([both({ created_by: ME })], ME)).toEqual([]);
  });

  it('counts a shared task as handed out, since someone else is on it', () => {
    expect(assignedOut([both({ created_by: ME })], ME).map((t) => t.id)).toEqual(['T-1']);
  });
});
