/**
 * The wire between the two of you.
 *
 * Everything here is pure: the message shapes, what counts as fresh, what
 * counts as simultaneous, and where a thrown robot comes back down. The
 * transport is elsewhere (ui/companion/companionChannel.ts) so all of this can
 * be asserted without a socket.
 *
 * Two decisions worth stating outright:
 *
 * These are events, not state. Presence is a throttled, last-write-wins
 * broadcast with a heartbeat — perfect for "they are online, on /work, in a
 * block", and completely wrong for "they just threw the robot at you", which
 * must arrive exactly once and never be re-delivered by the next heartbeat.
 * So this rides `broadcast` on the same channel rather than the tracked payload.
 *
 * And nothing here needs an acknowledgement. A simultaneous poke is decided by
 * both sides independently running the same pure predicate over the same
 * window, so there is one local decision on each screen and no round trip to
 * get wrong.
 */

export type UserId = string;

export type Edge = 'left' | 'right' | 'top' | 'bottom';

export interface Envelope {
  /** Dedupe key. The receiver keeps the last few and drops repeats. */
  id: string;
  from: UserId;
  at: number;
}

export type VikMessage = Envelope &
  (
    | {
        k: 'throw';
        /** The edge he left by, on the thrower's screen. */
        edge: Edge;
        /** How far along that edge, 0..1. */
        frac: number;
        speed: number;
        /** A line he is carrying. */
        note?: string;
        /**
         * Tag. It rides the throw rather than being its own game, because that
         * is what tag actually is: whoever was hit last is it, and stays it
         * until they hit you back.
         */
        tag?: boolean;
      }
    | { k: 'poke' }
    | { k: 'rps-invite' }
    | { k: 'rps-decline' }
    | { k: 'rps'; round: number; move: 'rock' | 'paper' | 'scissors' }
  );

/**
 * A message without its envelope — what a caller actually supplies.
 *
 * Distributive on purpose: a plain Omit over a union collapses to the keys the
 * variants have in common, which would quietly forbid `edge` and `round`.
 */
export type VikMessageBody =
  VikMessage extends infer T ? (T extends VikMessage ? Omit<T, 'id' | 'from' | 'at'> : never) : never;

/** There is no server to enforce this, so encode() is where it is true. */
export const NOTE_MAX = 120;
/** Older than this and it is not news any more — a backgrounded tab catching up. */
export const STALE_MS = 20_000;
/** Both of you poking inside this window is a high five rather than two pokes. */
export const SIMULTANEOUS_MS = 3_000;
/** A tickle speaks at most this often per sender; after that it just giggles. */
export const TICKLE_SPEAK_MS = 10 * 60_000;
/** How long he is in the air. The gap is the animation. */
export const TRANSIT_MS = 900;
/** Nobody caught him: he comes back by himself after this. */
export const RETURN_MS = TRANSIT_MS + 600;

export function encode(msg: VikMessage): VikMessage {
  if (msg.k !== 'throw' || msg.note == null) return msg;
  const note = msg.note.trim().slice(0, NOTE_MAX);
  return note ? { ...msg, note } : { ...msg, note: undefined };
}

/** Anything that is not a message we understand is simply not one. */
export function decode(raw: unknown): VikMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<VikMessage>;
  if (typeof m.id !== 'string' || typeof m.from !== 'string' || typeof m.at !== 'number') {
    return null;
  }
  if (m.k === 'poke') return { id: m.id, from: m.from, at: m.at, k: 'poke' };
  if (m.k === 'rps-invite' || m.k === 'rps-decline') {
    return { id: m.id, from: m.from, at: m.at, k: m.k };
  }
  if (m.k === 'rps') {
    const r = m as Extract<VikMessage, { k: 'rps' }>;
    if (!['rock', 'paper', 'scissors'].includes(r.move)) return null;
    // The round travels with the move so a late message cannot be applied to
    // the wrong one.
    if (typeof r.round !== 'number' || r.round < 0 || r.round > 8) return null;
    return { id: m.id, from: m.from, at: m.at, k: 'rps', round: Math.floor(r.round), move: r.move };
  }
  if (m.k === 'throw') {
    const t = m as Extract<VikMessage, { k: 'throw' }>;
    if (!['left', 'right', 'top', 'bottom'].includes(t.edge)) return null;
    if (typeof t.frac !== 'number' || Number.isNaN(t.frac)) return null;
    return encode({
      id: m.id,
      from: m.from,
      at: m.at,
      k: 'throw',
      edge: t.edge,
      frac: Math.min(1, Math.max(0, t.frac)),
      speed: typeof t.speed === 'number' ? t.speed : 0,
      note: typeof t.note === 'string' ? t.note : undefined,
      tag: t.tag === true,
    });
  }
  return null;
}

