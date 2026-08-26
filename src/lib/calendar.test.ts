import { describe, expect, it } from 'vitest';
import {
  awaitingMyConfirmation,
  clockToMinutes,
  countdownLabel,
  countdownsFor,
  daysBetween,
  dueReminders,
  eventsForDay,
  isMyEvent,
  isUnconfirmed,
  minutesToClock,
  pendingInvites,
} from './calendar';
import type { DayEvent, FixedDate } from '../types';

const ME = 'u-anadya';
const THEM = 'u-raghuvar';
const TODAY = '2026-08-26';

const ev = (over: Partial<DayEvent>): DayEvent =>
  ({
    id: 'e1',
    user_id: ME,
    date: TODAY,
    start_min: 600,
    end_min: 660,
    label: 'block',
    kind: 'focus',
    task_id: null,
    ...over,
  }) as DayEvent;

const fx = (over: Partial<FixedDate>): FixedDate =>
  ({ id: 'f1', label: 'Flight to Milan', date: TODAY, category: '', ...over }) as FixedDate;

describe('whose calendar an event lands on', () => {
  it('shows a shared event to everyone', () => {
    expect(isMyEvent(ev({ user_id: null }), ME)).toBe(true);
    expect(isMyEvent(ev({ user_id: null }), THEM)).toBe(true);
  });

  it('shows your own to you and not to them', () => {
    expect(isMyEvent(ev({ user_id: ME }), ME)).toBe(true);
    expect(isMyEvent(ev({ user_id: ME }), THEM)).toBe(false);
  });

  it('shows a block to the person tagged in it — the whole point of 0050', () => {
    // Without this, "let's talk at 4" sits on the proposer's calendar and is
    // invisible to the person it is actually about.
    const call = ev({ user_id: ME, invitee_id: THEM, kind: 'call' });
    expect(isMyEvent(call, THEM)).toBe(true);
    expect(isMyEvent(call, ME)).toBe(true);
  });

  it('orders a day earliest first', () => {
    const rows = [ev({ id: 'late', start_min: 900 }), ev({ id: 'early', start_min: 540 })];
    expect(eventsForDay(rows, ME, TODAY).map((e) => e.id)).toEqual(['early', 'late']);
  });

  it('leaves out other days', () => {
    expect(eventsForDay([ev({ date: '2026-08-27' })], ME, TODAY)).toEqual([]);
  });
});

describe('confirmation', () => {
  it('treats a tagged block with no confirmation as unconfirmed', () => {
    expect(isUnconfirmed(ev({ invitee_id: THEM }))).toBe(true);
    expect(isUnconfirmed(ev({ invitee_id: THEM, confirmed_at: '2026-08-26T10:00:00Z' }))).toBe(false);
  });

  it('never calls a solo block unconfirmed', () => {
    expect(isUnconfirmed(ev({ invitee_id: null }))).toBe(false);
  });

  it('asks the invitee, not the proposer', () => {
    const invite = ev({ user_id: ME, created_by: ME, invitee_id: THEM });
    expect(awaitingMyConfirmation(invite, THEM)).toBe(true);
    expect(awaitingMyConfirmation(invite, ME)).toBe(false);
  });

  it('does not ask you to accept your own proposal', () => {
    // Blocking time with someone and then being asked to accept it yourself
    // is what makes a calendar feel like paperwork.
    const selfInvite = ev({ user_id: ME, created_by: ME, invitee_id: ME });
    expect(awaitingMyConfirmation(selfInvite, ME)).toBe(false);
  });

  it('lists pending invites soonest first and ignores past ones', () => {
    const rows = [
      ev({ id: 'later', date: '2026-08-28', created_by: ME, invitee_id: THEM }),
      ev({ id: 'sooner', date: '2026-08-27', created_by: ME, invitee_id: THEM }),
      ev({ id: 'past', date: '2026-08-01', created_by: ME, invitee_id: THEM }),
    ];
    expect(pendingInvites(rows, THEM, TODAY).map((e) => e.id)).toEqual(['sooner', 'later']);
  });
});

