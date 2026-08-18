import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, Plus, Settings2, Sparkles } from 'lucide-react';
import { newId, useData, useStore, type AppStore } from '../../data/store';
import { packBento } from '../../lib/bento';
import { CountUp, Modal, ProgressBar, useToast } from '../../ui/bits';
import { entrance, micro, staggerItem, staggerList, staggerParent } from '../../ui/motion';
import { daysSinceTs, daysUntil, dayModeNow, fmtDay, inr, todayIso, type DayMode } from '../../lib/dates';
import {
  CAPACITY_MINUTES,
  planDay,
  rankTasks,
  stuckTasks,
  type RankedTask,
} from '../../lib/ranking';
import { CAPACITY_COPY, DEFAULT_WINS, eventsFor, planFor } from '../../lib/dayPlan';
import { warmth } from '../../lib/warmth';
import { BarRows, DayRibbon, MiniBars, Ring, Sparkline, SplitBar, VIZ } from '../../ui/viz';
import {
  CustomiseModal,
  LifeTile,
  MoneyTile,
  PhotoTile,
  ProjectsTile,
  SongTile,
  WorthTile,
} from './personal';
import type { Capacity, DayPlan, Task, WinCondition } from '../../types';
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
const CAPACITIES: Capacity[] = ['light', 'medium', 'heavy'];
const STALE_DECISION_DAYS = 7;
const FOCUS_MINUTES = 50;

const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);
const fullDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
const minsNow = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

/* ── One bento tile: declares how many columns and rows it occupies ────── */
interface Tile {
  key: string;
  cols: 1 | 2 | 4;
  tall?: boolean;
  cls?: string;
  node: React.ReactNode;
}

