/**
 * The companion's brain — what to say, and crucially, when to say nothing.
 *
 * Pure on purpose: time, memory, presence and route all arrive as arguments,
 * nothing here reads a clock or localStorage, so every rule about annoyance
 * (the product risk of a mascot) is provable in companion.test.ts.
 *
 * Selection order: hard silence gates → live events → ambient chatter. Events
 * (a song arriving, the other person appearing) bypass the ambient cooldown but
 * carry their own debounce; ambient lines queue behind a global gap, a daily
 * cap, and a per-line cooldown, so the robot can never machine-gun the corner.
 */
import type { Dataset, Profile } from '../types';
import { activeBlockFor, SCOPE_COPY } from './blocks';
import type { BlockScope } from '../types';
import { clockIn, daysUntil, todayIso } from './dates';
import { quoteForDate } from './quotes';
import { inboxTasks, myTasks } from './workspace';
import {
  cityOf,
  GREETINGS,
  hashPick,
  JOIN_LINES,
  TIPS,
  type RobotMood,
} from './companionCopy';

export type MomentKind =
  | 'song-received'
  | 'presence-join'
  | 'block-started'
  | 'greeting'
  | 'tasks-due'
  | 'inbox-handoff'
  | 'tip'
  | 'quote'
  | 'status-check';

export interface MomentAction {
  label: string;
  /** Router destination… */
  to?: string;
  /** …or a URL for playUrl(). Exactly one of the two is set. */
  url?: string;
}

export interface Moment {
  /** Stable dedupe key — doubles as the cooldown ledger key in memory.shown. */
  id: string;
  kind: MomentKind;
  text: string;
  mood: RobotMood;
  action?: MomentAction;
  /** Auto-dismiss horizon for the bubble. */
  ttlMs: number;
}

export type CompanionEvent =
  | { type: 'song'; messageId: string; title: string; artist?: string | null; url: string | null }
  | { type: 'join' }
  | { type: 'block'; taskRef: string | null; scope: string };

export interface CompanionMemory {
  /** Moment id → epoch ms it was last shown. The whole cooldown ledger. */
  shown: Record<string, number>;
  /** Global anchor for the ambient gap. */
  lastAmbientAt: number;
  snoozedUntil?: number;
}

export type Chattiness = 'quiet' | 'normal' | 'chatty';

export interface CompanionContext {
  now: Date;
  me: Profile;
  other: Profile;
  route: string;
  /** Money/Admin/People — working rooms where ambient chatter is off. */
  dense: boolean;
  /** null until presence exists (Phase 2) — treated as unknown, not offline. */
  otherOnline: boolean | null;
  events: CompanionEvent[];
  memory: CompanionMemory;
  chattiness: Chattiness;
}

export const emptyMemory = (): CompanionMemory => ({ shown: {}, lastAmbientAt: 0 });

/** Minimum silence between ambient lines, per chattiness. */
const AMBIENT_GAP_MS: Record<Chattiness, number> = {
  quiet: 45 * 60_000,
  normal: 20 * 60_000,
  chatty: 8 * 60_000,
};

/** Ambient lines allowed per local day, per chattiness. */
const DAILY_CAP: Record<Chattiness, number> = { quiet: 3, normal: 6, chatty: 12 };

const AMBIENT_PREFIXES = ['greeting:', 'due:', 'inbox:', 'tip:', 'quote:'];
const TIP_COOLDOWN_MS = 14 * 86_400_000;
/** At most one tip per this window, regardless of which tip. */
const TIP_SLOT_MS = 6 * 3_600_000;
const JOIN_DEBOUNCE_MS = 30 * 60_000;
const BLOCK_DEBOUNCE_MS = 30 * 60_000;

const AMBIENT_TTL = 12_000;
const EVENT_TTL = 20_000;

export function hourIn(timeZone: string, now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone }).format(now),
  );
}

export type Daypart = 'morning' | 'afternoon' | 'evening';

