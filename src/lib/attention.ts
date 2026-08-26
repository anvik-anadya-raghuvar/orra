/**
 * What needs you today.
 *
 * The portal has always *shown* overdue things — a red pill on the Money
 * room, a count on a goal — but it never *told* you. Nothing reached you
 * unless you happened to open the room it lived in, which meant the visa
 * appointment and the renewal both depended on remembering to go looking.
 *
 * This gathers those into one list the bell can carry, and the same list is
 * what the morning push digest is built from (supabase/functions/push), so
 * "what needs you" has exactly one definition rather than two that drift.
 *
 * Pure, and takes `today` as an argument rather than reading the clock, so
 * the boundaries are testable and a digest generated on the server agrees
 * with the bell in the browser.
 */
import type { Dataset, UserId } from '../types';
import { daysUntil } from './dates';
import { isAssignedTo } from './taskFacets';

export type AttentionSection = 'tasks' | 'dates' | 'money';

export interface AttentionItem {
  /**
   * Stable within a day and different across days: the date is part of the
   * id, so "not today" dismissals expire by themselves at midnight instead
   * of needing anything to clear them.
   */
  id: string;
  section: AttentionSection;
  label: string;
  sub: string;
  route: string;
  /** Sorts first and colours the row. */
  urgent: boolean;
}

/** How far ahead a fixed date starts asking for attention. */
const DATE_HORIZON_DAYS = 7;
/** Renewals are shorter — a week of daily nagging about one is noise. */
const RENEWAL_HORIZON_DAYS = 3;

function dueLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days}d`;
}

export function attentionItems(ds: Dataset, meId: UserId, today: string): AttentionItem[] {
  const items: AttentionItem[] = [];

  // ── Work assigned to me that is due ──────────────────────────────────
  for (const task of ds.tasks) {
    if (!isAssignedTo(task, meId)) continue;
    if (task.status === 'done') continue;
    if (!task.due_date) continue;
    const days = daysUntil(task.due_date, today);
    if (days > 0) continue;
    items.push({
      id: `task-due:${task.id}:${today}`,
      section: 'tasks',
      label: task.title,
      sub: `${task.id} · ${dueLabel(days)}`,
      route: `/task/${task.id}`,
      urgent: days < 0,
    });
  }

  // ── Fixed dates coming up ────────────────────────────────────────────
  // Mine or shared. The other person's appointments are theirs to be
  // reminded about (principle 1).
  for (const fixed of ds.fixed_dates) {
    if (fixed.owner_id && fixed.owner_id !== meId) continue;
    const days = daysUntil(fixed.date, today);
    if (days < 0 || days > DATE_HORIZON_DAYS) continue;
    items.push({
      id: `fixed-date:${fixed.id}:${today}`,
      section: 'dates',
      label: fixed.label,
      sub: `${fixed.category ? `${fixed.category} · ` : ''}${dueLabel(days)}`,
      route: '/personal',
      urgent: days <= 1,
    });
  }

  // ── Money owed, and renewals about to bite ───────────────────────────
  for (const entry of ds.ledger) {
    if (entry.status !== 'due' && entry.status !== 'overdue') continue;
    const days = daysUntil(entry.date, today);
    // A row still marked 'due' whose date has passed is late, whatever the
    // stored status says — "due 12d overdue" is not a sentence.
    const late = entry.status === 'overdue' || days < 0;
    items.push({
      id: `ledger:${entry.id}:${today}`,
      section: 'money',
      label: `${entry.party} — ${entry.category}`,
      sub: late
        ? `${entry.amount} · ${days < 0 ? `${Math.abs(days)}d overdue` : 'overdue'}`
        : `${entry.amount} · due ${dueLabel(days)}`,
      route: '/money',
      urgent: late,
    });
  }

  for (const sub of ds.subscriptions) {
    if (!sub.is_active || !sub.ends_on) continue;
    const days = daysUntil(sub.ends_on, today);
    if (days < 0 || days > RENEWAL_HORIZON_DAYS) continue;
    items.push({
      id: `renewal:${sub.id}:${today}`,
      section: 'money',
      label: `${sub.name} renews`,
      sub: `${sub.amount} ${sub.currency} · ${dueLabel(days)}`,
      route: '/money',
      urgent: days <= 1,
    });
  }

  // Urgent first, then by section so the panel reads in a stable order.
  const order: AttentionSection[] = ['tasks', 'dates', 'money'];
  return items.sort(
    (a, b) =>
      Number(b.urgent) - Number(a.urgent) ||
      order.indexOf(a.section) - order.indexOf(b.section) ||
      a.label.localeCompare(b.label),
  );
}

/** One line for a push notification or a bell summary. */
export function attentionSummary(items: AttentionItem[]): string {
  if (!items.length) return 'Nothing needs you today.';
  const counts = { tasks: 0, dates: 0, money: 0 };
  items.forEach((item) => {
    counts[item.section] += 1;
  });
  const parts: string[] = [];
  if (counts.tasks) parts.push(`${counts.tasks} task${counts.tasks === 1 ? '' : 's'} due`);
  if (counts.dates) parts.push(`${counts.dates} date${counts.dates === 1 ? '' : 's'} coming up`);
  if (counts.money) parts.push(`${counts.money} money item${counts.money === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
