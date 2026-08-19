import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { Dataset, Message } from '../../types';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { Camera, Music } from 'lucide-react';
import { Avatar, Modal, useToast } from '../../ui/bits';
import { entrance } from '../../ui/motion';
import { fmtDay, fmtTime, todayIso } from '../../lib/dates';
import { momentSrc } from '../../lib/moments';
import { sendPhoto, sendSong } from '../../lib/sends';
import { isYouTubeUrl, playUrl } from '../../lib/song';
import { PromoteModal, type PromoteKind, type PromoteTarget } from './PromoteModal';
import { SideColumn } from './Sidebar';
import './us.css';

type Row = { kind: 'day'; label: string; date: string } | { kind: 'msg'; m: Message };

/** Group messages (already sorted) into day separators + rows. */
function groupByDay(sorted: Message[]): Row[] {
  const out: Row[] = [];
  const today = todayIso();
  let lastDay = '';
  for (const m of sorted) {
    const day = m.created_at.slice(0, 10);
    if (day !== lastDay) {
      out.push({ kind: 'day', label: day === today ? `Today · ${fmtDay(m.created_at)}` : fmtDay(m.created_at), date: day });
      lastDay = day;
    }
    out.push({ kind: 'msg', m });
  }
  return out;
}

/** Capture or pick a photo and send it. `capture` makes a phone offer the
 *  camera first, which is what "capture a moment" actually means on mobile. */
function SendPhotoButton() {
  const store = useStore();
  const other = useData((_, s) => s.other);
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const { compressPhoto } = await import('../../lib/photo');
      await sendPhoto(store, await compressPhoto(file), '');
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
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={pick}
        aria-label="Take or choose a photo"
      />
      <button className="btn sm" type="button" disabled={busy} onClick={() => ref.current?.click()}>
        <Camera size={14} strokeWidth={1.8} aria-hidden /> {busy ? 'Sending…' : 'Photo'}
      </button>
    </>
  );
}

