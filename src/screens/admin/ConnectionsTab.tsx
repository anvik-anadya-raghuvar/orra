import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useData, useStore } from '../../data/store';
import { Modal, useToast } from '../../ui/bits';
import { staggerItem, staggerParent } from '../../ui/motion';
import { googleConfigured } from '../../lib/google';
import { youtubeConfigured } from '../../lib/youtube';
import PushCard from './PushCard';
import {
  connectGoogleAccount,
  describeSync,
  disconnectGoogleAccount,
  googleAccounts,
  hasLiveGoogleAccount,
  hasScope,
  reconnectGoogleAccount,
  syncGoogleAccount,
  syncLiveGoogleAccounts,
} from '../../lib/googleSync';
import { fmtDateTime } from '../../lib/dates';
import type { IntegrationGrant } from '../../types';

/**
 * Connections.
 *
 * States are derived, never decorative. The v10 prototype showed six cards all
 * badged "connected" while nothing was wired to anything — that badge is the
 * one thing this screen must never fake, because a green dot that lies is
 * worse than an empty screen.
 *
 * "live"    — verified from the running app: an adapter kind, a committed
 *             workflow, or a Google grant this account actually holds
 * "usable"  — works right now with no account linking, because it is a deep
 *             link into a service you're already signed into. Not a sync.
 * "planned" — needs something that does not exist yet. Honestly off.
 */
type ConnState = 'live' | 'usable' | 'planned';

const STATE_LABEL: Record<ConnState, string> = {
  live: 'live',
  usable: 'ready to use',
  planned: 'not connected',
};
const STATE_PILL: Record<ConnState, string> = { live: 'ok', usable: 'soon', planned: 'q' };

interface Action {
  label: string;
  href?: string;
  onClick?: () => void;
}
interface Conn {
  key: string;
  name: string;
  state: ConnState;
  desc: string;
  /** What it would take to move this to "live" — shown for planned ones. */
  needs?: string;
  actions?: Action[];
}

