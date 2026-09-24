/**
 * ORRA blocks → your Google Calendar.
 *
 * Booking pages (Google appointment schedules, Cal.com) only see Google. A
 * block made here was invisible to them, so a stranger could book straight
 * over "deep work 2–4". This writes those blocks into one chosen account's
 * primary calendar, so Google — and anything that reads it — sees you busy.
 *
 * It is a reconcile, not an event log: every run lists what ORRA previously
 * wrote (tagged with a private extended property), compares it with what
 * should be there, and creates, updates or deletes the difference. Nothing is
 * stored on our side, so a missed run, a deleted row, or a declined invite all
 * converge on the next one.
 *
 * One-way on purpose. The read sync skips tagged events, and editing one in
 * Google is overwritten here: the day_events row is the original.
 */
import type { AppStore } from '../data/store';
import { today } from '../data/store';
import type { DayEvent, UserId } from '../types';
import { awaitingMyConfirmation, isMyEvent } from './calendar';
import type { PushedEvent, PushedEventBody } from './google';
import {
  ORRA_ID_KEY,
  ORRA_MARK,
  deletePushedEvent,
  fetchPushedEvents,
  hasLiveAccountToken,
  insertPushedEvent,
  updatePushedEvent,
} from './google';

/** How far ahead blocks are written. Booking pages rarely offer further out. */
export const PUSH_FWD_DAYS = 60;

const shiftDay = (iso: string, days: number): string =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

/* ── which blocks go out ────────────────────────────────────────────── */

/**
 * The events that should hold time on `userId`'s Google calendar.
 *
 * Left out, each for a reason:
 *  · anything that came *from* Google — writing it back would duplicate it
 *  · reminders — a ping is not busy time, and a booking page should not
 *    refuse a slot because you wanted a nudge in it
 *  · an invite you have not accepted — until you say yes it is their
 *    proposal, not your commitment. Your own proposals do go out: you are
 *    holding that time whether or not they agree yet
 */
export function pushableEvents(events: DayEvent[], userId: UserId, fromIso: string, toIso: string): DayEvent[] {
  return events
    .filter(
      (e) =>
        e.date >= fromIso &&
        e.date <= toIso &&
        isMyEvent(e, userId) &&
        !e.external_event_id &&
        !e.integration_grant_id &&
        e.kind !== 'reminder' &&
        e.end_min > e.start_min &&
        !awaitingMyConfirmation(e, userId),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_min - b.start_min || a.id.localeCompare(b.id));
}

/* ── what one looks like in Google ──────────────────────────────────── */

/** `date` + minutes-from-midnight as a zone-less local wall-clock time.
 *  1440 rolls to the next day's 00:00 rather than an invalid 24:00. */
export function localDateTime(date: string, minutes: number): string {
  const day = shiftDay(date, Math.floor(minutes / 1440));
  const rest = ((minutes % 1440) + 1440) % 1440;
  const hh = String(Math.floor(rest / 60)).padStart(2, '0');
  const mm = String(rest % 60).padStart(2, '0');
  return `${day}T${hh}:${mm}:00`;
}

export function toPushBody(event: DayEvent, timeZone: string, withName?: string | null): PushedEventBody {
  return {
    summary: withName ? `${event.label} · with ${withName}` : event.label,
    description: 'Blocked in ORRA. Edit or remove it there — changes made here are overwritten.',
    start: { dateTime: localDateTime(event.date, event.start_min), timeZone },
    end: { dateTime: localDateTime(event.date, event.end_min), timeZone },
    transparency: 'opaque',
    // ORRA sends its own reminders; Google's default popup would ping twice.
    reminders: { useDefault: false },
    extendedProperties: { private: { [ORRA_MARK.key]: ORRA_MARK.value, [ORRA_ID_KEY]: event.id } },
  };
}

/* ── the diff ───────────────────────────────────────────────────────── */

export interface WantedBlock {
  orraId: string;
  body: PushedEventBody;
  /** The instants this block covers, for comparing against what Google
   *  returns — Google answers in the calendar's own zone, not ours. */
  startMs: number;
  endMs: number;
}

export interface PushPlan {
  create: WantedBlock[];
  update: { googleId: string; block: WantedBlock }[];
  remove: string[];
}

