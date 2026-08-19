import { describe, expect, it } from 'vitest';
import type { Dataset, PersonalGoal } from '../types';
import { datedGoals, goalProgress, goalsFor, nextGoalPosition, progressLabel } from './goals';

const ME = 'u-anadya';

const goal = (p: Partial<PersonalGoal>): PersonalGoal => ({
  id: 'g-1',
  user_id: ME,
  title: 'A goal',
  notes: '',
  target_date: null,
  linked_project_id: null,
  linked_course_id: null,
  milestones: [],
  status: 'open',
  position: 1,
  created_at: '2026-08-01T09:00:00Z',
  ...p,
});

const ds = {
  tasks: [
    { id: 'T-1', project_id: 'con', status: 'done', assignee_id: ME, created_by: ME },
    { id: 'T-2', project_id: 'con', status: 'todo', assignee_id: ME, created_by: ME },
    { id: 'T-3', project_id: 'con', status: 'todo', assignee_id: 'u-raghuvar', created_by: 'u-raghuvar' },
    { id: 'T-4', project_id: 'anvik', status: 'done', assignee_id: ME, created_by: ME },
  ],
  course_items: [
    { id: 'ci-1', course_id: 'c-1', completed: true },
    { id: 'ci-2', course_id: 'c-1', completed: false },
    { id: 'ci-3', course_id: 'c-1', completed: false },
    { id: 'ci-4', course_id: 'c-2', completed: true },
  ],
  personal_goals: [],
} as unknown as Dataset;

describe('progress is derived, never typed', () => {
  it('reads a linked project as the share of my tasks closed', () => {
    const p = goalProgress(ds, goal({ linked_project_id: 'con' }));
    // T-3 is the other person's, so it is not part of my goal
    expect(p).toMatchObject({ pct: 50, basis: 'project', done: 1, total: 2 });
  });

  it('reads a linked course as its completion', () => {
    const p = goalProgress(ds, goal({ linked_course_id: 'c-1' }));
    expect(p).toMatchObject({ pct: 33, basis: 'course', done: 1, total: 3 });
  });

  it('falls back to milestones when nothing is linked', () => {
    const p = goalProgress(
      ds,
      goal({ milestones: [{ text: 'a', done: true }, { text: 'b', done: false }] }),
    );
    expect(p).toMatchObject({ pct: 50, basis: 'milestones', done: 1, total: 2 });
  });

  it('is honest about a goal with nothing to measure', () => {
    const p = goalProgress(ds, goal({}));
    expect(p).toMatchObject({ pct: 0, basis: 'none' });
    expect(progressLabel(p)).toBe('No milestones yet');
  });

  it('is complete once the goal is closed, whatever it was linked to', () => {
    expect(goalProgress(ds, goal({ status: 'done', linked_project_id: 'con' })).pct).toBe(100);
  });

  it('does not divide by zero on an empty project', () => {
    expect(goalProgress(ds, goal({ linked_project_id: 'nothing-here' })).pct).toBe(0);
  });

  it('explains where the number came from', () => {
    expect(progressLabel(goalProgress(ds, goal({ linked_project_id: 'con' })))).toBe(
      '1 of 2 tasks closed',
    );
  });
});

describe('the goal list', () => {
  const withGoals = (goals: PersonalGoal[]) => ({ ...ds, personal_goals: goals }) as Dataset;

  it('is mine only, open ones first', () => {
    const list = goalsFor(
      withGoals([
        goal({ id: 'closed', status: 'done', position: 1 }),
        goal({ id: 'mine', position: 2 }),
        goal({ id: 'theirs', user_id: 'u-raghuvar', position: 3 }),
      ]),
      ME,
    );
    expect(list.map((g) => g.id)).toEqual(['mine', 'closed']);
  });

  it('surfaces dated open goals soonest first', () => {
    const list = datedGoals(
      withGoals([
        goal({ id: 'later', target_date: '2026-12-01' }),
        goal({ id: 'sooner', target_date: '2026-09-01' }),
        goal({ id: 'undated' }),
        goal({ id: 'done-but-dated', status: 'done', target_date: '2026-08-20' }),
      ]),
      ME,
    );
    expect(list.map((g) => g.id)).toEqual(['sooner', 'later']);
  });

  it('adds a new goal at the bottom', () => {
    expect(nextGoalPosition([goal({ position: 3 }), goal({ position: 7 })])).toBe(8);
    expect(nextGoalPosition([])).toBe(1);
  });
});
