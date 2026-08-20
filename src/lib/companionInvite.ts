/**
 * When Vik is allowed to start something himself.
 *
 * He is playful by default, which is a decision that only survives contact with
 * a working day if the gate around it is strict. This is that gate, and it is
 * pure so every clause is assertable.
 *
 * An invitation is not an announcement: it has its own gap and its own daily
 * cap, separate from the ambient chatter budget in companion.ts. Sharing one
 * budget would mean a game offer silently costing you a tip you wanted.
 */
import type { Band } from './companionMood';
import { BAND_BEHAVIOUR } from './companionMood';
import type { Chattiness } from './companion';
import { SOLO_IDS, type GameId } from './companionGames';

/** How long between offers. A quiet robot never offers at all. */
export const INVITE_GAP_MS: Record<Chattiness, number> = {
  quiet: Number.POSITIVE_INFINITY,
  normal: 45 * 60_000,
  chatty: 20 * 60_000,
};

/** And how many in a day, at most. */
export const INVITE_CAP: Record<Chattiness, number> = {
  quiet: 0,
  normal: 2,
  chatty: 5,
};

/** How long he has to have been left alone before an offer is welcome. */
export const IDLE_BEFORE_MS = 3 * 60_000;

export interface InviteMemory {
  /** Local ISO day the count belongs to. */
  day: string;
  count: number;
  lastAt: number;
}

export function emptyInvites(): InviteMemory {
  return { day: '', count: 0, lastAt: 0 };
}

export interface InviteContext {
  now: number;
  today: string;
  chattiness: Chattiness;
  band: Band;
  memory: InviteMemory;
  /** The "calm down" preference. Absent means playful. */
  playful: boolean;
  /** Money, Admin, People — he volunteers nothing there. */
  dense: boolean;
  /** Quiet hours in the reader's own timezone. */
  quiet: boolean;
  /** Anything at all going on, including a game already running. */
  busy: boolean;
  /** Your own focus block is up. */
  blocked: boolean;
  /** How long since you last touched him. */
  idleMs: number;
  /** Games switched off individually. */
  disabled?: Record<string, boolean>;
  /** Animation is allowed — some games are not offered without it. */
  animate: boolean;
}

/**
 * Every reason he might not ask, in one place. Returns null when he may.
 * Named rather than boolean so a test can assert *which* gate stopped him.
 */
export function blockedBy(ctx: InviteContext): string | null {
  if (!ctx.playful) return 'calmed-down';
  if (ctx.blocked) return 'focus-block';
  if (ctx.quiet) return 'quiet-hours';
  if (ctx.dense) return 'dense-room';
  if (ctx.busy) return 'busy';
  if (!BAND_BEHAVIOUR[ctx.band].invites) return 'out-of-sorts';
  if (ctx.idleMs < IDLE_BEFORE_MS) return 'too-soon-after-you';

  const cap = INVITE_CAP[ctx.chattiness];
  if (cap <= 0) return 'chattiness';
  const count = ctx.memory.day === ctx.today ? ctx.memory.count : 0;
  if (count >= cap) return 'daily-cap';
  if (ctx.now - ctx.memory.lastAt < INVITE_GAP_MS[ctx.chattiness]) return 'too-soon-again';
  return null;
}

export function canInvite(ctx: InviteContext): boolean {
  return blockedBy(ctx) === null;
}

/**
 * Which game to offer. Deterministic from the clock so two renders in the same
 * moment cannot disagree, and never one you have switched off.
 */
export function pickInvite(ctx: InviteContext): GameId | null {
  if (!canInvite(ctx)) return null;
  // Solo only: offering a two-player game to someone whose partner is asleep
  // in another country is not an invitation, it is a disappointment.
  const pool = SOLO_IDS.filter((id) => ctx.disabled?.[id] !== true);
  if (!pool.length) return null;
  return pool[Math.floor(ctx.now / 60_000) % pool.length];
}

/** Record that he asked. Rolls the count over on a new day. */
export function noteInvite(memory: InviteMemory, today: string, now: number): InviteMemory {
  const count = memory.day === today ? memory.count + 1 : 1;
  return { day: today, count, lastAt: now };
}
