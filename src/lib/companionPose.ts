/**
 * What the robot looks like, split into two axes.
 *
 * `RobotMood` (companionCopy.ts) stays the moments engine's public vocabulary —
 * nothing in the pure announcement engine knows this file exists. But a mood is
 * really two independent things, and welding them together is what stops Vik
 * waving while cross, or pointing while asleep:
 *
 *   expression — mouth, eyes, brows, head-shake. What his face is doing.
 *   body       — arms, chest, antenna. What the rest of him is doing.
 *
 * MOOD_POSE maps every existing mood onto the pair, so this is a refactor and
 * not a redesign: the nine moods still render exactly as they did. Later phases
 * widen the unions rather than rewriting the mapping.
 *
 * No framer-motion import, on purpose. The animation shapes below are plain
 * structural types that happen to match what motion components accept, which
 * keeps the whole file testable without a renderer.
 */
import type { RobotMood } from './companionCopy';

/* ── Animation shapes ─────────────────────────────────────────────────── */

export interface PoseTransition {
  duration: number;
  ease?: 'easeInOut' | 'easeOut' | 'linear';
  repeat?: number;
  repeatDelay?: number;
}

export interface LimbAnim {
  /** Keyframes, or a single angle, while animation is allowed. */
  rotate: number | number[];
  /** Where the limb rests when animation is off — the pose's final state. */
  rest: number;
  transition: PoseTransition;
}

/* ── Expression: the face ─────────────────────────────────────────────── */

export type Expression =
  | 'neutral'
  | 'smile'
  | 'happy'
  | 'soft'
  | 'grin'
  | 'giggle'
  | 'sleepy'
  | 'dizzy'
  | 'cross';

export interface ExpressionSpec {
  /** SVG path for the mouth, in the 64x74 viewBox. */
  mouth: string;
  /** Open mouths are filled rather than stroked as a line. */
  mouthOpen?: boolean;
  eyes: 'rect' | 'arc' | 'spiral';
  /** Vertical squish of the open-eye rectangles. */
  eyeScale?: number;
  brows?: boolean;
  /** Irregular blinking — off for closed, spiral and sleeping eyes. */
  blink: boolean;
  /** One-shot head rotation keyframes. */
  headShake?: number[];
  /**
   * Asleep: the figure breathes instead of bobbing and the ground shadow holds
   * still. Postural, but it belongs to the face that drives it.
   */
  asleep?: boolean;
}

export const EXPRESSIONS: Record<Expression, ExpressionSpec> = {
  neutral: { mouth: 'M28.5,27.5 L35.5,27.5', eyes: 'rect', blink: true },
  smile: { mouth: 'M27,26.5 Q32,30 37,26.5', eyes: 'rect', blink: true },
  happy: { mouth: 'M27,26.5 Q32,30 37,26.5', eyes: 'arc', blink: false },
  soft: { mouth: 'M28,27 Q32,29 36,27', eyes: 'rect', blink: true },
  grin: {
    mouth: 'M28.5,26 Q32,31.5 35.5,26 Q32,28.5 28.5,26',
    mouthOpen: true,
    eyes: 'rect',
    eyeScale: 1.15,
    blink: true,
  },
  giggle: {
    mouth: 'M26.5,26 Q32,31 37.5,26',
    eyes: 'arc',
    blink: false,
    headShake: [0, -4, 4, -3, 0],
  },
  sleepy: {
    mouth: 'M30.5,27.5 L33.5,27.5',
    eyes: 'rect',
    eyeScale: 0.3,
    blink: false,
    asleep: true,
  },
  dizzy: { mouth: 'M27,27.5 q2.5,2 5,0 q2.5,-2 5,0', eyes: 'spiral', blink: false },
  cross: {
    mouth: 'M27,29.5 Q32,26 37,29.5',
    eyes: 'rect',
    eyeScale: 0.55,
    brows: true,
    blink: true,
    headShake: [0, -2, 2, 0],
  },
};

/* ── Body: everything below the face ──────────────────────────────────── */

export type BodyPose = 'stand' | 'wave' | 'point' | 'flap';

