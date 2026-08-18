import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Settings2 } from 'lucide-react';
import { newId, useData, useStore } from '../../data/store';
import { CountUp, ProgressBar, useToast } from '../../ui/bits';
import { entrance, lift, micro, rise, staggerItem, staggerList } from '../../ui/motion';
import { daysSinceTs, daysUntil, dayModeNow, fmtDay, inr, todayIso, type DayMode } from '../../lib/dates';
import { rankTasks, type RankedTask } from '../../lib/ranking';
import { warmth } from '../../lib/warmth';
import { CustomiseModal, PersonalLayer, ProjectsStrip } from './personal';
import './style.css';

const MODES: { key: DayMode; label: string }[] = [
  { key: 'morning', label: 'Morning' },
  { key: 'midday', label: 'Midday' },
  { key: 'evening', label: 'Evening' },
];

const GREETING: Record<DayMode, string> = {
  morning: 'Morning',
  midday: 'Afternoon',
  evening: 'Evening',
};

const SUBLINE: Record<DayMode, string> = {
  morning: 'Three things need you. Nothing is on fire. Everything else waits behind one tap.',
  midday: 'Head down. One thing at a time — the board will still be there.',
  evening: 'Close the day properly and tomorrow starts lighter.',
};

/* Static, plausible, deliberately not an API call — one city per timezone. */
const WEATHER = [
  { city: 'Gurugram', tz: 'IST', temp: '33°', note: 'rain later', icon: 'sun' as const },
  { city: 'Milan', tz: 'CET', temp: '27°', note: 'clear', icon: 'moon' as const },
];

const STALE_DECISION_DAYS = 7; // plan §1.2
const FOCUS_MINUTES = 50; // plan §1.2

const fullDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);

