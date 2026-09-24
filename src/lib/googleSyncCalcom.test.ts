import { describe, expect, it } from 'vitest';
import { isCalcomTwin } from './googleSync';
import type { CalendarEvent } from './google';
import type { DayEvent } from '../types';

const ME = 'u-anadya';

const booking = (over: Partial<DayEvent> = {}): DayEvent => ({
  id: 'calcom-abc',
  user_id: ME,
  date: '2026-09-25',
  start_min: 15 * 60,
  end_min: 15 * 60 + 30,
  label: 'Priya — Intro call',
  kind: 'meeting',
  task_id: null,
  external_event_id: 'calcom:abc',
  ...over,
});

// Zone-less local times, so the test means the same thing in any time zone.
const gEvent = (start: string, end: string, over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'g1',
  summary: 'Intro call between Anadya and Priya',
  start,
  end,
  allDay: false,
  link: 'https://calendar.google.com',
  orraId: null,
  ...over,
});

describe('isCalcomTwin', () => {
  it('skips the Google copy of a meeting the Cal.com webhook already added', () => {
    expect(isCalcomTwin([booking()], ME, gEvent('2026-09-25T15:00:00', '2026-09-25T15:30:00'))).toBe(true);
  });

  it('keeps a different meeting at another time', () => {
    expect(isCalcomTwin([booking()], ME, gEvent('2026-09-25T16:00:00', '2026-09-25T16:30:00'))).toBe(false);
  });

  it('ignores ordinary ORRA blocks and the other person’s bookings', () => {
    const plain = booking({ id: 'ev-1', external_event_id: null });
    const theirs = booking({ user_id: 'u-raghuvar' });
    expect(isCalcomTwin([plain, theirs], ME, gEvent('2026-09-25T15:00:00', '2026-09-25T15:30:00'))).toBe(false);
  });

  it('never matches an all-day event', () => {
    const allDay = gEvent('2026-09-25T00:00:00', '2026-09-25T23:59:59', { allDay: true });
    expect(isCalcomTwin([booking({ start_min: 0, end_min: 1439 })], ME, allDay)).toBe(false);
  });
});
