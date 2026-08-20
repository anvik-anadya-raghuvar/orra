import React, { useId } from 'react';
import type { Dataset, Project, Sprint, TaskLinkType, TaskPriority, TaskStatus, TaskType } from '../../types';
import { PRIORITY_LABEL } from '../../types';
import { DictateField } from '../../ui/dictation';

/* ── vocabulary shared by the three Work tabs ─────────────────────────── */

export const STATUSES: { key: TaskStatus; label: string; dot: string }[] = [
  { key: 'backlog', label: 'Backlog', dot: 'var(--slate)' },
  { key: 'todo', label: 'To do', dot: 'var(--mute)' },
  { key: 'in_progress', label: 'In progress', dot: 'var(--indigo)' },
  { key: 'in_review', label: 'In review', dot: 'var(--stamp)' },
  { key: 'done', label: 'Done', dot: 'var(--teal)' },
];

export const TYPES: { key: TaskType; label: string }[] = [
  { key: 'code_change', label: 'Code' },
  { key: 'ops', label: 'Ops' },
  { key: 'finance', label: 'Finance' },
  { key: 'research', label: 'Research' },
];

export const PRIORITIES: { key: TaskPriority; label: string }[] = [
  { key: 'urgent', label: 'Urgent' },
  { key: 'high', label: 'High' },
  { key: 'normal', label: 'Normal' },
  { key: 'low', label: 'Low' },
];

export const statusLabel = (s: TaskStatus) => STATUSES.find((x) => x.key === s)?.label ?? s;
export const typeLabel = (t: TaskType) => TYPES.find((x) => x.key === t)?.label ?? t;

/** P0–P3 badge. Display only — the stored value stays urgent/high/normal/low. */
export const priBadge = (p: TaskPriority) => PRIORITY_LABEL[p];
export const priBadgeClass = (p: TaskPriority) => `wk-pbadge ${p}`;

/* ── sprints ──────────────────────────────────────────────────────────── */

/** Sprints are database rows, never constants — read them, never hard-code. */
export const sprintsOf = (ds: Dataset): Sprint[] =>
  [...ds.sprints].sort((a, b) => b.position - a.position || a.name.localeCompare(b.name));
export const liveSprints = (ds: Dataset): Sprint[] => sprintsOf(ds).filter((s) => !s.is_archived);
/** "Current sprint" = the live sprint whose window contains today, else the
 *  highest-positioned live sprint. Nothing about it is hard-coded. */
export function currentSprint(ds: Dataset, todayIso: string): Sprint | undefined {
  const live = liveSprints(ds);
  return (
    live.find(
      (s) => (!s.starts_on || s.starts_on <= todayIso) && (!s.ends_on || s.ends_on >= todayIso),
    ) ?? live[0]
  );
}
export const sprintName = (ds: Dataset, id: string | null) =>
  id === null ? 'Backlog' : ds.sprints.find((s) => s.id === id)?.name ?? id;

/* ── task links ───────────────────────────────────────────────────────── */

export const LINK_TYPES: { key: TaskLinkType; label: string }[] = [
  { key: 'blocks', label: 'blocks' },
  { key: 'blocked_by', label: 'is blocked by' },
  { key: 'related', label: 'relates to' },
  { key: 'child_of', label: 'is a child of' },
];

/** How a link reads from the *other* end of the arrow. */
export const INVERSE_LINK_LABEL: Record<TaskLinkType, string> = {
  blocks: 'is blocked by',
  blocked_by: 'blocks',
  related: 'relates to',
  child_of: 'is the parent of',
};
export const linkLabel = (type: TaskLinkType, outgoing: boolean) =>
  outgoing ? LINK_TYPES.find((l) => l.key === type)!.label : INVERSE_LINK_LABEL[type];

/** task id → its parent task id, from `child_of` links. */
export function parentOf(ds: Dataset): Map<string, string> {
  const out = new Map<string, string>();
  for (const l of ds.task_links) if (l.type === 'child_of') out.set(l.from_task_id, l.to_task_id);
  return out;
}