export function isFresh(msg: VikMessage, now: number): boolean {
  return now - msg.at <= STALE_MS && msg.at - now <= STALE_MS;
}

/**
 * Did the two of you poke at the same moment.
 *
 * Both sides run this over the same window against their own last poke and the
 * one that just arrived, so both reach the same answer with no handshake and no
 * possibility of a double-fire — there is only ever one local decision.
 */
export function simultaneous(
  myLastPokeAt: number | null,
  theirPokeAt: number,
  now: number,
): boolean {
  if (myLastPokeAt == null) return false;
  // Both terms have to be things the two screens compute identically. The gap
  // between the pokes is symmetric; so is the later of the two. Measuring "how
  // long ago was *my* poke" is not — it differs by exactly the gap, which is
  // enough to hand one of you a high five on your own near the boundary.
  if (Math.abs(theirPokeAt - myLastPokeAt) > SIMULTANEOUS_MS) return false;
  const later = Math.max(myLastPokeAt, theirPokeAt);
  return now - later <= SIMULTANEOUS_MS;
}

/**
 * Thrown off the right, arrives from the left. Mirroring keeps the mental
 * model intact: he flew that way, so he comes in from that side.
 */
export function arrivalEdge(edge: Edge): Edge {
  if (edge === 'left') return 'right';
  if (edge === 'right') return 'left';
  return edge === 'top' ? 'bottom' : 'top';
}

export interface Viewport {
  width: number;
  height: number;
}

/** Is this release a throw at the world, or just a fling across the desk. */
export const THROW_SPEED = 1400;
export const EDGE_MARGIN = 120;

export interface Release {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * A throw, if it was one. Requires both real speed and a release near the edge
 * he is heading for — otherwise every enthusiastic drag would post him abroad.
 */
export function throwVector(
  release: Release,
  view: Viewport,
): { edge: Edge; frac: number; speed: number } | null {
  const speed = Math.hypot(release.vx, release.vy);
  if (speed < THROW_SPEED) return null;

  const horizontal = Math.abs(release.vx) >= Math.abs(release.vy);
  if (horizontal) {
    const edge: Edge = release.vx > 0 ? 'right' : 'left';
    const near = edge === 'right' ? view.width - release.x : release.x;
    if (near > EDGE_MARGIN) return null;
    return { edge, frac: clamp01(release.y / view.height), speed };
  }
  const edge: Edge = release.vy > 0 ? 'bottom' : 'top';
  const near = edge === 'bottom' ? view.height - release.y : release.y;
  if (near > EDGE_MARGIN) return null;
  return { edge, frac: clamp01(release.x / view.width), speed };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Where he lands on the receiving screen, clamped inside the safe rect. */
export function landingPoint(
  edge: Edge,
  frac: number,
  view: Viewport,
  inset: { top: number; bottom: number },
  size: { w: number; h: number },
): { left: number; top: number } {
  const minTop = inset.top + 8;
  const maxTop = view.height - inset.bottom - size.h - 8;
  const minLeft = 8;
  const maxLeft = view.width - size.w - 8;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(Math.max(lo, hi), n));

  if (edge === 'left') return { left: minLeft, top: clamp(frac * view.height, minTop, maxTop) };
  if (edge === 'right') return { left: maxLeft, top: clamp(frac * view.height, minTop, maxTop) };
  if (edge === 'top') return { left: clamp(frac * view.width, minLeft, maxLeft), top: minTop };
  return { left: clamp(frac * view.width, minLeft, maxLeft), top: maxTop };
}

/** A short, stable id. Two of these colliding inside 20s is not a real risk. */
export function messageId(from: UserId, at: number, salt: number): string {
  return `${from}:${at.toString(36)}:${Math.floor(salt * 1e6).toString(36)}`;
}
