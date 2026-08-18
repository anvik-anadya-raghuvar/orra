import { useEffect, useState } from 'react';
import { useReducedMotion, type Transition, type Variants } from 'framer-motion';

/** Motion rules from CLAUDE.md — one vocabulary for every screen. */

export const EASE = [0.22, 1, 0.36, 1] as const;

export const spring: Transition = { type: 'spring', stiffness: 400, damping: 30 };

export const micro: Transition = { duration: 0.16, ease: EASE as unknown as number[] };
export const entrance: Transition = { duration: 0.3, ease: EASE as unknown as number[] };
export const pageT: Transition = { duration: 0.4, ease: EASE as unknown as number[] };

export const rise: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: entrance },
  exit: { opacity: 0, y: 8, transition: micro },
};

export const pageRise: Variants = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0, transition: pageT },
  exit: { opacity: 0, transition: micro },
};

/** Parent for staggered lists (30–50ms between children). */
export const staggerList: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.04 } },
};

export const staggerItem: Variants = {
  initial: { opacity: 0, y: 10, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: entrance },
};

export const lift = {
  whileHover: { y: -4, transition: micro },
  whileTap: { scale: 0.98 },
};

/**
 * Should an entrance animation run at all?
 *
 * false when the user asked for reduced motion, and ALSO false when the
 * document is hidden — a background tab throttles requestAnimationFrame to
 * nothing, so an element that animates from an empty state (a counter from 0,
 * a sparkline from pathLength 0, a ring from a full dash offset) would render
 * its *starting* state forever and simply show the wrong number.
 *
 * Callers must treat the animation as decoration over an already-correct
 * final state, never as the thing that produces it.
 */
/* Module-level mirror of "can an entrance animation actually run?".
   Kept as a plain value (not a hook) so staggerParent() below is safe to call
   from conditional JSX, where a hook would violate the rules of hooks. */
let animationsCanRun =
  typeof document === 'undefined' ||
  (document.visibilityState === 'visible' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches);

if (typeof document !== 'undefined') {
  const sync = () => {
    animationsCanRun =
      document.visibilityState === 'visible' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };
  document.addEventListener('visibilitychange', sync);
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', sync);
}

/**
 * Props for a staggered list parent.
 *
 * `initial: false` when an entrance animation cannot run — a hidden tab
 * starves requestAnimationFrame, so children that start at opacity 0 would
 * never be revealed and the page would paint blank. Passing false on the
 * parent skips the initial variant for the whole subtree, so children mount
 * directly in their final state.
 */
export function staggerParent() {
  return {
    variants: staggerList,
    initial: animationsCanRun ? ('initial' as const) : false,
    animate: 'animate' as const,
  };
}

export function useAnimateIn(): boolean {
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return !reduced && visible;
}
