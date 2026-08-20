import { useEffect, useMemo, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '../../lib/supabaseClient';
import { useData, useStore } from '../../data/store';

/** Live page presence for both mock tabs and the Supabase workspace. */
export function useWikiPresence(pageId: string) {
  const store = useStore();
  const profiles = useData((dataset) => dataset.profiles);
  const [ids, setIds] = useState<string[]>([store.meId]);

  useEffect(() => {
    let disposed = false;
    if (store.adapter.kind === 'supabase') {
      let channel: RealtimeChannel | null = null;
      void getSupabase().then((supabase) => {
        if (disposed) return;
        channel = supabase.channel(`wiki-presence:${pageId}`, { config: { presence: { key: store.meId } } });
        channel
          .on('presence', { event: 'sync' }, () => {
            const state = channel?.presenceState() ?? {};
            const present = Object.values(state)
              .flat()
              .map((entry) => String((entry as { user_id?: string }).user_id ?? ''))
              .filter(Boolean);
            if (!disposed) setIds([...new Set([store.meId, ...present])]);
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') void channel?.track({ user_id: store.meId, page_id: pageId, at: new Date().toISOString() });
          });
      });
      return () => {
        disposed = true;
        if (channel) {
          void channel.untrack();
          void channel.unsubscribe();
        }
      };
    }

    if (typeof BroadcastChannel === 'undefined') return;
    const room = new BroadcastChannel(`anvik:wiki-presence:${pageId}`);
    const seen = new Map<string, number>([[store.meId, Date.now()]]);
    const publish = (type: 'join' | 'ping' | 'leave') => room.postMessage({ type, userId: store.meId, at: Date.now() });
    const sync = () => {
      const cutoff = Date.now() - 45_000;
      for (const [id, at] of seen) if (at < cutoff) seen.delete(id);
      setIds([...seen.keys()]);
    };
    const onMessage = (event: MessageEvent<{ type: string; userId: string; at: number }>) => {
      const message = event.data;
      if (!message?.userId) return;
      if (message.type === 'leave') seen.delete(message.userId);
      else seen.set(message.userId, message.at || Date.now());
      sync();
    };
    room.addEventListener('message', onMessage);
    publish('join');
    const heartbeat = window.setInterval(() => { seen.set(store.meId, Date.now()); publish('ping'); sync(); }, 15_000);
    return () => {
      publish('leave');
      window.clearInterval(heartbeat);
      room.removeEventListener('message', onMessage);
      room.close();
    };
  }, [pageId, store]);

  return useMemo(() => ids.map((id) => profiles.find((profile) => profile.id === id)).filter(Boolean), [ids, profiles]);
}
