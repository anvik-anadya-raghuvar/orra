import React from 'react';
import type { Dataset, Project, Sprint, TaskLinkType, TaskPriority, TaskStatus, TaskType } from '../../types';
import { PRIORITY_LABEL } from '../../types';

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
export const priClass = (p: TaskPriority) =>
  `wk-pri${p === 'urgent' ? ' u' : p === 'high' ? ' h' : ''}`;

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

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="wk-lbl">{label}</span>
      {children}
    </div>
  );
}
