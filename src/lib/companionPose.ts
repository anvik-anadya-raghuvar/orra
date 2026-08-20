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
 * MOOD_POSE maps every mood the engine can ask for onto the pair, so the nine
 * original moods still render exactly as they did. Everything past those nine
 * is reachable only by handing a pose directly, which is how the wardrobe and
 * the world signals dress him without inventing new vocabulary for the engine.
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
  | 'cross'
  // Added with the wardrobe: faces the world puts on him.
  | 'thinking'
  | 'proud'
  | 'shy'
  | 'yawn'
  | 'sneeze'
  | 'curious'
  | 'smug'
  | 'weary'
  | 'cheer';

/** Brows are three different shapes, not one boolean. */
export type BrowStyle = 'cross' | 'raised' | 'one';

export interface ExpressionSpec {
  /** SVG path for the mouth, in the 64x74 viewBox. */
  mouth: string;
  /** Open mouths are filled rather than stroked as a line. */
  mouthOpen?: boolean;
  eyes: 'rect' | 'arc' | 'spiral';
  /** Vertical squish of the open-eye rectangles. */
  eyeScale?: number;
  /** Nudges the whole eye group — a glance, without needing pupils. */
  eyeShift?: { x: number; y: number };
  brows?: BrowStyle;
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
    brows: 'cross',
    blink: true,
    headShake: [0, -2, 2, 0],
  },

  /** Chin-scratching. Eyes drift up and away, mouth pushed to one side. */
  thinking: {
    mouth: 'M29,28.2 q2.2,-1.6 4.6,0.2',
    eyes: 'rect',
    eyeScale: 0.85,
    eyeShift: { x: -1.4, y: -1.2 },
    brows: 'raised',
    blink: true,
  },
  /** Chest out. A closed, satisfied smile — no teeth, he is not gloating. */
  proud: {
    mouth: 'M27.5,26.6 Q32,29.8 36.5,26.6',
    eyes: 'rect',
    eyeScale: 0.9,
    blink: true,
  },
  /** Small mouth, eyes lowered. What three days of being ignored looks like. */
  shy: {
    mouth: 'M29.8,27.7 q2.2,1.1 4.4,0',
    eyes: 'rect',
    eyeScale: 0.7,
    eyeShift: { x: 0, y: 1.2 },
    blink: true,
  },
  yawn: {
    mouth: 'M29,25.6 q3,7.8 6,0 q-3,2.6 -6,0',
    mouthOpen: true,
    eyes: 'rect',
    eyeScale: 0.25,
    blink: false,
  },
  sneeze: {
    mouth: 'M28.4,25.4 q3.6,6.8 7.2,0 q-3.6,1.6 -7.2,0',
    mouthOpen: true,
    eyes: 'rect',
    eyeScale: 0.12,
    brows: 'raised',
    blink: false,
  },
  /** Wide eyes, small round mouth. The face of "what's that then". */
  curious: {
    mouth: 'M32,26.9 a1.7,2.1 0 1,0 0.01,0',
    mouthOpen: true,
    eyes: 'rect',
    eyeScale: 1.2,
    brows: 'raised',
    blink: true,
  },
  /** A one-sided smirk and a single raised brow. */
  smug: {
    mouth: 'M28.4,27.9 Q32.5,29.9 36.6,26.5',
    eyes: 'rect',
    eyeScale: 0.75,
    brows: 'one',
    blink: true,
  },
  /** Sagging. Overdue work, and he has noticed. */
  weary: {
    mouth: 'M28.4,28.6 Q32,27.1 35.6,28.6',
    eyes: 'rect',
    eyeScale: 0.5,
    eyeShift: { x: 0, y: 0.8 },
    blink: true,
  },
  /** Full open-mouthed delight, brows up. Reserved for genuinely good news. */
  cheer: {
    mouth: 'M27.8,25.8 Q32,32 36.2,25.8 Q32,28.8 27.8,25.8',
    mouthOpen: true,
    eyes: 'arc',
    brows: 'raised',
    blink: false,
  },
};

/* ── Body: everything below the face ──────────────────────────────────── */

export type BodyPose =
  | 'stand'
  | 'wave'
  | 'point'
  | 'flap'
  // Added with the wardrobe.
  | 'think'
  | 'hips'
  | 'shrug'
  | 'facepalm'
  | 'salute'
  | 'cheer'
  | 'hold';

export interface BodySpec {
  leftArm: LimbAnim;
  rightArm: LimbAnim;
  /** Chest LED pulses — a sign of effort or excitement. */
  chestPulse?: boolean;
  antennaBlink?: boolean;
}

const REST: PoseTransition = { duration: 0.2 };
const SETTLE: PoseTransition = { duration: 0.35, ease: 'easeInOut' };
const ARM_DOWN: LimbAnim = { rotate: 0, rest: 0, transition: REST };
const FLAP: PoseTransition = { duration: 0.45, repeat: Infinity, repeatDelay: 1.4 };
const SWING: PoseTransition = { duration: 0.5, ease: 'easeInOut' };

