/**
 * One "sync all connectors" path.
 *
 * `google.ts` knows how to talk to Google. This knows what to do with what
 * comes back: it maps Gmail into `mail_items`, today's calendar into
 * `day_events`, and records the granted scopes in `integration_grants` so the
 * Connections screen can be honest about what is actually wired.
 *
 * Three rules this file exists to keep:
 *
 *  1. **Idempotent.** Row ids are derived from the Google id (`gm-<id>`,
 *     `gcal-<id>`), so syncing twice updates rather than duplicates.
 *  2. **Never clobber your work.** A mail row you converted to a task keeps
 *     its conversion, flag, and project on every later sync.
 *  3. **One audit line per sync, not fifty.** Row churn is written silently;
 *     the sync itself is recorded by touching `last_sync_at` on the grant,
 *     which produces exactly one append-only trail entry.
 */

import type { AppStore } from '../data/store';
import { nowIso, today } from '../data/store';
import type { DayEvent, MailItem, UserId } from '../types';
import type { CalendarEvent, GmailMessage } from './google';
import {
  SCOPES,
  fetchCalendarRange,
  fetchGmail,
  forgetToken,
  getToken,
  googleConfigured,
  hasLiveToken,
} from './google';

/** Everything the portal asks for, requested together so consent happens once. */
export const ALL_SCOPES = ['gmail', 'calendar', 'drive'] as const;

export interface SyncResult {
  mailNew: number;
  mailKnown: number;
  eventsNew: number;
  eventsDropped: number;
  scopes: string[];
}

const grantId = (store: AppStore) => `ig-${store.meId}-google`;

/** The stored grant for the signed-in user, or null when never connected. */
export function googleGrant(store: AppStore) {
  return store.ds.integration_grants.find((g) => g.id === grantId(store)) ?? null;
}

export const hasScope = (store: AppStore, key: keyof typeof SCOPES) =>
  googleGrant(store)?.scopes.includes(SCOPES[key]) ?? false;

/** Minutes from midnight, local — the unit the day ribbon already speaks. */
const toMin = (iso: string) => {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes();
};

function recordGrant(store: AppStore, scopes: string[], synced: boolean) {
  const existing = googleGrant(store);
  if (!existing) {
    store.insert(
      'integration_grants',
      {
        id: grantId(store),
        user_id: store.meId,
        provider: 'google',
        scopes,
        connected_at: nowIso(),
        last_sync_at: synced ? nowIso() : null,
      },
      store.asMe({ summary: `Google connected — ${scopes.length} scopes granted` }),
    );
    return;
  }
  store.update(
    'integration_grants',
    existing.id,
    synced ? { scopes, last_sync_at: nowIso() } : { scopes },
    store.asMe(),
  );
}

/**
 * Ask Google for everything at once. `interactive: false` tries a silent
 * re-grant, which is how a returning session reconnects without a popup.
 */
export async function connectGoogle(
  store: AppStore,
  { interactive = true }: { interactive?: boolean } = {},
): Promise<boolean> {
  if (!googleConfigured()) throw new Error('VITE_GOOGLE_CLIENT_ID is not set');
  const token = await getToken([...ALL_SCOPES], { interactive });
  if (!token) return false;
  recordGrant(store, ALL_SCOPES.map((k) => SCOPES[k]), false);
  return true;
}

/**
 * The silent re-grant, attempted at most once per page load.
 *
 * Google Identity Services still reaches for a popup even with `prompt: none`,
 * so retrying it on every mount means a window flashing each time you open
 * Connections. One attempt per session is enough: if it works the token is
 * cached, and if it doesn't the UI says so and the next sync asks properly.
 */
let silentTried = false;
export async function trySilentConnect(store: AppStore): Promise<boolean> {
  if (silentTried) return hasLiveToken();
  silentTried = true;
  try {
    return await connectGoogle(store, { interactive: false });
  } catch {
    return false;
  }
}

export function disconnectGoogle(store: AppStore) {
  silentTried = false;
  forgetToken();
  const g = googleGrant(store);
  if (g) store.remove('integration_grants', g.id, store.asMe({ summary: 'Google disconnected' }));
}

/* ── Gmail → mail_items ──────────────────────────────────────────────── */

/** Pure mapping, exported so the idempotence rules are testable. */
export function toMailRow(m: GmailMessage, accountEmail: string, prior?: MailItem): MailItem {
  return {
    id: `gm-${m.id}`,
    account_email: accountEmail,
    sender: m.from,
    subject: m.subject,
    snippet: m.snippet,
    received_at: m.receivedAt,
    gmail_link: m.link,
    // Rule 2: these are yours, and a re-sync must never touch them.
    flag_reason: prior?.flag_reason ?? null,
    project_id: prior?.project_id ?? null,
    converted_to_type: prior?.converted_to_type ?? null,
    converted_to_id: prior?.converted_to_id ?? null,
  };
}