export function daypartOf(hour: number): Daypart {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/** Before 8 or from 22, in the reader's own timezone, the robot sleeps. */
export function quietHoursFor(timeZone: string, now: Date): boolean {
  const h = hourIn(timeZone, now);
  return h < 8 || h >= 22;
}

export function isQuietHours(ctx: CompanionContext): boolean {
  return quietHoursFor(ctx.me.time_zone, ctx.now);
}

function startOfLocalDay(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function ambientShownToday(memory: CompanionMemory, now: Date): number {
  const dayStart = startOfLocalDay(now);
  return Object.entries(memory.shown).filter(
    ([id, at]) => at >= dayStart && AMBIENT_PREFIXES.some((p) => id.startsWith(p)),
  ).length;
}

/* ── Events ──────────────────────────────────────────────────────────────── */

function eventMoment(ctx: CompanionContext): Moment | null {
  const t = ctx.now.getTime();
  const order: CompanionEvent['type'][] = ['song', 'join', 'block'];
  const sorted = [...ctx.events].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));

  for (const ev of sorted) {
    if (ev.type === 'song') {
      const id = `song:${ev.messageId}`;
      if (memoryHas(ctx.memory, id)) continue;
      return {
        id,
        kind: 'song-received',
        text: `🎵 ${ctx.other.name} sent a song — “${ev.title}”${ev.artist ? ` by ${ev.artist}` : ''}. Good taste today.`,
        mood: 'excited',
        action: ev.url ? { label: 'Play it', url: ev.url } : undefined,
        ttlMs: EVENT_TTL,
      };
    }
    if (ev.type === 'join') {
      const last = ctx.memory.shown['evt:join'] ?? 0;
      if (t - last < JOIN_DEBOUNCE_MS) continue;
      const line = JOIN_LINES[hashPick(todayIso(ctx.now), JOIN_LINES.length)];
      return {
        id: 'evt:join',
        kind: 'presence-join',
        text: line(ctx.other.name),
        mood: 'wave',
        ttlMs: EVENT_TTL,
      };
    }
    if (ev.type === 'block') {
      const last = ctx.memory.shown['evt:block'] ?? 0;
      if (t - last < BLOCK_DEBOUNCE_MS) continue;
      const label = SCOPE_COPY[ev.scope as BlockScope]?.label ?? 'focus block';
      return {
        id: 'evt:block',
        kind: 'block-started',
        text: `${ctx.other.name} just went deep — ${label}${ev.taskRef ? ` on ${ev.taskRef}` : ''}. Tiptoe.`,
        mood: 'point',
        ttlMs: EVENT_TTL,
      };
    }
  }
  return null;
}

function memoryHas(memory: CompanionMemory, id: string): boolean {
  return memory.shown[id] != null;
}

/* ── Ambient ─────────────────────────────────────────────────────────────── */

function greetingMoment(ctx: CompanionContext): Moment | null {
  const date = todayIso(ctx.now);
  const part = daypartOf(hourIn(ctx.me.time_zone, ctx.now));
  const id = `greeting:${date}:${part}`;
  if (memoryHas(ctx.memory, id)) return null;
  const variants = GREETINGS[part];
  const line = variants[hashPick(date + part, variants.length)];
  return {
    id,
    kind: 'greeting',
    text: line({
      name: ctx.me.name,
      otherName: ctx.other.name,
      otherClock: clockIn(ctx.other.time_zone, ctx.now),
      otherCity: cityOf(ctx.other.time_zone),
    }),
    mood: 'wave',
    ttlMs: AMBIENT_TTL,
  };
}

function tasksDueMoment(ds: Dataset, ctx: CompanionContext): Moment | null {
  const date = todayIso(ctx.now);
  const id = `due:${date}`;
  if (memoryHas(ctx.memory, id)) return null;
  const due = myTasks(ds.tasks, ctx.me.id).filter(
    (t) => t.status !== 'done' && t.due_date != null && daysUntil(t.due_date, date) <= 0,
  );
  if (due.length === 0) return null;
  const text =
    due.length === 1
      ? `One thing due today: “${due[0].title}”. Very doable.`
      : `${due.length} things due today. Deep breath — the board has them lined up.`;
  return {
    id,
    kind: 'tasks-due',
    text,
    mood: 'point',
    action: { label: 'See the board', to: '/work' },
    ttlMs: AMBIENT_TTL,
  };
}

