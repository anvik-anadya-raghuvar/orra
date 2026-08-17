import type { Transition, Variants } from 'framer-motion';

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
