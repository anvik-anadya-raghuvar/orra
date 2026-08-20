/**
 * Driving "Catch him" — one rAF loop tracking the pointer and steering him
 * away from it, in the same spirit as useCursorFollow but with the sign
 * flipped and a hard boundary instead of a park-when-idle behaviour.
 *
 * Position is written straight to two MotionValues rather than React state,
 * so a 60fps chase costs zero re-renders — the existing cursor-follow loop
 * already established this is the right way to move him continuously.
 *
 * The steering math itself (lib/companionGames/catch.ts) works in a plain
 * rectangle with one uniform margin; the real safe area has a different inset
 * top versus bottom (a header versus a tabbar), so this hook works in a
 * "virtual" space with the top inset subtracted out and adds it back only
 * when writing the rendered position. The pure function stays simple and
 * testable; only this translation is impure.
 */
import { useEffect, useRef } from 'react';
import { useMotionValue, type MotionValue } from 'framer-motion';
import { fleeStep, startPosition, type FleeBounds, type Vec } from '../../lib/companionGames/catch';
import type { Bounds } from './useVikBounds';

interface Options {
  active: boolean;
  bounds: Bounds;
  spriteW: number;
  spriteH: number;
  onTimeoutMs: number;
  onTimeout: () => void;
}

export interface Chase {
  left: MotionValue<number>;
  top: MotionValue<number>;
}

export function useVikChase({ active, bounds, spriteW, spriteH, onTimeoutMs, onTimeout }: Options): Chase {
  const left = useMotionValue(0);
  const top = useMotionValue(0);
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    if (!active) return;

    const margin = Math.max(spriteW, spriteH) / 2 + 4;
    const virtual: FleeBounds = {
      width: bounds.width,
      height: Math.max(1, bounds.height - bounds.topInset - bounds.bottomInset),
      margin,
    };

    let pos: Vec = startPosition(virtual);
    left.set(pos.x - spriteW / 2);
    top.set(pos.y + bounds.topInset - spriteH / 2);

    let pointer: Vec | null = null;
    const onMove = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY - bounds.topInset };
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    let raf = 0;
    let last = performance.now();
    const startedAt = last;
    let done = false;

    const frame = (now: number) => {
      if (done) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      pos = fleeStep(pos, pointer, virtual, dt);
      left.set(pos.x - spriteW / 2);
      top.set(pos.y + bounds.topInset - spriteH / 2);
      if (now - startedAt >= onTimeoutMs) {
        done = true;
        onTimeoutRef.current();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      done = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return { left, top };
}
