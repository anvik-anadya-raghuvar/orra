import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { LifeAdminItem } from '../../types';
import { newId, nowIso, today, useData, useStore } from '../../data/store';
import { CountUp, useToast } from '../../ui/bits';
import { staggerItem, staggerList } from '../../ui/motion';
import { daysUntil, fmtDay } from '../../lib/dates';

/* ── this week's split — my study minutes vs founder minutes ────────────── */
function last7DaysCutoff(): string {
  const d = new Date(today() + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 6);
  return d.toISOString().slice(0, 10);
}

export function SplitBar() {
  const ds = useData((d) => d);
  const store = useStore();

  const totals = useMemo(() => {
    const cutoff = last7DaysCutoff();
    const mine = ds.time_logs.filter((t) => t.user_id === store.meId && t.date >= cutoff);
    const study = mine.filter((t) => t.kind === 'study').reduce((s, t) => s + t.minutes, 0);
    const founder = mine.filter((t) => t.kind === 'founder').reduce((s, t) => s + t.minutes, 0);
    return { study, founder };
  }, [ds.time_logs, store.meId]);

  const total = totals.study + totals.founder;
  const studyPct = total ? Math.round((totals.study / total) * 100) : 0;
  const fmtHours = (mins: number) => `${(mins / 60).toFixed(1)}h`;

  return (
    <div className="pbig">
      <h3>This week's split</h3>
      <div className="psplitbar">
        <motion.span
          className="study"
          initial={{ width: 0 }}
          animate={{ width: `${studyPct}%` }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.span
          className="founder"
          initial={{ width: 0 }}
          animate={{ width: `${total ? 100 - studyPct : 0}%` }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <div className="psplitlegend">
        <span>
          <i className="dot study" /> Study <CountUp value={totals.study} format={fmtHours} />
        </span>
        <span>
          <i className="dot founder" /> Founder <CountUp value={totals.founder} format={fmtHours} />
        </span>
      </div>
      <p className="tip">The degree gets real hours, not leftovers. This bar is the referee.</p>
    </div>
  );
}

/* ── study timer — logs honest minutes on stop ───────────────────────────── */
export function StudyTimer() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [courseId, setCourseId] = useState(ds.courses[0]?.id ?? '');
  const [running, setRunning] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const intervalRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (running) {
      intervalRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => window.clearInterval(intervalRef.current);
  }, [running]);

  const toggle = () => {
    if (running) {
      const minutes = Math.max(1, Math.round(seconds / 60));
      store.insert(
        'time_logs',
        { id: newId('tl'), user_id: store.meId, date: today(), kind: 'study', minutes, course_id: courseId || null },
        store.asMe({ summary: 'Study session logged' }),
      );
      toast('Study session logged');
      setRunning(false);
      setSeconds(0);
    } else {
      setSeconds(0);
      setRunning(true);
    }
  };

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <div className="pbig">
      <h3>Study block</h3>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
        <select className="pin" style={{ flex: '1 1 160px' }} value={courseId} disabled={running} onChange={(e) => setCourseId(e.target.value)}>
          {ds.courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <span className="pclock mono">
          {mm}:{ss}
        </span>
        <button className={`btn sm${running ? '' : ' solid'}`} type="button" onClick={toggle}>
          {running ? 'Stop and log' : 'Start a block'}
        </button>
      </div>
      <p className="tip">Stopping logs the minutes to the split and the trail. Honest hours, not vibes.</p>
    </div>
  );
}

