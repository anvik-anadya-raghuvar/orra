/**
 * The calendar's rules, kept pure.
 *
 * Three things arrived together in 0050 and all three are read from several
 * screens — Home, Personal, the day plan — so the logic lives here rather than
 * being re-derived slightly differently in each:
 *
 *   · whose calendar an event belongs on, now that one can be *with* somebody
 *   · what a countdown says, and when it stops being worth showing
 *   · which reminders are due to fire
 *
 * Time is minutes-from-midnight local, matching `day_events.start_min`.
 */
import type { DayEvent, FixedDate, UserId } from '../types';

/* ── who sees an event ──────────────────────────────────────────────── */

/**
 * True when `userId` should see this event on their own calendar.
 *
 * Three ways to qualify, and the third is what 0050 added: it is shared
 * (`user_id` null), it is yours, or somebody put you in it. Without the last
 * one, "let's talk at 4" would sit on the proposer's calendar and be invisible
 * to the person it is actually about.
 */
export function isMyEvent(event: DayEvent, userId: UserId): boolean {
  return !event.user_id || event.user_id === userId || event.invitee_id === userId;
}

/** Events on `userId`'s calendar for a given day, earliest first. */
export function eventsForDay(events: DayEvent[], userId: UserId, date: string): DayEvent[] {
  return events
    .filter((e) => e.date === date && isMyEvent(e, userId))
    .sort((a, b) => a.start_min - b.start_min || a.id.localeCompare(b.id));
}

/** True when this is a two-person block still waiting on a yes. */
export function isUnconfirmed(event: DayEvent): boolean {
  return Boolean(event.invitee_id) && !event.confirmed_at;
}

/**
 * True when `userId` is the one who owes an answer.
 *
 * The invitee confirms, and only if they did not propose it themselves —
 * blocking time with someone and then being asked to accept your own proposal
 * is the kind of thing that makes a calendar feel like paperwork.
 */
export function awaitingMyConfirmation(event: DayEvent, userId: UserId): boolean {
  return isUnconfirmed(event) && event.invitee_id === userId && event.created_by !== userId;
}

/** Everything on this person's plate to accept, soonest first. */
export function pendingInvites(events: DayEvent[], userId: UserId, todayIso: string): DayEvent[] {
  return events
    .filter((e) => e.date >= todayIso && awaitingMyConfirmation(e, userId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_min - b.start_min);
}

/* ── time formatting ────────────────────────────────────────────────── */

/** Minutes from midnight as `HH:MM`, 24-hour, zero-padded. */
export function minutesToClock(min: number): string {
  const clamped = Math.max(0, Math.min(1440, Math.round(min)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** `HH:MM` back to minutes. Returns null for anything unparseable, so a
 *  half-typed time in an input does not become 0 and silently mean midnight. */
export function clockToMinutes(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((clock ?? '').trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59 || (h === 24 && m > 0)) return null;
  return h * 60 + m;
}

/* ── countdowns ─────────────────────────────────────────────────────── */

export interface Countdown {
  date: FixedDate;
  /** Whole days from today. Negative once the date has passed. */
  days: number;
  label: string;
}

/** Whole days between two ISO dates, date-only so a timezone cannot shift it. */
export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** "in 3 days", "tomorrow", "today", "2 days ago" — the whole vocabulary. */
export function countdownLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

/**
 * The countdowns to show `userId`, nearest first.
 *
 * Shared dates (`owner_id` null) count for both, exactly like a shared event.
 * Past dates drop off once they are a day old: a countdown to something that
 * already happened is clutter, but "yesterday" is still worth a glance the
 * morning after.
 */
export function countdownsFor(
  dates: FixedDate[],
  userId: UserId,
  todayIso: string,
  options: { pinnedOnly?: boolean } = {},
): Countdown[] {
  return dates
    .filter((d) => !d.owner_id || d.owner_id === userId)
    .filter((d) => (options.pinnedOnly ? d.pinned_home : true))
    .map((date) => {
      const days = daysBetween(todayIso, date.date);
      return { date, days, label: countdownLabel(days) };
    })
    .filter((c) => c.days >= -1)
    .sort((a, b) => a.days - b.days || a.date.label.localeCompare(b.date.label));
}

/* ── reminders ──────────────────────────────────────────────────────── */

/**
 * Events whose reminder is due and has not fired.
 *
 * `nowMin` is minutes from midnight on `todayIso`. Only today is considered:
 * a reminder for tomorrow is not due, and one from yesterday that never fired
 * is deliberately dropped rather than arriving a day late, which is worse than
 * not arriving.
 */
export function dueReminders(events: DayEvent[], userId: UserId, todayIso: string, nowMin: number): DayEvent[] {
  return events
    .filter(
      (e) =>
        e.date === todayIso &&
        isMyEvent(e, userId) &&
        e.remind_min_before != null &&
        !e.reminded_at &&
        e.start_min - e.remind_min_before <= nowMin &&
        e.start_min >= nowMin - 60,
    )
    .sort((a, b) => a.start_min - b.start_min);
}
