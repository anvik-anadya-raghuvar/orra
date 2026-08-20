/**
 * The story of one task, assembled from what actually happened to it.
 *
 * Every mutation in the portal already writes an append-only `audit_trail` row
 * (principle 4), with the field name and the before/after values. That is the
 * honest record — it cannot be edited or deleted, and it is written by the
 * store rather than by each screen remembering to log. So this reads the trail
 * rather than inventing a second history table that could drift from it.
 *
 * What this module adds is narration: `status: todo → in_progress` is a true
 * record and an unreadable sentence. Everything here turns stored values into
 * something a person can scan.
 *
 * Pure on purpose — no React, no store — so the whole thing is testable and
 * cannot accidentally depend on who is looking at it.
 *
 * One honest limitation: rows for children (a comment, a subtask, a link) are
 * keyed by the child's own id, so attributing them to a task means looking the
 * child up in the current dataset. A child that has since been deleted can no
 * longer be resolved and its edits drop out of the story. The task's own rows
 * are never affected, and comments are read from the `comments` table directly
 * rather than from the trail, so the common cases stay complete.
 */
import { PRIORITY_LABEL, type AuditEntry, type Dataset, type TaskPriority, type UserId } from '../types';

/** Drives the icon and the accent colour of a row. */
export type TimelineKind =
  | 'created'
  | 'assigned'
  | 'accepted'
  | 'pushed_back'
  | 'status'
  | 'priority'
  | 'progress'
  | 'schedule'
  | 'blocked'
  | 'comment'
  | 'subtask'
  | 'link'
  | 'evidence'
  | 'decision'
  | 'edit';

export interface TimelineEvent {
  id: string;
  /** ISO timestamp. */
  at: string;
  actor: string;
  actorId: UserId | null;
  kind: TimelineKind;
  /** One readable line: "moved it to In progress". */
  text: string;
  /** Quoted content — a comment body, a pushback reason. Rendered apart. */
  detail?: string | null;
}

/**
 * Status names as a person says them.
 *
 * Duplicated from the Work tab's STATUSES rather than imported, because a
 * `lib/` module importing from `screens/` inverts the dependency — every other
 * lib here stays free of the UI layer, and this is four strings.
 */
const STATUS_TEXT: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
};

const EFFORT_TEXT: Record<string, string> = {
  light: 'light',
  medium: 'medium',
  heavy: 'heavy',
};

const statusText = (v: string | null) => (v ? STATUS_TEXT[v] ?? v : '—');
const priText = (v: string | null) =>
  v ? PRIORITY_LABEL[v as TaskPriority] ?? v : '—';

/** Fields whose change is worth a line of its own but needs no special prose. */
const PLAIN_EDITS: Record<string, string> = {
  title: 'renamed it',
  description: 'edited the description',
  acceptance_criteria: 'edited the acceptance criteria',
  tags: 'changed the tags',
  project_id: 'moved it to another project',
  objective_id: 'relinked the objective',
  type: 'changed the task type',
  sprint_id: 'moved it to another sprint',
  estimate_minutes: 'changed the estimate',
  impact: 'changed the impact',
  board_order: '',
  updated_at: '',
};

/** Rows that would add noise without adding information. */
function isNoise(row: AuditEntry): boolean {
  if (!row.field_name) return false;
  return PLAIN_EDITS[row.field_name] === '';
}

function truncate(v: string | null, n = 160): string | null {
  if (v == null) return null;
  return v.length > n ? `${v.slice(0, n)}…` : v;
}

