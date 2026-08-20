/**
 * The robot, drawn by hand — layered SVG groups, each animated on its own
 * origin. No sprite sheets, no Lottie: the whole figure is ~4KB of paths.
 *
 * Nothing here decides what he looks like. The face comes from EXPRESSIONS and
 * the limbs from BODIES (lib/companionPose.ts); this file only knows how to
 * draw a pose it is handed. Accessories hang in slots, interleaved with the
 * body in SLOT_ORDER, so a hat and a scarf never have to know about each other.
 *
 * `animate` gates every loop (reduced motion / hidden tab): when false the
 * sprite renders the pose's final state as a static one — the expression still
 * changes, nothing moves. Decoration over an already-correct state.
 */
import { motion } from 'framer-motion';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { BODIES, EXPRESSIONS, type LimbAnim, type VikPose } from '../../lib/companionPose';
import type { Outfit, Slot } from '../../lib/companionWardrobe';

// Ten accessories he mostly is not wearing — not worth a byte on first paint.
const Accessory = lazy(() => import('./Accessories'));

interface Props {
  pose: VikPose;
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

/** Brows, three shapes: angled in is cross, out is surprise, one is a smirk. */
const BROWS: Record<string, string[]> = {
  cross: ['M22,14 l8,2.6', 'M42,14 l-8,2.6'],
  raised: ['M22,14.6 l8,-1.8', 'M42,14.6 l-8,-1.8'],
  one: ['M22,13.6 l8,1.4', 'M42,12.4 l-8,-0.6'],
};

function Wear({ outfit, slot }: { outfit: Outfit; slot: Slot }) {
  const id = outfit[slot];
  if (!id) return null;
  // A missing accessory for one frame is invisible; a blocked first paint is not.
  return (
    <Suspense fallback={null}>
      <Accessory id={id} />
    </Suspense>
  );
}

export default function RobotSprite({ pose, size = 58, animate, outfit = {} }: Props) {
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
  }, [blinks, pose.expression]);

  const eyeScaleY = blink ? 0.08 : (face.eyeScale ?? 1);
  const shift = face.eyeShift;

  return (
    <svg
      viewBox="0 0 64 74"
      width={size}
      height={(size * 74) / 64}
      aria-hidden
      className="vik-svg"
      // Which pose actually won the arbiter, for anything checking from outside.
      data-expression={pose.expression}
      data-body={pose.body}
    >
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
      <Wear outfit={outfit} slot="ground" />

      {/* the whole figure bobs; asleep it breathes instead */}
      <motion.g
        animate={
          animate ? (face.asleep ? { scale: [1, 1.015, 1] } : { y: [0, -2.2, 0] }) : undefined
        }
        transition={{ duration: face.asleep ? 4 : 3, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformBox: 'fill-box', transformOrigin: '50% 100%' }}
      >
        <Wear outfit={outfit} slot="behind" />

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
        <Wear outfit={outfit} slot="neck" />

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
          <Wear outfit={outfit} slot="head" />
          <rect x="17.5" y="12" width="29" height="19" rx="8" className="vik-face" />

          {/* eyes — the group shifts bodily for a glance, no pupils needed */}
          <g transform={shift ? `translate(${shift.x} ${shift.y})` : undefined}>
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
          </g>

          {face.brows && (
            <g className="vik-brow">
              {BROWS[face.brows].map((d) => (
                <path key={d} d={d} />
              ))}
            </g>
          )}

          {/* mouth */}
          <path d={face.mouth} className={face.mouthOpen ? 'vik-mouth-open' : 'vik-mouth'} />

          {/* worn over the face — sunglasses sit on top of the eyes */}
          <Wear outfit={outfit} slot="face" />
        </motion.g>

        <Wear outfit={outfit} slot="hand" />
      </motion.g>

      <Wear outfit={outfit} slot="overhead" />
    </svg>
  );
}
