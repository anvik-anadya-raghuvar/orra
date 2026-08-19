/**
 * Browser-only Google integration.
 *
 * Every connected Google account has its own short-lived access token in this
 * module's in-memory map. Account metadata may be persisted by googleSync.ts;
 * tokens, raw mail bodies and attachments never are.
 */

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export const SCOPES = {
  gmail: 'https://www.googleapis.com/auth/gmail.readonly',
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
  calendar: 'https://www.googleapis.com/auth/calendar.events',
  drive: 'https://www.googleapis.com/auth/drive.readonly',
} as const;
export type ScopeKey = keyof typeof SCOPES;
export const IDENTITY_SCOPES = ['openid', 'email', 'profile'] as const;

export const googleConfigured = () => Boolean(GOOGLE_CLIENT_ID);

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken: (opts?: {
    prompt?: string;
    login_hint?: string;
    scope?: string;
    include_granted_scopes?: boolean;
  }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            prompt?: string;
            login_hint?: string;
            include_granted_scopes?: boolean;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: unknown) => void;
          }) => TokenClient;
          revoke: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google Identity Services'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export interface AccountToken {
  token: string;
  expiresAt: number;
  scopes: Set<string>;
}

const tokenCache = new Map<string, AccountToken>();

const wantedScopes = (keys: ScopeKey[], includeIdentity = false) => [
  ...keys.map((key) => SCOPES[key]),
  ...(includeIdentity ? IDENTITY_SCOPES : []),
];

const tokenCovers = (entry: AccountToken | undefined, scopes: string[]) =>
  !!entry && entry.expiresAt > Date.now() + 30_000 && scopes.every((scope) => entry.scopes.has(scope));

async function requestToken(
  keys: ScopeKey[],
  options: { prompt: '' | 'select_account' | 'consent'; loginHint?: string; includeIdentity?: boolean },
): Promise<AccountToken> {
  if (!GOOGLE_CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID is not set');
  await loadGis();
  const want = wantedScopes(keys, options.includeIdentity);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finishError = (value: unknown) => {
      if (settled) return;
      settled = true;
      reject(value instanceof Error ? value : new Error('Google sign-in was closed'));
    };
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: want.join(' '),
      prompt: options.prompt,
      login_hint: options.loginHint,
      include_granted_scopes: true,
      callback: (response) => {
        if (settled) return;
        settled = true;
        if (response.error || !response.access_token) {
          reject(new Error(response.error_description ?? response.error ?? 'Google declined access'));
          return;
        }
        resolve({
          token: response.access_token,
          expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
          scopes: new Set((response.scope ?? want.join(' ')).split(' ').filter(Boolean)),
        });
      },
      error_callback: finishError,
    });
    client.requestAccessToken({
      prompt: options.prompt,
      login_hint: options.loginHint,
      include_granted_scopes: true,
    });
  });
}

export interface GoogleIdentity {
  subject: string;
  email: string;
  name: string;
}

export interface ConnectedGoogleIdentity {
  identity: GoogleIdentity;
  token: AccountToken;
}

/** User-driven account chooser used only by the Add account button. */
export async function connectGoogleIdentity(keys: ScopeKey[]): Promise<ConnectedGoogleIdentity> {
  const token = await requestToken(keys, { prompt: 'select_account', includeIdentity: true });
  const identity = await apiWithToken<{
    sub?: string;
    email?: string;
    name?: string;
  }>('https://openidconnect.googleapis.com/v1/userinfo', token.token);
  if (!identity.sub || !identity.email) throw new Error('Google did not return an account identity');
  return {
    identity: { subject: identity.sub, email: identity.email, name: identity.name ?? identity.email },
    token,
  };
}

export function adoptAccountToken(accountId: string, token: AccountToken) {
  tokenCache.set(accountId, token);
}