export interface BodySpec {
  leftArm: LimbAnim;
  rightArm: LimbAnim;
  /** Chest LED pulses — a sign of effort or excitement. */
  chestPulse?: boolean;
  antennaBlink?: boolean;
}

const REST: PoseTransition = { duration: 0.2 };
const ARM_DOWN: LimbAnim = { rotate: 0, rest: 0, transition: REST };
const FLAP: PoseTransition = { duration: 0.45, repeat: Infinity, repeatDelay: 1.4 };
const SWING: PoseTransition = { duration: 0.5, ease: 'easeInOut' };

export const BODIES: Record<BodyPose, BodySpec> = {
  stand: { leftArm: ARM_DOWN, rightArm: ARM_DOWN },
  wave: {
    leftArm: { rotate: 0, rest: 0, transition: SWING },
    rightArm: { rotate: [0, -70, 15, -70, 0], rest: 0, transition: SWING },
    antennaBlink: true,
  },
  point: {
    leftArm: ARM_DOWN,
    rightArm: { rotate: -55, rest: -55, transition: REST },
  },
  flap: {
    leftArm: { rotate: [0, 30, 0], rest: 0, transition: FLAP },
    rightArm: { rotate: [0, -30, 0], rest: 0, transition: FLAP },
    chestPulse: true,
    antennaBlink: true,
  },
};

/* ── One-shot gestures ───────────────────────────────────────────────── */

/**
 * A whole-body movement that plays once and ends, applied to the wrapper
 * rather than inside the SVG so the most expensive motions stay on the
 * compositor. `doze` is the odd one out: it is a held expression, not a
 * movement, so it has a duration but no keyframes.
 */
export type Gesture = 'stretch' | 'tilt' | 'spin' | 'doze';

export interface GestureAnim {
  scaleY?: number[];
  rotate?: number[];
  transition: PoseTransition;
}

export const GESTURE_ANIM: Record<Exclude<Gesture, 'doze'>, GestureAnim> = {
  stretch: { scaleY: [1, 1.07, 0.97, 1], transition: { duration: 0.5 } },
  tilt: { rotate: [0, -7, 7, 0], transition: { duration: 0.5 } },
  spin: { rotate: [0, 360], transition: { duration: 0.5 } },
};

/** How long each gesture holds the slot before Vik is free again. */
export const GESTURE_MS: Record<Gesture, number> = {
  stretch: 550,
  tilt: 550,
  spin: 550,
  doze: 2_200,
};

/** The gesture rests flat — reduced motion snaps here instead of animating. */
export const GESTURE_REST = { rotate: 0, scaleY: 1 } as const;

/* ── The pair ─────────────────────────────────────────────────────────── */

export interface VikPose {
  expression: Expression;
  body: BodyPose;
}

/**
 * The compatibility bridge. Every mood the announcement engine can ask for,
 * expressed on the two axes. `happy` and `smile` share a mouth and differ only
 * in the eyes — not an oversight: it is how `happy` and `wave` have always
 * rendered, and splitting the axes is what finally makes that legible.
 */
export const MOOD_POSE: Record<RobotMood, VikPose> = {
  idle: { expression: 'neutral', body: 'stand' },
  happy: { expression: 'happy', body: 'stand' },
  wave: { expression: 'smile', body: 'wave' },
  excited: { expression: 'grin', body: 'flap' },
  sleepy: { expression: 'sleepy', body: 'stand' },
  point: { expression: 'soft', body: 'point' },
  giggle: { expression: 'giggle', body: 'stand' },
  dizzy: { expression: 'dizzy', body: 'stand' },
  grumpy: { expression: 'cross', body: 'stand' },
};

export function poseForMood(mood: RobotMood): VikPose {
  return MOOD_POSE[mood];
}

/**
 * The pose as it renders with animation switched off: limbs at rest, no
 * keyframes anywhere. Reduced motion must land on a correct final state, never
 * on the first frame of one.
 */
export function staticPose(body: BodyPose): { leftArm: number; rightArm: number } {
  const spec = BODIES[body];
  return { leftArm: spec.leftArm.rest, rightArm: spec.rightArm.rest };
}
