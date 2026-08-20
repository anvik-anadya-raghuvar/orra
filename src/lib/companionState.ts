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
 *   reaction    something you are doing elsewhere in the portal
 *   antic       an idle gesture nobody asked for
 *   world       how the day is going — overdue work, a streak, rain
 *   band        how he feels about you — the friendliness meter's demeanour
 *   idle        the resting face
 *
 * `play` outranking `celebration` while `touch` sits below it is deliberate:
 * something you just did to him beats the news, but merely resting a finger on
 * him does not.
 *
 * Claims carry a full VikPose rather than a RobotMood. That is what lets the
 * world dress him in faces the announcement engine has no word for, without
 * widening the engine's vocabulary to accommodate a robot's mood.
 */
import type { RobotMood } from './companionCopy';
import { poseForMood, type VikPose } from './companionPose';

export type ActivityKind =
  | 'play'
  | 'celebration'
  | 'touch'
  | 'moment'
  | 'reaction'
  | 'antic'
  | 'world'
  | 'band'
  | 'idle';

export const PRIORITY: Record<ActivityKind, number> = {
  play: 80,
  celebration: 60,
  touch: 50,
  moment: 40,
  reaction: 30,
  antic: 20,
  world: 15,
  band: 12,
  idle: 10,
};

export interface Claim {
  kind: ActivityKind;
  pose: VikPose;
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
  /** How the day is going, if it is going in a way worth wearing. */
  worldPose: VikPose | null;
  /** What you are doing elsewhere — typing, searching, dragging a card. */
  reactionPose: VikPose | null;
  /**
   * How he feels about you. Sits below the world on purpose: what is happening
   * today is more use to you than his opinion of you, and his opinion is
   * legible from the window of his house anyway.
   */
  bandPose: VikPose | null;
  /** Is a bubble showing text — from an announcement or a one-off quip. */
  speaking: boolean;
  /** Quiet hours in the reader's own timezone. */
  quiet: boolean;
  /** Money, Admin and People: he shrinks and stops volunteering. */
  dense: boolean;
}

const IDLE: VikPose = { expression: 'neutral', body: 'stand' };
const ASLEEP: VikPose = { expression: 'sleepy', body: 'stand' };

/** Every claim currently being made on his face, unsorted. */
export function claimsFor(i: VikInputs): Claim[] {
  const claims: Claim[] = [{ kind: 'idle', pose: i.quiet ? ASLEEP : IDLE }];
  if (i.playMood) claims.push({ kind: 'play', pose: poseForMood(i.playMood) });
  if (i.celebrating) claims.push({ kind: 'celebration', pose: poseForMood('excited') });
  if (i.petting) claims.push({ kind: 'touch', pose: poseForMood('happy') });
  else if (i.dragging) claims.push({ kind: 'touch', pose: poseForMood('excited') });
  if (i.momentMood) claims.push({ kind: 'moment', pose: poseForMood(i.momentMood) });
  if (i.dozing) claims.push({ kind: 'antic', pose: ASLEEP });
  if (i.reactionPose && !i.quiet) claims.push({ kind: 'reaction', pose: i.reactionPose });
  // Neither the world nor his mood wakes him. Rain at 3am is still 3am.
  if (i.worldPose && !i.quiet) claims.push({ kind: 'world', pose: i.worldPose });
  if (i.bandPose && !i.quiet) claims.push({ kind: 'band', pose: i.bandPose });
  return claims;
}

/** The winning claim. There is always one: `idle` never stands down. */
export function pickClaim(i: VikInputs): Claim {
  return claimsFor(i).reduce((best, c) => (PRIORITY[c.kind] > PRIORITY[best.kind] ? c : best));
}

export function poseFor(i: VikInputs): VikPose {
  return pickClaim(i).pose;
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
    i.speaking || i.playMood || i.petting || i.dragging || i.celebrating || i.quiet || i.dense,
  );
}

/** Napping in the corner: asleep, and not mid-sentence. */
export function isSleeping(i: VikInputs): boolean {
  return i.quiet && poseFor(i).expression === 'sleepy' && !i.speaking;
}
