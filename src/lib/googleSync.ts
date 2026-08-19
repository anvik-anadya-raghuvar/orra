/** Account-aware Google sync and persistence orchestration. */
import type { AppStore } from '../data/store';
import { newId, nowIso, today } from '../data/store';
import type { DayEvent, IntegrationGrant, MailItem, UserId } from '../types';
import type { CalendarEvent, GmailMessage, GmailRawMessage, ScopeKey } from './google';
import {
  GoogleApiError,
  SCOPES,
  adoptAccountToken,
  connectGoogleIdentity,
  extractGmailBodies,
  fetchCalendarRange,
  fetchGmailCandidateIds,
  fetchGmailHistory,
  fetchGmailInbox,
  fetchGmailMessage,
  forgetAccountToken,
  getGmailProfile,
  googleConfigured,
  grantedAccountScopes,
  hasLiveAccountToken,
  isCommerceEnvelope,
  reconnectAccountToken,
  toGmailMessage,
} from './google';
import { detectPersonalOrder, recordOrderDetection } from './personalOrders';

export const ALL_SCOPES: ScopeKey[] = ['gmail', 'calendar', 'drive'];
export const AUTO_SYNC_MIN_GAP_MS = 15 * 60 * 1000;
export const SYNC_BACK_DAYS = 7;
export const SYNC_FWD_DAYS = 30;

export interface AccountSyncResult {
  accountId: string;
  accountEmail: string;
  mailNew: number;
  mailKnown: number;
  orderReviewsNew: number;
  orderUpdates: number;
  eventsNew: number;
  eventsDropped: number;
}

export interface SyncResult {
  accounts: AccountSyncResult[];
  skippedAccountIds: string[];
  mailNew: number;
  orderReviewsNew: number;
  orderUpdates: number;
  eventsNew: number;
  eventsDropped: number;
}

export const googleAccounts = (store: AppStore): IntegrationGrant[] =>
  store.ds.integration_grants
    .filter((grant) => grant.user_id === store.meId && grant.provider === 'google')
    .sort((a, b) => (a.account_email ?? '').localeCompare(b.account_email ?? ''));

export const activeGoogleAccounts = (store: AppStore): IntegrationGrant[] =>
  googleAccounts(store).filter((grant) => grant.is_active !== false);

/** Compatibility for existing status surfaces: the first active account. */
export const googleGrant = (store: AppStore): IntegrationGrant | null =>
  activeGoogleAccounts(store)[0] ?? null;

export const hasScope = (
  store: AppStore,
  key: keyof typeof SCOPES,
  accountId?: string,
): boolean => {
  const accounts = accountId
    ? activeGoogleAccounts(store).filter((grant) => grant.id === accountId)
    : activeGoogleAccounts(store);
  return accounts.some((grant) => grant.scopes.includes(SCOPES[key]));
};

export const hasLiveGoogleAccount = (accountId: string) =>
  hasLiveAccountToken(accountId, ALL_SCOPES);

/** The persistence half of a successful reconnect. Kept pure from OAuth so
 * identity/reactivation behavior is independently testable. */
export function reactivateGoogleGrant(
  store: AppStore,
  account: IntegrationGrant,
  identity: { subject: string; email: string; name: string },
  scopes: string[],
): IntegrationGrant {
  return updateGrant(store, account, {
    google_subject: identity.subject,
    account_email: identity.email,
    display_name: identity.name,
    scopes: [...scopes],
    is_active: true,
    last_sync_error: null,
  });
}

function updateGrant(store: AppStore, grant: IntegrationGrant, patch: Partial<IntegrationGrant>) {
  store.update('integration_grants', grant.id, patch, store.asMe({ silent: true }));
  return { ...grant, ...patch };
}

export async function connectGoogleAccount(
  store: AppStore,
): Promise<{ account: IntegrationGrant; result: AccountSyncResult }> {
  if (!googleConfigured()) throw new Error('VITE_GOOGLE_CLIENT_ID is not set');
  const connected = await connectGoogleIdentity(ALL_SCOPES);
  const email = connected.identity.email.toLowerCase();
  let account = googleAccounts(store).find(
    (grant) =>
      grant.google_subject === connected.identity.subject ||
      grant.account_email?.toLowerCase() === email,
  );

  if (account) {
    account = reactivateGoogleGrant(store, account, connected.identity, [...connected.token.scopes]);
  } else {
    account = {
      id: newId('ig'),
      user_id: store.meId,
      provider: 'google',
      google_subject: connected.identity.subject,
      account_email: connected.identity.email,
      display_name: connected.identity.name,
      scopes: [...connected.token.scopes],
      connected_at: nowIso(),
      last_sync_at: null,
      is_active: true,
      gmail_history_id: null,
      initial_mail_scan_at: null,
      last_sync_error: null,
    };
    store.insert(
      'integration_grants',
      account,
      store.asMe({ summary: `Google account connected — ${connected.identity.email}` }),
    );
  }
  adoptAccountToken(account.id, connected.token);
  return { account, result: await syncGoogleAccount(store, account.id) };
}

