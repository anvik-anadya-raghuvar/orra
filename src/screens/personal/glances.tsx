/**
 * Glances — what a Personal widget shows while it is a tile.
 *
 * A tile used to hold the full working widget, clipped to fit, which meant
 * scrollbars inside tiles, add-forms cut in half, and wheel events stolen
 * from the page. The deal is now explicit:
 *
 *   the TILE is a glance   — a designed, fixed-shape summary. View only.
 *   the SIDE PAGE works    — every list, form, and button, at full height.
 *
 * Each glance is at most a headline number and three rows, so it can never
 * outgrow its box: nothing here scrolls, nothing is ever cut mid-control,
 * and the page underneath keeps the wheel.
 */
import React, { useEffect, useState } from 'react';
import { useData, useStore } from '../../data/store';
import { daysUntil, fmtDay, todayIso } from '../../lib/dates';
import { myTasks, ownRows } from '../../lib/workspace';
import { goalProgress, goalsFor, progressLabel } from '../../lib/goals';
import { SCOPE_COPY, activeBlockFor, clockLabel, elapsedSec } from '../../lib/blocks';
import { isTerminalOrder } from '../../lib/personalOrders';

/* ── shared frame ──────────────────────────────────────────────────────── */

function Shell({
  title,
  stat,
  statLabel,
  children,
}: {
  title: string;
  stat?: string | number;
  statLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pgl">
      <div className="pgl-hd">
        <h3>{title}</h3>
        {stat !== undefined && (
          <span className="pgl-stat">
            <b className="mono">{stat}</b>
            {statLabel && <small>{statLabel}</small>}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function Row({
  main,
  meta,
  pct,
  off,
}: {
  main: string;
  meta?: string;
  /** 0–100 renders a thin progress bar under the text. */
  pct?: number;
  off?: boolean;
}) {
  return (
    <div className="pgl-row">
      <span className={`pgl-main${off ? ' off' : ''}`}>{main}</span>
      {meta && <span className="pgl-meta mono">{meta}</span>}
      {pct !== undefined && (
        <span className="pgl-bar" aria-hidden>
          <i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} />
        </span>
      )}
    </div>
  );
}

const None = ({ children }: { children: React.ReactNode }) => (
  <p className="pgl-none">{children}</p>
);

/* ── one glance per widget ─────────────────────────────────────────────── */

export function TasksGlance() {
  const ds = useData((d) => d);
  const meId = useData((_, s) => s.meId);
  const personal = new Set(ds.projects.filter((p) => p.is_personal).map((p) => p.id));
  const rows = myTasks(ds.tasks, meId)
    .filter((t) => personal.has(t.project_id) && t.status !== 'done')
    .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  return (
    <Shell title="Personal tasks" stat={rows.length} statLabel="open">
      {rows.slice(0, 3).map((t) => (
        <Row key={t.id} main={t.title} meta={t.due_date ? fmtDay(t.due_date) : undefined} />
      ))}
      {rows.length === 0 && <None>Nothing personal open.</None>}
    </Shell>
  );
}

export function GoalsGlance() {
  const ds = useData((d) => d);
  const meId = useData((_, s) => s.meId);
  const goals = goalsFor(ds, meId).filter((g) => g.status === 'open');
  return (
    <Shell title="Goals" stat={goals.length} statLabel="open">
      {goals.slice(0, 2).map((g) => {
        const p = goalProgress(ds, g);
        return <Row key={g.id} main={g.title} meta={progressLabel(p)} pct={p.pct} />;
      })}
      {goals.length === 0 && <None>No goals yet — open to add the first one.</None>}
    </Shell>
  );
}

export function BlocksGlance() {
  const ds = useData((d) => d);
  const store = useStore();
  const block = activeBlockFor(ds, store.meId);
  // The one moving part in any glance: a running block's clock ticks. Derived
  // from started_at every second, never counted — same rule as the overlay.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!block || block.paused_at) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [block?.id, block?.paused_at]);

  return (
    <Shell title="Blocks">
      {block ? (
        <>
          <div className="pgl-clock mono">{clockLabel(elapsedSec(block))}</div>
          <Row
            main={`${SCOPE_COPY[block.scope].label}${block.paused_at ? ' — paused' : ' — running'}`}
          />
        </>
      ) : (
        <>
          <Row main="Study block" meta="freeze + timer" />
          <Row main="Personal block" meta="freeze + timer" />
          <None>Nothing running. Open to start one.</None>
        </>
      )}
    </Shell>
  );
}

export function LifeAdminGlance() {
  const ds = useData((d) => d);
  const store = useStore();
  const open = ds.life_admin.filter((l) => l.user_id === store.meId && !l.completed);
  return (
    <Shell title="Personal admin" stat={open.length} statLabel="to do">
      {open.slice(0, 3).map((l) => (
        <Row key={l.id} main={l.item} />
      ))}
      {open.length === 0 && <None>All clear.</None>}
    </Shell>
  );
}

export function OrdersGlance() {
  const ds = useData((d) => d);
  const meId = useData((_, s) => s.meId);
  const mine = ds.personal_orders.filter((order) => order.user_id === meId);
  const review = mine.filter((order) => order.review_status === 'pending');
  const active = mine
    .filter((order) => order.review_status === 'confirmed' && !isTerminalOrder(order))
    .sort((a, b) => (a.next_event_at ?? '9999').localeCompare(b.next_event_at ?? '9999'));

  return (
    <Shell title="Orders & travel" stat={review.length} statLabel="to review">
      {active.slice(0, 2).map((order) => (
        <Row
          key={order.id}
          main={order.summary}
          meta={order.kind === 'travel' ? 'trip' : order.lifecycle_status.replace(/_/g, ' ')}
        />
      ))}
      {review.slice(0, Math.max(1, 3 - active.length)).map((order) => (
        <Row key={order.id} main={order.summary} meta="review" />
      ))}
      {mine.length === 0 && <None>No orders or bookings tracked.</None>}
    </Shell>
  );
}

export function CoursesGlance() {
  const ds = useData((d) => d);
  const meId = useData((_, s) => s.meId);
  const courses = ownRows(ds.courses, meId).sort((a, b) => a.position - b.position);
  return (
    <Shell title="Courses" stat={courses.length} statLabel="running">
      {courses.slice(0, 3).map((c) => {
        const items = ds.course_items.filter((ci) => ci.course_id === c.id);
        const done = items.filter((i) => i.completed).length;
        const pct = items.length ? Math.round((done / items.length) * 100) : 0;
        return <Row key={c.id} main={c.title} meta={`${pct}%`} pct={pct} />;
      })}
      {courses.length === 0 && <None>No courses yet.</None>}
    </Shell>
  );
}

export function ReadingGlance() {
  const ds = useData((d) => d);
  const meId = useData((_, s) => s.meId);
  const rows = ownRows(ds.reading_queue, meId);
  const current = rows.find((r) => r.status === 'reading');
  const queued = rows.filter((r) => r.status === 'queued');
  return (
    <Shell title="Reading queue" stat={queued.length} statLabel="queued">
      {current && <Row main={current.title} meta="reading now" />}
      {queued.slice(0, current ? 2 : 3).map((r) => (
        <Row key={r.id} main={r.title} meta="queued" />
      ))}
      {rows.length === 0 && <None>Nothing queued.</None>}
    </Shell>
  );
}

/** ISO date n days back, local calendar. */
const daysBack = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return todayIso(d);
};

export function RhythmGlance() {
  const ds = useData((d) => d);
  const store = useStore();
  const since = daysBack(6);
  const mine = ds.time_logs.filter((t) => t.user_id === store.meId && t.date >= since);
  const sum = (kind: string) =>
    mine.filter((t) => t.kind === kind).reduce((a, t) => a + t.minutes, 0);
  const study = sum('study');
  const founder = sum('founder');
  const total = study + founder;
  const h = (m: number) => `${(m / 60).toFixed(1)}h`;
  return (
    <Shell title="Study rhythm" stat={h(total)} statLabel="this week">
      <Row main="Study" meta={h(study)} pct={total ? (study / total) * 100 : 0} />
      <Row main="Founder" meta={h(founder)} pct={total ? (founder / total) * 100 : 0} />
      {total === 0 && <None>No blocks logged in the last 7 days.</None>}
    </Shell>
  );
}

export function LedgerGlance() {
  const ds = useData((d) => d);
  const store = useStore();
  const since = daysBack(6);
  const mine = ds.time_logs.filter((t) => t.user_id === store.meId);
  const week = mine.filter((t) => t.date >= since).reduce((a, t) => a + t.minutes, 0);
  const last = [...mine].sort(
    (a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)),
  );
  return (
    <Shell title="Time ledger" stat={`${(week / 60).toFixed(1)}h`} statLabel="this week">
      {last.slice(0, 3).map((t) => (
        <Row key={t.id} main={`${t.kind} · ${t.minutes} min`} meta={fmtDay(t.date)} />
      ))}
      {last.length === 0 && <None>No hours logged yet.</None>}
    </Shell>
  );
}

export function DatesGlance() {
  const ds = useData((d) => d);
  const upcoming = [...ds.fixed_dates]
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((f) => daysUntil(f.date) >= 0);
  const hero = upcoming[0];
  return (
    <Shell
      title="Fixed dates"
      stat={hero ? daysUntil(hero.date) : undefined}
      statLabel={hero ? 'days left' : undefined}
    >
      {hero && <Row main={hero.label} meta={fmtDay(hero.date)} />}
      {upcoming.slice(1, 3).map((f) => (
        <Row key={f.id} main={f.label} meta={`${daysUntil(f.date)}d · ${fmtDay(f.date)}`} />
      ))}
      {upcoming.length === 0 && <None>Nothing on the horizon.</None>}
    </Shell>
  );
}

export function DocsGlance() {
  const docs = useData((d) => d.documents.filter((x) => x.project_id === 'personal'));
  const dated = docs
    .filter((d) => d.expiry_date)
    .sort((a, b) => (a.expiry_date as string).localeCompare(b.expiry_date as string));
  return (
    <Shell title="Relocation documents" stat={docs.length} statLabel="tracked">
      {dated.slice(0, 3).map((d) => (
        <Row
          key={d.id}
          main={d.title}
          meta={`${daysUntil(d.expiry_date as string)}d · ${fmtDay(d.expiry_date as string)}`}
        />
      ))}
      {docs.length === 0 && <None>Nothing tracked yet.</None>}
    </Shell>
  );
}
