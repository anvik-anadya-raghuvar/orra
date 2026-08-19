import { describe, expect, it } from 'vitest';
import type { ActiveBlock, Dataset } from '../types';
import {
  blockLines,
  clockLabel,
  elapsedSec,
  loggedMinutes,
  logKind,
  newBlockRow,
  resumePatch,
  targetPct,
  targetReached,
} from './blocks';

const ME = 'u-anadya';
const at = (iso: string) => new Date(iso);

const block = (p: Partial<ActiveBlock> = {}): ActiveBlock => ({
  id: 'ab-1',
  user_id: ME,
  scope: 'founder',
  focus_task_id: null,
  course_id: null,
  started_at: '2026-08-19T09:00:00.000Z',
  paused_at: null,
  paused_total_sec: 0,
  target_minutes: 50,
  ...p,
});

describe('elapsed time is derived, not counted', () => {
  it('is wall clock since the block started', () => {
    expect(elapsedSec(block(), at('2026-08-19T09:20:00.000Z'))).toBe(20 * 60);
  });

  it('survives a reload — the same instant gives the same answer', () => {
    // this is the whole point: the browser holds no counter to lose
    const b = block();
    const t = at('2026-08-19T09:37:30.000Z');
    expect(elapsedSec(b, t)).toBe(elapsedSec({ ...b }, t));
    expect(elapsedSec(b, t)).toBe(37 * 60 + 30);
  });

  it('excludes time spent paused', () => {
    const b = block({ paused_total_sec: 300 });
    expect(elapsedSec(b, at('2026-08-19T09:20:00.000Z'))).toBe(20 * 60 - 300);
  });

  it('freezes while paused, however long the tab stays open', () => {
    const b = block({ paused_at: '2026-08-19T09:10:00.000Z' });
    expect(elapsedSec(b, at('2026-08-19T09:10:00.000Z'))).toBe(600);
    expect(elapsedSec(b, at('2026-08-19T11:00:00.000Z'))).toBe(600);
  });

  it('never goes negative if the clock jumps backwards', () => {
    expect(elapsedSec(block(), at('2026-08-19T08:00:00.000Z'))).toBe(0);
  });
});

describe('resuming folds the pause into the total', () => {
  it('adds the paused stretch and clears the marker', () => {
    const b = block({ paused_at: '2026-08-19T09:10:00.000Z' });
    const patch = resumePatch(b, at('2026-08-19T09:15:00.000Z'));
    expect(patch).toEqual({ paused_at: null, paused_total_sec: 300 });
  });

  it('does nothing to a block that is already running', () => {
    expect(resumePatch(block())).toEqual({});
  });

  it('keeps elapsed time continuous across a pause and resume', () => {
    const paused = block({ paused_at: '2026-08-19T09:10:00.000Z' });
    const resumed = { ...paused, ...resumePatch(paused, at('2026-08-19T09:40:00.000Z')) };
    // ran 10 minutes, idled 30, so a minute later it should read 11 minutes
    expect(elapsedSec(resumed, at('2026-08-19T09:41:00.000Z'))).toBe(11 * 60);
  });
});

describe('what gets logged', () => {
  it('rounds to the nearest minute', () => {
    expect(loggedMinutes(block(), at('2026-08-19T09:25:40.000Z'))).toBe(26);
  });

  it('logs at least a minute, so a short block is never lost', () => {
    expect(loggedMinutes(block(), at('2026-08-19T09:00:04.000Z'))).toBe(1);
  });

  it('keeps personal hours out of the founder tally', () => {
    // the split bar referees study against founder; an errand is neither
    expect(logKind('personal')).toBe('personal');
    expect(logKind('study')).toBe('study');
    expect(logKind('founder')).toBe('founder');
    expect(logKind('today_plan')).toBe('founder');
    expect(logKind('intentions')).toBe('founder');
    expect(logKind('custom', 'study')).toBe('study');
  });
});

describe('the clock face', () => {
  it('reads MM:SS', () => {
    expect(clockLabel(0)).toBe('00:00');
    expect(clockLabel(75)).toBe('01:15');
  });

  it('grows an hours field only when there are hours', () => {
    expect(clockLabel(59 * 60 + 59)).toBe('59:59');
    expect(clockLabel(3661)).toBe('1:01:01');
  });
});

