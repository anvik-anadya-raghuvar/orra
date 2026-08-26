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
import { PRIORITY_LABEL, type MessageKind, type Task, type TaskPriority, type UserId } from '../types';
import { fmtDay } from './dates';
import { mentionExcerpt, mentionedIds } from './mentions';

/** One notice, one shape. Every handoff message is a `messages` row. */
function notice(
  store: AppStore,
  kind: MessageKind,
  taskId: string | null,
  body: string,
  summary: string,
): void {
  store.insert(
    'messages',
    {
      id: newId('m'),
      sender_id: store.meId,
      kind,
      body,
      task_ref_id: taskId,
      attachment_url: null,
      song_ref: null,
      promoted_to_type: null,
      promoted_to_id: null,
      created_at: new Date().toISOString(),
    },
    store.asMe({ summary }),
  );
}

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
  notice(
    store,
    'task_assign',
    task.id,
    `Assigned to you: ${task.id} — ${task.title}${due}`,
    `${task.id} assigned to the other workspace`,
  );
}

/**
 * Tell someone they were tagged in an update they are not looking at.
 *
 * Only fires for a tag on the *other* person: tagging yourself is a note to
 * self, and a bell that rings for your own writing is noise. Nothing is
 * needed for a tag written in the Us thread — that message is already the
 * unread row, and a second one announcing it would be the app talking about
 * itself.
 *
 * `where` is the room, not the row ("in the thread on T-45"), because the
 * body has to make sense in a chat bubble hours later with no other context.
 */
export function notifyMention(
  store: AppStore,
  body: string,
  where: string,
  taskId: string | null,
): void {
  if (!mentionedIds(body).some((id) => id !== store.meId)) return;

  notice(
    store,
    'mention',
    taskId,
    `Tagged you ${where} — “${mentionExcerpt(body)}”`,
    `Mention ${where}`,
  );
}

/**
 * Tell the assigner their task was accepted, and at what priority.
 *
 * The priority is always stated, not only when it differs from the ask: "I
 * took it at the priority you asked for" is itself worth reading, and a notice
 * that stays silent on agreement makes the disagreement case feel like a
 * complaint rather than the normal course of business.
 */
export function notifyAcceptance(
  store: AppStore,
  task: Pick<Task, 'id' | 'title' | 'priority' | 'created_by'>,
  acceptedPriority: TaskPriority,
  note: string,
): void {
  if (task.created_by === store.meId) return;

  const asked = PRIORITY_LABEL[task.priority];
  const took = PRIORITY_LABEL[acceptedPriority];
  const priority = asked === took ? `at ${took}` : `at ${took}, you asked ${asked}`;
  const comment = note.trim() ? ` — “${note.trim()}”` : '';
  notice(
    store,
    'task_accept',
    task.id,
    `Accepted ${task.id} ${priority}${comment}`,
    `${task.id} accepted`,
  );
}

/**
 * Tell the assigner their task was handed back, and why.
 *
 * The task stays assigned — this is a flag for a conversation, not a way to
 * return work into a gap where neither board shows it.
 */
export function notifyPushback(
  store: AppStore,
  task: Pick<Task, 'id' | 'title' | 'created_by'>,
  reason: string,
): void {
  if (task.created_by === store.meId) return;

  notice(
    store,
    'task_pushback',
    task.id,
    `Pushed back ${task.id} — “${reason.trim()}”`,
    `${task.id} pushed back`,
  );
}
