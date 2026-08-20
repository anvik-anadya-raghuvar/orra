import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useData, useStore } from '../../data/store';
import { Avatar, useToast } from '../../ui/bits';
import { DictateField } from '../../ui/dictation';
import { lift, staggerItem, staggerParent } from '../../ui/motion';

type Expiry = '' | '1h' | '3h' | 'eod';

/** Card 1 — self-declared status, expiring on its own. */
function StatusCard() {
  const store = useStore();
  const me = useData((_, s) => s.me);
  const other = useData((_, s) => s.other);
  const toast = useToast();
  const [text, setText] = useState(me.status_text ?? '');
  const [expiry, setExpiry] = useState<Expiry>('');

  useEffect(() => {
    setText(me.status_text ?? '');
  }, [me.id, me.status_text]);

  const save = () => {
    let expires: string | null = null;
    const now = new Date();
    if (expiry === '1h') expires = new Date(now.getTime() + 3600_000).toISOString();
    else if (expiry === '3h') expires = new Date(now.getTime() + 3 * 3600_000).toISOString();
    else if (expiry === 'eod') {
      const eod = new Date(now);
      eod.setHours(23, 59, 59, 999);
      expires = eod.toISOString();
    }
    store.update(
      'profiles',
      me.id,
      { status_text: text.trim() || null, status_expires_at: expires },
      store.asMe({ summary: 'Status updated' }),
    );
    toast('Status set');
  };

  const otherExpired = !!other.status_expires_at && new Date(other.status_expires_at).getTime() < Date.now();
  const otherHasStatus = !!other.status_text && !otherExpired;

  return (
    <motion.div className="uscard" variants={staggerItem} {...lift}>
      <div className="eyebrow">Between us · right now</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 9 }}>
        <Avatar userId={other.id} size={30} />
        <div>
          {otherHasStatus ? (
            <b style={{ fontSize: 13.5 }}>{other.status_text}</b>
          ) : (
            <b style={{ fontSize: 13.5, color: 'var(--mute)', fontWeight: 500 }}>No status</b>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--mute)' }}>
            Clears automatically when it expires.
          </div>
        </div>
      </div>
      <DictateField label="Dictate your status">
        <input
          className="statusinput"
          style={{ marginTop: 10 }}
          value={text}
          placeholder="What are you up to…"
          onChange={(e) => setText(e.target.value)}
          aria-label="My status"
        />
      </DictateField>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <select
          className="statuslike"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value as Expiry)}
          aria-label="Status expiry"
        >
          <option value="">No expiry</option>
          <option value="1h">Clears in 1 hour</option>
          <option value="3h">Clears in 3 hours</option>
          <option value="eod">Clears end of day</option>
        </select>
        <button className="btn sm" type="button" onClick={save}>
          Set my status
        </button>
      </div>
    </motion.div>
  );
}

const RITUALS: { key: string; label: string; hint: string; text: string }[] = [
  { key: 'morning', label: 'Morning brief', hint: 'What today looks like for me', text: "Morning brief — today I'm on: " },
  { key: 'eod', label: 'End of day', hint: 'Shipped, stuck, tomorrow', text: 'End of day — shipped: \nStuck: \nTomorrow: ' },
  { key: 'blocked', label: 'Blocked on', hint: 'Say it before it festers', text: 'Blocked on: ' },
  {
    key: 'chai',
    label: 'Chai break',
    hint: 'Let’s take a proper break and catch up on something beyond work.',
    text: 'Chai break? Let’s catch up on something that isn’t work.',
  },
];

function RitualsCard({ onRitual }: { onRitual: (text: string) => void }) {
  return (
    <motion.div className="uscard" variants={staggerItem} {...lift}>
      <h3>Tiny rituals</h3>
      <div className="ritualb">
        {RITUALS.map((r) => (
          <button key={r.key} type="button" onClick={() => onRitual(r.text)}>
            <b>{r.label}</b>
            {r.hint}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

export function SideColumn({ onRitual }: { onRitual: (text: string) => void }) {
  return (
    <motion.div {...staggerParent()}>
      <StatusCard />
      {/* The daily shared photo and song are gone: they had no sender and
          nowhere to answer. Sending lives in the composer now, and what
          arrived shows up in the thread and on Home. */}
      <RitualsCard onRitual={onRitual} />
    </motion.div>
  );
}
