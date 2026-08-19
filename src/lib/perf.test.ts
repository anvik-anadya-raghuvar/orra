/**
 * The performance gate, as a test rather than a ritual.
 *
 * CLAUDE.md asks for "p95 list fetch under 300 ms with 500 seeded rows". That
 * used to depend on a `generateBulkTasks` helper exported from the seed, which
 * nothing called — so it shipped in the bundle and the gate was only ever run
 * by hand, if at all. The generator lives here instead: out of the bundle,
 * and run on every `npm test`.
 *
 * What is measured is the work a room actually does when it opens. The fetch
 * itself is Supabase's problem and a network number; what this project can
 * regress is everything that happens to the rows afterwards — ownership
 * filtering, dependency resolution, ranking, and building the day's plan. That
 * pipeline is O(tasks x links) in places, which is exactly the shape that stops
 * being free somewhere between fifty rows and five hundred.
 *
 * The budget is deliberately the whole 300 ms even though the real number is a
 * long way under it: this is a regression alarm, not a benchmark, and a test
 * that fails because a laptop was busy is a test people learn to ignore.
 */
import { describe, expect, it } from 'vitest';
import { seedDataset } from '../data/seed';
import type { Dataset, Task, TaskLink } from '../types';
import { blockedByOpenDep } from './schedule';
import { planDay, rankTasks, stuckTasks } from './ranking';
import { myTasks } from './workspace';

const ROWS = 500;
const BUDGET_MS = 300;
const RUNS = 20;

/** Inflate the seed to `n` tasks, deterministically. */
function withBulkTasks(base: Dataset, n: number): Dataset {
  const tasks: Task[] = [...base.tasks];
  const links: TaskLink[] = [...base.task_links];
  const projects = base.projects.map((p) => p.id);
  const people = base.profiles.map((p) => p.id);
  const types = ['code_change', 'ops', 'finance', 'research'] as const;
  const statuses = ['backlog', 'todo', 'in_progress', 'in_review', 'done'] as const;
  const priorities = ['urgent', 'high', 'normal', 'low'] as const;
  const efforts = ['light', 'medium', 'heavy'] as const;

  const template = base.tasks[0];
  for (let i = tasks.length; i < n; i++) {
    const id = `PERF-${i}`;
    tasks.push({
      ...template,
      id,
      title: `Seeded task ${i}`,
      description: '',
      acceptance_criteria: '',
      project_id: projects[i % projects.length],
      type: types[i % types.length],
      status: statuses[i % statuses.length],
      priority: priorities[i % priorities.length],
      effort: efforts[i % efforts.length],
      assignee_id: people[i % people.length],
      created_by: people[(i + 1) % people.length],
      start_date: '2026-08-01',
      due_date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
      tags: [],
    });
    // A dependency every third row, so the graph work is exercised too — a
    // ranking pass over 500 tasks with no edges is not the expensive case.
    if (i % 3 === 0 && i > 3) {
      links.push({
        id: `perf-link-${i}`,
        from_task_id: `PERF-${i - 3}`,
        to_task_id: id,
        type: 'blocks',
      } as TaskLink);
    }
  }
  return { ...base, tasks, task_links: links };
}

describe('the list pipeline stays fast at 500 rows', () => {
  const ds = withBulkTasks(seedDataset(), ROWS);
  const meId = ds.profiles[0].id;
  const today = '2026-08-20';

  it('has actually built the rows it claims to measure', () => {
    expect(ds.tasks.length).toBe(ROWS);
    expect(ds.task_links.length).toBeGreaterThan(100);
  });

  it('opens a room in well under the budget, at p95', () => {
    const samples: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const t0 = performance.now();
      const mine = myTasks(ds.tasks, meId);
      blockedByOpenDep(ds.tasks, ds.task_links);
      const ranked = rankTasks(ds, today, 'medium', meId);
      stuckTasks(ds);
      planDay(ranked, 'medium');
      samples.push(performance.now() - t0);
      expect(mine.length).toBeGreaterThan(0);
    }
    samples.sort((a, b) => a - b);
    const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
    // Printed so the gate leaves evidence rather than just a green tick.
    // eslint-disable-next-line no-console
    console.log(
      `  p95 ${p95.toFixed(1)} ms · median ${samples[Math.floor(samples.length / 2)].toFixed(1)} ms ` +
        `· worst ${samples[samples.length - 1].toFixed(1)} ms · budget ${BUDGET_MS} ms · ${ROWS} rows`,
    );
    expect(p95).toBeLessThan(BUDGET_MS);
  });
});