/** User-driven renewal for one known account. It never runs from a timer. */
export async function reconnectAccountToken(
  accountId: string,
  email: string,
  keys: ScopeKey[],
): Promise<ConnectedGoogleIdentity> {
  const token = await requestToken(keys, { prompt: '', loginHint: email, includeIdentity: true });
  const identity = await apiWithToken<{ sub?: string; email?: string; name?: string }>(
    'https://openidconnect.googleapis.com/v1/userinfo',
    token.token,
  );
  if (!identity.sub || !identity.email) throw new Error('Google did not return an account identity');
  tokenCache.set(accountId, token);
  return {
    identity: { subject: identity.sub, email: identity.email, name: identity.name ?? identity.email },
    token,
  };
}

export async function getAccountToken(
  accountId: string,
  keys: ScopeKey[],
  options: { interactive?: boolean; loginHint?: string } = {},
): Promise<string | null> {
  const want = wantedScopes(keys);
  const cached = tokenCache.get(accountId);
  if (tokenCovers(cached, want)) return cached!.token;
  tokenCache.delete(accountId);
  if (!options.interactive) return null;
  const token = await requestToken(keys, { prompt: '', loginHint: options.loginHint });
  tokenCache.set(accountId, token);
  return token.token;
}

export function hasLiveAccountToken(accountId: string, keys: ScopeKey[] = []): boolean {
  return tokenCovers(tokenCache.get(accountId), wantedScopes(keys));
}

export function grantedAccountScopes(accountId: string): string[] {
  return [...(tokenCache.get(accountId)?.scopes ?? [])];
}

export function forgetAccountToken(accountId: string) {
  const cached = tokenCache.get(accountId);
  if (cached) window.google?.accounts.oauth2.revoke(cached.token);
  tokenCache.delete(accountId);
}

export class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

async function apiWithToken<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw new GoogleApiError(response.status, `Google API ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }
  return response.json() as Promise<T>;
}

async function accountApi<T>(accountId: string, keys: ScopeKey[], url: string, init?: RequestInit): Promise<T> {
  const token = await getAccountToken(accountId, keys);
  if (!token) throw new Error('Reconnect this Google account to continue');
  return apiWithToken<T>(url, token, init);
}

/* ── Gmail ──────────────────────────────────────────────────────────── */

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}

export interface GmailRawMessage {
  id: string;
  threadId: string;
  historyId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export interface GmailMessage {
  id: string;
  threadId: string;
  historyId: string | null;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  link: string;
}

export const gmailLink = (email: string, messageId: string) =>
  `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(email)}#all/${messageId}`;

export const gmailHeader = (message: GmailRawMessage, name: string): string =>
  message.payload?.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? '';

export function toGmailMessage(message: GmailRawMessage, accountEmail: string): GmailMessage {
  const timestamp = Number(message.internalDate);
  return {
    id: message.id,
    threadId: message.threadId,
    historyId: message.historyId ?? null,
    from: gmailHeader(message, 'From'),
    subject: gmailHeader(message, 'Subject') || '(no subject)',
    snippet: message.snippet ?? '',
    receivedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString(),
    link: gmailLink(accountEmail, message.id),
  };
}

export async function getGmailProfile(accountId: string): Promise<{ emailAddress: string; historyId: string }> {
  return accountApi(accountId, ['gmail'], 'https://gmail.googleapis.com/gmail/v1/users/me/profile');
}

async function listGmailIds(
  accountId: string,
  query: string,
  max: number,
): Promise<{ id: string; threadId: string }[]> {
  const out: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5 && out.length < max; page++) {
    const pageSize = Math.min(500, max - out.length);
    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${pageSize}` +
      `&q=${encodeURIComponent(query)}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const result = await accountApi<{
      messages?: { id: string; threadId: string }[];
      nextPageToken?: string;
    }>(accountId, ['gmail'], url);
    out.push(...(result.messages ?? []));
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }
  return out.slice(0, max);
}

