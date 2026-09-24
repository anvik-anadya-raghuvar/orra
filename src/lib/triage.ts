/**
 * Overdue triage — the pure half.
 *
 * A pile of overdue tasks used to be dealt with one task page at a time, which
 * is why the pile grew. Triage lets you decide, per row or in bulk, what each
 * one becomes: today, next Monday, a date you pick, no date, or done.
 *
 * Principle 3: nothing here writes. `buildPreview` turns the decisions into a
 * list of explicit before → after changes; the sheet shows that list and only
 * writes on an "Apply N changes" confirm. Pure and clock-free (`today` is an
 * argument) so every boundary is testable.
 */
import type { Task, UserId } from '../types';
import { isMyTask } from './workspace';

export type TriageAction =
  | { kind: 'today' }
  | { kind: 'nextMonday' }
  | { kind: 'date'; date: string }
  | { kind: 'clear' }
  | { kind: 'done' };

/** Decisions so far, keyed by task id. A task with no entry is left alone. */
export type TriagePlan = Record<string, TriageAction>;

export interface TriageChange {
  taskId: string;
  title: string;
  fromDue: string | null;
  /** The due date after the change. Unchanged for a pure "mark done". */
  toDue: string | null;
  markDone: boolean;
  patch: Partial<Pick<Task, 'due_date' | 'status' | 'progress_pct'>>;
  /** One line for the audit trail. */
  summary: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parse(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Overdue and mine: not done, due strictly before today, and mine by the
 * workspace definition (assigned to me, or created by me when unassigned).
 * Oldest first — the most overdue thing is the one to look at first.
 */
export function overdueTasks(tasks: Task[], meId: UserId, today: string): Task[] {
  return tasks
    .filter(
      (t) => t.status !== 'done' && !!t.due_date && t.due_date < today && isMyTask(t, meId),
    )
    .sort((a, b) => a.due_date!.localeCompare(b.due_date!) || a.id.localeCompare(b.id));
}

/** The Monday strictly after `today` — on a Monday, that is a week out. */
export function nextMonday(today: string): string {
  const d = parse(today);
  const dow = d.getUTCDay(); // 0 Sun … 6 Sat
  const ahead = ((8 - dow) % 7) || 7;
  d.setUTCDate(d.getUTCDate() + ahead);
  return fmt(d);
}

/** Where an action lands the due date, or undefined when it does not touch it. */
export function targetDue(action: TriageAction, today: string): string | null | undefined {
  switch (action.kind) {
    case 'today':
      return today;
    case 'nextMonday':
      return nextMonday(today);
    case 'date':
      return ISO.test(action.date) ? action.date : undefined;
    case 'clear':
      return null;
    case 'done':
      return undefined;
  }
}

/** One task's proposed change, or null when the action would change nothing. */
export function proposeChange(
  task: Task,
  action: TriageAction,
  today: string,
): TriageChange | null {
  if (action.kind === 'done') {
    if (task.status === 'done') return null;
    return {
      taskId: task.id,
      title: task.title,
      fromDue: task.due_date,
      toDue: task.due_date,
      markDone: true,
      patch: { status: 'done', progress_pct: 100 },
      summary: `${task.id} marked done from overdue triage`,
    };
  }
  const to = targetDue(action, today);
  if (to === undefined || to === task.due_date) return null;
  return {
    taskId: task.id,
    title: task.title,
    fromDue: task.due_date,
    toDue: to,
    markDone: false,
    patch: { due_date: to },
    summary: to
      ? `${task.id} due date moved ${task.due_date ?? 'none'} → ${to} in overdue triage`
      : `${task.id} due date cleared (was ${task.due_date ?? 'none'}) in overdue triage`,
  };
}

/** Every decided change, in the order the tasks are listed. No-ops dropped. */
export function buildPreview(tasks: Task[], plan: TriagePlan, today: string): TriageChange[] {
  const out: TriageChange[] = [];
  for (const task of tasks) {
    const action = plan[task.id];
    if (!action) continue;
    const change = proposeChange(task, action, today);
    if (change) out.push(change);
  }
  return out;
}

/** Give every selected task the same action. Returns a new plan. */
export function applyToSelection(
  plan: TriagePlan,
  selected: Iterable<string>,
  action: TriageAction,
): TriagePlan {
  const next = { ...plan };
  for (const id of selected) next[id] = action;
  return next;
}

/** Forget the decision on one task. Returns a new plan. */
export function undecide(plan: TriagePlan, id: string): TriagePlan {
  const next = { ...plan };
  delete next[id];
  return next;
}

/** Toggle one id in a selection. Returns a new set. */
export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Select all when not everything is selected, otherwise clear. */
export function toggleAll(selected: ReadonlySet<string>, ids: string[]): Set<string> {
  const all = ids.length > 0 && ids.every((id) => selected.has(id));
  return all ? new Set() : new Set(ids);
}

/** A short human label for an action, for the row's decision chip. */
export function actionLabel(action: TriageAction, today: string): string {
  switch (action.kind) {
    case 'today':
      return 'Today';
    case 'nextMonday':
      return `Next Monday (${nextMonday(today)})`;
    case 'date':
      return action.date;
    case 'clear':
      return 'No due date';
    case 'done':
      return 'Done';
  }
}
