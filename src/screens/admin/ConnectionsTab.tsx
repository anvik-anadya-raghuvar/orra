import { motion } from 'framer-motion';
import { useStore } from '../../data/store';
import { staggerItem, staggerList } from '../../ui/motion';

type ConnState = 'ok' | 'warn' | 'off';

interface Conn {
  key: string;
  name: string;
  state: ConnState;
  desc: string;
}

const STATE_LABEL: Record<ConnState, string> = {
  ok: 'connected',
  warn: 'needs attention',
  off: 'not connected',
};
const STATE_PILL: Record<ConnState, string> = { ok: 'ok', warn: 'soon', off: 'q' };

export default function ConnectionsTab() {
  const store = useStore();
  const supabaseLive = store.adapter.kind === 'supabase';

  const conns: Conn[] = [
    {
      key: 'supabase',
      name: 'Supabase',
      state: supabaseLive ? 'ok' : 'warn',
      desc: supabaseLive
        ? 'Live — Postgres, Auth, Storage, and Realtime are wired in.'
        : 'Mock mode — running on local storage, no Supabase project connected yet.',
    },
    {
      key: 'github',
      name: 'GitHub keepalive',
      state: 'ok',
      desc: '3-day cron committed — keeps the free-tier project from sleeping.',
    },
    {
      key: 'gmail',
      name: 'Gmail',
      state: 'off',
      desc: 'Planned — Gmail API testing mode, not wired into the portal yet.',
    },
    {
      key: 'plaud',
      name: 'Plaud',
      state: 'off',
      desc: 'Planned — voice notes and transcripts will sync from here.',
    },
    {
      key: 'drive',
      name: 'Google Drive',
      state: 'off',
      desc: 'Planned — documents will attach by reference through the picker.',
    },
    {
      key: 'pages',
      name: 'Cloudflare Pages',
      state: 'warn',
      desc: 'Connect the repo to enable deploys on push.',
    },
  ];

  return (
    <div>
      <motion.div className="ad-conns" variants={staggerList} initial="initial" animate="animate">
        {conns.map((c) => (
          <motion.div key={c.key} className="ad-conn" variants={staggerItem}>
            <div className="ad-conn-head">
              <h4>{c.name}</h4>
              <span className={`pill ${STATE_PILL[c.state]}`}>{STATE_LABEL[c.state]}</span>
            </div>
            <p>{c.desc}</p>
          </motion.div>
        ))}
      </motion.div>
      <p className="tip">Honest states only — nothing here claims to be connected unless it actually is.</p>
    </div>
  );
}
