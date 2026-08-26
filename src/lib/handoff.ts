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
import { sendPush } from './push';

/** Where the bell should take you when you tap the notice. */
function noticeUrl(kind: MessageKind, taskId: string | null): string {
  if (taskId) return `/task/${taskId}`;
  if (kind === 'query') return '/work';
  if (kind === 'decision_assign') return '/work';
  return '/us';
}

/**
 * One notice, one shape. Every handoff message is a `messages` row — AND a
 * push, when it is aimed at the other person.
 *
 * The push lives here rather than at each call site for the same reason the
 * `messages` row does: there are now six kinds of notice, and one of them
 * having a phone ping while the others quietly did not is exactly the drift
 * this function exists to prevent. Before this, `sendPush` was called from
 * precisely two places in the whole app — a test button in Settings and the Us
 * thread — so being handed a task, tagged in a thread, given a decision to
 * rule or asked a query reached you only if you happened to have the tab open.
 *
 * Fire-and-forget, and never for yourself: the thing that prompted the notice
 * has already happened, and a failed or self-addressed push must not undo it.
 */
function notice(
  store: AppStore,
  kind: MessageKind,
  taskId: string | null,
  body: string,
  summary: string,
  /** Who this is for. Defaults to the other person, which is true of every
   *  handoff notice; a query asked of yourself passes its own id and is
   *  skipped below. */
  recipientId: UserId = store.other.id,
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
  if (recipientId && recipientId !== store.meId) {
    void sendPush(recipientId, {
      title: store.me.name,
      body: body.slice(0, 140),
      url: noticeUrl(kind, taskId),
      tag: `orra-${kind}`,
      kind,
    });
  }
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
    // Multi-assignee (0045) calls this once per person added, so the push has
    // to follow the id it was handed rather than "the other one".
    assigneeId,
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
 * Tell someone a decision is now theirs to rule on.
 *
 * A decision holds up every task linked to it, so who owns it is the
 * difference between "waiting" and "waiting on you". Same silence rule as
 * assignment: taking a decision yourself announces nothing.
 */
export function notifyDecisionOwner(
  store: AppStore,
  question: string,
  ownerId: UserId | null,
  blocking: number,
): void {
  if (!ownerId || ownerId === store.meId) return;

  const held = blocking === 1 ? ' — 1 task is waiting on it' : blocking > 1 ? ` — ${blocking} tasks are waiting on it` : '';
  notice(
    store,
    'decision_assign',
    null,
    `Yours to rule on: ${question}${held}`,
    `Decision assigned — ${question}`,
    ownerId,
  );
}

/**
 * Ping a query into the thread the moment it is asked.
 *
 * Unlike a mention, this one fires even when you ask yourself — a query is a
 * question you want to come back to, and the thread is where both of them
 * already look. It is the only notice here that is not conditional on the
 * other person, which is the point: an informal question with no home is the
 * thing that gets lost.
 */
export function notifyQuery(store: AppStore, question: string, askedOf: UserId, taskId: string | null): void {
  const who = askedOf === store.meId ? 'Asked, for me to answer' : 'Asked you';
  // Addressed to whoever owes the answer, so asking yourself pushes nothing.
  notice(store, 'query', taskId, `${who}: ${question}`, `Query asked — ${question}`, askedOf);
}

/**
 * Tell someone you have put a block on their calendar.
 *
 * Fires on the proposal, not on acceptance: the whole reason the block appears
 * on their calendar immediately rather than waiting for a yes is that they
 * should find out now. The push lands even if they never open the app.
 */
export function notifyCalendarInvite(
  store: AppStore,
  label: string,
  dateIso: string,
  clock: string,
  inviteeId: UserId,
): void {
  if (!inviteeId || inviteeId === store.meId) return;
  notice(
    store,
    'calendar_invite',
    null,
    `${fmtDay(dateIso)} at ${clock} — ${label}. Unconfirmed until you accept.`,
    `Time proposed — ${label}`,
    inviteeId,
  );
}

/**
 * Tell the proposer their block was accepted.
 *
 * The inverse notice, and the reason `created_by` exists on the row: without
 * it there is no way to say who to tell.
 */
export function notifyCalendarConfirmed(
  store: AppStore,
  label: string,
  dateIso: string,
  clock: string,
  proposerId: UserId | null | undefined,
): void {
  if (!proposerId || proposerId === store.meId) return;
  notice(
    store,
    'calendar_confirm',
    null,
    `Confirmed: ${fmtDay(dateIso)} at ${clock} — ${label}`,
    `Time confirmed — ${label}`,
    proposerId,
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
    // The assigner is who wants to hear this, not "the other person" — the
    // same thing today with two people, not a thing to rely on.
    task.created_by,
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
    task.created_by,
  );
}
