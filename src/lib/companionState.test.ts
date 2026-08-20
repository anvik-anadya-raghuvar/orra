import { describe, expect, it } from 'vitest';
import { claimsFor, isBusy, isSleeping, pickClaim, poseFor, PRIORITY, type VikInputs } from './companionState';
import type { RobotMood } from './companionCopy';
import { poseForMood, type VikPose } from './companionPose';

const BASE: VikInputs = {
  playMood: null,
  petting: false,
  dragging: false,
  celebrating: false,
  dozing: false,
  momentMood: null,
  worldPose: null,
  speaking: false,
  quiet: false,
  dense: false,
};

const at = (over: Partial<VikInputs>): VikInputs => ({ ...BASE, ...over });

/** The old chain spoke in moods; the ladder speaks in poses. Bridge for tests. */
const moodFor = (i: VikInputs): RobotMood | VikPose => {
  const pose = poseFor(i);
  const match = (['idle','happy','wave','excited','sleepy','point','giggle','dizzy','grumpy'] as RobotMood[])
    .find((m) => {
      const p = poseForMood(m);
      return p.expression === pose.expression && p.body === pose.body;
    });
  return match ?? pose;
};

/**
 * The precedence chain exactly as it read inside Companion.tsx before the
 * arbiter existed. The sweep below asserts the new ladder agrees with it on
 * every reachable combination, with one deliberate exception called out by its
 * own test.
 */
function oldChain(i: VikInputs): RobotMood {
  return (
    i.playMood ??
    (i.dozing
      ? 'sleepy'
      : i.celebrating
        ? 'excited'
        : i.petting
          ? 'happy'
          : i.dragging
            ? 'excited'
            : (i.momentMood ?? (i.quiet ? 'sleepy' : 'idle')))
  );
}

describe('the ladder', () => {
  it('ranks an explicit reaction above the news, and passive contact below it', () => {
    expect(PRIORITY.play).toBeGreaterThan(PRIORITY.celebration);
    expect(PRIORITY.celebration).toBeGreaterThan(PRIORITY.touch);
    expect(PRIORITY.touch).toBeGreaterThan(PRIORITY.moment);
    expect(PRIORITY.moment).toBeGreaterThan(PRIORITY.antic);
    expect(PRIORITY.antic).toBeGreaterThan(PRIORITY.idle);
  });

  it('always yields a claim — idle never stands down', () => {
    expect(pickClaim(BASE)).toEqual({ kind: 'idle', pose: poseForMood('idle') });
    expect(claimsFor(BASE)).toHaveLength(1);
  });

  it('a poke result outranks everything below it', () => {
    const i = at({
      playMood: 'dizzy',
      celebrating: true,
      petting: true,
      momentMood: 'wave',
      dozing: true,
    });
    expect(pickClaim(i).kind).toBe('play');
    expect(moodFor(i)).toBe('dizzy');
  });

  it('petting and dragging are one claim, and petting wins the overlap', () => {
    expect(moodFor(at({ petting: true, dragging: true }))).toBe('happy');
    expect(moodFor(at({ dragging: true }))).toBe('excited');
  });

  it('resting a finger on him does not outrank a task landing', () => {
    expect(moodFor(at({ petting: true, celebrating: true }))).toBe('excited');
  });

  it('an announcement outranks an idle antic', () => {
    expect(moodFor(at({ momentMood: 'point', dozing: true }))).toBe('point');
  });

  it('falls asleep rather than idle during quiet hours', () => {
    expect(moodFor(at({ quiet: true }))).toBe('sleepy');
    expect(moodFor(at({ quiet: true, momentMood: 'wave' }))).toBe('wave');
  });

  it('resolves to a renderable pose, not just a mood', () => {
    expect(poseFor(at({ playMood: 'wave' }))).toEqual({ expression: 'smile', body: 'wave' });
  });

  it('lets the world dress him in a face the engine has no word for', () => {
    const worldPose: VikPose = { expression: 'proud', body: 'hips' };
    expect(poseFor(at({ worldPose }))).toEqual(worldPose);
    // ...but anything with an opinion outranks it.
    expect(poseFor(at({ worldPose, momentMood: 'point' }))).toEqual(poseForMood('point'));
    expect(poseFor(at({ worldPose, dozing: true }))).toEqual(poseForMood('sleepy'));
  });

  it('never lets the world wake him — rain at 3am is still 3am', () => {
    const worldPose: VikPose = { expression: 'proud', body: 'hips' };
    expect(poseFor(at({ worldPose, quiet: true }))).toEqual(poseForMood('sleepy'));
  });
});

