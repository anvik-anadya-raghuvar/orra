/**
 * Google integration — Gmail (read), Calendar (read/write), Drive (read).
 *
 * Uses Google Identity Services' token flow in the browser. That choice is
 * deliberate:
 *
 *  - It needs only a CLIENT ID, which is public by design. No client secret
 *    exists in this codebase, so none can leak from it.
 *  - Access tokens live in memory for their ~1 hour and are never written to
 *    the database or localStorage. A dump of the Postgres data therefore can
 *    never become access to a mailbox.
 *  - The trade-off, stated plainly: there is no background sync. Data refreshes
 *    when the portal is open. Background sync needs a refresh token held
 *    server-side, which is a different security posture and a separate build.
 *
 * What the database stores is only WHICH scopes were granted, so the UI can be
 * honest about what actually works.
 */

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

export const SCOPES = {
  gmail: 'https://www.googleapis.com/auth/gmail.readonly',
  gmailSend: 'https://www.googleapis.com/auth/gmail.send',
  calendar: 'https://www.googleapis.com/auth/calendar.events',
  drive: 'https://www.googleapis.com/auth/drive.readonly',
} as const;
export type ScopeKey = keyof typeof SCOPES;

export const googleConfigured = () => Boolean(GOOGLE_CLIENT_ID);

/* ── GIS script loading ─────────────────────────────────────────────── */

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}
interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
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
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google Identity Services'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/* ── token cache (memory only, never persisted) ─────────────────────── */

interface CachedToken {
  token: string;
  expiresAt: number;
  scopes: Set<string>;
}
let cached: CachedToken | null = null;

const hasScopes = (want: string[]) =>
  !!cached && cached.expiresAt > Date.now() + 30_000 && want.every((s) => cached!.scopes.has(s));

/**
 * Get an access token covering `keys`, prompting only when needed.
 * `interactive: false` attempts a silent grant and resolves null if Google
 * would need to show UI — used on load so the app never pops a dialog at you.
 */
export async function getToken(
  keys: ScopeKey[],
  { interactive = true }: { interactive?: boolean } = {},
): Promise<string | null> {
  if (!GOOGLE_CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID is not set');
  const want = keys.map((k) => SCOPES[k]);
  if (hasScopes(want)) return cached!.token;

  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: want.join(' '),
      prompt: interactive ? '' : 'none',
      callback: (res) => {
        if (res.error || !res.access_token) {
          if (!interactive) return resolve(null);
          return reject(new Error(res.error ?? 'Google declined the request'));
        }
        cached = {
          token: res.access_token,
          expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000,
          scopes: new Set((res.scope ?? want.join(' ')).split(' ')),
        };
        resolve(res.access_token);
      },
      error_callback: (e) => (interactive ? reject(e instanceof Error ? e : new Error('Google sign-in was closed')) : resolve(null)),
    });
    client.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

export function forgetToken() {
  if (cached) window.google?.accounts.oauth2.revoke(cached.token);
  cached = null;
}

export const grantedScopes = (): string[] => (cached ? [...cached.scopes] : []);

/* ── API helpers ────────────────────────────────────────────────────── */

async function api<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

export interface GmailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  link: string;
}

/** Recent inbox messages, flattened to what the Mail tab actually shows. */
export async function fetchGmail(max = 15): Promise<GmailMessage[]> {
  const token = await getToken(['gmail']);
  if (!token) return [];
  const list = await api<{ messages?: { id: string }[] }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=in:inbox`,
    token,
  );
  const ids = (list.messages ?? []).map((m) => m.id);
  const full = await Promise.all(
    ids.map((id) =>
      api<{
        id: string;
        snippet: string;
        internalDate: string;
        payload: { headers: { name: string; value: string }[] };
      }>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
        token,
      ).catch(() => null),
    ),
  );
  return full.filter(Boolean).map((m) => {
    const h = (n: string) =>
      m!.payload.headers.find((x) => x.name.toLowerCase() === n)?.value ?? '';
    return {
      id: m!.id,
      from: h('from'),
      subject: h('subject') || '(no subject)',
      // Bodies are never stored — only the snippet Gmail already returns.
      snippet: m!.snippet ?? '',
      receivedAt: new Date(Number(m!.internalDate)).toISOString(),
      link: `https://mail.google.com/mail/u/0/#inbox/${m!.id}`,
    };
  });
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  link: string;
}

/** Today's events, for the Home day ribbon. */
export async function fetchCalendar(dayIso: string): Promise<CalendarEvent[]> {
  const token = await getToken(['calendar']);
  if (!token) return [];
  const min = new Date(`${dayIso}T00:00:00`).toISOString();
  const max = new Date(`${dayIso}T23:59:59`).toISOString();
  const res = await api<{
    items?: {
      id: string;
      summary?: string;
      htmlLink?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
    }[];
  }>(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(min)}&timeMax=${encodeURIComponent(max)}`,
    token,
  );
  return (res.items ?? []).map((e) => ({
    id: e.id,
    summary: e.summary ?? '(busy)',
    start: e.start?.dateTime ?? `${e.start?.date}T00:00:00`,
    end: e.end?.dateTime ?? `${e.end?.date}T23:59:59`,
    allDay: !e.start?.dateTime,
    link: e.htmlLink ?? 'https://calendar.google.com',
  }));
}

/** Create a real calendar event (used by "Schedule a call"). */
export async function createCalendarEvent(input: {
  summary: string;
  startIso: string;
  endIso: string;
  description?: string;
}): Promise<string> {
  const token = await getToken(['calendar']);
  if (!token) throw new Error('Calendar access was not granted');
  const res = await fetch(
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
  if (!res.ok) throw new Error(`Calendar refused: ${(await res.text()).slice(0, 160)}`);
  const json = (await res.json()) as { htmlLink?: string };
  return json.htmlLink ?? 'https://calendar.google.com';
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  link: string;
  modifiedAt: string;
}

/** Search Drive by name — enough to attach a document by reference. */
export async function searchDrive(query: string, max = 12): Promise<DriveFile[]> {
  const token = await getToken(['drive']);
  if (!token) return [];
  const q = `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`;
  const res = await api<{
    files?: { id: string; name: string; mimeType: string; webViewLink?: string; modifiedTime?: string }[];
  }>(
    `https://www.googleapis.com/drive/v3/files?pageSize=${max}&q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,webViewLink,modifiedTime)`,
    token,
  );
  return (res.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    link: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
    modifiedAt: f.modifiedTime ?? '',
  }));
}

/** Recently touched files — what the Documents picker shows before you type. */
export async function recentDrive(max = 12): Promise<DriveFile[]> {
  const token = await getToken(['drive']);
  if (!token) return [];
  const res = await api<{
    files?: { id: string; name: string; mimeType: string; webViewLink?: string; modifiedTime?: string }[];
  }>(
    `https://www.googleapis.com/drive/v3/files?pageSize=${max}&orderBy=${encodeURIComponent(
      'modifiedTime desc',
    )}&q=${encodeURIComponent('trashed = false')}&fields=files(id,name,mimeType,webViewLink,modifiedTime)`,
    token,
  );
  return (res.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    link: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
    modifiedAt: f.modifiedTime ?? '',
  }));
}
