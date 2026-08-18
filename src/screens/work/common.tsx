import React from 'react';
import type { Dataset, Project, TaskPriority, TaskStatus, TaskType } from '../../types';

/* ── vocabulary shared by the three Work tabs ─────────────────────────── */

export const STATUSES: { key: TaskStatus; label: string; dot: string }[] = [
  { key: 'todo', label: 'Todo', dot: 'var(--mute)' },
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
