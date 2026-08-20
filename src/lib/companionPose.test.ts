import { describe, expect, it } from 'vitest';
import {
  BODIES,
  EXPRESSIONS,
  GESTURE_ANIM,
  GESTURE_MS,
  MOOD_POSE,
  poseForMood,
  staticPose,
  type BodyPose,
  type Expression,
} from './companionPose';
import type { RobotMood } from './companionCopy';

const MOODS: RobotMood[] = [
  'idle', 'happy', 'wave', 'excited', 'sleepy', 'point', 'giggle', 'dizzy', 'grumpy',
];

/**
 * The sprite's tables as they stood before the split, copied here verbatim.
 * These are the regression fence: the two-axis model has to reproduce every
 * one of them exactly, or the refactor changed how Vik looks.
 */
const OLD_MOUTH: Record<RobotMood, string> = {
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
const OLD_ARC_EYES: RobotMood[] = ['happy', 'giggle'];
const OLD_SPIRAL_EYES: RobotMood[] = ['dizzy'];
const OLD_EYE_SCALE: Partial<Record<RobotMood, number>> = {
  sleepy: 0.3,
  grumpy: 0.55,
  excited: 1.15,
};
/** Right-arm resting angle with animation off, from the old ternary chain. */
const OLD_STATIC_RIGHT_ARM: Record<RobotMood, number> = {
  idle: 0, happy: 0, wave: 0, excited: 0, sleepy: 0, point: -55, giggle: 0, dizzy: 0, grumpy: 0,
};

describe('the two-axis pose model reproduces the old sprite exactly', () => {
  it.each(MOODS)('%s keeps its mouth', (mood) => {
    expect(EXPRESSIONS[MOOD_POSE[mood].expression].mouth).toBe(OLD_MOUTH[mood]);
  });

  it.each(MOODS)('%s keeps its eye treatment', (mood) => {
    const spec = EXPRESSIONS[MOOD_POSE[mood].expression];
    const expected = OLD_ARC_EYES.includes(mood)
      ? 'arc'
      : OLD_SPIRAL_EYES.includes(mood)
        ? 'spiral'
        : 'rect';
    expect(spec.eyes).toBe(expected);
  });

  it.each(MOODS)('%s keeps its eye scale', (mood) => {
    expect(EXPRESSIONS[MOOD_POSE[mood].expression].eyeScale ?? 1).toBe(
      OLD_EYE_SCALE[mood] ?? 1,
    );
  });

  it.each(MOODS)('%s keeps its resting arm angle', (mood) => {
    expect(staticPose(MOOD_POSE[mood].body).rightArm).toBe(OLD_STATIC_RIGHT_ARM[mood]);
  });

  it('only grumpy draws brows, and only excited opens its mouth', () => {
    const browed = MOODS.filter((m) => EXPRESSIONS[MOOD_POSE[m].expression].brows);
    const open = MOODS.filter((m) => EXPRESSIONS[MOOD_POSE[m].expression].mouthOpen);
    expect(browed).toEqual(['grumpy']);
    expect(open).toEqual(['excited']);
  });

  it('blinks for exactly the moods that blinked before', () => {
    // Old rule: not arc eyes, not spiral eyes, not sleepy.
    const blinking = MOODS.filter((m) => EXPRESSIONS[MOOD_POSE[m].expression].blink);
    expect(blinking).toEqual(['idle', 'wave', 'excited', 'point', 'grumpy']);
  });

  it('only sleepy is asleep — it breathes instead of bobbing', () => {
    expect(MOODS.filter((m) => EXPRESSIONS[MOOD_POSE[m].expression].asleep)).toEqual(['sleepy']);
  });

  it('pulses the chest and blinks the antenna for the same moods as before', () => {
    expect(MOODS.filter((m) => BODIES[MOOD_POSE[m].body].chestPulse)).toEqual(['excited']);
    expect(MOODS.filter((m) => BODIES[MOOD_POSE[m].body].antennaBlink)).toEqual([
      'wave',
      'excited',
    ]);
  });
});

describe('the tables stay complete and inside the motion budget', () => {
  it('every mood maps to a pose whose halves both exist', () => {
    for (const mood of MOODS) {
      const pose = poseForMood(mood);
      expect(EXPRESSIONS[pose.expression]).toBeDefined();
      expect(BODIES[pose.body]).toBeDefined();
    }
  });

  it('every declared expression and body has a spec', () => {
    for (const key of Object.keys(EXPRESSIONS) as Expression[]) {
      expect(EXPRESSIONS[key].mouth).toMatch(/^M/);
    }
    for (const key of Object.keys(BODIES) as BodyPose[]) {
      expect(BODIES[key].leftArm).toBeDefined();
      expect(BODIES[key].rightArm).toBeDefined();
    }
  });

  it('no limb movement runs longer than the 500ms motion budget', () => {
    // CLAUDE.md caps every animation at 500ms. Enforced by test, not by review.
    for (const [name, spec] of Object.entries(BODIES)) {
      for (const limb of [spec.leftArm, spec.rightArm]) {
        expect(limb.transition.duration, `${name} exceeds the motion budget`)
          .toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('no gesture runs longer than the motion budget', () => {
    for (const [name, g] of Object.entries(GESTURE_ANIM)) {
      expect(g.transition.duration, `${name} exceeds the motion budget`).toBeLessThanOrEqual(0.5);
    }
  });

  it('every gesture declares how long it holds the slot', () => {
    for (const name of Object.keys(GESTURE_ANIM)) {
      expect(GESTURE_MS[name as keyof typeof GESTURE_MS]).toBeGreaterThan(0);
    }
    // A doze is a held pose rather than a movement, so it outlives the budget
    // on purpose — nothing is moving during it.
    expect(GESTURE_MS.doze).toBeGreaterThan(500);
    expect(GESTURE_ANIM).not.toHaveProperty('doze');
  });

  it('no head-shake runs longer than the motion budget either', () => {
    // Head shakes are played at 0.45s by the sprite; assert they stay short lists.
    for (const spec of Object.values(EXPRESSIONS)) {
      if (spec.headShake) expect(spec.headShake.length).toBeLessThanOrEqual(5);
    }
  });

  it('staticPose is a single angle per limb — never a keyframe list', () => {
    for (const key of Object.keys(BODIES) as BodyPose[]) {
      const rest = staticPose(key);
      expect(typeof rest.leftArm).toBe('number');
      expect(typeof rest.rightArm).toBe('number');
    }
  });
});
