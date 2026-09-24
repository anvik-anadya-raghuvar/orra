import { describe, expect, it } from 'vitest';
import {
  availabilityBusy,
  buildIcs,
  computeSlots,
  DEFAULT_RULES,
  eventInterval,
  foldLine,
  groupByGuestDay,
  icsBusy,
  isoWeekday,
  isSlotOffered,
  localExists,
  normaliseRules,
  tzOffsetMin,
  validateGuest,
  zonedToUtc,
  type BookingRules,
  type BusyEventLike,
} from './booking';

const ROME = 'Europe/Rome';
const KOLKATA = 'Asia/Kolkata';
const HOST = 'host-1';
const utc = (s: string) => Date.parse(s);

const rules = (patch: Partial<BookingRules> = {}): BookingRules => ({
  ...DEFAULT_RULES,
  durations: [30],
  work_start_min: 600, // 10:00
  work_end_min: 720, // 12:00
  work_days: [1, 2, 3, 4, 5],
  buffer_min: 0,
  min_notice_min: 0,
  horizon_days: 1,
  ...patch,
});

const ev = (patch: Partial<BusyEventLike>): BusyEventLike => ({
  id: 'e1',
  user_id: HOST,
  date: '2026-07-01',
  start_min: 600,
  end_min: 660,
  kind: 'focus',
  ...patch,
});

describe('time zones', () => {
  it('reads Rome offsets on both sides of DST', () => {
    expect(tzOffsetMin(utc('2026-01-15T12:00:00Z'), ROME)).toBe(60);
    expect(tzOffsetMin(utc('2026-07-15T12:00:00Z'), ROME)).toBe(120);
    expect(tzOffsetMin(utc('2026-07-15T12:00:00Z'), KOLKATA)).toBe(330);
  });

  it('converts a Rome wall clock to the right instant in winter and summer', () => {
    expect(new Date(zonedToUtc('2026-01-15', 600, ROME)).toISOString()).toBe('2026-01-15T09:00:00.000Z');
    expect(new Date(zonedToUtc('2026-07-15', 600, ROME)).toISOString()).toBe('2026-07-15T08:00:00.000Z');
    expect(new Date(zonedToUtc('2026-07-15', 600, KOLKATA)).toISOString()).toBe('2026-07-15T04:30:00.000Z');
  });

  it('flags the spring-forward gap as non-existent', () => {
    // 29 March 2026: 02:00 → 03:00 in Rome.
    expect(localExists('2026-03-29', 150, ROME)).toBe(false);
    expect(localExists('2026-03-29', 180, ROME)).toBe(true);
    expect(localExists('2026-03-29', 90, ROME)).toBe(true);
  });

  it('gets the ISO weekday right', () => {
    expect(isoWeekday('2026-09-21')).toBe(1); // Monday
    expect(isoWeekday('2026-09-27')).toBe(7); // Sunday
  });
});

