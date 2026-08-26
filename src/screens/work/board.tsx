import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Pencil, Trash2 } from 'lucide-react';
import type { DayEvent, Dataset, Effort, Task, TaskPriority, TaskStatus, TaskType } from '../../types';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { Avatar, DraftRestored, SideSheet, TagChip, useToast } from '../../ui/bits';
import { useFormDraft } from '../../ui/useFormDraft';
import { entrance, lift, micro, spring, staggerItem, staggerParent } from '../../ui/motion';
import { fmtDay, todayIso } from '../../lib/dates';
import { makeTask } from '../../lib/taskFactory';
import { taskProgressPct } from '../../lib/checklist';
import { inAnyProject, taskAssignees, taskProjects, taskTypes } from '../../lib/taskFacets';
import { FacetChips, FacetToggles } from '../../ui/FacetPicker';
import { BriefChecklist } from '../../ui/BriefChecklist';
import { stuckTasks } from '../../lib/ranking';
import { assignedOut, awaitingThem, inboxTasks, isMyTask, myTasks, priorityDiffers } from '../../lib/workspace';
import { notifyAcceptance, notifyAssignment, notifyPushback } from '../../lib/handoff';
import { spawnNextOccurrence } from '../../lib/repeatActions';
import { MiniBars } from '../../ui/viz';
import { ImageDrop, processImages, useImagePaste, type DroppedImage } from '../../ui/imagedrop';
import { insertInlineImages, removeInlineImage } from '../../ui/inlineImages';
import QuickEdit from './quickedit';
import ReflowBanner from './reflow';
import DraftEvidenceEditor, { type DraftPin, type DraftShot } from './DraftEvidenceEditor';
import { blockedByOpenDep } from '../../lib/schedule';
import { minToLabel } from '../../lib/dayPlan';
import { ProjectCombo, TypeCombo } from '../../ui/pickers';
import {
  Field,
  PRIORITIES,
  STATUSES,
  Segment,
  WORK_TAG_COLORS,
  currentSprint,
  liveSprints,
  parentOf,
  personName,
  pinCounts,
  priBadge,
  priBadgeClass,
  projColor,
  projName,
  sprintName,
  statusLabel,
  typeLabel,
} from './common';

type View = 'kanban' | 'list' | 'calendar' | 'timeline';

/** Cards mounted per column before "show more" — keeps board render under budget. */
const COLUMN_PAGE = 25;

/** Column order: manual board_order first, id only to break exact ties. */
const byOrder = (a: Task, b: Task) => a.board_order - b.board_order || a.id.localeCompare(b.id);

/**
 * Lay a column out so a `child_of` task sits directly beneath its parent when
 * both are in the same column. Only one level nests — a grandchild stays at
 * top level rather than disappearing because its parent was itself absorbed.
 */
function arrange(col: Task[], parent: Map<string, string>): { t: Task; childOf: string | null }[] {
  const sorted = [...col].sort(byOrder);
  const ids = new Set(sorted.map((t) => t.id));
  const nests = (id: string) => {
    const p = parent.get(id);
    return p && p !== id && ids.has(p) && !(parent.get(p) && ids.has(parent.get(p)!)) ? p : null;
  };
  const kids = new Map<string, Task[]>();
  for (const t of sorted) {
    const p = nests(t.id);
    if (p) kids.set(p, [...(kids.get(p) ?? []), t]);
  }
  const out: { t: Task; childOf: string | null }[] = [];
  for (const t of sorted) {
    if (nests(t.id)) continue; // rendered under its parent below
    out.push({ t, childOf: parent.get(t.id) ?? null });
    for (const k of kids.get(t.id) ?? []) out.push({ t: k, childOf: t.id });
  }
  return out;
}

const VIEWS: { key: View; label: string }[] = [
  { key: 'kanban', label: 'Kanban' },
  { key: 'list', label: 'List' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'timeline', label: 'Timeline' },
];

const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
};

/* ── work the other person pushed at me ───────────────────────────────── */

/**
 * One arrival, opened for a reply.
 *
 * Accepting is not a single button any more. The assignee says what priority
 * they are actually committing to — which may not be the one that was asked
 * for — and can attach a line about it. The alternative to accepting is
 * pushing back with a reason, which keeps the task assigned to them and flags
 * it to the assigner rather than dropping it into a gap neither board shows.
 */
function InboxRow({ task, otherName }: { task: Task; otherName: string }) {
  const store = useStore();
  const toast = useToast();
  const [open, setOpen] = useState<'accept' | 'push' | null>(null);
  /* Pre-selected to what was asked for: agreeing is the common case and should
     cost no clicks, while disagreeing stays one tap away. */
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [note, setNote] = useState('');
  /* The Work screen's MotionConfig reducedMotion="user" spares height, which is
     the only thing this panel animates — so it has to be opted out by hand for
     the panel to snap open the way the motion rules require. */
  const still = useReducedMotion();

  const accept = () => {
    store.update(
      'tasks',
      task.id,
      {
        acknowledged_at: nowIso(),
        accepted_priority: priority,
        /* Accepting resolves any earlier pushback — the two must never both
           read as live. */
        pushback_reason: null,
        pushed_back_at: null,
      },
      store.asMe({ summary: `Accepted ${task.id} from ${otherName} at ${priBadge(priority)}` }),
    );
    if (note.trim()) {
      store.insert(
        'comments',
        {
          id: newId('c'),
          task_id: task.id,
          author_id: store.meId,
          body: note.trim(),
          is_decision: false,
          created_at: nowIso(),
        },
        store.asMe({ summary: `Comment on accepting ${task.id}` }),
      );
    }
    notifyAcceptance(store, task, priority, note);
    toast(`${task.id} is on your board at ${priBadge(priority)}.`);
    setOpen(null);
  };

  const pushBack = () => {
    const reason = note.trim();
    if (!reason) return;
    store.update(
      'tasks',
      task.id,
      { pushback_reason: reason, pushed_back_at: nowIso() },
      store.asMe({ summary: `Pushed ${task.id} back to ${otherName}` }),
    );
    notifyPushback(store, task, reason);
    toast(`Sent back to ${otherName}.`);
    setOpen(null);
    setNote('');
  };

  const pushedBack = !!task.pushback_reason;

  return (
    <motion.li variants={staggerItem} className={pushedBack ? 'pushed' : undefined}>
      <div className="wk-inbox-row">
        <Link to={`/task/${task.id}`} className="wk-inbox-task">
          <span className="mono">{task.id}</span>
          <span className="wk-inbox-title">{task.title}</span>
          <span className={priBadgeClass(task.priority)}>{priBadge(task.priority)}</span>
          {task.due_date && <span className="mono planmin">due {fmtDay(task.due_date)}</span>}
        </Link>
        <div className="wk-inbox-acts">
          <button
            type="button"
            className="btn sm solid"
            aria-expanded={open === 'accept'}
            onClick={() => setOpen(open === 'accept' ? null : 'accept')}
          >
            Accept
          </button>
          <button
            type="button"
            className="btn sm"
            aria-expanded={open === 'push'}
            onClick={() => setOpen(open === 'push' ? null : 'push')}
          >
            {pushedBack ? 'Sent back' : 'Push back'}
          </button>
        </div>
      </div>

      {pushedBack && open !== 'push' && (
        <p className="wk-inbox-pushed">
          You sent this back: “{task.pushback_reason}”
        </p>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            className="wk-inbox-panel"
            initial={still ? false : { opacity: 0, height: 0 }}
            animate={
              still
                ? { opacity: 1, height: 'auto', transition: { duration: 0 } }
                : { opacity: 1, height: 'auto', transition: entrance }
            }
            exit={still ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0, transition: micro }}
          >
            {open === 'accept' && (
              <Field label={`Priority you're committing to — ${otherName} asked ${priBadge(task.priority)}`}>
                <Segment
                  value={priority}
                  onChange={setPriority}
                  options={PRIORITIES}
                  label="Priority you are committing to"
                />
              </Field>
            )}
            <Field
              label={open === 'push' ? 'Why are you sending it back?' : 'Add a line (optional)'}
            >
              <textarea
                className="wk-in"
                rows={2}
                value={note}
                placeholder={
                  open === 'push'
                    ? 'Not this week — the registry work lands first'
                    : 'Starting Friday once v3.8 is frozen'
                }
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <div className="wk-inbox-confirm">
              {open === 'accept' ? (
                <button type="button" className="btn sm solid" onClick={accept}>
                  Accept at {priBadge(priority)}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn sm solid"
                  disabled={!note.trim()}
                  onClick={pushBack}
                >
                  Send back
                </button>
              )}
              <button type="button" className="btn sm" onClick={() => setOpen(null)}>
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/** Arrivals land here first rather than appearing mid-column, so a task can
 *  never turn up on the board without the owner noticing it turned up. */
function Inbox({ tasks }: { tasks: Task[] }) {
  const other = useData((_, s) => s.other);
  if (!tasks.length) return null;

  return (
    <motion.section
      className="wk-inbox"
      aria-label={`Assigned to you by ${other.name}`}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0, transition: entrance }}
    >
      <div className="wk-inbox-hd">
        <span className="eyebrow">Assigned to you by {other.name}</span>
        <span className="mono">{tasks.length}</span>
      </div>
      <motion.ul className="wk-inbox-list" {...staggerParent()}>
        {tasks.map((t) => (
          <InboxRow key={t.id} task={t} otherName={other.name} />
        ))}
      </motion.ul>
    </motion.section>
  );
}

/**
 * The other half of the loop: what I pushed at them and they have not taken.
 *
 * Without this, assignment was write-and-forget — a task could sit unaccepted
 * indefinitely and the person who assigned it would never know.
 */
function AwaitingThem({ tasks }: { tasks: Task[] }) {
  const other = useData((_, s) => s.other);
  if (!tasks.length) return null;

  return (
    <motion.section
      className="wk-inbox awaiting"
      aria-label={`Waiting on ${other.name}`}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0, transition: entrance }}
    >
      <div className="wk-inbox-hd">
        <span className="eyebrow">Waiting on {other.name}</span>
        <span className="mono">{tasks.length}</span>
      </div>
      <motion.ul className="wk-inbox-list" {...staggerParent()}>
        {tasks.map((t) => (
          <motion.li key={t.id} variants={staggerItem}>
            <div className="wk-inbox-row">
              <Link to={`/task/${t.id}`} className="wk-inbox-task">
                <span className="mono">{t.id}</span>
                <span className="wk-inbox-title">{t.title}</span>
                <span className={priBadgeClass(t.priority)}>{priBadge(t.priority)}</span>
              </Link>
              <span className={`wk-inbox-state${t.pushback_reason ? ' pushed' : ''}`}>
                {t.pushback_reason ? 'Sent back' : 'Not opened yet'}
              </span>
            </div>
            {t.pushback_reason && (
              <p className="wk-inbox-pushed">
                {other.name}: “{t.pushback_reason}”
              </p>
            )}
          </motion.li>
        ))}
      </motion.ul>
    </motion.section>
  );
}

