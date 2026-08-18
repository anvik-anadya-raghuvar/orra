import type { Capacity, Dataset, Effort, Task, UserId } from '../types';
import { isMyTask } from './workspace';

export interface RankedTask {
  task: Task;
  objectiveFit: number; // 0–100 before weighting
  unblocks: number;
  deadline: number;
  /** Capacity match is a modifier, not a weighted factor — it never lets a
   *  light task outrank an urgent one, it only breaks ties toward what fits. */
  capacityFit: number; // -18 … +14
  score: number;
  why: string[];
}

const DAY_MS = 86_400_000;

/** How well a task's effort matches the declared capacity for the day. */
export function capacityFit(effort: Effort, capacity: Capacity): number {
  const table: Record<Capacity, Record<Effort, number>> = {
    light: { light: 14, medium: 4, heavy: -18 },
    medium: { light: 6, medium: 10, heavy: 2 },
    heavy: { light: 2, medium: 8, heavy: 14 },
  };
  return table[capacity][effort];
}

/**
 * Business task ranking — pure. Weights come from ranking_weights (never
 * constants), capacity comes from the day plan. Personal-project tasks are
 * excluded entirely (principle 6: personal life never feeds business ranking).
 *
 * `ownerId` scopes the ranking to one workspace (principle 1). Omit it and
 * every open business task is ranked, which is what the shared Goals view
 * still wants.
 */
export function rankTasks(
  ds: Dataset,
  todayIso: string,
  capacity: Capacity = 'medium',
  ownerId?: UserId,
): RankedTask[] {
  const w = ds.ranking_weights;
  const total = w.objective_fit + w.unblocks + w.deadline || 1;
  const personal = new Set(ds.projects.filter((p) => p.is_personal).map((p) => p.id));
  const today = new Date(todayIso + 'T00:00:00Z').getTime();

  const open = ds.tasks.filter(
    (t) =>
      t.status !== 'done' &&
      !personal.has(t.project_id) &&
      (!ownerId || isMyTask(t, ownerId)),
  );

  return open
    .map((task) => {
      const why: string[] = [];

      // Objective fit: linked objective scaled by how far its KRs still have to go.
      let objectiveFit = 0;
      if (task.objective_id) {
        const krs = ds.key_results.filter((k) => k.objective_id === task.objective_id);
        const avg = krs.length ? krs.reduce((a, k) => a + k.progress_pct, 0) / krs.length : 0;
        objectiveFit = 60 + (100 - avg) * 0.4;
        const obj = ds.objectives.find((o) => o.id === task.objective_id);
        if (obj) why.push(`Advances "${obj.title}" (${Math.round(avg)}% done)`);
      } else {
        why.push('No linked objective — sinks in rank');
      }
      // Leverage nudges fit: a high-impact task on the same objective wins.
      objectiveFit = Math.min(100, objectiveFit + (task.impact - 3) * 6);
      if (task.impact >= 5) why.push('High leverage');

      // Unblocks: coupling signals, review state, priority.
      let unblocks = 0;
      if (task.tags.includes('blocked')) unblocks += 10;
      if (task.tags.includes('urgent-path')) unblocks += 45;
      if (task.tags.includes('needs-raghuvar')) unblocks += 25;
      if (task.status === 'in_review') {
        unblocks += 35;
        why.push('In review — closing it unblocks the other person');
      }
      if (task.priority === 'urgent') unblocks += 25;
      else if (task.priority === 'high') unblocks += 15;
      unblocks = Math.min(100, unblocks);

      // Deadline proximity: ≤0 days → 100, 14+ days → 0.
      let deadline = 0;
      if (task.due_date) {
        const due = new Date(task.due_date + 'T00:00:00Z').getTime();
        const days = Math.round((due - today) / DAY_MS);
        deadline = Math.max(0, Math.min(100, Math.round(100 - (days / 14) * 100)));
        if (days <= 0) why.push(`Due ${days === 0 ? 'today' : `${-days}d ago`}`);
        else if (days <= 3) why.push(`Due in ${days}d`);
      }

      const weighted =
        (objectiveFit * w.objective_fit + unblocks * w.unblocks + deadline * w.deadline) / total;

      // A stuck task should be surfaced in the stuck zone, not pushed as "start here".
      const stuckPenalty = task.is_stuck || task.blocked_reason ? -30 : 0;
      if (stuckPenalty) why.push('Stuck — needs unblocking first');

      const fit = capacityFit(task.effort, capacity);
      if (fit >= 10) why.push(`Fits a ${capacity} day`);
      else if (fit <= -10) why.push(`Heavy for a ${capacity} day`);

      const score = Math.max(0, weighted + fit + stuckPenalty);

      return {
        task,
        objectiveFit: Math.round(objectiveFit),
        unblocks,
        deadline,
        capacityFit: fit,
        score: Math.round(score * 10) / 10,
        why,
      };
    })
    .sort((a, b) => b.score - a.score || a.task.id.localeCompare(b.task.id));
}

/** Tasks that need surfacing rather than starting: stuck, blocked, or aging evidence. */
export function stuckTasks(ds: Dataset): { task: Task; reason: string }[] {
  const out: { task: Task; reason: string }[] = [];
  for (const task of ds.tasks) {
    if (task.status === 'done') continue;
    if (task.blocked_reason) {
      out.push({ task, reason: task.blocked_reason });
      continue;
    }
    if (task.is_stuck) {
      out.push({ task, reason: 'Marked stuck by its owner' });
      continue;
    }
    // Evidence aging: an unresolved pin older than 48h on this task's screenshots.
    const shots = ds.screenshot_attachments.filter((s) => s.task_id === task.id).map((s) => s.id);
    const oldest = ds.annotation_pins
      .filter((p) => shots.includes(p.screenshot_id) && !p.is_resolved)
      .map((p) => Date.parse(p.created_at))
      .sort((a, b) => a - b)[0];
    if (oldest) {
      const hours = Math.floor((Date.now() - oldest) / 3_600_000);
      if (hours >= 48) {
        out.push({ task, reason: `Evidence pin unresolved for ${hours}h — resolve or park it` });
      }
    }
  }
  return out;
}

/** Planned minutes for the day vs what the declared capacity realistically holds. */
export const CAPACITY_MINUTES: Record<Capacity, number> = {
  light: 180,
  medium: 330,
  heavy: 480,
};

/**
 * Greedy plan: fill the day's capacity from the ranked list.
 *
 * `blocked` holds tasks waiting on unfinished predecessors. They are skipped
 * rather than down-ranked: however urgent it is, work that literally cannot
 * start today does not belong in today's plan.
 */
export function planDay(
  ranked: RankedTask[],
  capacity: Capacity,
  blocked?: ReadonlySet<string> | Map<string, string>,
): RankedTask[] {
  const isBlocked = (id: string) =>
    blocked instanceof Map ? blocked.has(id) : (blocked?.has(id) ?? false);
  const budget = CAPACITY_MINUTES[capacity];
  let used = 0;
  const picked: RankedTask[] = [];
  for (const r of ranked) {
    if (isBlocked(r.task.id)) continue;
    if (used + r.task.estimate_minutes > budget) continue;
    picked.push(r);
    used += r.task.estimate_minutes;
    if (used >= budget * 0.92) break;
  }
  return picked;
}
