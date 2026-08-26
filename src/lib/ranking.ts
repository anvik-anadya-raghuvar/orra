import type { Capacity, Dataset, Effort, Task, TaskPriority, UserId } from '../types';
import { PRIORITY_LABEL } from '../types';
import { isMyTask } from './workspace';
import { taskProjects } from './taskFacets';
import { blockedTaskIds } from './blocking';

export interface RankedTask {
  task: Task;
  priority: number; // 0–100 before weighting
  unblocks: number;
  deadline: number;
  /** Capacity match is a modifier, not a weighted factor — it never lets a
   *  light task outrank an urgent one, it only breaks ties toward what fits. */
  capacityFit: number; // -18 … +14
  score: number;
  why: string[];
}

const DAY_MS = 86_400_000;

/** P0–P3 as a 0–100 factor. The gaps are deliberately uneven: the distance
 *  from P0 to P1 should matter more than P2 to P3, or everything drifts to
 *  the middle and the ranking says nothing. */
const PRIORITY_SCORE: Record<TaskPriority, number> = {
  urgent: 100,
  high: 70,
  normal: 40,
  low: 15,
};

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
 * How many still-open tasks each task is holding up, from `task_links`.
 *
 * Both link directions describe the same fact from opposite ends, so both are
 * counted: A "blocks" B and B "blocked_by" A mean A is the blocker. Only open
 * dependents count — unblocking something already done frees nobody.
 */
function blockerCounts(ds: Dataset): Map<string, number> {
  const open = new Set(ds.tasks.filter((t) => t.status !== 'done').map((t) => t.id));
  const counts = new Map<string, number>();
  for (const link of ds.task_links) {
    let blocker: string | null = null;
    let dependent: string | null = null;
    if (link.type === 'blocks') {
      blocker = link.from_task_id;
      dependent = link.to_task_id;
    } else if (link.type === 'blocked_by') {
      blocker = link.to_task_id;
      dependent = link.from_task_id;
    }
    if (blocker && dependent && open.has(dependent)) {
      counts.set(blocker, (counts.get(blocker) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Business task ranking — pure. Weights come from ranking_weights (never
 * constants), capacity comes from the day plan. Personal-project tasks are
 * excluded entirely (principle 6: personal life never feeds business ranking).
 *
 * Every factor reads something the two of them actually set. The previous
 * version's largest weight scored an OKR link that nothing in the app could
 * create, and part of "unblocks" keyed off three hard-coded tag names —
 * `urgent-path`, `needs-raghuvar`, `blocked` — which contradicted principle 8
 * outright and silently rewarded knowing the magic words. Both are gone.
 *
 * `ownerId` scopes the ranking to one workspace (principle 1). Omit it and
 * every open business task is ranked.
 */
export function rankTasks(
  ds: Dataset,
  todayIso: string,
  capacity: Capacity = 'medium',
  ownerId?: UserId,
): RankedTask[] {
  const w = ds.ranking_weights;
  const total = w.priority + w.unblocks + w.deadline || 1;
  const personal = new Set(ds.projects.filter((p) => p.is_personal).map((p) => p.id));
  const today = new Date(todayIso + 'T00:00:00Z').getTime();
  const blockers = blockerCounts(ds);
  const awaitingDecision = blockedTaskIds(ds.decisions);

  const open = ds.tasks.filter(
    (t) =>
      t.status !== 'done' &&
      // Business work if ANY of its projects is a business one. A task that
      // is both stays rankable -- it is real business work that also touches
      // personal life, and principle 6 fences the personal SYSTEM out of the
      // ranking, not every task that happens to overlap it.
      taskProjects(t).some((id) => !personal.has(id)) &&
      (!ownerId || isMyTask(t, ownerId)),
  );

  return open
    .map((task) => {
      const why: string[] = [];

      // ── Priority: what you already said this is worth ──────────────────
      const priority = PRIORITY_SCORE[task.priority];
      if (task.priority === 'urgent' || task.priority === 'high') {
        why.push(`${PRIORITY_LABEL[task.priority]} — you marked it that`);
      }

      // ── Unblocks: does finishing this free somebody ────────────────────
      let unblocks = 0;
      const frees = blockers.get(task.id) ?? 0;
      if (frees > 0) {
        unblocks += Math.min(90, frees * 30);
        why.push(`Finishing it frees ${frees} other task${frees === 1 ? '' : 's'}`);
      }
      if (task.status === 'in_review') {
        unblocks += 40;
        why.push('In review — closing it unblocks the other person');
      }
      unblocks = Math.min(100, unblocks);

      // ── Deadline proximity: ≤0 days → 100, 14+ days → 0 ────────────────
      let deadline = 0;
      if (task.due_date) {
        const due = new Date(task.due_date + 'T00:00:00Z').getTime();
        const days = Math.round((due - today) / DAY_MS);
        deadline = Math.max(0, Math.min(100, Math.round(100 - (days / 14) * 100)));
        if (days <= 0) why.push(`Due ${days === 0 ? 'today' : `${-days}d ago`}`);
        else if (days <= 3) why.push(`Due in ${days}d`);
      } else {
        why.push('No due date — scores nothing on deadline');
      }

      const weighted =
        (priority * w.priority + unblocks * w.unblocks + deadline * w.deadline) / total;

      // A task that cannot be started should be surfaced, not pushed as
      // "start here" — whether a person said so or a decision is holding it.
      const stuckPenalty = task.is_stuck || task.blocked_reason ? -30 : 0;
      if (stuckPenalty) why.push('Stuck — needs unblocking first');
      const decisionPenalty = awaitingDecision.has(task.id) ? -30 : 0;
      if (decisionPenalty) why.push('Waiting on a decision to be ruled');

      const fit = capacityFit(task.effort, capacity);
      if (fit >= 10) why.push(`Fits a ${capacity} day`);
      else if (fit <= -10) why.push(`Heavy for a ${capacity} day`);

      const score = Math.max(0, weighted + fit + stuckPenalty + decisionPenalty);

      return {
        task,
        priority,
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