describe('computeSlots', () => {
  // Wednesday 1 July 2026, 06:00 UTC = 08:00 in Rome.
  const now = utc('2026-07-01T06:00:00Z');

  it('fills the working window in host time', () => {
    const slots = computeSlots({ rules: rules(), timeZone: ROME, duration: 30, busy: [], now });
    expect(slots.map((s) => s.start)).toEqual([
      '2026-07-01T08:00:00.000Z',
      '2026-07-01T08:30:00.000Z',
      '2026-07-01T09:00:00.000Z',
      '2026-07-01T09:30:00.000Z',
    ]);
    expect(slots.every((s) => s.hostDate === '2026-07-01')).toBe(true);
  });

  it('refuses a duration the page does not offer', () => {
    expect(computeSlots({ rules: rules(), timeZone: ROME, duration: 45, busy: [], now })).toEqual([]);
  });

  it('respects minimum notice', () => {
    // 150 minutes of notice from 08:00 Rome → nothing before 10:30.
    const slots = computeSlots({ rules: rules({ min_notice_min: 150 }), timeZone: ROME, duration: 30, busy: [], now });
    expect(slots[0].start).toBe('2026-07-01T08:30:00.000Z');
  });

  it('keeps the buffer clear around busy time', () => {
    const busy = [eventInterval(ev({ start_min: 660, end_min: 690 }), ROME)]; // 11:00–11:30
    const noBuffer = computeSlots({ rules: rules(), timeZone: ROME, duration: 30, busy, now }).map((s) => s.start);
    expect(noBuffer).toEqual(['2026-07-01T08:00:00.000Z', '2026-07-01T08:30:00.000Z', '2026-07-01T09:30:00.000Z']);
    const buffered = computeSlots({ rules: rules({ buffer_min: 10 }), timeZone: ROME, duration: 30, busy, now }).map((s) => s.start);
    // 10:30–11:00 now touches 10:50; 11:30–12:00 touches 11:40.
    expect(buffered).toEqual(['2026-07-01T08:00:00.000Z']);
  });

  it('treats overlapping events as one busy stretch', () => {
    const busy = [
      eventInterval(ev({ id: 'a', start_min: 600, end_min: 650 }), ROME),
      eventInterval(ev({ id: 'b', start_min: 630, end_min: 700 }), ROME),
    ];
    const slots = computeSlots({ rules: rules(), timeZone: ROME, duration: 30, busy, now });
    expect(slots.map((s) => s.start)).toEqual([]); // 10:00–11:40 busy, 11:30 slot overlaps too
    const hour = computeSlots({ rules: rules({ work_end_min: 780 }), timeZone: ROME, duration: 30, busy, now });
    expect(hour[0].start).toBe('2026-07-01T10:00:00.000Z'); // 12:00 Rome
  });

  it('skips non-work days and stops at the horizon', () => {
    // Friday 3 July, 06:00 UTC. Horizon 4 days: Fri, Sat, Sun, Mon.
    const fri = utc('2026-07-03T06:00:00Z');
    const slots = computeSlots({ rules: rules({ horizon_days: 4 }), timeZone: ROME, duration: 30, busy: [], now: fri });
    expect([...new Set(slots.map((s) => s.hostDate))]).toEqual(['2026-07-03', '2026-07-06']);
    const short = computeSlots({ rules: rules({ horizon_days: 3 }), timeZone: ROME, duration: 30, busy: [], now: fri });
    expect([...new Set(short.map((s) => s.hostDate))]).toEqual(['2026-07-03']);
  });

  it('keeps 10:00 at 10:00 across the spring change in Rome', () => {
    // Fri 27 March (CET, +1) → Mon 30 March (CEST, +2).
    const r = rules({ horizon_days: 4, work_end_min: 630 });
    const slots = computeSlots({ rules: r, timeZone: ROME, duration: 30, busy: [], now: utc('2026-03-27T05:00:00Z') });
    expect(slots.map((s) => s.start)).toEqual(['2026-03-27T09:00:00.000Z', '2026-03-30T08:00:00.000Z']);
  });

  it('keeps 10:00 at 10:00 across the autumn change in Rome', () => {
    // Fri 23 October (CEST) → Mon 26 October (CET).
    const r = rules({ horizon_days: 4, work_end_min: 630 });
    const slots = computeSlots({ rules: r, timeZone: ROME, duration: 30, busy: [], now: utc('2026-10-23T05:00:00Z') });
    expect(slots.map((s) => s.start)).toEqual(['2026-10-23T08:00:00.000Z', '2026-10-26T09:00:00.000Z']);
  });

  it('never offers a wall clock inside the spring gap', () => {
    const r = rules({ work_days: [7], work_start_min: 60, work_end_min: 240, horizon_days: 1 });
    const slots = computeSlots({ rules: r, timeZone: ROME, duration: 30, busy: [], now: utc('2026-03-28T23:30:00Z') });
    const romeTimes = slots.map((s) => new Intl.DateTimeFormat('en-GB', { timeZone: ROME, hour: '2-digit', minute: '2-digit' }).format(new Date(s.start)));
    expect(romeTimes).toEqual(['01:00', '01:30', '03:00', '03:30']);
    // Every slot is exactly 30 real minutes, even the one straddling 02:00.
    expect(slots.every((s) => Date.parse(s.end) - Date.parse(s.start) === 30 * 60_000)).toBe(true);
  });

  it('confirms an exact offered start and rejects a near miss', () => {
    const q = { rules: rules(), timeZone: ROME, duration: 30, busy: [], now };
    expect(isSlotOffered(q, '2026-07-01T08:30:00.000Z')).toBe(true);
    expect(isSlotOffered(q, '2026-07-01T08:31:00.000Z')).toBe(false);
    expect(isSlotOffered(q, 'nonsense')).toBe(false);
  });

  it('groups slots by the guest day, not the host day', () => {
    // A Kolkata host offering 00:00–01:00: a Rome guest sees those slots on
    // the previous evening, so the day strip must use the guest's date.
    const r = rules({ work_start_min: 0, work_end_min: 60, work_days: [1, 2, 3, 4, 5, 6, 7], horizon_days: 2 });
    const slots = computeSlots({ rules: r, timeZone: KOLKATA, duration: 30, busy: [], now: utc('2026-06-30T17:00:00Z') });
    expect(slots[0].hostDate).toBe('2026-07-01');
    const groups = groupByGuestDay(slots, ROME);
    expect(groups[0].date).toBe('2026-06-30');
  });
});

