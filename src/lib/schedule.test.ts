import { describe, expect, it } from 'vitest';
import type { Task, TaskLink } from '../types';
import {
  blockedByOpenDep,
  computeReflow,
  dependencyEdges,
  topoOrder,
  wouldCycle,
} from './schedule';

const TODAY = '2026-08-19';

const task = (id: string, p: Partial<Task> = {}): Task =>
  ({
    id,
    title: `Task ${id}`,
    status: 'todo',
    start_date: null,
    due_date: null,
    ...p,
  }) as Task;

const link = (from: string, to: string, type: TaskLink['type'] = 'blocks'): TaskLink =>
  ({ id: `l-${from}-${to}`, from_task_id: from, to_task_id: to, type }) as TaskLink;

describe('dependency edges', () => {
  it('reads blocked_by as the same fact spelled backwards', () => {
    expect(dependencyEdges([link('A', 'B', 'blocks')])).toEqual([{ from: 'A', to: 'B' }]);
    expect(dependencyEdges([link('B', 'A', 'blocked_by')])).toEqual([{ from: 'A', to: 'B' }]);
  });

  it('ignores relationships that carry no timing meaning', () => {
    expect(dependencyEdges([link('A', 'B', 'related'), link('A', 'B', 'child_of')])).toEqual([]);
  });

  it('does not double-count a pair recorded both ways', () => {
    expect(dependencyEdges([link('A', 'B', 'blocks'), link('B', 'A', 'blocked_by')])).toHaveLength(1);
  });
});

describe('cycles are refused at creation', () => {
  it('rejects a link that points back into its own past', () => {
    const links = [link('A', 'B'), link('B', 'C')];
    expect(wouldCycle(links, 'C', 'A')).toBe(true);
  });

  it('rejects a task blocking itself', () => {
    expect(wouldCycle([], 'A', 'A')).toBe(true);
  });

  it('allows a link that only joins two separate chains', () => {
    expect(wouldCycle([link('A', 'B'), link('C', 'D')], 'B', 'C')).toBe(false);
  });
});

describe('topological order', () => {
  it('puts every predecessor before its successors', () => {
    const tasks = [task('C'), task('A'), task('B')];
    const order = topoOrder(tasks, [link('A', 'B'), link('B', 'C')]);
    expect(order.indexOf('A')).toBeLessThan(order.indexOf('B'));
    expect(order.indexOf('B')).toBeLessThan(order.indexOf('C'));
  });

  it('still returns everything when the graph contains a cycle', () => {
    const tasks = [task('A'), task('B')];
    // a cycle should degrade, not hang or drop work
    expect(topoOrder(tasks, [link('A', 'B'), link('B', 'A')]).sort()).toEqual(['A', 'B']);
  });
});

describe('reflow proposes, never decides', () => {
  it('pushes a successor past its predecessor and keeps its duration', () => {
    const tasks = [
      task('A', { due_date: '2026-08-25' }),
      task('B', { start_date: '2026-08-20', due_date: '2026-08-24' }),
    ];
    const [move] = computeReflow(tasks, [link('A', 'B')], TODAY);
    expect(move.to_start).toBe('2026-08-26');
    // B was a 4-day task and stays a 4-day task
    expect(move.to_due).toBe('2026-08-30');
    expect(move.reason).toContain('A');
  });

  it('cascades down a three-deep chain', () => {
    const tasks = [
      task('A', { due_date: '2026-08-25' }),
      task('B', { start_date: '2026-08-20', due_date: '2026-08-21' }),
      task('C', { start_date: '2026-08-22', due_date: '2026-08-23' }),
    ];
    const moves = computeReflow(tasks, [link('A', 'B'), link('B', 'C')], TODAY);
    const b = moves.find((m) => m.task_id === 'B')!;
    const c = moves.find((m) => m.task_id === 'C')!;
    expect(b.to_start).toBe('2026-08-26');
    expect(b.to_due).toBe('2026-08-27');
    // C must clear B's *proposed* finish, not its stale one
    expect(c.to_start).toBe('2026-08-28');
  });

  it('leaves a chain alone when it already sits late enough', () => {
    const tasks = [
      task('A', { due_date: '2026-08-20' }),
      task('B', { start_date: '2026-08-25', due_date: '2026-08-27' }),
    ];
    expect(computeReflow(tasks, [link('A', 'B')], TODAY)).toEqual([]);
  });

  it('never moves anything on account of finished work', () => {
    const tasks = [
      task('A', { due_date: '2026-09-30', status: 'done' }),
      task('B', { start_date: '2026-08-20', due_date: '2026-08-24' }),
    ];
    expect(computeReflow(tasks, [link('A', 'B')], TODAY)).toEqual([]);
  });

  it('treats an overdue predecessor as finishing today at the earliest', () => {
    const tasks = [
      task('A', { due_date: '2026-08-01' }), // slipped, still open
      task('B', { start_date: '2026-08-02', due_date: '2026-08-03' }),
    ];
    const [move] = computeReflow(tasks, [link('A', 'B')], TODAY);
    expect(move.to_start).toBe('2026-08-20'); // the day after today
  });

  it('moves only the deadline when a task has no start date', () => {
    const tasks = [task('A', { due_date: '2026-08-25' }), task('B', { due_date: '2026-08-22' })];
    const [move] = computeReflow(tasks, [link('A', 'B')], TODAY);
    expect(move.to_start).toBeNull();
    expect(move.to_due).toBe('2026-08-26');
  });

  it('proposes nothing for an undated task', () => {
    const tasks = [task('A', { due_date: '2026-08-25' }), task('B')];
    expect(computeReflow(tasks, [link('A', 'B')], TODAY)).toEqual([]);
  });
});

describe('tasks waiting on unfinished work', () => {
  it('names what each one is waiting for', () => {
    const tasks = [task('A'), task('B'), task('C', { status: 'done' })];
    const blocked = blockedByOpenDep(tasks, [link('A', 'B'), link('B', 'C')]);
    expect(blocked.get('B')).toBe('A');
    // C is finished, so it is not waiting on anything any more
    expect(blocked.has('C')).toBe(false);
  });

  it('clears once the predecessor closes', () => {
    const tasks = [task('A', { status: 'done' }), task('B')];
    expect(blockedByOpenDep(tasks, [link('A', 'B')]).size).toBe(0);
  });
});
