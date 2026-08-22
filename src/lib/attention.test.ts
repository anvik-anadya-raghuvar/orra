import { describe, expect, it } from 'vitest';
import type { Dataset, FixedDate, LedgerEntry, Subscription, Task } from '../types';
import { seedDataset } from '../data/seed';
import { attentionItems, attentionSummary } from './attention';

const TODAY = '2026-08-22';
const ME = 'me-id';
const THEM = 'them-id';

/** An empty-enough dataset: only the collections attention reads. */
function bare(over: Partial<Dataset> = {}): Dataset {
  return {
    ...seedDataset(),
    tasks: [],
    fixed_dates: [],
    ledger: [],
    subscriptions: [],
    ...over,
  } as Dataset;
}

const task = (over: Partial<Task>): Task => ({
  ...seedDataset().tasks[0],
  id: 'T-1',
  title: 'A task',
  assignee_id: ME,
  status: 'todo',
  due_date: TODAY,
  ...over,
});

const fixed = (over: Partial<FixedDate>): FixedDate => ({
  id: 'f-1',
  label: 'Visa appointment',
  date: TODAY,
  category: 'Relocation',
  owner_id: null,
  ...over,
});

const entry = (over: Partial<LedgerEntry>): LedgerEntry => ({
  ...seedDataset().ledger[0],
  id: 'l-1',
  party: 'Landlord',
  category: 'Rent',
  amount: 1000,
  date: TODAY,
  status: 'due',
  ...over,
});

const sub = (over: Partial<Subscription>): Subscription => ({
  id: 's-1',
  name: 'Figma',
  amount: 12,
  currency: 'EUR',
  billing_cycle: 'monthly',
  ends_on: TODAY,
  url: null,
  project_id: null,
  paid_by: null,
  is_active: true,
  notes: '',
  created_at: TODAY,
  ...over,
});

describe('tasks needing attention', () => {
  it('includes my task due today and my overdue one', () => {
    const ds = bare({
      tasks: [
        task({ id: 'T-today', due_date: TODAY }),
        task({ id: 'T-late', due_date: '2026-08-19' }),
      ],
    });
    const items = attentionItems(ds, ME, TODAY);
    expect(items.map((i) => i.label)).toHaveLength(2);
    expect(items.find((i) => i.sub.includes('T-late'))?.urgent).toBe(true);
    expect(items.find((i) => i.sub.includes('T-today'))?.urgent).toBe(false);
    expect(items.find((i) => i.sub.includes('T-late'))?.sub).toContain('3d overdue');
  });

  it('leaves out work that is not mine, not due, or already done', () => {
    const ds = bare({
      tasks: [
        task({ id: 'T-theirs', assignee_id: THEM }),
        task({ id: 'T-later', due_date: '2026-09-30' }),
        task({ id: 'T-done', status: 'done' }),
        task({ id: 'T-nodate', due_date: null }),
      ],
    });
    expect(attentionItems(ds, ME, TODAY)).toEqual([]);
  });

  it('links a task straight to its own page', () => {
    const ds = bare({ tasks: [task({ id: 'T-9' })] });
    expect(attentionItems(ds, ME, TODAY)[0].route).toBe('/task/T-9');
  });
});

describe('fixed dates', () => {
  it('includes anything inside the seven-day horizon, and nothing past it', () => {
    const ds = bare({
      fixed_dates: [
        fixed({ id: 'f-today', date: TODAY }),
        fixed({ id: 'f-edge', date: '2026-08-29' }), // exactly 7 days
        fixed({ id: 'f-far', date: '2026-08-30' }), // 8 days — out
        fixed({ id: 'f-past', date: '2026-08-21' }), // yesterday — out
      ],
    });
    const ids = attentionItems(ds, ME, TODAY).map((i) => i.id);
    expect(ids.some((id) => id.includes('f-today'))).toBe(true);
    expect(ids.some((id) => id.includes('f-edge'))).toBe(true);
    expect(ids.some((id) => id.includes('f-far'))).toBe(false);
    expect(ids.some((id) => id.includes('f-past'))).toBe(false);
  });

  it('keeps the other person\'s dates out but shares unowned ones', () => {
    const ds = bare({
      fixed_dates: [fixed({ id: 'f-theirs', owner_id: THEM }), fixed({ id: 'f-shared', owner_id: null })],
    });
    const ids = attentionItems(ds, ME, TODAY).map((i) => i.id);
    expect(ids.some((id) => id.includes('f-theirs'))).toBe(false);
    expect(ids.some((id) => id.includes('f-shared'))).toBe(true);
  });
});

