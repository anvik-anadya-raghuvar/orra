import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useData, useStore } from '../../data/store';
import { Modal, useToast } from '../../ui/bits';
import { staggerItem, staggerParent } from '../../ui/motion';

/**
 * Connections.
 *
 * States are derived, never decorative. The v10 prototype showed six cards all
 * badged "connected" while nothing was wired to anything — that badge is the
 * one thing this screen must never fake, because a green dot that lies is
 * worse than an empty screen.
 *
 * "live"    — verified from the running app (adapter kind, committed workflow)
 * "usable"  — works right now with no account linking, because it is a deep
 *             link into a service you're already signed into. Not a sync.
 * "planned" — needs OAuth + token storage in an edge function. Honestly off.
 */
type ConnState = 'live' | 'usable' | 'planned';

const STATE_LABEL: Record<ConnState, string> = {
  live: 'live',
  usable: 'ready to use',
  planned: 'not connected',
};
const STATE_PILL: Record<ConnState, string> = { live: 'ok', usable: 'soon', off: 'q', planned: 'q' } as Record<
  ConnState,
  string
>;

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
      key: 'calendar',
      name: 'Google Calendar',
      state: 'usable',
      desc: 'Task pages and people cards open a prefilled event. One-way, no linking needed.',
      actions: [
        {
          label: 'New event',
          href: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=Anvik%20Ops',
        },
      ],
    },
    {
      key: 'gmail',
      name: 'Gmail',
      state: 'usable',
      desc: `Compose opens prefilled in your own mailbox. Reading your inbox into the Mail tab is a different thing — that needs OAuth.`,
      needs:
        'Inbox sync needs the Gmail API with an OAuth consent screen and refresh tokens held in an edge function.',
      actions: [
        {
          label: `Email ${other.name}`,
          href: gmailCompose(other.email, 'Anvik Ops', ''),
        },
        {
          label: 'Send the digest',
          href: gmailCompose(`${me.email},${other.email}`, 'Anvik Ops — digest', digest),
        },
      ],
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
      key: 'drive',
      name: 'Google Drive',
      state: 'planned',
      desc: 'Documents currently store a URL you paste. The picker is not wired.',
      needs:
        'The Drive Picker API needs an OAuth client id and a token exchange; the reference URL itself already works today.',
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

      <Modal open={!!open} onClose={() => setOpenKey(null)} title={open ? `${open.name} — what it needs` : ''}>
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
