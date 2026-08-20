/**
 * Opt-in cursor chase. Fine pointers only, never under reduced motion, never
 * in a dense room. The robot follows with a lerp on the same motion values
 * drag uses, hanging back a little, and parks home after three seconds of
 * stillness so he does not sit on top of whatever you stopped to read.
 *
 * One rAF loop, writing to MotionValues rather than React state — a chase that
 * re-rendered the tree sixty times a second would cost more than it charms.
 */
import { useEffect, type RefObject } from 'react';
import type { MotionValue } from 'framer-motion';

/** How far behind the cursor he trails, and how close he may get to an edge. */
const TRAIL_PX = 34;
const EDGE_MARGIN = 40;
const LERP = 0.07;
const PARK_AFTER_MS = 3_000;

interface Options {
  enabled: boolean;
  boundsRef: RefObject<HTMLDivElement | null>;
  x: MotionValue<number>;
  y: MotionValue<number>;
  /** Read live — a chase must not fight a drag in progress. */
  dragging: () => boolean;
}

export function useCursorFollow({ enabled, boundsRef, x, y, dragging }: Options) {
  useEffect(() => {
    if (!enabled) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;

    let raf = 0;
    let target: { x: number; y: number } | null = null;
    let lastMove = 0;

    const onMove = (e: MouseEvent) => {
      lastMove = Date.now();
      const wrap = boundsRef.current?.querySelector('.vik-wrap');
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      // The wrap's untransformed anchor, so offsets stay stable mid-chase.
      const baseX = rect.x + rect.width / 2 - x.get();
      const baseY = rect.y + rect.height / 2 - y.get();
      target = {
        x: Math.min(
          Math.max(e.clientX + TRAIL_PX - baseX, EDGE_MARGIN - baseX),
          window.innerWidth - EDGE_MARGIN - baseX,
        ),
        y: Math.min(
          Math.max(e.clientY + TRAIL_PX - baseY, EDGE_MARGIN - baseY),
          window.innerHeight - EDGE_MARGIN - baseY,
        ),
      };
    };

    const step = () => {
      raf = requestAnimationFrame(step);
      if (dragging()) return;
      const parked = Date.now() - lastMove > PARK_AFTER_MS;
      const dest = parked || !target ? { x: 0, y: 0 } : target;
      x.set(x.get() + (dest.x - x.get()) * LERP);
      y.set(y.get() + (dest.y - y.get()) * LERP);
    };

    window.addEventListener('mousemove', onMove);
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
