import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertTriangle, ChevronRight, Plus, Settings2, Sparkles } from 'lucide-react';
import { newId, nowIso, useData, useStore, type AppStore } from '../../data/store';
import { packBento } from '../../lib/bento';
import { Avatar, CountUp, Modal, ProgressBar, useToast } from '../../ui/bits';
import { entrance, micro, staggerParent } from '../../ui/motion';
import { daysSinceTs, daysUntil, dayModeNow, fmtDay, fmtTime, inr, todayIso, type DayMode } from '../../lib/dates';
import {
  CAPACITY_MINUTES,
  planDay,
  rankTasks,
  stuckTasks,
  type RankedTask,
} from '../../lib/ranking';
import { isMyTask, myTasks } from '../../lib/workspace';
import { blockedByOpenDep } from '../../lib/schedule';
import { FOUNDER_TARGET_MINUTES, startBlock } from '../../lib/blocks';
import {
  CAPACITY_COPY,
  eventsFor,
  intentionsFor,
  itemDone,
  itemLabel,
  nextPosition,
  planFor,
} from '../../lib/dayPlan';
import { warmth } from '../../lib/warmth';
import { BarRows, DayRibbon, MiniBars, Ring, Sparkline, SplitBar, VIZ } from '../../ui/viz';
import {
  CustomiseModal,
  LifeTile,
  MoneyTile,
  ProjectsTile,
  TileOpen,
  WorthTile,
} from './personal';
import { MomentsTile } from './moments';
import { arrange } from './layout';
import { BentoTile, TILE_TITLE, TileSheetHost, useHomeArrange } from './tilechrome';
import type { Capacity, DayPlan, DayPlanItem, Task } from '../../types';
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

  /* ── the declared shape of the day ── */
  const plan = planFor(ds, me.id, today);
  const capacity: Capacity = plan?.capacity ?? 'medium';

  /** `day_plans` now only carries the capacity — the intention line and win
   *  conditions moved to `day_plan_items`, where they can point at real tasks.
   *  The old columns stay in the database so past days keep their history. */
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
        wins: [],
        created_at: new Date().toISOString(),
        ...patch,
      } as DayPlan,
      store.asMe({ summary }),
    );
  };

  /* ── the automation: declare capacity, the portal assigns the work ── */
  /* Home is my workspace: rank, plan, stuck and counts all read my own work
     only (principle 1). Money, decisions and people stay shared below. */
  const ranked = useMemo(() => rankTasks(ds, today, capacity, me.id), [ds, today, capacity, me.id]);
  // Work waiting on an unfinished predecessor cannot be today's work.
  const waiting = useMemo(
    () => blockedByOpenDep(ds.tasks, ds.task_links),
    [ds.tasks, ds.task_links],
  );
  const picked = useMemo(() => planDay(ranked, capacity, waiting), [ranked, capacity, waiting]);
  const top: RankedTask | undefined = ranked[0];
  const stuck = useMemo(
    () => stuckTasks(ds).filter((s) => isMyTask(s.task, me.id)),
    [ds, me.id],
  );
  const events = useMemo(() => eventsFor(ds, me.id, today), [ds, me.id, today]);

  const openTasks = myTasks(ds.tasks, me.id).filter((t) => t.status !== 'done');
  const openDecisions = ds.decisions.filter((d) => d.status === 'open');
  const staleDecisions = openDecisions.filter((d) => daysSinceTs(d.opened_at) > STALE_DECISION_DAYS);
  const drifting = ds.people.filter((p) => warmth(p, today).drifting);

  const p = me.personalization;
  const plannedMin = picked.reduce((a, r) => a + r.task.estimate_minutes, 0);

  /** Entering a block from a particular task highlights it inside the block,
   *  rather than being the only thing the block contains. */
  const beginFounderBlock = (taskId: string) => {
    if (!startBlock(store, 'founder', { focusTaskId: taskId })) {
      toast('A block is already running.');
    }
  };
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
      node: <HeroTile top={top} onFocus={beginFounderBlock} />,
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
    { key: 'plan', cols: 2, node: <PlanTile picked={picked} capacity={capacity} date={today} /> },
    { key: 'wins', cols: 2, node: <IntentionsTile date={today} /> },
    { key: 'stuck', cols: 2, node: <StuckTile rows={stuck} /> },
    {
      key: 'ribbon',
      cols: 4,
      node: <RibbonTile events={events} onAdd={() => setAddingBlock(true)} />,
    },
    { key: 'pulse', cols: 2, node: <PulseTile /> },
    { key: 'thread', cols: 2, tall: true, node: <ThreadTile /> },
  ];

  // One tile for both: a photo and a song are the same gesture, and they carry
  // a sender now, so they belong together under "From {them}".
  if (p.photo) tiles.push({ key: 'photo', cols: 2, tall: true, node: <MomentsTile /> });

  tiles.push({
    key: 'ritual',
    cols: 2,
    tall: mode === 'evening',
    node: <RitualTile mode={mode} top={top} onFocus={beginFounderBlock} />,
  });

  if (p.worth_knowing) tiles.push({ key: 'worth', cols: 2, node: <WorthTile /> });
  if (p.life_radar) tiles.push({ key: 'life', cols: 2, node: <LifeTile /> });
  tiles.push({ key: 'warmth', cols: 2, node: <WarmthTile /> });
  tiles.push({ key: 'momentum', cols: 1, node: <MomentumTile /> });
  tiles.push({ key: 'split', cols: 1, node: <SplitTile /> });
  if (p.money_on_home) tiles.push({ key: 'money', cols: 1, node: <MoneyTile /> });
  if (p.projects_strip) tiles.push({ key: 'projects', cols: 1, node: <ProjectsTile /> });

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

  // Two passes, deliberately separate. First the user's own arrangement — the
  // order they dragged tiles into and any size they set — applied to whatever
  // is visible right now (./layout.ts). Then the packer, which takes those
  // spans as a floor and works out actual placement.
  //
  // No filler tile, and no trailing holes: placement is computed rather than
  // left to `grid-auto-flow: dense`, because a two-row tile also consumes a
  // cell in the row beneath it. Recomputed fresh from whatever is visible, so
  // hiding a widget makes a genuine neighbour bigger, not a fake patch — and
  // so dragging a tile can never open one either.
  const arrangeApi = useHomeArrange();
  const laid = arrange(
    tiles.map((t) => ({ ...t, cols: t.cols as number, rows: t.tall ? 2 : 1 })),
    arrangeApi.layout,
  );
  arrangeApi.syncKeys(laid.map((t) => t.key));

  const { rc4, rc2 } = useMemo(
    () => packBento(laid.map((t) => ({ key: t.key, cols: t.cols, rows: t.rows }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [laid.map((t) => `${t.key}:${t.cols}x${t.rows}`).join(',')],
  );

  return (
    <div className="home-screen">
      <motion.div className="bento" ref={arrangeApi.gridRef} {...staggerParent()}>
        {laid.map((t) => (
          <BentoTile
            key={t.key}
            tileKey={t.key}
            span={{ cols: t.cols, rows: t.rows }}
            api={arrangeApi}
            className={`bt${t.cls ? ` ${t.cls}` : ''}`}
            style={
              {
                '--rc4': rc4.get(t.key)?.renderCols ?? t.cols,
                '--rr4': rc4.get(t.key)?.renderRows ?? t.rows,
                '--gc4': rc4.get(t.key)?.col ?? 'auto',
                '--gr4': rc4.get(t.key)?.row ?? 'auto',
                '--rc2': rc2.get(t.key)?.renderCols ?? Math.min(t.cols, 2),
                '--rr2': rc2.get(t.key)?.renderRows ?? t.rows,
                '--gc2': rc2.get(t.key)?.col ?? 'auto',
                '--gr2': rc2.get(t.key)?.row ?? 'auto',
              } as React.CSSProperties
            }
          >
            {t.node}
          </BentoTile>
        ))}
      </motion.div>

      <TileSheetHost
        api={arrangeApi}
        tiles={laid.map((t) => ({
          key: t.key,
          title: TILE_TITLE[t.key] ?? t.key,
          span: { cols: t.cols, rows: t.rows },
          node: t.node,
        }))}
      />

      <CustomiseModal open={customising} onClose={() => setCustomising(false)} />
      <AddBlockModal open={addingBlock} onClose={() => setAddingBlock(false)} store={store} today={today} />
      {/* The block overlay itself is mounted app-wide in App.tsx — a block is a
          state the whole portal is in, not a thing that lives on Home. */}
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
          event{blocks === 1 ? '' : 's'} today
        </span>
        <span className="amb" title="Money in minus money out, all projects">
          <b>
            {runway < 0 ? '−' : ''}
            <CountUp value={Math.abs(runway)} format={(n) => inr(n)} />
          </b>{' '}
          cash balance
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
        <span className="eyebrow">Today's capacity — how much can you take on?</span>
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

/* ── The plan — suggested until you save it, then it is today's ────────── */
/** The picks used to be recomputed on every render and never stored, so "my
 *  plan" silently reshuffled whenever a task changed. Saving writes the picks
 *  as intentions, and from then on this tile shows what you committed to. */
function PlanTile({
  picked,
  capacity,
  date,
}: {
  picked: RankedTask[];
  capacity: Capacity;
  date: string;
}) {
  const ds = useData((d) => d);
  const store = useStore();
  const meId = useData((_, s) => s.meId);
  const toast = useToast();

  const items = useMemo(() => intentionsFor(ds, meId, date), [ds.day_plan_items, meId, date]);
  const saved = useMemo(() => items.filter((i) => i.source === 'planner'), [items]);
  const isSaved = saved.length > 0;

  const savePlan = () => {
    const already = new Set(items.map((i) => i.task_id).filter(Boolean));
    let pos = nextPosition(items);
    for (const r of picked) {
      if (already.has(r.task.id)) continue;
      store.insert(
        'day_plan_items',
        {
          id: newId('dpi'),
          user_id: meId,
          date,
          task_id: r.task.id,
          text: r.task.title,
          done: false,
          position: pos++,
          source: 'planner',
          created_at: new Date().toISOString(),
        },
        store.asMe({ silent: true }),
      );
    }
    store.note('day_plan', `Plan saved for ${date} — ${picked.length} tasks`, store.asMe());
    toast('Saved. This is your day — see the intentions below.');
  };

  const replan = () => {
    saved.forEach((i) => store.remove('day_plan_items', i.id, store.asMe({ silent: true })));
    store.note('day_plan', `Plan cleared for ${date}`, store.asMe());
    toast('Cleared — pick a capacity and save again.');
  };

  const rows = isSaved
    ? saved
        .map((i) => ds.tasks.find((t) => t.id === i.task_id))
        .filter((t): t is Task => Boolean(t))
    : picked.map((r) => r.task);

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">{isSaved ? "Today's plan" : 'Suggested plan'}</span>
        <span className="spacer" />
        <span className="mono bt-num">
          <CountUp value={rows.length} /> task{rows.length === 1 ? '' : 's'}
        </span>
        <TileOpen to="/work" label="Work" />
      </div>
      <div className="bt-scroll">
        {rows.length === 0 && (
          <p className="tip" style={{ marginTop: 0 }}>
            Nothing fits a {CAPACITY_COPY[capacity].label.toLowerCase()} day. Change the capacity above and this re-plans itself.
          </p>
        )}
        {rows.map((t) => (
          <Link className="planrow" key={t.id} to={`/task/${t.id}`}>
            <span className={`echip e-${t.effort}`}>{t.effort}</span>
            <span className="planttl">{t.title}</span>
            <span className="mono planmin">{hm(t.estimate_minutes)}</span>
          </Link>
        ))}
      </div>
      {rows.length > 0 && (
        <div className="rowgap">
          {isSaved ? (
            <>
              <button
                className="btn solid"
                type="button"
                onClick={() =>
                  startBlock(store, 'today_plan') || toast('A block is already running.')
                }
              >
                Run as a block
              </button>
              <button className="btn sm" type="button" onClick={replan}>
                Re-plan
              </button>
            </>
          ) : (
            <button className="btn solid" type="button" onClick={savePlan}>
              Make this my day
            </button>
          )}
        </div>
      )}
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
          <span className="spacer" />
          <TileOpen to="/work" label="Work" />
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
        <span className="eyebrow">Top priority</span>
        <span className="spacer" />
        <span className="mono bt-num">score {top.score}</span>
        <TileOpen to="/work" label="Work" />
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

/* ── Today's intentions — a list that points at real work ──────────────── */
/** Replaces the old single "intention" line and its disconnected win
 *  conditions. A line here is either something you typed or a task, and
 *  ticking a task line closes the task itself. */
function IntentionsTile({ date }: { date: string }) {
  const ds = useData((d) => d);
  const store = useStore();
  const meId = useData((_, s) => s.meId);
  const toast = useToast();
  const [draft, setDraft] = useState('');

  const items = useMemo(() => intentionsFor(ds, meId, date), [ds.day_plan_items, meId, date]);
  const done = items.filter((i) => itemDone(i, ds.tasks)).length;

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    store.insert(
      'day_plan_items',
      {
        id: newId('dpi'),
        user_id: meId,
        date,
        task_id: null,
        text,
        done: false,
        position: nextPosition(items),
        source: 'manual',
        created_at: new Date().toISOString(),
      },
      store.asMe({ summary: `Intention added — ${text}` }),
    );
    setDraft('');
  };

  const toggle = (item: DayPlanItem) => {
    const next = !itemDone(item, ds.tasks);
    // A line standing for a task closes the task, so Home and the board can
    // never disagree about whether the work is finished.
    if (item.task_id) {
      const task = ds.tasks.find((t) => t.id === item.task_id);
      if (task) {
        store.update(
          'tasks',
          task.id,
          next
            ? { status: 'done', progress_pct: 100 }
            : { status: 'in_progress', progress_pct: Math.min(task.progress_pct, 90) },
          store.asMe({ summary: `${task.id} ${next ? 'closed' : 'reopened'} from today's intentions` }),
        );
      }
    }
    store.update('day_plan_items', item.id, { done: next }, store.asMe({ silent: true }));
  };

  const remove = (item: DayPlanItem) => {
    store.remove('day_plan_items', item.id, store.asMe({ summary: 'Intention removed' }));
    toast('Removed from today');
  };

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Today's intentions</span>
        <span className="spacer" />
        {items.length > 0 && (
          <>
            <Ring
              pct={(done / items.length) * 100}
              size={26}
              color={VIZ.cat[2]}
              label={`${done} of ${items.length} done`}
            />
            <span className="mono bt-num">
              {done}/{items.length}
            </span>
          </>
        )}
      </div>

      {items.length === 0 && (
        <p className="tip" style={{ marginTop: 0 }}>
          Nothing set for today. Add a line, or save the suggested plan above.
        </p>
      )}

      <div className="bt-scroll">
        {items.map((i) => {
          const isDone = itemDone(i, ds.tasks);
          return (
            <div key={i.id} className="intent-row">
              <button
                className={`win${isDone ? ' done' : ''}`}
                aria-pressed={isDone}
                onClick={() => toggle(i)}
              >
                <span className="wdot" aria-hidden />
                <span>{itemLabel(i, ds.tasks)}</span>
              </button>
              {i.task_id && (
                <Link className="mono planmin" to={`/task/${i.task_id}`} title="Open the task">
                  {i.task_id}
                </Link>
              )}
              <button
                className="intent-x"
                type="button"
                aria-label={`Remove ${itemLabel(i, ds.tasks)} from today`}
                onClick={() => remove(i)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <input
        className="srch intentin"
        value={draft}
        placeholder="Add an intention for today…"
        aria-label="Add an intention"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        // Enter adds directly. Going via blur() meant the line only landed if
        // a blur actually followed, which is not something a keypress promises.
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          add();
        }}
      />
      {items.length > 0 && (
        <div className="rowgap">
          <button
            className="btn sm"
            type="button"
            onClick={() => startBlock(store, 'intentions') || toast('A block is already running.')}
          >
            Run as a block
          </button>
        </div>
      )}
    </>
  );
}

/* ── Stuck zone ────────────────────────────────────────────────────────── */
function StuckTile({ rows }: { rows: { task: Task; reason: string }[] }) {
  const store = useStore();
  const toast = useToast();

  const unstick = (task: Task) => {
    store.update(
      'tasks',
      task.id,
      { is_stuck: false, blocked_reason: null },
      store.asMe({ summary: `${task.title} — unstuck` }),
    );
    toast('Cleared. Back in the running.');
  };

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Blocked tasks</span>
        <span className="spacer" />
        <span className={`mono bt-num${rows.length ? ' alert' : ''}`}>
          <CountUp value={rows.length} />
        </span>
        <TileOpen to="/work" label="Work" />
      </div>
      <div className="bt-scroll">
        {rows.length === 0 && (
          <div className="calm">
            <b>Nothing is stuck.</b>
            <span>No blocked reasons, no evidence aging past 48 hours.</span>
          </div>
        )}
        {rows.map(({ task, reason }) => (
          <div className="stuckrow" key={task.id}>
            <AlertTriangle size={14} strokeWidth={1.8} aria-hidden />
            <Link className="stuckttl" to={`/task/${task.id}`}>
              <b>{task.title}</b>
              <em>{reason}</em>
            </Link>
            {(task.is_stuck || task.blocked_reason) && (
              <button type="button" className="btn sm" onClick={() => unstick(task)}>
                Unstick
              </button>
            )}
          </div>
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
        <span className="eyebrow">Today's schedule</span>
        <span className="spacer" />
        <span className="mono bt-num">
          <CountUp value={contexts} /> context{contexts === 1 ? '' : 's'}
        </span>
        <button className="btn sm" onClick={onAdd}>
          <Plus size={13} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          Add block
        </button>
        <TileOpen to="/work" label="Work calendar" />
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
          No events yet today. Add a block to plan your day.
        </p>
      )}
      </div>
    </>
  );
}

/* ── What the other one is up to ───────────────────────────────────────── */
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
        <span className="eyebrow">What {other.name} is up to</span>
        <span className="spacer" />
        <TileOpen to="/us" label="Us" />
      </div>
      <div className="pulsehead">
        <span className="pulsedot" aria-hidden />
        <b>Status: {other.status_text ?? 'nothing set right now'}</b>
      </div>
      {theirs && (
        <>
          <p className="pulsestatus">Latest task:</p>
          <Link className="pulselast" to={`/task/${theirs.id}`}>
            <span className="mono">{theirs.id}</span>
            <span>{theirs.title}</span>
            <span className="mono planmin">{theirs.progress_pct}%</span>
          </Link>
        </>
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

/* ── Between us: the actual thread, live on Home ────────────────────────── */
function ThreadTile() {
  const ds = useData((d) => d);
  const store = useStore();
  const other = useData((_, s) => s.other);
  const [body, setBody] = useState('');
  const streamRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () => [...ds.messages].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [ds.messages],
  );
  const recent = sorted.slice(-6);
  const unread = useMemo(
    () => ds.messages.filter((m) => m.sender_id === other.id && daysSinceTs(m.created_at) < 1).length,
    [ds.messages, other.id],
  );

  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [recent.length]);

  const send = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    store.insert(
      'messages',
      {
        id: newId('msg'),
        sender_id: store.me.id,
        body: trimmed,
        task_ref_id: null,
        attachment_url: null,
        song_ref: null,
        promoted_to_type: null,
        promoted_to_id: null,
        created_at: nowIso(),
      },
      store.asMe(),
    );
    setBody('');
  };

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Between us</span>
        <span className="spacer" />
        {unread > 0 && (
          <span className="mono bt-num alert">
            {unread} new
          </span>
        )}
        <TileOpen to="/us" label="Us" />
      </div>
      <div className="threadstream" ref={streamRef}>
        {recent.length === 0 ? (
          <div className="threadempty">
            <b>Nothing here yet.</b>
            <span>Say something — the first line is always the hardest.</span>
          </div>
        ) : (
          recent.map((m) => {
            const mine = m.sender_id === store.meId;
            const sender = ds.profiles.find((p) => p.id === m.sender_id);
            const task = m.task_ref_id ? ds.tasks.find((t) => t.id === m.task_ref_id) : undefined;
            return (
              <div className={`threadrow${mine ? ' me' : ''}`} key={m.id}>
                <Avatar userId={m.sender_id} size={22} />
                <div className="threadbubble">
                  <div className="threadmeta">
                    {sender?.name ?? 'Someone'} · <span className="mono">{fmtTime(m.created_at)}</span>
                  </div>
                  <p>{m.body}</p>
                  {task && (
                    <Link className="lk" style={{ marginTop: 6, display: 'inline-block' }} to={`/task/${task.id}`}>
                      {task.id} · {task.title}
                    </Link>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="threadcompose">
        <textarea
          value={body}
          placeholder={`Message ${other.name}…`}
          aria-label={`Message ${other.name}`}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn sm solid" type="button" onClick={send} disabled={!body.trim()}>
          Send
        </button>
      </div>
    </>
  );
}

/* ── Weekly momentum ───────────────────────────────────────────────────── */
function MomentumTile() {
  const meId = useData((_, s) => s.meId);
  const all = useData((ds) => ds.tasks);
  // My momentum, not ours — the other person closing five things should not
  // read on my Home as a productive week.
  const tasks = useMemo(() => myTasks(all, meId), [all, meId]);
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
        <span className="spacer" />
        <TileOpen to="/work" label="Work" />
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
        <span className="spacer" />
        <TileOpen to="/personal" label="Personal" />
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
        <span className="eyebrow">People going quiet — reach out</span>
        <span className="spacer" />
        <TileOpen to="/people" label="People" />
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
        <ChevronRight className="bt-openhint" size={16} strokeWidth={2.2} aria-hidden />
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
            {FOUNDER_TARGET_MINUTES}-minute block
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
        owner_id: store.me.id,
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
