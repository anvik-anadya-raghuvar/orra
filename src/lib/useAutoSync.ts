/** Open-tab Google refresh. Never requests or renews OAuth access itself. */
import { useEffect, useRef } from 'react';
import type { AppStore } from '../data/store';
import {
  AUTO_SYNC_MIN_GAP_MS,
  activeGoogleAccounts,
  hasLiveGoogleAccount,
  syncGoogleAccount,
} from './googleSync';
import { googleConfigured } from './google';
import { pushIfLive } from './calendarPush';

/** Quiet period after the last calendar edit before blocks go to Google, so
 *  dragging a block around sends one write, not one per frame. */
const PUSH_DEBOUNCE_MS = 5_000;

export { AUTO_SYNC_MIN_GAP_MS } from './googleSync';

export function useAutoSync(store: AppStore | null) {
  const running = useRef(false);

  useEffect(() => {
    if (!store || !googleConfigured()) return;
    let cancelled = false;

    const maybeSync = async () => {
      if (running.current || cancelled || document.visibilityState === 'hidden') return;
      const due = activeGoogleAccounts(store).filter((account) => {
        if (!hasLiveGoogleAccount(account.id)) return false;
        const last = account.last_sync_at ? Date.parse(account.last_sync_at) : 0;
        return Date.now() - last >= AUTO_SYNC_MIN_GAP_MS;
      });
      if (!due.length) return;
      running.current = true;
      try {
        for (const account of due) {
          if (cancelled) break;
          try {
            await syncGoogleAccount(store, account.id);
          } catch {
            // Account-level state records the error. Timers never interrupt the
            // user or open an OAuth popup; Connections owns recovery.
          }
        }
      } finally {
        running.current = false;
      }
    };

    void maybeSync();
    const timer = window.setInterval(maybeSync, AUTO_SYNC_MIN_GAP_MS / 3);
    const onVisible = () => void maybeSync();
    document.addEventListener('visibilitychange', onVisible);

    // A block made, moved or removed reaches Google within seconds rather than
    // at the next 15-minute sync — that gap is exactly when a booking page
    // would still offer the slot.
    let lastEvents = store.ds.day_events;
    let pushTimer: number | undefined;
    const unsubscribe = store.subscribe(() => {
      if (store.ds.day_events === lastEvents) return;
      lastEvents = store.ds.day_events;
      window.clearTimeout(pushTimer);
      pushTimer = window.setTimeout(() => {
        if (!cancelled) pushIfLive(store).catch(() => {});
      }, PUSH_DEBOUNCE_MS);
    });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(pushTimer);
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store]);
}