async function syncMail(store: AppStore): Promise<{ mailNew: number; mailKnown: number }> {
  const messages = await fetchGmail(20);
  const existing = new Map(store.ds.mail_items.map((m) => [m.id, m]));
  let mailNew = 0;
  let mailKnown = 0;

  for (const m of messages) {
    const prior = existing.get(`gm-${m.id}`);
    if (prior) {
      mailKnown += 1;
      continue;
    }
    store.insert('mail_items', toMailRow(m, store.me.email), store.asMe({ silent: true }));
    mailNew += 1;
  }
  return { mailNew, mailKnown };
}

/* ── Calendar → day_events ───────────────────────────────────────────── */

/** Pure mapping, exported for the same reason as `toMailRow`. */
export function toDayEvent(e: CalendarEvent, userId: UserId, dayIso: string): DayEvent {
  return {
    id: `gcal-${e.id}`,
    user_id: userId,
    date: dayIso,
    start_min: e.allDay ? 0 : toMin(e.start),
    end_min: e.allDay ? 1439 : toMin(e.end),
    label: e.summary,
    kind: 'meeting',
    task_id: null,
  };
}

/** How far the rolling window reaches. Back far enough to keep last week's
 *  calendar honest, forward far enough that a month view is populated. */
export const SYNC_BACK_DAYS = 7;
export const SYNC_FWD_DAYS = 30;

export const shiftDay = (iso: string, days: number): string =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

/** The local date an event belongs to. Multi-day events land on their start. */
export const eventDay = (e: CalendarEvent): string => e.start.slice(0, 10);

/**
 * Sync a window of days in one pass.
 *
 * This used to fetch a single day, so the Work calendar and timeline had
 * nothing from Google in them at all and next week was always empty. Deletion
 * is still confined to rows this sync created *and* to dates inside the
 * window — outside it we have not asked Google what exists, and deleting on
 * the strength of an answer nobody gave would silently eat last month.
 */
export async function syncCalendarWindow(
  store: AppStore,
  fromIso: string,
  toIso: string,
): Promise<{ eventsNew: number; eventsDropped: number }> {
  const events = await fetchCalendarRange(fromIso, toIso);
  const live = new Set(events.map((e) => `gcal-${e.id}`));
  let eventsNew = 0;

  for (const e of events) {
    const id = `gcal-${e.id}`;
    const row = toDayEvent(e, store.meId, eventDay(e));
    const prior = store.ds.day_events.find((x) => x.id === id);
    if (prior) {
      store.update('day_events', id, row, store.asMe({ silent: true }));
    } else {
      store.insert('day_events', row, store.asMe({ silent: true }));
      eventsNew += 1;
    }
  }

  // A meeting cancelled in Google has to disappear here too, or the calendar
  // quietly lies about the week.
  const stale = store.ds.day_events.filter(
    (x) =>
      x.id.startsWith('gcal-') &&
      x.date >= fromIso &&
      x.date <= toIso &&
      x.user_id === store.meId &&
      !live.has(x.id),
  );
  for (const s of stale) store.remove('day_events', s.id, store.asMe({ silent: true }));

  return { eventsNew, eventsDropped: stale.length };
}

/* ── the one button ──────────────────────────────────────────────────── */

/**
 * Sync every connector that can be synced, in one consent and one pass.
 *
 * Drive is deliberately not pulled wholesale: `documents` tracks references
 * with expiry dates you set, so a dump of your Drive would be noise. The Drive
 * grant powers search-and-attach in the Documents tab instead.
 */
export async function syncAll(store: AppStore): Promise<SyncResult> {
  if (!googleConfigured()) throw new Error('VITE_GOOGLE_CLIENT_ID is not set');
  const token = await getToken([...ALL_SCOPES]);
  if (!token) throw new Error('Google access was not granted');

  const from = shiftDay(today(), -SYNC_BACK_DAYS);
  const to = shiftDay(today(), SYNC_FWD_DAYS);
  const [mail, cal] = await Promise.all([syncMail(store), syncCalendarWindow(store, from, to)]);
  const scopes = ALL_SCOPES.map((k) => SCOPES[k]);
  recordGrant(store, scopes, true);

  return { ...mail, ...cal, scopes };
}

/** Human summary for the toast — says nothing happened when nothing did. */
export function describeSync(r: SyncResult): string {
  const bits: string[] = [];
  if (r.mailNew) bits.push(`${r.mailNew} new mail`);
  if (r.eventsNew) bits.push(`${r.eventsNew} event${r.eventsNew === 1 ? '' : 's'}`);
  if (r.eventsDropped) bits.push(`${r.eventsDropped} cancelled`);
  return bits.length ? `Synced — ${bits.join(', ')}` : 'Synced — nothing new';
}
