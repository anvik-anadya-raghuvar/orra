import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { makeTask } from './taskFactory';
import {
  actionLabel,
  applyToSelection,
  buildPreview,
  nextMonday,
  overdueTasks,
  proposeChange,
  toggleAll,
  toggleSelected,
  undecide,
} from './triage';

const ME = 'me';
const THEM = 'them';
const TODAY = '2026-09-24'; // a Thursday

function task(id: string, over: Partial<Task> = {}): Task {
  return makeTask({ id, title: `Task ${id}`, project_id: 'p1', created_by: ME, ...over });
}

describe('nextMonday', () => {
  it('lands on the coming Monday from every weekday', () => {
    expect(nextMonday('2026-09-24')).toBe('2026-09-28'); // Thu
    expect(nextMonday('2026-09-26')).toBe('2026-09-28'); // Sat
    expect(nextMonday('2026-09-27')).toBe('2026-09-28'); // Sun
  });
  it('is a week out when today is already Monday', () => {
    expect(nextMonday('2026-09-28')).toBe('2026-10-05');
  });
  it('crosses month and year boundaries', () => {
    expect(nextMonday('2026-12-31')).toBe('2027-01-04');
  });
});

describe('overdueTasks', () => {
  it('keeps only my open tasks due before today, oldest first', () => {
    const tasks = [
      task('A', { due_date: '2026-09-20' }),
      task('B', { due_date: '2026-09-10' }),
      task('C', { due_date: TODAY }), // due today is not overdue
      task('D', { due_date: '2026-09-01', status: 'done' }),
      task('E', { due_date: null }),
      task('F', { due_date: '2026-09-01', assignee_ids: [THEM], assignee_id: THEM }),
      task('G', { due_date: '2026-09-02', created_by: THEM, assignee_ids: [ME], assignee_id: ME }),
      // Unassigned counts as the creator's.
      task('H', { due_date: '2026-09-03', assignee_ids: [], assignee_id: null }),
      task('I', { due_date: '2026-09-03', created_by: THEM, assignee_ids: [], assignee_id: null }),
    ];
    expect(overdueTasks(tasks, ME, TODAY).map((t) => t.id)).toEqual(['G', 'H', 'B', 'A']);
  });
});

describe('proposeChange', () => {
  const t = task('A', { due_date: '2026-09-20' });
  it('moves to today and to next Monday', () => {
    expect(proposeChange(t, { kind: 'today' }, TODAY)).toMatchObject({
      fromDue: '2026-09-20',
      toDue: TODAY,
      patch: { due_date: TODAY },
      markDone: false,
    });
    expect(proposeChange(t, { kind: 'nextMonday' }, TODAY)?.toDue).toBe('2026-09-28');
  });
  it('clears the due date', () => {
    expect(proposeChange(t, { kind: 'clear' }, TODAY)).toMatchObject({
      toDue: null,
      patch: { due_date: null },
    });
  });
  it('picks a date, ignoring a malformed one', () => {
    expect(proposeChange(t, { kind: 'date', date: '2026-10-02' }, TODAY)?.toDue).toBe('2026-10-02');
    expect(proposeChange(t, { kind: 'date', date: '' }, TODAY)).toBeNull();
  });
  it('marks done without touching the date', () => {
    expect(proposeChange(t, { kind: 'done' }, TODAY)).toMatchObject({
      markDone: true,
      toDue: '2026-09-20',
      patch: { status: 'done', progress_pct: 100 },
    });
  });
  it('drops a no-op', () => {
    expect(proposeChange(t, { kind: 'date', date: '2026-09-20' }, TODAY)).toBeNull();
  });
});

describe('selection and preview', () => {
  const tasks = [
    task('A', { due_date: '2026-09-10' }),
    task('B', { due_date: '2026-09-12' }),
    task('C', { due_date: '2026-09-14' }),
  ];

  it('toggles single ids and all', () => {
    let sel = toggleSelected(new Set(), 'A');
    expect([...sel]).toEqual(['A']);
    sel = toggleSelected(sel, 'A');
    expect(sel.size).toBe(0);
    sel = toggleAll(sel, ['A', 'B', 'C']);
    expect(sel.size).toBe(3);
    sel = toggleAll(sel, ['A', 'B', 'C']);
    expect(sel.size).toBe(0);
  });

  it('bulk-applies to the selection only, and per-row overrides win after', () => {
    let plan = applyToSelection({}, new Set(['A', 'C']), { kind: 'today' });
    plan = { ...plan, C: { kind: 'done' } };
    const preview = buildPreview(tasks, plan, TODAY);
    expect(preview.map((c) => [c.taskId, c.fromDue, c.toDue, c.markDone])).toEqual([
      ['A', '2026-09-10', TODAY, false],
      ['C', '2026-09-14', '2026-09-14', true],
    ]);
    expect(buildPreview(tasks, undecide(plan, 'A'), TODAY).map((c) => c.taskId)).toEqual(['C']);
  });

  it('is empty until something is decided — nothing moves by default', () => {
    expect(buildPreview(tasks, {}, TODAY)).toEqual([]);
  });

  it('labels actions', () => {
    expect(actionLabel({ kind: 'nextMonday' }, TODAY)).toBe('Next Monday (2026-09-28)');
    expect(actionLabel({ kind: 'clear' }, TODAY)).toBe('No due date');
  });
});
