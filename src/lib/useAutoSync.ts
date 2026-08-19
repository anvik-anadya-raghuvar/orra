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
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store]);
}
