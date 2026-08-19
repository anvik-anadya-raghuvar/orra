/**
 * The Tracker's arithmetic — pure, so the summary, the charts and the export
 * can never disagree about the same range.
 *
 * Deliberately absent: anything that computes what one of you owes the other.
 * `split_pct` records that an expense was shared; turning that into a debt is
 * a different product and not this one.
 */
import type { Dataset, LedgerEntry, Subscription } from '../types';

export type RangeKey = 'month' | 'quarter' | 'year' | 'all' | 'custom';

export const RANGE_LABEL: Record<RangeKey, string> = {
  month: 'This month',
  quarter: 'Last 3 months',
  year: 'This year',
  all: 'All time',
  custom: 'Custom',
};

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** First and last day of a named range, in local dates. */
export function rangeBounds(key: RangeKey, todayIso: string): { from: string; to: string } {
  const today = new Date(`${todayIso}T00:00:00`);
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (key) {
    case 'month':
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'quarter':
      return { from: iso(new Date(y, m - 2, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'year':
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    default:
      return { from: '0000-01-01', to: '9999-12-31' };
  }
}

export function inRange(e: LedgerEntry, from: string, to: string): boolean {
  return e.date >= from && e.date <= to;
}

export interface CashSummary {
  in: number;
  out: number;
  net: number;
  count: number;
}

export function summarise(entries: LedgerEntry[]): CashSummary {
  let cashIn = 0;
  let cashOut = 0;
  for (const e of entries) {
    if (e.direction === 'in') cashIn += e.amount;
    else cashOut += e.amount;
  }
  return { in: cashIn, out: cashOut, net: cashIn - cashOut, count: entries.length };
}

/** Spend per calendar month, oldest first — the "what do we burn" chart. */
export function monthlySpend(entries: LedgerEntry[]): { label: string; value: number }[] {
  const byMonth = new Map<string, number>();
  for (const e of entries) {
    if (e.direction !== 'out') continue;
    const key = e.date.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + e.amount);
  }
  return [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => ({
      label: new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(
        new Date(`${key}-01T00:00:00`),
      ),
      value,
    }));
}

/** The biggest single expenses — usually the answer to "where did it go". */
export function topExpenses(entries: LedgerEntry[], n = 5): LedgerEntry[] {
  return entries
    .filter((e) => e.direction === 'out')
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n);
}

/**
 * One-off versus recurring spend. Rows that were never categorised count as
 * one-off rather than being dropped, so the two bars always sum to total spend
 * and the chart cannot quietly under-report.
 */
export function spendShape(entries: LedgerEntry[]): { oneTime: number; recurring: number } {
  let oneTime = 0;
  let recurring = 0;
  for (const e of entries) {
    if (e.direction !== 'out') continue;
    if (e.expense_kind === 'recurring') recurring += e.amount;
    else oneTime += e.amount;
  }
  return { oneTime, recurring };
}

/* ── Subscriptions ─────────────────────────────────────────────────────── */

/** Active subscriptions, soonest renewal first; undated ones last. */
export function upcomingSubscriptions(ds: Dataset): Subscription[] {
  return ds.subscriptions
    .filter((s) => s.is_active)
    .sort((a, b) => (a.ends_on ?? '9999').localeCompare(b.ends_on ?? '9999'));
}

/** The one to warn about, if any is close enough to matter. */
export function soonestSubscription(ds: Dataset): Subscription | null {
  return upcomingSubscriptions(ds).find((s) => s.ends_on) ?? null;
}

/** What the actives cost per month, annual plans amortised. */
export function monthlyRunRate(ds: Dataset): number {
  return upcomingSubscriptions(ds).reduce((sum, s) => {
    if (s.billing_cycle === 'monthly') return sum + s.amount;
    if (s.billing_cycle === 'yearly') return sum + s.amount / 12;
    return sum; // a one-off is not a run rate
  }, 0);
}

/** The date a renewal moves to once it is paid. */
export function nextRenewal(sub: Subscription): string | null {
  if (!sub.ends_on || sub.billing_cycle === 'one_off') return sub.ends_on;
  const d = new Date(`${sub.ends_on}T00:00:00`);
  if (sub.billing_cycle === 'monthly') d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return iso(d);
}
