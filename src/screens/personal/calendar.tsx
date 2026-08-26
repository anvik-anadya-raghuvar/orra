/**
 * Personal's month.
 *
 * Personal already knows four different things that live on a date — a personal
 * task's due date, a fixed date, a block on the day timeline, and the next
 * event on an order or a trip — and until now each was a separate list, so the
 * one question nobody could answer was "what does my month actually look like".
 * This puts all four on one grid without copying a single row: every item is
 * read from the table it already lives in, and clicking through goes back to
 * that row rather than to a calendar copy of it.
 *
 * Ownership is the usual rule, not a new one: personal projects, this person's
 * own fixed dates and orders, and day events that are theirs or shared.
 */
import { useMemo, useState } from 'react';
import { CalendarPlus, Check } from 'lucide-react';
import { isMyEvent, isUnconfirmed, minutesToClock, pendingInvites } from '../../lib/calendar';
import { notifyCalendarConfirmed } from '../../lib/handoff';
import { CalendarComposer } from '../../ui/CalendarComposer';
import { useStore } from '../../data/store';
import { useToast } from '../../ui/bits';
import { nowIso } from '../../data/store';
import { useData } from '../../data/store';
import { inAnyProject } from '../../lib/taskFacets';
import { fmtDay, todayIso } from '../../lib/dates';
import { minToLabel } from '../../lib/dayPlan';
import { isTerminalOrder } from '../../lib/personalOrders';
import { myTasks } from '../../lib/workspace';
import { MonthCalendar, type MonthItem } from '../../ui/monthcal';

function usePersonalMonthItems(): MonthItem[] {
  const ds = useData((d) => d);
  const meId = useData((_, s) => s.meId);

  return useMemo(() => {
    const personal = new Set(ds.projects.filter((p) => p.is_personal).map((p) => p.id));
    const out: MonthItem[] = [];

    for (const t of myTasks(ds.tasks, meId)) {
      if (!t.due_date || t.status === 'done') continue;
      if (!inAnyProject(t, personal)) continue;
      out.push({ id: `t-${t.id}`, date: t.due_date, label: t.title, tone: 'task', to: `/task/${t.id}` });
    }

    /* A fixed date with no owner is one both people are living around — a term
       start, a flight everyone is on — so it shows on both calendars. */
    for (const d of ds.fixed_dates) {
      if (d.owner_id && d.owner_id !== meId) continue;
      out.push({ id: `d-${d.id}`, date: d.date, label: d.label, tone: 'date' });
    }

    /* isMyEvent, not a user_id test: since 0050 a block can be WITH you, and
       one somebody else proposed has their user_id and your invitee_id. */
    for (const e of ds.day_events) {
      if (!isMyEvent(e, meId)) continue;
      out.push({
        id: `e-${e.id}`,
        date: e.date,
        label: isUnconfirmed(e) ? `${e.label} · unconfirmed` : e.label,
        meta: minToLabel(e.start_min),
        tone: 'event',
        to: e.task_id ? `/task/${e.task_id}` : undefined,
      });
    }

    for (const o of ds.personal_orders) {
      if (o.user_id !== meId || !o.next_event_at) continue;
      if (o.review_status !== 'confirmed' || isTerminalOrder(o)) continue;
      out.push({
        id: `o-${o.id}`,
        date: todayIso(new Date(o.next_event_at)),
        label: o.summary || o.merchant,
        tone: 'date',
      });
    }

    return out;
  }, [ds.tasks, ds.projects, ds.fixed_dates, ds.day_events, ds.personal_orders, meId]);
}

/** The tile face: the month, and the next three things on it. */
export function CalendarGlance() {
  const items = usePersonalMonthItems();
  return (
    <div className="pgl">
      <div className="pgl-hd">
        <h3>Calendar</h3>
      </div>
      <MonthCalendar items={items} upcoming={2} readOnly fit emptyText="Nothing dated coming up." />
    </div>
  );
}

/** The side-page face: the same month with room to actually read the list. */
export function PersonalCalendar() {
  const items = usePersonalMonthItems();
  const [adding, setAdding] = useState(false);
  return (
    <div className="pcal-wrap">
      <div className="pcal-head">
        <InviteInbox />
        <button className="btn sm solid pcal-add" type="button" onClick={() => setAdding(true)}>
          <CalendarPlus size={15} strokeWidth={1.9} aria-hidden /> Add to calendar
        </button>
      </div>
      <MonthCalendar
        items={items}
        upcoming={8}
        emptyText="Nothing dated coming up. Personal tasks with a due date, fixed dates, blocks, reminders and countdowns all land here."
      />
      <CalendarComposer open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

/**
 * Blocks somebody proposed that you have not answered.
 *
 * Sits above the month rather than inside it because an unanswered proposal is
 * a thing to act on, not a thing to look at: it appears on the grid too, just
 * greyed as unconfirmed, and this is the strip that says "somebody is waiting".
 */
function InviteInbox() {
  const ds = useData((d) => d);
  const meId = useData((_, s) => s.meId);
  const store = useStore();
  const toast = useToast();
  const invites = pendingInvites(ds.day_events, meId, todayIso());
  if (!invites.length) return <span className="pcal-none" />;

  const accept = (id: string) => {
    const event = ds.day_events.find((e) => e.id === id);
    if (!event) return;
    store.update('day_events', id, { confirmed_at: nowIso() }, store.asMe({ summary: `Time confirmed — ${event.label}` }));
    notifyCalendarConfirmed(store, event.label, event.date, minutesToClock(event.start_min), event.created_by);
    toast('Confirmed');
  };

  const decline = (id: string) => {
    const event = ds.day_events.find((e) => e.id === id);
    if (!event) return;
    if (!window.confirm(`Decline "${event.label}"? It comes off both calendars.`)) return;
    store.remove('day_events', id, store.asMe({ summary: `Time declined — ${event.label}` }));
    toast('Declined');
  };

  return (
    <div className="pcal-invites">
      <span className="eyebrow">Waiting on you · {invites.length}</span>
      {invites.map((e) => (
        <div className="pcal-invite" key={e.id}>
          <span className="pcal-invite-what">
            <b>{e.label}</b>
            <span className="mono">
              {fmtDay(e.date)} · {minutesToClock(e.start_min)}–{minutesToClock(e.end_min)}
            </span>
          </span>
          <button className="btn sm solid" type="button" onClick={() => accept(e.id)}>
            <Check size={14} strokeWidth={2.2} aria-hidden /> Accept
          </button>
          <button className="btn sm" type="button" onClick={() => decline(e.id)}>
            Decline
          </button>
        </div>
      ))}
    </div>
  );
}
