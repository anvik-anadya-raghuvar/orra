import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, ChevronUp } from 'lucide-react';
import type { AppStore } from '../../data/store';
import type { FixedDate, LifeAdminItem, TimeLog } from '../../types';
import { newId, nowIso, today, useData, useStore } from '../../data/store';
import { personalProjectIds } from '../../data/projects';
import { CountUp, DeleteBtn, TagChip, useToast } from '../../ui/bits';
import { staggerItem, staggerParent } from '../../ui/motion';
import { daysUntil, fmtDay } from '../../lib/dates';
import { BarRows, HeatStrip, Ring, Sparkline, SplitBar as VizSplit, VIZ } from '../../ui/viz';
import { activeBlockFor, startBlock } from '../../lib/blocks';
import { ownRows } from '../../lib/workspace';

const LABEL_COLORS = ['indigo', 'violet', 'teal', 'amber', 'rose', 'slate'] as const;

/** Labels are flexible shared vocabulary; workflow states remain meaningful
 * controls. A newly typed label is created globally and attached here. */
export function LabelEditor({
  values,
  onChange,
  label,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  label: string;
}) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const add = () => {
    const next = draft.trim();
    if (!next) return;
    const attached = values.some((value) => value.toLowerCase() === next.toLowerCase());
    if (!attached) onChange([...values, next]);
    if (!ds.tags.some((tag) => tag.name.toLowerCase() === next.toLowerCase())) {
      store.insert(
        'tags',
        {
          id: newId('tag'),
          name: next,
          color: LABEL_COLORS[ds.tags.length % LABEL_COLORS.length],
          created_by: store.meId,
          created_at: nowIso(),
        },
        store.asMe({ summary: `Label created — ${next}` }),
      );
      toast(`Label “${next}” is now available everywhere.`);
    }
    setDraft('');
    setEditing(false);
  };

  return (
    <div className="plabels" aria-label={label}>
      {values.map((value) => (
        <TagChip key={value} name={value} onRemove={() => onChange(values.filter((item) => item !== value))} />
      ))}
      {editing ? (
        <span className="plabel-add-form">
          <input
            className="pin sm"
            value={draft}
            autoFocus
            placeholder="New label"
            aria-label={`New label for ${label}`}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
              if (event.key === 'Escape') setEditing(false);
            }}
          />
          <button type="button" className="btn sm" onClick={add} disabled={!draft.trim()}>
            Add
          </button>
        </span>
      ) : (
        <button type="button" className="plabel-add" onClick={() => setEditing(true)}>
          + label
        </button>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Editing primitives — direct manipulation, never a modal for a small
   change. Every one of them commits through store.* so the trail records it.
   ══════════════════════════════════════════════════════════════════════ */

/** Click-to-edit text. Enter or blur saves, Escape reverts. */
export function InlineText({
  value,
  onSave,
  label,
  placeholder = 'Untitled',
  className = '',
  allowEmpty = false,
}: {
  value: string;
  onSave: (next: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
  allowEmpty?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = draft.trim();
    if (!allowEmpty && !next) return;
    if (next !== value) onSave(next);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className={`inl ${className}`}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        aria-label={`Edit ${label}`}
      >
        {value || <span className="inl-ph">{placeholder}</span>}
      </button>
    );
  }
  return (
    <input
      ref={ref}
      className={`inl-in ${className}`}
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          cancelled.current = true;
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}

/** Always-live number field. Enter or blur saves, Escape reverts. */
export function NumberField({
  value,
  onSave,
  label,
  min = 1,
  max = 1440,
  suffix,
}: {
  value: number;
  onSave: (n: number) => void;
  label: string;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const cancelled = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(String(value));
      return;
    }
    const n = Math.max(min, Math.min(max, Math.round(Number(draft))));
    if (!Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    if (n !== value) onSave(n);
    setDraft(String(n));
  };

  return (
    <span className="numf">
      <input
        className="pin sm"
        type="number"
        inputMode="numeric"
        value={draft}
        aria-label={label}
        min={min}
        max={max}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            cancelled.current = true;
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {suffix && <em className="mono">{suffix}</em>}
    </span>
  );
}

/** Date field — commits the moment a valid date is picked. */
export function DateField({
  value,
  onSave,
  label,
}: {
  value: string;
  onSave: (d: string) => void;
  label: string;
}) {
  return (
    <input
      className="pin sm"
      type="date"
      value={value}
      aria-label={label}
      onChange={(e) => {
        if (e.target.value && e.target.value !== value) onSave(e.target.value);
      }}
    />
  );
}

/** Up/down reorder. No drag — works with a thumb and with a keyboard. */
export function MoveBtns({
  onUp,
  onDown,
  canUp,
  canDown,
  label,
}: {
  onUp: () => void;
  onDown: () => void;
  canUp: boolean;
  canDown: boolean;
  label: string;
}) {
  return (
    <span className="pmove">
      <button type="button" className="picon" disabled={!canUp} aria-label={`Move ${label} up`} onClick={onUp}>
        <ChevronUp size={14} strokeWidth={2} />
      </button>
      <button type="button" className="picon" disabled={!canDown} aria-label={`Move ${label} down`} onClick={onDown}>
        <ChevronDown size={14} strokeWidth={2} />
      </button>
    </span>
  );
}

/** Renumber a positioned list after moving one row. Only changed rows audit. */
export function moveRows(
  store: AppStore,
  key: 'courses' | 'course_items' | 'reading_queue',
  ordered: { id: string; position: number }[],
  from: number,
  to: number,
) {
  if (to < 0 || to >= ordered.length) return;
  const next = [...ordered];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  next.forEach((r, i) => {
    if (r.position !== i + 1) {
      store.update(key, r.id, { position: i + 1 }, store.asMe({ summary: 'Reordered' }));
    }
  });
}

/* ══════════════════════════════════════════════════════════════════════
   Shared date maths for the study visuals.
   ══════════════════════════════════════════════════════════════════════ */

export function lastDates(n: number): string[] {
  const out: string[] = [];
  const d = new Date(today() + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - (n - 1));
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const hrs = (mins: number) => `${(mins / 60).toFixed(1)}h`;

/* ══════════════════════════════════════════════════════════════════════
   Study rhythm — the screen's headline picture. Streak heat, weekly
   trend, and the study/founder referee, all from time_logs.
   ══════════════════════════════════════════════════════════════════════ */

export function StudyRhythm() {
  const ds = useData((d) => d);
  const store = useStore();

  const { heat, week, study7, founder7, streak, best } = useMemo(() => {
    const mine = ds.time_logs.filter((t) => t.user_id === store.meId);
    const byDay = new Map<string, number>();
    for (const t of mine) {
      if (t.kind !== 'study') continue;
      byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.minutes);
    }
    const days21 = lastDates(21);
    const days7 = lastDates(7);
    const cutoff = days7[0];

    let run = 0;
    for (let i = days21.length - 1; i >= 0; i--) {
      if ((byDay.get(days21[i]) ?? 0) > 0) run++;
      else break;
    }

    return {
      heat: days21.map((d) => ({ label: fmtDay(d), value: byDay.get(d) ?? 0 })),
      week: days7.map((d) => ({ label: fmtDay(d), value: byDay.get(d) ?? 0 })),
      study7: mine.filter((t) => t.kind === 'study' && t.date >= cutoff).reduce((s, t) => s + t.minutes, 0),
      founder7: mine.filter((t) => t.kind === 'founder' && t.date >= cutoff).reduce((s, t) => s + t.minutes, 0),
      streak: run,
      best: Math.max(...days21.map((d) => byDay.get(d) ?? 0), 0),
    };
  }, [ds.time_logs, store.meId]);

  return (
    <div className="pbig">
      <div className="phead">
        <h3>Study rhythm</h3>
        <span className="eyebrow">last 21 days</span>
      </div>

      <div className="pstats">
        <div className="pstat">
          <b>
            <CountUp value={streak} />
          </b>
          <span>day streak</span>
        </div>
        <div className="pstat">
          <b>
            <CountUp value={study7} format={hrs} />
          </b>
          <span>studied this week</span>
        </div>
        <div className="pstat">
          <b>
            <CountUp value={best} format={hrs} />
          </b>
          <span>best day</span>
        </div>
      </div>

      <HeatStrip cells={heat} format={(n) => (n ? hrs(n) : 'nothing')} />

      <div className="psub eyebrow">This week, minute by minute</div>
      <Sparkline values={week.map((w) => w.value)} labels={week.map((w) => w.label)} height={44} format={hrs} />

      <div className="psub eyebrow">Study vs founder · last 7 days</div>
      <VizSplit
        parts={[
          { label: `Study ${hrs(study7)}`, value: study7, color: VIZ.cat[0] },
          { label: `Founder ${hrs(founder7)}`, value: founder7, color: VIZ.cat[1] },
        ]}
        height={16}
      />
      <p className="tip">The degree gets real hours, not leftovers. This bar is the referee.</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Study timer — still one tap, but the entry it creates is editable in
   the ledger right below, so a forgotten timer is no longer a trap.
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Starts a block; the running block itself is the app-wide overlay.
 *
 * The old version was a stopwatch holding its seconds in component state, so
 * leaving this screen or reloading threw the session away without saying so.
 * Now the clock lives in the database and the whole portal goes quiet while it
 * runs — see src/ui/BlockOverlay.tsx.
 */
export function StudyTimer() {
  const ds = useData((d) => d);
  const store = useStore();
  const meId = useData((_, s) => s.meId);
  const toast = useToast();
  const courses = useMemo(() => ownRows(ds.courses, meId), [ds.courses, meId]);
  const [courseId, setCourseId] = useState(courses[0]?.id ?? '');
  const live = activeBlockFor(ds, meId);
  const recent = useMemo(
    () =>
      ds.time_logs
        .filter((t) => t.user_id === meId)
        .sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)))
        .slice(0, 5),
    [ds.time_logs, meId],
  );

  const begin = (scope: 'study' | 'personal') => {
    const opts = scope === 'study' ? { courseId: courseId || null } : {};
    if (!startBlock(store, scope, opts)) toast('A block is already running.');
  };

  return (
    <div className="pbig">
      <div className="phead">
        <h3>Focus blocks</h3>
        {live && <span className="pill soon">running</span>}
      </div>
      <p className="tip" style={{ marginTop: 0 }}>
        Pick the kind of work first. Starting it clears the portal and keeps the clock safe across reloads.
      </p>
      <div className="pblock-choices">
        <section className="pblock-choice study">
          <div>
            <span className="eyebrow">Study</span>
            <b>Learn one thing without context switching.</b>
          </div>
          <select
            className="pin"
            value={courseId}
            aria-label="Course for a study block"
            onChange={(e) => setCourseId(e.target.value)}
          >
            <option value="">All courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <button className="btn solid" type="button" onClick={() => begin('study')} disabled={!!live}>
            Start study
          </button>
        </section>
        <section className="pblock-choice personal">
          <div>
            <span className="eyebrow">Personal</span>
            <b>Clear one personal loop without filling the work board.</b>
          </div>
          <button className="btn" type="button" onClick={() => begin('personal')} disabled={!!live}>
            Start personal block
          </button>
        </section>
      </div>

      {/* The hours this thing produces, right where they are produced — the
          first question after "start a block" is "where did my time go", and
          the answer should not require knowing another widget exists. */}
      <div className="psub eyebrow">Latest blocks</div>
      {recent.map((t) => (
        <div className="prow" key={t.id}>
          <span className="grow">
            {t.kind} · {t.minutes} min
          </span>
          <span className="mono sub">{fmtDay(t.date)}</span>
        </div>
      ))}
      {recent.length === 0 && <p className="tip">Nothing logged yet — your first block will land here.</p>}
      <p className="tip">
        Forgot to stop one? Every minute is editable in the Time ledger widget — nothing here is
        write-once.
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Time ledger — manual entry, plus edit and delete for anything logged.
   ══════════════════════════════════════════════════════════════════════ */

/** 'personal' is loggable by hand too, and stays out of the study-vs-founder
 *  split bar — an errand is neither side of that referee. */
const KINDS: TimeLog['kind'][] = ['study', 'founder', 'personal'];

export function TimeLedger() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today());
  const [kind, setKind] = useState<TimeLog['kind']>('study');
  const [minutes, setMinutes] = useState('45');
  const [courseId, setCourseId] = useState(ds.courses[0]?.id ?? '');

  const rows = useMemo(
    () =>
      ds.time_logs
        .filter((t) => t.user_id === store.meId)
        .sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)))
        .slice(0, 8),
    [ds.time_logs, store.meId],
  );

  const patch = (t: TimeLog, p: Partial<TimeLog>, what: string) =>
    store.update('time_logs', t.id, p, store.asMe({ summary: `Time log ${what}` }));

  const add = () => {
    const m = Math.max(1, Math.min(1440, Math.round(Number(minutes) || 0)));
    if (!date || !m) return;
    store.insert(
      'time_logs',
      {
        id: newId('tl'),
        user_id: store.meId,
        date,
        kind,
        minutes: m,
        course_id: kind === 'study' ? courseId || null : null,
      },
      store.asMe({ summary: `Time logged by hand — ${m}m ${kind}` }),
    );
    toast('Entry added');
    setMinutes('45');
  };

  return (
    <div className="pbig">
      <div className="phead">
        <h3>Time ledger</h3>
        <button className="btn sm" type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Add by hand'}
        </button>
      </div>

      {open && (
        <div className="pform">
          <input
            className="pin sm"
            type="date"
            value={date}
            aria-label="Entry date"
            onChange={(e) => setDate(e.target.value)}
          />
          <select
            className="pin sm"
            value={kind}
            aria-label="Entry kind"
            onChange={(e) => setKind(e.target.value as TimeLog['kind'])}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            className="pin sm"
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            value={minutes}
            aria-label="Minutes"
            onChange={(e) => setMinutes(e.target.value)}
          />
          <select
            className="pin sm"
            value={courseId}
            disabled={kind !== 'study'}
            aria-label="Course"
            onChange={(e) => setCourseId(e.target.value)}
          >
            <option value="">No course</option>
            {ds.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <button className="btn sm solid" type="button" onClick={add}>
            Log it
          </button>
        </div>
      )}

      <motion.div {...staggerParent()} className="pledger">
        {rows.map((t) => (
          <motion.div className="plog" key={t.id} variants={staggerItem}>
            <i
              className="pdot"
              style={{
                background:
                  t.kind === 'study' ? VIZ.cat[0] : t.kind === 'founder' ? VIZ.cat[1] : VIZ.cat[2],
              }}
              aria-hidden
            />
            <input
              className="pin sm"
              type="date"
              value={t.date}
              aria-label={`Date of ${t.kind} entry`}
              onChange={(e) => e.target.value && patch(t, { date: e.target.value }, 'date changed')}
            />
            <select
              className="pin sm"
              value={t.kind}
              aria-label="Kind"
              onChange={(e) =>
                patch(
                  t,
                  { kind: e.target.value as TimeLog['kind'], course_id: e.target.value === 'study' ? t.course_id : null },
                  'kind changed',
                )
              }
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <NumberField
              value={t.minutes}
              label={`Minutes on ${t.date}`}
              suffix="min"
              onSave={(n) => patch(t, { minutes: n }, 'minutes changed')}
            />
            <select
              className="pin sm"
              value={t.course_id ?? ''}
              disabled={t.kind !== 'study'}
              aria-label="Course"
              onChange={(e) => patch(t, { course_id: e.target.value || null }, 'course changed')}
            >
              <option value="">No course</option>
              {ds.courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <DeleteBtn
              label={`${t.kind} entry on ${t.date}`}
              onConfirm={() => {
                store.remove('time_logs', t.id, store.asMe({ summary: `Time log removed — ${t.minutes}m ${t.kind}` }));
                toast('Entry removed');
              }}
            />
          </motion.div>
        ))}
        {rows.length === 0 && <p className="tip">No hours logged yet. Run a block, or add one by hand.</p>}
      </motion.div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Life admin — add, rename inline, toggle, delete.
   ══════════════════════════════════════════════════════════════════════ */

export function LifeAdmin() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [text, setText] = useState('');
  const mine = useMemo(() => ds.life_admin.filter((l) => l.user_id === store.meId), [ds.life_admin, store.meId]);
  const done = mine.filter((l) => l.completed).length;

  const add = () => {
    const item = text.trim();
    if (!item) return;
    store.insert(
      'life_admin',
      { id: newId('la'), user_id: store.meId, item, completed: false, created_at: nowIso() },
      store.asMe({ summary: `Life admin added — ${item}` }),
    );
    setText('');
  };

  const toggle = (l: LifeAdminItem) =>
    store.update(
      'life_admin',
      l.id,
      { completed: !l.completed },
      store.asMe({ summary: `${l.item} ${!l.completed ? 'completed' : 'reopened'}` }),
    );

  return (
    <div className="pbig">
      <div className="phead">
        <h3>Personal admin</h3>
        <span className="pmini">
          <Ring pct={mine.length ? (done / mine.length) * 100 : 0} size={30} color={VIZ.cat[2]} label={`${done} of ${mine.length} done`} />
          <span className="mono">
            {done}/{mine.length}
          </span>
        </span>
      </div>
      <motion.div {...staggerParent()}>
        {mine.map((l) => (
          <motion.div className="prow" key={l.id} variants={staggerItem}>
            <button
              className="bxbtn"
              type="button"
              aria-label={l.completed ? `Reopen ${l.item}` : `Complete ${l.item}`}
              aria-pressed={l.completed}
              onClick={() => toggle(l)}
            >
              <span className={`bx${l.completed ? ' on' : ''}`} aria-hidden />
            </button>
            <InlineText
              value={l.item}
              label="life admin item"
              className={`grow${l.completed ? ' off' : ''}`}
              onSave={(item) => store.update('life_admin', l.id, { item }, store.asMe({ summary: `Life admin renamed — ${item}` }))}
            />
            <DeleteBtn
              label={l.item}
              onConfirm={() => {
                store.remove('life_admin', l.id, store.asMe({ summary: `Life admin removed — ${l.item}` }));
                toast('Removed');
              }}
            />
          </motion.div>
        ))}
        {mine.length === 0 && <p className="tip">Personal admin is clear.</p>}
      </motion.div>
      <div className="paddrow">
        <input
          className="addin"
          placeholder="+ Add something to deal with"
          value={text}
          aria-label="New personal admin item"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button className="btn sm" type="button" onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Fixed dates — the nearest one gets a ring and the hierarchy; the rest
   are a proximity chart, not a wall of numbers. All of them editable.
   ══════════════════════════════════════════════════════════════════════ */

const CATEGORIES = ['relocation', 'university', 'business', 'personal'];
const HORIZON = 90;

function urgency(d: number): string {
  if (d < 0) return 'q';
  if (d < 3) return 'over';
  if (d < 14) return 'soon';
  return 'ok';
}

export function FixedDates() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');
  const [category, setCategory] = useState('relocation');

  const sorted = useMemo(() => [...ds.fixed_dates].sort((a, b) => a.date.localeCompare(b.date)), [ds.fixed_dates]);
  const upcoming = useMemo(() => sorted.filter((f) => daysUntil(f.date) >= 0), [sorted]);
  const hero: FixedDate | undefined = upcoming[0];
  const heroDays = hero ? daysUntil(hero.date) : 0;

  const bars = useMemo(
    () => upcoming.slice(0, 6).map((f) => ({ label: f.label, value: Math.max(daysUntil(f.date), 0.4) })),
    [upcoming],
  );
  const barMax = Math.max(HORIZON, ...bars.map((b) => b.value));

  const add = () => {
    if (!label.trim() || !date) return;
    store.insert(
      'fixed_dates',
      { id: newId('fd'), label: label.trim(), date, category },
      store.asMe({ summary: `Fixed date added — ${label.trim()}` }),
    );
    setLabel('');
    setDate('');
    toast('Date added');
  };

  const patch = (f: FixedDate, p: Partial<FixedDate>) =>
    store.update('fixed_dates', f.id, p, store.asMe({ summary: `Fixed date edited — ${f.label}` }));

  return (
    <div className="pbig">
      <div className="phead">
        <h3>Fixed dates</h3>
        <span className="eyebrow">{HORIZON}-day horizon</span>
      </div>

      {hero && (
        <div className="phero">
          <div className="pheroring">
            <Ring
              pct={Math.max(4, 100 - (Math.min(heroDays, HORIZON) / HORIZON) * 100)}
              size={78}
              color={VIZ.cat[0]}
              label={`${heroDays} days until ${hero.label}`}
            />
            <span className="pheronum">
              <b>
                <CountUp value={heroDays} />
              </b>
              <em className="mono">days</em>
            </span>
          </div>
          <div className="pherotxt">
            <span className="eyebrow">next up</span>
            <b>{hero.label}</b>
            <span className="mono">
              {fmtDay(hero.date)} · {hero.category}
            </span>
          </div>
        </div>
      )}

      {bars.length > 1 && (
        <div className="pbars">
          <BarRows rows={bars} max={barMax} color={VIZ.seq} format={(n) => `${Math.round(n)}d`} />
        </div>
      )}

      <div className="psub eyebrow">Every date, editable</div>
      <motion.div {...staggerParent()}>
        {sorted.map((f) => {
          const d = daysUntil(f.date);
          return (
            <motion.div className="pfixed" key={f.id} variants={staggerItem}>
              <InlineText value={f.label} label="date label" className="grow" onSave={(v) => patch(f, { label: v })} />
              <span className={`pill ${urgency(d)}`}>{d < 0 ? 'past' : `${d}d`}</span>
              <DateField value={f.date} label={`Date for ${f.label}`} onSave={(v) => patch(f, { date: v })} />
              <select
                className="pin sm"
                value={f.category}
                aria-label={`Category for ${f.label}`}
                onChange={(e) => patch(f, { category: e.target.value })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <DeleteBtn
                label={f.label}
                onConfirm={() => {
                  store.remove('fixed_dates', f.id, store.asMe({ summary: `Fixed date removed — ${f.label}` }));
                  toast('Removed');
                }}
              />
            </motion.div>
          );
        })}
        {sorted.length === 0 && <p className="tip">Nothing fixed yet.</p>}
      </motion.div>

      <div className="pform">
        <input
          className="addin"
          placeholder="What is fixed?"
          value={label}
          aria-label="New fixed date label"
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <input className="pin sm" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="New fixed date" />
        <select className="pin sm" value={category} aria-label="New fixed date category" onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button className="btn sm" type="button" onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Relocation documents — they live in the Notebook, so this is a read-only
   mirror that links through rather than dead-ending.
   ══════════════════════════════════════════════════════════════════════ */

const DOC_LABEL: Record<string, string> = { ok: 'fine', soon: 'coming up', over: 'act now' };

export function RelocationDocs() {
  const docs = useData((d) => {
    const personal = personalProjectIds(d.projects);
    return d.documents.filter((x) => personal.has(x.project_id));
  });

  return (
    <div className="pbig">
      <div className="phead">
        <h3>Relocation documents</h3>
        <Link className="btn sm" to="/knowledge">
          Open in the Notebook
        </Link>
      </div>
      {docs.map((d) => (
        <Link className="pdocrow" key={d.id} to="/knowledge" aria-label={`${d.title} — open in the Notebook`}>
          <span className="grow">
            {d.title}
            {(d.expiry_date || d.deadline_note) && (
              <span className="mono sub">{d.expiry_date ? fmtDay(d.expiry_date) : d.deadline_note}</span>
            )}
          </span>
          <span className={`pill ${d.status_cache}`}>{DOC_LABEL[d.status_cache] ?? d.status_cache}</span>
          <ArrowUpRight size={14} strokeWidth={1.8} className="pgo" aria-hidden />
        </Link>
      ))}
      {docs.length === 0 && <p className="tip">Nothing tracked yet.</p>}
      <p className="tip">Documents are edited in the Notebook so there is one copy of the truth, not two.</p>
    </div>
  );
}