export async function reconnectGoogleAccount(
  store: AppStore,
  accountId: string,
): Promise<{ account: IntegrationGrant; result: AccountSyncResult }> {
  const account = googleAccounts(store).find((grant) => grant.id === accountId);
  if (!account) throw new Error('Google account is no longer connected');
  if (!account.account_email) throw new Error('This legacy connection has no email; use Add Google account once');
  const connected = await reconnectAccountToken(account.id, account.account_email, ALL_SCOPES);
  if (account.google_subject && account.google_subject !== connected.identity.subject) {
    forgetAccountToken(account.id);
    throw new Error(`Google opened ${connected.identity.email}; reconnect ${account.account_email} instead`);
  }
  if (!account.google_subject && account.account_email.toLowerCase() !== connected.identity.email.toLowerCase()) {
    forgetAccountToken(account.id);
    throw new Error(`Google opened ${connected.identity.email}; reconnect ${account.account_email} instead`);
  }
  const updated = reactivateGoogleGrant(store, account, connected.identity, [...connected.token.scopes]);
  return { account: updated, result: await syncGoogleAccount(store, account.id) };
}

export function disconnectGoogleAccount(store: AppStore, accountId: string) {
  const account = googleAccounts(store).find((grant) => grant.id === accountId);
  if (!account) return;
  forgetAccountToken(account.id);
  store.update(
    'integration_grants',
    account.id,
    { is_active: false, last_sync_error: null },
    store.asMe({ summary: `Google account disconnected — ${account.account_email ?? 'legacy account'}` }),
  );
}

/* ── Gmail → Notebook Mail ──────────────────────────────────────────── */

export function toMailRow(
  message: GmailMessage,
  account: Pick<IntegrationGrant, 'id' | 'account_email'>,
  ownerId: UserId,
  prior?: MailItem,
): MailItem {
  return {
    id: prior?.id ?? `gm-${account.id}-${message.id}`,
    owner_id: ownerId,
    integration_grant_id: account.id,
    gmail_message_id: message.id,
    gmail_thread_id: message.threadId,
    account_email: account.account_email ?? '',
    sender: message.from,
    subject: message.subject,
    snippet: message.snippet,
    received_at: message.receivedAt,
    gmail_link: message.link,
    flag_reason: prior?.flag_reason ?? null,
    project_id: prior?.project_id ?? null,
    converted_to_type: prior?.converted_to_type ?? null,
    converted_to_id: prior?.converted_to_id ?? null,
  };
}

async function syncInbox(
  store: AppStore,
  account: IntegrationGrant,
): Promise<{ mailNew: number; mailKnown: number }> {
  const accountEmail = account.account_email ?? store.me.email;
  const messages = await fetchGmailInbox(account.id, accountEmail, 20);
  let mailNew = 0;
  let mailKnown = 0;
  for (const message of messages) {
    const prior = store.ds.mail_items.find(
      (item) =>
        item.integration_grant_id === account.id && item.gmail_message_id === message.id,
    ) ?? store.ds.mail_items.find(
      (item) => item.account_email.toLowerCase() === accountEmail.toLowerCase() && item.id === `gm-${message.id}`,
    );
    const row = toMailRow(message, account, store.meId, prior);
    if (prior) {
      store.update('mail_items', prior.id, row, store.asMe({ silent: true }));
      mailKnown += 1;
    } else {
      store.insert('mail_items', row, store.asMe({ silent: true }));
      mailNew += 1;
    }
  }
  return { mailNew, mailKnown };
}

function orderMessage(raw: GmailRawMessage, account: IntegrationGrant) {
  const accountEmail = account.account_email ?? '';
  const meta = toGmailMessage(raw, accountEmail);
  const bodies = extractGmailBodies(raw);
  return { ...meta, text: bodies.text, html: bodies.html };
}