export async function fetchGmailMessage(
  accountId: string,
  messageId: string,
  format: 'metadata' | 'full' = 'metadata',
): Promise<GmailRawMessage> {
  const headers = format === 'metadata'
    ? '&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date'
    : '';
  return accountApi(
    accountId,
    ['gmail'],
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=${format}${headers}`,
  );
}

export async function fetchGmailInbox(
  accountId: string,
  accountEmail: string,
  max = 20,
): Promise<GmailMessage[]> {
  const ids = await listGmailIds(accountId, 'in:inbox', max);
  const rows = await Promise.all(
    ids.map(({ id }) => fetchGmailMessage(accountId, id, 'metadata').catch(() => null)),
  );
  return rows.filter((row): row is GmailRawMessage => !!row).map((row) => toGmailMessage(row, accountEmail));
}

const COMMERCE_QUERY = [
  'subject:order', 'subject:shipped', 'subject:delivery', 'subject:delivered',
  'subject:tracking', 'subject:return', 'subject:refund', 'subject:booking',
  'subject:reservation', 'subject:itinerary', 'subject:flight', 'subject:hotel',
  'subject:train', 'subject:ordine', 'subject:spedito', 'subject:consegna',
  'subject:rimborso', 'subject:prenotazione', 'subject:volo', 'subject:treno',
].join(' ');

export async function fetchGmailCandidateIds(accountId: string, days = 30): Promise<string[]> {
  const ids = await listGmailIds(
    accountId,
    `newer_than:${days}d -in:spam -in:trash {${COMMERCE_QUERY}}`,
    500,
  );
  return ids.map((row) => row.id);
}

export function isCommerceEnvelope(message: GmailRawMessage): boolean {
  const text = `${gmailHeader(message, 'From')} ${gmailHeader(message, 'Subject')} ${message.snippet ?? ''}`;
  return /\b(order|shipment|shipped|delivery|delivered|tracking|return|refund|booking|reservation|itinerary|flight|hotel|train|ordine|spedito|consegna|rimborso|prenotazione|volo|treno)\b/i.test(text);
}

export async function fetchGmailHistory(
  accountId: string,
  startHistoryId: string,
): Promise<{ messageIds: string[]; historyId: string }> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let latest = startHistoryId;
  for (let page = 0; page < 10; page++) {
    const url =
      `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${encodeURIComponent(startHistoryId)}` +
      '&historyTypes=messageAdded&maxResults=500' +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const response = await accountApi<{
      history?: { messagesAdded?: { message: { id: string } }[] }[];
      historyId?: string;
      nextPageToken?: string;
    }>(accountId, ['gmail'], url);
    for (const history of response.history ?? []) {
      for (const added of history.messagesAdded ?? []) ids.add(added.message.id);
    }
    latest = response.historyId ?? latest;
    pageToken = response.nextPageToken;
    if (!pageToken) break;
  }
  return { messageIds: [...ids], historyId: latest };
}

function decodeBase64Url(value: string): string {
  const normal = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normal.padEnd(Math.ceil(normal.length / 4) * 4, '=');
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    }
    return named[entity.toLowerCase()] ?? `&${entity};`;
  });
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?\s*>|<\/p>|<\/div>|<\/li>|<\/tr>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractGmailBodies(message: GmailRawMessage): { text: string; html: string } {
  const plain: string[] = [];
  const html: string[] = [];
  const visit = (part: GmailPart | undefined) => {
    if (!part) return;
    const data = part.body?.data;
    // attachmentId means the bytes are not inline. Never fetch it.
    if (data && !part.body?.attachmentId) {
      const decoded = decodeBase64Url(data);
      if (part.mimeType?.toLowerCase() === 'text/html') html.push(decoded);
      else if (part.mimeType?.toLowerCase() === 'text/plain' || !part.mimeType) plain.push(decoded);
    }
    for (const child of part.parts ?? []) visit(child);
  };
  visit(message.payload);
  const rawHtml = html.join('\n');
  return { text: plain.join('\n').trim() || htmlToText(rawHtml), html: rawHtml };
}

/* ── Calendar ───────────────────────────────────────────────────────── */

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  link: string;
}

interface RawEvent {
  id: string;
  summary?: string;
  htmlLink?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

const toEvent = (event: RawEvent): CalendarEvent => ({
  id: event.id,
  summary: event.summary ?? '(busy)',
  start: event.start?.dateTime ?? `${event.start?.date}T00:00:00`,
  end: event.end?.dateTime ?? `${event.end?.date}T23:59:59`,
  allDay: !event.start?.dateTime,
  link: event.htmlLink ?? 'https://calendar.google.com',
});

export async function fetchCalendarRange(
  accountId: string,
  fromIso: string,
  toIso: string,
): Promise<CalendarEvent[]> {
  const min = new Date(`${fromIso}T00:00:00`).toISOString();
  const max = new Date(`${toIso}T23:59:59`).toISOString();
  const out: CalendarEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const url =
      'https://www.googleapis.com/calendar/v3/calendars/primary/events' +
      '?singleEvents=true&orderBy=startTime&showDeleted=false&maxResults=250' +
      `&timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const result = await accountApi<{ items?: RawEvent[]; nextPageToken?: string }>(accountId, ['calendar'], url);
    out.push(...(result.items ?? []).filter((event) => event.status !== 'cancelled').map(toEvent));
    pageToken = result.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

export async function createCalendarEvent(
  accountId: string,
  input: { summary: string; startIso: string; endIso: string; description?: string },
): Promise<string> {
  const token = await getAccountToken(accountId, ['calendar']);
  if (!token) throw new Error('Reconnect the selected Google account first');
  const response = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: input.summary,
        description: input.description ?? '',
        start: { dateTime: input.startIso },
        end: { dateTime: input.endIso },
      }),
    },
  );
  if (!response.ok) throw new GoogleApiError(response.status, `Calendar refused: ${(await response.text()).slice(0, 180)}`);
  const result = (await response.json()) as { htmlLink?: string };
  return result.htmlLink ?? 'https://calendar.google.com';
}

