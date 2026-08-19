/**
 * "From Raghuvar" — what the other one sent, and the reply, in one tile.
 *
 * Replaces the shared daily photo and song: one frame and one track per date
 * that both people saw, with no sender and nowhere to answer. These arrive
 * from someone, and the exchange happens right here — replying writes a normal
 * message, so the same conversation is in Us without having to go there.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Camera, Music } from 'lucide-react';
import { useData, useStore } from '../../data/store';
import { useToast } from '../../ui/bits';
import { entrance } from '../../ui/motion';
import { fmtTime } from '../../lib/dates';
import { momentSrc } from '../../lib/moments';
import { latestFromOther, repliesTo, replyToMoment, sendPhoto, sendSong } from '../../lib/sends';
import { isYouTubeUrl, playUrl } from '../../lib/song';
import { TileOpen } from './personal';
import type { Message } from '../../types';

/** Resolves a stored photo to something an <img> can load. */
function useMomentSrc(attachment: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!attachment) {
      setSrc(null);
      return;
    }
    momentSrc(attachment).then((url) => alive && setSrc(url));
    return () => {
      alive = false;
    };
  }, [attachment]);
  return src;
}

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
  const [composing, setComposing] = useState<null | 'song'>(null);
  const [caption, setCaption] = useState('');
  const [song, setSong] = useState({ title: '', artist: '', url: '' });

  const photo = useMemo(() => latestFromOther(ds, meId, 'photo'), [ds.messages, meId]);
  const track = useMemo(() => latestFromOther(ds, meId, 'song'), [ds.messages, meId]);
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

  const suggest = async () => {
    const title = song.title.trim();
    if (!title) return;
    let url = song.url.trim();
    // Resolve a real YouTube link when none was pasted, so "Play" works for
    // the other person rather than dumping them into a search.
    if (!url || !isYouTubeUrl(url)) {
      const { resolveSong } = await import('../../lib/youtube');
      const found = await resolveSong(title, song.artist.trim());
      url = found?.url ?? url;
    }
    sendSong(store, { title, artist: song.artist.trim(), url }, '');
    setSong({ title: '', artist: '', url: '' });
    setComposing(null);
    toast(`Suggested to ${other.name}.`);
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
        <span className="eyebrow">From {other.name}</span>
        <div className="spacer" />
        <TileOpen to="/us" label="Us" />
      </div>

      <div className="bt-scroll">
        {!photo && !track && (
          <p className="tip" style={{ marginTop: 0 }}>
            Nothing shared lately. Send {other.name} a photo or a song.
          </p>
        )}

        {photo && (
          <motion.div
            className="mo-card"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: entrance }}
          >
            <span className="eyebrow">{other.name} shared a moment</span>
            {photoSrc ? (
              <img className="mo-photo" src={photoSrc} alt={photo.body || 'A shared moment'} loading="lazy" />
            ) : (
              <div className="mo-photo mo-photo-missing">Photo unavailable</div>
            )}
            {photo.body && <b className="mo-cap">{photo.body}</b>}
            <Replies moment={photo} />
          </motion.div>
        )}

        {track?.song_ref && (
          <motion.div
            className="mo-card"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: entrance }}
          >
            <span className="eyebrow">{other.name} suggested this song</span>
            <b className="mo-song">{track.song_ref.title}</b>
            <span className="mo-artist">{track.song_ref.artist}</span>
            <a
              className="btn sm"
              href={playUrl({
                song_url: track.song_ref.url,
                song_title: track.song_ref.title,
                song_artist: track.song_ref.artist,
              })}
              target="_blank"
              rel="noreferrer"
            >
              Play on YouTube
            </a>
            <Replies moment={track} />
          </motion.div>
        )}
      </div>

      {composing === 'song' ? (
        <div className="mo-compose">
          <input
            className="srch"
            value={song.title}
            placeholder="Song title"
            aria-label="Song title"
            autoFocus
            onChange={(e) => setSong((s) => ({ ...s, title: e.target.value }))}
          />
          <input
            className="srch"
            value={song.artist}
            placeholder="Artist"
            aria-label="Artist"
            onChange={(e) => setSong((s) => ({ ...s, artist: e.target.value }))}
          />
          <div className="rowgap">
            <button type="button" className="btn solid" onClick={suggest}>
              Send it
            </button>
            <button type="button" className="btn sm" onClick={() => setComposing(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
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
          <button
            type="button"
            className="btn sm"
            onClick={() => setComposing('song')}
            aria-label="Suggest a song"
          >
            <Music size={14} strokeWidth={1.8} aria-hidden />
            Song
          </button>
        </div>
      )}
    </>
  );
}
