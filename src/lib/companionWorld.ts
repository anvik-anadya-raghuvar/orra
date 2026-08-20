/**
 * How the day is going, as far as a robot in the corner can tell.
 *
 * One pure derivation feeding two consumers: the wardrobe (what he puts on)
 * and his resting face (how he holds himself when nothing else is happening).
 * Both were previously either absent or hardcoded in the component — the
 * Friday hat lived as a line of arithmetic inside a render.
 *
 * Everything here reads existing tables. Nothing is stored, nothing is
 * fetched, and no signal is personal to one person's private data beyond the
 * ownership filters the rest of the app already applies.
 */
import type { Dataset, UserId } from '../types';
import { quietHoursFor } from './companion';
import { intentionsFor, itemDone } from './dayPlan';
import { daysUntil, localDay, todayIso } from './dates';
import type { VikPose } from './companionPose';
import { isSnowing, isWet, type CurrentWeather } from './weather';
import { isMyTask } from './workspace';

/** How cold before he wants a scarf, and how hot before sunglasses. */
export const COLD_C = 8;
export const HOT_C = 32;
export const WINDY_KMH = 35;
/** A study streak has to survive this many days to earn the cap. */
export const STREAK_DAYS = 3;
/** A song counts as playing for this long after it lands. */
export const SONG_WINDOW_MS = 8 * 60_000;

export interface WorldSignals {
  /** Local wall clock of the person reading. */
  now: Date;
  raining: boolean;
  snowing: boolean;
  cold: boolean;
  hot: boolean;
  windy: boolean;
  /** At least one of my tasks is flagged stuck or blocked. */
  stuck: boolean;
  /** How many of my tasks are past their due date and still open. */
  overdue: number;
  /** Every intention I set for today is done. */
  dayCleared: boolean;
  /** Consecutive days ending today with study time logged. */
  studyStreak: number;
  /** Someone shared a song in the last few minutes. */
  songPlaying: boolean;
  /** It is the middle of the night where the other person is. */
  otherAsleep: boolean;
  /** Friday evening, local. */
  party: boolean;
}

export interface WorldContext {
  ds: Dataset;
  meId: UserId;
  now: Date;
  /** Whatever the weather cache had — decoration, so null is fine. */
  weather: CurrentWeather | null;
  /** The other person's timezone, for knowing when they are asleep. */
  otherTimeZone: string | null;
}

/** Consecutive days with study time, counting back from today. */
export function studyStreakFor(ds: Dataset, meId: UserId, now: Date): number {
  const days = new Set(
    ds.time_logs
      .filter((t) => t.user_id === meId && t.kind === 'study' && t.minutes > 0)
      .map((t) => t.date),
  );
  let streak = 0;
  const cursor = new Date(now);
  // Today not being logged yet is not a broken streak — it is an unfinished
  // one, so the count starts from yesterday when today is empty.
  if (!days.has(todayIso(cursor))) cursor.setDate(cursor.getDate() - 1);
  for (;;) {
    if (!days.has(todayIso(cursor))) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function readWorld(ctx: WorldContext): WorldSignals {
  const { ds, meId, now, weather } = ctx;
  const today = todayIso(now);
  const mine = ds.tasks.filter((t) => isMyTask(t, meId) && t.status !== 'done');

  const intentions = intentionsFor(ds, meId, today);
  const nowMs = now.getTime();

  return {
    now,
    raining: weather ? isWet(weather.weather_code) : false,
    snowing: weather ? isSnowing(weather.weather_code) : false,
    cold: weather ? weather.apparent_temperature <= COLD_C : false,
    hot: weather ? weather.apparent_temperature >= HOT_C : false,
    windy: weather ? weather.wind_speed_10m > WINDY_KMH : false,
    stuck: mine.some((t) => t.is_stuck || Boolean(t.blocked_reason)),
    overdue: mine.filter((t) => t.due_date && daysUntil(t.due_date, today) < 0).length,
    dayCleared: intentions.length > 0 && intentions.every((i) => itemDone(i, ds.tasks)),
    studyStreak: studyStreakFor(ds, meId, now),
    songPlaying: ds.messages.some(
      (m) =>
        m.kind === 'song' &&
        Boolean(m.song_ref) &&
        nowMs - new Date(m.created_at).getTime() < SONG_WINDOW_MS,
    ),
    otherAsleep: ctx.otherTimeZone ? quietHoursFor(ctx.otherTimeZone, now) : false,
    party: now.getDay() === 5 && now.getHours() >= 18,
  };
}

/**
 * The face he wears when nothing else is claiming it — the lowest rung above
 * plain idle. Deliberately sparse: most of the time the answer is null and he
 * just stands there. A robot who reacts to everything reacts to nothing.
 *
 * Order matters. Good news first, so a cleared day is not overwritten by the
 * one task that is still technically overdue.
 */
export function restingPose(w: WorldSignals): VikPose | null {
  if (w.dayCleared) return { expression: 'proud', body: 'hips' };
  if (w.songPlaying) return { expression: 'cheer', body: 'cheer' };
  if (w.studyStreak >= STREAK_DAYS) return { expression: 'proud', body: 'stand' };
  if (w.stuck) return { expression: 'thinking', body: 'think' };
  if (w.overdue >= 3) return { expression: 'weary', body: 'stand' };
  if (w.raining || w.snowing) return { expression: 'neutral', body: 'stand' };
  // Watching the other person sleep through the small hours of their day.
  if (w.otherAsleep) return { expression: 'soft', body: 'stand' };
  return null;
}
