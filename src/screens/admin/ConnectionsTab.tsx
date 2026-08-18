import { motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useData, useStore } from '../../data/store';
import { Modal, useToast } from '../../ui/bits';
import { staggerItem, staggerParent } from '../../ui/motion';
import { googleConfigured } from '../../lib/google';
import { youtubeConfigured } from '../../lib/youtube';
import {
  connectGoogle,
  describeSync,
  disconnectGoogle,
  googleGrant,
  hasScope,
  syncAll,
  trySilentConnect,
} from '../../lib/googleSync';
import { fmtDateTime } from '../../lib/dates';

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
  const [busy, setBusy] = useState<'connect' | 'sync' | null>(null);
  /**
   * Consent is stored; the access token is not (it lives in memory for its
   * hour and never touches the database). So a reload has a grant but no
   * token — this tries a silent re-grant, and the panel says which is true.
   */
  const [tokenLive, setTokenLive] = useState(false);

  const configured = googleConfigured();
  const grant = googleGrant(store);
  const linked = !!grant;

  useEffect(() => {
    if (!configured || !linked) return;
    let alive = true;
    trySilentConnect(store)
      .then((ok) => alive && setTokenLive(ok))
      .catch(() => alive && setTokenLive(false));
    return () => {
      alive = false;
    };
  }, [configured, linked, store]);

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
      `Anvik Ops — where things stand`,
      ``,
      `Open tasks: ${open}`,
      `Open decisions: ${decisions}`,
      ``,
      `Opened from the portal.`,
    ].join('\n');
  }, [ds.tasks, ds.decisions]);

  const runSync = async () => {
    setBusy('sync');
    try {
      const result = await syncAll(store);
      setTokenLive(true);
      toast(describeSync(result));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Google sync failed');
    } finally {
      setBusy(null);
    }
  };

  const connectAndSync = async () => {
    setBusy('connect');
    try {
      const ok = await connectGoogle(store);
      if (!ok) {
        toast('Google sign-in was closed');
        return;
      }
      setTokenLive(true);
      const result = await syncAll(store);
      toast(describeSync(result));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not connect Google');
    } finally {
      setBusy(null);
    }
  };

  const unlink = () => {
    disconnectGoogle(store);
    setTokenLive(false);
    toast('Google disconnected');
  };

  /* Every Google-shaped card reads from the one grant, so three of them can
     never disagree about whether you are connected. */
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
          href: 'https://github.com/anvik-anadya-raghuvar/anvik-ops/actions',
        },
      ],
    },
    {
      key: 'gmail',
      name: 'Gmail',
      state: googleState('gmail'),
      desc: hasScope(store, 'gmail')
        ? 'Your last 20 inbox messages sync into Knowledge → Mail, where they convert to tasks, notes and decisions. Read-only: nothing is ever sent on your behalf.'
        : configured
          ? 'Compose opens prefilled in your own mailbox. Inbox sync starts the moment you connect Google above.'
          : 'Compose opens prefilled in your own mailbox. Reading the inbox into the Mail tab needs the client id.',
      needs: configured ? undefined : clientIdNeeded,
      actions: [
        { label: `Email ${other.name}`, href: gmailCompose(other.email, 'Anvik Ops', '') },
        {
          label: 'Send the digest',
          href: gmailCompose(`${me.email},${other.email}`, 'Anvik Ops — digest', digest),
        },
      ],
    },
    {
      key: 'calendar',
      name: 'Google Calendar',
      state: googleState('calendar'),
      desc: hasScope(store, 'calendar')
        ? "Today's events land on the Home day ribbon, and a meeting cancelled in Google disappears from it on the next sync."
        : configured
          ? 'Opens a prefilled event today. Connect Google to pull your real day onto the ribbon.'
          : 'Task pages and people cards open a prefilled event. One-way, no linking needed.',
      needs: configured ? undefined : clientIdNeeded,
      actions: [
        {
          label: 'New event',
          href: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Anvik%20Ops',
        },
      ],
    },
    {
      key: 'drive',
      name: 'Google Drive',
      state: googleState('drive'),
      desc: hasScope(store, 'drive')
        ? 'Knowledge → Documents → + Document searches your Drive and attaches a file by reference. Files stay in Drive; only the link and the date live here.'
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
      key: 'whatsapp',
      name: 'WhatsApp',
      state: 'usable',
      desc: 'Click-to-chat for the escalation lane. Opens WhatsApp with the message ready.',
      actions: [
        {
          label: 'Open chat',
          href: `https://wa.me/?text=${encodeURIComponent('Anvik Ops — need you on something.')}`,
        },
      ],
    },
    {
      key: 'plaud',
      name: 'Plaud',
      state: 'planned',
      desc: 'Voice notes with transcripts are modelled and seeded, but nothing syncs from the device.',
      needs:
        'Plaud has no public API — this would be an export drop into Storage, then a parser on a schedule.',
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
      {/* One account, one consent, one button — the three Google cards below
          are all downstream of this. */}
      <div className="ad-goog">
        <div className="ad-conn-head">
          <h4>Google account</h4>
          <span className={`pill ${linked ? 'ok' : configured ? 'soon' : 'q'}`}>
            {linked ? 'connected' : configured ? 'ready to connect' : 'client id missing'}
          </span>
        </div>
        <p>
          {!configured
            ? 'Gmail, Calendar and Drive all run off one browser grant. Set VITE_GOOGLE_CLIENT_ID and this becomes a single button.'
            : linked
              ? `Gmail, Calendar and Drive granted${
                  grant?.last_sync_at
                    ? ` · last synced ${fmtDateTime(grant.last_sync_at)}`
                    : ' · never synced'
                }.`
              : 'One click grants Gmail, Calendar and Drive together, then pulls the first sync.'}
        </p>
        {configured && linked && (
          <p className="tip" style={{ margin: '8px 0 0' }}>
            {tokenLive
              ? 'Access token active for this session. Tokens live in memory only — never in the database, never in local storage.'
              : 'Consent is on record but this session holds no token, so the next sync asks Google again. That is the trade for storing nothing long-lived.'}
          </p>
        )}
        <div className="ad-conn-acts">
          {!configured ? (
            <button type="button" className="btn sm" onClick={() => setOpenKey('gmail')}>
              What it needs
            </button>
          ) : linked ? (
            <>
              <button
                type="button"
                className="btn sm solid"
                onClick={runSync}
                disabled={busy !== null}
              >
                <RefreshCw size={12} strokeWidth={2} />{' '}
                {busy === 'sync' ? 'Syncing…' : 'Sync all connectors'}
              </button>
              <button type="button" className="btn sm" onClick={unlink} disabled={busy !== null}>
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn sm solid"
              onClick={connectAndSync}
              disabled={busy !== null}
            >
              {busy === 'connect' ? 'Waiting for Google…' : 'Connect & sync all'}
            </button>
          )}
        </div>
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