describe('money', () => {
  it('includes due and overdue entries but never paid ones', () => {
    const ds = bare({
      ledger: [
        entry({ id: 'l-due', status: 'due' }),
        entry({ id: 'l-over', status: 'overdue' }),
        entry({ id: 'l-paid', status: 'paid' }),
      ],
    });
    const ids = attentionItems(ds, ME, TODAY).map((i) => i.id);
    expect(ids.some((id) => id.includes('l-due'))).toBe(true);
    expect(ids.some((id) => id.includes('l-over'))).toBe(true);
    expect(ids.some((id) => id.includes('l-paid'))).toBe(false);
  });

  it('reads a passed due-date as overdue rather than "due 12d overdue"', () => {
    const ds = bare({ ledger: [entry({ id: 'l-late', status: 'due', date: '2026-08-10' })] });
    const item = attentionItems(ds, ME, TODAY)[0];
    expect(item.sub).toBe('1000 · 12d overdue');
    expect(item.urgent).toBe(true);
  });

  it('reads a future due-date as due', () => {
    const ds = bare({ ledger: [entry({ id: 'l-soon', status: 'due', date: '2026-08-25' })] });
    const item = attentionItems(ds, ME, TODAY)[0];
    expect(item.sub).toBe('1000 · due in 3d');
    expect(item.urgent).toBe(false);
  });

  it('warns about a renewal inside three days only', () => {
    const ds = bare({
      subscriptions: [
        sub({ id: 's-soon', ends_on: '2026-08-24' }), // 2 days
        sub({ id: 's-edge', ends_on: '2026-08-25' }), // 3 days
        sub({ id: 's-far', ends_on: '2026-08-26' }), // 4 days — out
        sub({ id: 's-off', ends_on: TODAY, is_active: false }),
        sub({ id: 's-nodate', ends_on: null }),
      ],
    });
    const ids = attentionItems(ds, ME, TODAY).map((i) => i.id);
    expect(ids.some((id) => id.includes('s-soon'))).toBe(true);
    expect(ids.some((id) => id.includes('s-edge'))).toBe(true);
    expect(ids.some((id) => id.includes('s-far'))).toBe(false);
    expect(ids.some((id) => id.includes('s-off'))).toBe(false);
    expect(ids.some((id) => id.includes('s-nodate'))).toBe(false);
  });
});

describe('ids and ordering', () => {
  it('carries the date so a dismissal expires by itself at midnight', () => {
    const ds = bare({ tasks: [task({ id: 'T-5' })] });
    expect(attentionItems(ds, ME, TODAY)[0].id).toBe(`task-due:T-5:${TODAY}`);
    const tomorrow = attentionItems(bare({ tasks: [task({ id: 'T-5', due_date: '2026-08-23' })] }), ME, '2026-08-23');
    expect(tomorrow[0].id).not.toBe(`task-due:T-5:${TODAY}`);
  });

  it('puts urgent things first', () => {
    const ds = bare({
      tasks: [task({ id: 'T-today', due_date: TODAY }), task({ id: 'T-late', due_date: '2026-08-01' })],
    });
    expect(attentionItems(ds, ME, TODAY)[0].urgent).toBe(true);
  });

  it('is empty when nothing needs anything', () => {
    expect(attentionItems(bare(), ME, TODAY)).toEqual([]);
  });
});

describe('attentionSummary', () => {
  it('says so plainly when there is nothing', () => {
    expect(attentionSummary([])).toBe('Nothing needs you today.');
  });

  it('counts each section and pluralises', () => {
    const ds = bare({
      tasks: [task({ id: 'T-1' }), task({ id: 'T-2' })],
      fixed_dates: [fixed({})],
    });
    expect(attentionSummary(attentionItems(ds, ME, TODAY))).toBe('2 tasks due · 1 date coming up');
  });
});
