/** Contact timeline — merges every trace of a relationship into one stream.
 *  Pure functions only; no store access, so the profile modal and the
 *  cadence heat strip can share the same data. */
import type { Dataset, Person } from '../../types';
import { inr } from '../../lib/dates';
import type { Warmth } from '../../lib/warmth';
import { stripInlineImageMarkers } from '../../ui/inlineImages';

export type TimelineType = 'interaction' | 'note' | 'task' | 'ledger' | 'mail';

export interface TimelineEntry {
  id: string;
  type: TimelineType;
  /** ISO date or date-time — used for sorting and the heat strip buckets. */
  date: string;
  summary: string;
  meta?: string;
  href?: string;
  external?: boolean;
  /** Only set for type === 'interaction' — lets the UI offer edit/delete. */
  interactionId?: string;
}

export const TYPE_META: Record<TimelineType, { label: string; color: string }> = {
  interaction: { label: 'Touch', color: 'indigo' },
  note: { label: 'Note', color: 'violet' },
  task: { label: 'Task', color: 'teal' },
  ledger: { label: 'Ledger', color: 'stamp' },
  mail: { label: 'Mail', color: 'sky' },
};

export type Channel = 'call' | 'mail' | 'message' | 'meeting' | 'in_person';
export const CHANNELS: { key: Channel; label: string }[] = [
  { key: 'call', label: 'Call' },
  { key: 'mail', label: 'Mail' },
  { key: 'message', label: 'Message' },
  { key: 'meeting', label: 'Meeting' },
  { key: 'in_person', label: 'In person' },
];
export const channelLabel = (c: Channel) => CHANNELS.find((x) => x.key === c)?.label ?? c;

function mentions(haystack: string | null | undefined, name: string): boolean {
  if (!haystack || !name) return false;
  return haystack.toLowerCase().includes(name.toLowerCase());
}

function partyMatches(party: string | null | undefined, name: string): boolean {
  if (!party || !name) return false;
  const p = party.trim().toLowerCase();
  const n = name.trim().toLowerCase();
  if (!p || !n) return false;
  return p === n || p.includes(n) || n.includes(p);
}

/** Every trace of `person` across the dataset, newest first. */
export function buildTimeline(person: Person, ds: Dataset): TimelineEntry[] {
  const name = person.name.trim();
  if (!name) return [];
  const entries: TimelineEntry[] = [];

  for (const h of ds.people_interactions) {
    if (h.person_id !== person.id) continue;
    entries.push({
      id: `pi-${h.id}`,
      type: 'interaction',
      date: h.occurred_on,
      summary: h.summary,
      interactionId: h.id,
    });
  }

  for (const n of ds.notes) {
    if (!mentions(n.title, name) && !mentions(n.body, name)) continue;
    entries.push({
      id: `note-${n.id}`,
      type: 'note',
      date: n.created_at,
      summary: n.title || stripInlineImageMarkers(n.body).slice(0, 90),
      meta: n.type,
      href: '/knowledge',
    });
  }

  for (const t of ds.tasks) {
    if (!mentions(t.title, name) && !mentions(t.description, name)) continue;
    entries.push({
      id: `task-${t.id}`,
      type: 'task',
      date: t.updated_at || t.created_at,
      summary: `${t.id} · ${t.title}`,
      meta: t.status.replace('_', ' '),
      href: `/task/${t.id}`,
    });
  }

  for (const l of ds.ledger) {
    if (!partyMatches(l.party, name)) continue;
    entries.push({
      id: `ledger-${l.id}`,
      type: 'ledger',
      date: l.date,
      summary: `${l.direction === 'in' ? 'Received' : 'Paid'} ${inr(l.amount)} — ${l.category}`,
      meta: l.status,
      href: '/money',
    });
  }

  for (const m of ds.mail_items) {
    if (!mentions(m.sender, name)) continue;
    entries.push({
      id: `mail-${m.id}`,
      type: 'mail',
      date: m.received_at,
      summary: m.subject,
      meta: m.sender,
      href: m.gmail_link,
      external: true,
    });
  }

  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

/** ~`weeks` rolling 7-day buckets ending today, oldest first, for the HeatStrip. */
export function weeklyActivity(
  entries: TimelineEntry[],
  todayIso: string,
  weeks = 12,
): { label: string; value: number }[] {
  const DAY = 86_400_000;
  const todayMs = new Date(todayIso + 'T00:00:00Z').getTime();
  const cells: { label: string; value: number }[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const end = todayMs - w * 7 * DAY;
    const start = end - 6 * DAY;
    const count = entries.reduce((acc, e) => {
      const t = new Date(e.date.slice(0, 10) + 'T00:00:00Z').getTime();
      return t >= start && t <= end ? acc + 1 : acc;
    }, 0);
    const startLabel = new Date(start).toISOString().slice(5, 10);
    const endLabel = new Date(end).toISOString().slice(5, 10);
    cells.push({ label: `${startLabel} – ${endLabel}`, value: count });
  }
  return cells;
}

/** The pre-filled nudge text — one source of truth for the card and the profile modal. */
export function nudgeMessage(person: Person, w: Warmth): string {
  if (w.daysSince === null) {
    return `Hey — I still haven't logged a first touch with ${person.name}. ${person.next_action || 'Time to reach out.'}`;
  }
  return `Hey — it's been ${w.daysSince}d since we last connected with ${person.name} (cadence is every ${person.cadence_days}d). ${person.next_action || "Let's close the loop."}`;
}

/** Recompute last_contact_date from whatever interactions remain for a person. */
export function recomputeLastContact(
  interactions: { person_id: string; occurred_on: string }[],
  personId: string,
): string | null {
  const dates = interactions.filter((i) => i.person_id === personId).map((i) => i.occurred_on);
  return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
}
