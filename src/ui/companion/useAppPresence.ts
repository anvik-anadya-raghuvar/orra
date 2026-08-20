/**
 * App-wide presence for the companion — who is online, where, and whether they
 * are in a block.
 *
 * The tracked payload carries the route and the sender's running block: that is
 * how "Raghuvar just went deep on T-123" becomes a live signal without an
 * `active_blocks` realtime publication, since presence and `messages` are the
 * only verified live paths.
 *
 * The transport moved into companionChannel.ts so the same connection can also
 * carry broadcast events. This hook is now just the throttle: re-announcing on
 * every route hop would be chatty for no gain.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useData, useStore } from '../../data/store';
import { companionChannel, type PresencePayload } from './companionChannel';

export type { PresenceBlock, PresencePayload } from './companionChannel';

export interface PresenceInfo {
  /** Is the other person's portal open anywhere right now? */
  otherOnline: boolean;
  /** What they last told the channel — route and running block. */
  otherPayload: PresencePayload | null;
}

/** Don't re-announce every route hop — a track at most this often. */
const TRACK_THROTTLE_MS = 10_000;

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

  const lastTrackAtRef = useRef(0);
  const pendingRef = useRef<number | null>(null);

  // Subscribe only. The announce below fires on its first run anyway, and
  // doing it here as well put two identical pings on the wire per change.
  useEffect(() => {
    return companionChannel(store.adapter.kind, store.meId).onPresence(setOther);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // Announce (throttled) on mount and whenever my payload meaningfully changes.
  const payloadKey = `${route}|${myBlock ? `${myBlock.scope}:${myBlock.task_ref ?? ''}` : ''}`;
  useEffect(() => {
    const channel = companionChannel(store.adapter.kind, store.meId);
    const announce = () => {
      lastTrackAtRef.current = Date.now();
      channel.track({ ...payloadRef.current });
    };
    const since = Date.now() - lastTrackAtRef.current;
    if (pendingRef.current) clearTimeout(pendingRef.current);
    if (since >= TRACK_THROTTLE_MS) announce();
    else pendingRef.current = window.setTimeout(announce, TRACK_THROTTLE_MS - since);
    return () => {
      if (pendingRef.current) clearTimeout(pendingRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey]);

  return useMemo(() => ({ otherOnline: other != null, otherPayload: other }), [other]);
}
