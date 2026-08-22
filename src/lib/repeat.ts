/**
 * Tasks that come back.
 *
 * The rule this is built around is principle 3: the app never silently moves
 * a date. So finishing a repeating task does not reschedule it — its dates,
 * its history and its audit trail stay exactly as they are, and a **new row**
 * appears for next time, announced by name and date. Two rows is the honest
 * record of "I did this one, and there is another one coming".
 *
 * Pure and clock-free (`today` is always passed in), which is what lets the
 * month-end and overdue behaviour be pinned down in tests.
 */
import type { Task, TaskRepeat } from '../types';

export const REPEAT_UNITS: TaskRepeat['unit'][] = ['day', 'week', 'month'];
export const MAX_REPEAT_EVERY = 30;

/** "every 2 weeks", "every day". Used on the board chip and both editors. */
export function describeRepeat(repeat: TaskRepeat | null | undefined): string {
  if (!repeat) return 'Does not repeat';
  const { every, unit } = repeat;
  return every === 1 ? `Every ${unit}` : `Every ${every} ${unit}s`;
}

/** Clamp anything arriving from an input or an older row into a usable shape. */
export function normalizeRepeat(repeat: TaskRepeat | null | undefined): TaskRepeat | null {
  if (!repeat) return null;
  if (!REPEAT_UNITS.includes(repeat.unit)) return null;
  const every = Math.round(Number(repeat.every));
  if (!Number.isFinite(every) || every < 1) return null;
  return { every: Math.min(MAX_REPEAT_EVERY, every), unit: repeat.unit };
}

function toParts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Advance one ISO date by one interval. */
function advanceOnce(iso: string, repeat: TaskRepeat): string {
  const { y, m, d } = toParts(iso);
  if (repeat.unit === 'month') {
    // Month arithmetic has to clamp, or 31 January + 1 month becomes
    // 3 March — which is the classic way a monthly reminder drifts.
    const total = (m - 1) + repeat.every;
    const year = y + Math.floor(total / 12);
    const month = (total % 12) + 1;
    return toIso(year, month, Math.min(d, daysInMonth(year, month)));
  }
  const step = repeat.unit === 'week' ? repeat.every * 7 : repeat.every;
  const at = new Date(Date.UTC(y, m - 1, d));
  at.setUTCDate(at.getUTCDate() + step);
  return at.toISOString().slice(0, 10);
}

/**
 * When the next occurrence is due.
 *
 * From the finished task's own due date where it has one, so a weekly thing
 * stays on its weekday. With no due date there is nothing to count from, so
 * it counts from today.
 *
 * Either way it keeps advancing until it lands **after** today: a monthly
 * task finished four months late should produce next month's, not another
 * one that is already overdue the moment it appears.
 */
export function nextDueDate(
  due: string | null | undefined,
  repeat: TaskRepeat,
  today: string,
): string {
  let next = advanceOnce(due || today, repeat);
  // Bounded so a malformed repeat can never spin here.
  for (let guard = 0; next <= today && guard < 200; guard += 1) {
    next = advanceOnce(next, repeat);
  }
  return next;
}

/**
 * The fields the next occurrence inherits, and the ones it must not.
 *
 * Carried: everything describing *what the work is* — title, brief, project,
 * type, priority, who it is for, tags, effort, and the repeat itself, so the
 * chain continues.
 *
 * Reset: everything describing *how the last one went*. Progress, sprint,
 * start date, stuck flag and the acceptance handshake all belong to the
 * occurrence that just finished; carrying them would produce a task that
 * claims to be half done before anyone has looked at it.
 */
export function nextOccurrenceFields(task: Task, today: string): Partial<Task> {
  const repeat = normalizeRepeat(task.repeat);
  if (!repeat) return {};
  return {
    title: task.title,
    description: task.description,
    acceptance_criteria: task.acceptance_criteria,
    project_id: task.project_id,
    type: task.type,
    priority: task.priority,
    assignee_id: task.assignee_id,
    tags: [...task.tags],
    effort: task.effort,
    estimate_minutes: task.estimate_minutes,
    impact: task.impact,
    objective_id: task.objective_id,
    repeat,

    status: 'backlog',
    progress_pct: 0,
    sprint_id: null,
    start_date: null,
    due_date: nextDueDate(task.due_date, repeat, today),
    is_stuck: false,
    blocked_reason: null,
    acknowledged_at: null,
    accepted_priority: null,
    pushback_reason: null,
    pushed_back_at: null,
  };
}