/** Palette for auto-created tags — mirrors the admin tag screen. */
export const WORK_TAG_COLORS = ['indigo', 'teal', 'stamp', 'rose', 'sky', 'violet', 'slate'];

export const projOf = (ds: Dataset, id: string): Project | undefined =>
  ds.projects.find((p) => p.id === id);
export const projName = (ds: Dataset, id: string) => projOf(ds, id)?.name ?? id;
export const projColor = (ds: Dataset, id: string) => projOf(ds, id)?.color ?? 'var(--slate)';
export const personName = (ds: Dataset, id: string | null) =>
  ds.profiles.find((p) => p.id === id)?.name ?? 'Unassigned';

/** task id → number of annotation pins across all of its screenshots. */
export function pinCounts(ds: Dataset): Record<string, number> {
  const shotTask = new Map<string, string>();
  for (const s of ds.screenshot_attachments) shotTask.set(s.id, s.task_id);
  const out: Record<string, number> = {};
  for (const p of ds.annotation_pins) {
    const t = shotTask.get(p.screenshot_id);
    if (t) out[t] = (out[t] ?? 0) + 1;
  }
  return out;
}

/* ── small form primitives (44px targets, no hover-only affordances) ──── */

export function Segment<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { key: T; label: string }[];
  label?: string;
}) {
  return (
    <div className="wk-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Field types worth speaking into. A select, a date or a number gets no mic —
 * dictating "the fourteenth" into a date picker is not a feature.
 */
const SPOKEN_INPUT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel', undefined]);

function acceptsDictation(only: React.ReactElement): boolean {
  if (only.type === 'textarea') return true;
  if (only.type !== 'input') return false;
  return SPOKEN_INPUT_TYPES.has((only.props as { type?: string }).type);
}

/**
 * A labelled form field.
 *
 * The label is associated with its control, not merely drawn above it — a
 * styled span leaves a screen reader announcing "combo box" with no name. A
 * single element child is given a generated id and matched with htmlFor;
 * anything else (a segmented control of buttons, say) falls back to a group
 * label, since htmlFor can only point at one control.
 */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  const only = React.isValidElement(children) ? children : null;
  if (only) {
    const withId = React.cloneElement(only as React.ReactElement<{ id?: string }>, { id });
    return (
      <div>
        <label className="wk-lbl" htmlFor={id}>
          {label}
        </label>
        {/* Every prose field in Work gets a mic from here rather than from
            thirty call sites, and gets it consistently — same place, same
            size, same behaviour, whether it is a task title or a decision. */}
        {acceptsDictation(only) ? (
          <DictateField label={`Dictate ${label.toLowerCase()}`}>{withId}</DictateField>
        ) : (
          withId
        )}
      </div>
    );
  }
  return (
    <div role="group" aria-label={label}>
      <span className="wk-lbl">{label}</span>
      {children}
    </div>
  );
}

/**
 * Canonical form of a task relationship, so the same fact cannot be stored
 * twice under two spellings.
 *
 *  - `related` is symmetric: A relates to B IS B relates to A.
 *  - `blocks` and `blocked_by` are inverses: A blocks B IS B blocked_by A.
 *  - `child_of` is directional and has no inverse in this model, so it is
 *    canonical already — A child_of B is genuinely not B child_of A.
 *
 * The database's UNIQUE(from, to, type) cannot express any of that, which is
 * why the check lives here and runs before the insert.
 */
export function canonicalLink(from: string, to: string, type: TaskLinkType): string {
  if (type === 'blocked_by') return `${to}|blocks|${from}`;
  if (type === 'related') {
    const [a, b] = [from, to].sort();
    return `${a}|related|${b}`;
  }
  return `${from}|${type}|${to}`;
}

/** True when this relationship is already recorded, in any equivalent form. */
export function linkExists(
  links: { from_task_id: string; to_task_id: string; type: TaskLinkType }[],
  from: string,
  to: string,
  type: TaskLinkType,
): boolean {
  const key = canonicalLink(from, to, type);
  return links.some((l) => canonicalLink(l.from_task_id, l.to_task_id, l.type) === key);
}
