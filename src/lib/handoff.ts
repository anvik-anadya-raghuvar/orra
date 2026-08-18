/**
 * Handing a task to the other person.
 *
 * Assignment used to be a silent `<select>` write: the task left your board and
 * arrived on theirs with nothing to announce it. Three different screens set an
 * assignee, so the notice lives here rather than being re-remembered in each.
 *
 * The notice is a `messages` row, not a second notification system — the bell,
 * unread counts, realtime and read receipts already work on that table.
 */
import { newId, type AppStore } from '../data/store';
import type { Task, UserId } from '../types';
import { fmtDay } from './dates';

/**
 * Announce that `task` now belongs to `assigneeId`, if that is the other
 * person. Assigning to yourself, or re-saving without changing the assignee,
 * sends nothing. Call after the task row itself is written.
 */
export function notifyAssignment(
  store: AppStore,
  task: Pick<Task, 'id' | 'title' | 'due_date'>,
  assigneeId: UserId | null,
): void {
  if (!assigneeId || assigneeId === store.meId) return;

  const due = task.due_date ? ` · due ${fmtDay(task.due_date)}` : '';
  store.insert(
    'messages',
    {
      id: newId('m'),
      sender_id: store.meId,
      kind: 'task_assign',
      body: `Assigned to you: ${task.id} — ${task.title}${due}`,
      task_ref_id: task.id,
      attachment_url: null,
      song_ref: null,
      promoted_to_type: null,
      promoted_to_id: null,
      created_at: new Date().toISOString(),
    },
    store.asMe({ summary: `${task.id} assigned to the other workspace` }),
  );
}
