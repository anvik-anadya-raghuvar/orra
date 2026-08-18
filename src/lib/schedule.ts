/**
 * Dependency scheduling — pure, and deliberately advisory.
 *
 * `task_links` already recorded that A blocks B, but nothing read it: dates
 * were whatever someone typed, so a slipped predecessor left the rest of the
 * chain quietly claiming an impossible start.
 *
 * This computes what the chain *would* have to become. It never writes.
 * Principle 3: the app never silently moves a date — the caller shows the
 * moves and applies them only on an explicit confirm.
 *
 * `blocks` is the one scheduling edge. `blocked_by` is the same fact spelled
 * backwards (see canonicalLink in screens/work/common.tsx), `related` and
 * `child_of` carry no timing meaning and are ignored here.
 */
import type { Task, TaskLink } from '../types';
import { fmtDay } from './dates';

export interface ReflowMove {
  task_id: string;
  title: string;
  from_start: string | null;
  from_due: string | null;
  to_start: string | null;
  to_due: string | null;
  /** Plain-language cause, shown in the preview so the move is arguable. */
  reason: string;
}

const DAY_MS = 86_400_000;

const toDate = (iso: string): number => new Date(`${iso}T00:00:00Z`).getTime();
const toIso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (iso: string, days: number): string => toIso(toDate(iso) + days * DAY_MS);

/** Predecessor → successors, over `blocks` edges only, normalising `blocked_by`. */
export function dependencyEdges(links: TaskLink[]): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  const seen = new Set<string>();
  for (const l of links) {
    let from: string, to: string;
    if (l.type === 'blocks') [from, to] = [l.from_task_id, l.to_task_id];
    else if (l.type === 'blocked_by') [from, to] = [l.to_task_id, l.from_task_id];
    else continue;
    const key = `${from}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ from, to });
  }
  return out;
}

/**
 * Would adding "from blocks to" close a loop? A cycle makes the chain
 * unschedulable and the topological sort meaningless, so it is refused at the
 * point of creation rather than discovered later.
 */
export function wouldCycle(links: TaskLink[], from: string, to: string): boolean {
  if (from === to) return true;
  const edges = dependencyEdges(links);
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);

  // Walk forward from the proposed successor: reaching the predecessor means
  // the new edge would point back into its own past.
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length) {
    const at = stack.pop()!;
    if (at === from) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    stack.push(...(next.get(at) ?? []));
  }
  return false;
}

/** Open tasks blocked by something still unfinished — they cannot be today's work. */
export function blockedByOpenDep(tasks: Task[], links: TaskLink[]): Map<string, string> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out = new Map<string, string>();
  for (const { from, to } of dependencyEdges(links)) {
    const pred = byId.get(from);
    const succ = byId.get(to);
    if (!pred || !succ) continue;
    if (succ.status === 'done') continue;
    if (pred.status !== 'done' && !out.has(to)) out.set(to, from);
  }
  return out;
}

/**
 * Kahn's algorithm over the open dependency graph. Returns ids in an order
 * where every predecessor precedes its successors; anything caught in a cycle
 * is returned last so a bad graph degrades instead of hanging.
 */
export function topoOrder(tasks: Task[], links: TaskLink[]): string[] {
  const ids = new Set(tasks.map((t) => t.id));
  const edges = dependencyEdges(links).filter((e) => ids.has(e.from) && ids.has(e.to));

  const indegree = new Map<string, number>();
  const next = new Map<string, string[]>();
  for (const id of ids) indegree.set(id, 0);
  for (const e of edges) {
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  }

  const queue = [...ids].filter((id) => (indegree.get(id) ?? 0) === 0).sort();
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const to of next.get(id) ?? []) {
      const left = (indegree.get(to) ?? 0) - 1;
      indegree.set(to, left);
      if (left === 0) queue.push(to);
    }
  }
  // Whatever never reached indegree 0 sits in a cycle.
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}

/** The day a task is expected to be finished — its due date, never in the past. */
function projectedFinish(task: Task, todayIso: string, override?: string | null): string {
  const due = override ?? task.due_date ?? task.start_date ?? todayIso;
  return due < todayIso ? todayIso : due;
}

/**
 * What the chain would have to become for every task to start after the work
 * it depends on has finished. Duration is preserved: a task shifted three days
 * keeps its length rather than being squeezed.
 *
 * Done tasks anchor the chain (they really did finish) but are never moved.
 */
export function computeReflow(
  tasks: Task[],
  links: TaskLink[],
  todayIso: string,
): ReflowMove[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const preds = new Map<string, string[]>();
  for (const { from, to } of dependencyEdges(links)) {
    if (!byId.has(from) || !byId.has(to)) continue;
    preds.set(to, [...(preds.get(to) ?? []), from]);
  }

  const proposedDue = new Map<string, string>();
  const moves: ReflowMove[] = [];

  for (const id of topoOrder(tasks, links)) {
    const task = byId.get(id);
    if (!task) continue;
    const parents = preds.get(id) ?? [];
    if (!parents.length || task.status === 'done') continue;

    // The chain can only start the day after the last predecessor finishes.
    let requiredStart: string | null = null;
    let driver: Task | null = null;
    for (const pid of parents) {
      const pred = byId.get(pid);
      if (!pred || pred.status === 'done') continue;
      const finish = projectedFinish(pred, todayIso, proposedDue.get(pid));
      const earliest = addDays(finish, 1);
      if (!requiredStart || earliest > requiredStart) {
        requiredStart = earliest;
        driver = pred;
      }
    }
    if (!requiredStart || !driver) continue;

    const start = task.start_date ?? task.due_date;
    if (start && start >= requiredStart) continue; // already sits late enough

    let toStart: string | null = null;
    let toDue: string | null = null;
    if (task.start_date) {
      const shift = Math.round((toDate(requiredStart) - toDate(task.start_date)) / DAY_MS);
      toStart = requiredStart;
      toDue = task.due_date ? addDays(task.due_date, shift) : null;
    } else if (task.due_date) {
      // No start date to anchor a shift, so only the deadline moves out.
      toDue = task.due_date < requiredStart ? requiredStart : task.due_date;
      if (toDue === task.due_date) continue;
    } else {
      continue; // nothing dated to move
    }

    if (toDue) proposedDue.set(id, toDue);
    moves.push({
      task_id: id,
      title: task.title,
      from_start: task.start_date,
      from_due: task.due_date,
      to_start: toStart,
      to_due: toDue,
      reason: `${driver.id} is not expected to finish before ${fmtDay(
        projectedFinish(driver, todayIso, proposedDue.get(driver.id)),
      )}.`,
    });
  }

  return moves;
}