/**
 * Everything I handed to the other person, accepted or not.
 *
 * `AwaitingThem` above clears itself the moment they acknowledge, which is
 * right for chasing a handoff and useless for knowing what is on their plate.
 * This one stays. Collapsed by default so it never pushes the board down.
 */
function HandedOut({ tasks }: { tasks: Task[] }) {
  const other = useData((_, s) => s.other);
  const [open, setOpen] = useState(false);
  if (!tasks.length) return null;

  const done = tasks.filter((t) => t.status === 'done').length;

  return (
    <motion.section
      className="wk-inbox handed"
      aria-label={`Assigned to ${other.name}`}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0, transition: entrance }}
    >
      <button
        type="button"
        className="wk-inbox-hd wk-handed-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="eyebrow">Assigned to {other.name}</span>
        <span className="mono">
          {done}/{tasks.length} done
        </span>
        {/* Framer, not a CSS transform transition — this way the rotation
            inherits the screen's MotionConfig reducedMotion="user". */}
        <motion.span
          style={{ display: 'inline-flex' }}
          animate={{ rotate: open ? 180 : 0 }}
          transition={micro}
          aria-hidden
        >
          <ChevronDown size={16} strokeWidth={1.8} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            className="wk-inbox-list"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto', transition: entrance }}
            exit={{ opacity: 0, height: 0, transition: { duration: 0.16 } }}
          >
            {tasks.map((t) => (
              <li key={t.id}>
                <div className="wk-inbox-row">
                  <Link to={`/task/${t.id}`} className="wk-inbox-task">
                    <span className="mono">{t.id}</span>
                    <span className="wk-inbox-title">{t.title}</span>
                    <span className={priBadgeClass(t.priority)}>{priBadge(t.priority)}</span>
                  </Link>
                  <span className="wk-inbox-state">{statusLabel(t.status)}</span>
                </div>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

/* ── the card body, shared by kanban ──────────────────────────────────── */
function TaskCard({
  t,
  ds,
  pins,
  onMove,
  onEdit,
  stuckReason,
  waitingOn,
  blockedBy,
  childOf,
  dragging,
  readOnly = false,
}: {
  t: Task;
  ds: Dataset;
  pins: number;
  onMove: (t: Task, dir: -1 | 1) => void;
  onEdit: (t: Task) => void;
  stuckReason?: string;
  /** Id of the unfinished task this one cannot start before. */
  waitingOn?: string;
  /** The open decision holding this up, if any — derived from decisions.task_ids
   *  rather than stored on the task, so a ruling clears every card at once. */
  blockedBy?: string;
  childOf: string | null;
  dragging: boolean;
  /** Someone else's card: readable and openable, but not steerable from here. */
  readOnly?: boolean;
}) {
  const idx = STATUSES.findIndex((s) => s.key === t.status);
  const parent = childOf ? ds.tasks.find((x) => x.id === childOf) : null;
  return (
    <motion.div
      className={`wk-card${dragging ? ' dragging' : ''}${childOf ? ' child' : ''}`}
      layout
      layoutId={`wk-card-${t.id}`}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1, transition: entrance }}
      exit={{ opacity: 0, scale: 0.96, transition: micro }}
      whileHover={{ y: -4, boxShadow: 'var(--sh2)', transition: micro }}
      whileTap={{ scale: 0.99 }}
    >
      {parent && (
        <Link className="wk-parent" to={`/task/${parent.id}`} draggable={false}>
          ↳ <span className="mono">{parent.id}</span> {parent.title}
        </Link>
      )}
      <Link className="wk-cardlink" to={`/task/${t.id}`} draggable={false}>
        <span className="wk-id">
          {t.id} · {typeLabel(t.type)}
        </span>
        <p className="wk-t">{t.title}</p>
        <span className="wk-meta">
          <span className={priBadgeClass(t.priority)} title={t.priority}>
            {priBadge(t.priority)}
          </span>
          {/* The assignee committed to something other than what was asked.
              Showing both is the whole point of storing both — it is the
              prompt for a conversation, not an error state. */}
          {priorityDiffers(t) && t.accepted_priority && (
            <span
              className={`${priBadgeClass(t.accepted_priority)} wk-pri-taken`}
              title={`Asked ${priBadge(t.priority)}, accepted at ${priBadge(t.accepted_priority)}`}
            >
              → {priBadge(t.accepted_priority)}
            </span>
          )}
          {taskProjects(t).map((id) => (
            <span key={id} className="tagc" style={{ background: 'var(--surf3)', color: projColor(ds, id) }}>
              {projName(ds, id)}
            </span>
          ))}
          {taskAssignees(t).map((id) => (
            <Avatar key={id} userId={id} size={22} />
          ))}
          {taskAssignees(t).length === 0 && <Avatar userId={null} size={22} />}
          {t.due_date && <span>{fmtDay(t.due_date)}</span>}
          {pins > 0 && <span className="wk-pc">{pins} pins</span>}
          {stuckReason && (
            <span className="wk-stuck" title={stuckReason}>
              stuck
            </span>
          )}
          {waitingOn && (
            <span
              className="wk-wait"
              title={`Cannot start until ${waitingOn} is done`}
            >
              waiting on {waitingOn}
            </span>
          )}
          {blockedBy && (
            <span className="wk-blocked" title={`Blocked until this is ruled: ${blockedBy}`}>
              blocked
            </span>
          )}
        </span>
        <span className="wk-meta" style={{ marginTop: 5 }}>
          <span className="wk-chip mono">{t.effort}</span>
          <span className="wk-chip mono">{t.estimate_minutes}m</span>
          <span className="wk-chip mono">{sprintName(ds, t.sprint_id)}</span>
        </span>
        {t.tags.length > 0 && (
          <span className="wk-meta" style={{ marginTop: 7 }}>
            {t.tags.map((x) => (
              <TagChip key={x} name={x} />
            ))}
          </span>
        )}
        <span className="wk-pbar" style={{ display: 'block' }}>
          <motion.span
            style={{ display: 'block', height: '100%', borderRadius: 3, background: 'linear-gradient(90deg,var(--violet),var(--indigo))' }}
            initial={{ width: 0 }}
            animate={{ width: `${t.progress_pct}%` }}
            transition={spring}
          />
        </span>
      </Link>
      <div className="wk-move">
        <button
          type="button"
          disabled={readOnly || idx <= 0}
          aria-label={`Move ${t.id} to ${STATUSES[Math.max(0, idx - 1)].label}`}
          onClick={() => onMove(t, -1)}
        >
          <ChevronLeft size={18} strokeWidth={1.9} />
        </button>
        <span className="wk-movelbl">{statusLabel(t.status)}</span>
        <button
          type="button"
          disabled={readOnly || idx >= STATUSES.length - 1}
          aria-label={`Move ${t.id} to ${STATUSES[Math.min(STATUSES.length - 1, idx + 1)].label}`}
          onClick={() => onMove(t, 1)}
        >
          <ChevronRight size={18} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          disabled={readOnly}
          aria-label={`Quick edit ${t.id}`}
          onClick={() => onEdit(t)}
        >
          <Pencil size={16} strokeWidth={1.9} />
        </button>
      </div>
    </motion.div>
  );
}

/* ── month stepper used by calendar + timeline ────────────────────────── */
function useMonth(offset: number) {
  return useMemo(() => {
    const base = new Date(todayIso() + 'T00:00:00');
    const view = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    const year = view.getFullYear();
    const month = view.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
    const iso = (d: number) =>
      `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const label = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(view);
    return { year, month, days, firstDow, iso, label };
  }, [offset]);
}

function MonthNav({
  label,
  onStep,
}: {
  label: string;
  onStep: (d: -1 | 0 | 1) => void;
}) {
  return (
    <div className="wk-bar" style={{ marginBottom: 12 }}>
      <div className="wk-move" style={{ margin: 0, padding: 0, border: 0 }}>
        <button type="button" aria-label="Previous month" onClick={() => onStep(-1)}>
          <ChevronLeft size={18} strokeWidth={1.9} />
        </button>
        <button type="button" aria-label="Next month" onClick={() => onStep(1)}>
          <ChevronRight size={18} strokeWidth={1.9} />
        </button>
      </div>
      <strong style={{ fontSize: 14, fontWeight: 500 }}>{label}</strong>
      <button className="chip" type="button" onClick={() => onStep(0)}>
        Today
      </button>
    </div>
  );
}

/* ── the Board tab ────────────────────────────────────────────────────── */
export default function BoardTab({
  newOpen,
  setNewOpen,
}: {
  newOpen: boolean;
  setNewOpen: (v: boolean) => void;
}) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();

  const [view, setView] = useState<View>('kanban');
  const [colLimits, setColLimits] = useState<Record<string, number>>({});
  const [listLimit, setListLimit] = useState(50);
  const [projects, setProjects] = useState<Set<string>>(new Set());
  const [types, setTypes] = useState<Set<TaskType>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [priorities, setPriorities] = useState<Set<TaskPriority>>(new Set());
  const [monthOffset, setMonthOffset] = useState(0);
  const [stuckOnly, setStuckOnly] = useState(false);
  /** The board is the busiest surface here and had chips but no text search,
   *  so finding a task by name meant reading columns. */
  const [text, setText] = useState('');
  const needle = text.trim().toLowerCase();
  /** 'all' | 'current' | 'none' | 'archive' | a sprint id. */
  const [sprintSel, setSprintSel] = useState('all');
  const [quick, setQuick] = useState<Task | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ status: TaskStatus; anchorId: string | null } | null>(null);

  const pins = useMemo(() => pinCounts(ds), [ds]);
  const parents = useMemo(() => parentOf(ds), [ds.task_links]);
  const sprints = useMemo(() => liveSprints(ds), [ds.sprints]);
  const archived = useMemo(() => ds.sprints.filter((s) => s.is_archived), [ds.sprints]);
  const current = useMemo(() => currentSprint(ds, todayIso()), [ds.sprints]);

  const inSprintScope = (t: Task) => {
    switch (sprintSel) {
      case 'all':
        return true;
      case 'none':
        return t.sprint_id === null;
      case 'archive':
        return archived.some((s) => s.id === t.sprint_id);
      case 'current':
        return current ? t.sprint_id === current.id : t.sprint_id === null;
      default:
        return t.sprint_id === sprintSel;
    }
  };
  /* Whose board is on screen. Defaults to mine; switching to the other person
     is a read of work I can already reach through assignment (principle 1:
     separation is focus, not secrecy). It is a view of this screen only —
     never a portal-wide mode, and never persisted. */
  const other = useData((_, s) => s.other);
  const [scope, setScope] = useState<'mine' | 'theirs'>('mine');
  const scopeId = scope === 'mine' ? store.meId : other.id;
  const viewingTheirs = scope === 'theirs';

  /* This board is one person's workspace (principle 1). Everything below reads
     from `mineAll` rather than ds.tasks, so the two people's work can never
     blend into a single column, count, or tag list. */
  const mineAll = useMemo(() => myTasks(ds.tasks, scopeId), [ds.tasks, scopeId]);
  const inbox = useMemo(() => inboxTasks(ds.tasks, store.meId), [ds.tasks, store.meId]);
  const awaiting = useMemo(() => awaitingThem(ds.tasks, store.meId), [ds.tasks, store.meId]);
  const handedOut = useMemo(() => assignedOut(ds.tasks, store.meId), [ds.tasks, store.meId]);

  const liveTags = useMemo(
    () => [...new Set([...ds.tags.map((tag) => tag.name), ...mineAll.flatMap((t) => t.tags)])].sort(),
    [ds.tags, mineAll],
  );

  /* Task type is free text (0035_free_project_and_type.sql) — the filter row
     can only offer what is actually in use, same as liveTags. Unlike tags,
     type is shared vocabulary rather than per-owner, so this reads ds.tasks
     rather than mineAll. */
  const liveTypes = useMemo(
    () => [...new Set(ds.tasks.flatMap((t) => taskTypes(t)))].sort(),
    [ds.tasks],
  );

  const stuck = useMemo(
    () => stuckTasks(ds).filter((s) => isMyTask(s.task, scopeId)),
    [ds, scopeId],
  );
  /* A card that cannot start yet says so, instead of looking available. */
  const waiting = useMemo(
    () => blockedByOpenDep(ds.tasks, ds.task_links),
    [ds.tasks, ds.task_links],
  );
  const stuckReasons = useMemo(
    () => new Map(stuck.map((s) => [s.task.id, s.reason])),
    [stuck],
  );
  /* Built once per render rather than per card: a column of cards asking the
     same question of the same decision rows is the shape `blockedTaskIds`
     exists for. The question text rides along so the chip's tooltip can say
     what is actually being waited on. */
  const blockedBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const decision of ds.decisions) {
      if (decision.status !== 'open') continue;
      for (const id of decision.task_ids ?? []) if (!map.has(id)) map.set(id, decision.question);
    }
    return map;
  }, [ds.decisions]);

  const list = useMemo(
    () =>
      mineAll.filter((t) => {
        if (projects.size && !inAnyProject(t, projects)) return false;
        if (priorities.size && !priorities.has(t.priority)) return false;
        if (types.size && !taskTypes(t).some((x) => types.has(x))) return false;
        if (tags.size && !t.tags.some((x) => tags.has(x))) return false;
        if (stuckOnly && !stuckReasons.has(t.id)) return false;
        if (!inSprintScope(t)) return false;
        if (needle && !`${t.id} ${t.title} ${t.description}`.toLowerCase().includes(needle)) return false;
        return true;
      }),
    [
      mineAll,
      projects,
      priorities,
      types,
      tags,
      stuckOnly,
      stuckReasons,
      scopeId,
      sprintSel,
      current,
      archived,
      needle,
    ],
  );

  /* status distribution + workload — the imbalance strip above the board */
  const statusCounts = useMemo(
    () => STATUSES.map((s) => ({ label: s.label, value: list.filter((t) => t.status === s.key).length, color: s.dot })),
    [list],
  );
  const workload = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of list) {
      if (t.status === 'done') continue;
      /* A task on both of them counts against both. It is one row, but it is
         two people's time -- a workload chart that halved it, or credited only
         the primary, would understate exactly the tasks worth noticing. */
      const owners = taskAssignees(t);
      for (const key of owners.length ? owners : ['__unassigned']) {
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return [...map.entries()]
      .map(([id, count]) => ({ label: personName(ds, id === '__unassigned' ? null : id), value: count }))
      .sort((a, b) => b.value - a.value);
  }, [list, ds]);

  /**
   * A repeating task that just became done mints its successor — a new row,
   * announced by date. Nothing about the finished task moves (principle 3).
   * Called from every place this board can complete something.
   */
  const carryRepeat = (t: Task) => {
    const next = spawnNextOccurrence(store, t);
    if (next) toast(`Next one created — ${next.id}, due ${fmtDay(next.due_date!)}`);
  };

  /**
   * Land `taskId` in `dest`, immediately before `anchorId` (null = append).
   * Both the status and a contiguous board_order for every affected column are
   * written, so the position survives a reload rather than living in state.
   */
  const commit = (taskId: string, dest: TaskStatus, anchorId: string | null) => {
    const t = ds.tasks.find((x) => x.id === taskId);
    if (!t || taskId === anchorId) return;
    const src = t.status;

    // Order against the whole column, not just what filters left visible —
    // otherwise a hidden card silently keeps a colliding board_order.
    const destCol = ds.tasks.filter((x) => x.status === dest && x.id !== taskId).sort(byOrder);
    const at = anchorId ? destCol.findIndex((x) => x.id === anchorId) : -1;
    const cut = at >= 0 ? at : destCol.length;
    const next = [...destCol.slice(0, cut), t, ...destCol.slice(cut)];

    const writes = new Map<string, number>();
    next.forEach((x, i) => {
      if (x.board_order !== i) writes.set(x.id, i);
    });
    if (src !== dest) {
      ds.tasks
        .filter((x) => x.status === src && x.id !== taskId)
        .sort(byOrder)
        .forEach((x, i) => {
          if (x.board_order !== i) writes.set(x.id, i);
        });
    }

    // Neighbours only shuffled position — silent, or one drag writes 40 audit
    // rows and buries the change that actually mattered.
    for (const [id, board_order] of writes) {
      if (id !== taskId) store.update('tasks', id, { board_order }, store.asMe({ silent: true }));
    }

    const patch: Partial<Task> = { board_order: next.findIndex((x) => x.id === taskId) };
    if (src !== dest) {
      patch.status = dest;
      if (dest === 'done') patch.progress_pct = 100;
    }
    store.update('tasks', taskId, patch, store.asMe());
    if (src !== dest) {
      toast(`${taskId} → ${statusLabel(dest)}`);
      if (dest === 'done') carryRepeat(t);
    }
  };

  /** Keyboard/touch equivalent of a drag: step one column, land at the end. */
  const move = (t: Task, dir: -1 | 1) => {
    const i = STATUSES.findIndex((s) => s.key === t.status) + dir;
    if (i < 0 || i >= STATUSES.length) return;
    commit(t.id, STATUSES[i].key, null);
  };

  const endDrag = () => {
    setDragId(null);
    setOver(null);
  };

  /** Which card should the dragged one land in front of, given the pointer? */
  const anchorFor = (e: React.DragEvent, id: string, nextId: string | null) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? id : nextId;
  };

  const toggleDone = (t: Task) => {
    const status: TaskStatus = t.status === 'done' ? 'todo' : 'done';
    store.update(
      'tasks',
      t.id,
      { status, progress_pct: status === 'done' ? 100 : t.progress_pct },
      store.asMe(),
    );
    toast(`${t.id} → ${statusLabel(status)}`);
    if (status === 'done') carryRepeat(t);
  };

  const anyFilter =
    projects.size > 0 || types.size > 0 || tags.size > 0 || stuckOnly || priorities.size > 0 || needle.length > 0;

  return (
    <div>
      <Inbox tasks={inbox} />
      <AwaitingThem tasks={awaiting} />
      <HandedOut tasks={handedOut} />
      <ReflowBanner />

      {/* whose board — a lens on this screen, never a portal-wide mode */}
      <div className="wk-bar">
        <span className="eyebrow">Board</span>
        <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
          <Segment
            value={scope}
            onChange={setScope}
            options={[
              { key: 'mine' as const, label: 'Mine' },
              { key: 'theirs' as const, label: other.name },
            ]}
            label="Whose board"
          />
        </div>
        {viewingTheirs && (
          <span className="tip" style={{ margin: 0 }}>
            {other.name}'s board — read-only here. Open a task to comment or reassign.
          </span>
        )}
      </div>

      {/* sprint scope — a filter on this board, never a mode for the portal */}
      <div className="wk-bar">
        <label className="wk-lbl" htmlFor="wk-find" style={{ marginBottom: 0 }}>
          Find
        </label>
        <input
          id="wk-find"
          className="wk-in"
          type="search"
          style={{ flex: '1 1 200px', minWidth: 140 }}
          value={text}
          placeholder="Title, id, or description…"
          onChange={(e) => setText(e.target.value)}
        />
        <label className="wk-lbl" htmlFor="wk-sprint" style={{ marginBottom: 0 }}>
          Sprint
        </label>
        <select
          id="wk-sprint"
          className="wk-in"
          style={{ flex: '0 1 260px' }}
          value={sprintSel}
          onChange={(e) => setSprintSel(e.target.value)}
        >
          <option value="all">All work</option>
          {/* Each sprint appears exactly once. A separate "current" shortcut
              listed the live sprint twice under two different values, which
              read as two destinations for one place. */}
          {sprints.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {current?.id === s.id ? ' · current' : ''}
            </option>
          ))}
          <option value="none">Backlog (no sprint)</option>
          {archived.length > 0 && <option value="archive">Archive</option>}
        </select>
        <span className="tip" style={{ margin: 0 }}>
          Move a task between sprints from its quick edit.
        </span>
      </div>

      {/* filter row — local to this screen, never a global mode */}
      <div className="filters">
        {ds.projects.map((p) => (
          <button
            key={p.id}
            className="chip"
            type="button"
            aria-pressed={projects.has(p.id)}
            onClick={() => setProjects((s) => toggle(s, p.id))}
            style={{ borderLeft: `3px solid ${p.color}` }}
          >
            {p.name}
          </button>
        ))}
        <span style={{ width: 8 }} />
        {stuck.length > 0 && (
          <button
            className="chip"
            type="button"
            aria-pressed={stuckOnly}
            onClick={() => setStuckOnly((s) => !s)}
          >
            Stuck ({stuck.length})
          </button>
        )}
        {/* No assignee chips: this board only ever holds my own work now, so
            filtering it by person would always be a no-op or an empty board. */}
        <span style={{ width: 8 }} />
        {PRIORITIES.map((p) => (
          <button
            key={p.key}
            className="chip"
            type="button"
            aria-pressed={priorities.has(p.key)}
            onClick={() => setPriorities((s) => toggle(s, p.key))}
            title={p.label}
          >
            {priBadge(p.key)}
          </button>
        ))}
        <span style={{ width: 8 }} />
        {liveTypes.map((t) => (
          <button
            key={t}
            className="chip"
            type="button"
            aria-pressed={types.has(t)}
            onClick={() => setTypes((s) => toggle(s, t))}
          >
            {typeLabel(t)}
          </button>
        ))}
        <span style={{ width: 8 }} />
        {liveTags.map((name) => (
          <button
            key={name}
            className="chip"
            type="button"
            aria-pressed={tags.has(name)}
            onClick={() => setTags((s) => toggle(s, name))}
            style={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11.5 }}
          >
            {name}
          </button>
        ))}
        {anyFilter && (
          <button
            className="chip"
            type="button"
            onClick={() => {
              setProjects(new Set());
              setTypes(new Set());
              setTags(new Set());
              setStuckOnly(false);
              setPriorities(new Set());
              setText('');
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* status distribution + workload — imbalance visible at a glance */}
      <div className="wk-overview">
        <div className="wk-ovpanel">
          <span className="eyebrow">Status distribution</span>
          <MiniBars items={statusCounts} />
        </div>
        <div className="wk-ovpanel">
          <span className="eyebrow">Workload per person</span>
          {workload.length > 0 ? (
            <MiniBars items={workload} />
          ) : (
            <p className="tip" style={{ margin: '10px 0 0' }}>
              Nothing open.
            </p>
          )}
        </div>
      </div>

      <div className="wk-bar">
        <span className="eyebrow">
          {list.length} task{list.length === 1 ? '' : 's'} in view
        </span>
        <div className="spacer" />
        <div style={{ flex: '1 1 260px', maxWidth: 420 }}>
          <Segment value={view} onChange={setView} options={VIEWS} label="Board view" />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0, transition: entrance }}
          exit={{ opacity: 0, transition: micro }}
        >
          {view === 'kanban' && (
            <div className="wk-cols">
              {STATUSES.map((s) => {
                const col = arrange(list.filter((t) => t.status === s.key), parents);
                // Render a window, not the whole column: a 500-task board that
                // mounts every card blows the 300ms p95 render budget.
                const shown = colLimits[s.key] ?? COLUMN_PAGE;
                const visible = col.slice(0, shown);
                return (
                  <motion.div
                    layout
                    className={`wk-col${over?.status === s.key ? ' over' : ''}`}
                    key={s.key}
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      setOver({ status: s.key, anchorId: null });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = dragId ?? e.dataTransfer.getData('text/plain');
                      if (id) commit(id, s.key, over?.status === s.key ? over.anchorId : null);
                      endDrag();
                    }}
                  >
                    <h3>
                      <span>
                        <i className="wk-dot" style={{ background: s.dot }} />
                        {s.label}
                      </span>
                      <span>{col.length}</span>
                    </h3>
                    <AnimatePresence initial={false}>
                      {visible.map(({ t, childOf }, i) => (
                        <div
                          key={t.id}
                          className={
                            over?.status === s.key && over.anchorId === t.id ? 'wk-slot before' : 'wk-slot'
                          }
                          /* Native DnD lives on this plain wrapper: framer-motion
                             claims onDragStart/onDragEnd for its own gestures and
                             would never forward them to the DOM. */
                          /* Their board is a read, not a remote control: moving
                             someone else's card would change their day with no
                             notice to them. Opening the task still works, and
                             reassignment there is explicit and audited. */
                          draggable={!viewingTheirs}
                          onDragStart={(e) => {
                            if (viewingTheirs) return;
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', t.id);
                            setDragId(t.id);
                          }}
                          onDragEnd={endDrag}
                          onDragOver={(e) => {
                            if (!dragId) return;
                            e.preventDefault();
                            e.stopPropagation();
                            setOver({
                              status: s.key,
                              anchorId: anchorFor(e, t.id, visible[i + 1]?.t.id ?? null),
                            });
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const id = dragId ?? e.dataTransfer.getData('text/plain');
                            if (id) commit(id, s.key, anchorFor(e, t.id, visible[i + 1]?.t.id ?? null));
                            endDrag();
                          }}
                        >
                          <TaskCard
                            t={t}
                            ds={ds}
                            pins={pins[t.id] ?? 0}
                            onMove={move}
                            onEdit={setQuick}
                            stuckReason={stuckReasons.get(t.id)}
                            blockedBy={blockedBy.get(t.id)}
                            waitingOn={waiting.get(t.id)}
                            childOf={childOf}
                            dragging={dragId === t.id}
                            readOnly={viewingTheirs}
                          />
                        </div>
                      ))}
                    </AnimatePresence>
                    {col.length > visible.length && (
                      <button
                        className="btn sm"
                        type="button"
                        style={{ width: '100%' }}
                        onClick={() =>
                          setColLimits((m) => ({ ...m, [s.key]: shown + COLUMN_PAGE }))
                        }
                      >
                        Show {Math.min(COLUMN_PAGE, col.length - visible.length)} more ·{' '}
                        {col.length - visible.length} hidden
                      </button>
                    )}
                    {col.length === 0 && (
                      <p className="tip" style={{ margin: 0 }}>
                        Empty
                      </p>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}

          {view === 'list' && (
            <motion.div {...staggerParent()}>
              {list.slice(0, listLimit).map((t) => (
                <motion.div
                  key={t.id}
                  variants={staggerItem}
                  className={`wk-lrow${t.status === 'done' ? ' done' : ''}`}
                  {...lift}
                >
                  <button
                    className="wk-tickbtn"
                    type="button"
                    aria-pressed={t.status === 'done'}
                    aria-label={`Mark ${t.id} ${t.status === 'done' ? 'not done' : 'done'}`}
                    onClick={() => toggleDone(t)}
                  >
                    <span className={`wk-tick${t.status === 'done' ? ' on' : ''}`} />
                  </button>
                  <Link to={`/task/${t.id}`}>
                    <span className="wk-lt">{t.title}</span>
                    <span className="wk-lsub">
                      {t.id} · {statusLabel(t.status)} · {t.priority}
                      {t.due_date ? ` · due ${fmtDay(t.due_date)}` : ''} ·{' '}
                      {personName(ds, t.assignee_id)}
                      {pins[t.id] ? ` · ${pins[t.id]} pins` : ''}
                      {' · '}
                      {t.effort} · {t.estimate_minutes}m
                    </span>
                  </Link>
                  <span className="wk-meta" style={{ flex: 'none' }}>
                    {stuckReasons.has(t.id) && (
                      <span className="wk-stuck" title={stuckReasons.get(t.id)}>
                        stuck
                      </span>
                    )}
                    {t.tags.map((x) => (
                      <TagChip key={x} name={x} />
                    ))}
                  </span>
                </motion.div>
              ))}
              {list.length > listLimit && (
                <button
                  className="btn sm"
                  type="button"
                  style={{ width: '100%' }}
                  onClick={() => setListLimit((n) => n + 50)}
                >
                  Show 50 more · {list.length - listLimit} hidden
                </button>
              )}
              {list.length === 0 && <p className="wk-empty">Nothing matches these filters.</p>}
            </motion.div>
          )}

          {view === 'calendar' && (
            <CalendarView
              list={list}
              ds={ds}
              meId={store.meId}
              offset={monthOffset}
              onStep={(d) => setMonthOffset((o) => (d === 0 ? 0 : o + d))}
            />
          )}

          {view === 'timeline' && (
            <TimelineView
              list={list}
              offset={monthOffset}
              onStep={(d) => setMonthOffset((o) => (d === 0 ? 0 : o + d))}
            />
          )}
        </motion.div>
      </AnimatePresence>

      <p className="tip">
        Filters, not modes — narrowing to a project, sprint or tag here never changes what the rest
        of the portal shows. Drag a card between columns, or use ‹ › on any device without a mouse.
      </p>

      <NewTaskModal open={newOpen} onClose={() => setNewOpen(false)} />
      {quick && <QuickEdit task={quick} onClose={() => setQuick(null)} />}
    </div>
  );
}

/* ── calendar ─────────────────────────────────────────────────────────── */
function CalendarView({
  list,
  ds,
  meId,
  offset,
  onStep,
}: {
  list: Task[];
  ds: Dataset;
  meId: string;
  offset: number;
  onStep: (d: -1 | 0 | 1) => void;
}) {
  const m = useMonth(offset);
  const today = todayIso();
  const byDay = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const t of list) {
      if (!t.due_date) continue;
      (map[t.due_date] ??= []).push(t);
    }
    return map;
  }, [list]);

  /* Calendar events belong on a calendar. This view showed tasks only, so the
     month said you were free on days you were in meetings all afternoon. */
  const eventsByDay = useMemo(() => {
    const map: Record<string, DayEvent[]> = {};
    for (const e of ds.day_events) {
      if (e.user_id !== null && e.user_id !== meId) continue;
      (map[e.date] ??= []).push(e);
    }
    for (const day of Object.values(map)) day.sort((a, b) => a.start_min - b.start_min);
    return map;
  }, [ds.day_events, meId]);

  return (
    <div>
      <MonthNav label={m.label} onStep={onStep} />
      <div className="wk-cal">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <div className="wk-dow" key={i}>
            {d}
          </div>
        ))}
        {Array.from({ length: m.firstDow }).map((_, i) => (
          <div className="wk-cday empty" key={`e${i}`} />
        ))}
        {Array.from({ length: m.days }).map((_, i) => {
          const day = i + 1;
          const iso = m.iso(day);
          const on = byDay[iso] ?? [];
          return (
            <motion.div
              key={iso}
              className={`wk-cday${iso === today ? ' today' : ''}`}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1, transition: { ...entrance, delay: Math.min(0.3, i * 0.006) } }}
            >
              <div className="wk-d">{day}</div>
              {(eventsByDay[iso] ?? []).map((e) => (
                <span
                  key={e.id}
                  className="wk-cevent"
                  title={`${minToLabel(e.start_min)} · ${e.label}`}
                >
                  {minToLabel(e.start_min)} {e.label}
                  {e.account_email && <small className="wk-account-badge">{e.account_email}</small>}
                </span>
              ))}
              {on.map((t) => (
                <Link
                  key={t.id}
                  className="wk-cpill"
                  to={`/task/${t.id}`}
                  title={`${t.id} · ${t.title}`}
                  style={{ borderLeft: `3px solid ${projColor(ds, t.project_id)}` }}
                >
                  {t.title}
                </Link>
              ))}
            </motion.div>
          );
        })}
      </div>
      <p className="tip">
        Tasks sit on their due date; calendar blocks and synced Google events sit above them with a
        time. Tap a pill to open the task.
      </p>
    </div>
  );
}

/* ── timeline ─────────────────────────────────────────────────────────── */
function TimelineView({
  list,
  offset,
  onStep,
}: {
  list: Task[];
  offset: number;
  onStep: (d: -1 | 0 | 1) => void;
}) {
  const m = useMonth(offset);
  const start = m.iso(1);
  const end = m.iso(m.days);

  const bars = useMemo(
    () =>
      list
        .map((t) => {
          const s = t.start_date ?? t.due_date;
          const e = t.due_date ?? t.start_date;
          if (!s || !e) return null;
          if (e < start || s > end) return null;
          const sd = s < start ? 1 : Number(s.slice(8, 10));
          const ed = e > end ? m.days : Number(e.slice(8, 10));
          const left = ((sd - 1) / m.days) * 100;
          const width = Math.max(6, ((Math.max(ed, sd) - sd + 1) / m.days) * 100);
          return { t, left, width, s, e };
        })
        .filter((x): x is { t: Task; left: number; width: number; s: string; e: string } => x !== null)
        .sort((a, b) => a.left - b.left || a.t.id.localeCompare(b.t.id)),
    [list, start, end, m.days],
  );

  return (
    <div>
      <MonthNav label={m.label} onStep={onStep} />
      <div className="wk-scale">
        <span>1</span>
        <span>{Math.round(m.days / 2)}</span>
        <span>{m.days}</span>
      </div>
      <motion.div {...staggerParent()}>
        {bars.map((b) => (
          <motion.div key={b.t.id} className="wk-tlrow" variants={staggerItem}>
            <Link to={`/task/${b.t.id}`}>
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>{b.t.title}</span>
              <span className="mono" style={{ display: 'block', fontSize: 10, color: 'var(--mute)' }}>
                {b.t.id} · {fmtDay(b.s)} → {fmtDay(b.e)}
              </span>
            </Link>
            <div className="wk-tltrack">
              <motion.div
                className="wk-tlbar"
                style={{ marginLeft: `${b.left}%`, width: `${b.width}%` }}
                initial={{ scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 1, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } }}
              >
                {b.t.progress_pct}%
              </motion.div>
            </div>
          </motion.div>
        ))}
      </motion.div>
      {bars.length === 0 && <p className="wk-empty">No dated tasks land in {m.label}.</p>}
    </div>
  );
}

/* ── checklist, before the task exists ────────────────────────────────── */
/**
 * One drafted step. It carries its final `subtasks.id` from the moment it is
 * typed: the id is what keeps a row identical to React across a reorder, so
 * the list animates the move instead of unmounting and remounting rows that
 * happen to share an index.
 */
type DraftStep = { id: string; title: string };

/**
 * The steps typed into the new-task sheet.
 *
 * Deliberately not `Checklist.tsx`: that one writes `subtasks` rows straight
 * through the store on every keystroke-commit, which needs a `task_id` that a
 * task being drafted does not have yet. Same rows, same order, just deferred
 * until submit has a real id to hang them on.
 */
function DraftChecklist({
  steps,
  onChange,
}: {
  steps: DraftStep[];
  onChange: (next: DraftStep[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const title = draft.trim();
    if (!title) return;
    onChange([...steps, { id: newId('st'), title }]);
    setDraft('');
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= steps.length) return;
    const next = [...steps];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    onChange(next);
  };

  return (
    <div className="wk-steps">
      <motion.ul {...staggerParent()}>
        <AnimatePresence initial={false}>
          {steps.map((step, i) => (
            <motion.li
              key={step.id}
              variants={staggerItem}
              exit={{ opacity: 0, height: 0, transition: { duration: 0.16 } }}
              layout
            >
              <span className="wk-steps-n mono">{i + 1}</span>
              <input
                className="wk-in"
                value={step.title}
                aria-label={`Step ${i + 1}`}
                onChange={(e) =>
                  onChange(
                    steps.map((s) => (s.id === step.id ? { ...s, title: e.target.value } : s)),
                  )
                }
              />
              <div className="wk-steps-acts">
                <button
                  type="button"
                  className="wk-steps-btn"
                  aria-label={`Move step ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <ChevronUp size={15} strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  className="wk-steps-btn"
                  aria-label={`Move step ${i + 1} down`}
                  disabled={i === steps.length - 1}
                  onClick={() => move(i, i + 1)}
                >
                  <ChevronDown size={15} strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  className="wk-steps-btn danger"
                  aria-label={`Remove step ${i + 1}`}
                  onClick={() => onChange(steps.filter((s) => s.id !== step.id))}
                >
                  <Trash2 size={15} strokeWidth={1.8} />
                </button>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ul>
      <input
        className="wk-in"
        value={draft}
        placeholder="+ Add a step, press Enter"
        aria-label="Add a step"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
      {steps.length > 0 && (
        <p className="tip">
          {steps.length} step{steps.length === 1 ? '' : 's'} — they become the task's checklist,
          tickable from the task page.
        </p>
      )}
    </div>
  );
}

/* ── new task ─────────────────────────────────────────────────────────── */
function NewTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  /* No default type any more — 'ops' was a leftover from when type was a
     fixed 4-value list. An empty string forces an active choice, same as
     project. */
  const [types, setTypes] = useState<TaskType[]>([]);
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [assignees, setAssignees] = useState<string[]>([store.meId]);
  const [due, setDue] = useState(todayIso());
  const [tagText, setTagText] = useState('');
  const [decisionIds, setDecisionIds] = useState<string[]>([]);
  /* Screenshots captured while writing the task, attached the moment it
     exists. A task is most often created BECAUSE of something on screen, and
     having to create it, open it, then go back for the screenshot lost the
     one piece of evidence that made it worth writing down. Held in state
     until submit because the attachments need a task id to point at. */
  const [shots, setShots] = useState<DraftShot[]>([]);
  const [pins, setPins] = useState<DraftPin[]>([]);
  const [pinDraftOpen, setPinDraftOpen] = useState(false);
  const [shotBusy, setShotBusy] = useState(false);
  /* The checklist written before the task exists. Same `subtasks` rows the
     task page edits (principle 10) — they just cannot be inserted until the
     task id they point at is real, so they are held here and flushed on
     submit alongside the screenshots. */
  const [steps, setSteps] = useState<DraftStep[]>([]);
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const lastTimestamp = useRef(0);
  const descriptionRef = useRef(description);
  descriptionRef.current = description;
  const descriptionCaret = useRef(description.length);

  const nextTimestamp = useCallback(() => {
    const next = Math.max(Date.now(), lastTimestamp.current + 1);
    lastTimestamp.current = next;
    return new Date(next).toISOString();
  }, []);

  const addShot = useCallback(
    (img: DroppedImage, offset = descriptionCaret.current) => {
      const id = newId('shot');
      const inserted = insertInlineImages(descriptionRef.current, offset, [id]);
      descriptionRef.current = inserted.value;
      descriptionCaret.current = inserted.caret;
      setDescription(inserted.value);
      setShots((prev) => [
        ...prev,
        { ...img, id, created_at: nextTimestamp() },
      ]);
    },
    [nextTimestamp],
  );

  const insertDraftFiles = (files: File[], offset = descriptionCaret.current) => {
    setShotBusy(true);
    let nextOffset = offset;
    void processImages(files, (image) => {
      addShot(image, nextOffset);
      nextOffset = descriptionCaret.current;
    })
      .then(() => toast('Image inserted — click it to pin the exact change'))
      .catch((err: Error) => toast(err.message || 'That image could not be pasted'))
      .finally(() => setShotBusy(false));
  };

  useImagePaste(
    sheetRef,
    (files) => insertDraftFiles(files),
    open,
    toast,
  );
  const [effort, setEffort] = useState<Effort>('medium');
  const [estimate, setEstimate] = useState(45);

  /* Everything typed here survives closing the sheet and reloading the tab.
     Screenshots and pins are deliberately left out: they are megabytes of
     base64 apiece and would blow the localStorage quota on the second one. */
  const draft = useFormDraft(
    open ? 'work:new-task' : null,
    { title, description, projectIds, types, priority, assignees, due, tagText, effort, estimate, steps },
    (d) => {
      if (d.steps !== undefined) setSteps(d.steps);
      if (d.title !== undefined) setTitle(d.title);
      if (d.description !== undefined) setDescription(d.description);
      if (d.projectIds !== undefined) setProjectIds(d.projectIds);
      if (d.types !== undefined) setTypes(d.types);
      if (d.priority !== undefined) setPriority(d.priority);
      if (d.assignees !== undefined) setAssignees(d.assignees);
      if (d.due !== undefined) setDue(d.due);
      if (d.tagText !== undefined) setTagText(d.tagText);
      if (d.effort !== undefined) setEffort(d.effort);
      if (d.estimate !== undefined) setEstimate(d.estimate);
    },
  );

  const startBlank = () => {
    setTitle('');
    setDescription('');
    setTypes([]);
    setTagText('');
    setDecisionIds([]);
    setSteps([]);
    draft.clear();
  };

  const submit = async () => {
    const clean = title.trim();
    if (!clean) {
      toast('Give the task a clear title before creating it');
      return;
    }
    if (!projectIds.length) {
      toast('Pick a project, or create one, before creating the task');
      return;
    }
    if (!types.length) {
      toast('Pick a task type, or create one, before creating the task');
      return;
    }
    if (pinDraftOpen) {
      toast('Finish or cancel the open pin before creating the task');
      return;
    }
    const id = store.nextTaskId();
    const labels = Array.from(
      new Set(tagText.split(',').map((label) => label.trim()).filter(Boolean)),
    );
    /* Awaited, not optimistic. `screenshot_attachments`, `subtasks` and
       `annotation_pins` all carry a FOREIGN KEY onto tasks(id), so firing
       them off beside an unconfirmed parent lost whichever child raced the
       task row — the observed failure was
       "screenshot_attachments_task_id_fkey" on a task that itself saved fine.
       insertConfirmed exists for exactly this ordering. */
    setSaving(true);
    try {
      await store.insertConfirmed(
        'tasks',
        makeTask({
          id,
          title: clean,
          description,
          project_id: projectIds[0],
          project_ids: projectIds,
          type: types[0],
          types,
          priority,
          assignee_id: assignees[0] ?? null,
          assignee_ids: assignees,
          created_by: store.meId,
          start_date: todayIso(),
          due_date: due || null,
          effort,
          estimate_minutes: estimate,
          tags: labels,
          /* A brief written with `- [x]` lines already ticked is a task that
             is already part done. Starting it at 0 would make the board card
             disagree with its own description from the first render. */
          progress_pct:
            taskProgressPct(
              description,
              steps.filter((step) => step.title.trim()).map(() => ({ completed: false })),
            ) ?? 0,
        }),
        store.asMe({ summary: `Task ${id} created — ${clean}` }),
      );
    } catch {
      // insertConfirmed already surfaced the reason through the sync banner.
      setSaving(false);
      return;
    }
    setSaving(false);
    // Every step keeps the order it was left in, blanks dropped.
    steps
      .filter((step) => step.title.trim())
      .forEach((step, i) =>
        store.insert(
          'subtasks',
          {
            id: step.id,
            task_id: id,
            title: step.title.trim(),
            completed: false,
            position: i + 1,
          },
          store.asMe({ summary: `Step added to ${id}: ${step.title.trim()}` }),
        ),
      );
    // The evidence follows the task it belongs to, now that the id exists.
    shots.forEach((img) =>
      store.insert(
        'screenshot_attachments',
        {
          id: img.id,
          task_id: id,
          storage_path: `screenshots/${id}/${img.filename}`,
          filename: img.filename,
          mime: 'image/jpeg',
          width: img.width,
          height: img.height,
          uploaded_by: store.meId,
          created_at: img.created_at,
          data_url: img.data_url,
        },
        store.asMe({ summary: `Screenshot ${img.filename} attached to ${id}` }),
      ),
    );
    labels.forEach((name) => {
      if (ds.tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) return;
      store.insert(
        'tags',
        {
          id: newId('tag'),
          name,
          color: WORK_TAG_COLORS[ds.tags.length % WORK_TAG_COLORS.length],
          created_by: store.meId,
          created_at: nowIso(),
        },
        store.asMe({ summary: `Tag created: ${name}` }),
      );
    });
    decisionIds.forEach((decisionId) => {
      const decision = ds.decisions.find((item) => item.id === decisionId);
      if (!decision) return;
      store.update(
        'decisions',
        decision.id,
        { task_ids: [...new Set([...(decision.task_ids ?? []), id])] },
        store.asMe({ summary: `Linked ${id} to decision` }),
      );
    });
    // Pins keep the exact chronological order they were written in the
    // creator. Because the task page/export also order globally by this time,
    // returning to screenshot 1 after screenshot 2 correctly creates pin 7.
    pins.forEach((pin) =>
      store.insert(
        'annotation_pins',
        {
          ...pin,
          author_id: store.meId,
          is_resolved: false,
        },
        store.asMe({ summary: `Pin ${pin.note} added to ${id}` }),
      ),
    );
    /* One notice per person put on it, not one for the task. Assigning to
       yourself stays silent, which notifyAssignment already handles. */
    for (const person of assignees) {
      notifyAssignment(store, { id, title: clean, due_date: due || null }, person);
    }
    toast(
      shots.length
        ? `${id} created with ${shots.length} screenshot${shots.length === 1 ? '' : 's'} and ${pins.length} pin${pins.length === 1 ? '' : 's'}`
        : `${id} created`,
    );
    draft.clear();
    setTitle('');
    setDescription('');
    setTagText('');
    setDecisionIds([]);
    setSteps([]);
    setShots([]);
    setPins([]);
    setPinDraftOpen(false);
    onClose();
    navigate(`/task/${id}`);
  };

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title="New task"
      subtitle="Write the brief, paste the evidence, and pin every requested change before handoff."
      wide
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn solid"
            type="button"
            onClick={() => void submit()}
            disabled={shotBusy || saving}
          >
            {saving
              ? 'Creating…'
              : `Create task${pins.length ? ` · ${pins.length} pin${pins.length === 1 ? '' : 's'}` : ''}`}
          </button>
        </>
      }
    >
      <div ref={sheetRef}>
      {draft.restored && <DraftRestored onDiscard={startBlank} />}
      <Field label="Title">
        <input
          className="wk-in"
          value={title}
          autoFocus
          placeholder="What needs to happen"
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <div style={{ height: 11 }} />
      <Field label="Description">
        <DraftEvidenceEditor
          description={description}
          onDescriptionChange={(value) => {
            descriptionRef.current = value;
            setDescription(value);
          }}
          onPasteFiles={insertDraftFiles}
          onCaretChange={(offset) => { descriptionCaret.current = offset; }}
          onUnusableImage={toast}
          shots={shots}
          pins={pins}
          nextTimestamp={nextTimestamp}
          onPinsChange={setPins}
          onDraftStateChange={setPinDraftOpen}
          onRemoveShot={(shotId) => {
            setShots((prev) => prev.filter((shot) => shot.id !== shotId));
            setPins((prev) => prev.filter((pin) => pin.screenshot_id !== shotId));
            const next = removeInlineImage(descriptionRef.current, shotId);
            descriptionRef.current = next;
            setDescription(next);
          }}
        />
        <ImageDrop
          onImage={(image) => addShot(image)}
          onError={(m) => toast(m)}
          busy={shotBusy}
          setBusy={setShotBusy}
          compact
          label={shots.length ? 'Insert another image here' : 'Insert an image here'}
          hint="Paste with Ctrl+V, drop a file, or click to browse — then click the image to add numbered change requests"
        />
        {/* Read-only here: the boxes are a preview of what the brief will
            carry, and there is no task row to tick against until submit. */}
        <BriefChecklist text={description} label="Steps in this brief" />
      </Field>
      <div style={{ height: 11 }} />
      <div className="wk-ctl">
        <Field label="Projects · the first is the primary">
          <FacetChips
            label="projects"
            values={projectIds}
            onChange={setProjectIds}
            color={(id) => ds.projects.find((p) => p.id === id)?.color}
            render={(id) => ds.projects.find((p) => p.id === id)?.name ?? id}
          />
          {/* Opens empty every time: this combo ADDS, and a value sitting in
              it would read as "the project", the singular this stopped being. */}
          <ProjectCombo
            className="wk-in"
            value=""
            placeholder="Add a project, or type a new one"
            onChange={(id) => id && setProjectIds((prev) => (prev.includes(id) ? prev : [...prev, id]))}
          />
        </Field>
        <Field label="Assignees">
          <FacetToggles
            label="assignees"
            options={store.members}
            values={assignees}
            onChange={setAssignees}
          />
        </Field>
        <Field label="Types · the first decides the task page's panels">
          <FacetChips label="types" values={types} onChange={setTypes} render={(value) => typeLabel(value)} />
          <TypeCombo
            className="wk-in"
            value=""
            placeholder="Add a type, or type a new one"
            onChange={(t) => t && setTypes((prev) => (prev.includes(t) ? prev : [...prev, t]))}
          />
        </Field>
        <Field label="Priority">
          <Segment value={priority} onChange={setPriority} options={PRIORITIES} label="Priority" />
        </Field>
        <Field label="Due date">
          <input className="wk-in" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Effort">
          <div className="wk-seg">
            {(['light', 'medium', 'heavy'] as Effort[]).map((e) => (
              <button
                key={e}
                type="button"
                aria-pressed={effort === e}
                onClick={() => setEffort(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Estimate (min)">
          <input
            className="wk-in"
            type="number"
            min={5}
            step={5}
            value={estimate}
            onChange={(e) => setEstimate(Math.max(5, Number(e.target.value) || 45))}
          />
        </Field>
      </div>

      <div style={{ height: 14 }} />
      <Field label="Checklist · optional">
        <DraftChecklist steps={steps} onChange={setSteps} />
      </Field>
      <div style={{ height: 14 }} />
      <Field label="Labels · create anything">
        <input
          className="wk-in"
          value={tagText}
          placeholder="study, export, needs-raghuvar · comma separated"
          onChange={(event) => setTagText(event.target.value)}
        />
      </Field>
      <div style={{ height: 14 }} />
      <Field label="Linked decisions · optional">
        <div className="wk-decision-tasks">
          {ds.decisions.map((decision) => (
            <label key={decision.id}>
              <input
                type="checkbox"
                checked={decisionIds.includes(decision.id)}
                onChange={() =>
                  setDecisionIds((ids) =>
                    ids.includes(decision.id)
                      ? ids.filter((id) => id !== decision.id)
                      : [...ids, decision.id],
                  )
                }
              />
              <span><b>{decision.question}</b><small style={{ display: 'block', color: 'var(--mute)' }}>{decision.status}</small></span>
            </label>
          ))}
          {ds.decisions.length === 0 && <span className="tip">No decisions yet.</span>}
        </div>
      </Field>

      </div>
    </SideSheet>
  );
}
