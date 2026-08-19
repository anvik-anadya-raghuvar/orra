import { describe, expect, it } from 'vitest';
import {
  SYNC_BACK_DAYS,
  SYNC_FWD_DAYS,
  eventDay,
  shiftDay,
  toDayEvent,
  toMailRow,
} from './googleSync';
import type { CalendarEvent, GmailMessage } from './google';
import type { MailItem } from '../types';

const msg: GmailMessage = {
  id: '18f2a',
  threadId: 'thread-1',
  historyId: 'history-1',
  from: 'Studio <studio@example.com>',
  subject: 'Invoice for August',
  snippet: 'Attached is the invoice…',
  receivedAt: '2026-08-18T09:12:00.000Z',
  link: 'https://mail.google.com/mail/u/0/#inbox/18f2a',
};
const account = { id: 'ig-personal', account_email: 'a@b.com' };

describe('Gmail → mail_items', () => {
  it('derives the row id from the Gmail id, so a re-sync cannot duplicate', () => {
    expect(toMailRow(msg, account, 'u-anadya').id).toBe('gm-ig-personal-18f2a');
    expect(toMailRow(msg, account, 'u-anadya')).toEqual(toMailRow(msg, account, 'u-anadya'));
  });

  it('uses the account id in composite ids when Gmail ids collide', () => {
    expect(toMailRow(msg, account, 'u-anadya').id).not.toBe(
      toMailRow(msg, { id: 'ig-work', account_email: 'work@example.com' }, 'u-anadya').id,
    );
  });

  it('never clobbers work done on a message that was already synced', () => {
    const prior: MailItem = {
      ...toMailRow(msg, account, 'u-anadya'),
      flag_reason: 'money',
      project_id: 'anvik',
      converted_to_type: 'task',
      converted_to_id: 'T-104',
    };
    const after = toMailRow({ ...msg, snippet: 'Gmail shortened this' }, account, 'u-anadya', prior);
    expect(after.converted_to_type).toBe('task');
    expect(after.converted_to_id).toBe('T-104');
    expect(after.flag_reason).toBe('money');
    expect(after.project_id).toBe('anvik');
    // Volatile fields still refresh from Google.
    expect(after.snippet).toBe('Gmail shortened this');
  });
});

describe('Calendar → day_events', () => {
  const at = (h: number, m: number) => `2026-08-18T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;

  it('converts local times to minutes from midnight', () => {
    const e: CalendarEvent = {
      id: 'evt1',
      summary: 'Standup',
      start: at(9, 30),
      end: at(10, 0),
      allDay: false,
      link: 'https://calendar.google.com/evt1',
    };
    const row = toDayEvent(e, 'u-anadya', '2026-08-18', account);
    expect(row).toMatchObject({
      id: 'gcal-ig-personal-evt1',
      start_min: 9 * 60 + 30,
      end_min: 600,
      kind: 'meeting',
      label: 'Standup',
      date: '2026-08-18',
      task_id: null,
      integration_grant_id: 'ig-personal',
      account_email: 'a@b.com',
    });
  });

  it('spans an all-day event across the whole ribbon', () => {
    const e: CalendarEvent = {
      id: 'evt2',
      summary: 'Ferragosto',
      start: '2026-08-18T00:00:00',
      end: '2026-08-18T23:59:59',
      allDay: true,
      link: 'https://calendar.google.com/evt2',
    };
    const row = toDayEvent(e, 'u-anadya', '2026-08-18', account);
    expect(row.start_min).toBe(0);
    expect(row.end_min).toBe(1439);
  });
});

describe('the rolling window', () => {
  it('walks days in both directions', () => {
    expect(shiftDay('2026-08-19', -7)).toBe('2026-08-12');
    expect(shiftDay('2026-08-19', 30)).toBe('2026-09-18');
  });

  it('crosses a month and a year boundary', () => {
    expect(shiftDay('2026-08-01', -1)).toBe('2026-07-31');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('files an event on its own start date, not the day the sync ran', () => {
    // the single-day sync used to stamp every row with "today", so a meeting
    // next Tuesday landed on this Tuesday's ribbon
    const e: CalendarEvent = {
      id: 'evt3',
      summary: 'Vendor call',
      start: '2026-08-25T11:00:00',
      end: '2026-08-25T12:00:00',
      allDay: false,
      link: 'https://calendar.google.com/evt3',
    };
    expect(eventDay(e)).toBe('2026-08-25');
    expect(toDayEvent(e, 'u-anadya', eventDay(e), account).date).toBe('2026-08-25');
  });

  it('covers 38 days by default, so a month view is never half empty', () => {
    const from = shiftDay('2026-08-19', -SYNC_BACK_DAYS);
    const to = shiftDay('2026-08-19', SYNC_FWD_DAYS);
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    expect(days).toBe(SYNC_BACK_DAYS + SYNC_FWD_DAYS);
  });
});
