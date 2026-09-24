/**
 * Meeting booking — the pure half.
 *
 * Shared by three runtimes, which is why this file imports NOTHING:
 *   · the public booking screen (Vite, browser)
 *   · the `book` edge function (Deno, imports this by relative path)
 *   · the `ics` edge function (Deno, same)
 * A Vite-only import (import.meta.env, a CSS file, a path alias) or even an
 * extensionless relative import would break the Deno side at deploy time.
 *
 * Time model. A day_event stores a host-LOCAL wall clock: `date` plus minutes
 * from midnight, in the host's zone. Everything here converts that to real
 * instants (UTC epoch ms) before comparing, using Intl for the zone offset, so
 * the two DST changes a year in Europe/Rome land on the right hour instead of
 * being an hour off for half the year. Asia/Kolkata has no DST, which is
 * exactly why a naive fixed offset would pass every test written from India.
 */

/* ── shapes ─────────────────────────────────────────────────────────── */

export interface BookingRules {
  /** Meeting lengths offered, minutes. */
  durations: number[];
  /** Working window in host-local minutes from midnight. */
  work_start_min: number;
  work_end_min: number;
  /** ISO weekdays offered: 1 = Monday … 7 = Sunday. */
  work_days: number[];
  /** Kept clear either side of anything already booked. */
  buffer_min: number;
  /** No slot starts sooner than this from now. */
  min_notice_min: number;
  /** How many host-local days ahead, today included. */
  horizon_days: number;
}

/** A half-open instant range [start, end) in UTC epoch ms. */
export interface Interval {
  start: number;
  end: number;
}

export interface Slot {
  /** ISO-8601 UTC. */
  start: string;
  end: string;
  /** The host-local day the slot belongs to (YYYY-MM-DD). */
  hostDate: string;
}

/** The subset of a day_event this logic needs. */
export interface BusyEventLike {
  id: string;
  user_id: string | null;
  date: string;
  start_min: number;
  end_min: number;
  kind: string;
  invitee_id?: string | null;
  confirmed_at?: string | null;
  created_by?: string | null;
  integration_grant_id?: string | null;
  external_event_id?: string | null;
}

export interface BookingLike {
  start_at: string;
  end_at: string;
  status: 'pending' | 'confirmed' | 'declined' | 'cancelled';
}

/* ── caps (mirror the CHECKs in 0055_booking.sql) ───────────────────── */

export const CAPS = {
  name: 120,
  email: 200,
  note: 1000,
  title: 120,
  durations: 6,
  durationMin: 10,
  durationMax: 240,
  bufferMax: 120,
  noticeMax: 20_160, // 14 days
  horizonMax: 60,
  bookingsPerIpPerDay: 5,
  pendingPerHost: 20,
} as const;

export const DEFAULT_RULES: BookingRules = {
  durations: [30],
  work_start_min: 600,
  work_end_min: 1080,
  work_days: [1, 2, 3, 4, 5],
  buffer_min: 10,
  min_notice_min: 240,
  horizon_days: 21,
};

export const SLUG_RE = /^[a-z0-9-]{3,40}$/;
/** Deliberately loose: one @, something either side, a dot in the domain,
 *  no whitespace. The same shape as the database CHECK. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MIN = 60_000;
const DAY = 86_400_000;

/* ── time zones ─────────────────────────────────────────────────────── */

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True when the runtime knows this IANA zone. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of an instant, as seen in `timeZone`. */
export function zonedParts(utcMs: number, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  // Some engines still print midnight as 24 under h23; normalise.
  const hour = out.hour === 24 ? 0 : out.hour;
  const date = `${String(out.year).padStart(4, '0')}-${pad2(out.month)}-${pad2(out.day)}`;
  return { date, minutes: hour * 60 + out.minute, second: out.second };
}

/** Minutes `timeZone` is ahead of UTC at that instant (Rome: 60 or 120). */
export function tzOffsetMin(utcMs: number, timeZone: string): number {
  const { date, minutes, second } = zonedParts(utcMs, timeZone);
  const asUtc = Date.parse(`${date}T00:00:00Z`) + minutes * MIN + second * 1000;
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / MIN);
}

/**
 * The instant a host-local wall clock refers to.
 *
 * Two passes because the offset depends on the answer: guess with the offset
 * at the naive instant, then correct with the offset at the guess. In the
 * autumn repeated hour it returns one of the two real occurrences. A
 * wall clock inside the spring gap does not exist; the result then lands an
 * hour later, which `localExists` detects.
 */
export function zonedToUtc(date: string, minutes: number, timeZone: string): number {
  const naive = Date.parse(`${date}T00:00:00Z`) + minutes * MIN;
  const first = naive - tzOffsetMin(naive, timeZone) * MIN;
  const second = naive - tzOffsetMin(first, timeZone) * MIN;
  if (first === second) return first;
  // Ambiguous or gap: prefer whichever candidate round-trips to the asked time.
  const back = zonedParts(second, timeZone);
  return back.date === date && back.minutes === minutes ? second : first;
}

