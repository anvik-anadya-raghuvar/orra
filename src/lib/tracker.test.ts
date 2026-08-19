import { describe, expect, it } from 'vitest';
import type { Dataset, LedgerEntry, Subscription } from '../types';
import {
  inRange,
  monthlyRunRate,
  monthlySpend,
  nextRenewal,
  rangeBounds,
  soonestSubscription,
  spendShape,
  summarise,
  topExpenses,
  upcomingSubscriptions,
} from './tracker';

const TODAY = '2026-08-19';

const entry = (p: Partial<LedgerEntry>): LedgerEntry =>
  ({
    id: 'l-1',
    date: TODAY,
    party: 'Someone',
    category: '',
    project_id: 'anvik',
    direction: 'out',
    amount: 100,
    status: 'paid',
    receipt_url: null,
    linked_task_id: null,
    import_batch_id: null,
    ...p,
  }) as LedgerEntry;

const sub = (p: Partial<Subscription>): Subscription => ({
  id: 's-1',
  name: 'Thing',
  amount: 1000,
  currency: 'INR',
  billing_cycle: 'monthly',
  ends_on: '2026-09-01',
  url: null,
  project_id: null,
  paid_by: null,
  is_active: true,
  notes: '',
  created_at: '2026-01-01T00:00:00Z',
  ...p,
});

describe('ranges', () => {
  it('bounds this month', () => {
    expect(rangeBounds('month', TODAY)).toEqual({ from: '2026-08-01', to: '2026-08-31' });
  });

  it('bounds the last three months inclusive of this one', () => {
    expect(rangeBounds('quarter', TODAY)).toEqual({ from: '2026-06-01', to: '2026-08-31' });
  });

  it('handles a quarter that crosses new year', () => {
    expect(rangeBounds('quarter', '2027-01-15')).toEqual({ from: '2026-11-01', to: '2027-01-31' });
  });

  it('bounds this year, and all time', () => {
    expect(rangeBounds('year', TODAY)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(inRange(entry({ date: '1999-05-05' }), ...Object.values(rangeBounds('all', TODAY)) as [string, string])).toBe(true);
  });

  it('includes both endpoints', () => {
    expect(inRange(entry({ date: '2026-08-01' }), '2026-08-01', '2026-08-31')).toBe(true);
    expect(inRange(entry({ date: '2026-08-31' }), '2026-08-01', '2026-08-31')).toBe(true);
    expect(inRange(entry({ date: '2026-09-01' }), '2026-08-01', '2026-08-31')).toBe(false);
  });
});

describe('cash in, cash out, net', () => {
  it('sums each direction and nets them', () => {
    const s = summarise([
      entry({ direction: 'in', amount: 86000 }),
      entry({ direction: 'out', amount: 34200 }),
      entry({ direction: 'out', amount: 12800 }),
    ]);
    expect(s).toEqual({ in: 86000, out: 47000, net: 39000, count: 3 });
  });

  it('reports a negative net rather than hiding it', () => {
    expect(summarise([entry({ direction: 'out', amount: 500 })]).net).toBe(-500);
  });

  it('is zero for an empty range, not NaN', () => {
    expect(summarise([])).toEqual({ in: 0, out: 0, net: 0, count: 0 });
  });
});

describe('spend charts', () => {
  const rows = [
    entry({ date: '2026-07-04', amount: 300 }),
    entry({ date: '2026-08-02', amount: 200 }),
    entry({ date: '2026-08-20', amount: 100 }),
    entry({ date: '2026-08-21', direction: 'in', amount: 9999 }),
  ];

  it('groups spend by month, oldest first, ignoring income', () => {
    expect(monthlySpend(rows)).toEqual([
      { label: 'Jul', value: 300 },
      { label: 'Aug', value: 300 },
    ]);
  });

  it('ranks the biggest expenses', () => {
    expect(topExpenses(rows, 2).map((e) => e.amount)).toEqual([300, 200]);
  });

  it('counts uncategorised spend as one-off so the split always sums to total', () => {
    const shape = spendShape([
      entry({ amount: 100, expense_kind: 'recurring' }),
      entry({ amount: 50, expense_kind: 'one_time' }),
      entry({ amount: 25 }), // never categorised
      entry({ direction: 'in', amount: 999 }),
    ]);
    expect(shape).toEqual({ oneTime: 75, recurring: 100 });
    expect(shape.oneTime + shape.recurring).toBe(175);
  });
});

describe('subscriptions', () => {
  const ds = (subs: Subscription[]) => ({ subscriptions: subs }) as Dataset;

  it('lists actives by soonest renewal, undated last', () => {
    const list = upcomingSubscriptions(
      ds([
        sub({ id: 'later', ends_on: '2026-12-01' }),
        sub({ id: 'undated', ends_on: null }),
        sub({ id: 'soon', ends_on: '2026-08-24' }),
        sub({ id: 'cancelled', ends_on: '2026-08-20', is_active: false }),
      ]),
    );
    expect(list.map((s) => s.id)).toEqual(['soon', 'later', 'undated']);
  });

  it('warns about the soonest dated one', () => {
    expect(soonestSubscription(ds([sub({ id: 'a', ends_on: '2026-08-24' })]))?.id).toBe('a');
    expect(soonestSubscription(ds([sub({ ends_on: null })]))).toBeNull();
  });

  it('amortises a yearly plan into the monthly run rate', () => {
    const rate = monthlyRunRate(ds([sub({ amount: 1700 }), sub({ amount: 12000, billing_cycle: 'yearly' })]));
    expect(rate).toBe(1700 + 1000);
  });

  it('does not count a one-off as a run rate', () => {
    expect(monthlyRunRate(ds([sub({ amount: 5000, billing_cycle: 'one_off' })]))).toBe(0);
  });

  it('rolls a renewal forward by its own cycle', () => {
    expect(nextRenewal(sub({ ends_on: '2026-08-24' }))).toBe('2026-09-24');
    expect(nextRenewal(sub({ ends_on: '2027-02-01', billing_cycle: 'yearly' }))).toBe('2028-02-01');
    expect(nextRenewal(sub({ ends_on: '2026-08-24', billing_cycle: 'one_off' }))).toBe('2026-08-24');
  });

  it('rolls a month-end renewal without inventing a date', () => {
    // 31 Jan + 1 month has no 31 Feb; JS lands it in March, which is honest
    expect(nextRenewal(sub({ ends_on: '2026-01-31' }))).toBe('2026-03-03');
  });
});
