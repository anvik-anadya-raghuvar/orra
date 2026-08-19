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
 *   · it does not run at all under prefers-reduced-motion.
 *
 * What decides whether the light is shown is the pointer that is actually
 * being used, not a media query. `(hover: hover) and (pointer: fine)` used to
 * gate this, and it is wrong twice over: an embedded or touch-capable desktop
 * browser reports `pointer: coarse` even with a mouse attached — which switched
 * the entire effect off on machines that have a cursor — and a hybrid laptop
 * can be either thing minute to minute. So the media query is only the opening
 * guess, and the first real pointer event corrects it: a mouse or a pen stamps
 * `data-pointer="fine"` on <html>, a finger stamps `coarse`, and the stylesheet
 * fades the light out in the coarse case. Last input wins.
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
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) return;

    const root = document.documentElement;

    // The opening guess, replaced by the first real pointer event. `any-pointer`
    // rather than `pointer`, because a laptop with a touchscreen still has a
    // cursor and should still get the light.
    root.dataset.pointer = window.matchMedia('(any-pointer: fine)').matches ? 'fine' : 'coarse';

    const paint = () => {
      frame.current = 0;
      const p = next.current;
      if (!p) return;
      root.style.setProperty('--mx', `${p.x}px`);
      root.style.setProperty('--my', `${p.y}px`);
    };

    const onMove = (e: PointerEvent) => {
      // A finger is not a light source: it covers the thing it is pointing at,
      // and the highlight would sit under it. Touch turns the light off and
      // leaves it off until a cursor shows up again.
      if (e.pointerType === 'touch') {
        root.dataset.pointer = 'coarse';
        return;
      }
      root.dataset.pointer = 'fine';
      next.current = { x: e.clientX, y: e.clientY };
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    };

    // The light should not hang in the last place the cursor was when the
    // window loses focus — it drifts back to centre instead.
    const onLeave = () => {
      next.current = { x: window.innerWidth / 2, y: window.innerHeight * 0.3 };
      if (!frame.current) frame.current = requestAnimationFrame(paint);
    };

    // A tap that never moves still tells us the input is a finger.
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') root.dataset.pointer = 'coarse';
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('blur', onLeave);
    document.addEventListener('pointerleave', onLeave);

    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return <div className="pointer-light" aria-hidden />;
}