async function processOrderMessages(
  store: AppStore,
  account: IntegrationGrant,
  ids: string[],
  envelopeFirst: boolean,
): Promise<{ orderReviewsNew: number; orderUpdates: number }> {
  let orderReviewsNew = 0;
  let orderUpdates = 0;
  for (const id of [...new Set(ids)]) {
    if (
      store.ds.personal_order_events.some(
        (event) => event.integration_grant_id === account.id && event.gmail_message_id === id,
      )
    ) continue;
    let raw: GmailRawMessage;
    if (envelopeFirst) {
      const envelope = await fetchGmailMessage(account.id, id, 'metadata');
      if (!isCommerceEnvelope(envelope)) continue;
      raw = await fetchGmailMessage(account.id, id, 'full');
    } else {
      raw = await fetchGmailMessage(account.id, id, 'full');
    }
    const message = orderMessage(raw, account);
    const detection = detectPersonalOrder(message);
    if (!detection) continue;
    const recorded = recordOrderDetection(store, account, message, detection);
    if (recorded.created) orderReviewsNew += 1;
    else orderUpdates += 1;
  }
  return { orderReviewsNew, orderUpdates };
}

export async function syncOrders(
  store: AppStore,
  account: IntegrationGrant,
): Promise<{ orderReviewsNew: number; orderUpdates: number; historyId: string; initialScan: boolean }> {
  let initialScan = !account.initial_mail_scan_at || !account.gmail_history_id;
  let ids: string[] = [];
  let historyId = account.gmail_history_id ?? '';
  if (!initialScan) {
    try {
      const history = await fetchGmailHistory(account.id, account.gmail_history_id!);
      ids = history.messageIds;
      historyId = history.historyId;
    } catch (error) {
      if (!(error instanceof GoogleApiError) || error.status !== 404) throw error;
      initialScan = true;
    }
  }
  if (initialScan) ids = await fetchGmailCandidateIds(account.id, 30);
  const result = await processOrderMessages(store, account, ids, !initialScan);
  if (initialScan || !historyId) historyId = (await getGmailProfile(account.id)).historyId;
  return { ...result, historyId, initialScan };
}

/* ── Calendar → day events ──────────────────────────────────────────── */

const toMin = (iso: string) => {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
};

export const shiftDay = (iso: string, days: number): string =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

export const eventDay = (event: CalendarEvent): string => event.start.slice(0, 10);

export function toDayEvent(
  event: CalendarEvent,
  userId: UserId,
  dayIso: string,
  account?: Pick<IntegrationGrant, 'id' | 'account_email'>,
  existingId?: string,
): DayEvent {
  return {
    id: existingId ?? (account ? `gcal-${account.id}-${event.id}` : `gcal-${event.id}`),
    user_id: userId,
    date: dayIso,
    start_min: event.allDay ? 0 : toMin(event.start),
    end_min: event.allDay ? 1439 : toMin(event.end),
    label: event.summary,
    kind: 'meeting',
    task_id: null,
    integration_grant_id: account?.id ?? null,
    external_event_id: event.id,
    account_email: account?.account_email ?? null,
    source_url: event.link,
  };
}

export async function syncCalendarWindow(
  store: AppStore,
  account: IntegrationGrant,
  fromIso: string,
  toIso: string,
): Promise<{ eventsNew: number; eventsDropped: number }> {
  const events = await fetchCalendarRange(account.id, fromIso, toIso);
  const live = new Set(events.map((event) => event.id));
  let eventsNew = 0;
  for (const event of events) {
    const prior = store.ds.day_events.find(
      (row) => row.integration_grant_id === account.id && row.external_event_id === event.id,
    );
    const row = toDayEvent(event, store.meId, eventDay(event), account, prior?.id);
    if (prior) store.update('day_events', prior.id, row, store.asMe({ silent: true }));
    else {
      store.insert('day_events', row, store.asMe({ silent: true }));
      eventsNew += 1;
    }
  }
  const stale = store.ds.day_events.filter(
    (row) =>
      row.integration_grant_id === account.id &&
      !!row.external_event_id &&
      row.date >= fromIso &&
      row.date <= toIso &&
      row.user_id === store.meId &&
      !live.has(row.external_event_id),
  );
  for (const row of stale) store.remove('day_events', row.id, store.asMe({ silent: true }));
  return { eventsNew, eventsDropped: stale.length };
}

/* ── Account and aggregate sync ─────────────────────────────────────── */