/* ── Home ──────────────────────────────────────────────────────────────── */
export default function Home() {
  const ds = useData((d) => d);
  const store = useStore();
  const me = useData((_, s) => s.me);
  const toast = useToast();
  const today = todayIso();

  // Auto mode + the ribbon's "now" marker, both recomputed each minute.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const [manual, setManual] = useState<DayMode | null>(null);
  const mode: DayMode = manual ?? dayModeNow();

  const [customising, setCustomising] = useState(false);
  const [addingBlock, setAddingBlock] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);

  /* ── the declared shape of the day ── */
  const plan = planFor(ds, me.id, today);
  const capacity: Capacity = plan?.capacity ?? 'medium';
  const wins: WinCondition[] = plan?.wins?.length ? plan.wins : DEFAULT_WINS;

  const upsertPlan = (patch: Partial<DayPlan>, summary: string) => {
    if (plan) {
      store.update('day_plans', plan.id, patch, store.asMe({ summary }));
      return;
    }
    store.insert(
      'day_plans',
      {
        id: newId('dp'),
        user_id: me.id,
        date: today,
        capacity: 'medium',
        intention: '',
        wins: DEFAULT_WINS,
        created_at: new Date().toISOString(),
        ...patch,
      } as DayPlan,
      store.asMe({ summary }),
    );
  };

  /* ── the automation: declare capacity, the portal assigns the work ── */
  const ranked = useMemo(() => rankTasks(ds, today, capacity), [ds, today, capacity]);
  const picked = useMemo(() => planDay(ranked, capacity), [ranked, capacity]);
  const top: RankedTask | undefined = ranked.find((r) => r.task.assignee_id === me.id) ?? ranked[0];
  const stuck = useMemo(() => stuckTasks(ds), [ds]);
  const events = useMemo(() => eventsFor(ds, me.id, today), [ds, me.id, today]);

  const openTasks = ds.tasks.filter((t) => t.status !== 'done');
  const openDecisions = ds.decisions.filter((d) => d.status === 'open');
  const staleDecisions = openDecisions.filter((d) => daysSinceTs(d.opened_at) > STALE_DECISION_DAYS);
  const drifting = ds.people.filter((p) => warmth(p, today).drifting);

  const p = me.personalization;
  const focusTask = focusId ? ds.tasks.find((t) => t.id === focusId) ?? null : null;
  const plannedMin = picked.reduce((a, r) => a + r.task.estimate_minutes, 0);
  const nextFixed = [...ds.fixed_dates]
    .filter((f) => daysUntil(f.date, today) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const runway = ds.ledger.reduce((a, l) => a + (l.direction === 'in' ? l.amount : -l.amount), 0);

  /* ── tile inventory. Order is packing order; dense flow backfills. ── */
  const tiles: Tile[] = [
    {
      key: 'greet',
      cols: 4,
      node: (
        <GreetTile
          mode={mode}
          manual={manual}
          setManual={setManual}
          name={me.name}
          plannedMin={plannedMin}
          blocks={events.length}
          runway={runway}
          nextFixed={nextFixed ? { label: nextFixed.label, days: daysUntil(nextFixed.date, today) } : null}
          stale={staleDecisions.length}
          onCustomise={() => setCustomising(true)}
        />
      ),
    },
    {
      key: 'hero',
      cols: 2,
      tall: true,
      node: <HeroTile top={top} onFocus={(id) => setFocusId(id)} />,
    },
    {
      key: 'capacity',
      cols: 2,
      node: (
        <CapacityTile
          capacity={capacity}
          planned={plannedMin}
          onPick={(c) => {
            upsertPlan({ capacity: c }, `Day capacity set to ${CAPACITY_COPY[c].label.toLowerCase()}`);
            toast(`${CAPACITY_COPY[c].label} day — the plan below just re-ranked.`);
          }}
        />
      ),
    },
    { key: 'plan', cols: 2, node: <PlanTile picked={picked} capacity={capacity} /> },
    {
      key: 'wins',
      cols: 2,
      node: (
        <WinsTile
          intention={plan?.intention ?? ''}
          wins={wins}
          onIntention={(v) => upsertPlan({ intention: v }, 'Today’s intention set')}
          onToggle={(i) => {
            const next = wins.map((w, k) => (k === i ? { ...w, done: !w.done } : w));
            upsertPlan({ wins: next }, `Win condition ${next[i].done ? 'met' : 'reopened'}`);
          }}
        />
      ),
    },
    { key: 'stuck', cols: 2, node: <StuckTile rows={stuck} /> },
    {
      key: 'ribbon',
      cols: 4,
      node: <RibbonTile events={events} onAdd={() => setAddingBlock(true)} />,
    },
    { key: 'pulse', cols: 2, node: <PulseTile /> },
  ];

  if (p.photo) tiles.push({ key: 'photo', cols: 2, tall: true, cls: 'bt-photo', node: <PhotoTile /> });

  tiles.push({
    key: 'ritual',
    cols: 2,
    tall: mode === 'evening',
    node: <RitualTile mode={mode} top={top} onFocus={(id) => setFocusId(id)} />,
  });

  if (p.worth_knowing) tiles.push({ key: 'worth', cols: 2, node: <WorthTile /> });
  if (p.life_radar) tiles.push({ key: 'life', cols: 2, node: <LifeTile /> });
  tiles.push({ key: 'warmth', cols: 2, node: <WarmthTile /> });
  tiles.push({ key: 'momentum', cols: 1, node: <MomentumTile /> });
  tiles.push({ key: 'split', cols: 1, node: <SplitTile /> });
  if (p.money_on_home) tiles.push({ key: 'money', cols: 1, node: <MoneyTile /> });
  if (p.projects_strip) tiles.push({ key: 'projects', cols: 1, node: <ProjectsTile /> });
  if (p.song) tiles.push({ key: 'song', cols: 1, node: <SongTile /> });

  tiles.push({
    key: 'st-tasks',
    cols: 1,
    node: (
      <StatTile
        to="/work"
        value={openTasks.length}
        label="tasks open"
        items={[
          { label: 'planned', value: picked.length },
          { label: 'open', value: openTasks.length },
        ]}
      />
    ),
  });
  tiles.push({
    key: 'st-dec',
    cols: 1,
    node: (
      <StatTile
        to="/work"
        value={openDecisions.length}
        label="decisions waiting"
        alert={staleDecisions.length > 0}
        items={[
          { label: `>${STALE_DECISION_DAYS}d`, value: staleDecisions.length },
          { label: 'open', value: openDecisions.length },
        ]}
      />
    ),
  });
  tiles.push({
    key: 'st-people',
    cols: 1,
    node: (
      <StatTile
        to="/people"
        value={drifting.length}
        label="people drifting"
        alert={drifting.length > 0}
        items={[
          { label: 'drifting', value: drifting.length },
          { label: 'tracked', value: ds.people.length },
        ]}
      />
    ),
  });

  // No filler tile: every row closes by growing whichever real tile already
  // ends it, recomputed fresh from whatever's actually visible right now —
  // so hiding a widget makes a genuine neighbour bigger, not a fake patch.
  const { rc4, rc2 } = useMemo(
    () => packBento(tiles.map((t) => ({ key: t.key, cols: t.cols }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tiles.map((t) => t.key + t.cols).join(',')],
  );

  return (
    <div className="home-screen">
      <motion.div className="bento" {...staggerParent()}>
        {tiles.map((t) => (
          <motion.section
            key={t.key}
            className={`bt${t.tall ? ' bt-tall' : ''}${t.cls ? ` ${t.cls}` : ''}`}
            style={{ '--rc4': rc4.get(t.key) ?? t.cols, '--rc2': rc2.get(t.key) ?? Math.min(t.cols, 2) } as React.CSSProperties}
            variants={staggerItem}
          >
            {t.node}
          </motion.section>
        ))}
      </motion.div>

      <CustomiseModal open={customising} onClose={() => setCustomising(false)} />
      <AddBlockModal open={addingBlock} onClose={() => setAddingBlock(false)} store={store} today={today} />
      <AnimatePresence>
        {focusTask && (
          <FocusOverlay
            task={focusTask}
            intention={plan?.intention ?? ''}
            onExit={() => setFocusId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Greeting + mode + quick capture, all in one compact band ──────────── */
function GreetTile({
  mode,
  manual,
  setManual,
  name,
  plannedMin,
  blocks,
  runway,
  nextFixed,
  stale,
  onCustomise,
}: {
  mode: DayMode;
  manual: DayMode | null;
  setManual: (m: DayMode | null) => void;
  name: string;
  plannedMin: number;
  blocks: number;
  runway: number;
  nextFixed: { label: string; days: number } | null;
  stale: number;
  onCustomise: () => void;
}) {
  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">{fullDate()}</span>
        <span className="spacer" />
        <div className="sub2" role="tablist" aria-label="Time of day">
          {MODES.map((m) => (
            <button key={m.key} role="tab" aria-selected={mode === m.key} onClick={() => setManual(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
        {manual && (
          <button className="chip" onClick={() => setManual(null)} title="Follow the clock again">
            Auto
          </button>
        )}
        <button className="chip" onClick={onCustomise} title="Choose which widgets show on Home">
          <Settings2 size={13} strokeWidth={1.8} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          Customise
        </button>
      </div>
      <div className="greetrow">
        <h1>
          {GREETING[mode]}, {name}.
        </h1>
        <QuickCapture />
      </div>
      <div className="ambrow">
        <span className="amb">
          <b>{hm(plannedMin)}</b> assigned to you
        </span>
        <span className="amb">
          <b>
            <CountUp value={blocks} />
          </b>{' '}
          block{blocks === 1 ? '' : 's'} on the clock
        </span>
        <span className="amb" title="Money in minus money out, all projects">
          <b>
            {runway < 0 ? '−' : ''}
            <CountUp value={Math.abs(runway)} format={(n) => inr(n)} />
          </b>{' '}
          runway
        </span>
        {nextFixed && (
          <span className="amb">
            <b>
              <CountUp value={nextFixed.days} />
            </b>{' '}
            days to {nextFixed.label}
          </span>
        )}
        <Link className={`amb${stale ? ' alert' : ''}`} to="/work">
          <b>
            <CountUp value={stale} />
          </b>{' '}
          decision{stale === 1 ? '' : 's'} past {STALE_DECISION_DAYS} days
        </Link>
      </div>
    </>
  );
}

/* ── Capacity: the headline control. Declare the shape of the day. ─────── */
function CapacityTile({
  capacity,
  planned,
  onPick,
}: {
  capacity: Capacity;
  planned: number;
  onPick: (c: Capacity) => void;
}) {
  const budget = CAPACITY_MINUTES[capacity];
  const pct = Math.min(100, Math.round((planned / budget) * 100));
  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">How heavy do you want today?</span>
      </div>
      <div className="capset" role="radiogroup" aria-label="Today's capacity">
        {CAPACITIES.map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={capacity === c}
            className={capacity === c ? 'on' : ''}
            onClick={() => onPick(c)}
          >
            {CAPACITY_COPY[c].label}
          </button>
        ))}
      </div>
      <p className="capblurb">{CAPACITY_COPY[capacity].blurb}</p>
      <div className="meter">
        <ProgressBar pct={pct} />
        <span className="mono">
          <CountUp value={planned} format={(n) => hm(n)} /> of {hm(budget)} assigned
        </span>
      </div>
    </>
  );
}

/* ── Your day, planned — the work the portal picked for that capacity ──── */
function PlanTile({ picked, capacity }: { picked: RankedTask[]; capacity: Capacity }) {
  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Your day, planned</span>
        <span className="spacer" />
        <span className="mono bt-num">
          <CountUp value={picked.length} /> task{picked.length === 1 ? '' : 's'}
        </span>
      </div>
      <div className="bt-scroll">
        {picked.length === 0 && (
          <p className="tip" style={{ marginTop: 0 }}>
            Nothing fits a {CAPACITY_COPY[capacity].label.toLowerCase()} day. Change the capacity above and this re-plans itself.
          </p>
        )}
        {picked.map((r) => (
          <Link className="planrow" key={r.task.id} to={`/task/${r.task.id}`}>
            <span className={`echip e-${r.task.effort}`}>{r.task.effort}</span>
            <span className="planttl">{r.task.title}</span>
            <span className="mono planmin">{hm(r.task.estimate_minutes)}</span>
          </Link>
        ))}
      </div>
    </>
  );
}

/* ── Hero: the one thing, with its maths and a way into focus ──────────── */
function HeroTile({ top, onFocus }: { top?: RankedTask; onFocus: (id: string) => void }) {
  const w = useData((ds) => ds.ranking_weights);
  if (!top) {
    return (
      <>
        <div className="bt-hd">
          <span className="eyebrow">Start here</span>
        </div>
        <div className="heroempty">
          <Sparkles size={24} strokeWidth={1.4} aria-hidden />
          <b>Nothing open on the business side.</b>
          <span>Rare. Enjoy it, or go read something.</span>
        </div>
      </>
    );
  }
  const t = top.task;
  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Start here · ranked, not guessed</span>
        <span className="spacer" />
        <span className="mono bt-num">score {top.score}</span>
      </div>
      <div className="herotop">
        <Ring pct={t.progress_pct} size={62} label={`${t.progress_pct}% complete`} />
        <div className="herocopy">
          <Link className="heroTtl" to={`/task/${t.id}`}>
            {t.title}
          </Link>
          <div className="herometa mono">
            {t.id} · {t.progress_pct}% done{t.due_date ? ` · due ${fmtDay(t.due_date)}` : ''}
          </div>
          <div className="rowgap tight">
            <span className={`echip e-${t.effort}`}>{t.effort}</span>
            <span className="mono bt-num">{hm(t.estimate_minutes)}</span>
          </div>
        </div>
      </div>
      <div className="whylist">
        {top.why.slice(0, 3).map((line) => (
          <span className="whyitem" key={line}>
            {line}
          </span>
        ))}
      </div>
      <div className="herofactors bt-scroll">
        <BarRows
          max={100}
          rows={[
            { label: `Objective fit ×${w.objective_fit}`, value: top.objectiveFit },
            { label: `Unblocks ×${w.unblocks}`, value: top.unblocks },
            { label: `Deadline ×${w.deadline}`, value: top.deadline },
          ]}
        />
      </div>
      <div className="rowgap">
        <Link className="btn solid" to={`/task/${t.id}`}>
          Open
        </Link>
        <button className="btn" onClick={() => onFocus(t.id)}>
          Focus
        </button>
      </div>
    </>
  );
}

/* ── Intention + "Today is a win if…" ──────────────────────────────────── */
function WinsTile({
  intention,
  wins,
  onIntention,
  onToggle,
}: {
  intention: string;
  wins: WinCondition[];
  onIntention: (v: string) => void;
  onToggle: (i: number) => void;
}) {
  const [draft, setDraft] = useState(intention);
  useEffect(() => setDraft(intention), [intention]);
  const done = wins.filter((w) => w.done).length;

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Today's intention</span>
      </div>
      <input
        className="srch intentin"
        value={draft}
        placeholder="One line. What is today actually for?"
        aria-label="Today's intention"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== intention && onIntention(draft.trim())}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
      <div className="bt-hd" style={{ marginTop: 4 }}>
        <span className="eyebrow">Today is a win if…</span>
        <span className="spacer" />
        <Ring pct={(done / Math.max(wins.length, 1)) * 100} size={26} color={VIZ.cat[2]} label={`${done} of ${wins.length} met`} />
        <span className="mono bt-num">
          {done}/{wins.length}
        </span>
      </div>
      <div className="bt-scroll">
        {wins.map((w, i) => (
          <button
            key={w.text}
            className={`win${w.done ? ' done' : ''}`}
            aria-pressed={w.done}
            onClick={() => onToggle(i)}
          >
            <span className="wdot" aria-hidden />
            <span>{w.text}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/* ── Stuck zone ────────────────────────────────────────────────────────── */
function StuckTile({ rows }: { rows: { task: Task; reason: string }[] }) {
  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Stuck? No shame — just surface it</span>
        <span className="spacer" />
        <span className={`mono bt-num${rows.length ? ' alert' : ''}`}>
          <CountUp value={rows.length} />
        </span>
      </div>
      <div className="bt-scroll">
        {rows.length === 0 && (
          <div className="calm">
            <b>Nothing is stuck.</b>
            <span>No blocked reasons, no evidence aging past 48 hours.</span>
          </div>
        )}
        {rows.map(({ task, reason }) => (
          <Link className="stuckrow" key={task.id} to={`/task/${task.id}`}>
            <AlertTriangle size={14} strokeWidth={1.8} aria-hidden />
            <span>
              <b>{task.title}</b>
              <em>{reason}</em>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}

/* ── Today's events ribbon ─────────────────────────────────────────────── */
function RibbonTile({
  events,
  onAdd,
}: {
  events: ReturnType<typeof eventsFor>;
  onAdd: () => void;
}) {
  const navigate = useNavigate();
  const contexts = new Set(events.map((e) => e.kind)).size;
  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Today, as it is actually shaped</span>
        <span className="spacer" />
        <span className="mono bt-num">
          <CountUp value={contexts} /> context{contexts === 1 ? '' : 's'}
        </span>
        <button className="btn sm" onClick={onAdd}>
          <Plus size={13} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          Add block
        </button>
      </div>
      <div className="bt-mid">
      {events.length ? (
        <DayRibbon
          events={events.map((e) => ({
            id: e.id,
            start_min: e.start_min,
            end_min: e.end_min,
            label: e.label,
            kind: e.kind,
          }))}
          nowMin={minsNow()}
          onPick={(id) => {
            const ev = events.find((x) => x.id === id);
            if (ev?.task_id) navigate(`/task/${ev.task_id}`);
          }}
        />
      ) : (
        <p className="tip" style={{ marginTop: 0 }}>
          Nothing blocked out today. Add one and the day stops being a guess.
        </p>
      )}
      </div>
    </>
  );
}

/* ── Pair pulse ────────────────────────────────────────────────────────── */
function PulseTile() {
  const ds = useData((d) => d);
  const store = useStore();
  const other = useData((_, s) => s.other);
  const toast = useToast();
  const navigate = useNavigate();

  const theirs = ds.tasks
    .filter((t) => t.assignee_id === other.id && t.status !== 'done')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];

  const need = () => {
    store.insert(
      'messages',
      {
        id: newId('m'),
        sender_id: store.me.id,
        body: theirs
          ? `Need you on ${theirs.id} — ${theirs.title}. No rush, whenever you switch contexts.`
          : `Need you on something when you switch contexts.`,
        task_ref_id: theirs?.id ?? null,
        attachment_url: null,
        song_ref: null,
        promoted_to_type: null,
        promoted_to_id: null,
        created_at: new Date().toISOString(),
      },
      store.asMe({ summary: `Quiet ask sent to ${other.name}` }),
    );
    toast(`Sent. ${other.name} sees it in Us.`);
    navigate('/us');
  };

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Pair pulse · no status theatre</span>
      </div>
      <div className="pulsehead">
        <span className="pulsedot" aria-hidden />
        <b>{other.name} is in motion, not waiting for a standup.</b>
      </div>
      <p className="pulsestatus">{other.status_text ?? 'No declared focus right now.'}</p>
      {theirs && (
        <Link className="pulselast" to={`/task/${theirs.id}`}>
          <span className="mono">{theirs.id}</span>
          <span>{theirs.title}</span>
          <span className="mono planmin">{theirs.progress_pct}%</span>
        </Link>
      )}
      <div className="rowgap">
        <button className="btn solid" onClick={need}>
          Need you on…
        </button>
        <Link className="btn sm" to="/us">
          Open Us
        </Link>
      </div>
    </>
  );
}

/* ── Weekly momentum ───────────────────────────────────────────────────── */
function MomentumTile() {
  const tasks = useData((ds) => ds.tasks);
  const { values, labels, total } = useMemo(() => {
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    const vals = days.map(
      (d) => tasks.filter((t) => t.status === 'done' && t.updated_at.slice(0, 10) === d).length,
    );
    const labs = days.map((d) =>
      new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(new Date(d + 'T00:00:00')),
    );
    return { values: vals, labels: labs, total: vals.reduce((a, b) => a + b, 0) };
  }, [tasks]);

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Momentum · 7 days</span>
      </div>
      <div className="bignum">
        <CountUp value={total} />
        <span>closed</span>
      </div>
      <div className="bt-mid">
        <Sparkline values={values} labels={labels} height={62} />
      </div>
    </>
  );
}

/* ── Focus split, study vs founder ─────────────────────────────────────── */
function SplitTile() {
  const logs = useData((ds) => ds.time_logs);
  const me = useData((_, s) => s.me);
  const mine = logs.filter((l) => l.user_id === me.id);
  const study = mine.filter((l) => l.kind === 'study').reduce((a, l) => a + l.minutes, 0);
  const founder = mine.filter((l) => l.kind === 'founder').reduce((a, l) => a + l.minutes, 0);

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Where the hours went</span>
      </div>
      <div className="bignum">
        <CountUp value={study + founder} format={(n) => hm(n)} />
        <span>logged</span>
      </div>
      <div className="bt-mid">
        <SplitBar
          height={16}
          parts={[
            { label: 'Founder', value: founder, color: VIZ.cat[0] },
            { label: 'Study', value: study, color: VIZ.cat[2] },
          ]}
        />
      </div>
    </>
  );
}

/* ── Relationship warmth ───────────────────────────────────────────────── */
function WarmthTile() {
  const people = useData((ds) => ds.people);
  const today = todayIso();
  const rows = people
    .map((p) => ({ label: p.name, value: Math.round(warmth(p, today).level * 100) }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 5);

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Warmth · coldest first</span>
        <span className="spacer" />
        <Link className="lk" to="/people">
          People
        </Link>
      </div>
      <div className="bt-scroll">
        {rows.length ? (
          <BarRows rows={rows} max={100} format={(n) => `${n}%`} />
        ) : (
          <p className="tip" style={{ marginTop: 0 }}>No one on the list yet.</p>
        )}
      </div>
    </>
  );
}

/* ── Small stat tile ───────────────────────────────────────────────────── */
function StatTile({
  to,
  value,
  label,
  items,
  alert,
}: {
  to: string;
  value: number;
  label: string;
  items: { label: string; value: number }[];
  alert?: boolean;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <Link className={`statlink${alert ? ' alert' : ''}`} to={to}>
      <div className="bignum">
        <CountUp value={value} />
        <span>{label}</span>
      </div>
      <MiniBars items={items.map((i) => ({ ...i, max }))} />
    </Link>
  );
}

/* ── The three time-of-day modes, compressed into one tile ─────────────── */
function RitualTile({
  mode,
  top,
  onFocus,
}: {
  mode: DayMode;
  top?: RankedTask;
  onFocus: (id: string) => void;
}) {
  if (mode === 'midday') return <MiddayBlock top={top} onFocus={onFocus} />;
  if (mode === 'evening') return <EveningRitual />;
  return <MorningBlock top={top} onFocus={onFocus} />;
}

function MorningBlock({ top, onFocus }: { top?: RankedTask; onFocus: (id: string) => void }) {
  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Morning · before the inbox decides</span>
      </div>
      <p className="modecopy">
        The plan is assigned. Protect the first block and the rest of the day usually behaves.
      </p>
      <div className="rowgap">
        {top && (
          <button className="btn solid" onClick={() => onFocus(top.task.id)}>
            Start the first block
          </button>
        )}
        <Link className="btn sm" to="/work">
          See the board
        </Link>
      </div>
    </>
  );
}

function MiddayBlock({ top, onFocus }: { top?: RankedTask; onFocus: (id: string) => void }) {
  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Midday · one thing at a time</span>
      </div>
      <p className="modecopy">
        {top ? top.task.title : 'Board is clear — pick anything.'}
      </p>
      <div className="rowgap">
        {top && (
          <button className="btn solid" onClick={() => onFocus(top.task.id)}>
            {FOCUS_MINUTES}-minute block
          </button>
        )}
        <Link className="btn sm" to="/work">
          Board
        </Link>
      </div>
    </>
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
      store.update('daily_closeouts', existing.id, { shipped, stuck, tomorrow }, store.asMe({ summary: 'Day closed — revised' }));
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

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Shutdown · 2 minutes</span>
        <span className="spacer" />
        <span className="dots" aria-label={`${streak} day streak`}>
          {Array.from({ length: 7 }, (_, i) => (
            <i key={i} className={i < streak ? 'on' : ''} />
          ))}
        </span>
      </div>
      <div className="bt-scroll rit">
        {editing ? (
          <>
            <label htmlFor="rit-shipped">What shipped</label>
            <textarea id="rit-shipped" value={shipped} onChange={(e) => setShipped(e.target.value)} />
            <label htmlFor="rit-stuck">What's stuck, honestly</label>
            <textarea id="rit-stuck" value={stuck} onChange={(e) => setStuck(e.target.value)} />
            <label htmlFor="rit-tomorrow">Tomorrow's one thing</label>
            <textarea id="rit-tomorrow" value={tomorrow} onChange={(e) => setTomorrow(e.target.value)} />
          </>
        ) : (
          <>
            <label>Shipped</label>
            <p className="done-line">{shipped || '—'}</p>
            <label>Stuck</label>
            <p className="done-line">{stuck || '—'}</p>
            <label>Tomorrow's one thing</label>
            <p className="done-line">{tomorrow || '—'}</p>
          </>
        )}
      </div>
      <div className="rowgap">
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
      </div>
    </>
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
        placeholder="Empty your head — one line becomes a note"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      <button className="btn solid" onClick={submit} disabled={!text.trim()}>
        Capture
      </button>
    </div>
  );
}

/* ── Add a block to today's ribbon ─────────────────────────────────────── */
const KINDS: { k: 'focus' | 'meeting' | 'study' | 'admin' | 'personal'; label: string }[] = [
  { k: 'focus', label: 'Focus' },
  { k: 'meeting', label: 'Meeting' },
  { k: 'study', label: 'Study' },
  { k: 'admin', label: 'Admin' },
  { k: 'personal', label: 'Personal' },
];

function AddBlockModal({
  open,
  onClose,
  store,
  today,
}: {
  open: boolean;
  onClose: () => void;
  store: AppStore;
  today: string;
}) {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:30');
  const [kind, setKind] = useState<(typeof KINDS)[number]['k']>('focus');

  const toMin = (v: string) => {
    const [h, m] = v.split(':').map((n) => parseInt(n, 10));
    return (h || 0) * 60 + (m || 0);
  };

  const save = () => {
    const s = toMin(start);
    const e = Math.max(s + 15, toMin(end));
    if (!label.trim()) return;
    store.insert(
      'day_events',
      {
        id: newId('ev'),
        user_id: store.me.id,
        date: today,
        start_min: s,
        end_min: e,
        label: label.trim(),
        kind,
        task_id: null,
      },
      store.asMe({ summary: `Blocked out "${label.trim()}"` }),
    );
    setLabel('');
    onClose();
    toast('Blocked out. The ribbon just changed shape.');
  };

  return (
    <Modal open={open} onClose={onClose} title="Block out time">
      <label className="eyebrow" htmlFor="blk-label">
        What is it
      </label>
      <input
        id="blk-label"
        className="srch"
        style={{ width: '100%', margin: '6px 0 12px' }}
        value={label}
        placeholder="Build · Registry"
        onChange={(e) => setLabel(e.target.value)}
      />
      <div className="blkgrid">
        <div>
          <label className="eyebrow" htmlFor="blk-start">
            Start
          </label>
          <input id="blk-start" className="srch" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label className="eyebrow" htmlFor="blk-end">
            End
          </label>
          <input id="blk-end" className="srch" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="filters" style={{ marginTop: 12 }}>
        {KINDS.map((x) => (
          <button
            key={x.k}
            className="chip"
            aria-pressed={kind === x.k}
            onClick={() => setKind(x.k)}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn solid" onClick={save} disabled={!label.trim()}>
          Add block
        </button>
      </div>
    </Modal>
  );
}

/* ── Founder mode: only this task exists ───────────────────────────────── */
function FocusOverlay({
  task,
  intention,
  onExit,
}: {
  task: Task;
  intention: string;
  onExit: () => void;
}) {
  const store = useStore();
  const toast = useToast();
  const reduced = useReducedMotion();
  const FULL = FOCUS_MINUTES * 60;
  const [left, setLeft] = useState(FULL);
  const [running, setRunning] = useState(true);
  const logged = useRef(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onExit();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onExit]);

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

  const progress = () => {
    store.update(
      'tasks',
      task.id,
      { progress_pct: Math.min(100, task.progress_pct + 15) },
      store.asMe({ summary: 'Meaningful progress in a focus block' }),
    );
    toast('Progress logged. Trail updated.');
    onExit();
  };
  const surface = () => {
    store.update(
      'tasks',
      task.id,
      { is_stuck: true },
      store.asMe({ summary: 'Surfaced as stuck from focus mode' }),
    );
    toast('Surfaced as stuck — not failed.');
    onExit();
  };

  return (
    <motion.div
      className="focusmask"
      role="dialog"
      aria-modal="true"
      aria-label="Founder mode"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: micro }}
      transition={entrance}
    >
      <div className="focusshell">
        <div className="bt-hd">
          <span className="eyebrow">Founder mode</span>
          <span className="spacer" />
          <button className="btn" onClick={onExit}>
            Exit
          </button>
        </div>
        {intention && (
          <>
            <span className="eyebrow">Today's intention</span>
            <p className="focusintent">{intention}</p>
          </>
        )}
        <span className="eyebrow">Only this exists for the next block</span>
        <h2>{task.title}</h2>
        <div className="mono focusmeta">
          {task.id} · {task.effort} · {hm(task.estimate_minutes)} estimate
        </div>
        <div className="focusclock" aria-live="polite">
          {mm}:{ss}
        </div>
        <p className="focusnote">Mail, navigation, counts and other ventures are deliberately gone.</p>
        <div className="rowgap">
          <button className="btn solid" onClick={progress}>
            Meaningful progress
          </button>
          <button className="btn" onClick={surface}>
            I'm stuck
          </button>
          <button className="btn" onClick={() => setRunning((r) => !r)}>
            {running ? 'Pause' : 'Resume'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
