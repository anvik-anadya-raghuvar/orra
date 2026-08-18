import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { Dataset, Message } from '../../types';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { Avatar } from '../../ui/bits';
import { entrance } from '../../ui/motion';
import { fmtDay, fmtTime, todayIso } from '../../lib/dates';
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
        <p>{m.body}</p>
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
