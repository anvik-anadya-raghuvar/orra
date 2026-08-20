/**
 * A stretch, a head-tilt, a doze, every few minutes — and only when nothing
 * else at all is happening. The `busy` getter is read at fire time rather than
 * captured, so the interlock reflects the moment the antic would start, not
 * the moment it was scheduled three minutes earlier.
 */
import { useEffect } from 'react';
import type { Gesture } from '../../lib/companionPose';

/** Idle antics fire every 3–6 minutes. */
const ANTIC_MIN_MS = 180_000;
const ANTIC_SPREAD_MS = 180_000;

interface Options {
  /**
   * Read at fire time, not captured: the pool is whatever his current band has
   * unlocked, and a sulking robot has nothing at all to do.
   */
  antics: () => Gesture[];
  doGesture: (g: Gesture) => void;
  /** Read at fire time — true when anything else has the floor. */
  busy: () => boolean;
}

export function useIdleAntics({ antics, doGesture, busy }: Options) {
  useEffect(() => {
    let t = 0;
    let disposed = false;
    const schedule = () => {
      t = window.setTimeout(
        () => {
          if (disposed) return;
          // A background tab starves rAF; an antic there is a wasted frame.
          const pool = antics();
          if (!busy() && document.visibilityState === 'visible' && pool.length) {
            doGesture(pool[Math.floor(Math.random() * pool.length)]);
          }
          schedule();
        },
        ANTIC_MIN_MS + Math.random() * ANTIC_SPREAD_MS,
      );
    };
    schedule();
    return () => {
      disposed = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