/** Narrate one task-entity audit row. Returns null for rows worth hiding. */
function narrateTaskRow(
  row: AuditEntry,
  nameOf: (id: string | null) => string,
  creationId: string | null,
): { kind: TimelineKind; text: string; detail?: string | null } | null {
  const field = row.field_name;

  // A field-less row is a whole logged action rather than a column change —
  // the task being created, but also an export or an import that names itself
  // in `new_value`. Only the earliest is the creation; marking every one of
  // them "created" would put two birth markers on the same task.
  if (!field) {
    const kind: TimelineKind = row.id === creationId ? 'created' : 'edit';
    return row.new_value
      ? { kind, text: row.new_value }
      : { kind, text: 'created the task' };
  }
  if (isNoise(row)) return null;

  const from = row.old_value;
  const to = row.new_value;

  switch (field) {
    case 'status':
      return {
        kind: 'status',
        text: `moved it ${statusText(from)} → ${statusText(to)}`,
      };

    case 'priority':
      return {
        kind: 'priority',
        text: `asked for ${priText(to)}${from ? `, was ${priText(from)}` : ''}`,
      };

    case 'accepted_priority':
      // The commitment half of the handoff (0033_task_acceptance.sql). Shown
      // on its own only when it changes after acceptance — the accept itself
      // is merged into a single event below.
      return to
        ? { kind: 'accepted', text: `committed to ${priText(to)}` }
        : null;

    case 'acknowledged_at':
      return to ? { kind: 'accepted', text: 'accepted the task' } : null;

    case 'pushback_reason':
      return to
        ? { kind: 'pushed_back', text: 'pushed it back', detail: truncate(to) }
        : { kind: 'accepted', text: 'cleared the pushback' };

    case 'assignee_id':
      return {
        kind: 'assigned',
        text: from
          ? `reassigned it from ${nameOf(from)} to ${nameOf(to)}`
          : `assigned it to ${nameOf(to)}`,
      };

    case 'progress_pct':
      return { kind: 'progress', text: `progress ${from ?? 0}% → ${to ?? 0}%` };

    case 'due_date':
      return {
        kind: 'schedule',
        text: to ? `set the due date to ${to}` : 'cleared the due date',
      };

    case 'start_date':
      return {
        kind: 'schedule',
        text: to ? `set the start date to ${to}` : 'cleared the start date',
      };

    case 'is_stuck':
      return to === 'true'
        ? { kind: 'blocked', text: 'flagged it as stuck' }
        : { kind: 'blocked', text: 'cleared the stuck flag' };

    case 'blocked_reason':
      return to
        ? { kind: 'blocked', text: 'recorded what is blocking it', detail: truncate(to) }
        : { kind: 'blocked', text: 'cleared the blocker' };

    case 'effort':
      return { kind: 'edit', text: `changed effort to ${EFFORT_TEXT[to ?? ''] ?? to}` };

    default: {
      const plain = PLAIN_EDITS[field];
      if (plain) return { kind: 'edit', text: plain };
      // Unknown field — say so honestly rather than dropping a real change.
      return { kind: 'edit', text: `changed ${field.replace(/_/g, ' ')}` };
    }
  }
}

/** Same actor, same second — one user action that wrote several columns. */
function groupKey(row: AuditEntry): string {
  return `${row.actor_id ?? 'system'}|${row.occurred_at.slice(0, 19)}`;
}

/**
 * Build the full story of `taskId`, oldest first.
 *
 * Chronological rather than newest-first because this reads as a narrative —
 * created, assigned, accepted, worked, done. The UI offers a reverse toggle
 * for the day-to-day "what just happened" question.
 */