function inboxMoment(ds: Dataset, ctx: CompanionContext): Moment | null {
  const date = todayIso(ctx.now);
  const id = `inbox:${date}`;
  if (memoryHas(ctx.memory, id)) return null;
  const inbox = inboxTasks(ds.tasks, ctx.me.id);
  if (inbox.length === 0) return null;
  const text =
    inbox.length === 1
      ? `${ctx.other.name} handed you something — want a look?`
      : `${ctx.other.name} handed you ${inbox.length} things. Popular today.`;
  return {
    id,
    kind: 'inbox-handoff',
    text,
    mood: 'point',
    action: { label: 'Open inbox', to: '/work' },
    ttlMs: AMBIENT_TTL,
  };
}

/** Least-recently-shown eligible tip, or null when all are cooling down. */
function tipMoment(ctx: CompanionContext, ignoreCooldowns = false): Moment | null {
  const t = ctx.now.getTime();
  if (!ignoreCooldowns) {
    const lastTipAt = Math.max(
      0,
      ...Object.entries(ctx.memory.shown)
        .filter(([id]) => id.startsWith('tip:'))
        .map(([, at]) => at),
    );
    if (t - lastTipAt < TIP_SLOT_MS) return null;
  }
  const eligible = TIPS.filter((tip) => {
    if (tip.route && !tip.route(ctx.route)) return false;
    if (ignoreCooldowns) return true;
    const at = ctx.memory.shown[`tip:${tip.key}`];
    return at == null || t - at >= TIP_COOLDOWN_MS;
  });
  const pool = eligible.length > 0 ? eligible : ignoreCooldowns ? TIPS : [];
  if (pool.length === 0) return null;
  const pick = [...pool].sort(
    (a, b) => (ctx.memory.shown[`tip:${a.key}`] ?? 0) - (ctx.memory.shown[`tip:${b.key}`] ?? 0),
  )[0];
  return {
    id: `tip:${pick.key}`,
    kind: 'tip',
    text: pick.text,
    mood: pick.mood ?? 'point',
    action: pick.action,
    ttlMs: AMBIENT_TTL,
  };
}

function quoteMoment(ctx: CompanionContext): Moment | null {
  const date = todayIso(ctx.now);
  const id = `quote:${date}`;
  if (memoryHas(ctx.memory, id)) return null;
  const q = quoteForDate(date);
  return {
    id,
    kind: 'quote',
    text: `“${q.text}” — ${q.who}`,
    mood: 'happy',
    ttlMs: AMBIENT_TTL,
  };
}

/* ── Selection ───────────────────────────────────────────────────────────── */

export function pickMoment(ds: Dataset, ctx: CompanionContext): Moment | null {
  const t = ctx.now.getTime();

  // Hard silence: snoozed, or my own block is running — never talk over focus.
  if (ctx.memory.snoozedUntil != null && ctx.memory.snoozedUntil > t) return null;
  if (activeBlockFor(ds, ctx.me.id)) return null;

  // Events bypass the ambient gap; they carry their own debounce.
  const event = eventMoment(ctx);
  if (event) return event;

  // Ambient chatter: not in dense rooms, not at night, not too often.
  if (ctx.dense) return null;
  if (isQuietHours(ctx)) return null;
  if (t - ctx.memory.lastAmbientAt < AMBIENT_GAP_MS[ctx.chattiness]) return null;
  if (ambientShownToday(ctx.memory, ctx.now) >= DAILY_CAP[ctx.chattiness]) return null;

  return (
    greetingMoment(ctx) ??
    tasksDueMoment(ds, ctx) ??
    inboxMoment(ds, ctx) ??
    tipMoment(ctx) ??
    quoteMoment(ctx)
  );
}

