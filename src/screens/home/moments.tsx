/**
 * "From Raghuvar" — what the other one sent, and the reply, in one tile.
 *
 * Replaces the shared daily photo and song: one frame and one track per date
 * that both people saw, with no sender and nowhere to answer. These arrive
 * from someone, and the exchange happens right here — replying writes a normal
 * message, so the same conversation is in Us without having to go there.
 */
import React, { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, Music, Play } from 'lucide-react';
import { useData, useStore } from '../../data/store';
import { useToast } from '../../ui/bits';
import { entrance } from '../../ui/motion';
import { fmtTime } from '../../lib/dates';
import { useMomentSrc } from '../../lib/useMomentSrc';
import { latestMoment, repliesTo, replyToMoment, sendPhoto, sendSong } from '../../lib/sends';
import { isYouTubeUrl, playUrl } from '../../lib/song';
import { TileOpen } from './personal';
import type { Message, SharedDaily } from '../../types';

function Replies({ moment }: { moment: Message }) {
  const ds = useData((d) => d);
  const store = useStore();
  const meId = useData((_, s) => s.meId);
  const [draft, setDraft] = useState('');
  const replies = useMemo(() => repliesTo(ds, moment.id), [ds.messages, moment.id]);

  const send = () => {
    if (!draft.trim()) return;
    replyToMoment(store, moment.id, draft);
    setDraft('');
  };

  return (
    <div className="mo-replies">
      {replies.map((r) => (
        <div key={r.id} className={`mo-reply${r.sender_id === meId ? ' mine' : ''}`}>
          <span>{r.body}</span>
          <span className="mono mo-time">{fmtTime(r.created_at)}</span>
        </div>
      ))}
      <input
        className="srch"
        value={draft}
        placeholder="Say something back…"
        aria-label="Reply to this"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={send}
        // Enter sends directly rather than going via blur(): routing it
        // through a blur meant a keypress that never produced one silently
        // did nothing, and the typed reply just sat there.
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          send();
        }}
      />
    </div>
  );
}

