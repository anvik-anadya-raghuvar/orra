import { describe, expect, it } from 'vitest';
import type { Dataset, Task, TimeLog } from '../types';
import { readWorld, restingPose, studyStreakFor, type WorldSignals } from './companionWorld';
import type { CurrentWeather } from './weather';

const ME = 'u-anadya';
const OTHER = 'u-raghuvar';

/** 12:00 in Kolkata on Tuesday 2026-08-18 — a plain working day. */
const NOON = new Date('2026-08-18T06:30:00.000Z');

const task = (p: Partial<Task>): Task =>
  ({
    id: 'T-1',
    title: 'A task',
    status: 'todo',
    assignee_id: ME,
    created_by: ME,
    due_date: null,
    is_stuck: false,
    blocked_reason: null,
    priority: 'normal',
    ...p,
  }) as Task;

const log = (date: string, over: Partial<TimeLog> = {}): TimeLog =>
  ({ id: `tl-${date}`, user_id: ME, date, kind: 'study', minutes: 30, course_id: null, ...over }) as TimeLog;

const dataset = (p: Partial<Dataset> = {}): Dataset =>
  ({
    tasks: [],
    time_logs: [],
    messages: [],
    day_plans: [],
    day_plan_items: [],
    ...p,
  }) as unknown as Dataset;

const weather = (p: Partial<CurrentWeather>): CurrentWeather => ({
  temperature_2m: 20,
  apparent_temperature: 20,
  weather_code: 0,
  wind_speed_10m: 5,
  ...p,
});

const read = (ds: Dataset, over: Partial<Parameters<typeof readWorld>[0]> = {}) =>
  readWorld({ ds, meId: ME, now: NOON, weather: null, otherTimeZone: null, ...over });

describe('weather signals', () => {
  it('reads rain from the WMO band, not from the temperature', () => {
    expect(read(dataset(), { weather: weather({ weather_code: 61 }) }).raining).toBe(true);
    expect(read(dataset(), { weather: weather({ weather_code: 95 }) }).raining).toBe(true);
    expect(read(dataset(), { weather: weather({ weather_code: 3 }) }).raining).toBe(false);
    expect(read(dataset(), { weather: weather({ weather_code: 71 }) }).snowing).toBe(true);
  });

  it('uses what it feels like, not what the thermometer says', () => {
    const w = read(dataset(), {
      weather: weather({ temperature_2m: 14, apparent_temperature: 4 }),
    });
    expect(w.cold).toBe(true);
    expect(w.hot).toBe(false);
  });

  it('reports nothing at all when no place is set', () => {
    const w = read(dataset());
    expect([w.raining, w.snowing, w.cold, w.hot, w.windy]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('work signals', () => {
  it('notices a stuck task, however it was flagged', () => {
    expect(read(dataset({ tasks: [task({ is_stuck: true })] })).stuck).toBe(true);
    expect(read(dataset({ tasks: [task({ blocked_reason: 'waiting on legal' })] })).stuck).toBe(
      true,
    );
    expect(read(dataset({ tasks: [task({})] })).stuck).toBe(false);
  });

  it('does not count a finished task as stuck or overdue', () => {
    const done = task({ status: 'done', is_stuck: true, due_date: '2020-01-01' });
    const w = read(dataset({ tasks: [done] }));
    expect(w.stuck).toBe(false);
    expect(w.overdue).toBe(0);
  });

  it('counts only work that is genuinely past its date', () => {
    const ds = dataset({
      tasks: [
        task({ id: 'T-1', due_date: '2026-08-10' }),
        task({ id: 'T-2', due_date: '2026-08-18' }), // today is not overdue
        task({ id: 'T-3', due_date: '2026-09-01' }),
      ],
    });
    expect(read(ds).overdue).toBe(1);
  });

  it(`ignores the other person's work`, () => {
    const theirs = task({ assignee_id: OTHER, created_by: OTHER, is_stuck: true });
    expect(read(dataset({ tasks: [theirs] })).stuck).toBe(false);
  });
});

describe('study streaks', () => {
  it('counts consecutive days back from today', () => {
    const ds = dataset({ time_logs: [log('2026-08-18'), log('2026-08-17'), log('2026-08-16')] });
    expect(studyStreakFor(ds, ME, NOON)).toBe(3);
  });

  it('treats an unlogged today as unfinished, not broken', () => {
    const ds = dataset({ time_logs: [log('2026-08-17'), log('2026-08-16')] });
    expect(studyStreakFor(ds, ME, NOON)).toBe(2);
  });

  it('stops at the first gap', () => {
    const ds = dataset({ time_logs: [log('2026-08-18'), log('2026-08-16'), log('2026-08-15')] });
    expect(studyStreakFor(ds, ME, NOON)).toBe(1);
  });

  it('ignores founder time and the other person', () => {
    const ds = dataset({
      time_logs: [
        log('2026-08-18', { kind: 'founder' }),
        log('2026-08-17', { user_id: OTHER }),
        log('2026-08-16', { minutes: 0 }),
      ],
    });
    expect(studyStreakFor(ds, ME, NOON)).toBe(0);
  });
});

describe('the song window', () => {
  const song = (minutesAgo: number) => ({
    id: `m-${minutesAgo}`,
    kind: 'song',
    song_ref: 'abc',
    created_at: new Date(NOON.getTime() - minutesAgo * 60_000).toISOString(),
  });

  it('counts a song as playing for a few minutes, then stops', () => {
    expect(read(dataset({ messages: [song(2)] as never })).songPlaying).toBe(true);
    expect(read(dataset({ messages: [song(30)] as never })).songPlaying).toBe(false);
  });
});

/* ── The resting face ─────────────────────────────────────────────────── */

const CALM: WorldSignals = {
  now: NOON,
  raining: false,
  snowing: false,
  cold: false,
  hot: false,
  windy: false,
  stuck: false,
  overdue: 0,
  dayCleared: false,
  studyStreak: 0,
  songPlaying: false,
  otherAsleep: false,
  party: false,
};
const w = (over: Partial<WorldSignals>): WorldSignals => ({ ...CALM, ...over });

describe('the resting face', () => {
  it('is nothing at all on an ordinary day — he just stands there', () => {
    expect(restingPose(CALM)).toBeNull();
  });

  it('puts good news ahead of bad, so one late task cannot spoil a cleared day', () => {
    expect(restingPose(w({ dayCleared: true, overdue: 9, stuck: true }))).toEqual({
      expression: 'proud',
      body: 'hips',
    });
  });

  it('only sags once the overdue pile is genuinely a pile', () => {
    expect(restingPose(w({ overdue: 2 }))).toBeNull();
    expect(restingPose(w({ overdue: 3 }))).toEqual({ expression: 'weary', body: 'stand' });
  });

  it('thinks about a stuck task', () => {
    expect(restingPose(w({ stuck: true }))).toEqual({ expression: 'thinking', body: 'think' });
  });

  it('cheers along to a song', () => {
    expect(restingPose(w({ songPlaying: true }))).toEqual({ expression: 'cheer', body: 'cheer' });
  });
});
