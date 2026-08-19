import type { Capacity, Dataset, DayPlan, DayPlanItem, Task, UserId } from '../types';

/** Today's plan for a user, or a sensible default if they haven't set one. */
export function planFor(ds: Dataset, userId: UserId, dateIso: string): DayPlan | null {
  return ds.day_plans.find((p) => p.user_id === userId && p.date === dateIso) ?? null;
}

export const CAPACITY_COPY: Record<Capacity, { label: string; blurb: string }> = {
  light: { label: 'Light', blurb: 'Small, closable things. Protect the rest.' },
  medium: { label: 'Steady', blurb: 'A normal day. One deep block, then admin.' },
  heavy: { label: 'Heavy', blurb: 'Deep work. Guard the calendar ruthlessly.' },
};

/** Events for a user on a date — theirs plus shared ones — sorted by start. */
export function eventsFor(ds: Dataset, userId: UserId, dateIso: string) {
  return ds.day_events
    .filter((e) => e.date === dateIso && (e.user_id === userId || e.user_id === null))
    .sort((a, b) => a.start_min - b.start_min);
}

export const minToLabel = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/* ── Today's intentions ─────────────────────────────────────────────────── */

/** My intentions for one date, in display order. */
export function intentionsFor(ds: Dataset, userId: UserId, dateIso: string): DayPlanItem[] {
  return ds.day_plan_items
    .filter((i) => i.user_id === userId && i.date === dateIso)
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
}

/** True once the planner's picks have been saved as today's plan. */
export function planIsSaved(items: DayPlanItem[]): boolean {
  return items.some((i) => i.source === 'planner');
}

/**
 * Whether a line is done. A line pointing at a task follows the task, so
 * closing the task on the board also ticks it here — the task row is the
 * single source of truth and this view never disagrees with it.
 */
export function itemDone(item: DayPlanItem, tasks: Task[]): boolean {
  if (!item.task_id) return item.done;
  const task = tasks.find((t) => t.id === item.task_id);
  return task ? task.status === 'done' : item.done;
}

/** What a line reads as: its own text, or the title of the task it points at. */
export function itemLabel(item: DayPlanItem, tasks: Task[]): string {
  if (!item.task_id) return item.text;
  return tasks.find((t) => t.id === item.task_id)?.title ?? item.text;
}

/** Next position, so a new line lands at the bottom rather than fighting for 0. */
export function nextPosition(items: DayPlanItem[]): number {
  return items.reduce((max, i) => Math.max(max, i.position), 0) + 1;
}

/**
 * Build the row that puts `task` on today's list, or null when it is already
 * there. Callers insert it — this stays pure so the dedupe rule lives in one
 * place and matches the partial unique index in 0014.
 */
export function intentionRowForTask(
  items: DayPlanItem[],
  opts: { id: string; userId: UserId; date: string; task: Pick<Task, 'id' | 'title'> },
): DayPlanItem | null {
  if (items.some((i) => i.task_id === opts.task.id)) return null;
  return {
    id: opts.id,
    user_id: opts.userId,
    date: opts.date,
    task_id: opts.task.id,
    text: opts.task.title,
    done: false,
    position: nextPosition(items),
    source: 'task',
    created_at: new Date().toISOString(),
  };
}
