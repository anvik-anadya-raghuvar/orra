import type { Capacity, Dataset, DayPlan, UserId, WinCondition } from '../types';

/** Today's plan for a user, or a sensible default if they haven't set one. */
export function planFor(ds: Dataset, userId: UserId, dateIso: string): DayPlan | null {
  return ds.day_plans.find((p) => p.user_id === userId && p.date === dateIso) ?? null;
}

export const DEFAULT_WINS: WinCondition[] = [
  { text: 'Close one production-critical loop', done: false },
  { text: 'Give the other one a clean unblock', done: false },
  { text: 'Leave tomorrow with less ambiguity', done: false },
];

export function capacityOf(ds: Dataset, userId: UserId, dateIso: string): Capacity {
  return planFor(ds, userId, dateIso)?.capacity ?? 'medium';
}

export const CAPACITY_COPY: Record<Capacity, { label: string; blurb: string }> = {
  light: { label: 'Light', blurb: 'Small, closable things. Protect the rest.' },
  medium: { label: 'Steady', blurb: 'A normal day. One deep block, then admin.' },
  heavy: { label: 'Heavy', blurb: 'Deep work. Guard the calendar ruthlessly.' },
};

/** Events for a user on a date — theirs plus shared ones — sorted by start. */
export function eventsFor(ds: Dataset, userId: UserId, dateIso: string) {
  return ds.day_events
    .filter((e) => e.date === dateIso && (e.user_id === userId || e.user_id === null))
    .sort((a, b) => a.start_min - b.start_min);
}

export const minToLabel = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