function SendSongButton() {
  const store = useStore();
  const other = useData((_, s) => s.other);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [url, setUrl] = useState('');

  const suggest = async () => {
    const t = title.trim();
    if (!t) return;
    let link = url.trim();
    if (!link || !isYouTubeUrl(link)) {
      const { resolveSong } = await import('../../lib/youtube');
      link = (await resolveSong(t, artist.trim()))?.url ?? link;
    }
    sendSong(store, { title: t, artist: artist.trim(), url: link }, '');
    setTitle('');
    setArtist('');
    setUrl('');
    setOpen(false);
    toast(`Suggested to ${other.name}.`);
  };

  return (
    <>
      <button className="btn sm" type="button" onClick={() => setOpen(true)}>
        <Music size={14} strokeWidth={1.8} aria-hidden /> Song
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Suggest a song to ${other.name}`}>
        <input className="statuslike" value={title} autoFocus placeholder="Song title" aria-label="Song title" onChange={(e) => setTitle(e.target.value)} />
        <div style={{ height: 8 }} />
        <input className="statuslike" value={artist} placeholder="Artist" aria-label="Artist" onChange={(e) => setArtist(e.target.value)} />
        <div style={{ height: 8 }} />
        <input className="statuslike" value={url} placeholder="YouTube link (optional)" aria-label="YouTube link" onChange={(e) => setUrl(e.target.value)} />
        <p className="tip">Leave the link blank and the portal finds it, so Play works for both of you.</p>
        <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
          <button className="btn" type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button className="btn solid" type="button" onClick={suggest} disabled={!title.trim()}>
            Send it
          </button>
        </div>
      </Modal>
    </>
  );
}

/** A sent photo. The bucket is private, so the src is a signed URL fetched
 *  on demand rather than something stored in the row. */
function PhotoBubble({ m }: { m: Message }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (m.attachment_url) momentSrc(m.attachment_url).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [m.attachment_url]);
  if (!src) return <div className="msgphoto msgphoto-missing">Photo unavailable</div>;
  return <img className="msgphoto" src={src} alt={m.body || 'A shared moment'} loading="lazy" />;
}

function Bubble({
  m,
  mine,
  ds,
  onPromote,
}: {
  m: Message;
  mine: boolean;
  ds: Dataset;
  onPromote: (m: Message, kind: PromoteKind) => void;
}) {
  const sender = ds.profiles.find((p) => p.id === m.sender_id);
  const task = m.task_ref_id ? ds.tasks.find((t) => t.id === m.task_ref_id) : undefined;

  return (
    <motion.div
      className={`msgrow${mine ? ' me' : ''}`}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: entrance }}
    >
      <Avatar userId={m.sender_id} size={26} />
      <div className="bubble">
        <div className="msgmeta">
          {sender?.name ?? 'Someone'} · {fmtTime(m.created_at)}
        </div>
        {m.kind === 'photo' && <PhotoBubble m={m} />}
        {m.kind === 'song' && m.song_ref && (
          <div className="msgsong">
            <b>{m.song_ref.title}</b>
            <span>{m.song_ref.artist}</span>
            <a
              className="btn sm"
              href={playUrl({
                song_url: m.song_ref.url,
                song_title: m.song_ref.title,
                song_artist: m.song_ref.artist,
              })}
              target="_blank"
              rel="noreferrer"
            >
              Play on YouTube
            </a>
          </div>
        )}
        {m.body && <p>{m.body}</p>}
        {task && (
          <Link className="lk" style={{ marginTop: 7, display: 'inline-block' }} to={`/task/${task.id}`}>
            {task.id} · {task.title}
          </Link>
        )}
        {m.promoted_to_type ? (
          <div className="msgact">
            {m.promoted_to_type === 'task' ? (
              <Link className="lk" to={`/task/${m.promoted_to_id}`}>
                → {m.promoted_to_id}
              </Link>
            ) : (
              <span className="lk">→ {m.promoted_to_type}</span>
            )}
          </div>
        ) : (
          <div className="msgact">
            <button type="button" onClick={() => onPromote(m, 'task')}>
              → task
            </button>
            <button type="button" onClick={() => onPromote(m, 'note')}>
              → note
            </button>
            <button type="button" onClick={() => onPromote(m, 'decision')}>
              → decision
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ChatColumn({
  body,
  setBody,
  attachedTaskId,
  setAttachedTaskId,
  send,
  textareaRef,
  onPromote,
}: {
  body: string;
  setBody: (v: string) => void;
  attachedTaskId: string | null;
  setAttachedTaskId: (v: string | null) => void;
  send: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onPromote: (m: Message, kind: PromoteKind) => void;
}) {
  const ds = useData((d) => d);
  const store = useStore();
  const other = useData((_, s) => s.other);
  const streamRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(
    () => [...ds.messages].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [ds.messages],
  );
  const rows = useMemo(() => groupByDay(sorted), [sorted]);

  const attachable = useMemo(
    () => [...ds.tasks].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [ds.tasks],
  );
  const attachedTask = attachedTaskId ? ds.tasks.find((t) => t.id === attachedTaskId) : undefined;

  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [sorted.length]);

  return (
    <div className="chatshell">
      <div className="chathead">
        <Avatar userId={other.id} size={30} />
        <div>
          <div className="disp" style={{ fontSize: 15 }}>You + {other.name}</div>
          <div className="presence">Just the two of you</div>
        </div>
      </div>

      <div className="stream" ref={streamRef}>
        <AnimatePresence initial={false}>
          {rows.map((r) =>
            r.kind === 'day' ? (
              <div className="dayline" key={`d-${r.date}`}>
                {r.label}
              </div>
            ) : (
              <Bubble key={r.m.id} m={r.m} mine={r.m.sender_id === store.meId} ds={ds} onPromote={onPromote} />
            ),
          )}
        </AnimatePresence>
        {rows.length === 0 && <p className="tip">Nothing here yet — say something.</p>}
      </div>

      <div className="compose">
        <div className="ctools" style={{ marginTop: 0, marginBottom: 8 }}>
          <select
            className="statuslike"
            value=""
            aria-label="Attach a task to the next message"
            onChange={(e) => {
              if (e.target.value) setAttachedTaskId(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="">+ Attach a task</option>
            {attachable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} · {t.title}
              </option>
            ))}
          </select>
          {attachedTask && (
            <span className="lk" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {attachedTask.id}
              <button
                type="button"
                aria-label="Remove attached task"
                onClick={() => setAttachedTaskId(null)}
                style={{ opacity: 0.7 }}
              >
                ×
              </button>
            </span>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={body}
          placeholder={`Message ${other.name}… attach work only when it matters.`}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="ctools">
          <SendPhotoButton />
          <SendSongButton />
          <div className="spacer" />
          <button className="btn sm solid" type="button" onClick={send}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Us() {
  const store = useStore();
  const [body, setBody] = useState('');
  const [attachedTaskId, setAttachedTaskId] = useState<string | null>(null);
  const [promote, setPromote] = useState<PromoteTarget | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    store.insert(
      'messages',
      {
        id: newId('msg'),
        sender_id: store.meId,
        body: trimmed,
        task_ref_id: attachedTaskId ?? null,
        attachment_url: null,
        song_ref: null,
        promoted_to_type: null,
        promoted_to_id: null,
        created_at: nowIso(),
      },
      store.asMe(),
    );
    setBody('');
    setAttachedTaskId(null);
  };

  const prefill = (text: string) => {
    setBody(text);
    textareaRef.current?.focus();
  };

  return (
    <div className="us-screen">
      <div className="uslay">
        <ChatColumn
          body={body}
          setBody={setBody}
          attachedTaskId={attachedTaskId}
          setAttachedTaskId={setAttachedTaskId}
          send={send}
          textareaRef={textareaRef}
          onPromote={(m, kind) => setPromote({ message: m, kind })}
        />
        <SideColumn onRitual={prefill} />
      </div>
      <PromoteModal promote={promote} onClose={() => setPromote(null)} />
    </div>
  );
}