/** Does this wall clock exist in `timeZone` (i.e. is it not in a DST gap)? */
export function localExists(date: string, minutes: number, timeZone: string): boolean {
  const back = zonedParts(zonedToUtc(date, minutes, timeZone), timeZone);
  const want = minutes === 1440 ? { date: addDays(date, 1), minutes: 0 } : { date, minutes };
  return back.date === want.date && back.minutes === want.minutes;
}

export function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(isoDate: string): number {
  const d = new Date(`${isoDate}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/* ── what counts as busy ────────────────────────────────────────────── */

/**
 * Is this event on the host's calendar at all? Mirrors lib/calendar's
 * isMyEvent (own, shared, or one they are invited to) without importing it —
 * see the header for why this file has no imports.
 */
function onHostCalendar(e: BusyEventLike, hostId: string): boolean {
  return !e.user_id || e.user_id === hostId || e.invitee_id === hostId;
}

/**
 * Events that make the host unavailable to a guest.
 *
 * Conservative on purpose: an invite the host has not accepted yet still
 * holds the time, and so does anything mirrored in from Google — offering a
 * slot on top of either is how a double booking happens. Only reminders are
 * left out: a ping is not busy time.
 */
export function availabilityBusy<E extends BusyEventLike>(events: E[], hostId: string): E[] {
  return events.filter((e) => onHostCalendar(e, hostId) && e.kind !== 'reminder' && e.end_min > e.start_min);
}

/**
 * Events published in the host's ICS busy feed. Same rule the Google push
 * uses (lib/calendarPush pushableEvents): no reminders, nothing that came
 * FROM Google (it is already there), and no invite still waiting on the
 * host's yes — until they accept it is a proposal, not their commitment.
 */
export function icsBusy<E extends BusyEventLike>(events: E[], hostId: string): E[] {
  return availabilityBusy(events, hostId).filter(
    (e) =>
      !e.external_event_id &&
      !e.integration_grant_id &&
      !(e.invitee_id === hostId && !e.confirmed_at && e.created_by !== hostId),
  );
}

/** A host-local event as real instants. */
export function eventInterval(e: Pick<BusyEventLike, 'date' | 'start_min' | 'end_min'>, timeZone: string): Interval {
  return { start: zonedToUtc(e.date, e.start_min, timeZone), end: zonedToUtc(e.date, e.end_min, timeZone) };
}

/** Live bookings (pending or confirmed) as instants. */
export function bookingIntervals(bookings: BookingLike[]): Interval[] {
  return bookings
    .filter((b) => b.status === 'pending' || b.status === 'confirmed')
    .map((b) => ({ start: Date.parse(b.start_at), end: Date.parse(b.end_at) }))
    .filter((i) => Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start);
}

/* ── rules ──────────────────────────────────────────────────────────── */

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Coerce whatever came out of the database into rules the slot maths can
 *  trust. The database CHECKs already hold; this is the second belt. */
export function normaliseRules(raw: Partial<BookingRules> | null | undefined): BookingRules {
  const r = { ...DEFAULT_RULES, ...(raw ?? {}) };
  const durations = [...new Set((Array.isArray(r.durations) ? r.durations : []).map((d) => clampInt(d, CAPS.durationMin, CAPS.durationMax, 30)))]
    .sort((a, b) => a - b)
    .slice(0, CAPS.durations);
  const work_days = [...new Set((Array.isArray(r.work_days) ? r.work_days : []).map((d) => clampInt(d, 1, 7, 1)))].sort();
  const work_start_min = clampInt(r.work_start_min, 0, 1439, 600);
  const work_end_min = clampInt(r.work_end_min, work_start_min + 1, 1440, 1080);
  return {
    durations: durations.length ? durations : [30],
    work_start_min,
    work_end_min,
    work_days,
    buffer_min: clampInt(r.buffer_min, 0, CAPS.bufferMax, 10),
    min_notice_min: clampInt(r.min_notice_min, 0, CAPS.noticeMax, 240),
    horizon_days: clampInt(r.horizon_days, 1, CAPS.horizonMax, 21),
  };
}

/** Slot grid: a 15-minute meeting steps by 15, anything longer by 30. */
export const slotStep = (duration: number) => Math.min(30, Math.max(5, duration));

/* ── slots ──────────────────────────────────────────────────────────── */

export interface SlotQuery {
  rules: BookingRules;
  timeZone: string;
  duration: number;
  /** Everything already holding time, as instants. */
  busy: Interval[];
  now: number;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/**
 * Every bookable start for one duration, soonest first.
 *
 * A slot is offered when, all in the host's zone:
 *   · its day is a work day and within the horizon (today = day 1)
 *   · it starts and ends inside the working window
 *   · its start wall clock exists (not inside a spring-forward gap)
 *   · it starts at least min_notice after now
 *   · it does not come within buffer_min of anything busy
 */
export function computeSlots(q: SlotQuery): Slot[] {
  const { rules, timeZone, duration, busy, now } = q;
  if (!rules.durations.includes(duration)) return [];
  const step = slotStep(duration);
  const buffer = rules.buffer_min * MIN;
  const padded = busy.map((b) => ({ start: b.start - buffer, end: b.end + buffer }));
  const earliest = now + rules.min_notice_min * MIN;
  const today = zonedParts(now, timeZone).date;
  const out: Slot[] = [];
  for (let d = 0; d < rules.horizon_days; d++) {
    const hostDate = addDays(today, d);
    if (!rules.work_days.includes(isoWeekday(hostDate))) continue;
    for (let m = rules.work_start_min; m + duration <= rules.work_end_min; m += step) {
      if (!localExists(hostDate, m, timeZone)) continue;
      const start = zonedToUtc(hostDate, m, timeZone);
      // Exactly `duration` long even when a DST change falls inside it.
      const slot = { start, end: start + duration * MIN };
      if (slot.start < earliest) continue;
      if (padded.some((b) => overlaps(slot, b))) continue;
      out.push({ start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString(), hostDate });
    }
  }
  return out;
}

/** Is exactly this start still offered? The server's pre-check before the
 *  locked insert; the lock itself is what makes it race-safe. */
export function isSlotOffered(q: SlotQuery, startIso: string): boolean {
  const want = Date.parse(startIso);
  if (!Number.isFinite(want)) return false;
  return computeSlots(q).some((s) => Date.parse(s.start) === want);
}

/* ── guest input ────────────────────────────────────────────────────── */

export interface GuestInput {
  name: string;
  email: string;
  note: string;
}

/** Trim and validate the guest's form. Returns clean values or the first
 *  problem in words a stranger can act on. */
export function validateGuest(raw: Partial<Record<keyof GuestInput, unknown>>): { ok: true; value: GuestInput } | { ok: false; error: string } {
  // Control characters out: they have no business in a name and would be
  // written into a calendar note and a push notification.
  const clean = (v: unknown) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  const name = clean(raw.name).replace(/\s+/g, ' ');
  const email = clean(raw.email).toLowerCase();
  const note = clean(raw.note);
  if (!name) return { ok: false, error: 'Please add your name.' };
  if (name.length > CAPS.name) return { ok: false, error: `Name is limited to ${CAPS.name} characters.` };
  if (!email || email.length > CAPS.email || !EMAIL_RE.test(email)) return { ok: false, error: 'That email address does not look right.' };
  if (note.length > CAPS.note) return { ok: false, error: `The note is limited to ${CAPS.note} characters.` };
  return { ok: true, value: { name, email, note } };
}

export const firstName = (full: string | null | undefined) => (full ?? '').trim().split(/\s+/)[0] || 'your host';

/* ── display helpers (browser) ──────────────────────────────────────── */

/** "14:30" in the given zone. */
export function formatTime(iso: string, timeZone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** The guest-local day a slot falls on (YYYY-MM-DD). */
export const guestDate = (iso: string, timeZone: string) => zonedParts(Date.parse(iso), timeZone).date;

/** Group slots by the GUEST's day, keeping order. */
export function groupByGuestDay(slots: Slot[], guestZone: string): { date: string; slots: Slot[] }[] {
  const out: { date: string; slots: Slot[] }[] = [];
  for (const s of slots) {
    const date = guestDate(s.start, guestZone);
    const last = out[out.length - 1];
    if (last && last.date === date) last.slots.push(s);
    else out.push({ date, slots: [s] });
  }
  return out;
}

/* ── ICS busy feed ──────────────────────────────────────────────────── */

const icsStamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** RFC 5545 §3.3.11 text escaping. */
export const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 §3.1: lines longer than 75 octets continue on the next line
 *  after CRLF + one space. Counted in UTF-8 bytes, never splitting a
 *  character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines lose one to the space
    if (bytes + n > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export interface IcsOptions {
  timeZone: string;
  /** DTSTAMP for every VEVENT. */
  now: number;
  calendarName?: string;
}

/**
 * The host's busy time as a VCALENDAR.
 *
 * Every summary is "Busy (ORRA)" — this URL is a bearer secret handed to
 * Google, and a leaked link must reveal when, never what. UIDs come from the
 * row id so a re-fetch updates events in place instead of duplicating them.
 * Output is sorted and deterministic for identical input.
 */
export function buildIcs(events: Pick<BusyEventLike, 'id' | 'date' | 'start_min' | 'end_min'>[], opts: IcsOptions): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ORRA//Busy feed//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(opts.calendarName ?? 'ORRA busy')}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
  ];
  const stamp = icsStamp(opts.now);
  const rows = events
    .map((e) => ({ id: e.id, ...eventInterval(e, opts.timeZone) }))
    .filter((e) => e.end > e.start)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  for (const e of rows) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${icsEscape(e.id)}@orra`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsStamp(e.start)}`,
      `DTEND:${icsStamp(e.end)}`,
      'SUMMARY:Busy (ORRA)',
      'CLASS:PRIVATE',
      'TRANSP:OPAQUE',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