describe('clock conversion', () => {
  it('formats minutes as a padded 24-hour clock', () => {
    expect(minutesToClock(0)).toBe('00:00');
    expect(minutesToClock(545)).toBe('09:05');
    expect(minutesToClock(1439)).toBe('23:59');
  });

  it('round-trips', () => {
    expect(clockToMinutes(minutesToClock(742))).toBe(742);
  });

  it('returns null for a half-typed time rather than calling it midnight', () => {
    // Coercing junk to 0 would silently schedule things at 00:00.
    expect(clockToMinutes('')).toBeNull();
    expect(clockToMinutes('9')).toBeNull();
    expect(clockToMinutes('25:00')).toBeNull();
    expect(clockToMinutes('10:75')).toBeNull();
  });
});

describe('countdowns', () => {
  it('counts whole days in both directions', () => {
    expect(daysBetween(TODAY, '2026-08-29')).toBe(3);
    expect(daysBetween(TODAY, TODAY)).toBe(0);
    expect(daysBetween(TODAY, '2026-08-25')).toBe(-1);
  });

  it('reads naturally at the boundaries', () => {
    expect(countdownLabel(0)).toBe('today');
    expect(countdownLabel(1)).toBe('tomorrow');
    expect(countdownLabel(-1)).toBe('yesterday');
    expect(countdownLabel(5)).toBe('in 5 days');
    expect(countdownLabel(-5)).toBe('5 days ago');
  });

  it('shows shared dates to both, and private ones only to their owner', () => {
    const rows = [fx({ id: 'shared', owner_id: null }), fx({ id: 'mine', owner_id: ME })];
    expect(countdownsFor(rows, THEM, TODAY).map((c) => c.date.id)).toEqual(['shared']);
    expect(countdownsFor(rows, ME, TODAY).map((c) => c.date.id).sort()).toEqual(['mine', 'shared']);
  });

  it('sorts nearest first', () => {
    const rows = [
      fx({ id: 'far', date: '2026-09-10' }),
      fx({ id: 'near', date: '2026-08-27' }),
    ];
    expect(countdownsFor(rows, ME, TODAY).map((c) => c.date.id)).toEqual(['near', 'far']);
  });

  it('keeps yesterday but drops anything older', () => {
    const rows = [fx({ id: 'yday', date: '2026-08-25' }), fx({ id: 'old', date: '2026-08-01' })];
    expect(countdownsFor(rows, ME, TODAY).map((c) => c.date.id)).toEqual(['yday']);
  });

  it('can narrow to the pinned ones for Home', () => {
    const rows = [fx({ id: 'pin', pinned_home: true }), fx({ id: 'unpinned' })];
    expect(countdownsFor(rows, ME, TODAY, { pinnedOnly: true }).map((c) => c.date.id)).toEqual(['pin']);
  });
});

describe('reminders', () => {
  const withReminder = (over: Partial<DayEvent>) =>
    ev({ start_min: 600, remind_min_before: 15, ...over });

  it('is due once the lead time is reached', () => {
    expect(dueReminders([withReminder({})], ME, TODAY, 585).map((e) => e.id)).toEqual(['e1']);
  });

  it('is not due before then', () => {
    expect(dueReminders([withReminder({})], ME, TODAY, 584)).toEqual([]);
  });

  it('never fires twice', () => {
    const fired = withReminder({ reminded_at: '2026-08-26T09:45:00Z' });
    expect(dueReminders([fired], ME, TODAY, 590)).toEqual([]);
  });

  it('ignores events with no reminder set', () => {
    expect(dueReminders([ev({ remind_min_before: null })], ME, TODAY, 1200)).toEqual([]);
  });

  it('drops one that is more than an hour stale rather than firing it late', () => {
    // A reminder arriving well after the thing it was for is worse than one
    // that never arrives.
    expect(dueReminders([withReminder({ start_min: 400 })], ME, TODAY, 600)).toEqual([]);
  });

  it('only looks at today', () => {
    expect(dueReminders([withReminder({ date: '2026-08-27' })], ME, TODAY, 1400)).toEqual([]);
  });

  it('fires for a block somebody else put you in', () => {
    const call = withReminder({ user_id: THEM, invitee_id: ME, kind: 'call' });
    expect(dueReminders([call], ME, TODAY, 590).map((e) => e.id)).toEqual(['e1']);
  });
});
