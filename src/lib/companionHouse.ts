/**
 * Vik's house — the small building his corner became.
 *
 * It exists for three reasons, in order of how much they matter:
 *
 *   1. The window light is the friendliness meter. It is the only part of the
 *      meter that is always on screen, and it reads as atmosphere rather than
 *      as a progress bar you are failing to fill.
 *   2. The mailbox holds a note thrown from the other side of the world that
 *      arrived while you were asleep or in a focus block. A physical object
 *      beats a queued notification.
 *   3. He needs somewhere to go. A robot who sulks needs a door to shut.
 *
 * Pure, so the whole thing can be asserted without a renderer.
 */
import type { Band, Place } from './companionMood';
import { BAND_BEHAVIOUR } from './companionMood';

export interface HouseState {
  door: 'open' | 'ajar' | 'shut';
  /** Is the window lit at all — dark when he is asleep inside. */
  lit: boolean;
  /** Smoke from the chimney: he is in there and content enough. */
  smoke: boolean;
  /** Flag up: something is waiting to be opened. */
  mailbox: boolean;
  /** Where he is standing, which the layer outside uses to place him. */
  place: Place;
}

export interface HouseContext {
  band: Band;
  /** Quiet hours in the reader's own timezone — he is in bed. */
  quiet: boolean;
  /** A note arrived while you were unreachable. */
  mailWaiting: boolean;
  /** Reduced motion drops the smoke; it is the only animated part. */
  animate: boolean;
}

export function houseFor(ctx: HouseContext): HouseState {
  const { band, quiet, mailWaiting, animate } = ctx;

  // Asleep beats everything. A sulking robot still goes to bed — but he does
  // it curled up beside the house, not behind a door, so the first poke of the
  // morning still finds him.
  if (quiet) {
    return {
      door: 'shut',
      lit: false,
      smoke: animate,
      mailbox: mailWaiting,
      place: 'beside',
    };
  }

  return {
    // Ajar while he is out of sorts, wide open once he is not.
    door: band === 'sulking' || band === 'grumpy' ? 'ajar' : 'open',
    lit: true,
    // A shut-up house at night is the only time the chimney has anything to do.
    smoke: false,
    mailbox: mailWaiting,
    place: BAND_BEHAVIOUR[band].place,
  };
}

/**
 * Where he sits relative to the house, in pixels further left and further up
 * than the dock itself. Offsets, not absolute positions: the dock moves on
 * mobile to clear the tabbar and the safe area, and these have to move with it.
 * Roof-sitting is the one place that is not to the side, so it carries a lift.
 */
export const PLACEMENT: Record<Place, { left: number; lift: number }> = {
  doorway: { left: 8, lift: 0 },
  beside: { left: 38, lift: 0 },
  roaming: { left: 54, lift: 0 },
  roof: { left: 6, lift: 32 },
};
