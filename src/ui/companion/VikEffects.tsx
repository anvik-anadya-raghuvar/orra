/**
 * The things that fly off him — drifting z's while he naps, a confetti burst
 * when a task lands, hearts while he is petted.
 *
 * All three are decoration over a state that is already correct without them,
 * so every one is gated on `animate` at the call site and simply does not
 * render under reduced motion. Particle counts are fixed and small: twelve
 * confetti, three hearts, one z. A burst, not a library.
 */
import { AnimatePresence, motion } from 'framer-motion';
import type { Celebration } from './useCelebrations';

/** Confetti vectors, precomputed and deterministic. Angles fan the full circle
 *  with an upward bias; distances vary by index so the burst is not a ring. */
const CONFETTI = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  const d = 46 + (i % 4) * 9;
  return {
    x: Math.round(Math.cos(a) * d),
    y: Math.round(Math.sin(a) * d - 34),
    r: 140 + i * 22,
  };
});

export function Zzz() {
  return (
    <motion.span
      className="vik-float zz"
      aria-hidden
      initial={{ opacity: 0, y: 0 }}
      animate={{ opacity: [0, 0.9, 0], y: -26 }}
      transition={{ duration: 2.8, repeat: Infinity }}
    >
      z
    </motion.span>
  );
}

export function Confetti({ celebration }: { celebration: Celebration }) {
  // Clearing every intention of the day throws it wider.
  const scale = celebration.big ? 1.5 : 1;
  return (
    <span aria-hidden key={celebration.key}>
      {CONFETTI.map((c, i) => (
        <motion.span
          key={i}
          className={`vik-cf c${i % 5}`}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: c.x * scale, y: c.y * scale, opacity: 0, rotate: c.r }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
      ))}
    </span>
  );
}

export function Hearts({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <span aria-hidden>
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="vik-float"
              initial={{ opacity: 0, y: 0, x: (i - 1) * 12 }}
              animate={{ opacity: [0, 1, 0], y: -28 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.1, delay: i * 0.22, repeat: Infinity }}
            >
              ♥
            </motion.span>
          ))}
        </span>
      )}
    </AnimatePresence>
  );
}
