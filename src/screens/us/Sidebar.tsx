import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { newId, nowIso, today, useData, useStore } from '../../data/store';
import { Avatar, CountUp, useToast } from '../../ui/bits';
import { lift, staggerItem, staggerList, staggerParent } from '../../ui/motion';
import { compressPhoto } from '../../lib/photo';
import { resolveSong } from '../../lib/youtube';

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
      <input
        className="statusinput"
        style={{ marginTop: 10 }}
        value={text}
        placeholder="What are you up to…"
        onChange={(e) => setText(e.target.value)}
        aria-label="My status"
      />
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

/** Card 2 — song of the day, shared between the two of you. */
function SongCard() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const daily = useMemo(() => ds.shared_daily.find((s) => s.date === today()), [ds.shared_daily]);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [url, setUrl] = useState('');

  const save = async () => {
    if (!title.trim()) return;
    // Same rule as the Home tile: a blank URL is resolved by YouTube once, at
    // save time, so Play opens the track rather than a search page.
    const resolved = url.trim() || (await resolveSong(title.trim(), artist.trim()))?.url || '';
    if (daily) {
      store.update(
        'shared_daily',
        daily.id,
        { song_title: title.trim(), song_artist: artist.trim(), song_url: resolved, picked_by: store.meId },
        store.asMe({ summary: 'Song of the day updated' }),
      );
    } else {
      store.insert(
        'shared_daily',
        {
          id: newId('sd'),
          date: today(),
          song_title: title.trim(),
          song_artist: artist.trim(),
          song_url: resolved,
          picked_by: store.meId,
          photo_url: null,
          photo_caption: null,
        },
        store.asMe({ summary: 'Song of the day picked' }),
      );
    }
    setTitle('');
    setArtist('');
    setUrl('');
    toast('Song saved');
  };

  const pickedByName = daily ? ds.profiles.find((p) => p.id === daily.picked_by)?.name : null;

  return (
    <motion.div className="uscard" variants={staggerItem} {...lift}>
      <h3>Song of the day</h3>
      <div className="songart">{daily && daily.song_title ? `${daily.song_title} · ${daily.song_artist}` : 'Nothing picked yet'}</div>
      {daily && daily.song_title && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 7 }}>
          <Avatar userId={daily.picked_by} size={20} />
          <span style={{ fontSize: 11.5, color: 'var(--mute)' }}>Picked by {pickedByName}</span>
        </div>
      )}
      <div style={{ display: 'grid', gap: 6, marginTop: 9 }}>
        <input className="statusinput" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="statusinput" placeholder="Artist" value={artist} onChange={(e) => setArtist(e.target.value)} />
        <input className="statusinput" placeholder="Link (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <div style={{ display: 'flex', gap: 6 }}>
          {daily?.song_url && (
            <a className="btn sm" href={daily.song_url} target="_blank" rel="noreferrer">
              ▶ Play
            </a>
          )}
          <button className="btn sm solid" type="button" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/** Card 3 — photo of the day, compressed client-side to ≤200KB. */
function PhotoCard() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const daily = useMemo(() => ds.shared_daily.find((s) => s.date === today()), [ds.shared_daily]);
  const [caption, setCaption] = useState(daily?.photo_caption ?? '');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCaption(daily?.photo_caption ?? '');
  }, [daily?.id, daily?.photo_caption]);

  const ensureDaily = () => {
    if (daily) return daily;
    const row = {
      id: newId('sd'),
      date: today(),
      song_title: '',
      song_artist: '',
      song_url: '',
      picked_by: store.meId,
      photo_url: null,
      photo_caption: null,
    };
    store.insert('shared_daily', row, store.asMe({ summary: 'Shared daily row created' }));
    return row;
  };

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      const dataUrl = await compressPhoto(file);
      const row = ensureDaily();
      store.update('shared_daily', row.id, { photo_url: dataUrl }, store.asMe({ summary: 'Photo of the day added' }));
      toast('Photo added');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not read that image');
    } finally {
      setBusy(false);
    }
  };

  const saveCaption = () => {
    const row = ensureDaily();
    store.update(
      'shared_daily',
      row.id,
      { photo_caption: caption.trim() || null },
      store.asMe({ summary: 'Photo caption updated' }),
    );
    toast('Caption saved');
  };

  return (
    <motion.div className="uscard" variants={staggerItem} {...lift}>
      <h3>Photo of the day</h3>
      <div className="photobox">
        {daily?.photo_url ? (
          <img src={daily.photo_url} alt={daily.photo_caption ?? 'Photo of the day'} loading="lazy" />
        ) : busy ? (
          'Compressing…'
        ) : (
          'A coffee, a screenshot, a ridiculous moment — anything.'
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <input
          className="statusinput"
          placeholder="Caption…"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          style={{ flex: '1 1 120px' }}
        />
        <button className="btn sm" type="button" onClick={saveCaption}>
          Save
        </button>
      </div>
      <button className="btn sm" type="button" style={{ marginTop: 8 }} disabled={busy} onClick={() => fileRef.current?.click()}>
        {busy ? 'Compressing…' : 'Upload photo'}
      </button>
    </motion.div>
  );
}

/** Card 4 — tiny ritual prefills, dropped straight into the composer. */
const RITUALS: { key: string; label: string; hint: string; text: string }[] = [
  { key: 'morning', label: 'Morning brief', hint: 'What today looks like for me', text: "Morning brief — today I'm on: " },
  { key: 'eod', label: 'End of day', hint: 'Shipped, stuck, tomorrow', text: 'End of day — shipped: \nStuck: \nTomorrow: ' },
  { key: 'blocked', label: 'Blocked on', hint: 'Say it before it festers', text: 'Blocked on: ' },
  { key: 'chai', label: 'Chai break', hint: 'A legitimate operating ritual', text: 'Chai in 10?' },
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

/** Card 5 — a quiet count of what left the room this week. */
function PromotedCard() {
  const ds = useData((d) => d);
  const count = useMemo(() => {
    const cutoff = Date.now() - 7 * 86_400_000;
    return ds.messages.filter((m) => m.promoted_to_type && new Date(m.created_at).getTime() >= cutoff).length;
  }, [ds.messages]);

  return (
    <motion.div className="uscard" variants={staggerItem} {...lift}>
      <h3>Promoted this week</h3>
      <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 28 }}>
        <CountUp value={count} />
      </div>
      <p className="tip" style={{ marginTop: 6 }}>
        Messages turned into tasks, notes, or decisions in the last 7 days. Everything else stayed a
        conversation, which is the point.
      </p>
    </motion.div>
  );
}

export function SideColumn({ onRitual }: { onRitual: (text: string) => void }) {
  return (
    <motion.div {...staggerParent()}>
      <StatusCard />
      <SongCard />
      <PhotoCard />
      <RitualsCard onRitual={onRitual} />
      <PromotedCard />
    </motion.div>
  );
}