/** Pure: what to change so Google holds exactly `wanted`. */
export function planPush(wanted: WantedBlock[], existing: PushedEvent[]): PushPlan {
  const plan: PushPlan = { create: [], update: [], remove: [] };
  const seen = new Map<string, PushedEvent>();
  for (const event of existing) {
    // Two Google events for one block (an interrupted earlier run): keep one.
    if (seen.has(event.orraId)) plan.remove.push(event.googleId);
    else seen.set(event.orraId, event);
  }
  const wantedIds = new Set(wanted.map((block) => block.orraId));
  for (const block of wanted) {
    const prior = seen.get(block.orraId);
    if (!prior) {
      plan.create.push(block);
      continue;
    }
    const same =
      prior.summary === block.body.summary &&
      Date.parse(prior.start) === block.startMs &&
      Date.parse(prior.end) === block.endMs;
    if (!same) plan.update.push({ googleId: prior.googleId, block });
  }
  for (const [orraId, event] of seen) if (!wantedIds.has(orraId)) plan.remove.push(event.googleId);
  return plan;
}

/* ── running it ─────────────────────────────────────────────────────── */

export interface PushResult {
  created: number;
  updated: number;
  removed: number;
}

/** The account this user chose to receive their blocks, if any. */
export const pushAccountId = (store: AppStore): string | null =>
  store.me.personalization.calendar_push_account_id ?? null;

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function wantedBlocks(store: AppStore, fromIso: string, toIso: string): WantedBlock[] {
  const timeZone = browserTimeZone();
  const nameOf = (id: UserId | null | undefined) => store.ds.profiles.find((p) => p.id === id)?.name ?? null;
  return pushableEvents(store.ds.day_events, store.meId, fromIso, toIso).map((event) => {
    // "With" names the other person from whichever side is looking.
    const otherId = event.invitee_id
      ? event.invitee_id === store.meId
        ? event.created_by ?? event.user_id
        : event.invitee_id
      : null;
    const body = toPushBody(event, timeZone, otherId && otherId !== store.meId ? nameOf(otherId) : null);
    return {
      orraId: event.id,
      body,
      startMs: new Date(body.start.dateTime).getTime(),
      endMs: new Date(body.end.dateTime).getTime(),
    };
  });
}

async function apply(accountId: string, plan: PushPlan): Promise<PushResult> {
  for (const block of plan.create) await insertPushedEvent(accountId, block.body);
  for (const { googleId, block } of plan.update) await updatePushedEvent(accountId, googleId, block.body);
  for (const googleId of plan.remove) await deletePushedEvent(accountId, googleId);
  return { created: plan.create.length, updated: plan.update.length, removed: plan.remove.length };
}

/* One run at a time per account. Without this, the 15-minute sync and an
   edit landing together would both see a block missing and both create it. */
const running = new Map<string, Promise<PushResult>>();
const rerun = new Set<string>();

function serialised(accountId: string, work: () => Promise<PushResult>): Promise<PushResult> {
  const current = running.get(accountId);
  if (current) {
    rerun.add(accountId);
    return current;
  }
  const next = (async () => {
    try {
      let result = await work();
      while (rerun.delete(accountId)) result = await work();
      return result;
    } finally {
      running.delete(accountId);
    }
  })();
  running.set(accountId, next);
  return next;
}

/** Make `accountId`'s calendar hold exactly this user's current blocks. */
export function pushCalendar(store: AppStore, accountId: string): Promise<PushResult> {
  return serialised(accountId, async () => {
    const from = today();
    const to = shiftDay(from, PUSH_FWD_DAYS);
    const existing = await fetchPushedEvents(accountId, from, to);
    return apply(accountId, planPush(wantedBlocks(store, from, to), existing));
  });
}

/** Take every upcoming ORRA block back out of `accountId`'s calendar — used
 *  when you stop sending blocks there, so nothing is left behind to go stale. */
export function clearPushed(accountId: string): Promise<PushResult> {
  return serialised(accountId, async () => {
    const from = today();
    const existing = await fetchPushedEvents(accountId, from, shiftDay(from, PUSH_FWD_DAYS));
    return apply(accountId, planPush([], existing));
  });
}

/** Push now if this user has a target account with a live session. Silent
 *  otherwise: timers never open a Google popup. */
export async function pushIfLive(store: AppStore): Promise<PushResult | null> {
  const accountId = pushAccountId(store);
  if (!accountId || !hasLiveAccountToken(accountId, ['calendar'])) return null;
  const account = store.ds.integration_grants.find((g) => g.id === accountId && g.user_id === store.meId);
  if (!account || account.is_active === false) return null;
  return pushCalendar(store, accountId);
}
