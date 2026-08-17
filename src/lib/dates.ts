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

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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

export type DayMode = 'morning' | 'midday' | 'evening';
export function dayModeNow(d = new Date()): DayMode {
  const h = d.getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'midday';
  return 'evening';
}

export function inr(n: number): string {
  return '₹' + Math.abs(n).toLocaleString('en-IN');
}
