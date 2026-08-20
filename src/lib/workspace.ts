/**
 * Ownership filtering — the one place that answers "is this mine?".
 *
 * Principle 1: two workspaces, three shared rooms. Separation is focus, not
 * secrecy, so both rows stay readable and every screen filters through here
 * rather than each inventing its own rule. Keep these pure: they are called
 * inside render paths and covered by workspace.test.ts.
 */
import type { HandoffState, Task, UserId } from '../types';

/** Anything carrying an optional owner. NULL owner = belongs to both. */
interface Owned {
  owner_id?: UserId | null;
}

/**
 * A task is mine when it is assigned to me. An unassigned task falls back to
 * its author so nothing can end up owned by nobody and disappear from both
 * boards — 0012_workspaces.sql backfills the same rule.
 */
export function isMyTask(t: Task, meId: UserId): boolean {
  return t.assignee_id ? t.assignee_id === meId : t.created_by === meId;
}

export function myTasks(tasks: Task[], meId: UserId): Task[] {
  return tasks.filter((t) => isMyTask(t, meId));
}

/**
 * Work the other person pushed at me and I have not acknowledged yet. These
 * sit in an inbox strip above the board instead of appearing mid-column,
 * so a task never arrives without me noticing it arrived.
 */
export function inboxTasks(tasks: Task[], meId: UserId): Task[] {
  return tasks.filter(
    (t) => t.assignee_id === meId && t.created_by !== meId && !t.acknowledged_at,
  );
}

/**
 * Where a task sits in the handoff. Derived from the columns rather than
 * stored, so it can never disagree with them (0033_task_acceptance.sql).
 *
 * Work you assigned yourself is `mine` — it needs no acceptance, and treating
 * it as "waiting" would park half of everyone's own board in an inbox.
 */
export function handoffState(t: Task): HandoffState {
  if (!t.assignee_id || t.assignee_id === t.created_by) return 'mine';
  if (t.acknowledged_at) return 'accepted';
  if (t.pushback_reason) return 'pushed_back';
  return 'waiting';
}

/**
 * Tasks I pushed at the other person that they have not accepted yet — either
 * still sitting in their inbox, or handed back to me with a reason.
 *
 * This is the half that did not exist before: assignment used to be
 * write-and-forget, so work could stall in an inbox with nobody notified.
 */
export function awaitingThem(tasks: Task[], meId: UserId): Task[] {
  return tasks.filter(
    (t) =>
      t.created_by === meId &&
      t.assignee_id != null &&
      t.assignee_id !== meId &&
      !t.acknowledged_at,
  );
}

/**
 * True when the assignee committed to a different priority than was asked for.
 * The disagreement is the point — it is what the card surfaces for a
 * conversation, so it is computed in one place rather than re-derived per view.
 */
export function priorityDiffers(t: Task): boolean {
  return t.accepted_priority != null && t.accepted_priority !== t.priority;
}

/** Rows I own. A NULL owner is shared, so it shows for both people. */
export function ownRows<T extends Owned>(rows: T[], meId: UserId): T[] {
  return rows.filter((r) => r.owner_id == null || r.owner_id === meId);
}

/** Rows nobody has claimed yet — the UI offers to move these into a workspace. */
export function unclaimedRows<T extends Owned>(rows: T[]): T[] {
  return rows.filter((r) => r.owner_id == null);
}
