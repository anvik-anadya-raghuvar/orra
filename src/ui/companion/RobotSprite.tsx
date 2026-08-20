/**
 * The robot, drawn by hand — layered SVG groups, each animated on its own
 * origin. No sprite sheets, no Lottie: the whole figure is ~4KB of paths.
 *
 * Nothing here decides what he looks like. The face comes from EXPRESSIONS and
 * the limbs from BODIES (lib/companionPose.ts); this file only knows how to
 * draw a pose it is handed. Accessories hang in slots, so a hat and a scarf
 * never have to know about each other.
 *
 * `animate` gates every loop (reduced motion / hidden tab): when false the
 * sprite renders the pose's final state as a static one — the expression still
 * changes, nothing moves. Decoration over an already-correct state.
 */
import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { RobotMood } from '../../lib/companionCopy';
import { BODIES, EXPRESSIONS, poseForMood, type LimbAnim } from '../../lib/companionPose';
import type { Outfit } from '../../lib/companionWardrobe';

interface Props {
  mood: RobotMood;
  size?: number;
  animate: boolean;
  /** What he is wearing, one item per slot. */
  outfit?: Outfit;
}

const armStyle = {
  transformBox: 'fill-box',
  transformOrigin: '50% 12%',
} as React.CSSProperties;

/** A limb's animate/transition pair, collapsed to its resting state when still. */
function limbProps(limb: LimbAnim, animate: boolean) {
  return {
    animate: { rotate: animate ? limb.rotate : limb.rest },
    transition: limb.transition,
  };
}

/* ── Accessories ──────────────────────────────────────────────────────── */

function HeadAccessory({ id }: { id: string }) {
  if (id === 'party')
    return (
      <g className="vik-hat">
        <polygon points="37,10.5 46,9 43.5,1.5" />
        <circle cx="43.5" cy="1.5" r="1.7" />
      </g>
    );
  return null;
}

export default function RobotSprite({ mood, size = 58, animate, outfit = {} }: Props) {
  const pose = poseForMood(mood);
  const face = EXPRESSIONS[pose.expression];
  const body = BODIES[pose.body];

  const [blink, setBlink] = useState(false);
  const timers = useRef<number[]>([]);

  // Irregular blinking — a metronome reads robotic in the bad way.
  const blinks = animate && face.blink;
  useEffect(() => {
    if (!blinks) return;
    let alive = true;
    const schedule = () => {
      const t = window.setTimeout(
        () => {
          if (!alive) return;
          setBlink(true);
          timers.current.push(window.setTimeout(() => alive && setBlink(false), 130));
          schedule();
        },
        3800 + Math.random() * 3200,
      );
      timers.current.push(t);
    };
    schedule();
    return () => {
      alive = false;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setBlink(false);
    };
  }, [blinks, mood]);

  const eyeScaleY = blink ? 0.08 : (face.eyeScale ?? 1);

  return (
    <svg viewBox="0 0 64 74" width={size} height={(size * 74) / 64} aria-hidden className="vik-svg">
      {/* ground shadow */}
      <motion.ellipse
        cx="32"
        cy="70.5"
        rx="13"
        ry="2.4"
        className="vik-shadow"
        animate={animate && !face.asleep ? { scaleX: [1, 0.9, 1] } : undefined}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformBox: 'fill-box', transformOrigin: '50% 50%' }}
      />

      {/* the whole figure bobs; asleep it breathes instead */}
      <motion.g
        animate={
          animate ? (face.asleep ? { scale: [1, 1.015, 1] } : { y: [0, -2.2, 0] }) : undefined
        }
        transition={{ duration: face.asleep ? 4 : 3, repeat: Infinity, ease: 'easeInOut' }}
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
          {...limbProps(body.leftArm, animate)}
        />
        <motion.rect
          x="46"
          y="39"
          width="6"
          height="13"
          rx="3"
          className="vik-limb"
          style={armStyle}
          {...limbProps(body.rightArm, animate)}
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
          animate={animate && body.chestPulse ? { opacity: [1, 0.35, 1] } : undefined}
          transition={{ duration: 0.9, repeat: Infinity }}
        />

        {/* antenna */}
        <line x1="32" y1="8" x2="32" y2="3.5" className="vik-antenna" />
        <motion.circle
          cx="32"
          cy="3"
          r="2.2"
          className="vik-tip"
          animate={animate && body.antennaBlink ? { opacity: [1, 0.4, 1] } : undefined}
          transition={{ duration: 0.8, repeat: Infinity }}
        />

        {/* head — its own gentle counter-bob */}
        <motion.g
          animate={animate && face.headShake ? { rotate: face.headShake } : { rotate: 0 }}
          transition={{ duration: 0.45 }}
          style={{ transformBox: 'fill-box', transformOrigin: '50% 90%' }}
        >
          <rect x="13" y="8" width="38" height="27" rx="11" className="vik-body" />
          {outfit.head && <HeadAccessory id={outfit.head} />}
          <rect x="17.5" y="12" width="29" height="19" rx="8" className="vik-face" />

          {/* eyes */}
          {face.eyes === 'arc' ? (
            <g className="vik-eye-arc">
              <path d="M22.5,20.5 q3.5,-4 7,0" />
              <path d="M34.5,20.5 q3.5,-4 7,0" />
            </g>
          ) : face.eyes === 'spiral' ? (
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
          {face.brows && (
            <g className="vik-brow">
              <path d="M22,14 l8,2.6" />
              <path d="M42,14 l-8,2.6" />
            </g>
          )}

          {/* mouth */}
          <path d={face.mouth} className={face.mouthOpen ? 'vik-mouth-open' : 'vik-mouth'} />
        </motion.g>
      </motion.g>
    </svg>
  );
}