export function buildTaskTimeline(
  ds: Pick<
    Dataset,
    'audit_trail' | 'comments' | 'profiles' | 'subtasks' | 'task_links' | 'screenshot_attachments' | 'decisions'
  >,
  taskId: string,
): TimelineEvent[] {
  const nameOf = (id: string | null): string => {
    if (!id) return 'nobody';
    return ds.profiles.find((p) => p.id === id)?.name ?? id;
  };

  const events: TimelineEvent[] = [];

  /* ── the task's own rows ─────────────────────────────────────────────── */
  const own = ds.audit_trail.filter(
    (row) => row.entity_type === 'task' && row.entity_id === taskId,
  );

  /* Which field-less row is the creation: the earliest one. Ties break on id
     so the choice is stable across renders. */
  const creationId =
    own
      .filter((r) => !r.field_name)
      .sort((a, b) => (a.occurred_at === b.occurred_at ? a.id.localeCompare(b.id) : a.occurred_at < b.occurred_at ? -1 : 1))[0]
      ?.id ?? null;

  // Accepting writes acknowledged_at and accepted_priority together. Two rows
  // for one decision reads as the app stuttering, so they merge into the
  // sentence the person would actually say.
  const byAction = new Map<string, AuditEntry[]>();
  for (const row of own) {
    const key = groupKey(row);
    const bucket = byAction.get(key);
    if (bucket) bucket.push(row);
    else byAction.set(key, [row]);
  }

  for (const rows of byAction.values()) {
    const ack = rows.find((r) => r.field_name === 'acknowledged_at' && r.new_value);
    const took = rows.find((r) => r.field_name === 'accepted_priority' && r.new_value);

    if (ack) {
      events.push({
        id: ack.id,
        at: ack.occurred_at,
        actor: ack.actor_label,
        actorId: ack.actor_id,
        kind: 'accepted',
        text: took
          ? `accepted it at ${priText(took.new_value)}`
          : 'accepted the task',
      });
    }

    for (const row of rows) {
      // Already spoken for by the merged accept event above.
      if (ack && (row.field_name === 'acknowledged_at' || row.field_name === 'accepted_priority')) {
        continue;
      }
      const said = narrateTaskRow(row, nameOf, creationId);
      if (!said) continue;
      events.push({
        id: row.id,
        at: row.occurred_at,
        actor: row.actor_label,
        actorId: row.actor_id,
        kind: said.kind,
        text: said.text,
        detail: said.detail ?? null,
      });
    }
  }

  /* ── comments ────────────────────────────────────────────────────────── */
  // Read from the table, not the trail: the trail records that a comment row
  // appeared, while the table still holds what it said.
  for (const c of ds.comments.filter((x) => x.task_id === taskId)) {
    events.push({
      id: `cmt-${c.id}`,
      at: c.created_at,
      actor: nameOf(c.author_id),
      actorId: c.author_id,
      kind: c.is_decision ? 'decision' : 'comment',
      text: c.is_decision ? 'flagged a decision' : 'commented',
      detail: truncate(c.body, 400),
    });
  }

  /* ── children: resolve the child id back to this task ────────────────── */
  const childIds = new Map<string, TimelineKind>();
  for (const s of ds.subtasks.filter((x) => x.task_id === taskId)) childIds.set(s.id, 'subtask');
  for (const s of ds.screenshot_attachments.filter((x) => x.task_id === taskId)) {
    childIds.set(s.id, 'evidence');
  }
  for (const l of ds.task_links.filter((x) => x.from_task_id === taskId || x.to_task_id === taskId)) {
    childIds.set(l.id, 'link');
  }

  const CHILD_TYPES = new Set(['subtask', 'screenshot_attachment', 'task_link']);
  for (const row of ds.audit_trail) {
    if (!CHILD_TYPES.has(row.entity_type)) continue;
    const kind = childIds.get(row.entity_id);
    if (!kind) continue;
    events.push({
      id: row.id,
      at: row.occurred_at,
      actor: row.actor_label,
      actorId: row.actor_id,
      kind,
      text: childText(kind, row),
      detail: null,
    });
  }

  /* Stable order: time first, then id, so two events in the same millisecond
     never swap places between renders. */
  return events.sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at < b.at ? -1 : 1));
}

function childText(kind: TimelineKind, row: AuditEntry): string {
  const created = !row.field_name && row.new_value;
  if (kind === 'subtask') {
    if (created) return 'added a subtask';
    if (row.field_name === 'completed') {
      return row.new_value === 'true' ? 'ticked a subtask' : 'unticked a subtask';
    }
    if (row.field_name === 'title') return 'renamed a subtask';
    return 'changed a subtask';
  }
  if (kind === 'evidence') return created ? 'attached evidence' : 'changed an attachment';
  return created ? 'linked another task' : 'changed a task link';
}

/** Counts for the section header — "12 events · opened 6 days ago". */
export function timelineSummary(events: TimelineEvent[]): {
  count: number;
  first: string | null;
  last: string | null;
} {
  return {
    count: events.length,
    first: events[0]?.at ?? null,
    last: events[events.length - 1]?.at ?? null,
  };
}
