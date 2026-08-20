/**
 * Catch him.
 *
 * He flees your cursor. Get near and he bolts; get him into a corner and he
 * has nowhere left to run — the clamp against the edge of the safe area does
 * that for free, no separate "is he cornered" check needed. Catching him is
 * just clicking on wherever he currently is, which the button already does.
 *
 * The steering itself is pure and testable: given a position, a pointer (or
 * none) and a bit of elapsed time, it returns where he moves to. Everything
 * about WHETHER a round is won, lost, or still running is pure too. Only the
 * 60fps loop that calls this every frame lives in the UI layer.
 */

export const ROUND_MS = 20_000;
/** He starts moving once the pointer is this close, in pixels. */
export const TRIGGER_RADIUS = 150;
/** Top speed, right up close, in pixels per second. */
export const FLEE_SPEED = 340;

export interface Vec {
  x: number;
  y: number;
}

export interface FleeBounds {
  width: number;
  height: number;
  /** Kept this far from every edge — where he runs out of road. */
  margin: number;
}

/**
 * One step of fleeing. Speed tapers from full at zero distance to nothing at
 * the trigger radius, so the chase feels like urgency rather than a switch
 * flipping. Clamped into the bounds — which is the entire cornering mechanic:
 * press him into a corner and both axes clamp, so he stops moving even though
 * the pointer is still close, and you can click him.
 */
export function fleeStep(pos: Vec, pointer: Vec | null, bounds: FleeBounds, dtSec: number): Vec {
  if (!pointer || dtSec <= 0) return pos;
  const dx = pos.x - pointer.x;
  const dy = pos.y - pointer.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0 || dist > TRIGGER_RADIUS) return pos;

  const urgency = 1 - dist / TRIGGER_RADIUS;
  const step = FLEE_SPEED * urgency * dtSec;
  const nx = pos.x + (dx / dist) * step;
  const ny = pos.y + (dy / dist) * step;

  return {
    x: Math.min(bounds.width - bounds.margin, Math.max(bounds.margin, nx)),
    y: Math.min(bounds.height - bounds.margin, Math.max(bounds.margin, ny)),
  };
}

/** A starting spot away from every edge, so the round does not open cornered. */
export function startPosition(bounds: FleeBounds): Vec {
  return { x: bounds.width / 2, y: bounds.height / 2 };
}

export type CatchPhase = 'fleeing' | 'caught' | 'timeout';

export interface CatchState {
  phase: CatchPhase;
  startedAt: number;
  caughtAt: number | null;
}

export function start(now: number): CatchState {
  return { phase: 'fleeing', startedAt: now, caughtAt: null };
}

export function caught(state: CatchState, now: number): CatchState {
  return state.phase === 'fleeing' ? { ...state, phase: 'caught', caughtAt: now } : state;
}

export function timeout(state: CatchState): CatchState {
  return state.phase === 'fleeing' ? { ...state, phase: 'timeout' } : state;
}

/** Seconds to catch, one decimal place. Null if he was never caught. */
export function score(state: CatchState): number | null {
  if (state.phase !== 'caught' || state.caughtAt == null) return null;
  return Math.round((state.caughtAt - state.startedAt) / 100) / 10;
}

export function verdict(state: CatchState): string {
  if (state.phase === 'timeout') return "Twenty seconds and you're still empty-handed.";
  const s = score(state);
  if (s == null) return '…';
  if (s < 3) return `${s}s. That is barely a chase.`;
  if (s < 10) return `Cornered in ${s}s.`;
  return `${s}s. You earned that one.`;
}
