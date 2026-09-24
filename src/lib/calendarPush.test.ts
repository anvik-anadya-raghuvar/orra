import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataAdapter } from '../data/adapter';
import { seedDataset } from '../data/seed';
import { AppStore, today } from '../data/store';
import type { DayEvent, IntegrationGrant } from '../types';
import type { PushedEvent } from './google';
import { SCOPES, adoptAccountToken } from './google';
import { localDateTime, planPush, pushCalendar, pushableEvents, toPushBody, type WantedBlock } from './calendarPush';
import { syncCalendarWindow } from './googleSync';

const ev = (over: Partial<DayEvent>): DayEvent => ({
  id: 'de-1',
  user_id: 'u-anadya',
  date: '2026-09-25',
  start_min: 840,
  end_min: 960,
  label: 'Deep work',
  kind: 'focus',
  task_id: null,
  ...over,
});

describe('which blocks go to Google', () => {
  const window = ['2026-09-24', '2026-11-23'] as const;

  it('sends your own blocks and shared ones', () => {
    const out = pushableEvents(
      [ev({ id: 'mine' }), ev({ id: 'shared', user_id: null }), ev({ id: 'theirs', user_id: 'u-raghuvar' })],
      'u-anadya',
      ...window,
    );
    expect(out.map((e) => e.id)).toEqual(['mine', 'shared']);
  });

  it('never echoes back an event that came from Google', () => {
    const out = pushableEvents(
      [ev({ id: 'gcal-x', integration_grant_id: 'ig-1', external_event_id: 'x', kind: 'meeting' })],
      'u-anadya',
      ...window,
    );
    expect(out).toEqual([]);
  });

  it('leaves reminders out — a ping is not busy time', () => {
    expect(pushableEvents([ev({ kind: 'reminder' })], 'u-anadya', ...window)).toEqual([]);
  });

  it('holds your own proposal, but not theirs until you accept it', () => {
    const mine = ev({ id: 'proposed', invitee_id: 'u-raghuvar', created_by: 'u-anadya' });
    const theirs = ev({ id: 'invited', user_id: 'u-raghuvar', invitee_id: 'u-anadya', created_by: 'u-raghuvar' });
    const accepted = { ...theirs, id: 'accepted', confirmed_at: '2026-09-24T08:00:00Z' };
    expect(pushableEvents([mine, theirs, accepted], 'u-anadya', ...window).map((e) => e.id)).toEqual([
      'accepted',
      'proposed',
    ]);
  });

  it('only looks at the window', () => {
    const out = pushableEvents(
      [ev({ id: 'past', date: '2026-09-23' }), ev({ id: 'far', date: '2026-12-01' })],
      'u-anadya',
      ...window,
    );
    expect(out).toEqual([]);
  });
});

describe('what a block looks like in Google', () => {
  it('writes local wall-clock times, rolling midnight to the next day', () => {
    expect(localDateTime('2026-09-25', 840)).toBe('2026-09-25T14:00:00');
    expect(localDateTime('2026-09-25', 0)).toBe('2026-09-25T00:00:00');
    expect(localDateTime('2026-09-30', 1440)).toBe('2026-10-01T00:00:00');
  });

  it('tags the event so it can be found again and names who it is with', () => {
    const body = toPushBody(ev({}), 'Asia/Kolkata', 'Raghuvar');
    expect(body.summary).toBe('Deep work · with Raghuvar');
    expect(body.start).toEqual({ dateTime: '2026-09-25T14:00:00', timeZone: 'Asia/Kolkata' });
    expect(body.extendedProperties.private).toEqual({ orra: '1', orraId: 'de-1' });
    expect(body.reminders).toEqual({ useDefault: false });
  });
});

describe('the diff', () => {
  const block = (orraId: string, summary = 'Deep work', startMs = 1000, endMs = 2000): WantedBlock => ({
    orraId,
    body: { ...toPushBody(ev({ id: orraId }), 'UTC'), summary },
    startMs,
    endMs,
  });
  const pushed = (googleId: string, orraId: string, summary = 'Deep work', start = 1000, end = 2000): PushedEvent => ({
    googleId,
    orraId,
    summary,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
  });

  it('does nothing when Google already matches', () => {
    expect(planPush([block('a')], [pushed('g1', 'a')])).toEqual({ create: [], update: [], remove: [] });
  });

  it('creates the missing, updates the moved, removes the gone', () => {
    const plan = planPush(
      [block('new'), block('moved', 'Deep work', 5000, 6000), block('renamed', 'Call')],
      [pushed('g1', 'moved'), pushed('g2', 'renamed'), pushed('g3', 'deleted')],
    );
    expect(plan.create.map((b) => b.orraId)).toEqual(['new']);
    expect(plan.update.map((u) => u.googleId)).toEqual(['g1', 'g2']);
    expect(plan.remove).toEqual(['g3']);
  });

  it('removes a duplicate left by an interrupted run', () => {
    expect(planPush([block('a')], [pushed('g1', 'a'), pushed('g2', 'a')]).remove).toEqual(['g2']);
  });
});

