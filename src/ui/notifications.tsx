import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Bell, Check, CornerUpLeft, X } from 'lucide-react';
import { newId, nowIso, useData, useStore } from '../data/store';
import type { Message } from '../types';
import { Avatar } from './bits';
import { entrance, micro, spring } from './motion';
import { fmtTime } from '../lib/dates';

/**
 * Message notifications for the two-person thread.
 *
 * A message from the other person pops a card the moment it lands (Supabase
 * realtime in production, BroadcastChannel across tabs in local mock mode),
 * with reply-in-place and mark-as-read. Anything that arrived while you were
 * away is waiting in the bell, so nothing is missed just because the popup
 * was never seen.
 */

interface NotifCtx {
  unread: Message[];
  markRead: (id: string) => void;
  markAllRead: () => void;
  openPanel: () => void;
}
const Ctx = createContext<NotifCtx>({
  unread: [],
  markRead: () => {},
  markAllRead: () => {},
  openPanel: () => {},
});
export const useNotifications = () => useContext(Ctx);

/** Ask once, only after the user has shown intent by enabling it. */
function useDesktopNotifications() {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const request = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setPermission(p);
  }, []);
  const notify = useCallback(
    (title: string, body: string) => {
      if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
      // Only when the tab isn't in front — otherwise the in-app card is enough.
      if (document.visibilityState === 'visible') return;
      try {
        new Notification(title, { body, tag: 'anvik-message' });
      } catch {
        /* some browsers block construction outside a service worker */
      }
    },
    [],
  );
  return { permission, request, notify };
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const store = useStore();
  const messages = useData((ds) => ds.messages);
  const me = useData((_, s) => s.me);
  const other = useData((_, s) => s.other);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(sessionStorage.getItem('anvik:dismissed-notifications') ?? '[]'));
    } catch {
      return new Set();
    }
  });
  const [popupId, setPopupId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const { permission, request, notify } = useDesktopNotifications();
  const seen = useRef<Set<string>>(new Set());
  const ready = useRef(false);

  const unread = useMemo(
    () =>
      messages
        .filter((m) => m.sender_id !== me.id && !m.read_at)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [messages, me.id],
  );

  // Only a message that arrives while this session is open drives the popup.
  // Older unread belongs in the bell; replaying it on every reload is what
  // made the app open with a third of the phone covered by stale chat.
  const popup = popupId && !dismissed.has(popupId)
    ? unread.find((message) => message.id === popupId) ?? null
    : null;

  /** A photo or song carries no text of its own, so say what arrived. */
  const notificationBody = useCallback((m: Message): string => {
    if (m.kind === 'photo') return m.body ? `Sent a photo — ${m.body}` : 'Sent you a photo';
    if (m.kind === 'song') return `Suggested a song — ${m.song_ref?.title ?? ''}`.trim();
    return m.body.slice(0, 120);
  }, []);

  // Establish a quiet baseline on mount, then alert only for genuinely new
  // arrivals. This effect owns both the in-app and desktop alert so they can
  // never disagree about what counts as "new".
  useEffect(() => {
    if (!ready.current) {
      unread.forEach((message) => seen.current.add(message.id));
      ready.current = true;
      return;
    }
    const fresh = unread.filter((message) => !seen.current.has(message.id));
    for (const m of fresh) {
      seen.current.add(m.id);
      notify(`${other.name} · Anvik Ops`, notificationBody(m));
    }
    const latest = fresh.filter((message) => !dismissed.has(message.id)).slice(-1)[0];
    if (latest) setPopupId(latest.id);
  }, [unread, other.name, notify, notificationBody, dismissed]);

  const dismissPopup = (id: string) => {
    setDismissed((current) => {
      const next = new Set(current).add(id);
      try {
        sessionStorage.setItem('anvik:dismissed-notifications', JSON.stringify([...next]));
      } catch {}
      return next;
    });
    setPopupId(null);
  };

  const markRead = useCallback(
    (id: string) => {
      store.update('messages', id, { read_at: nowIso() }, { ...store.asMe(), silent: true });
    },
    [store],
  );
  const markAllRead = useCallback(() => {
    unread.forEach((m) =>
      store.update('messages', m.id, { read_at: nowIso() }, { ...store.asMe(), silent: true }),
    );
  }, [unread, store]);

  const sendReply = (parent: Message) => {
    const body = replyText.trim();
    if (!body) return;
    store.insert(
      'messages',
      {
        id: newId('msg'),
        sender_id: store.meId,
        body,
        task_ref_id: parent.task_ref_id,
        attachment_url: null,
        song_ref: null,
        promoted_to_type: null,
        promoted_to_id: null,
        reply_to_id: parent.id,
        kind: 'chat',
        read_at: null,
        created_at: nowIso(),
      },
      store.asMe({ summary: 'Replied from a notification' }),
    );
    markRead(parent.id);
    setReplyText('');
    setReplyTo(null);
  };

  const value = useMemo(
    () => ({ unread, markRead, markAllRead, openPanel: () => setPanelOpen(true) }),
    [unread, markRead, markAllRead],
  );

  return (
    <Ctx.Provider value={value}>
      {children}

      {/* ── the pop-up card ───────────────────────────────────────────── */}
      <AnimatePresence>
        {popup && (
          <motion.div
            className="notif-pop"
            role="alert"
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: spring }}
            exit={{ opacity: 0, y: -10, scale: 0.98, transition: micro }}
          >
            <div className="notif-head">
              <Avatar userId={popup.sender_id} size={28} />
              <div className="notif-who">
                <b>{other.name}</b>
                <span className="mono">{fmtTime(popup.created_at)}</span>
              </div>
              <button
                type="button"
                className="notif-x"
                aria-label="Dismiss"
                onClick={() => dismissPopup(popup.id)}
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>
            <p className="notif-body">{notificationBody(popup)}</p>
            {popup.task_ref_id && (
              <Link className="lk" to={`/task/${popup.task_ref_id}`}>
                {popup.task_ref_id}
              </Link>
            )}
            {replyTo === popup.id ? (
              <div className="notif-reply">
                <textarea
                  autoFocus
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Reply to ${other.name}…`}
                  aria-label="Reply"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendReply(popup);
                    }
                    if (e.key === 'Escape') setReplyTo(null);
                  }}
                />
                <button type="button" className="btn sm solid" onClick={() => sendReply(popup)}>
                  Send
                </button>
              </div>
            ) : (
              <div className="notif-acts">
                <button type="button" className="btn sm" onClick={() => setReplyTo(popup.id)}>
                  <CornerUpLeft size={14} strokeWidth={1.9} /> Reply
                </button>
                <button type="button" className="btn sm" onClick={() => markRead(popup.id)}>
                  <Check size={14} strokeWidth={1.9} /> Mark read
                </button>
                <Link className="btn sm" to="/us" onClick={() => markRead(popup.id)}>
                  Open thread
                </Link>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── the panel behind the bell ─────────────────────────────────── */}
      <AnimatePresence>
        {panelOpen && (
          <motion.div
            className="notif-mask"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPanelOpen(false)}
          >
            <motion.div
              className="notif-panel"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0, transition: entrance }}
              exit={{ opacity: 0, y: -6, transition: micro }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="notif-panel-hd">
                <span className="eyebrow">Notifications</span>
                <div className="spacer" />
                {unread.length > 0 && (
                  <button type="button" className="btn sm" onClick={markAllRead}>
                    Mark all read
                  </button>
                )}
              </div>
              {unread.length === 0 ? (
                <p className="tip" style={{ margin: 0 }}>
                  Nothing waiting. {other.name} hasn't sent anything unread.
                </p>
              ) : (
                unread
                  .slice()
                  .reverse()
                  .map((m) => (
                    <div className="notif-row" key={m.id}>
                      <Avatar userId={m.sender_id} size={24} />
                      <div className="notif-rowbody">
                        <p>{m.body}</p>
                        <span className="mono">{fmtTime(m.created_at)}</span>
                      </div>
                      <button
                        type="button"
                        className="btn sm"
                        aria-label="Mark read"
                        onClick={() => markRead(m.id)}
                      >
                        <Check size={14} strokeWidth={1.9} />
                      </button>
                    </div>
                  ))
              )}
              {permission === 'default' && (
                <button type="button" className="btn sm" style={{ marginTop: 10 }} onClick={request}>
                  Also notify me when I'm away
                </button>
              )}
              {permission === 'denied' && (
                <p className="tip" style={{ marginTop: 10 }}>
                  Desktop notifications are blocked in your browser settings, so alerts only show
                  while this tab is open.
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}

/** The header bell + unread count. */
export function NotificationBell() {
  const { unread, openPanel } = useNotifications();
  return (
    <button
      className="chip notif-bell"
      onClick={openPanel}
      aria-label={unread.length ? `${unread.length} unread messages` : 'Notifications'}
    >
      <Bell size={15} strokeWidth={1.9} />
      {unread.length > 0 && <span className="notif-dot">{unread.length}</span>}
    </button>
  );
}
