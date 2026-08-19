/**
 * Keeping the calendar current without anyone pressing a button.
 *
 * There is no server, so nothing can sync while the portal is closed — that
 * limitation is real and stays. What was avoidable is the calendar being stale
 * for the whole time the portal *is* open: a meeting added on your phone at
 * nine did not appear here until you happened to open Admin and press Sync.
 *
 * So: once per session on open, then at most once an hour, and only if Google
 * is already connected with a token that can be had silently. It never opens a
 * consent dialog on its own — being asked to re-authorise because a timer
 * fired is worse than a slightly stale calendar.
 */
import { useEffect, useRef } from 'react';
import type { AppStore } from '../data/store';
import { googleGrant, hasScope, syncAll, trySilentConnect } from './googleSync';
import { googleConfigured } from './google';

/** Long enough to stay out of the way, short enough that today stays true. */
export const AUTO_SYNC_MIN_GAP_MS = 60 * 60 * 1000;

export function useAutoSync(store: AppStore | null) {
  const running = useRef(false);

  useEffect(() => {
    if (!store || !googleConfigured()) return;
    if (!hasScope(store, 'calendar')) return;

    let cancelled = false;

    const maybeSync = async () => {
      if (running.current || cancelled) return;
      const grant = googleGrant(store);
      const last = grant?.last_sync_at ? Date.parse(grant.last_sync_at) : 0;
      if (Date.now() - last < AUTO_SYNC_MIN_GAP_MS) return;

      running.current = true;
      try {
        // Silent only. If Google wants consent again, leave it for the button
        // in Admin, where the person is expecting a dialog.
        if (!(await trySilentConnect(store))) return;
        if (!cancelled) await syncAll(store);
      } catch {
        // A failed background sync is not worth interrupting anyone over; the
        // Connections tab shows the real state and the manual button reports.
      } finally {
        running.current = false;
      }
    };

    void maybeSync();
    const timer = window.setInterval(maybeSync, AUTO_SYNC_MIN_GAP_MS / 4);
    // Coming back to the tab after lunch should catch up before you look.
    const onVisible = () => document.visibilityState === 'visible' && void maybeSync();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store]);
}
