import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Music, Image as ImageIcon, Sparkles, Radar, Wallet, LayoutGrid, CloudSun, Clock3, CalendarDays, Bot } from 'lucide-react';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { CountUp, InfoTip, Modal, useToast } from '../../ui/bits';
import { spring } from '../../ui/motion';
import { daysUntil, fmtDay, inr, todayIso } from '../../lib/dates';
import { myTasks } from '../../lib/workspace';
import { monthlyRunRate, soonestSubscription } from '../../lib/tracker';
import { quoteForDate } from '../../lib/quotes';
import { Donut, MiniBars, VIZ } from '../../ui/viz';
import { isTerminalOrder } from '../../lib/personalOrders';
import { ChevronRight } from 'lucide-react';
import { ResetArrangement } from './tilechrome';
import type { Project } from '../../types';

/* ── One consistent "open full page" affordance, shared with index.tsx.
   Always in the tile header, always a real link — keyboard reachable,
   ≥44px hit area on touch via style.css. ────────────────────────────────── */
export function TileOpen({ to, label }: { to: string; label: string }) {
  return (
    <Link className="bt-openlink" to={to} aria-label={`Open ${label}`} title={`Open ${label}`}>
      <ChevronRight size={16} strokeWidth={2.2} aria-hidden />
    </Link>
  );
}

/* ── the six independent per-user toggles ──────────────────────────────── */
export type WidgetKey =
  | 'song'
  | 'photo'
  | 'worth_knowing'
  | 'life_radar'
  | 'projects_strip'
  | 'money_on_home'
  | 'weather_on_home'
  | 'world_clocks_on_home'
  | 'calendar_on_home';

export const PERSONAL_KEYS: {
  key: WidgetKey;
  label: string;
  hint: string;
  Icon: typeof Music;
}[] = [
  { key: 'song', label: 'Song for today', hint: 'A daily playable pick plus songs either of you suggests', Icon: Music },
  { key: 'photo', label: 'Moments', hint: 'Photos the other one sent, with a reply box', Icon: ImageIcon },
  { key: 'worth_knowing', label: 'AI news', hint: 'Three AI headlines, refreshed twice a day', Icon: Sparkles },
  { key: 'life_radar', label: 'Personal radar', hint: 'Personal admin still open, and the dates that are fixed', Icon: Radar },
  { key: 'projects_strip', label: 'Projects', hint: 'Open counts per project, as small multiples', Icon: LayoutGrid },
  { key: 'money_on_home', label: 'Money on Home', hint: 'In and out as one mark, no table', Icon: Wallet },
  { key: 'calendar_on_home', label: 'Calendar', hint: 'The month, with due dates, blocks and fixed dates on it', Icon: CalendarDays },
  { key: 'weather_on_home', label: 'Weather', hint: 'Weather for a place you choose manually', Icon: CloudSun },
  { key: 'world_clocks_on_home', label: 'World clocks', hint: 'Two time zones you choose', Icon: Clock3 },
];

/** Home utilities arrive switched on and are turned off, rather than the other
 *  way round: they cost nothing to look at, and a profile written before they
 *  existed has no key for them at all. Absent therefore has to mean "on". */
const OPT_OUT = new Set<WidgetKey>(['weather_on_home', 'world_clocks_on_home', 'calendar_on_home']);

