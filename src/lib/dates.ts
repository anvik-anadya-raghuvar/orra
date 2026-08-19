/** Timezone + date helpers. Both cities always visible in the header (§1.2). */

export const TZ_IN = 'Asia/Kolkata';
export const TZ_IT = 'Europe/Rome';

export function clockIn(tz: string, d = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: tz,
  }).format(d);
}

/**
 * Today, in the reader's own timezone.
 *
 * This used to be `toISOString().slice(0, 10)`, which is the UTC date. For
 * anyone east of Greenwich that is the *previous* day for the first hours after
 * midnight — 01:00 in Rome or 04:00 in Delhi both read as yesterday. Everything
 * keyed by date (the day plan, today's intentions, the schedule ribbon, the
 * capacity) would then be written to and read from the wrong day, which looks
 * exactly like the app losing your work.
 */
export function todayIso(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * The local calendar date a timestamp falls on.
 *
 * `created_at.slice(0, 10)` looks like the same thing and is not: that is the
 * UTC date, and both people live east of Greenwich. A message sent at 04:00 in
 * Delhi carries a timestamp whose UTC date is *yesterday*, so slicing it and
 * comparing against `todayIso()` says "not today" for the first five and a half
 * hours of every morning — the Us thread stops labelling today as Today, and a
 * task closed before dawn lands in yesterday's column on Momentum.
 *
 * Anything that groups rows by day, or compares a row's day against
 * `todayIso()`, has to come through here.
 */
export function localDay(ts: string): string {
  return todayIso(new Date(ts));
}

export function daysUntil(dateIso: string, fromIso = todayIso()): number {
  const a = new Date(fromIso + 'T00:00:00Z').getTime();
  const b = new Date(dateIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000);
}

export function daysSinceTs(ts: string, now = new Date()): number {
  return Math.floor((now.getTime() - new Date(ts).getTime()) / 86_400_000);
}

export function fmtDay(dateIso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(
    new Date(dateIso + (dateIso.length === 10 ? 'T00:00:00' : '')),
  );
}

export function fmtTime(ts: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(
    new Date(ts),
  );
}

export function fmtDateTime(ts: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ts));
}

export function inr(n: number): string {
  return '₹' + Math.abs(n).toLocaleString('en-IN');
}