/* ── Home ──────────────────────────────────────────────────────────────── */
export default function Home() {
  const ds = useData((d) => d);
  const me = useData((_, s) => s.me);
  const today = todayIso();

  // Auto mode, recomputed each minute; a manual pick overrides until cleared.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const [manual, setManual] = useState<DayMode | null>(null);
  const mode: DayMode = manual ?? dayModeNow();

  const [customising, setCustomising] = useState(false);

  const ranked = rankTasks(ds, today);
  const top: RankedTask | undefined = ranked.find((r) => r.task.assignee_id === me.id) ?? ranked[0];

  const openTasks = ds.tasks.filter((t) => t.status !== 'done');
  const mineOpen = openTasks.filter((t) => t.assignee_id === me.id);
  const openDecisions = ds.decisions.filter((d) => d.status === 'open');
  const staleDecisions = openDecisions.filter((d) => daysSinceTs(d.opened_at) > STALE_DECISION_DAYS);
  const drifting = ds.people.filter((p) => warmth(p, today).drifting);

  const flight = ds.fixed_dates.find((f) => f.label === 'Flight to Milan');
  const nextBiz = [...ds.fixed_dates]
    .filter((f) => f.category === 'business' && daysUntil(f.date, today) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const runway = ds.ledger.reduce((a, l) => a + (l.direction === 'in' ? l.amount : -l.amount), 0);

  return (
    <div className="home-screen">
      <motion.section className="welc" variants={rise} initial="initial" animate="animate">
        <div className="welc-head">
          <div className="eyebrow">{fullDate()}</div>
          <div className="spacer" />
          <div className="sub2" role="tablist" aria-label="Time of day">
            {MODES.map((m) => (
              <button
                key={m.key}
                role="tab"
                aria-selected={mode === m.key}
                onClick={() => setManual(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          {manual && (
            <button className="chip" onClick={() => setManual(null)} title="Follow the clock again">
              Auto
            </button>
          )}
        </div>

        <h1>
          {GREETING[mode]}, {me.name}.
        </h1>
        <p className="sub">{SUBLINE[mode]}</p>

        {/* ── ambient facts ── */}
        <motion.div className="hz" variants={staggerList} initial="initial" animate="animate">
          {WEATHER.map((w) => (
            <motion.span className="wxb" key={w.city} variants={staggerItem}>
              <span className={w.icon} aria-hidden />
              {w.city} {w.temp} · {w.note}
              <span className="mono" style={{ fontSize: 10, color: 'var(--mute)' }}>
                {w.tz}
              </span>
            </motion.span>
          ))}
          {flight && (
            <motion.span className="wxb" variants={staggerItem}>
              <b>
                <CountUp value={daysUntil(flight.date, today)} />
              </b>{' '}
              days to Italy
            </motion.span>
          )}
          {nextBiz && (
            <motion.span className="wxb" variants={staggerItem}>
              <b>
                <CountUp value={daysUntil(nextBiz.date, today)} />
              </b>{' '}
              days to {nextBiz.label}
            </motion.span>
          )}
          <motion.span className="wxb" variants={staggerItem} title="Money in minus money out, all projects">
            <b>
              {runway < 0 ? '−' : ''}
              <CountUp value={Math.abs(runway)} format={(n) => inr(n)} />
            </b>{' '}
            runway
          </motion.span>
          <motion.span variants={staggerItem} style={{ display: 'inline-flex' }}>
            <Link className={`wxb${staleDecisions.length ? ' alert' : ''}`} to="/work">
              <b>
                <CountUp value={staleDecisions.length} />
              </b>{' '}
              decision{staleDecisions.length === 1 ? '' : 's'} open &gt; {STALE_DECISION_DAYS} days
            </Link>
          </motion.span>
        </motion.div>

        {/* ── the mode block ── */}
        <AnimatePresence mode="wait">
          <motion.div key={mode} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={entrance}>
            {mode === 'morning' && <MorningCard top={top} />}
            {mode === 'midday' && <MiddayCard top={top} mineOpen={mineOpen.length} />}
            {mode === 'evening' && <EveningRitual />}
          </motion.div>
        </AnimatePresence>

        <QuickCapture />
      </motion.section>

      {/* ── summary tiles ── */}
      <motion.div className="tiles" variants={staggerList} initial="initial" animate="animate">
        <motion.div variants={staggerItem} {...lift}>
          <Link className="tile" to="/work">
            <div className="n">
              <CountUp value={openTasks.length} />
            </div>
            <div className="k">tasks open · {mineOpen.length} yours</div>
          </Link>
        </motion.div>
        <motion.div variants={staggerItem} {...lift}>
          <Link className="tile" to="/work">
            <div className="n">
              <CountUp value={openDecisions.length} />
            </div>
            <div className="k">
              decisions open{staleDecisions.length ? ` · ${staleDecisions.length} stale` : ''}
            </div>
          </Link>
        </motion.div>
        <motion.div variants={staggerItem} {...lift}>
          <Link className="tile" to="/people">
            <div className="n">
              <CountUp value={drifting.length} />
            </div>
            <div className="k">people drifting</div>
          </Link>
        </motion.div>
      </motion.div>

      {me.personalization.projects_strip && <ProjectsStrip />}
      <PersonalLayer />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button className="btn sm" onClick={() => setCustomising(true)}>
          <Settings2 size={14} strokeWidth={1.8} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          Customise this layer
        </button>
      </div>
      <CustomiseModal open={customising} onClose={() => setCustomising(false)} />
    </div>
  );
}

/* ── Morning: the one ranked task, with its maths ──────────────────────── */
function MorningCard({ top }: { top?: RankedTask }) {
  const w = useData((ds) => ds.ranking_weights);
  const reduced = useReducedMotion();
  const [why, setWhy] = useState(false);

  if (!top) {
    return (
      <div className="one">
        <div style={{ flex: 1 }}>
          <div className="eyebrow">Start here</div>
          <div className="ttl">Nothing open on the business side. Rare — enjoy it.</div>
        </div>
      </div>
    );
  }

  const pct = top.task.progress_pct;
  const factors = [
    { label: 'Objective fit', raw: top.objectiveFit, weight: w.objective_fit },
    { label: 'Unblocks', raw: top.unblocks, weight: w.unblocks },
    { label: 'Deadline', raw: top.deadline, weight: w.deadline },
  ];

  return (
    <div className="one">
      <svg className="ring" viewBox="0 0 36 36" role="img" aria-label={`${pct}% complete`}>
        <defs>
          <linearGradient id="home-ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--violet)" />
            <stop offset="100%" stopColor="var(--indigo)" />
          </linearGradient>
        </defs>
        <circle className="bgc" cx="18" cy="18" r="15.9" strokeDasharray="100" />
        <motion.circle
          cx="18"
          cy="18"
          r="15.9"
          stroke="url(#home-ring-grad)"
          strokeDasharray="100"
          initial={{ strokeDashoffset: reduced ? 100 - pct : 100 }}
          animate={{ strokeDashoffset: 100 - pct }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>

      <div style={{ flex: 1, minWidth: 200 }}>
        <div className="eyebrow">Start here — ranked by the formula</div>
        <Link className="ttl" to={`/task/${top.task.id}`}>
          {top.task.title}
        </Link>
        <div className="mono meta">
          {top.task.id} · score {top.score} · {pct}% done
          {top.task.due_date ? ` · due ${fmtDay(top.task.due_date)}` : ''}
        </div>
        <button
          className="chip"
          style={{ marginTop: 9 }}
          aria-expanded={why}
          onClick={() => setWhy((v) => !v)}
        >
          {why ? 'Hide the maths' : 'Why this one?'}
        </button>
      </div>

      <Link className="btn solid" to={`/task/${top.task.id}`}>
        Open
      </Link>

      <AnimatePresence initial={false}>
        {why && (
          <motion.div
            className="why"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: entrance }}
            exit={{ height: 0, opacity: 0, transition: micro }}
          >
            <ul>
              {top.why.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {factors.map((f) => (
              <div className="whyrow" key={f.label}>
                <span className="lbl">
                  {f.label} <span className="mono" style={{ fontSize: 10 }}>×{f.weight}</span>
                </span>
                <span className="bar">
                  <ProgressBar pct={f.raw} />
                </span>
                <span className="num">{f.raw}</span>
              </div>
            ))}
            <div className="mono" style={{ fontSize: 11, color: 'var(--mute)' }}>
              weighted total {top.score} · weights live in ranking_weights, editable in Work
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Midday: one focus card, 50-minute block ───────────────────────────── */
function MiddayCard({ top, mineOpen }: { top?: RankedTask; mineOpen: number }) {
  const store = useStore();
  const toast = useToast();
  const FULL = FOCUS_MINUTES * 60;
  const [left, setLeft] = useState(FULL);
  const [running, setRunning] = useState(false);
  const logged = useRef(false);

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => window.clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (left > 0 || logged.current) return;
    logged.current = true;
    setRunning(false);
    store.insert(
      'time_logs',
      {
        id: newId('tl'),
        user_id: store.me.id,
        date: todayIso(),
        kind: 'founder',
        minutes: FOCUS_MINUTES,
        course_id: null,
      },
      store.asMe({ summary: `Focus block — ${FOCUS_MINUTES} min logged` }),
    );
    toast(`${FOCUS_MINUTES} minutes logged. Stand up, drink water.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left]);

  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');

  return (
    <div className="one">
      <div style={{ flex: 1, minWidth: 200 }}>
        <div className="eyebrow">In focus</div>
        {top ? (
          <Link className="ttl" to={`/task/${top.task.id}`}>
            {top.task.title}
          </Link>
        ) : (
          <div className="ttl">Pick anything — the board is clear.</div>
        )}
        <div className="mono meta">
          {top ? `${top.task.id} · ` : ''}1 of {Math.max(mineOpen, 1)} today · notifications muted
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="clock" aria-live="polite">
          {mm}:{ss}
        </div>
        <div className="timerbtns" style={{ justifyContent: 'flex-end' }}>
          <button
            className="btn sm"
            onClick={() => {
              logged.current = false;
              setRunning((r) => !r);
            }}
          >
            {running ? 'Pause' : left === FULL ? `Start ${FOCUS_MINUTES} min` : 'Resume'}
          </button>
          <button
            className="btn sm"
            onClick={() => {
              setRunning(false);
              logged.current = false;
              setLeft(FULL);
            }}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Evening: shutdown ritual → daily_closeouts ────────────────────────── */
function EveningRitual() {
  const ds = useData((d) => d);
  const store = useStore();
  const me = useData((_, s) => s.me);
  const toast = useToast();
  const today = todayIso();

  const existing = ds.daily_closeouts.find((c) => c.user_id === me.id && c.date === today);
  const [editing, setEditing] = useState(!existing);
  const [shipped, setShipped] = useState(existing?.shipped ?? '');
  const [stuck, setStuck] = useState(existing?.stuck ?? '');
  const [tomorrow, setTomorrow] = useState(existing?.tomorrow ?? '');

  // Consecutive days ending today (or yesterday, if today isn't closed yet).
  const mine = new Set(ds.daily_closeouts.filter((c) => c.user_id === me.id).map((c) => c.date));
  let streak = 0;
  {
    const cursor = new Date(today + 'T00:00:00Z');
    if (!mine.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
    while (mine.has(cursor.toISOString().slice(0, 10))) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
  }

  const save = () => {
    if (existing) {
      store.update(
        'daily_closeouts',
        existing.id,
        { shipped, stuck, tomorrow },
        store.asMe({ summary: 'Day closed — revised' }),
      );
    } else {
      store.insert(
        'daily_closeouts',
        {
          id: newId('dc'),
          user_id: me.id,
          date: today,
          shipped,
          stuck,
          tomorrow,
          created_at: new Date().toISOString(),
        },
        store.asMe({ summary: 'Day closed' }),
      );
    }
    setEditing(false);
    toast('Day closed. Tomorrow starts lighter.');
  };

  const openTasks = ds.tasks.filter((t) => t.status !== 'done').length;
  const openDecs = ds.decisions.filter((d) => d.status === 'open').length;
  const digestBody = [
    `${me.name}'s shutdown — ${fmtDay(today)}`,
    '',
    `Shipped: ${shipped || '—'}`,
    `Stuck: ${stuck || '—'}`,
    `Tomorrow: ${tomorrow || '—'}`,
    '',
    `Board: ${openTasks} tasks open · ${openDecs} decisions waiting.`,
  ].join('\n');
  const mailto = `mailto:${ds.profiles.map((p) => p.email).join(',')}?subject=${encodeURIComponent(
    `Anvik daily digest — ${fmtDay(today)}`,
  )}&body=${encodeURIComponent(digestBody)}`;

  const dots = (
    <span className="dots" aria-hidden>
      {Array.from({ length: 7 }, (_, i) => (
        <i key={i} className={i < streak ? 'on' : ''} />
      ))}
    </span>
  );

  return (
    <div className="one rit" style={{ display: 'block' }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Shutdown ritual · 2 minutes
      </div>

      {editing ? (
        <motion.div variants={staggerList} initial="initial" animate="animate">
          <motion.div variants={staggerItem}>
            <label htmlFor="rit-shipped">What shipped today</label>
            <textarea id="rit-shipped" value={shipped} onChange={(e) => setShipped(e.target.value)} />
          </motion.div>
          <motion.div variants={staggerItem}>
            <label htmlFor="rit-stuck">What's stuck, honestly</label>
            <textarea id="rit-stuck" value={stuck} onChange={(e) => setStuck(e.target.value)} />
          </motion.div>
          <motion.div variants={staggerItem}>
            <label htmlFor="rit-tomorrow">Tomorrow's one thing</label>
            <textarea id="rit-tomorrow" value={tomorrow} onChange={(e) => setTomorrow(e.target.value)} />
          </motion.div>
        </motion.div>
      ) : (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={entrance}>
          <label>Shipped</label>
          <p className="done-line">{shipped || '—'}</p>
          <label>Stuck</label>
          <p className="done-line">{stuck || '—'}</p>
          <label>Tomorrow's one thing</label>
          <p className="done-line">{tomorrow || '—'}</p>
        </motion.div>
      )}

      <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
        {editing ? (
          <button className="btn solid" onClick={save}>
            Close the day
          </button>
        ) : (
          <>
            <span className="chip" style={{ borderColor: 'var(--teal)', color: 'var(--teal)' }}>
              Day closed ✓
            </span>
            <button className="btn sm" onClick={() => setEditing(true)}>
              Edit
            </button>
          </>
        )}
        <a className="btn sm" href={mailto}>
          Email the digest to both
        </a>
        <span className="mono" style={{ fontSize: 11, color: 'var(--mute)' }}>
          streak <b style={{ color: 'var(--ink)' }}>{streak}</b>
          {dots}
        </span>
      </div>
    </div>
  );
}

/* ── Quick capture → a real note ───────────────────────────────────────── */
function QuickCapture() {
  const store = useStore();
  const projects = useData((ds) => ds.projects);
  const toast = useToast();
  const [text, setText] = useState('');

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    const defaultProject = projects.find((p) => !p.is_personal)?.id ?? projects[0]?.id;
    if (!defaultProject) return;
    const title = body.split(/\s+/).slice(0, 6).join(' ');
    store.insert(
      'notes',
      {
        id: newId('n'),
        title,
        body,
        type: 'plain',
        project_id: defaultProject,
        task_id: null,
        tags: [],
        is_pinned: false,
        transcript: null,
        checklist: null,
        source_ref: null,
        created_by: store.me.id,
        created_at: new Date().toISOString(),
      },
      store.asMe({ summary: `Quick capture — "${title}"` }),
    );
    setText('');
    toast('Captured as a note in Knowledge');
  };

  return (
    <div className="capture">
      <input
        className="srch"
        value={text}
        aria-label="Quick capture"
        placeholder="Empty your head — one line, becomes a note"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <button className="btn solid" onClick={submit} disabled={!text.trim()}>
        Capture
      </button>
    </div>
  );
}
