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
import { useMemo } from 'react';
import { useData } from '../../data/store';
import { todayIso } from '../../lib/dates';
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
      if (!personal.has(t.project_id)) continue;
      out.push({ id: `t-${t.id}`, date: t.due_date, label: t.title, tone: 'task', to: `/task/${t.id}` });
    }

    /* A fixed date with no owner is one both people are living around — a term
       start, a flight everyone is on — so it shows on both calendars. */
    for (const d of ds.fixed_dates) {
      if (d.owner_id && d.owner_id !== meId) continue;
      out.push({ id: `d-${d.id}`, date: d.date, label: d.label, tone: 'date' });
    }

    for (const e of ds.day_events) {
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
  return (
    <MonthCalendar
      items={items}
      upcoming={8}
      emptyText="Nothing dated coming up. Personal tasks with a due date, fixed dates, blocks and trips all land here."
    />
  );
}
