import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, ChevronRight, Plus, RefreshCw, Settings2, Sparkles } from 'lucide-react';
import { newId, nowIso, useData, useStore, type AppStore } from '../../data/store';
import { ensureProjectId } from '../../data/projects';
import { packBento } from '../../lib/bento';
import { Avatar, CountUp, InfoTip, Modal, ProgressBar, SideSheet, useToast } from '../../ui/bits';
import { staggerParent } from '../../ui/motion';
import { daysSinceTs, daysUntil, fmtDay, fmtTime, inr, localDay, todayIso } from '../../lib/dates';
import {
  CAPACITY_MINUTES,
  planDay,
  rankTasks,
  stuckTasks,
  type RankedTask,
} from '../../lib/ranking';
import { isMyTask, myTasks } from '../../lib/workspace';
import { blockedByOpenDep } from '../../lib/schedule';
import { FOUNDER_TARGET_MINUTES, SCOPE_COPY, activeBlockFor, clockLabel, elapsedSec, startBlock } from '../../lib/blocks';
import {
  CAPACITY_COPY,
  eventsFor,
  intentionsFor,
  itemDone,
  itemLabel,
  minToLabel,
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
  QuoteTile,
  SubscriptionTile,
  TileOpen,
  WorthTile,
} from './personal';
import { MomentsTile, SongTile } from './moments';
import { MonthCalendar, type MonthItem } from '../../ui/monthcal';
import { WeatherTile, WorldClockTile } from './utility';
import { arrange } from './layout';
import { BentoTile, TILE_TITLE, TileSheetHost, useHomeArrange } from './tilechrome';
import type { Capacity, DailyCloseout, DayPlan, DayPlanItem, Task } from '../../types';
import {
  describeSync,
  googleAccounts,
  hasLiveGoogleAccount,
  syncLiveGoogleAccounts,
} from '../../lib/googleSync';
import { DictateField } from '../../ui/dictation';
import './style.css';

const CAPACITIES: Capacity[] = ['light', 'medium', 'heavy'];
const STALE_DECISION_DAYS = 7;

const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);
const fullDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
const minsNow = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

/* ── One bento tile: declares how many columns and rows it occupies ────── */
interface Tile {
  key: string;
  cols: 1 | 2 | 3 | 4;
  tall?: boolean;
  cls?: string;
  node: React.ReactNode;
}

type HomeView = 'today' | 'overview';

const TODAY_TILES = new Set([
  'greet',
  'hero',
  'capacity',
  'plan',
  'wins',
  'stuck',
  'ribbon',
  'calendar',
  'ritual',
  'shutdown',
  'close-log',
]);

