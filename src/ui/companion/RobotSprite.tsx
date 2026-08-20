/**
 * The robot, drawn by hand — layered SVG groups, each animated on its own
 * origin. No sprite sheets, no Lottie: the whole figure is ~4KB of paths and
 * every mood is a different combination of eyes, brows, mouth and arm pose.
 *
 * `animate` gates every loop (reduced motion / hidden tab): when false the
 * sprite renders the mood's final expression as a static pose — the expression
 * still changes, nothing moves. Decoration over an already-correct state.
 */
import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { RobotMood } from '../../lib/companionCopy';

interface Props {
  mood: RobotMood;
  size?: number;
  animate: boolean;
  /** Friday-evening party hat. An accessory, not a mood. */
  hat?: boolean;
}

const MOUTH: Record<RobotMood, string> = {
  idle: 'M28.5,27.5 L35.5,27.5',
  happy: 'M27,26.5 Q32,30 37,26.5',
  wave: 'M27,26.5 Q32,30 37,26.5',
  excited: 'M28.5,26 Q32,31.5 35.5,26 Q32,28.5 28.5,26',
  point: 'M28,27 Q32,29 36,27',
  giggle: 'M26.5,26 Q32,31 37.5,26',
  sleepy: 'M30.5,27.5 L33.5,27.5',
  dizzy: 'M27,27.5 q2.5,2 5,0 q2.5,-2 5,0',
  grumpy: 'M27,29.5 Q32,26 37,29.5',
};

/** Eyes drawn as arcs (closed-happy) instead of the usual rectangles. */
const ARC_EYES = new Set<RobotMood>(['happy', 'giggle']);
const SPIRAL_EYES = new Set<RobotMood>(['dizzy']);

/** Vertical squish of the open-eye rectangles per mood. */
const EYE_SCALE: Partial<Record<RobotMood, number>> = {
  sleepy: 0.3,
  grumpy: 0.55,
  excited: 1.15,
};

