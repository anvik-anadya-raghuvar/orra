/**
 * App-wide presence for the companion — a generalisation of
 * screens/knowledge/wikiPresence.ts from one page to the whole portal, kept
 * deliberately close to that file so the two stay reviewable side by side.
 *
 * The tracked payload carries the route and the sender's running block: that
 * is how "Raghuvar just went deep on T-123" becomes a live signal without an
 * `active_blocks` realtime publication — presence and `messages` are the only
 * verified live paths, and this rides the first. One channel, two clients,
 * nothing added to the Supabase free-tier bill.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '../../lib/supabaseClient';
import { useData, useStore } from '../../data/store';

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

export interface PresenceInfo {
  /** Is the other person's portal open anywhere right now? */
  otherOnline: boolean;
  /** What they last told the channel — route and running block. */
  otherPayload: PresencePayload | null;
}

/** Don't re-announce every route hop — a track at most this often. */
const TRACK_THROTTLE_MS = 10_000;
const HEARTBEAT_MS = 15_000;
const CUTOFF_MS = 45_000;

export function useAppPresence(route: string): PresenceInfo {
  const store = useStore();
  // My running block, as the payload the other side will read.
  const myBlock = useData((ds, s) => {
    const b = ds.active_blocks.find((row) => row.user_id === s.meId);
    return b ? { task_ref: b.focus_task_id, scope: b.scope } : null;
  });

  const [other, setOther] = useState<PresencePayload | null>(null);

  const payloadRef = useRef<PresencePayload>({ user_id: store.meId, at: '' });
  payloadRef.current = {
    user_id: store.meId,
    at: new Date().toISOString(),
    route,
    block: myBlock,
  };

  /** Set by whichever branch owns the transport; re-announces the payload. */
  const announceRef = useRef<(() => void) | null>(null);
  const lastTrackAtRef = useRef(0);
  const pendingTrackRef = useRef<number | null>(null);

  // Re-announce (throttled) when the interesting parts of my payload change.
  const payloadKey = `${route}|${myBlock ? `${myBlock.scope}:${myBlock.task_ref ?? ''}` : ''}`;
  useEffect(() => {
    if (!announceRef.current) return;
    const since = Date.now() - lastTrackAtRef.current;
    if (pendingTrackRef.current) clearTimeout(pendingTrackRef.current);
    if (since >= TRACK_THROTTLE_MS) {
      lastTrackAtRef.current = Date.now();
      announceRef.current();
    } else {
      pendingTrackRef.current = window.setTimeout(() => {
        lastTrackAtRef.current = Date.now();
        announceRef.current?.();
      }, TRACK_THROTTLE_MS - since);
    }
    return () => {
      if (pendingTrackRef.current) clearTimeout(pendingTrackRef.current);
    };
  }, [payloadKey]);

  useEffect(() => {
    let disposed = false;

    if (store.adapter.kind === 'supabase') {
      let channel: RealtimeChannel | null = null;
      void getSupabase().then((supabase) => {
        if (disposed) return;
        channel = supabase.channel('anvik-presence', {
          config: { presence: { key: store.meId } },
        });
        channel
          .on('presence', { event: 'sync' }, () => {
            const state = channel?.presenceState() ?? {};
            const entry = Object.entries(state)
              .filter(([key]) => key !== store.meId)
              .flatMap(([, rows]) => rows as unknown as PresencePayload[])
              .find((row) => row.user_id && row.user_id !== store.meId);
            if (!disposed) setOther(entry ?? null);
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              announceRef.current = () => void channel?.track({ ...payloadRef.current });
              lastTrackAtRef.current = Date.now();
              announceRef.current();
            }
          });
      });
      return () => {
        disposed = true;
        announceRef.current = null;
        if (channel) {
          void channel.untrack();
          void channel.unsubscribe();
        }
      };
    }

    if (typeof BroadcastChannel === 'undefined') return;
    const room = new BroadcastChannel('anvik:presence');
    const seen = new Map<string, { at: number; payload: PresencePayload }>();
    const publish = (type: 'join' | 'ping' | 'leave') =>
      room.postMessage({ type, userId: store.meId, at: Date.now(), payload: payloadRef.current });
    const sync = () => {
      const cutoff = Date.now() - CUTOFF_MS;
      for (const [id, row] of seen) if (row.at < cutoff) seen.delete(id);
      const first = [...seen.values()][0];
      setOther(first?.payload ?? null);
    };
    const onMessage = (
      event: MessageEvent<{ type: string; userId: string; at: number; payload?: PresencePayload }>,
    ) => {
      const message = event.data;
      if (!message?.userId || message.userId === store.meId) return;
      if (message.type === 'leave') seen.delete(message.userId);
      else if (message.payload)
        seen.set(message.userId, { at: message.at || Date.now(), payload: message.payload });
      else seen.delete(message.userId);
      sync();
      // A newcomer announces itself; answer so it learns about us too.
      if (message.type === 'join') publish('ping');
    };
    room.addEventListener('message', onMessage);
    announceRef.current = () => publish('ping');
    publish('join');
    const heartbeat = window.setInterval(() => {
      publish('ping');
      sync();
    }, HEARTBEAT_MS);
    return () => {
      disposed = true;
      announceRef.current = null;
      publish('leave');
      window.clearInterval(heartbeat);
      room.removeEventListener('message', onMessage);
      room.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  return useMemo(
    () => ({ otherOnline: other != null, otherPayload: other }),
    [other],
  );
}
