/**
 * Ownership filtering — the one place that answers "is this mine?".
 *
 * Principle 1: two workspaces, three shared rooms. Separation is focus, not
 * secrecy, so both rows stay readable and every screen filters through here
 * rather than each inventing its own rule. Keep these pure: they are called
 * inside render paths and covered by workspace.test.ts.
 */
import type { Task, UserId } from '../types';

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

/** Rows I own. A NULL owner is shared, so it shows for both people. */
export function ownRows<T extends Owned>(rows: T[], meId: UserId): T[] {
  return rows.filter((r) => r.owner_id == null || r.owner_id === meId);
}

/** Rows nobody has claimed yet — the UI offers to move these into a workspace. */
export function unclaimedRows<T extends Owned>(rows: T[]): T[] {
  return rows.filter((r) => r.owner_id == null);
}