describe('busy filters', () => {
  const events: BusyEventLike[] = [
    ev({ id: 'own' }),
    ev({ id: 'shared', user_id: null }),
    ev({ id: 'other', user_id: 'someone-else' }),
    ev({ id: 'invited-unconfirmed', user_id: 'someone-else', invitee_id: HOST, created_by: 'someone-else' }),
    ev({ id: 'invited-confirmed', user_id: 'someone-else', invitee_id: HOST, created_by: 'someone-else', confirmed_at: '2026-06-01T00:00:00Z' }),
    ev({ id: 'reminder', kind: 'reminder' }),
    ev({ id: 'google', integration_grant_id: 'g1', external_event_id: 'x' }),
  ];

  it('blocks availability conservatively', () => {
    expect(availabilityBusy(events, HOST).map((e) => e.id)).toEqual([
      'own',
      'shared',
      'invited-unconfirmed',
      'invited-confirmed',
      'google',
    ]);
  });

  it('publishes only committed, ORRA-native time to the feed', () => {
    expect(icsBusy(events, HOST).map((e) => e.id)).toEqual(['own', 'shared', 'invited-confirmed']);
  });
});

describe('normaliseRules', () => {
  it('clamps, dedupes and sorts', () => {
    const r = normaliseRules({ durations: [60, 30, 30, 5, 999], work_days: [5, 1, 1, 9], horizon_days: 400, buffer_min: -3 });
    expect(r.durations).toEqual([10, 30, 60, 240]);
    expect(r.work_days).toEqual([1, 5, 7]);
    expect(r.horizon_days).toBe(60);
    expect(r.buffer_min).toBe(0);
  });
});

describe('validateGuest', () => {
  it('cleans and accepts a normal booking', () => {
    const v = validateGuest({ name: '  Ada   Lovelace ', email: ' ADA@Example.com ', note: 'hi' });
    expect(v).toEqual({ ok: true, value: { name: 'Ada Lovelace', email: 'ada@example.com', note: 'hi' } });
  });
  it('enforces the caps and the email shape', () => {
    expect(validateGuest({ name: '', email: 'a@b.co' }).ok).toBe(false);
    expect(validateGuest({ name: 'x'.repeat(121), email: 'a@b.co' }).ok).toBe(false);
    expect(validateGuest({ name: 'A', email: 'not-an-email' }).ok).toBe(false);
    expect(validateGuest({ name: 'A', email: 'a@b.co', note: 'x'.repeat(1001) }).ok).toBe(false);
  });
});

describe('buildIcs', () => {
  const now = utc('2026-07-01T06:00:00Z');
  const events = [ev({ id: 'b', start_min: 720, end_min: 750 }), ev({ id: 'a', start_min: 600, end_min: 660 })];

  it('emits UTC busy blocks with stable UIDs and CRLF', () => {
    const ics = buildIcs(events, { timeZone: ROME, now });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
    expect(ics).toContain('UID:a@orra\r\nDTSTAMP:20260701T060000Z\r\nDTSTART:20260701T080000Z\r\nDTEND:20260701T090000Z');
    expect(ics.indexOf('UID:a@orra')).toBeLessThan(ics.indexOf('UID:b@orra'));
    expect(ics.match(/SUMMARY:Busy \(ORRA\)/g)).toHaveLength(2);
  });

  it('is byte-identical for identical input', () => {
    expect(buildIcs(events, { timeZone: ROME, now })).toBe(buildIcs([...events].reverse(), { timeZone: ROME, now }));
  });

  it('folds long lines at 75 octets without splitting characters', () => {
    const long = `X-WR-CALNAME:${'é'.repeat(60)}`;
    const folded = foldLine(long);
    const enc = new TextEncoder();
    for (const piece of folded.split('\r\n')) expect(enc.encode(piece).length).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n').map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(long);
  });
});
