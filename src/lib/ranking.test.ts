import { describe, expect, it } from 'vitest';
import { capacityFit, rankTasks } from './ranking';
import type { Dataset, Task } from '../types';

const ME = 'u-anadya';

const task = (p: Partial<Task>): Task =>
  ({
    id: 'T-1',
    title: 't',
    description: '',
    project_id: 'biz',
    type: 'ops',
    status: 'todo',
    priority: 'normal',
    assignee_id: ME,
    created_by: ME,
    due_date: null,
    objective_id: null,
    tags: [],
    progress_pct: 0,
    effort: 'medium',
    estimate_minutes: 45,
    impact: 3,
    is_stuck: false,
    blocked_reason: null,
    ...p,
  }) as Task;

const ds = (tasks: Task[], over: Partial<Dataset> = {}): Dataset =>
  ({
    tasks,
    projects: [
      { id: 'biz', name: 'anvik.club', is_personal: false },
      { id: 'life', name: 'Personal', is_personal: true },
    ],
    task_links: [],
    decisions: [],
    ranking_weights: { id: 1, priority: 40, unblocks: 30, deadline: 30 },
    ...over,
  }) as unknown as Dataset;

const TODAY = '2026-08-20';

describe('what the ranking reads', () => {
  it('ranks a P0 above a P3, all else equal', () => {
    const out = rankTasks(ds([task({ id: 'T-low', priority: 'low' }), task({ id: 'T-hi', priority: 'urgent' })]), TODAY);
    expect(out[0].task.id).toBe('T-hi');
  });

  it('scores a task that frees other work above one that frees none', () => {
    const rows = [task({ id: 'T-blocker' }), task({ id: 'T-dep' })];
    const links = [{ id: 'l1', from_task_id: 'T-blocker', to_task_id: 'T-dep', type: 'blocks' }];
    const out = rankTasks(ds(rows, { task_links: links as Dataset['task_links'] }), TODAY);
    expect(out[0].task.id).toBe('T-blocker');
    expect(out[0].why).toContain('Finishing it frees 1 other task');
  });

  it('reads the same fact from the other end of the link', () => {
    const rows = [task({ id: 'T-blocker' }), task({ id: 'T-dep' })];
    const links = [{ id: 'l1', from_task_id: 'T-dep', to_task_id: 'T-blocker', type: 'blocked_by' }];
    const out = rankTasks(ds(rows, { task_links: links as Dataset['task_links'] }), TODAY);
    expect(out.find((r) => r.task.id === 'T-blocker')!.unblocks).toBe(30);
  });

  it('does not credit unblocking a task that is already done', () => {
    const rows = [task({ id: 'T-blocker' }), task({ id: 'T-dep', status: 'done' })];
    const links = [{ id: 'l1', from_task_id: 'T-blocker', to_task_id: 'T-dep', type: 'blocks' }];
    const out = rankTasks(ds(rows, { task_links: links as Dataset['task_links'] }), TODAY);
    expect(out[0].unblocks).toBe(0);
  });

  it('counts being in review as unblocking the other person', () => {
    const out = rankTasks(ds([task({ status: 'in_review' })]), TODAY);
    expect(out[0].unblocks).toBe(40);
    expect(out[0].why).toContain('In review — closing it unblocks the other person');
  });

  it('scores a due date closer to today higher, and says so', () => {
    const out = rankTasks(ds([task({ id: 'T-soon', due_date: '2026-08-20' }), task({ id: 'T-later', due_date: '2026-09-30' })]), TODAY);
    expect(out[0].task.id).toBe('T-soon');
    expect(out[0].why).toContain('Due today');
  });

  it('tells you when a task scores nothing on deadline', () => {
    expect(rankTasks(ds([task({})]), TODAY)[0].why).toContain('No due date — scores nothing on deadline');
  });
});

