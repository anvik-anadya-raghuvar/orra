import { describe, expect, it } from 'vitest';
import { toDayEvent, toMailRow } from './googleSync';
import type { CalendarEvent, GmailMessage } from './google';
import type { MailItem } from '../types';

const msg: GmailMessage = {
  id: '18f2a',
  from: 'Studio <studio@example.com>',
  subject: 'Invoice for August',
  snippet: 'Attached is the invoice…',
  receivedAt: '2026-08-18T09:12:00.000Z',
  link: 'https://mail.google.com/mail/u/0/#inbox/18f2a',
};

describe('Gmail → mail_items', () => {
  it('derives the row id from the Gmail id, so a re-sync cannot duplicate', () => {
    expect(toMailRow(msg, 'a@b.com').id).toBe('gm-18f2a');
    expect(toMailRow(msg, 'a@b.com')).toEqual(toMailRow(msg, 'a@b.com'));
  });

  it('never clobbers work done on a message that was already synced', () => {
    const prior: MailItem = {
      ...toMailRow(msg, 'a@b.com'),
      flag_reason: 'money',
      project_id: 'anvik',
      converted_to_type: 'task',
      converted_to_id: 'T-104',
    };
    const after = toMailRow({ ...msg, snippet: 'Gmail shortened this' }, 'a@b.com', prior);
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
    const row = toDayEvent(e, 'u-anadya', '2026-08-18');
    expect(row).toMatchObject({
      id: 'gcal-evt1',
      start_min: 9 * 60 + 30,
      end_min: 600,
      kind: 'meeting',
      label: 'Standup',
      date: '2026-08-18',
      task_id: null,
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
    const row = toDayEvent(e, 'u-anadya', '2026-08-18');
    expect(row.start_min).toBe(0);
    expect(row.end_min).toBe(1439);
  });
});
