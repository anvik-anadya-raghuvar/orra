import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataAdapter } from '../data/adapter';
import { seedDataset } from '../data/seed';
import { AppStore } from '../data/store';
import type { IntegrationGrant } from '../types';
import { SCOPES, adoptAccountToken } from './google';
import { reactivateGoogleGrant, syncCalendarWindow, syncOrders } from './googleSync';

const adapter: DataAdapter = {
  kind: 'mock',
  async load() { return seedDataset(); },
  saveCollection() {},
  saveWeights() {},
};

const account = (id: string, email: string): IntegrationGrant => ({
  id,
  user_id: 'u-anadya',
  provider: 'google',
  google_subject: `subject-${id}`,
  account_email: email,
  display_name: email,
  scopes: [SCOPES.gmail, SCOPES.calendar, SCOPES.drive],
  connected_at: '2026-08-01T00:00:00.000Z',
  last_sync_at: null,
  is_active: true,
  gmail_history_id: null,
  initial_mail_scan_at: null,
  last_sync_error: null,
});
const makeStore = (...accounts: IntegrationGrant[]) => {
  const ds = seedDataset();
  ds.integration_grants = accounts;
  ds.day_events = [];
  ds.personal_orders = [];
  ds.personal_order_events = [];
  return new AppStore(ds, adapter, 'u-anadya');
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('Google account state', () => {
  it('reactivates the saved identity without creating another account row', () => {
    const saved = { ...account('ig-reactivate', 'old@example.com'), is_active: false, last_sync_error: 'expired' };
    const store = makeStore(saved);
    const updated = reactivateGoogleGrant(
      store,
      saved,
      { subject: saved.google_subject!, email: 'old@example.com', name: 'Old Account' },
      [SCOPES.gmail],
    );
    expect(store.ds.integration_grants).toHaveLength(1);
    expect(updated).toMatchObject({ is_active: true, display_name: 'Old Account', last_sync_error: null });
  });
});

describe('Gmail catch-up and history recovery', () => {
  it('uses a bounded 30-day candidate query on first connection', async () => {
    const saved = account('ig-backfill', 'backfill@example.com');
    const store = makeStore(saved);
    adoptAccountToken(saved.id, {
      token: 'gmail-backfill-token',
      expiresAt: Date.now() + 600_000,
      scopes: new Set([SCOPES.gmail]),
    });
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/profile')) return json({ emailAddress: saved.account_email, historyId: 'history-new' });
      return json({ messages: [] });
    }));

    const result = await syncOrders(store, saved);
    const candidate = urls.find((url) => url.includes('/messages?'))!;
    expect(new URL(candidate).searchParams.get('q')).toContain('newer_than:30d');
    expect(result).toMatchObject({ initialScan: true, historyId: 'history-new' });
  });

  it('falls back to the same catch-up when Gmail history has expired', async () => {
    const saved = {
      ...account('ig-expired-history', 'history@example.com'),
      initial_mail_scan_at: '2026-08-01T00:00:00.000Z',
      gmail_history_id: 'history-old',
    };
    const store = makeStore(saved);
    adoptAccountToken(saved.id, {
      token: 'gmail-history-token',
      expiresAt: Date.now() + 600_000,
      scopes: new Set([SCOPES.gmail]),
    });
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/history?')) return json({ error: 'history expired' }, 404);
      if (url.endsWith('/profile')) return json({ emailAddress: saved.account_email, historyId: 'history-recovered' });
      return json({ messages: [] });
    }));

    const result = await syncOrders(store, saved);
    expect(urls.some((url) => url.includes('/history?'))).toBe(true);
    expect(urls.some((url) => new URL(url).searchParams.get('q')?.includes('newer_than:30d'))).toBe(true);
    expect(result).toMatchObject({ initialScan: true, historyId: 'history-recovered' });
  });
});

describe('calendar account boundaries', () => {
  it('removes cancellations only from the account being synced', async () => {
    const a = account('ig-calendar-a', 'a@example.com');
    const b = account('ig-calendar-b', 'b@example.com');
    const store = makeStore(a, b);
    store.ds.day_events = [
      {
        id: 'gcal-ig-calendar-a-shared-id', user_id: 'u-anadya', date: '2026-08-19',
        start_min: 600, end_min: 660, label: 'A event', kind: 'meeting', task_id: null,
        integration_grant_id: a.id, external_event_id: 'shared-id', account_email: a.account_email, source_url: null,
      },
      {
        id: 'gcal-ig-calendar-b-shared-id', user_id: 'u-anadya', date: '2026-08-19',
        start_min: 600, end_min: 660, label: 'B event', kind: 'meeting', task_id: null,
        integration_grant_id: b.id, external_event_id: 'shared-id', account_email: b.account_email, source_url: null,
      },
    ];
    adoptAccountToken(a.id, {
      token: 'calendar-token-a',
      expiresAt: Date.now() + 600_000,
      scopes: new Set([SCOPES.calendar]),
    });
    vi.stubGlobal('fetch', vi.fn(async () => json({ items: [] })));

    const result = await syncCalendarWindow(store, a, '2026-08-19', '2026-08-19');
    expect(result.eventsDropped).toBe(1);
    expect(store.ds.day_events.map((event) => event.integration_grant_id)).toEqual([b.id]);
  });
});