/** Compact money label so a number can live inside a donut without wrapping. */
const shortInr = (n: number) => {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${sign}₹${Math.round(a / 1e3)}k`;
  return `${sign}₹${a}`;
};

/* ── Customise popover — writes profiles.personalization for THIS user ─── */
export function CustomiseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const me = useData((_, s) => s.me);
  const toast = useToast();

  const set = (key: WidgetKey, value: boolean) => {
    store.update(
      'profiles',
      me.id,
      { personalization: { ...me.personalization, [key]: value } },
      store.asMe({ summary: `Home layer — ${key} ${value ? 'on' : 'off'}` }),
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Customise your Home">
      <p className="tip" style={{ margin: '-6px 0 8px' }}>
        Yours only. {store.other.name}'s Home is untouched by anything here — this is a preference,
        never a permission. Hiding a tile re-flows the grid; it never leaves a hole.
      </p>
      {PERSONAL_KEYS.map(({ key, label, hint, Icon }) => {
        const on = OPT_OUT.has(key)
          ? me.personalization[key] !== false
          : Boolean(me.personalization[key]);
        return (
          <div className="swrow" key={key}>
            <Icon size={17} strokeWidth={1.7} color="var(--slate)" aria-hidden />
            <span className="txt">
              {label}
              <small>{hint}</small>
            </span>
            <button
              className="sw"
              role="switch"
              aria-checked={on}
              aria-label={label}
              onClick={() => {
                set(key, !on);
                toast(`${label} ${!on ? 'added to' : 'removed from'} your Home`);
              }}
            >
              <motion.span className="knob" layout transition={spring} />
            </button>
          </div>
        );
      })}
      <CompanionSettings />
      <ResetArrangement />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn solid" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

/* ── The companion robot — a per-user preference like everything above.
   Not a PERSONAL_KEY: those drive the Home grid, and the robot is not a
   tile — it floats over every room. ─────────────────────────────────────── */
function CompanionSettings() {
  const store = useStore();
  const me = useData((_, s) => s.me);
  const toast = useToast();

  const comp = me.personalization.companion ?? {};
  const on = comp.enabled !== false;
  const robotName = comp.name?.trim() || 'Vik';

  const patch = (p: Partial<NonNullable<typeof me.personalization.companion>>, summary: string) => {
    store.update(
      'profiles',
      me.id,
      { personalization: { ...me.personalization, companion: { ...comp, ...p } } },
      store.asMe({ summary }),
    );
  };

  return (
    <div style={{ borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 6 }}>
      <div className="swrow">
        <Bot size={17} strokeWidth={1.7} color="var(--slate)" aria-hidden />
        <span className="txt">
          {robotName}, the companion
          <small>
            Greetings, tips and a heads-up about {store.other.name} — plus a robot you can poke,
            pet and fling about
          </small>
        </span>
        <button
          className="sw"
          role="switch"
          aria-checked={on}
          aria-label={`${robotName}, the companion`}
          onClick={() => {
            patch({ enabled: !on }, `Companion — ${!on ? 'on' : 'off'}`);
            toast(!on ? `${robotName} is back in the corner` : `${robotName} has gone home`);
          }}
        >
          <motion.span className="knob" layout transition={spring} />
        </button>
      </div>
      {on && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '2px 0 6px 27px' }}>
          <div className="seg" role="group" aria-label="Chattiness">
            {(['quiet', 'normal', 'chatty'] as const).map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={(comp.chattiness ?? 'normal') === c}
                onClick={() => patch({ chattiness: c }, `Companion — ${c}`)}
              >
                {c[0].toUpperCase() + c.slice(1)}
              </button>
            ))}
          </div>
          <input
            className="srch"
            style={{ maxWidth: 140 }}
            defaultValue={comp.name ?? ''}
            placeholder="Vik"
            maxLength={20}
            aria-label="Rename the robot"
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name !== (comp.name ?? '')) patch({ name }, 'Companion — renamed');
            }}
          />
          {typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches && (
            <button
              className="chip"
              aria-pressed={comp.follow === true}
              onClick={() =>
                patch({ follow: comp.follow !== true }, `Companion — follow ${comp.follow !== true ? 'on' : 'off'}`)
              }
              title="He chases the cursor and parks himself when you stop moving"
            >
              {comp.follow === true ? 'Following your cursor' : 'Stays in the corner'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── AI news — real LLM/AI headlines, filled by the pulse cron ─────────── */
export function WorthTile() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  // Pinned first, then newest. Three, deliberately — this is a briefing, not a feed.
  const items = useMemo(
    () =>
      ds.pulse_items
        .filter((x) => (x.kind ?? 'news') === 'news')
        .sort(
          (a, b) =>
            Number(b.is_pinned) - Number(a.is_pinned) ||
            b.published_at.localeCompare(a.published_at),
        )
        .slice(0, 3),
    [ds.pulse_items],
  );

  /** Whatever dropped most recently across the shows — one line, not a feed. */
  const podcast = useMemo(
    () =>
      ds.pulse_items
        .filter((x) => x.kind === 'podcast')
        .sort((a, b) => b.published_at.localeCompare(a.published_at))[0] ?? null,
    [ds.pulse_items],
  );

  const add = () => {
    const t = title.trim();
    if (!t) return;
    store.insert(
      'pulse_items',
      {
        id: newId('pulse'),
        title: t,
        source: 'Pinned by ' + store.me.name,
        url: url.trim(),
        published_at: nowIso(),
        origin: 'manual',
        is_pinned: true,
        created_at: nowIso(),
      },
      store.asMe({ summary: 'Pinned something worth knowing' }),
    );
    setTitle('');
    setUrl('');
    setAdding(false);
    toast('Pinned to AI news');
  };

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">AI news · updated twice a day</span>
        <div className="spacer" />
        <TileOpen to="/knowledge" label="Notebook" />
        <button type="button" className="btn sm" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : 'Pin one'}
        </button>
      </div>
      {adding && (
        <div className="colgap" style={{ marginBottom: 8 }}>
          <input
            className="srch"
            value={title}
            autoFocus
            placeholder="What's worth knowing?"
            aria-label="Headline"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <input
            className="srch"
            value={url}
            placeholder="Link (optional)"
            aria-label="Link"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn sm solid" onClick={add} disabled={!title.trim()}>
            Pin it
          </button>
        </div>
      )}
      <div className="bt-scroll">
        {items.length === 0 ? (
          <p className="tip" style={{ margin: 0 }}>
            Nothing yet — headlines arrive twice a day, or pin something yourself.
          </p>
        ) : (
          items.map((x) =>
            x.url ? (
              <a className="aiitem" key={x.id} href={x.url} target="_blank" rel="noreferrer">
                <b>{x.title}</b>
                <span>{x.source}</span>
              </a>
            ) : (
              <div className="aiitem" key={x.id}>
                <b>{x.title}</b>
                <span>{x.source}</span>
              </div>
            ),
          )
        )}
      </div>
      {podcast && (
        <a className="pod-row" href={podcast.url || '#'} target="_blank" rel="noreferrer">
          <span className="eyebrow">Podcast this week</span>
          <b>{podcast.title}</b>
          <span className="sub">{podcast.source}</span>
        </a>
      )}
    </>
  );
}

/* ── Life radar ────────────────────────────────────────────────────────── */
export function LifeTile() {
  const ds = useData((d) => d);
  const store = useStore();
  const me = useData((_, s) => s.me);
  const toast = useToast();
  const today = todayIso();

  const lifeOpen = ds.life_admin.filter((l) => l.user_id === me.id && !l.completed);
  const myOrders = ds.personal_orders.filter((order) => order.user_id === me.id);
  const pendingOrders = myOrders.filter((order) => order.review_status === 'pending');
  const activeDeliveries = myOrders.filter(
    (order) => order.review_status === 'confirmed' && order.kind === 'physical' && !isTerminalOrder(order),
  );
  const upcomingTrips = myOrders.filter(
    (order) => order.review_status === 'confirmed' && order.kind === 'travel' && !isTerminalOrder(order),
  );
  const attention = lifeOpen.length + pendingOrders.length + activeDeliveries.length + upcomingTrips.length;
  const upcoming = [...ds.fixed_dates]
    .map((f) => ({ ...f, d: daysUntil(f.date, today) }))
    .filter((f) => f.d >= 0)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Personal radar</span>
        <span className="spacer" />
        <span className="mono bt-num">
          <CountUp value={attention} /> on radar
        </span>
        <TileOpen to="/personal" label="Personal" />
      </div>
      <div className="bt-scroll">
        {attention === 0 && <p className="tip" style={{ marginTop: 0 }}>Personal admin is clear.</p>}
        {pendingOrders.length > 0 && (
          <div className="mini-row">
            <span>Orders to review</span>
            <span className="pill soon">{pendingOrders.length}</span>
          </div>
        )}
        {activeDeliveries.length > 0 && (
          <div className="mini-row">
            <span>Active deliveries</span>
            <span className="pill q">{activeDeliveries.length}</span>
          </div>
        )}
        {upcomingTrips.length > 0 && (
          <div className="mini-row">
            <span>Upcoming trips</span>
            <span className="pill q">{upcomingTrips.length}</span>
          </div>
        )}
        {lifeOpen.map((l) => (
          <button
            className="check"
            key={l.id}
            onClick={() => {
              store.update('life_admin', l.id, { completed: true }, store.asMe({ summary: 'Personal admin ticked' }));
              toast('Ticked off');
            }}
          >
            <span className="bx" aria-hidden />
            <span>{l.item}</span>
          </button>
        ))}
        {upcoming.map((f) => (
          <div className="mini-row" key={f.id}>
            <span>{f.label}</span>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--mute)' }}>
              {fmtDay(f.date)} · {f.d}d
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Money — one mark, one headline number, no table ───────────────────── */
export function MoneyTile() {
  const ds = useData((data) => data);
  const businessProjectIds = new Set(ds.projects.filter((project) => !project.is_personal).map((project) => project.id));
  const ledger = ds.ledger.filter((entry) => businessProjectIds.has(entry.project_id));
  const money = ledger.reduce(
    (a, l) => (l.direction === 'in' ? { ...a, in: a.in + l.amount } : { ...a, out: a.out + l.amount }),
    { in: 0, out: 0 },
  );
  const net = money.in - money.out;

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow feature-label">
          Money
          <InfoTip label="Money" text="Founder contributions and business expenses only; contributions are not revenue." />
        </span>
        <span className="spacer" />
        <TileOpen to="/money" label="Money" />
      </div>
      <div className="donutrow">
        <Donut
          size={82}
          slices={[
            { label: 'Contributions', value: money.in, color: VIZ.in },
            { label: 'Expenses', value: money.out, color: VIZ.out },
          ]}
          centerValue={shortInr(net)}
          centerLabel="balance"
        />
        <div className="viz-legend" style={{ marginTop: 0, flexDirection: 'column', gap: 6 }}>
          <span>
            <i style={{ background: VIZ.in }} />+ <CountUp value={money.in} format={(n) => inr(n)} />
          </span>
          <span>
            <i style={{ background: VIZ.out }} />− <CountUp value={money.out} format={(n) => inr(n)} />
          </span>
        </div>
      </div>
    </>
  );
}

/* ── Quote of the day ──────────────────────────────────────────────────── */
/** Curated, attributed, and the same for both of you on a given day — which
 *  is what makes it something you can bring up rather than wallpaper. */
export function QuoteTile() {
  const q = useMemo(() => quoteForDate(todayIso()), []);
  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Quote of the day</span>
      </div>
      <blockquote className="qt-text">{q.text}</blockquote>
      <div className="qt-who mono">
        — {q.who}
        {q.context && <span className="qt-ctx"> · {q.context}</span>}
      </div>
    </>
  );
}

/* ── Subscription renewing soonest ─────────────────────────────────────── */
/** One number: what charges you next, and when. A renewal that surprises you
 *  has already cost you money. */
export function SubscriptionTile() {
  const ds = useData((d) => d);
  const next = useMemo(() => soonestSubscription(ds), [ds.subscriptions]);
  const rate = useMemo(() => monthlyRunRate(ds), [ds.subscriptions]);
  const days = next?.ends_on ? daysUntil(next.ends_on, todayIso()) : null;

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Renewing next</span>
        <div className="spacer" />
        <TileOpen to="/money" label="Money" />
      </div>
      {next ? (
        <>
          <div className="bignum">
            {days === null ? '—' : days < 0 ? `${-days}d` : days}
            <span>{days === null ? 'no end date' : days < 0 ? 'overdue' : days === 1 ? 'day' : 'days'}</span>
          </div>
          <div
            className="mono"
            style={{
              fontSize: 12,
              color: days !== null && days <= 7 ? 'var(--stamp)' : 'var(--slate)',
            }}
          >
            {next.name} · {inr(next.amount)}
          </div>
          <p className="tip" style={{ marginTop: 6 }}>
            {shortInr(Math.round(rate))} a month across everything active.
          </p>
        </>
      ) : (
        <p className="tip" style={{ marginTop: 0 }}>
          Nothing subscribed. Add one in Money and the next renewal shows up here.
        </p>
      )}
    </>
  );
}

/* ── Projects — small multiples, never four colours in one chart ───────── */
export function ProjectsTile() {
  const ds = useData((d) => d);
  const meId = useData((_, s) => s.meId);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  // Counts are for my workspace — this tile sits on my Home.
  const mine = useMemo(() => myTasks(ds.tasks, meId), [ds.tasks, meId]);
  const items = ds.projects.map((pj) => ({
    id: pj.id,
    label: pj.name,
    value: mine.filter((t) => t.project_id === pj.id && t.status !== 'done').length,
  }));
  const max = Math.max(...items.map((i) => i.value), 1);
  const snapshot = snapshotId ? ds.projects.find((p) => p.id === snapshotId) ?? null : null;

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Open per project</span>
        <span className="spacer" />
        <TileOpen to="/work" label="Work" />
      </div>
      <div className="bt-scroll">
        {items.length ? (
          <div className="viz-minis">
            {items.map((it) => (
              <button
                type="button"
                key={it.id}
                className="viz-mini pj-row"
                onClick={() => setSnapshotId(it.id)}
                aria-label={`Snapshot for ${it.label}`}
                style={{ border: 'none', background: 'none', padding: 0, textAlign: 'left', font: 'inherit', cursor: 'pointer', width: '100%' }}
              >
                <span className="viz-minilabel">{it.label}</span>
                <span className="viz-minitrack">
                  <i style={{ display: 'block', height: '100%', borderRadius: 4, background: 'var(--viz-seq)', width: `${(it.value / max) * 100}%` }} />
                </span>
                <b className="mono">{it.value}</b>
              </button>
            ))}
          </div>
        ) : (
          <p className="tip">No projects yet.</p>
        )}
      </div>
      <ProjectSnapshotModal project={snapshot} onClose={() => setSnapshotId(null)} />
    </>
  );
}

/** On-demand project snapshot — the whole reason to click a bar instead of
 * leaving Home is to see the shape of a project without losing your place. */
function ProjectSnapshotModal({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const ds = useData((d) => d);
  const meId = useData((_, s) => s.meId);
  const open = !!project;
  // Opened from my Home's project bars, so it shows the same slice they count.
  const mine = useMemo(() => myTasks(ds.tasks, meId), [ds.tasks, meId]);
  const openTasks = project ? mine.filter((t) => t.project_id === project.id && t.status !== 'done') : [];
  const doneTasks = project ? mine.filter((t) => t.project_id === project.id && t.status === 'done') : [];
  const openDecisions = project ? ds.decisions.filter((d) => d.project_id === project.id && d.status === 'open') : [];
  const net = project
    ? ds.ledger
        .filter((l) => l.project_id === project.id)
        .reduce((a, l) => a + (l.direction === 'in' ? l.amount : -l.amount), 0)
    : 0;

  return (
    <Modal open={open} onClose={onClose} title={project?.name}>
      {project && (
        <>
          {project.description && <p className="tip" style={{ margin: '-6px 0 12px' }}>{project.description}</p>}
          <div className="donutrow" style={{ marginBottom: 4 }}>
            <MiniBars
              items={[
                { label: 'Open tasks', value: openTasks.length, color: 'var(--viz-1)' },
                { label: 'Done', value: doneTasks.length, color: 'var(--viz-2)' },
                { label: 'Decisions open', value: openDecisions.length, color: 'var(--viz-3)' },
              ]}
            />
          </div>
          <div className="rowgap tight" style={{ marginBottom: 12 }}>
            <span className="mono bt-num" title="Money in minus out, this project">
              {net < 0 ? '−' : ''}
              {inr(Math.abs(net))} net
            </span>
          </div>
          {openTasks.length > 0 && (
            <>
              <span className="eyebrow">Open, most recent first</span>
              <div className="bt-scroll" style={{ maxHeight: 180, marginTop: 6 }}>
                {[...openTasks]
                  .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                  .slice(0, 6)
                  .map((t) => (
                    <Link className="planrow" key={t.id} to={`/task/${t.id}`}>
                      <span className={`echip e-${t.effort}`}>{t.effort}</span>
                      <span className="planttl">{t.title}</span>
                      <span className="mono planmin">{t.progress_pct}%</span>
                    </Link>
                  ))}
              </div>
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn solid" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
