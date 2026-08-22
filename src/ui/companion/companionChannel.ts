/**
 * The one realtime channel the companion owns.
 *
 * There has to be exactly one, and it has to be here rather than inside a hook,
 * for a reason that is easy to trip over: supabase-js requires every `.on()`
 * bind to be registered *before* `.subscribe()`. Presence used to be bound
 * inside useAppPresence and subscribed immediately, which left no way to add a
 * broadcast bind later without either opening a second channel (twice the
 * connections, twice the bill) or tearing the first one down mid-session.
 *
 * So the channel is a module singleton with both binds attached up front, and
 * the hooks are subscribers to it.
 *
 * Presence carries state — who is online, on which route, in which block. It is
 * throttled, heartbeated and last-write-wins. Broadcast carries events — a
 * throw, a poke — which must arrive once and never be re-delivered by the next
 * heartbeat. Mixing the two up is the single easiest way to get this wrong.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '../../lib/supabaseClient';
import { decode, type VikMessage } from '../../lib/companionLink';

export interface PresenceBlock {
  task_ref: string | null;
  scope: string;
}

export interface PresencePayload {
  user_id: string;
  at: string;
  route?: string;
  block?: PresenceBlock | null;
}

const CHANNEL = 'orra-presence';
const BROADCAST_EVENT = 'vik';
/** Enough to survive a component remount; small enough to stay free. */
const SEEN_LIMIT = 50;
/** A bug, not usage, is the risk. Nothing gets to flood the wire. */
const MAX_SENDS_PER_SEC = 4;

type PresenceHandler = (payload: PresencePayload | null) => void;
type MessageHandler = (msg: VikMessage) => void;

interface Live {
  kind: 'supabase' | 'mock';
  meId: string;
  presence: Set<PresenceHandler>;
  messages: Set<MessageHandler>;
  /** Message ids already handled — survives remount, which is the whole point. */
  seen: string[];
  sendTimes: number[];
  lastPayload: PresencePayload | null;
  track: (payload: PresencePayload) => void;
  send: (msg: VikMessage) => void;
  dispose: () => void;
}

let live: Live | null = null;

function alreadySeen(state: Live, id: string): boolean {
  if (state.seen.includes(id)) return true;
  state.seen.push(id);
  if (state.seen.length > SEEN_LIMIT) state.seen.splice(0, state.seen.length - SEEN_LIMIT);
  return false;
}

function deliver(state: Live, raw: unknown) {
  const msg = decode(raw);
  if (!msg) return;
  if (msg.from === state.meId) return;
  if (alreadySeen(state, msg.id)) return;
  state.messages.forEach((cb) => cb(msg));
}

function allowSend(state: Live): boolean {
  const now = Date.now();
  state.sendTimes = state.sendTimes.filter((t) => now - t < 1_000);
  if (state.sendTimes.length >= MAX_SENDS_PER_SEC) return false;
  state.sendTimes.push(now);
  return true;
}

function createSupabase(meId: string): Live {
  let channel: RealtimeChannel | null = null;
  let disposed = false;

  const state: Live = {
    kind: 'supabase',
    meId,
    presence: new Set(),
    messages: new Set(),
    seen: [],
    sendTimes: [],
    lastPayload: null,
    track: (payload) => {
      state.lastPayload = payload;
      void channel?.track({ ...payload });
    },
    send: (msg) => {
      if (!allowSend(state)) return;
      // A tab nobody is looking at has no business throwing anything.
      if (document.visibilityState !== 'visible') return;
      void channel?.send({ type: 'broadcast', event: BROADCAST_EVENT, payload: msg });
    },
    dispose: () => {
      disposed = true;
      if (channel) {
        void channel.untrack();
        void channel.unsubscribe();
      }
      channel = null;
    },
  };

  void getSupabase().then((supabase) => {
    if (disposed) return;
    channel = supabase.channel(CHANNEL, {
      config: { presence: { key: meId }, broadcast: { self: false } },
    });
    // Both binds BEFORE subscribe. This is the constraint the whole file exists
    // for: attaching one afterwards silently never fires.
    channel
      .on('presence', { event: 'sync' }, () => {
        const raw = channel?.presenceState() ?? {};
        const entry = Object.entries(raw)
          .filter(([key]) => key !== meId)
          .flatMap(([, rows]) => rows as unknown as PresencePayload[])
          .find((row) => row.user_id && row.user_id !== meId);
        state.presence.forEach((cb) => cb(entry ?? null));
      })
      .on('broadcast', { event: BROADCAST_EVENT }, ({ payload }) => deliver(state, payload))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && state.lastPayload) state.track(state.lastPayload);
      });
  });

  return state;
}