/* ── against a stubbed Google ───────────────────────────────────────── */

const adapter: DataAdapter = {
  kind: 'mock',
  async load() { return seedDataset(); },
  saveCollection() {},
  saveWeights() {},
};

const grant: IntegrationGrant = {
  id: 'ig-push',
  user_id: 'u-anadya',
  provider: 'google',
  google_subject: 'subject-push',
  account_email: 'a@example.com',
  display_name: 'a@example.com',
  scopes: [SCOPES.calendar],
  connected_at: '2026-08-01T00:00:00.000Z',
  last_sync_at: null,
  is_active: true,
  gmail_history_id: null,
  initial_mail_scan_at: null,
  last_sync_error: null,
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/** A tiny in-memory primary calendar speaking just enough of the API. */
function fakeCalendar() {
  const events = new Map<string, Record<string, unknown>>();
  let seq = 0;
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push(method);
    const id = /\/events\/([^?]+)/.exec(url)?.[1];
    if (method === 'GET') {
      const onlyOrra = url.includes('privateExtendedProperty=orra%3D1');
      const items = [...events.values()].filter(
        (e) => !onlyOrra || (e.extendedProperties as { private?: Record<string, string> })?.private?.orra === '1',
      );
      return json({ items });
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init!.body));
      const googleId = `g${++seq}`;
      events.set(googleId, { ...body, id: googleId, start: body.start, end: body.end });
      return json(events.get(googleId));
    }
    if (method === 'PUT') {
      events.set(id!, { ...JSON.parse(String(init!.body)), id });
      return json(events.get(id!));
    }
    if (method === 'DELETE') {
      events.delete(id!);
      return new Response(null, { status: 204 });
    }
    return json({}, 400);
  });
  return { events, calls, fetchMock };
}

const makeStore = (dayEvents: DayEvent[]) => {
  const ds = seedDataset();
  ds.integration_grants = [grant];
  ds.day_events = dayEvents;
  const store = new AppStore(ds, adapter, 'u-anadya');
  adoptAccountToken(grant.id, { token: 't', expiresAt: Date.now() + 600_000, scopes: new Set([SCOPES.calendar]) });
  return store;
};

afterEach(() => vi.unstubAllGlobals());

describe('pushing to Google', () => {
  it('writes blocks once, then converges on edits and deletes', async () => {
    const cal = fakeCalendar();
    vi.stubGlobal('fetch', cal.fetchMock);
    const store = makeStore([ev({ id: 'b1', date: today() }), ev({ id: 'r1', date: today(), kind: 'reminder' })]);

    expect(await pushCalendar(store, grant.id)).toEqual({ created: 1, updated: 0, removed: 0 });
    expect(cal.events.size).toBe(1);

    // Nothing changed: a second run lists and writes nothing.
    cal.calls.length = 0;
    expect(await pushCalendar(store, grant.id)).toEqual({ created: 0, updated: 0, removed: 0 });
    expect(cal.calls).toEqual(['GET']);

    store.update('day_events', 'b1', { start_min: 900 }, store.asMe({ silent: true }));
    expect(await pushCalendar(store, grant.id)).toEqual({ created: 0, updated: 1, removed: 0 });

    store.remove('day_events', 'b1', store.asMe({ silent: true }));
    expect(await pushCalendar(store, grant.id)).toEqual({ created: 0, updated: 0, removed: 1 });
    expect(cal.events.size).toBe(0);
  });

  it('runs one push at a time, so overlapping triggers cannot double-create', async () => {
    const cal = fakeCalendar();
    vi.stubGlobal('fetch', cal.fetchMock);
    const store = makeStore([ev({ id: 'b1', date: today() })]);
    await Promise.all([pushCalendar(store, grant.id), pushCalendar(store, grant.id)]);
    expect(cal.events.size).toBe(1);
  });

  it('the read sync does not mirror ORRA’s own blocks back as meetings', async () => {
    const cal = fakeCalendar();
    vi.stubGlobal('fetch', cal.fetchMock);
    const store = makeStore([ev({ id: 'b1', date: today() })]);
    await pushCalendar(store, grant.id);
    const result = await syncCalendarWindow(store, grant, today(), today());
    expect(result.eventsNew).toBe(0);
    expect(store.ds.day_events.map((e) => e.id)).toEqual(['b1']);
  });
});