/**
 * The tap cycle — user-initiated, so cooldowns don't apply. Step 0 answers
 * "what's happening", then a tip, then the quote of the day.
 */
export function pickOnDemand(ds: Dataset, ctx: CompanionContext, step: number): Moment {
  const which = ((step % 3) + 3) % 3;
  if (which === 1) {
    const tip = tipMoment(ctx, true);
    if (tip) return { ...tip, ttlMs: 15_000 };
  }
  if (which === 2) {
    const q = quoteForDate(todayIso(ctx.now));
    return {
      id: `ondemand:quote`,
      kind: 'quote',
      text: `“${q.text}” — ${q.who}`,
      mood: 'happy',
      ttlMs: 15_000,
    };
  }
  return { ...statusMoment(ds, ctx), ttlMs: 15_000 };
}

/** One live line about the other person — the PulseTile trio, in prose. */
export function statusMoment(ds: Dataset, ctx: CompanionContext): Moment {
  const { other, now } = ctx;
  const base = { id: 'ondemand:status', kind: 'status-check' as const, ttlMs: 15_000 };

  const block = activeBlockFor(ds, other.id);
  if (block) {
    const label = SCOPE_COPY[block.scope].label;
    const task = block.focus_task_id
      ? ds.tasks.find((tk) => tk.id === block.focus_task_id)
      : null;
    return {
      ...base,
      text: `${other.name} is mid-${label}${task ? ` on “${task.title}”` : ''}. In the zone.`,
      mood: 'point',
    };
  }

  const statusFresh =
    other.status_text &&
    (!other.status_expires_at || new Date(other.status_expires_at).getTime() > now.getTime());
  if (statusFresh) {
    return { ...base, text: `${other.name} says: “${other.status_text}”`, mood: 'happy' };
  }

  const doing = myTasks(ds.tasks, other.id).find((tk) => tk.status === 'in_progress');
  if (ctx.otherOnline && doing) {
    return { ...base, text: `${other.name} is online, chipping at “${doing.title}”.`, mood: 'happy' };
  }
  if (ctx.otherOnline) {
    return { ...base, text: `${other.name} is online right now. Wave-able.`, mood: 'wave' };
  }

  const h = hourIn(other.time_zone, now);
  const asleep = h < 7 || h >= 23;
  return {
    ...base,
    text: `It's ${clockIn(other.time_zone, now)} in ${cityOf(other.time_zone)} for ${other.name}${
      asleep ? ' — probably asleep' : ''
    }.`,
    mood: asleep ? 'sleepy' : 'idle',
  };
}

/* ── Memory bookkeeping ──────────────────────────────────────────────────── */

const isAmbient = (id: string) => AMBIENT_PREFIXES.some((p) => id.startsWith(p));

/**
 * Record that a moment was shown. On-demand shows still advance per-line
 * rotation (so tips cycle) but never charge the ambient gap — the user asked.
 */
export function commitMoment(
  memory: CompanionMemory,
  moment: Moment,
  now: Date,
  opts: { onDemand?: boolean } = {},
): CompanionMemory {
  const t = now.getTime();
  const next: CompanionMemory = {
    ...memory,
    shown: { ...memory.shown, [moment.id]: t },
  };
  if (moment.kind === 'presence-join') next.shown['evt:join'] = t;
  if (moment.kind === 'block-started') next.shown['evt:block'] = t;
  if (!opts.onDemand && isAmbient(moment.id)) next.lastAmbientAt = t;
  return next;
}

/** Keep the ledger bounded — anything older than 30 days can only be noise. */
export function pruneMemory(memory: CompanionMemory, now: Date): CompanionMemory {
  const horizon = now.getTime() - 30 * 86_400_000;
  const shown = Object.fromEntries(
    Object.entries(memory.shown).filter(([, at]) => at >= horizon),
  );
  return { ...memory, shown };
}