describe('what the ranking refuses to read', () => {
  it('ignores tag names entirely — principle 8, no hard-coded vocabulary', () => {
    // 'urgent-path', 'needs-raghuvar' and 'blocked' used to be worth 45, 25
    // and 10 points. Knowing the magic word is not a priority signal.
    const plain = rankTasks(ds([task({ id: 'T-a' })]), TODAY)[0].score;
    const tagged = rankTasks(ds([task({ id: 'T-a', tags: ['urgent-path', 'needs-raghuvar', 'blocked'] })]), TODAY)[0].score;
    expect(tagged).toBe(plain);
  });

  it('ignores objective_id, which nothing in the app can set', () => {
    const none = rankTasks(ds([task({ id: 'T-a' })]), TODAY)[0].score;
    const linked = rankTasks(ds([task({ id: 'T-a', objective_id: 'okr-1' })]), TODAY)[0].score;
    expect(linked).toBe(none);
  });

  it('keeps personal work out of business ranking (principle 6)', () => {
    const out = rankTasks(ds([task({ id: 'T-life', project_id: 'life', project_ids: ['life'] })]), TODAY);
    expect(out).toEqual([]);
  });

  it('still ranks a task that is in a personal AND a business project', () => {
    const out = rankTasks(ds([task({ id: 'T-both', project_id: 'life', project_ids: ['life', 'biz'] })]), TODAY);
    expect(out.map((r) => r.task.id)).toEqual(['T-both']);
  });
});

describe('things that cannot be started sink', () => {
  it('penalises a task marked stuck', () => {
    const normal = rankTasks(ds([task({ id: 'T-a', priority: 'urgent' })]), TODAY)[0].score;
    const stuck = rankTasks(ds([task({ id: 'T-a', priority: 'urgent', is_stuck: true })]), TODAY)[0];
    expect(stuck.score).toBe(normal - 30);
    expect(stuck.why).toContain('Stuck — needs unblocking first');
  });

  it('penalises a task waiting on an unruled decision', () => {
    const decisions = [{ id: 'd1', status: 'open', opened_at: '2026-08-01', task_ids: ['T-a'] }];
    const normal = rankTasks(ds([task({ id: 'T-a', priority: 'urgent' })]), TODAY)[0].score;
    const held = rankTasks(ds([task({ id: 'T-a', priority: 'urgent' })], { decisions: decisions as unknown as Dataset['decisions'] }), TODAY)[0];
    expect(held.score).toBe(normal - 30);
    expect(held.why).toContain('Waiting on a decision to be ruled');
  });

  it('releases the penalty once the decision is ruled', () => {
    const decisions = [{ id: 'd1', status: 'ruled', opened_at: '2026-08-01', task_ids: ['T-a'] }];
    const held = rankTasks(ds([task({ id: 'T-a' })], { decisions: decisions as unknown as Dataset['decisions'] }), TODAY)[0];
    expect(held.why).not.toContain('Waiting on a decision to be ruled');
  });

  it('never returns a negative score', () => {
    const out = rankTasks(ds([task({ priority: 'low', is_stuck: true, effort: 'heavy' })]), TODAY, 'light');
    expect(out[0].score).toBeGreaterThanOrEqual(0);
  });
});

describe('weights are data, not constants', () => {
  it('re-orders when the weights change, with no redeploy', () => {
    const rows = [
      task({ id: 'T-urgent-far', priority: 'urgent', due_date: '2026-12-01' }),
      task({ id: 'T-low-today', priority: 'low', due_date: TODAY }),
    ];
    const byPriority = rankTasks(ds(rows, { ranking_weights: { id: 1, priority: 100, unblocks: 0, deadline: 0 } as Dataset['ranking_weights'] }), TODAY);
    const byDeadline = rankTasks(ds(rows, { ranking_weights: { id: 1, priority: 0, unblocks: 0, deadline: 100 } as Dataset['ranking_weights'] }), TODAY);
    expect(byPriority[0].task.id).toBe('T-urgent-far');
    expect(byDeadline[0].task.id).toBe('T-low-today');
  });

  it('survives all three weights being zero rather than dividing by it', () => {
    const out = rankTasks(ds([task({})], { ranking_weights: { id: 1, priority: 0, unblocks: 0, deadline: 0 } as Dataset['ranking_weights'] }), TODAY);
    expect(Number.isFinite(out[0].score)).toBe(true);
  });
});

describe('capacityFit', () => {
  it('rewards a light task on a light day and punishes a heavy one', () => {
    expect(capacityFit('light', 'light')).toBeGreaterThan(0);
    expect(capacityFit('heavy', 'light')).toBeLessThan(0);
  });
});
