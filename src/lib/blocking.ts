/**
 * Which tasks are waiting on a decision.
 *
 * A decision is a question that stops work: while it is open, everything
 * linked to it is blocked, and ruling on it releases all of them at once.
 * That "at once" is the reason nothing is written onto the task. If a block
 * were a `blocked_reason` string copied onto each linked task, ruling would
 * mean finding and clearing every copy, and the first one missed would leave
 * a task stuck on a question that was answered weeks ago.
 *
 * So the block is derived from the decision rows on every read. The link
 * already lives in exactly one place — `decisions.task_ids`, made canonical
 * by 0028 — and this reads it from the other end.
 *
 * `is_stuck` and `blocked_reason` on the task are untouched and still mean
 * what they meant: a human saying "I am stuck on this". A decision block is
 * the system saying it. Both surface as blocked; only one of them is
 * something you type.
 */
import type { Decision } from '../types';

/** The open decisions holding `taskId` up, oldest question first. */
export function blockingDecisions(decisions: Decision[], taskId: string): Decision[] {
  return decisions
    .filter((d) => d.status === 'open' && (d.task_ids ?? []).includes(taskId))
    .sort((a, b) => a.opened_at.localeCompare(b.opened_at));
}

/** True when anything open is waiting to be ruled on before this can move. */
export function isBlockedByDecision(decisions: Decision[], taskId: string): boolean {
  return blockingDecisions(decisions, taskId).length > 0;
}

/**
 * Every task id currently blocked, as a set.
 *
 * For the board, which asks the question once per render for a column of
 * cards rather than once per card — the same reason `personalProjectIds`
 * exists as a set rather than a predicate.
 */
export function blockedTaskIds(decisions: Decision[]): Set<string> {
  const out = new Set<string>();
  for (const decision of decisions) {
    if (decision.status !== 'open') continue;
    for (const id of decision.task_ids ?? []) out.add(id);
  }
  return out;
}