export default function ConnectionsTab() {
  const store = useStore();
  const ds = useData((d) => d);
  const toast = useToast();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, setSessionVersion] = useState(0);

  const configured = googleConfigured();
  const accounts = googleAccounts(store);
  const linked = accounts.some((account) => account.is_active !== false);
  const liveAccounts = accounts.filter(
    (account) => account.is_active !== false && hasLiveGoogleAccount(account.id),
  );

  const supabaseLive = store.adapter.kind === 'supabase';
  const me = store.me;
  const other = store.other;

  /** Gmail compose, prefilled — works because you're signed into Gmail already. */
  const gmailCompose = (to: string, subject: string, body: string) =>
    `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;

  const digest = useMemo(() => {
    const open = ds.tasks.filter((t) => t.status !== 'done').length;
    const decisions = ds.decisions.filter((d) => d.status === 'open').length;
    return [
      `ORRA — where things stand`,
      ``,
      `Open tasks: ${open}`,
      `Open decisions: ${decisions}`,
      ``,
      `Opened from the portal.`,
    ].join('\n');
  }, [ds.tasks, ds.decisions]);

  const runSync = async (account: IntegrationGrant) => {
    setBusy(`sync:${account.id}`);
    try {
      toast(describeSync(await syncGoogleAccount(store, account.id)));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Google sync failed');
    } finally {
      setBusy(null);
    }
  };

  const runAllSync = async () => {
    setBusy('sync-all');
    try {
      toast(describeSync(await syncLiveGoogleAccounts(store)));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Google sync failed');
    } finally {
      setBusy(null);
    }
  };

  const connectAndSync = async () => {
    setBusy('add');
    try {
      const connected = await connectGoogleAccount(store);
      setSessionVersion((version) => version + 1);
      toast(describeSync(connected.result));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not connect Google');
    } finally {
      setBusy(null);
    }
  };

  const reconnect = async (account: IntegrationGrant) => {
    setBusy(`reconnect:${account.id}`);
    try {
      const connected = await reconnectGoogleAccount(store, account.id);
      setSessionVersion((version) => version + 1);
      toast(describeSync(connected.result));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not reconnect Google');
    } finally {
      setBusy(null);
    }
  };

  const unlink = (account: IntegrationGrant) => {
    disconnectGoogleAccount(store, account.id);
    setSessionVersion((version) => version + 1);
    toast(`${account.account_email ?? 'Google account'} disconnected`);
  };

  /* Every Google-shaped card reads from the same account collection, so the
     downstream connector summaries cannot disagree with the account rows. */
  const googleState = (key: 'gmail' | 'calendar' | 'drive'): ConnState => {
    if (!configured) return 'planned';
    return hasScope(store, key) ? 'live' : 'usable';
  };
  const clientIdNeeded =
    'An OAuth client id from Google Cloud Console, set as VITE_GOOGLE_CLIENT_ID (README → Google setup). No client secret is used anywhere in this codebase, so none can leak from it.';

  const conns: Conn[] = [
    {
      key: 'supabase',
      name: 'Supabase',
      state: supabaseLive ? 'live' : 'planned',
      desc: supabaseLive
        ? 'Postgres, Auth, Storage and Realtime are serving this session.'
        : 'Mock mode — running on local storage. Set VITE_SUPABASE_URL to connect.',
      needs: supabaseLive ? undefined : 'Add the project URL and anon key to your environment.',
    },
    {
      key: 'keepalive',
      name: 'GitHub keepalive',
      state: 'live',
      desc: 'A 3-day cron pings the database so the free project never sleeps.',
      actions: [
        {
          label: 'View workflow',
          href: 'https://github.com/anvik-anadya-raghuvar/orra/actions',
        },
      ],
    },
    {
      key: 'gmail',
      name: 'Gmail',
      state: googleState('gmail'),
      desc: hasScope(store, 'gmail')
        ? 'The latest 20 inbox messages per account sync into Notebook → Mail. Purchase and travel candidates enter Personal Orders review; nothing is ever sent.'
        : configured
          ? 'Compose opens prefilled in your own mailbox. Inbox sync starts the moment you connect Google above.'
          : 'Compose opens prefilled in your own mailbox. Reading the inbox into the Mail tab needs the client id.',
      needs: configured ? undefined : clientIdNeeded,
      actions: [
        { label: `Email ${other.name}`, href: gmailCompose(other.email, 'ORRA', '') },
        {
          label: 'Send the digest',
          href: gmailCompose(`${me.email},${other.email}`, 'ORRA — digest', digest),
        },
      ],
    },
    {
      key: 'calendar',
      name: 'Google Calendar',
      state: googleState('calendar'),
      desc: hasScope(store, 'calendar')
        ? "Every live account's primary calendar lands on the schedule with its account label. Cancellations are cleaned up only inside their source account."
        : configured
          ? 'Opens a prefilled event today. Connect Google to pull your real day onto the ribbon.'
          : 'Task pages and people cards open a prefilled event. One-way, no linking needed.',
      needs: configured ? undefined : clientIdNeeded,
      actions: [
        {
          label: 'New event',
          href: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=ORRA',
        },
      ],
    },
    {
      key: 'drive',
      name: 'Google Drive',
      state: googleState('drive'),
      desc: hasScope(store, 'drive')
        ? 'Notebook → Documents → + Document searches all live Drives and labels each result by account. Files stay in Drive; only the reference lives here.'
        : configured
          ? 'Documents take a URL you paste. Connect Google to search Drive instead of pasting.'
          : 'Documents currently store a URL you paste. Search is not wired.',
      needs: configured ? undefined : clientIdNeeded,
    },
    {
      key: 'youtube',
      name: 'YouTube',
      // Separate credential, separate story: a public API key, not the OAuth
      // grant above. It reads public search data and touches no account.
      state: youtubeConfigured() ? 'live' : 'usable',
      desc: youtubeConfigured()
        ? 'A song picked with just a title and artist resolves to the real video — artwork on the tile, Play opens the track.'
        : 'Play opens a YouTube search for the title and artist. An API key would resolve it to the actual video instead.',
      needs: youtubeConfigured()
        ? undefined
        : 'A YouTube Data API v3 key set as VITE_YOUTUBE_API_KEY. It ships in the bundle, so restrict it in Cloud Console to these two site referrers and to the YouTube Data API alone — an unrestricted key lets a stranger spend your 10,000-unit daily quota.',
    },
    {
      key: 'plaud',
      name: 'Plaud',
      state: 'planned',
      desc: 'Plaud now provides an official MCP server and CLI, but the deployed ORRA website is not connected to either one yet.',
      needs:
        'ORRA still needs a small server-side adapter before Plaud records can import automatically; MCP or CLI credentials must never ship in the browser bundle.',
      actions: [
        {
          label: 'Plaud MCP & CLI',
          href: 'https://www.plaud.ai/blogs/news/introducing-plaud-mcp-and-cli',
        },
      ],
    },
    {
      key: 'vercel',
      name: 'Vercel',
      state: 'live',
      desc: 'Deploys on every push to main. This build came from there.',
      actions: [{ label: 'Dashboard', href: 'https://vercel.com/dashboard' }],
    },
  ];

  const open = conns.find((c) => c.key === openKey) ?? null;

  return (
    <div>
      {/* First, because it is the only connection that reaches you when the
          portal is closed — and the one most worth knowing the state of. */}
      <PushCard />
      <div className="ad-goog">
        <div className="ad-conn-head">
          <h4>Google accounts</h4>
          <span className={`pill ${linked ? 'ok' : configured ? 'soon' : 'q'}`}>
            {linked
              ? `${accounts.filter((account) => account.is_active !== false).length} active`
              : configured
                ? 'ready to connect'
                : 'client id missing'}
          </span>
        </div>
        <p>
          {!configured
            ? 'Set VITE_GOOGLE_CLIENT_ID to connect Gmail, primary Calendar, and Drive.'
            : "Connect opens Google’s account chooser. Pick one signed-in address and approve it; its row appears below. Repeat Add Google account for the rest. Tokens stay in browser memory, so background timers only sync accounts that are live in this open session."}
        </p>
        {accounts.length > 0 && (
          <div className="ad-google-accounts">
            {accounts.map((account) => {
              const active = account.is_active !== false;
              const live = active && hasLiveGoogleAccount(account.id);
              return (
                <div className="ad-google-account" key={account.id}>
                  <div className="ad-google-account-copy">
                    <strong>{account.account_email ?? account.display_name ?? 'Legacy Google account'}</strong>
                    <span>
                      {active ? (live ? 'session active' : 'reconnect required') : 'disconnected'}
                      {' · '}
                      {account.last_sync_at ? `synced ${fmtDateTime(account.last_sync_at)}` : 'never synced'}
                    </span>
                    <span>{account.scopes.map((scope) => scope.split('/').pop()).join(' · ')}</span>
                    {account.last_sync_error && <span className="ad-google-error">{account.last_sync_error}</span>}
                  </div>
                  <div className="ad-conn-acts">
                    {live ? (
                      <button
                        type="button"
                        className="btn sm solid"
                        onClick={() => runSync(account)}
                        disabled={busy !== null}
                      >
                        <RefreshCw size={12} strokeWidth={2} />{' '}
                        {busy === `sync:${account.id}` ? 'Syncing…' : 'Sync'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn sm solid"
                        onClick={() => reconnect(account)}
                        disabled={busy !== null}
                      >
                        {busy === `reconnect:${account.id}` ? 'Waiting for Google…' : 'Reconnect'}
                      </button>
                    )}
                    {active && (
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => unlink(account)}
                        disabled={busy !== null}
                      >
                        Disconnect
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="ad-conn-acts">
          {liveAccounts.length > 0 && (
            <button
              type="button"
              className="btn sm solid"
              onClick={runAllSync}
              disabled={busy !== null}
            >
              <RefreshCw size={12} strokeWidth={2} />{' '}
              {busy === 'sync-all'
                ? 'Syncing all…'
                : `Sync all now (${liveAccounts.length})`}
            </button>
          )}
          {configured ? (
            <button
              type="button"
              className="btn sm solid"
              onClick={connectAndSync}
              disabled={busy !== null}
            >
              {busy === 'add' ? 'Waiting for Google…' : accounts.length ? 'Add Google account' : 'Connect Google account'}
            </button>
          ) : (
            <button type="button" className="btn sm" onClick={() => setOpenKey('gmail')}>
              What it needs
            </button>
          )}
        </div>
        {configured && (
          <p className="tip" style={{ margin: '10px 0 0' }}>
            OAuth Testing mode may ask each Test user to consent again every seven days. Reconnect is always explicit; automatic sync never opens a Google popup.
          </p>
        )}
      </div>

      <motion.div className="ad-conns" {...staggerParent()}>
        {conns.map((c) => (
          <motion.div key={c.key} className="ad-conn" variants={staggerItem}>
            <div className="ad-conn-head">
              <h4>{c.name}</h4>
              <span className={`pill ${STATE_PILL[c.state]}`}>{STATE_LABEL[c.state]}</span>
            </div>
            <p>{c.desc}</p>
            <div className="ad-conn-acts">
              {c.actions?.map((a) =>
                a.href ? (
                  <a
                    key={a.label}
                    className="btn sm"
                    href={a.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => toast(`Opening ${c.name}`)}
                  >
                    {a.label} <ExternalLink size={12} strokeWidth={2} />
                  </a>
                ) : (
                  <button key={a.label} type="button" className="btn sm" onClick={a.onClick}>
                    {a.label}
                  </button>
                ),
              )}
              {c.needs && (
                <button type="button" className="btn sm" onClick={() => setOpenKey(c.key)}>
                  What it needs
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </motion.div>

      <Modal
        open={!!open}
        onClose={() => setOpenKey(null)}
        title={open ? `${open.name} — what it needs` : ''}
      >
        <p style={{ margin: '0 0 10px', fontSize: 13.5, color: 'var(--slate)' }}>{open?.needs}</p>
        <p className="tip" style={{ margin: 0 }}>
          Until that exists this card stays "not connected". Nothing here reports a link it does
          not have.
        </p>
      </Modal>

      <p className="tip">
        Three honest states: <b>live</b> is verified from this running app, <b>ready to use</b>
        {' '}works right now because it deep-links into a service you're already signed into, and{' '}
        <b>not connected</b> means exactly that.
      </p>
    </div>
  );
}
