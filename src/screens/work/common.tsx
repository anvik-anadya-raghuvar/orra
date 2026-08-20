import React, { useId, useState } from 'react';
import type { Dataset, Project, Sprint, TaskLinkType, TaskPriority, TaskStatus, TaskType } from '../../types';
import { PRIORITY_LABEL } from '../../types';
import { DictateField } from '../../ui/dictation';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { useToast } from '../../ui/bits';

/* ── vocabulary shared by the three Work tabs ─────────────────────────── */

export const STATUSES: { key: TaskStatus; label: string; dot: string }[] = [
  { key: 'backlog', label: 'Backlog', dot: 'var(--slate)' },
  { key: 'todo', label: 'To do', dot: 'var(--mute)' },
  { key: 'in_progress', label: 'In progress', dot: 'var(--indigo)' },
  { key: 'in_review', label: 'In review', dot: 'var(--stamp)' },
  { key: 'done', label: 'Done', dot: 'var(--teal)' },
];

/**
 * One priority vocabulary for the whole app.
 *
 * These used to read "Urgent / High / Normal / Low" in the forms while the
 * board badges and filter chips read "P0–P3" off PRIORITY_LABEL — the same
 * four stored values wearing two different names, so there was no way to tell
 * which control set the P0 you were looking at. The label now comes from the
 * one place that defines it; the English word survives as the hint, because
 * "P2" alone does not tell a new reader it means "normal".
 */
export const PRIORITIES: { key: TaskPriority; label: string; hint: string }[] = [
  { key: 'urgent', label: PRIORITY_LABEL.urgent, hint: 'Urgent' },
  { key: 'high', label: PRIORITY_LABEL.high, hint: 'High' },
  { key: 'normal', label: PRIORITY_LABEL.normal, hint: 'Normal' },
  { key: 'low', label: PRIORITY_LABEL.low, hint: 'Low' },
];

export const statusLabel = (s: TaskStatus) => STATUSES.find((x) => x.key === s)?.label ?? s;

/**
 * Task type is free text (0035_free_project_and_type.sql), so there is no
 * lookup table to read a label from any more — this just makes a stored
 * value ("code_change") look like something a person typed ("Code change").
 */
export const typeLabel = (t: TaskType) =>
  t
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

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
  options: { key: T; label: string; hint?: string }[];
  label?: string;
}) {
  return (
    <div className="wk-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          /* A code like "P2" is not a readable name on its own, so the hint
             carries the English word to a screen reader and to a hover. */
          aria-label={o.hint ? `${o.label} — ${o.hint}` : undefined}
          title={o.hint}
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

/* ── open-ended pickers: project and task type ───────────────────────────
   Projects are real rows (principle 8), never an enum, but until now the
   only place to make one was Admin. Task type used to be a fixed 4-value
   list (0035_free_project_and_type.sql lifted that constraint). Both
   pickers below share one shape: a select of what already exists, plus a
   "+ New…" option that reveals a one-line create form inline, so creating
   either never leaves the task you're on. */

const NEW_SENTINEL = '__new__';

export function ProjectPicker({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (id: string) => void;
  /** Forwarded to the underlying select, so an external <label htmlFor> still
   *  points at the right control once the create-form isn't showing. */
  id?: string;
}) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const create = () => {
    const clean = name.trim();
    if (!clean) return;
    if (ds.projects.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      toast(`"${clean}" already exists`);
      return;
    }
    const id = newId('proj');
    const color = `var(--${WORK_TAG_COLORS[ds.projects.length % WORK_TAG_COLORS.length]})`;
    store.insert(
      'projects',
      { id, name: clean, color, description: '', is_personal: false, created_at: nowIso() },
      store.asMe({ summary: `Project created — ${clean}` }),
    );
    onChange(id);
    toast(`"${clean}" created`);
    setName('');
    setCreating(false);
  };

  if (creating) {
    return (
      <div className="wk-inline-create">
        <input
          className="wk-in"
          autoFocus
          value={name}
          placeholder="New project name"
          aria-label="New project name"
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); create(); }
            if (e.key === 'Escape') { setCreating(false); setName(''); }
          }}
        />
        <button type="button" className="btn sm solid" onClick={create} disabled={!name.trim()}>
          Add
        </button>
        <button type="button" className="btn sm" onClick={() => { setCreating(false); setName(''); }}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <select
      id={id}
      className="wk-in"
      value={value}
      aria-label="Project"
      onChange={(e) => (e.target.value === NEW_SENTINEL ? setCreating(true) : onChange(e.target.value))}
    >
      {ds.projects.length === 0 && <option value="">— no projects yet —</option>}
      {ds.projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
      <option value={NEW_SENTINEL}>+ New project…</option>
    </select>
  );
}

export function TypePicker({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (t: string) => void;
  id?: string;
}) {
  const ds = useData((d) => d);
  const [creating, setCreating] = useState(false);
  const [text, setText] = useState('');

  /* Every distinct type already in use, across every task the client can
     see — task type is shared vocabulary, not per-owner like a tag, so this
     deliberately isn't scoped to "my" tasks the way liveTags is. */
  const known = [...new Set(ds.tasks.map((t) => t.type).filter(Boolean))].sort();
  const options = known.includes(value) || !value ? known : [...known, value].sort();

  const apply = () => {
    const clean = text.trim();
    if (!clean) return;
    onChange(clean);
    setText('');
    setCreating(false);
  };

  if (creating) {
    return (
      <div className="wk-inline-create">
        <input
          className="wk-in"
          autoFocus
          value={text}
          placeholder="New task type"
          aria-label="New task type"
          maxLength={60}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); apply(); }
            if (e.key === 'Escape') { setCreating(false); setText(''); }
          }}
        />
        <button type="button" className="btn sm solid" onClick={apply} disabled={!text.trim()}>
          Add
        </button>
        <button type="button" className="btn sm" onClick={() => { setCreating(false); setText(''); }}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <select
      id={id}
      className="wk-in"
      value={value}
      aria-label="Task type"
      onChange={(e) => (e.target.value === NEW_SENTINEL ? setCreating(true) : onChange(e.target.value))}
    >
      {!value && <option value="">{options.length === 0 ? '— no types yet —' : '— choose a type —'}</option>}
      {options.map((t) => (
        <option key={t} value={t}>
          {typeLabel(t)}
        </option>
      ))}
      <option value={NEW_SENTINEL}>+ New type…</option>
    </select>
  );
}
