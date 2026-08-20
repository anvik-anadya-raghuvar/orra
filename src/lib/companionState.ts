/**
 * Who gets to decide what Vik looks like right now.
 *
 * Until this file existed the answer was a nine-deep `??` chain inside the
 * component and a single `busyRef` boolean. That worked while four things
 * competed. It does not survive games, two-player arrivals, house transitions
 * and app reactions all wanting the same face at once, so precedence moves
 * here, becomes data, and gets tested.
 *
 * The ladder, highest first:
 *
 *   play        an explicit reaction you just caused — a poke result, a fling
 *   celebration a task crossing into done
 *   touch       a passive contact state — mid-pet, mid-drag
 *   moment      an announcement from the pure engine
 *   antic       an idle gesture nobody asked for
 *   idle        the resting face
 *
 * `play` outranking `celebration` while `touch` sits below it is deliberate:
 * something you just did to him beats the news, but merely resting a finger on
 * him does not.
 */
import type { RobotMood } from './companionCopy';
import { poseForMood, type VikPose } from './companionPose';

export type ActivityKind = 'play' | 'celebration' | 'touch' | 'moment' | 'antic' | 'idle';

export const PRIORITY: Record<ActivityKind, number> = {
  play: 80,
  celebration: 60,
  touch: 50,
  moment: 40,
  antic: 20,
  idle: 10,
};

export interface Claim {
  kind: ActivityKind;
  mood: RobotMood;
}

export interface VikInputs {
  /** A timed reaction to touch — the poke ladder's result, a fling's dizziness. */
  playMood: RobotMood | null;
  petting: boolean;
  dragging: boolean;
  celebrating: boolean;
  /** The idle antic running right now. Only a doze has an opinion on the face. */
  dozing: boolean;
  /** The announcement on screen, if any. */
  momentMood: RobotMood | null;
  /** Is a bubble showing text — from an announcement or a one-off quip. */
  speaking: boolean;
  /** Quiet hours in the reader's own timezone. */
  quiet: boolean;
  /** Money, Admin and People: he shrinks and stops volunteering. */
  dense: boolean;
}

/** Every claim currently being made on his face, unsorted. */
export function claimsFor(i: VikInputs): Claim[] {
  const claims: Claim[] = [{ kind: 'idle', mood: i.quiet ? 'sleepy' : 'idle' }];
  if (i.playMood) claims.push({ kind: 'play', mood: i.playMood });
  if (i.celebrating) claims.push({ kind: 'celebration', mood: 'excited' });
  if (i.petting) claims.push({ kind: 'touch', mood: 'happy' });
  else if (i.dragging) claims.push({ kind: 'touch', mood: 'excited' });
  if (i.momentMood) claims.push({ kind: 'moment', mood: i.momentMood });
  if (i.dozing) claims.push({ kind: 'antic', mood: 'sleepy' });
  return claims;
}

/** The winning claim. There is always one: `idle` never stands down. */
export function pickClaim(i: VikInputs): Claim {
  return claimsFor(i).reduce((best, c) =>
    PRIORITY[c.kind] > PRIORITY[best.kind] ? c : best,
  );
}

export function moodFor(i: VikInputs): RobotMood {
  return pickClaim(i).mood;
}

export function poseFor(i: VikInputs): VikPose {
  return poseForMood(moodFor(i));
}

/**
 * Is anything at all going on? Idle antics stay out of the way when it is —
 * the interlock that stops a stretch landing in the middle of a sentence.
 *
 * Quiet hours and dense rooms count as busy because he should be volunteering
 * nothing in either.
 */
export function isBusy(i: VikInputs): boolean {
  return Boolean(
    i.speaking ||
      i.playMood ||
      i.petting ||
      i.dragging ||
      i.celebrating ||
      i.quiet ||
      i.dense,
  );
}

/** Napping in the corner: asleep, and not mid-sentence. */
export function isSleeping(i: VikInputs): boolean {
  return i.quiet && moodFor(i) === 'sleepy' && !i.speaking;
}
