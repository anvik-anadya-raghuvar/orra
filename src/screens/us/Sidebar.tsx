import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Music, Play } from 'lucide-react';
import type { Message } from '../../types';
import { useData, useStore } from '../../data/store';
import { Avatar, Modal, useToast } from '../../ui/bits';
import { DictateField } from '../../ui/dictation';
import { lift, staggerItem, staggerParent } from '../../ui/motion';
import { fmtDay } from '../../lib/dates';
import { useMomentSrc } from '../../lib/useMomentSrc';
import { playUrl } from '../../lib/song';

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

/* -- what has been shared -------------------------------------------------
   Photos and songs live in the thread like everything else -- one row, many
   views (principle 10), so these are filtered views of `messages` and never a
   second copy. The thread answers "what did we say"; these two answer "what
   have we sent each other", which scrolling back through months of chat is a
   terrible way to ask. Each is its own shelf because a picture and a track are
   not the same kind of thing to go looking for. */

type Who = 'all' | 'mine' | 'theirs';

/** Whose shares to show. Three states rather than a checkbox because "just the
 *  ones I sent" and "just the ones they sent" are both real questions. */
function WhoFilter({
  value,
  onChange,
  otherName,
  label,
}: {
  value: Who;
  onChange: (w: Who) => void;
  otherName: string;
  label: string;
}) {
  const opts: { key: Who; text: string }[] = [
    { key: 'all', text: 'Both' },
    { key: 'mine', text: 'You' },
    { key: 'theirs', text: otherName },
  ];
  return (
    <div className="usfilter" role="group" aria-label={label}>
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`chip${value === o.key ? ' on' : ''}`}
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

/** One kind of message, narrowed to whose it is, newest first. */
function useShares(kind: 'photo' | 'song', who: Who) {
  const messages = useData((ds) => ds.messages);
  const meId = useData((_, s) => s.meId);
  return useMemo(
    () =>
      messages
        .filter((m) => m.kind === kind)
        .filter((m) =>
          who === 'all' ? true : who === 'mine' ? m.sender_id === meId : m.sender_id !== meId,
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [messages, kind, who, meId],
  );
}

function Thumb({ m, onOpen }: { m: Message; onOpen: (m: Message) => void }) {
  const src = useMomentSrc(m.attachment_url);
  return (
    <button
      type="button"
      className="usthumb"
      onClick={() => onOpen(m)}
      aria-label={`Open the photo from ${fmtDay(m.created_at)}${m.body ? ` - ${m.body}` : ''}`}
    >
      {src ? (
        <img src={src} alt="" loading="lazy" />
      ) : (
        <span className="usthumb-empty" aria-hidden>
          {src === undefined ? '…' : '×'}
        </span>
      )}
    </button>
  );
}

/** The full picture, plus the way back to what was being said around it. */
function PhotoViewer({
  m,
  onClose,
  onJump,
}: {
  m: Message | null;
  onClose: () => void;
  onJump: (id: string) => void;
}) {
  const src = useMomentSrc(m?.attachment_url ?? null);
  const ds = useData((d) => d);
  const sender = m ? ds.profiles.find((p) => p.id === m.sender_id) : undefined;
  return (
    <Modal
      open={!!m}
      onClose={onClose}
      title={m ? `${sender?.name ?? 'Sent'} · ${fmtDay(m.created_at)}` : ''}
    >
      {m && (
        <div className="usviewer">
          {src ? (
            <img src={src} alt={m.body || 'A shared moment'} />
          ) : (
            <p className="tip">
              {src === undefined ? 'Loading…' : 'That photo could not be loaded.'}
            </p>
          )}
          {m.body && <p className="usviewer-cap">{m.body}</p>}
          <div className="usviewer-act">
            <button
              type="button"
              className="btn sm solid"
              onClick={() => {
                onJump(m.id);
                onClose();
              }}
            >
              Show in the thread
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function PhotosCard({ onJump }: { onJump: (id: string) => void }) {
  const other = useData((_, s) => s.other);
  const [who, setWho] = useState<Who>('all');
  const [open, setOpen] = useState<Message | null>(null);
  const shots = useShares('photo', who);

  return (
    <motion.div className="uscard" variants={staggerItem} {...lift}>
      <div className="uscard-hd">
        <h3>Photos</h3>
        <span className="mono uscard-n">{shots.length}</span>
      </div>
      <WhoFilter value={who} onChange={setWho} otherName={other.name} label="Whose photos to show" />
      {shots.length === 0 ? (
        <p className="tip">
          {who === 'all'
            ? 'No photos yet. Send one from the composer and it lands here.'
            : 'Nothing from this one yet.'}
        </p>
      ) : (
        <div className="usgrid">
          {shots.map((m) => (
            <Thumb key={m.id} m={m} onOpen={setOpen} />
          ))}
        </div>
      )}
      <PhotoViewer m={open} onClose={() => setOpen(null)} onJump={onJump} />
    </motion.div>
  );
}

function SongsCard({ onJump }: { onJump: (id: string) => void }) {
  const other = useData((_, s) => s.other);
  const ds = useData((d) => d);
  const [who, setWho] = useState<Who>('all');
  const tracks = useShares('song', who);

  return (
    <motion.div className="uscard" variants={staggerItem} {...lift}>
      <div className="uscard-hd">
        <h3>Songs</h3>
        <span className="mono uscard-n">{tracks.length}</span>
      </div>
      <WhoFilter value={who} onChange={setWho} otherName={other.name} label="Whose songs to show" />
      {tracks.length === 0 ? (
        <p className="tip">
          {who === 'all'
            ? 'No songs yet. Suggest one from the composer and it lands here.'
            : 'Nothing from this one yet.'}
        </p>
      ) : (
        <ul className="ussongs">
          {tracks.map((m) => (
            <li key={m.id}>
              <span className="ussong-ic" aria-hidden>
                <Music size={14} strokeWidth={1.8} />
              </span>
              <button type="button" className="ussong-t" onClick={() => onJump(m.id)}>
                <b>{m.song_ref?.title ?? 'Untitled'}</b>
                <span>
                  {[
                    m.song_ref?.artist,
                    ds.profiles.find((p) => p.id === m.sender_id)?.name,
                    fmtDay(m.created_at),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </button>
              {m.song_ref && (
                <a
                  className="btn sm"
                  href={playUrl({
                    song_url: m.song_ref.url,
                    song_title: m.song_ref.title,
                    song_artist: m.song_ref.artist,
                  })}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Play ${m.song_ref.title} on YouTube`}
                >
                  <Play size={13} strokeWidth={2} aria-hidden /> Play
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}

export function SideColumn({
  onRitual,
  onJump,
}: {
  onRitual: (text: string) => void;
  onJump: (id: string) => void;
}) {
  return (
    <motion.div className="usside" {...staggerParent()}>
      <StatusCard />
      {/* The daily shared photo and song are gone: they had no sender and
          nowhere to answer. Sending lives in the composer now, and what
          arrived shows up in the thread and on Home. */}
      <RitualsCard onRitual={onRitual} />
      <PhotosCard onJump={onJump} />
      <SongsCard onJump={onJump} />
    </motion.div>
  );
}
