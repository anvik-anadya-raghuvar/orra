import { describe, expect, it } from 'vitest';
import type { DayPlanItem, Task } from '../types';
import { intentionsFor, itemDone, itemLabel, nextPosition, planIsSaved } from './dayPlan';

const ME = 'u-anadya';
const TODAY = '2026-08-19';

const item = (p: Partial<DayPlanItem>): DayPlanItem => ({
  id: 'i-1',
  user_id: ME,
  date: TODAY,
  task_id: null,
  text: '',
  done: false,
  position: 0,
  source: 'manual',
  created_at: '2026-08-19T08:00:00Z',
  ...p,
});

const task = (p: Partial<Task>): Task =>
  ({ id: 'T-1', title: 'Ship it', status: 'todo', ...p }) as Task;

describe('todays intentions', () => {
  it('are mine, for today, in order', () => {
    const all = [
      item({ id: 'a', position: 2, text: 'second' }),
      item({ id: 'b', position: 1, text: 'first' }),
      item({ id: 'c', user_id: 'u-raghuvar', text: 'theirs' }),
      item({ id: 'd', date: '2026-08-18', text: 'yesterday' }),
    ];
    const got = intentionsFor({ day_plan_items: all } as never, ME, TODAY);
    expect(got.map((i) => i.text)).toEqual(['first', 'second']);
  });

  it('knows when the planner has been saved', () => {
    expect(planIsSaved([item({ source: 'manual' })])).toBe(false);
    expect(planIsSaved([item({ source: 'manual' }), item({ source: 'planner' })])).toBe(true);
  });

  it('puts a new line at the bottom', () => {
    expect(nextPosition([item({ position: 1 }), item({ position: 7 })])).toBe(8);
    expect(nextPosition([])).toBe(1);
  });
});

describe('a line that points at a task follows the task', () => {
  const tasks = [
    { ...task({}), id: 'T-1', title: 'Ship the export engine', status: 'todo' } as Task,
    { ...task({}), id: 'T-2', title: 'Close the vendor loop', status: 'done' } as Task,
  ];

  it('reads as done when the task is closed on the board', () => {
    // the whole point: closing it in Work must not leave Home claiming it is open
    expect(itemDone(item({ task_id: 'T-2', done: false }), tasks)).toBe(true);
  });

  it('reads as open while the task is open, whatever the stored flag says', () => {
    expect(itemDone(item({ task_id: 'T-1', done: true }), tasks)).toBe(false);
  });

  it('falls back to its own flag when the task is gone', () => {
    expect(itemDone(item({ task_id: 'T-404', done: true }), tasks)).toBe(true);
  });

  it('shows the task title, so renaming the task renames the line', () => {
    expect(itemLabel(item({ task_id: 'T-1', text: 'stale copy' }), tasks)).toBe(
      'Ship the export engine',
    );
  });

  it('leaves a typed line alone', () => {
    const typed = item({ text: 'Call the consulate', done: true });
    expect(itemDone(typed, tasks)).toBe(true);
    expect(itemLabel(typed, tasks)).toBe('Call the consulate');
  });
});
