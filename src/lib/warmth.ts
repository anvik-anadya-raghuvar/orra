import type { Person } from '../types';

export interface Warmth {
  /** 0–1 — how much of the cadence window is left (1 = just talked). */
  level: number;
  daysSince: number | null;
  drifting: boolean;
  color: 'teal' | 'stamp' | 'rose';
}

const DAY_MS = 86_400_000;

/** Relationship warmth from last_contact_date vs cadence_days. Pure. */
export function warmth(person: Person, todayIso: string): Warmth {
  if (!person.last_contact_date) {
    return { level: 0, daysSince: null, drifting: true, color: 'rose' };
  }
  const today = new Date(todayIso + 'T00:00:00Z').getTime();
  const last = new Date(person.last_contact_date + 'T00:00:00Z').getTime();
  const daysSince = Math.max(0, Math.round((today - last) / DAY_MS));
  const level = Math.max(0, Math.min(1, 1 - daysSince / person.cadence_days));
  const drifting = daysSince > person.cadence_days;
  const color = drifting ? 'rose' : level < 0.35 ? 'stamp' : 'teal';
  return { level, daysSince, drifting, color };
}