export async function syncGoogleAccount(store: AppStore, accountId: string): Promise<AccountSyncResult> {
  const account = activeGoogleAccounts(store).find((grant) => grant.id === accountId);
  if (!account) throw new Error('Google account is disconnected');
  if (!hasLiveAccountToken(account.id, ALL_SCOPES)) throw new Error('Reconnect this Google account to sync');
  const from = shiftDay(today(), -SYNC_BACK_DAYS);
  const to = shiftDay(today(), SYNC_FWD_DAYS);
  try {
    const [inbox, orders, calendar] = await Promise.all([
      syncInbox(store, account),
      syncOrders(store, account),
      syncCalendarWindow(store, account, from, to),
    ]);
    const now = nowIso();
    store.update(
      'integration_grants',
      account.id,
      {
        scopes: grantedAccountScopes(account.id),
        gmail_history_id: orders.historyId,
        initial_mail_scan_at: orders.initialScan ? now : account.initial_mail_scan_at ?? now,
        last_sync_at: now,
        last_sync_error: null,
        is_active: true,
      },
      store.asMe({ silent: true }),
    );
    const result: AccountSyncResult = {
      accountId: account.id,
      accountEmail: account.account_email ?? store.me.email,
      ...inbox,
      orderReviewsNew: orders.orderReviewsNew,
      orderUpdates: orders.orderUpdates,
      ...calendar,
    };
    store.note(
      'google_sync',
      describeAccountSync(result),
      { actor: null, actorLabel: 'automated', source: 'gmail' },
    );
    return result;
  } catch (error) {
    store.update(
      'integration_grants',
      account.id,
      { last_sync_error: error instanceof Error ? error.message.slice(0, 1000) : 'Google sync failed' },
      store.asMe({ silent: true }),
    );
    throw error;
  }
}

export async function syncLiveGoogleAccounts(store: AppStore): Promise<SyncResult> {
  const accounts: AccountSyncResult[] = [];
  const skippedAccountIds: string[] = [];
  for (const account of activeGoogleAccounts(store)) {
    if (!hasLiveAccountToken(account.id, ALL_SCOPES)) {
      skippedAccountIds.push(account.id);
      continue;
    }
    accounts.push(await syncGoogleAccount(store, account.id));
  }
  return {
    accounts,
    skippedAccountIds,
    mailNew: accounts.reduce((sum, row) => sum + row.mailNew, 0),
    orderReviewsNew: accounts.reduce((sum, row) => sum + row.orderReviewsNew, 0),
    orderUpdates: accounts.reduce((sum, row) => sum + row.orderUpdates, 0),
    eventsNew: accounts.reduce((sum, row) => sum + row.eventsNew, 0),
    eventsDropped: accounts.reduce((sum, row) => sum + row.eventsDropped, 0),
  };
}

/** The old one-button name remains as a safe aggregate alias for small callers. */
export const syncAll = syncLiveGoogleAccounts;

function describeAccountSync(result: AccountSyncResult): string {
  const bits = [
    result.mailNew ? `${result.mailNew} new mail` : '',
    result.orderReviewsNew ? `${result.orderReviewsNew} order review${result.orderReviewsNew === 1 ? '' : 's'}` : '',
    result.orderUpdates ? `${result.orderUpdates} order update${result.orderUpdates === 1 ? '' : 's'}` : '',
    result.eventsNew ? `${result.eventsNew} event${result.eventsNew === 1 ? '' : 's'}` : '',
    result.eventsDropped ? `${result.eventsDropped} cancelled` : '',
  ].filter(Boolean);
  return `Google synced ${result.accountEmail}${bits.length ? ` — ${bits.join(', ')}` : ' — nothing new'}`;
}

export function describeSync(result: SyncResult | AccountSyncResult): string {
  if ('accountId' in result) return describeAccountSync(result);
  if (!result.accounts.length) {
    return result.skippedAccountIds.length
      ? `No active session — reconnect ${result.skippedAccountIds.length} Google account${result.skippedAccountIds.length === 1 ? '' : 's'}`
      : 'No connected Google accounts';
  }
  const bits = [
    result.mailNew ? `${result.mailNew} new mail` : '',
    result.orderReviewsNew ? `${result.orderReviewsNew} order review${result.orderReviewsNew === 1 ? '' : 's'}` : '',
    result.orderUpdates ? `${result.orderUpdates} order update${result.orderUpdates === 1 ? '' : 's'}` : '',
    result.eventsNew ? `${result.eventsNew} event${result.eventsNew === 1 ? '' : 's'}` : '',
    result.eventsDropped ? `${result.eventsDropped} cancelled` : '',
  ].filter(Boolean);
  const skipped = result.skippedAccountIds.length ? ` · ${result.skippedAccountIds.length} need reconnect` : '';
  return `Synced ${result.accounts.length} account${result.accounts.length === 1 ? '' : 's'}${bits.length ? ` — ${bits.join(', ')}` : ' — nothing new'}${skipped}`;
}