/* ── life admin — my open items, add/toggle/delete ───────────────────────── */
export function LifeAdmin() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [text, setText] = useState('');
  const mine = useMemo(() => ds.life_admin.filter((l) => l.user_id === store.meId), [ds.life_admin, store.meId]);

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

  const toggle = (l: LifeAdminItem) => {
    store.update(
      'life_admin',
      l.id,
      { completed: !l.completed },
      store.asMe({ summary: `${l.item} ${!l.completed ? 'completed' : 'reopened'}` }),
    );
  };

  const remove = (l: LifeAdminItem) => {
    store.remove('life_admin', l.id, store.asMe({ summary: `Life admin removed — ${l.item}` }));
    toast('Removed');
  };

  return (
    <div>
      <div className="eyebrow" style={{ margin: '18px 0 8px' }}>
        Life admin
      </div>
      <motion.div variants={staggerList} initial="initial" animate="animate">
        {mine.map((l) => (
          <motion.div className="plifer" key={l.id} variants={staggerItem}>
            <button className="check" type="button" style={{ flex: 1 }} onClick={() => toggle(l)}>
              <span className={`bx${l.completed ? ' on' : ''}`} aria-hidden />
              <span className={l.completed ? 'off' : ''}>{l.item}</span>
            </button>
            <button className="pxdel" type="button" aria-label={`Remove ${l.item}`} onClick={() => remove(l)}>
              ×
            </button>
          </motion.div>
        ))}
        {mine.length === 0 && <p className="tip">Life admin is clear.</p>}
      </motion.div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input
          className="addin"
          placeholder="+ Add"
          value={text}
          style={{ flex: 1 }}
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

/* ── fixed dates — ascending, with a countdown pill ──────────────────────── */
function dateBadge(d: number): string {
  if (d < 3) return 'over';
  if (d < 14) return 'due';
  return 'ok';
}

export function FixedDates() {
  const ds = useData((d) => d);
  const store = useStore();
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');
  const [category, setCategory] = useState('relocation');

  const sorted = useMemo(() => [...ds.fixed_dates].sort((a, b) => a.date.localeCompare(b.date)), [ds.fixed_dates]);

  const add = () => {
    if (!label.trim() || !date) return;
    store.insert(
      'fixed_dates',
      { id: newId('fd'), label: label.trim(), date, category },
      store.asMe({ summary: `Fixed date added — ${label.trim()}` }),
    );
    setLabel('');
    setDate('');
  };

  return (
    <div className="pbig">
      <h3>Fixed dates</h3>
      <motion.div variants={staggerList} initial="initial" animate="animate">
        {sorted.map((f) => {
          const d = daysUntil(f.date);
          return (
            <motion.div className="pfixed" key={f.id} variants={staggerItem}>
              <span style={{ flex: 1 }}>
                {f.label}
                <span className="mono" style={{ display: 'block', fontSize: 10, color: 'var(--mute)' }}>
                  {f.category}
                </span>
              </span>
              <span className="mono" style={{ fontSize: 11.5, color: 'var(--mute)' }}>
                {fmtDay(f.date)}
              </span>
              <span className={`pill ${dateBadge(d)}`}>{d < 0 ? 'past' : `${d}d`}</span>
            </motion.div>
          );
        })}
        {sorted.length === 0 && <p className="tip">Nothing fixed yet.</p>}
      </motion.div>
      <div className="pfixedform">
        <input className="addin" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="addin" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        <select className="pin" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="relocation">Relocation</option>
          <option value="university">University</option>
          <option value="business">Business</option>
          <option value="personal">Personal</option>
        </select>
        <button className="btn sm" type="button" onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

/* ── relocation documents — read-only, personal project only ────────────── */
const DOC_LABEL: Record<string, string> = { ok: 'fine', soon: 'coming up', over: 'act now' };

export function RelocationDocs() {
  const ds = useData((d) => d);
  const docs = useMemo(() => ds.documents.filter((d) => d.project_id === 'personal'), [ds.documents]);

  return (
    <div className="pbig">
      <h3>Relocation documents</h3>
      {docs.map((d) => (
        <div className="pdocrow" key={d.id}>
          <span style={{ flex: 1 }}>
            {d.title}
            {(d.expiry_date || d.deadline_note) && (
              <span className="mono" style={{ display: 'block', fontSize: 10.5, color: 'var(--mute)' }}>
                {d.expiry_date ? fmtDay(d.expiry_date) : d.deadline_note}
              </span>
            )}
          </span>
          <span className={`pill ${d.status_cache}`}>{DOC_LABEL[d.status_cache] ?? d.status_cache}</span>
        </div>
      ))}
      {docs.length === 0 && <p className="tip">Nothing tracked yet.</p>}
    </div>
  );
}
