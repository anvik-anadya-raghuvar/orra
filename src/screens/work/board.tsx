import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Dataset, Effort, Task, TaskPriority, TaskStatus, TaskType } from '../../types';
import { nowIso, useData, useStore } from '../../data/store';
import { Avatar, Modal, TagChip, useToast } from '../../ui/bits';
import { entrance, lift, micro, spring, staggerItem, staggerList } from '../../ui/motion';
import { fmtDay, todayIso } from '../../lib/dates';
import { makeTask } from '../../lib/taskFactory';
import {
  Field,
  PRIORITIES,
  STATUSES,
  Segment,
  TYPES,
  personName,
  pinCounts,
  priClass,
  projColor,
  projName,
  statusLabel,
  typeLabel,
} from './common';

type View = 'kanban' | 'list' | 'calendar' | 'timeline';

/** Cards mounted per column before "show more" — keeps board render under budget. */
const COLUMN_PAGE = 25;

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

/* ── the card body, shared by kanban ──────────────────────────────────── */
function TaskCard({
  t,
  ds,
  pins,
  onMove,
}: {
  t: Task;
  ds: Dataset;
  pins: number;
  onMove: (t: Task, dir: -1 | 1) => void;
}) {
  const idx = STATUSES.findIndex((s) => s.key === t.status);
  return (
    <motion.div
      className="wk-card"
      layout
      layoutId={`wk-card-${t.id}`}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1, transition: entrance }}
      exit={{ opacity: 0, scale: 0.96, transition: micro }}
      whileHover={{ y: -4, boxShadow: 'var(--sh2)', transition: micro }}
      whileTap={{ scale: 0.99 }}
    >
      <Link className="wk-cardlink" to={`/task/${t.id}`}>
        <span className="wk-id">
          {t.id} · {typeLabel(t.type)}
        </span>
        <p className="wk-t">{t.title}</p>
        <span className="wk-meta">
          <span className="tagc" style={{ background: 'var(--surf3)', color: projColor(ds, t.project_id) }}>
            {projName(ds, t.project_id)}
          </span>
          <Avatar userId={t.assignee_id} size={22} />
          {t.due_date && <span>{fmtDay(t.due_date)}</span>}
          <span className={priClass(t.priority)}>{t.priority}</span>
          {pins > 0 && <span className="wk-pc">{pins} pins</span>}
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
          disabled={idx <= 0}
          aria-label={`Move ${t.id} to ${STATUSES[Math.max(0, idx - 1)].label}`}
          onClick={() => onMove(t, -1)}
        >
          <ChevronLeft size={18} strokeWidth={1.9} />
        </button>
        <span className="wk-movelbl">{statusLabel(t.status)}</span>
        <button
          type="button"
          disabled={idx >= STATUSES.length - 1}
          aria-label={`Move ${t.id} to ${STATUSES[Math.min(STATUSES.length - 1, idx + 1)].label}`}
          onClick={() => onMove(t, 1)}
        >
          <ChevronRight size={18} strokeWidth={1.9} />
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
  const [mine, setMine] = useState(false);
  const [types, setTypes] = useState<Set<TaskType>>(new Set());
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [monthOffset, setMonthOffset] = useState(0);

  const pins = useMemo(() => pinCounts(ds), [ds]);
  const liveTags = useMemo(
    () => [...new Set(ds.tasks.flatMap((t) => t.tags))].sort(),
    [ds.tasks],
  );

  const list = useMemo(
    () =>
      ds.tasks.filter((t) => {
        if (projects.size && !projects.has(t.project_id)) return false;
        if (mine && t.assignee_id !== store.meId) return false;
        if (types.size && !types.has(t.type)) return false;
        if (tags.size && !t.tags.some((x) => tags.has(x))) return false;
        return true;
      }),
    [ds.tasks, projects, mine, types, tags, store.meId],
  );

  const move = (t: Task, dir: -1 | 1) => {
    const i = STATUSES.findIndex((s) => s.key === t.status) + dir;
    if (i < 0 || i >= STATUSES.length) return;
    const status = STATUSES[i].key;
    store.update(
      'tasks',
      t.id,
      { status, ...(status === 'done' ? { progress_pct: 100 } : {}) },
      store.asMe(),
    );
    toast(`${t.id} → ${STATUSES[i].label}`);
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
  };

  const anyFilter = projects.size > 0 || mine || types.size > 0 || tags.size > 0;

  return (
    <div>
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
        <button className="chip" type="button" aria-pressed={mine} onClick={() => setMine((m) => !m)}>
          Assigned to me
        </button>
        <span style={{ width: 8 }} />
        {TYPES.map((t) => (
          <button
            key={t.key}
            className="chip"
            type="button"
            aria-pressed={types.has(t.key)}
            onClick={() => setTypes((s) => toggle(s, t.key))}
          >
            {t.label}
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
              setMine(false);
              setTypes(new Set());
              setTags(new Set());
            }}
          >
            Clear filters
          </button>
        )}
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
                const col = list.filter((t) => t.status === s.key);
                // Render a window, not the whole column: a 500-task board that
                // mounts every card blows the 300ms p95 render budget.
                const shown = colLimits[s.key] ?? COLUMN_PAGE;
                const visible = col.slice(0, shown);
                return (
                  <motion.div layout className="wk-col" key={s.key}>
                    <h3>
                      <span>
                        <i className="wk-dot" style={{ background: s.dot }} />
                        {s.label}
                      </span>
                      <span>{col.length}</span>
                    </h3>
                    <AnimatePresence initial={false}>
                      {visible.map((t) => (
                        <TaskCard key={t.id} t={t} ds={ds} pins={pins[t.id] ?? 0} onMove={move} />
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
            <motion.div variants={staggerList} initial="initial" animate="animate">
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
                    </span>
                  </Link>
                  <span className="wk-meta" style={{ flex: 'none' }}>
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
        Filters, not modes — narrowing to a project or a tag here never changes what the rest of the
        portal shows.
      </p>

      <NewTaskModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

/* ── calendar ─────────────────────────────────────────────────────────── */
function CalendarView({
  list,
  ds,
  offset,
  onStep,
}: {
  list: Task[];
  ds: Dataset;
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
      <p className="tip">Tasks sit on their due date. Tap a pill to open the task.</p>
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
      <motion.div variants={staggerList} initial="initial" animate="animate">
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

/* ── new task ─────────────────────────────────────────────────────────── */
function NewTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState(ds.projects[0]?.id ?? '');
  const [type, setType] = useState<TaskType>('ops');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [assignee, setAssignee] = useState(store.meId);
  const [due, setDue] = useState(todayIso());
  const [effort, setEffort] = useState<Effort>('medium');
  const [estimate, setEstimate] = useState(45);

  const submit = () => {
    const id = store.nextTaskId();
    const clean = title.trim() || 'Untitled task';
    store.insert(
      'tasks',
      makeTask({
        id,
        title: clean,
        description,
        project_id: projectId,
        type,
        priority,
        assignee_id: assignee,
        created_by: store.meId,
        start_date: todayIso(),
        due_date: due || null,
        effort,
        estimate_minutes: estimate,
      }),
      store.asMe({ summary: `Task ${id} created — ${clean}` }),
    );
    toast(`${id} created`);
    setTitle('');
    setDescription('');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="New task">
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
        <textarea
          className="wk-in"
          value={description}
          placeholder="Context, and why it matters"
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div style={{ height: 11 }} />
      <div className="wk-ctl">
        <Field label="Project">
          <select className="wk-in" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {ds.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assignee">
          <select className="wk-in" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            {ds.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Type">
          <Segment value={type} onChange={setType} options={TYPES} label="Task type" />
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
      <div className="wk-acts">
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn solid" type="button" onClick={submit}>
          Create task
        </button>
      </div>
    </Modal>
  );
}
