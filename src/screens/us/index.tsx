import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { Dataset, Message } from '../../types';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { Camera, Check, CornerUpLeft, MoreHorizontal, Music, Pencil, Send, Trash2, X } from 'lucide-react';
import { Avatar, DeleteBtn, InfoTip, Modal, useToast } from '../../ui/bits';
import { entrance } from '../../ui/motion';
import { fmtDay, fmtTime, localDay, todayIso } from '../../lib/dates';
import { useMomentSrc } from '../../lib/useMomentSrc';
import { sendPhoto, sendSong } from '../../lib/sends';
import { sendPush } from '../../lib/push';
import { isYouTubeUrl, playUrl } from '../../lib/song';
import { PromoteModal, type PromoteKind, type PromoteTarget } from './PromoteModal';
import { SideColumn } from './Sidebar';
import { MicButton } from '../../ui/dictation';
import './us.css';

type Row = { kind: 'day'; label: string; date: string } | { kind: 'msg'; m: Message };

/** Group messages (already sorted) into day separators + rows. */
function groupByDay(sorted: Message[]): Row[] {
  const out: Row[] = [];
  const today = todayIso();
  let lastDay = '';
  for (const m of sorted) {
    const day = localDay(m.created_at);
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
  const src = useMomentSrc(m.attachment_url);
  if (src === undefined) return <div className="msgphoto msgphoto-missing">Loading photo…</div>;
  if (!src) return <div className="msgphoto msgphoto-missing">Photo unavailable</div>;
  return <img className="msgphoto" src={src} alt={m.body || 'A shared moment'} loading="lazy" />;
}

function Bubble({
  m,
  mine,
  ds,
  onPromote,
  onReply,
  revealed,
}: {
  m: Message;
  mine: boolean;
  ds: Dataset;
  onPromote: (m: Message, kind: PromoteKind) => void;
  onReply: (m: Message) => void;
  /** Briefly marked because a shelf on the right sent you here. State, not a
   *  class poked onto the node: `motion.div` owns its own className and
   *  rewrites it, so a DOM-level mark disappears on the next frame. */
  revealed: boolean;
}) {
  const store = useStore();
  const toast = useToast();
  const [actionsOpen, setActionsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.body);
  const editRef = useRef<HTMLTextAreaElement>(null);
  const sender = ds.profiles.find((p) => p.id === m.sender_id);
  const task = m.task_ref_id ? ds.tasks.find((t) => t.id === m.task_ref_id) : undefined;
  const repliedTo = m.reply_to_id ? ds.messages.find((item) => item.id === m.reply_to_id) : undefined;
  const repliedSender = repliedTo ? ds.profiles.find((p) => p.id === repliedTo.sender_id) : undefined;
  // Editing rewrites `body`, which only means something for a plain chat
  // message — a photo's caption and a song's title live in their own fields,
  // and a promoted message is already someone else's record of what was said.
  const editable = mine && (m.kind ?? 'chat') === 'chat' && !m.promoted_to_type;

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const startEdit = () => {
    setDraft(m.body);
    setEditing(true);
    setActionsOpen(false);
  };

  const saveEdit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      toast("A message needs some text.");
      return;
    }
    if (trimmed !== m.body) {
      store.update(
        'messages',
        m.id,
        { body: trimmed, edited_at: nowIso() },
        store.asMe({ summary: 'Message edited' }),
      );
    }
    setEditing(false);
  };

  const deleteMessage = () => {
    store.remove('messages', m.id, store.asMe({ summary: 'Message deleted' }));
    toast('Message deleted — recoverable from Admin → Data → Trash');
  };

  return (
    <motion.div
      data-msgid={m.id}
      className={`msgrow${mine ? ' me' : ''}${revealed ? ' revealed' : ''}`}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1, transition: entrance }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.16 } }}
    >
      <Avatar userId={m.sender_id} size={26} />
      <div className="bubble">
        <div className="msgmeta">
          {sender?.name ?? 'Someone'} · {fmtTime(m.created_at)}
          {m.edited_at && <span className="msgedited"> · edited</span>}
        </div>
        {repliedTo && (
          <div className="msgreplyquote">
            <b>{repliedSender?.name ?? 'Message'}</b>
            <span>
              {repliedTo.kind === 'photo'
                ? 'Photo'
                : repliedTo.kind === 'song'
                  ? repliedTo.song_ref?.title || 'Song'
                  : repliedTo.body}
            </span>
          </div>
        )}
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
        {editing ? (
          <div className="msgedit">
            <textarea
              ref={editRef}
              className="msgeditarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === 'Escape') {
                  setEditing(false);
                }
              }}
            />
            <div className="msgeditact">
              <button type="button" className="btn sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="button" className="btn sm solid" onClick={saveEdit} disabled={!draft.trim()}>
                <Check size={13} strokeWidth={2.2} aria-hidden /> Save
              </button>
            </div>
          </div>
        ) : (
          m.body && <p>{m.body}</p>
        )}
        {task && (
          <Link className="lk" style={{ marginTop: 7, display: 'inline-block' }} to={`/task/${task.id}`}>
            {task.id} · {task.title}
          </Link>
        )}
        {m.promoted_to_type && (
          <div className="msgpromoted">
            {m.promoted_to_type === 'task' ? (
              <Link className="lk" to={`/task/${m.promoted_to_id}`}>
                Task {m.promoted_to_id}
              </Link>
            ) : (
              <span>Saved as {m.promoted_to_type === 'note' ? 'a scribble' : 'a decision'}</span>
            )}
          </div>
        )}
        {!editing && (
          <div className="msgact">
            <button
              type="button"
              aria-expanded={actionsOpen}
              aria-label="Message actions"
              onClick={() => setActionsOpen((value) => !value)}
            >
              <MoreHorizontal size={14} strokeWidth={2} aria-hidden /> Actions
            </button>
            {mine && <DeleteBtn onConfirm={deleteMessage} label="this message" />}
            {actionsOpen && (
              <div className="msgmenu">
                <button
                  type="button"
                  onClick={() => {
                    onReply(m);
                    setActionsOpen(false);
                  }}
                >
                  <CornerUpLeft size={14} strokeWidth={1.9} aria-hidden /> Reply
                </button>
                {editable && (
                  <button type="button" onClick={startEdit}>
                    <Pencil size={13} strokeWidth={1.9} aria-hidden /> Edit
                  </button>
                )}
                {!m.promoted_to_type && (
                  <>
                    <button type="button" onClick={() => onPromote(m, 'task')}>Turn into task</button>
                    <button type="button" onClick={() => onPromote(m, 'note')}>Turn into scribble</button>
                    <button type="button" onClick={() => onPromote(m, 'decision')}>Turn into decision</button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Clear the whole conversation.
 *
 * Every row still goes through `removeMany`, the same path a single delete
 * takes, so nothing here is a special "forever" delete — it lands in Trash
 * exactly like one message would, and Admin → Data restores the lot the same
 * way. The confirm is a Modal rather than the two-step arm DeleteBtn uses,
 * because "sure?" undersells wiping a whole thread; a name-the-consequence
 * dialog is the more honest shape for something this size.
 */
function ClearChatButton() {
  const store = useStore();
  const toast = useToast();
  const messages = useData((ds) => ds.messages);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = () => {
    setBusy(true);
    const n = store.removeMany(
      'messages',
      messages.map((m) => m.id),
      store.asMe({ summary: 'Conversation cleared' }),
    );
    setBusy(false);
    setOpen(false);
    toast(n ? `Cleared ${n} message${n === 1 ? '' : 's'} — recoverable from Admin → Data → Trash` : 'Already empty');
  };

  return (
    <>
      <button
        type="button"
        className="picon clearchat"
        aria-label="Clear the whole conversation"
        title="Clear chat"
        disabled={messages.length === 0}
        onClick={() => setOpen(true)}
      >
        <Trash2 size={15} strokeWidth={1.8} aria-hidden />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Clear this conversation?">
        <p className="tip" style={{ margin: '-4px 0 14px' }}>
          Every message in the Us thread — {messages.length} of them — moves to Trash. Photos and
          songs go with them. Anything already turned into a task, scribble or decision stays
          exactly where it landed. Recoverable from Admin → Data → Trash until it is emptied there.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn sm" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button" className="btn sm solid" onClick={run} disabled={busy}>
            Clear conversation
          </button>
        </div>
      </Modal>
    </>
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
  replyTo,
  setReplyTo,
  reveal,
}: {
  body: string;
  setBody: (v: string) => void;
  attachedTaskId: string | null;
  setAttachedTaskId: (v: string | null) => void;
  send: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onPromote: (m: Message, kind: PromoteKind) => void;
  replyTo: Message | null;
  setReplyTo: (m: Message | null) => void;
  /** A message the Photos/Songs shelves asked to be shown. Changes on every
   *  request, even for the same message, so asking twice works twice. */
  reveal: { id: string; nonce: number } | null;
}) {
  const ds = useData((d) => d);
  const store = useStore();
  const other = useData((_, s) => s.other);
  const streamRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const initialScrollDone = useRef(false);
  const nearBottom = useRef(true);
  const [newBelow, setNewBelow] = useState(0);
  const [flash, setFlash] = useState<string | null>(null);

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

  /* Reveal: scroll the thread to a message the right-hand shelves picked, and
     mark it for a moment so the eye can find it among its neighbours. The mark
     is a class rather than state on the row, because the row is one of
     potentially hundreds and re-rendering the lot to highlight one is waste. */
  useEffect(() => {
    if (!reveal) return;
    const el = streamRef.current?.querySelector<HTMLElement>(`[data-msgid="${reveal.id}"]`);
    if (!el) return;
    // The thread is no longer at the bottom, so a message arriving now should
    // offer the "new below" jump rather than yanking you away from this one.
    nearBottom.current = false;
    el.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
    setFlash(reveal.id);
    const t = window.setTimeout(() => setFlash(null), 1800);
    return () => window.clearTimeout(t);
  }, [reveal, reducedMotion]);

  useEffect(() => {
    const el = streamRef.current;
    if (!el) return;
    if (!initialScrollDone.current || nearBottom.current) {
      el.scrollTop = el.scrollHeight;
      initialScrollDone.current = true;
      setNewBelow(0);
    } else {
      setNewBelow((count) => count + 1);
    }
  }, [sorted.length]);

  return (
    <div className="chatshell">
      <div className="chathead">
        <Avatar userId={other.id} size={30} />
        <div>
          <div className="disp feature-label" style={{ fontSize: 15 }}>
            You + {other.name}
            <InfoTip label="Us" text="Your shared thread, status, photos, songs and small rituals. Messages stay conversations unless you deliberately turn one into work." />
          </div>
          <div className="presence">Just the two of you</div>
        </div>
        <span className="spacer" />
        <ClearChatButton />
      </div>

      <div
        className="stream"
        ref={streamRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          if (nearBottom.current) setNewBelow(0);
        }}
      >
        <AnimatePresence initial={false}>
          {rows.map((r) =>
            r.kind === 'day' ? (
              <div className="dayline" key={`d-${r.date}`}>
                {r.label}
              </div>
            ) : (
              <Bubble
                key={r.m.id}
                m={r.m}
                mine={r.m.sender_id === store.meId}
                ds={ds}
                onPromote={onPromote}
                onReply={setReplyTo}
                revealed={flash === r.m.id}
              />
            ),
          )}
        </AnimatePresence>
        {rows.length === 0 && <p className="tip">Nothing here yet — say something.</p>}
        {newBelow > 0 && (
          <button
            type="button"
            className="newbelow"
            onClick={() => {
              const el = streamRef.current;
              if (el) el.scrollTop = el.scrollHeight;
              nearBottom.current = true;
              setNewBelow(0);
            }}
          >
            {newBelow} new message{newBelow === 1 ? '' : 's'} ↓
          </button>
        )}
      </div>

      <div className="compose">
        {replyTo && (
          <div className="replybar">
            <CornerUpLeft size={14} strokeWidth={1.9} aria-hidden />
            <div>
              <b>Replying to {ds.profiles.find((p) => p.id === replyTo.sender_id)?.name ?? other.name}</b>
              <span>{replyTo.kind === 'photo' ? 'Photo' : replyTo.kind === 'song' ? replyTo.song_ref?.title : replyTo.body}</span>
            </div>
            <button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        )}
        {attachedTask && (
          <div className="attachedtask">
            <span>Attached task</span>
            <Link to={`/task/${attachedTask.id}`}>{attachedTask.id} · {attachedTask.title}</Link>
            <button type="button" aria-label="Remove attached task" onClick={() => setAttachedTaskId(null)}>
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        )}
        <div className="composemain">
          <textarea
            ref={textareaRef}
            value={body}
            placeholder={`Message ${other.name}…`}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="sendbtn" type="button" onClick={send} disabled={!body.trim()} aria-label="Send message">
            <Send size={17} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className="ctools">
          <select
            className="statuslike"
            value=""
            aria-label="Attach a task to the next message"
            onChange={(e) => {
              if (e.target.value) setAttachedTaskId(e.target.value);
              e.target.value = '';
            }}
          >
            <option value="">Attach a task</option>
            {attachable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} · {t.title}
              </option>
            ))}
          </select>
          <MicButton targetRef={textareaRef} label="Dictate this message" />
          <SendPhotoButton />
          <SendSongButton />
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
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [reveal, setReveal] = useState<{ id: string; nonce: number } | null>(null);
  const revealNonce = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messages = useData((ds) => ds.messages);

  // Opening the conversation is the read receipt. Leaving messages unread
  // while they are visibly on screen makes the bell and the relationship both
  // feel unreliable.
  useEffect(() => {
    messages
      .filter((message) => message.sender_id !== store.meId && !message.read_at)
      .forEach((message) =>
        store.update('messages', message.id, { read_at: nowIso() }, { ...store.asMe(), silent: true }),
      );
  }, [messages, store]);

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
        reply_to_id: replyTo?.id ?? null,
        kind: 'chat',
        read_at: null,
        created_at: nowIso(),
      },
      store.asMe(),
    );
    // Reach them even with the app closed — the one case the in-app bell
    // cannot cover. Fire-and-forget: a failed push must never cost a message
    // that has already been sent.
    void sendPush(store.other.id, {
      title: store.me.name,
      body: trimmed.slice(0, 140),
      url: '/us',
      tag: 'orra-message',
      kind: 'message',
    });
    setBody('');
    setAttachedTaskId(null);
    setReplyTo(null);
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
          replyTo={replyTo}
          setReplyTo={(message) => {
            setReplyTo(message);
            textareaRef.current?.focus();
          }}
          reveal={reveal}
        />
        <SideColumn
          onRitual={prefill}
          onJump={(id) => {
            revealNonce.current += 1;
            setReveal({ id, nonce: revealNonce.current });
          }}
        />
      </div>
      <PromoteModal promote={promote} onClose={() => setPromote(null)} />
    </div>
  );
}