/* ── Home ──────────────────────────────────────────────────────────────── */
export default function Home() {
  const ds = useData((d) => d);
  const store = useStore();
  const me = useData((_, s) => s.me);
  const toast = useToast();
  const today = todayIso();

  // The ribbon's "now" marker is recomputed each minute.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setTick((x) => x + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const [customising, setCustomising] = useState(false);
  const [addingBlock, setAddingBlock] = useState(false);
  const [customBlockOpen, setCustomBlockOpen] = useState(false);
  const [closeDayToken, setCloseDayToken] = useState(0);
  const [view, setView] = useState<HomeView>('today');

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
  const businessProjectIds = new Set(ds.projects.filter((project) => !project.is_personal).map((project) => project.id));
  const runway = ds.ledger
    .filter((entry) => businessProjectIds.has(entry.project_id))
    .reduce((total, entry) => total + (entry.direction === 'in' ? entry.amount : -entry.amount), 0);

  /* ── tile inventory. Order is packing order; dense flow backfills. ── */
  const tiles: Tile[] = [
    {
      key: 'greet',
      cols: 4,
      node: (
        <GreetTile
          name={me.name}
          plannedMin={plannedMin}
          blocks={events.length}
          runway={runway}
          nextFixed={nextFixed ? { label: nextFixed.label, days: daysUntil(nextFixed.date, today) } : null}
          stale={staleDecisions.length}
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
    ...(p.calendar_on_home !== false
      ? [{ key: 'calendar', cols: 2 as const, tall: true, node: <CalendarTile /> }]
      : []),
    {
      key: 'ritual',
      cols: 2,
      node: <NextMoveTile top={top} onFocus={beginFounderBlock} />,
    },
    { key: 'shutdown', cols: 2, node: <CloseDayTile openToken={closeDayToken} /> },
    { key: 'close-log', cols: 4, node: <CloseLogTile /> },
    { key: 'pulse', cols: 2, node: <PulseTile /> },
    { key: 'thread', cols: 2, tall: true, node: <ThreadTile /> },
  ];

  if (p.photo) tiles.push({ key: 'photo', cols: 2, node: <MomentsTile /> });
  if (p.song) tiles.push({ key: 'song', cols: 2, node: <SongTile /> });
  if (p.weather_on_home !== false) tiles.push({ key: 'weather', cols: 2, node: <WeatherTile /> });
  if (p.world_clocks_on_home !== false) tiles.push({ key: 'clocks', cols: 2, node: <WorldClockTile /> });

  if (p.worth_knowing) tiles.push({ key: 'worth', cols: 2, node: <WorthTile /> });
  if (p.life_radar) tiles.push({ key: 'life', cols: 2, node: <LifeTile /> });
  tiles.push({ key: 'warmth', cols: 2, node: <WarmthTile /> });
  tiles.push({ key: 'momentum', cols: 1, node: <MomentumTile /> });
  tiles.push({ key: 'split', cols: 1, node: <SplitTile /> });
  if (p.money_on_home) tiles.push({ key: 'money', cols: 1, node: <MoneyTile /> });
  tiles.push({ key: 'subs', cols: 1, node: <SubscriptionTile /> });
  tiles.push({ key: 'quote', cols: 1, node: <QuoteTile /> });
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
  const allLaid = arrange(
    tiles.map((t) => ({ ...t, cols: t.cols as number, rows: t.tall ? 2 : 1 })),
    arrangeApi.layout,
  );
  // Keep one arrangement across the two faces of Home. Dragging a tile in one
  // view must not discard the order of the tiles currently hidden in the
  // other view, so the arrangement hook always receives the complete key list.
  arrangeApi.syncKeys(allLaid.map((t) => t.key));
  const laid = allLaid.filter((t) =>
    view === 'today' ? TODAY_TILES.has(t.key) : !TODAY_TILES.has(t.key),
  );

  const { rc4, rc2 } = useMemo(
    () => packBento(laid.map((t) => ({ key: t.key, cols: t.cols, rows: t.rows }))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [laid.map((t) => `${t.key}:${t.cols}x${t.rows}`).join(',')],
  );

  return (
    <div className="home-screen">
      <div className="home-viewbar">
        <div>
          <div className="disp feature-label">
            Home
            <InfoTip
              label={view === 'today' ? 'Today' : 'Overview'}
              text={
                view === 'today'
                  ? 'Choose the day, do the work, and close it properly.'
                  : 'The wider picture across work, people, personal life, money and the two of you.'
              }
            />
          </div>
        </div>
        <div className="home-viewtabs" role="tablist" aria-label="Home sections">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'today'}
            onClick={() => setView('today')}
          >
            Today
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'overview'}
            onClick={() => setView('overview')}
          >
            Overview
          </button>
        </div>
        {view === 'today' && (
          <>
            <button className="btn sm" type="button" onClick={() => setCustomBlockOpen(true)}>
              Start custom block
            </button>
            <button
              className="btn sm solid"
              type="button"
              onClick={() => setCloseDayToken((token) => token + 1)}
            >
              Close day
            </button>
          </>
        )}
        <button className="chip" type="button" onClick={() => setCustomising(true)}>
          <Settings2 size={13} strokeWidth={1.8} aria-hidden />
          Customise
        </button>
      </div>
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
      <CustomBlockModal open={customBlockOpen} onClose={() => setCustomBlockOpen(false)} />
      {/* The block overlay itself is mounted app-wide in App.tsx — a block is a
          state the whole portal is in, not a thing that lives on Home. */}
    </div>
  );
}

/* ── Greeting + quick capture, all in one compact band ────────────────── */
function GreetTile({
  name,
  plannedMin,
  blocks,
  runway,
  nextFixed,
  stale,
}: {
  name: string;
  plannedMin: number;
  blocks: number;
  runway: number;
  nextFixed: { label: string; days: number } | null;
  stale: number;
}) {
  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">{fullDate()}</span>
      </div>
      <div className="greetrow">
        <h1>Hello, {name}.</h1>
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
        <span className="amb feature-label">
          <b>
            {runway < 0 ? '−' : ''}
            <CountUp value={Math.abs(runway)} format={(n) => inr(n)} />
          </b>{' '}
          contribution balance
          <InfoTip
            label="Contribution balance"
            text="Founder contributions minus business expenses. Personal projects, revenue, and profit are not included."
          />
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

      <DictateField label="Dictate an intention">
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
      </DictateField>
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
            accountLabel: e.account_email,
          }))}
          nowMin={minsNow()}
          onPick={(id) => {
            const ev = events.find((x) => x.id === id);
            if (ev?.task_id) navigate(`/task/${ev.task_id}`);
            else if (ev?.source_url) window.open(ev.source_url, '_blank', 'noopener,noreferrer');
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

/* ── the month ─────────────────────────────────────────────────────────────
   The ribbon above answers "what is today". This answers "what is the month",
   which is the question the ribbon cannot be stretched to cover without
   becoming a calendar — so it is one, in the smallest form that still reads.

   Nothing here is a second copy of anything: due dates come off the tasks
   table, blocks and synced Google events off day_events, fixed dates off
   fixed_dates, and every row links back to where it actually lives. */
function CalendarTile() {
  const ds = useData((d) => d);
  const store = useStore();
  const meId = store.meId;
  const toast = useToast();
  const navigate = useNavigate();
  const [syncing, setSyncing] = useState(false);
  const connected = googleAccounts(store).filter((account) => account.is_active !== false);
  const live = connected.filter((account) => hasLiveGoogleAccount(account.id));

  const syncCalendar = async () => {
    if (!live.length) {
      navigate('/admin?tab=connections');
      return;
    }
    setSyncing(true);
    try {
      toast(describeSync(await syncLiveGoogleAccounts(store)));
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Google Calendar sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const items = useMemo(() => {
    const out: MonthItem[] = [];
    for (const t of myTasks(ds.tasks, meId)) {
      if (!t.due_date || t.status === 'done') continue;
      out.push({ id: `t-${t.id}`, date: t.due_date, label: t.title, tone: 'task', to: `/task/${t.id}` });
    }
    for (const e of ds.day_events) {
      // Shared events belong on both calendars; the other person's do not.
      if (e.user_id !== null && e.user_id !== meId) continue;
      out.push({
        id: `e-${e.id}`,
        date: e.date,
        label: e.label,
        meta: minToLabel(e.start_min),
        tone: 'event',
        to: e.task_id ? `/task/${e.task_id}` : undefined,
      });
    }
    for (const f of ds.fixed_dates) {
      if (f.owner_id && f.owner_id !== meId) continue;
      out.push({ id: `f-${f.id}`, date: f.date, label: f.label, tone: 'date' });
    }
    return out;
  }, [ds.tasks, ds.day_events, ds.fixed_dates, meId]);

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Calendar</span>
        <span className="spacer" />
        {connected.length > 0 && (
          <button type="button" className="btn sm" onClick={syncCalendar} disabled={syncing}>
            <RefreshCw size={12} strokeWidth={2} aria-hidden />
            {syncing ? 'Syncing…' : live.length ? 'Sync now' : 'Reconnect to sync'}
          </button>
        )}
        <TileOpen to="/work" label="Work calendar" />
      </div>
      <div className="bt-mid">
        <MonthCalendar
          items={items}
          upcoming={3}
          fit
          openTo="/work"
          openLabel="Open the full calendar"
          emptyText="Nothing dated yet. Due dates, blocks and fixed dates all land here."
        />
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

  const liveBlock = activeBlockFor(ds, other.id);
  const [, setPresenceTick] = useState(0);
  useEffect(() => {
    if (!liveBlock || liveBlock.paused_at) return;
    const timer = window.setInterval(() => setPresenceTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [liveBlock?.id, liveBlock?.paused_at]);

  const theirs = ds.tasks
    .filter((t) => t.assignee_id === other.id && t.status !== 'done')
    .sort((a, b) => {
      const active = Number(b.status === 'in_progress') - Number(a.status === 'in_progress');
      return active || b.updated_at.localeCompare(a.updated_at);
    })[0];
  const focusTask = liveBlock?.focus_task_id
    ? ds.tasks.find((task) => task.id === liveBlock.focus_task_id)
    : null;
  const statusValid = Boolean(
    other.status_text &&
      (!other.status_expires_at || new Date(other.status_expires_at).getTime() > Date.now()),
  );
  const primary = liveBlock
    ? `${SCOPE_COPY[liveBlock.scope].label}${liveBlock.paused_at ? ' · paused' : ` · ${clockLabel(elapsedSec(liveBlock))}`}`
    : theirs?.status === 'in_progress'
      ? `In progress · ${theirs.title}`
      : statusValid
        ? other.status_text!
        : 'No live update right now';

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
        <span className={`pulsedot${liveBlock ? ' live' : ''}`} aria-hidden />
        <b>{primary}</b>
      </div>
      {liveBlock && focusTask && <p className="pulsestatus">Focused on {focusTask.id} · {focusTask.title}</p>}
      {(liveBlock || theirs?.status === 'in_progress') && statusValid && (
        <p className="pulsestatus">Shared status: {other.status_text}</p>
      )}
      {theirs && (
        <>
          <p className="pulsestatus">{theirs.status === 'in_progress' ? 'Active task:' : 'Latest task:'}</p>
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
                  <p>
                    {m.kind === 'photo'
                      ? m.body || 'Shared a photo'
                      : m.kind === 'song'
                        ? `Suggested a song · ${m.song_ref?.title || 'Untitled song'}`
                        : m.body}
                  </p>
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
        <DictateField label="Dictate this message">
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
        </DictateField>
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
    // Local days, and rows bucketed by their local day: a task closed at 04:00
    // in Delhi belongs to today's column, the same day the plan and the
    // closeout put it on. Stepping a local Date and reading it back with
    // toISOString() gave UTC days instead, so the whole week sat one column
    // behind the reader's until half past five in the morning.
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(todayIso(d));
    }
    const vals = days.map(
      (d) => tasks.filter((t) => t.status === 'done' && localDay(t.updated_at) === d).length,
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

/* ── One useful action, independent of the clock ───────────────────────── */
function NextMoveTile({
  top,
  onFocus,
}: {
  top?: RankedTask;
  onFocus: (id: string) => void;
}) {
  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Next move</span>
      </div>
      <p className="modecopy">
        {top ? top.task.title : 'The business board is clear.'}
      </p>
      <div className="rowgap">
        {top && (
          <button className="btn solid" onClick={() => onFocus(top.task.id)}>
            Start a {FOUNDER_TARGET_MINUTES}-minute block
          </button>
        )}
        <Link className="btn sm" to="/work">
          Open the board
        </Link>
      </div>
    </>
  );
}

/* ── Close day → daily_closeouts ───────────────────────────────────────── */
type ShutdownItem =
  | { key: string; kind: 'task'; id: string; title: string; hint: string }
  | { key: string; kind: 'decision'; id: string; title: string; hint: string }
  | { key: string; kind: 'plan'; id: string; title: string; hint: string }
  | { key: string; kind: 'checklist'; id: string; index: number; title: string; hint: string };

function CloseDayTile({ openToken = 0 }: { openToken?: number }) {
  const ds = useData((d) => d);
  const store = useStore();
  const me = useData((_, s) => s.me);
  const toast = useToast();
  const today = todayIso();

  const existing = ds.daily_closeouts.find((c) => c.user_id === me.id && c.date === today);
  const [open, setOpen] = useState(false);
  const [shipped, setShipped] = useState(existing?.shipped ?? '');
  const [stuck, setStuck] = useState(existing?.stuck ?? '');
  const [tomorrow, setTomorrow] = useState(existing?.tomorrow ?? '');

  useEffect(() => {
    if (openToken > 0) setOpen(true);
  }, [openToken]);

  /* Shutdown is where a loose end becomes a real state change, not a line of
     wishful text. Notes themselves are records, but their checklist items are
     executable work and can therefore close here too. */
  const looseEnds = useMemo<ShutdownItem[]>(() => {
    const tasks = myTasks(ds.tasks, me.id)
      .filter((task) => task.status !== 'done')
      .map((task) => ({
        key: `task:${task.id}`,
        kind: 'task' as const,
        id: task.id,
        title: task.title,
        hint: 'Task → Done',
      }));
    const decisions = ds.decisions
      .filter((decision) => decision.owner_id === me.id && decision.status === 'open')
      .map((decision) => ({
        key: `decision:${decision.id}`,
        kind: 'decision' as const,
        id: decision.id,
        title: decision.question,
        hint: 'Decision → Ruled',
      }));
    const plan = ds.day_plan_items
      .filter((item) => item.user_id === me.id && item.date === today && !item.done && !item.task_id)
      .map((item) => ({
        key: `plan:${item.id}`,
        kind: 'plan' as const,
        id: item.id,
        title: item.text,
        hint: 'Today → Done',
      }));
    const checklist = ds.notes.flatMap((note) =>
      note.created_by !== me.id
        ? []
        : (note.checklist ?? [])
            .map((item, index) => ({ item, index }))
            .filter(({ item }) => !item.done)
            .map(({ item, index }) => ({
              key: `checklist:${note.id}:${index}`,
              kind: 'checklist' as const,
              id: note.id,
              index,
              title: item.text,
              hint: `${note.title || 'Scribble'} → Done`,
            })),
    );
    return [...tasks, ...decisions, ...plan, ...checklist];
  }, [ds.day_plan_items, ds.decisions, ds.notes, ds.tasks, me.id, today]);

  const completeLooseEnd = (item: ShutdownItem) => {
    if (item.kind === 'task') {
      store.update(
        'tasks',
        item.id,
        { status: 'done', progress_pct: 100 },
        store.asMe({ summary: `Closed in shutdown — ${item.title}` }),
      );
    }
    if (item.kind === 'decision') {
      const decision = ds.decisions.find((row) => row.id === item.id);
      store.update(
        'decisions',
        item.id,
        {
          status: 'ruled',
          ruled_at: nowIso(),
          ruling_note: decision?.recommendation || 'Resolved during shutdown.',
        },
        store.asMe({ summary: `Ruled in shutdown — ${item.title}` }),
      );
    }
    if (item.kind === 'plan') {
      store.update(
        'day_plan_items',
        item.id,
        { done: true },
        store.asMe({ summary: `Completed today line — ${item.title}` }),
      );
    }
    if (item.kind === 'checklist') {
      const note = ds.notes.find((row) => row.id === item.id);
      if (note?.checklist) {
        store.update(
          'notes',
          item.id,
          {
            checklist: note.checklist.map((check, index) =>
              index === item.index ? { ...check, done: true } : check,
            ),
          },
          store.asMe({ summary: `Completed notebook checklist item — ${item.title}` }),
        );
      }
    }
    toast(`Closed: ${item.title}`);
  };

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
    setOpen(false);
    toast('Day closed. Tomorrow starts lighter.');
  };

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Close the day · 2 minutes</span>
        <span className="spacer" />
        <span className="dots" aria-label={`${streak} day streak`}>
          {Array.from({ length: 7 }, (_, i) => (
            <i key={i} className={i < streak ? 'on' : ''} />
          ))}
        </span>
      </div>
      <div className="shutdown-launcher">
        <div className="shutdown-launcher-copy">
          <b>{existing ? 'Today is closed.' : 'End with a clean record.'}</b>
          <p>
            {existing
              ? 'Review the record or adjust tomorrow’s first move.'
              : 'Log the finish, name what remains, and set tomorrow’s first move.'}
          </p>
        </div>
        <div className="shutdown-launcher-meta">
          <span>{looseEnds.length ? `${looseEnds.length} loose ends` : 'No loose ends'}</span>
          {existing && <span className="shutdown-closed">Closed ✓</span>}
        </div>
        <button className="btn solid" type="button" onClick={() => setOpen(true)}>
          {existing ? 'Review close' : 'Close day'}
        </button>
      </div>
      <SideSheet
        open={open}
        onClose={() => setOpen(false)}
        title={existing ? 'Review today’s close' : 'Close the day'}
        subtitle="A short record of what moved, what is still real, and what matters first tomorrow."
        footer={
          <>
            <button className="btn sm" type="button" onClick={() => setOpen(false)}>
              Keep editing
            </button>
            <button className="btn solid" type="button" onClick={save}>
              {existing ? 'Save changes' : 'Close the day'}
            </button>
          </>
        }
      >
        <div className="rit shutdown-sheet">
          <label htmlFor="rit-shipped">What shipped</label>
          <DictateField label="Dictate what shipped">
            <textarea
              id="rit-shipped"
              rows={3}
              value={shipped}
              onChange={(e) => setShipped(e.target.value)}
              placeholder="The work, choice, or moment that moved today."
            />
          </DictateField>
          <label htmlFor="rit-stuck">What's stuck, honestly</label>
          <DictateField label="Dictate what is stuck">
            <textarea
              id="rit-stuck"
              rows={3}
              value={stuck}
              onChange={(e) => setStuck(e.target.value)}
              placeholder="Name it clearly so it does not follow you around vaguely."
            />
          </DictateField>
          <label htmlFor="rit-tomorrow">Tomorrow's one thing</label>
          <DictateField label="Dictate tomorrow's one thing">
            <textarea
              id="rit-tomorrow"
              rows={2}
              value={tomorrow}
              onChange={(e) => setTomorrow(e.target.value)}
              placeholder="The first meaningful move."
            />
          </DictateField>
          <section className="rit-loose" aria-label="Close loose ends">
            <div className="rit-loose-head">
              <label>Close loose ends</label>
              <span className="mono">{looseEnds.length} open</span>
            </div>
            <p>
              Close the real thing here. Tasks move to Done, decisions to Ruled, and checklist
              lines stay checked in the Notebook.
            </p>
            {looseEnds.length ? (
              <div className="rit-loose-list">
                {looseEnds.map((item) => (
                  <button
                    key={item.key}
                    className="rit-loose-row"
                    type="button"
                    onClick={() => completeLooseEnd(item)}
                    aria-label={`Close ${item.title}`}
                  >
                    <span className="rit-loose-tick" aria-hidden />
                    <span className="rit-loose-copy">
                      <b>{item.title}</b>
                      <small>{item.hint}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="rit-loose-clear">No open tasks, decisions, or checklist lines to close.</p>
            )}
          </section>
        </div>
      </SideSheet>
    </>
  );
}

function CloseLogTile() {
  const ds = useData((d) => d);
  const me = useData((_, s) => s.me);
  const [open, setOpen] = useState(false);
  const rows = useMemo(
    () =>
      ds.daily_closeouts
        .filter((row) => row.user_id === me.id)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [ds.daily_closeouts, me.id],
  );
  const closeout = rows[0];

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Close log</span>
        <span className="spacer" />
        {closeout && <span className="mono">Latest · {fmtDay(closeout.date)}</span>}
        <button className="btn sm" type="button" onClick={() => setOpen(true)}>
          View history
        </button>
      </div>
      {closeout ? (
        <div className="closeout-recap" aria-label={`Close log for ${closeout.date}`}>
          <CloseoutRecap label="Shipped" value={closeout.shipped} empty="Nothing logged." />
          <CloseoutRecap label="Still real" value={closeout.stuck} empty="Nothing marked stuck." />
          <CloseoutRecap label="Next first move" value={closeout.tomorrow} empty="No first move chosen." />
        </div>
      ) : (
        <div className="closeout-recap-empty">
          <b>No close logs yet.</b>
          <p>Close today once and the record will remain available here, regardless of the time.</p>
        </div>
      )}
      <SideSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Close log"
        subtitle="Your day-close records, newest first. These are history, not another task list."
        footer={
          <button className="btn solid" type="button" onClick={() => setOpen(false)}>
            Done
          </button>
        }
      >
        <div className="closeout-history">
          {rows.slice(0, 30).map((row) => (
            <CloseoutHistoryRow key={row.id} row={row} />
          ))}
          {rows.length === 0 && <p className="tip">No days have been closed yet.</p>}
        </div>
      </SideSheet>
    </>
  );
}

function CloseoutHistoryRow({ row }: { row: DailyCloseout }) {
  return (
    <article className="closeout-history-row">
      <div className="closeout-history-date">
        <b>{fmtDay(row.date)}</b>
        <span className="mono">{row.date}</span>
      </div>
      <CloseoutRecap label="Shipped" value={row.shipped} empty="Nothing logged." />
      <CloseoutRecap label="Still real" value={row.stuck} empty="Nothing marked stuck." />
      <CloseoutRecap label="Next first move" value={row.tomorrow} empty="No first move chosen." />
    </article>
  );
}

function CloseoutRecap({ label, value, empty }: { label: string; value: string; empty: string }) {
  return (
    <div className="closeout-recap-item">
      <span>{label}</span>
      <p>{value || empty}</p>
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
    /* Quick capture exists so a thought is never lost. It used to return
       silently when no project existed, which threw the typed text away —
       invisible, and worst at exactly the moment a workspace is new. Make
       somewhere for it to land instead. */
    const defaultProject = ensureProjectId(store, projects);
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
    toast('Captured as a scribble in the Notebook');
  };

  return (
    <div className="capture">
      <DictateField label="Capture by voice" className="grow">
        <input
          className="srch"
          value={text}
          aria-label="Quick capture"
          placeholder="Empty your head — one line becomes a scribble"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </DictateField>
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

function CustomBlockModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [minutes, setMinutes] = useState(25);
  const [kind, setKind] = useState<'founder' | 'study' | 'personal'>('founder');
  const [checklist, setChecklist] = useState('');

  const begin = () => {
    const name = label.trim();
    if (!name || minutes < 1) return;
    const items = checklist
      .split('\n')
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ id: newId('bci'), text, done: false }));
    const started = startBlock(store, 'custom', {
      customLabel: name,
      customItems: items,
      targetMinutes: minutes,
      logKind: kind,
    });
    if (!started) {
      toast('A block is already running. End or discard it first.');
      return;
    }
    setLabel('');
    setChecklist('');
    setMinutes(25);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Start a custom block">
      <p className="tip">
        Give this block any duration, scribble a temporary checklist, and choose where its time is logged.
      </p>
      <label className="eyebrow" htmlFor="custom-block-label">What are you doing?</label>
      <input
        id="custom-block-label"
        className="srch"
        style={{ width: '100%', margin: '6px 0 12px' }}
        value={label}
        autoFocus
        placeholder="Prepare the investor update"
        onChange={(event) => setLabel(event.target.value)}
      />
      <div className="blkgrid">
        <div>
          <label className="eyebrow" htmlFor="custom-block-minutes">Minutes</label>
          <input
            id="custom-block-minutes"
            className="srch"
            type="number"
            min={1}
            max={480}
            value={minutes}
            onChange={(event) => setMinutes(Math.max(1, Number(event.target.value) || 1))}
          />
        </div>
        <div>
          <label className="eyebrow" htmlFor="custom-block-kind">Log as</label>
          <select
            id="custom-block-kind"
            className="srch"
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
          >
            <option value="founder">Founder work</option>
            <option value="study">Study</option>
            <option value="personal">Personal</option>
          </select>
        </div>
      </div>
      <label className="eyebrow" htmlFor="custom-block-checklist" style={{ display: 'block', marginTop: 12 }}>
        Scratch checklist · one item per line
      </label>
      <DictateField label="Dictate the checklist">
        <textarea
          id="custom-block-checklist"
          className="srch"
          rows={6}
          style={{ width: '100%', marginTop: 6, resize: 'vertical' }}
          value={checklist}
          placeholder={'Draft the outline\nCheck the figures\nSend it'}
          onChange={(event) => setChecklist(event.target.value)}
        />
      </DictateField>
      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn solid" disabled={!label.trim() || minutes < 1} onClick={begin}>
          Start block
        </button>
      </div>
    </Modal>
  );
}