export default function RobotSprite({ mood, size = 58, animate, hat = false }: Props) {
  const [blink, setBlink] = useState(false);
  const timers = useRef<number[]>([]);

  // Irregular blinking — a metronome reads robotic in the bad way.
  useEffect(() => {
    if (!animate || ARC_EYES.has(mood) || SPIRAL_EYES.has(mood) || mood === 'sleepy') return;
    let alive = true;
    const schedule = () => {
      const t = window.setTimeout(() => {
        if (!alive) return;
        setBlink(true);
        timers.current.push(window.setTimeout(() => alive && setBlink(false), 130));
        schedule();
      }, 3800 + Math.random() * 3200);
      timers.current.push(t);
    };
    schedule();
    return () => {
      alive = false;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setBlink(false);
    };
  }, [animate, mood]);

  const eyeScaleY = blink ? 0.08 : (EYE_SCALE[mood] ?? 1);
  const grumpy = mood === 'grumpy';
  const excitedMouth = mood === 'excited';

  const armStyle = {
    transformBox: 'fill-box',
    transformOrigin: '50% 12%',
  } as React.CSSProperties;

  const rightArmPose = animate
    ? mood === 'wave'
      ? { rotate: [0, -70, 15, -70, 0] }
      : mood === 'excited'
        ? { rotate: [0, -30, 0] }
        : mood === 'point'
          ? { rotate: -55 }
          : { rotate: 0 }
    : { rotate: mood === 'point' ? -55 : 0 };

  const rightArmT =
    mood === 'wave'
      ? { duration: 0.5, ease: 'easeInOut' as const }
      : mood === 'excited'
        ? { duration: 0.45, repeat: Infinity, repeatDelay: 1.4 }
        : { duration: 0.2 };

  return (
    <svg
      viewBox="0 0 64 74"
      width={size}
      height={(size * 74) / 64}
      aria-hidden
      className="vik-svg"
    >
      {/* ground shadow */}
      <motion.ellipse
        cx="32"
        cy="70.5"
        rx="13"
        ry="2.4"
        className="vik-shadow"
        animate={animate && mood !== 'sleepy' ? { scaleX: [1, 0.9, 1] } : undefined}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
      />

      {/* the whole figure bobs; asleep it breathes instead */}
      <motion.g
        animate={
          animate
            ? mood === 'sleepy'
              ? { scale: [1, 1.015, 1] }
              : { y: [0, -2.2, 0] }
            : undefined
        }
        transition={{ duration: mood === 'sleepy' ? 4 : 3, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}
      >
        {/* arms — behind the body */}
        <motion.rect
          x="12"
          y="39"
          width="6"
          height="13"
          rx="3"
          className="vik-limb"
          style={armStyle}
          animate={animate && mood === 'excited' ? { rotate: [0, 30, 0] } : { rotate: 0 }}
          transition={rightArmT}
        />
        <motion.rect
          x="46"
          y="39"
          width="6"
          height="13"
          rx="3"
          className="vik-limb"
          style={armStyle}
          animate={rightArmPose}
          transition={rightArmT}
        />

        {/* legs */}
        <rect x="23" y="59" width="6.5" height="8" rx="3" className="vik-limb" />
        <rect x="34.5" y="59" width="6.5" height="8" rx="3" className="vik-limb" />

        {/* body */}
        <rect x="19" y="37" width="26" height="23" rx="9" className="vik-body" />
        <motion.circle
          cx="32"
          cy="47.5"
          r="3"
          className="vik-chest"
          animate={animate && mood === 'excited' ? { opacity: [1, 0.35, 1] } : undefined}
          transition={{ duration: 0.9, repeat: Infinity }}
        />

        {/* antenna */}
        <line x1="32" y1="8" x2="32" y2="3.5" className="vik-antenna" />
        <motion.circle
          cx="32"
          cy="3"
          r="2.2"
          className="vik-tip"
          animate={
            animate && (mood === 'excited' || mood === 'wave')
              ? { opacity: [1, 0.4, 1] }
              : undefined
          }
          transition={{ duration: 0.8, repeat: Infinity }}
        />

        {/* head — its own gentle counter-bob */}
        <motion.g
          animate={
            animate && mood === 'giggle'
              ? { rotate: [0, -4, 4, -3, 0] }
              : animate && grumpy
                ? { rotate: [0, -2, 2, 0] }
                : { rotate: 0 }
          }
          transition={{ duration: 0.45 }}
          style={{ transformBox: 'fill-box', transformOrigin: '50% 90%' }}
        >
          <rect x="13" y="8" width="38" height="27" rx="11" className="vik-body" />
          {hat && (
            <g className="vik-hat">
              <polygon points="37,10.5 46,9 43.5,1.5" />
              <circle cx="43.5" cy="1.5" r="1.7" />
            </g>
          )}
          <rect x="17.5" y="12" width="29" height="19" rx="8" className="vik-face" />

          {/* eyes */}
          {ARC_EYES.has(mood) ? (
            <g className="vik-eye-arc">
              <path d="M22.5,20.5 q3.5,-4 7,0" />
              <path d="M34.5,20.5 q3.5,-4 7,0" />
            </g>
          ) : SPIRAL_EYES.has(mood) ? (
            <motion.g
              className="vik-eye-spiral"
              animate={animate ? { rotate: 360 } : undefined}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
              style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
            >
              <path d="M26,20 m-3,0 a3,3 0 1,1 6,0 a1.7,1.7 0 1,0 -3.4,0" />
              <path d="M38,20 m-3,0 a3,3 0 1,1 6,0 a1.7,1.7 0 1,0 -3.4,0" />
            </motion.g>
          ) : (
            <motion.g
              animate={{ scaleY: eyeScaleY }}
              transition={{ duration: 0.09 }}
              style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
            >
              <rect x="23.8" y="16.5" width="4.4" height="7" rx="2.2" className="vik-eye" />
              <rect x="35.8" y="16.5" width="4.4" height="7" rx="2.2" className="vik-eye" />
            </motion.g>
          )}

          {/* brows only when cross */}
          {grumpy && (
            <g className="vik-brow">
              <path d="M22,14 l8,2.6" />
              <path d="M42,14 l-8,2.6" />
            </g>
          )}

          {/* mouth */}
          <path
            d={MOUTH[mood]}
            className={excitedMouth ? 'vik-mouth-open' : 'vik-mouth'}
          />
        </motion.g>
      </motion.g>
    </svg>
  );
}