/** A limb that moves to an angle and stays there. */
const held = (deg: number, transition: PoseTransition = SETTLE): LimbAnim => ({
  rotate: deg,
  rest: deg,
  transition,
});

export const BODIES: Record<BodyPose, BodySpec> = {
  stand: { leftArm: ARM_DOWN, rightArm: ARM_DOWN },
  wave: {
    leftArm: { rotate: 0, rest: 0, transition: SWING },
    rightArm: { rotate: [0, -70, 15, -70, 0], rest: 0, transition: SWING },
    antennaBlink: true,
  },
  point: { leftArm: ARM_DOWN, rightArm: held(-55, REST) },
  flap: {
    leftArm: { rotate: [0, 30, 0], rest: 0, transition: FLAP },
    rightArm: { rotate: [0, -30, 0], rest: 0, transition: FLAP },
    chestPulse: true,
    antennaBlink: true,
  },

  /** Hand up near the chin. */
  think: { leftArm: ARM_DOWN, rightArm: held(-125), chestPulse: true },
  /** Both hands on the hips — the proud stance. */
  hips: { leftArm: held(38), rightArm: held(-38) },
  /** Arms out and slightly up: search me. */
  shrug: { leftArm: held(52), rightArm: held(-52) },
  facepalm: { leftArm: ARM_DOWN, rightArm: held(-145) },
  salute: { leftArm: ARM_DOWN, rightArm: held(-135) },
  /** Both arms overhead. */
  cheer: {
    leftArm: { rotate: [0, 150], rest: 150, transition: SETTLE },
    rightArm: { rotate: [0, -150], rest: -150, transition: SETTLE },
    antennaBlink: true,
  },
  /** One hand out in front, carrying something — an umbrella, a magnifier. */
  hold: { leftArm: ARM_DOWN, rightArm: held(-88) },
};

/* ── One-shot gestures ───────────────────────────────────────────────── */

/**
 * A whole-body movement that plays once and ends, applied to the wrapper
 * rather than inside the SVG so the most expensive motions stay on the
 * compositor. `doze` is the odd one out: it is a held expression, not a
 * movement, so it has a duration but no keyframes.
 */
export type Gesture =
  | 'stretch'
  | 'tilt'
  | 'spin'
  | 'doze'
  // Earned: the top of the friendliness meter is the only place these exist.
  | 'cartwheel'
  | 'moonwalk'
  // Everyday pottering.
  | 'dust'
  | 'pushup'
  | 'trip'
  | 'bounce';

export interface GestureAnim {
  scaleY?: number[];
  scale?: number[];
  rotate?: number[];
  x?: number[];
  y?: number[];
  transition: PoseTransition;
}

/**
 * Every one of these is a transform on the wrapper rather than anything inside
 * the SVG, so even the big ones stay on the compositor. All inside the 500ms
 * budget, which the pose test enforces rather than trusting to review.
 */
export const GESTURE_ANIM: Record<Exclude<Gesture, 'doze'>, GestureAnim> = {
  stretch: { scaleY: [1, 1.07, 0.97, 1], transition: { duration: 0.5 } },
  tilt: { rotate: [0, -7, 7, 0], transition: { duration: 0.5 } },
  spin: { rotate: [0, 360], transition: { duration: 0.5 } },
  /** Over and back, travelling as he goes. */
  cartwheel: {
    rotate: [0, -180, -360],
    x: [0, -26, 0],
    y: [0, -10, 0],
    transition: { duration: 0.5, ease: 'easeInOut' },
  },
  /** Sliding backwards while leaning the wrong way, as one does. */
  moonwalk: {
    x: [0, -14, -30, -16, 0],
    rotate: [0, 6, 8, 4, 0],
    transition: { duration: 0.5, ease: 'easeInOut' },
  },
  /** Two quick dips. */
  pushup: { y: [0, 7, 0, 7, 0], transition: { duration: 0.5 } },
  /** A brisk shake, like brushing something off. */
  dust: { rotate: [0, -5, 5, -3, 0], x: [0, 2, -2, 0], transition: { duration: 0.42 } },
  /** Stumble and recover. */
  trip: {
    rotate: [0, -18, 6, 0],
    y: [0, 5, -2, 0],
    transition: { duration: 0.48, ease: 'easeOut' },
  },
  /** The smallest one: a nudge, for reacting to something you did elsewhere. */
  bounce: { y: [0, -4, 0], transition: { duration: 0.22 } },
};

/** How long each gesture holds the slot before Vik is free again. */
export const GESTURE_MS: Record<Gesture, number> = {
  stretch: 550,
  tilt: 550,
  spin: 550,
  doze: 2_200,
  cartwheel: 560,
  moonwalk: 560,
  pushup: 560,
  dust: 470,
  trip: 530,
  bounce: 260,
};

/** The gesture rests flat — reduced motion snaps here instead of animating. */
export const GESTURE_REST = { rotate: 0, scaleY: 1, x: 0, y: 0 } as const;

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