const MOCK_PRESENCE = 'orra:presence';
const MOCK_LINK = 'orra:vik-link';
const HEARTBEAT_MS = 15_000;
const CUTOFF_MS = 45_000;

/**
 * Same protocol over BroadcastChannel, so two tabs of the mock adapter behave
 * exactly like two people. Deliberately a separate channel from presence: game
 * messages should not have to be filtered out of every heartbeat.
 */
function createMock(meId: string): Live {
  const room = new BroadcastChannel(MOCK_PRESENCE);
  const link = new BroadcastChannel(MOCK_LINK);
  const seenPeers = new Map<string, { at: number; payload: PresencePayload }>();

  const state: Live = {
    kind: 'mock',
    meId,
    presence: new Set(),
    messages: new Set(),
    seen: [],
    sendTimes: [],
    lastPayload: null,
    track: (payload) => {
      state.lastPayload = payload;
      room.postMessage({ type: 'ping', userId: meId, at: Date.now(), payload });
    },
    send: (msg) => {
      if (!allowSend(state)) return;
      link.postMessage(msg);
    },
    dispose: () => {
      room.postMessage({ type: 'leave', userId: meId, at: Date.now() });
      window.clearInterval(heartbeat);
      room.close();
      link.close();
    },
  };

  const sync = () => {
    const cutoff = Date.now() - CUTOFF_MS;
    for (const [id, row] of seenPeers) if (row.at < cutoff) seenPeers.delete(id);
    const first = [...seenPeers.values()][0];
    state.presence.forEach((cb) => cb(first?.payload ?? null));
  };

  room.addEventListener('message', (event: MessageEvent) => {
    const m = event.data as { type: string; userId: string; at: number; payload?: PresencePayload };
    if (!m?.userId || m.userId === meId) return;
    if (m.type === 'leave' || !m.payload) seenPeers.delete(m.userId);
    else seenPeers.set(m.userId, { at: m.at || Date.now(), payload: m.payload });
    sync();
    // A newcomer announces itself; answer so it learns about us too.
    if (m.type === 'join' && state.lastPayload) state.track(state.lastPayload);
  });

  link.addEventListener('message', (event: MessageEvent) => deliver(state, event.data));

  const heartbeat = window.setInterval(() => {
    if (state.lastPayload) state.track(state.lastPayload);
    sync();
  }, HEARTBEAT_MS);

  room.postMessage({ type: 'join', userId: meId, at: Date.now(), payload: state.lastPayload });
  return state;
}

/** The channel for this user, creating it or replacing a stale one. */
function ensure(kind: 'supabase' | 'mock', meId: string): Live {
  if (live && live.kind === kind && live.meId === meId) return live;
  live?.dispose();
  live = kind === 'supabase' ? createSupabase(meId) : createMock(meId);
  return live;
}

export interface ChannelHandle {
  track(payload: PresencePayload): void;
  send(msg: VikMessage): void;
  onPresence(cb: PresenceHandler): () => void;
  onMessage(cb: MessageHandler): () => void;
}

export function companionChannel(kind: 'supabase' | 'mock', meId: string): ChannelHandle {
  const state = ensure(kind, meId);
  return {
    track: (payload) => state.track(payload),
    send: (msg) => state.send(msg),
    onPresence: (cb) => {
      state.presence.add(cb);
      return () => state.presence.delete(cb);
    },
    onMessage: (cb) => {
      state.messages.add(cb);
      return () => state.messages.delete(cb);
    },
  };
}

/** What the channel currently is — a seam for verifying it from outside. */
export function channelDebug() {
  return live
    ? {
        kind: live.kind,
        meId: live.meId,
        presenceSubscribers: live.presence.size,
        messageSubscribers: live.messages.size,
        seen: live.seen.length,
      }
    : null;
}

/** Sign-out, or a test that wants a clean slate. */
export function closeCompanionChannel() {
  live?.dispose();
  live = null;
}