describe('targets', () => {
  it('reports progress towards a founder block', () => {
    expect(targetPct(block(), at('2026-08-19T09:25:00.000Z'))).toBe(50);
  });

  it('caps at 100 rather than running past it', () => {
    expect(targetPct(block(), at('2026-08-19T11:00:00.000Z'))).toBe(100);
    expect(targetReached(block(), at('2026-08-19T09:50:00.000Z'))).toBe(true);
  });

  it('has none for an open-ended block', () => {
    const open = block({ scope: 'study', target_minutes: null });
    expect(targetPct(open, at('2026-08-19T12:00:00.000Z'))).toBeNull();
    expect(targetReached(open, at('2026-08-19T12:00:00.000Z'))).toBe(false);
  });

  it('gives a founder block a target and everything else none', () => {
    expect(newBlockRow({ id: 'a', userId: ME, scope: 'founder' }).target_minutes).toBe(50);
    expect(newBlockRow({ id: 'a', userId: ME, scope: 'study' }).target_minutes).toBeNull();
    expect(newBlockRow({ id: 'a', userId: ME, scope: 'personal' }).target_minutes).toBeNull();
    expect(newBlockRow({ id: 'a', userId: ME, scope: 'custom', targetMinutes: 35 }).target_minutes).toBe(35);
  });
});

describe('the list inside a block is derived from its scope', () => {
  const ds = {
    projects: [
      { id: 'anvik', is_personal: false },
      { id: 'personal', is_personal: true },
    ],
    tasks: [
      { id: 'T-1', title: 'Ship export', project_id: 'anvik', status: 'todo', assignee_id: ME, created_by: ME },
      { id: 'T-2', title: 'Visa slot', project_id: 'personal', status: 'todo', assignee_id: ME, created_by: ME },
      { id: 'T-3', title: 'Done thing', project_id: 'anvik', status: 'done', assignee_id: ME, created_by: ME },
      { id: 'T-4', title: 'Theirs', project_id: 'anvik', status: 'todo', assignee_id: 'u-raghuvar', created_by: 'u-raghuvar' },
    ],
    courses: [{ id: 'c-1', owner_id: ME }],
    course_items: [
      { id: 'ci-1', course_id: 'c-1', title: 'Read chapter 3', completed: false, position: 1 },
      { id: 'ci-2', course_id: 'c-1', title: 'Finished one', completed: true, position: 2 },
    ],
    day_plan_items: [
      { id: 'dpi-1', user_id: ME, date: '2026-08-19', task_id: 'T-1', text: 'Ship export', done: false, position: 1, source: 'planner', created_at: '' },
      { id: 'dpi-2', user_id: ME, date: '2026-08-19', task_id: null, text: 'Call the consulate', done: false, position: 2, source: 'manual', created_at: '' },
    ],
  } as unknown as Dataset;

  it('gives a founder block my open business work only', () => {
    const lines = blockLines(ds, block({ scope: 'founder' }), '2026-08-19');
    expect(lines.map((l) => l.label)).toEqual(['Ship export']);
  });

  it('gives a personal block my personal-project work', () => {
    const lines = blockLines(ds, block({ scope: 'personal' }), '2026-08-19');
    expect(lines.map((l) => l.label)).toEqual(['Visa slot']);
  });

  it('gives a study block the unfinished course items', () => {
    const lines = blockLines(ds, block({ scope: 'study' }), '2026-08-19');
    expect(lines.map((l) => l.label)).toEqual(['Read chapter 3']);
  });

  it('gives a plan block only what was saved as the plan', () => {
    const lines = blockLines(ds, block({ scope: 'today_plan' }), '2026-08-19');
    expect(lines.map((l) => l.label)).toEqual(['Ship export']);
  });

  it('gives an intentions block the whole list, typed lines included', () => {
    const lines = blockLines(ds, block({ scope: 'intentions' }), '2026-08-19');
    expect(lines.map((l) => l.label)).toEqual(['Ship export', 'Call the consulate']);
  });

  it('never shows the other person work', () => {
    const all = (['founder', 'personal', 'study', 'today_plan', 'intentions'] as const).flatMap(
      (scope) => blockLines(ds, block({ scope }), '2026-08-19'),
    );
    expect(all.some((l) => l.label === 'Theirs')).toBe(false);
  });

  it('keeps a custom block checklist exactly as scribbled', () => {
    const lines = blockLines(
      ds,
      block({
        scope: 'custom',
        custom_items: [
          { id: 'one', text: 'Draft it', done: true },
          { id: 'two', text: 'Send it', done: false },
        ],
      }),
      '2026-08-19',
    );
    expect(lines).toEqual([
      { id: 'one', customItemId: 'one', label: 'Draft it', done: true },
      { id: 'two', customItemId: 'two', label: 'Send it', done: false },
    ]);
  });
});