/* ── Drive ──────────────────────────────────────────────────────────── */

export interface DriveFile {
  id: string;
  accountId: string;
  accountEmail: string;
  name: string;
  mimeType: string;
  link: string;
  modifiedAt: string;
}

export interface GoogleAccountRef {
  id: string;
  email: string;
}

async function driveFiles(
  account: GoogleAccountRef,
  query: string,
  max: number,
): Promise<DriveFile[]> {
  const q = query.trim()
    ? `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`
    : 'trashed = false';
  const order = query.trim() ? '' : `&orderBy=${encodeURIComponent('modifiedTime desc')}`;
  const response = await accountApi<{
    files?: { id: string; name: string; mimeType: string; webViewLink?: string; modifiedTime?: string }[];
  }>(
    account.id,
    ['drive'],
    `https://www.googleapis.com/drive/v3/files?pageSize=${max}${order}` +
      `&q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,webViewLink,modifiedTime)`,
  );
  return (response.files ?? []).map((file) => ({
    id: file.id,
    accountId: account.id,
    accountEmail: account.email,
    name: file.name,
    mimeType: file.mimeType,
    link: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
    modifiedAt: file.modifiedTime ?? '',
  }));
}

export async function searchAllDrives(
  accounts: GoogleAccountRef[],
  query: string,
  maxPerAccount = 12,
): Promise<{ files: DriveFile[]; errors: { accountId: string; message: string }[] }> {
  const live = accounts.filter((account) => hasLiveAccountToken(account.id, ['drive']));
  const settled = await Promise.allSettled(live.map((account) => driveFiles(account, query, maxPerAccount)));
  const files: DriveFile[] = [];
  const errors: { accountId: string; message: string }[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') files.push(...result.value);
    else errors.push({
      accountId: live[index].id,
      message: result.reason instanceof Error ? result.reason.message : 'Drive search failed',
    });
  });
  files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.name.localeCompare(b.name));
  return { files, errors };
}