export function MomentsTile() {
  const ds = useData((d) => d);
  const store = useStore();
  const meId = useData((_, s) => s.meId);
  const other = useData((_, s) => s.other);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [caption, setCaption] = useState('');

  const photo = useMemo(() => latestMoment(ds, 'photo'), [ds.messages]);
  const photoSrc = useMomentSrc(photo?.attachment_url);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-picked after a failure
    if (!file) return;
    setBusy(true);
    try {
      const { compressPhoto } = await import('../../lib/photo');
      const dataUrl = await compressPhoto(file);
      await sendPhoto(store, dataUrl, caption);
      setCaption('');
      toast(`Sent to ${other.name}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That image could not be sent');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={pick}
        aria-label="Take or choose a photo"
      />
      <div className="bt-hd">
        <span className="eyebrow">Shared moments</span>
        <div className="spacer" />
        <TileOpen to="/us" label="Us" />
      </div>

      <div className="bt-scroll">
        {!photo && (
          <p className="tip" style={{ marginTop: 0 }}>
            No photo in your thread yet. Send {other.name} one from here.
          </p>
        )}

        {photo && (
          <motion.div
            className="mo-card"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: entrance }}
          >
            <span className="eyebrow">
              {photo.sender_id === meId ? 'You shared a moment' : `${other.name} shared a moment`}
            </span>
            {photoSrc ? (
              <img className="mo-photo" src={photoSrc} alt={photo.body || 'A shared moment'} loading="lazy" />
            ) : photoSrc === undefined ? (
              <div className="mo-photo mo-photo-missing">Loading photo…</div>
            ) : (
              <div className="mo-photo mo-photo-missing">Photo unavailable</div>
            )}
            {photo.body && <b className="mo-cap">{photo.body}</b>}
            <Replies moment={photo} />
          </motion.div>
        )}
      </div>

      <div className="mo-send">
        <input
          className="srch"
          value={caption}
          placeholder="Caption, then send a photo…"
          aria-label="Caption for the photo you send"
          onChange={(e) => setCaption(e.target.value)}
        />
        <button
          type="button"
          className="btn sm"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          aria-label="Send a photo"
        >
          <Camera size={14} strokeWidth={1.8} aria-hidden />
          {busy ? 'Sending…' : 'Photo'}
        </button>
      </div>
    </>
  );
}

const DAILY_SONGS: Pick<SharedDaily, 'song_title' | 'song_artist' | 'song_url'>[] = [
  { song_title: 'Ilahi', song_artist: 'Pritam · Arijit Singh', song_url: 'https://www.youtube.com/watch?v=UBscsdrK0Bo' },
  { song_title: 'Here Comes the Sun', song_artist: 'The Beatles', song_url: '' },
  { song_title: 'Bloom', song_artist: 'The Paper Kites', song_url: '' },
  { song_title: 'Sweet Disposition', song_artist: 'The Temper Trap', song_url: '' },
  { song_title: 'Kasoor', song_artist: 'Prateek Kuhad', song_url: '' },
  { song_title: 'Dog Days Are Over', song_artist: 'Florence + The Machine', song_url: '' },
  { song_title: 'The Nights', song_artist: 'Avicii', song_url: '' },
];

function automaticSong(date = new Date()): Pick<SharedDaily, 'song_title' | 'song_artist' | 'song_url'> {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  return DAILY_SONGS[Math.abs(day) % DAILY_SONGS.length];
}

/** A dedicated, always-playable Home surface. Suggestions never disappear
 * behind the photo preference; the automatic pick still appears every day. */
export function SongTile() {
  const ds = useData((d) => d);
  const store = useStore();
  const meId = useData((_, s) => s.meId);
  const other = useData((_, s) => s.other);
  const toast = useToast();
  const [composing, setComposing] = useState(false);
  const [song, setSong] = useState({ title: '', artist: '', url: '' });
  const suggested = useMemo(() => latestMoment(ds, 'song'), [ds.messages]);
  const stored = useMemo(
    () => [...ds.shared_daily].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null,
    [ds.shared_daily],
  );
  const daily = stored ?? automaticSong();

  const suggest = async () => {
    const title = song.title.trim();
    if (!title) return;
    let url = song.url.trim();
    if (!url || !isYouTubeUrl(url)) {
      const { resolveSong } = await import('../../lib/youtube');
      const found = await resolveSong(title, song.artist.trim());
      url = found?.url ?? url;
    }
    sendSong(store, { title, artist: song.artist.trim(), url }, '');
    setSong({ title: '', artist: '', url: '' });
    setComposing(false);
    toast(`Suggested to ${other.name}.`);
  };

  const Track = ({ title, artist, url, label }: { title: string; artist: string; url: string; label: string }) => (
    <div className="mo-card song-card">
      <span className="eyebrow">{label}</span>
      <b className="mo-song">{title}</b>
      <span className="mo-artist">{artist}</span>
      <a
        className="btn sm solid"
        href={playUrl({ song_url: url, song_title: title, song_artist: artist })}
        target="_blank"
        rel="noreferrer"
      >
        <Play size={13} fill="currentColor" aria-hidden /> Play
      </a>
    </div>
  );

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Song for today</span>
        <span className="spacer" />
        <TileOpen to="/us" label="Us" />
        <button type="button" className="btn sm" onClick={() => setComposing((v) => !v)}>
          <Music size={13} aria-hidden /> Suggest one
        </button>
      </div>
      <div className="bt-scroll song-stack">
        {suggested?.song_ref && (
          <>
            <Track
              title={suggested.song_ref.title}
              artist={suggested.song_ref.artist}
              url={suggested.song_ref.url}
              label={suggested.sender_id === meId ? 'You suggested' : `${other.name} suggested`}
            />
            <Replies moment={suggested} />
          </>
        )}
        <Track
          title={daily.song_title}
          artist={daily.song_artist}
          url={daily.song_url}
          label="Automatic daily pick"
        />
      </div>
      {composing && (
        <div className="mo-compose">
          <input className="srch" autoFocus value={song.title} placeholder="Song title" onChange={(e) => setSong((s) => ({ ...s, title: e.target.value }))} />
          <input className="srch" value={song.artist} placeholder="Artist" onChange={(e) => setSong((s) => ({ ...s, artist: e.target.value }))} />
          <input className="srch" value={song.url} placeholder="YouTube link (optional)" onChange={(e) => setSong((s) => ({ ...s, url: e.target.value }))} />
          <button className="btn sm solid" type="button" disabled={!song.title.trim()} onClick={suggest}>Send suggestion</button>
        </div>
      )}
    </>
  );
}
