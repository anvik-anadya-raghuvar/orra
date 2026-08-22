import { describe, expect, it } from 'vitest';
import type { Task, TaskRepeat } from '../types';
import { seedDataset } from '../data/seed';
import { describeRepeat, nextDueDate, nextOccurrenceFields, normalizeRepeat } from './repeat';

const TODAY = '2026-08-22';
const every = (n: number, unit: TaskRepeat['unit']): TaskRepeat => ({ every: n, unit });

const task = (over: Partial<Task>): Task => ({
  ...seedDataset().tasks[0],
  id: 'T-1',
  title: 'Pay the rent',
  status: 'done',
  due_date: TODAY,
  repeat: every(1, 'month'),
  ...over,
});

describe('describeRepeat', () => {
  it('reads naturally at one and at many', () => {
    expect(describeRepeat(every(1, 'week'))).toBe('Every week');
    expect(describeRepeat(every(2, 'week'))).toBe('Every 2 weeks');
    expect(describeRepeat(every(1, 'day'))).toBe('Every day');
    expect(describeRepeat(null)).toBe('Does not repeat');
  });
});

describe('normalizeRepeat', () => {
  it('keeps a good value and rejects nonsense', () => {
    expect(normalizeRepeat(every(3, 'day'))).toEqual({ every: 3, unit: 'day' });
    expect(normalizeRepeat(null)).toBeNull();
    expect(normalizeRepeat({ every: 0, unit: 'day' })).toBeNull();
    expect(normalizeRepeat({ every: 2, unit: 'fortnight' } as unknown as TaskRepeat)).toBeNull();
  });

  it('clamps a silly interval rather than trusting it', () => {
    expect(normalizeRepeat({ every: 9999, unit: 'day' })).toEqual({ every: 30, unit: 'day' });
    expect(normalizeRepeat({ every: 2.6, unit: 'day' })).toEqual({ every: 3, unit: 'day' });
  });
});

describe('nextDueDate', () => {
  it('advances by days and weeks', () => {
    expect(nextDueDate(TODAY, every(1, 'day'), TODAY)).toBe('2026-08-23');
    expect(nextDueDate(TODAY, every(1, 'week'), TODAY)).toBe('2026-08-29');
    expect(nextDueDate(TODAY, every(2, 'week'), TODAY)).toBe('2026-09-05');
  });

  it('advances by months and rolls the year', () => {
    expect(nextDueDate('2026-08-22', every(1, 'month'), TODAY)).toBe('2026-09-22');
    expect(nextDueDate('2026-11-15', every(3, 'month'), '2026-11-15')).toBe('2027-02-15');
  });

  it('clamps a month-end date instead of skipping into the next month', () => {
    // The classic drift: 31 Jan + 1 month must be 28 Feb, not 3 March.
    expect(nextDueDate('2026-01-31', every(1, 'month'), '2026-01-31')).toBe('2026-02-28');
    // 2028 is a leap year.
    expect(nextDueDate('2028-01-31', every(1, 'month'), '2028-01-31')).toBe('2028-02-29');
    expect(nextDueDate('2026-03-31', every(1, 'month'), '2026-03-31')).toBe('2026-04-30');
  });

  it('counts from today when the task never had a due date', () => {
    expect(nextDueDate(null, every(1, 'week'), TODAY)).toBe('2026-08-29');
    expect(nextDueDate('', every(2, 'day'), TODAY)).toBe('2026-08-24');
  });

  it('keeps advancing past today, so a late task does not spawn a late one', () => {
    // Four months overdue: the next one must be in the future, not March.
    const next = nextDueDate('2026-02-10', every(1, 'month'), TODAY);
    expect(next > TODAY).toBe(true);
    expect(next).toBe('2026-09-10');
  });

  it('always lands strictly after today, never on it', () => {
    expect(nextDueDate('2026-08-21', every(1, 'day'), TODAY)).toBe('2026-08-23');
  });
});

describe('nextOccurrenceFields', () => {
  it('gives nothing back for a task that does not repeat', () => {
    expect(nextOccurrenceFields(task({ repeat: null }), TODAY)).toEqual({});
    expect(nextOccurrenceFields(task({ repeat: undefined }), TODAY)).toEqual({});
  });

  it('carries what the work is', () => {
    const next = nextOccurrenceFields(
      task({ title: 'Pay the rent', description: 'Bank transfer', tags: ['money'], priority: 'high' }),
      TODAY,
    );
    expect(next.title).toBe('Pay the rent');
    expect(next.description).toBe('Bank transfer');
    expect(next.tags).toEqual(['money']);
    expect(next.priority).toBe('high');
  });

  it('carries the repeat, so the chain continues', () => {
    expect(nextOccurrenceFields(task({ repeat: every(2, 'week') }), TODAY).repeat).toEqual({
      every: 2,
      unit: 'week',
    });
  });

  it('resets how the last one went', () => {
    const next = nextOccurrenceFields(
      task({
        status: 'done',
        progress_pct: 100,
        sprint_id: 'sprint-1',
        start_date: '2026-08-01',
        is_stuck: true,
        blocked_reason: 'waiting on the bank',
        acknowledged_at: '2026-08-02',
        pushback_reason: 'too much',
      }),
      TODAY,
    );
    expect(next.status).toBe('backlog');
    expect(next.progress_pct).toBe(0);
    expect(next.sprint_id).toBeNull();
    expect(next.start_date).toBeNull();
    expect(next.is_stuck).toBe(false);
    expect(next.blocked_reason).toBeNull();
    expect(next.acknowledged_at).toBeNull();
    expect(next.pushback_reason).toBeNull();
  });

  it('sets the advanced due date', () => {
    expect(nextOccurrenceFields(task({ due_date: TODAY, repeat: every(1, 'week') }), TODAY).due_date).toBe(
      '2026-08-29',
    );
  });

  it('does not carry the old id, so the caller must mint a new one', () => {
    expect(nextOccurrenceFields(task({}), TODAY).id).toBeUndefined();
  });
});
