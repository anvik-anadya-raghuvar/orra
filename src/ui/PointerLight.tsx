/**
 * The light source.
 *
 * Deep Field gives the portal somewhere dark to push against; this gives the
 * light somewhere to come from. A soft sheen follows the pointer across the
 * whole app, so a surface brightens as you approach it instead of sitting at
 * one fixed brightness for ever — which is the difference between a page that
 * looks alive in a screenshot and one that feels alive to use.
 *
 * Cost control, because this listens to every pointer move:
 *   · positions are written on a requestAnimationFrame tick, never per event,
 *     so a 1000Hz mouse still costs one write per frame;
 *   · it writes two CSS custom properties and nothing else — no React state,
 *     so moving the mouse never re-renders a single component;
 *   · it does not mount at all without a fine pointer (no hover to track on a
 *     phone) or under prefers-reduced-motion.
 */
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/** Rooms that are mostly tables and trails. A highlight drifting behind a
 *  column of numbers is noise rather than life, so the light turns down. */
const DENSE = ['/money', '/admin', '/people'];

export default function PointerLight() {
  const frame = useRef(0);
  const next = useRef<{ x: number; y: number } | null>(null);
  const { pathname } = useLocation();

  // Stamped on <html>, not on the room: the light is a fixed sibling of the
  // app, so it cannot inherit a variable set inside the screen it covers.
  useEffect(() => {
    const dense = DENSE.some((p) => pathname.startsWith(p));
    document.documentElement.dataset.dense = dense ? '1' : '0';
  }, [pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || still) return;

    const root = document.documentElement;

    const paint = () => {
      frame.current = 0;
      const p = next.current;
      if (!p) return;
      root.style.setProperty('--mx', `${p.x}px`);
      root.style.setProperty('--my', `${p.y}px`);
    };

    const onMove = (e: PointerEvent) => {
      next.current = { x: e.clientX, y: e.clientY };
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    };

    // The light should not hang in the last place the cursor was when the
    // window loses focus — it drifts back to centre instead.
    const onLeave = () => {
      next.current = { x: window.innerWidth / 2, y: window.innerHeight * 0.3 };
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', onLeave);
    document.addEventListener('pointerleave', onLeave);

    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return <div className="pointer-light" aria-hidden />;
}