describe('agreement with the pre-arbiter chain', () => {
  // Every reachable combination of the boolean inputs, across a few moods.
  const MOODS: (RobotMood | null)[] = [null, 'wave', 'point', 'grumpy'];
  const bools = [false, true];
  const combos: VikInputs[] = [];
  for (const playMood of MOODS)
    for (const petting of bools)
      for (const dragging of bools)
        for (const celebrating of bools)
          for (const dozing of bools)
            for (const momentMood of MOODS)
              for (const quiet of bools)
                combos.push(at({ playMood, petting, dragging, celebrating, dozing, momentMood, quiet }));

  it('matches the old chain everywhere a doze is not running', () => {
    const divergent = combos.filter((i) => moodFor(i) !== oldChain(i));
    for (const i of divergent) {
      // Every disagreement has the same shape: an idle doze was outranking a
      // real event. Nothing else moved.
      expect(i.playMood).toBeNull();
      expect(i.dozing).toBe(true);
      expect(i.celebrating || i.petting || i.dragging || i.momentMood != null).toBe(true);
    }
    expect(combos.length).toBeGreaterThan(500);
    expect(combos.filter((i) => !i.dozing).every((i) => moodFor(i) === oldChain(i))).toBe(true);
  });

  /**
   * The one behaviour change in the decomposition, and the reason the ladder
   * is worth having. A doze is a 2.2-second idle gesture that nobody asked
   * for; it used to sit second from the top and swallow whatever arrived
   * while it ran. Confetti would fire over a sleeping face; a bubble would
   * appear while he talked in his sleep.
   */
  describe('a doze no longer swallows what happens during it', () => {
    it.each([
      ['a task landing', { celebrating: true }, 'excited'],
      ['being petted', { petting: true }, 'happy'],
      ['being picked up', { dragging: true }, 'excited'],
      ['something to say', { momentMood: 'point' as RobotMood }, 'point'],
    ])('%s wakes his face', (_label, over, expected) => {
      const i = at({ dozing: true, ...over });
      expect(oldChain(i)).toBe('sleepy');
      expect(moodFor(i)).toBe(expected);
    });

    it('still dozes when nothing else is going on', () => {
      expect(moodFor(at({ dozing: true }))).toBe('sleepy');
    });
  });
});

describe('the busy interlock', () => {
  it('is quiet when nothing is happening', () => {
    expect(isBusy(BASE)).toBe(false);
  });

  it.each([
    ['speaking', { speaking: true }],
    ['reacting', { playMood: 'giggle' as RobotMood }],
    ['being petted', { petting: true }],
    ['being dragged', { dragging: true }],
    ['celebrating', { celebrating: true }],
    ['asleep', { quiet: true }],
    ['in a dense room', { dense: true }],
  ])('counts %s as busy', (_label, over) => {
    expect(isBusy(at(over))).toBe(true);
  });

  it('does not count a running antic as busy — that is what schedules the next one', () => {
    expect(isBusy(at({ dozing: true }))).toBe(false);
  });
});

describe('sleeping', () => {
  it('naps only during quiet hours, and never mid-sentence', () => {
    expect(isSleeping(at({ quiet: true }))).toBe(true);
    expect(isSleeping(at({ quiet: true, speaking: true }))).toBe(false);
    expect(isSleeping(at({ quiet: true, momentMood: 'wave' }))).toBe(false);
    expect(isSleeping(BASE)).toBe(false);
  });
});
