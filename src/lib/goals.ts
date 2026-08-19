/**
 * Personal goals — the half of a personal life that is not coursework.
 *
 * Progress is derived rather than typed. A goal linked to a project reads the
 * share of its tasks you have closed; one linked to a course reads that
 * course's completion; anything else counts its own milestones. A number you
 * have to remember to update is a number that goes stale, and a stale goal is
 * worse than no goal.
 */
import type { Dataset, PersonalGoal, UserId } from '../types';
import { myTasks } from './workspace';

export interface GoalProgress {
  pct: number;
  /** Where the number came from, so the UI can say so rather than assert it. */
  basis: 'project' | 'course' | 'milestones' | 'none';
  done: number;
  total: number;
}

/** My goals, open ones first, in display order. */
export function goalsFor(ds: Dataset, userId: UserId): PersonalGoal[] {
  return ds.personal_goals
    .filter((g) => g.user_id === userId)
    .sort(
      (a, b) =>
        Number(a.status !== 'open') - Number(b.status !== 'open') ||
        a.position - b.position ||
        a.created_at.localeCompare(b.created_at),
    );
}

export function goalProgress(ds: Dataset, goal: PersonalGoal): GoalProgress {
  if (goal.status === 'done') return { pct: 100, basis: 'none', done: 0, total: 0 };

  if (goal.linked_project_id) {
    const mine = myTasks(ds.tasks, goal.user_id).filter(
      (t) => t.project_id === goal.linked_project_id,
    );
    const done = mine.filter((t) => t.status === 'done').length;
    return {
      pct: mine.length ? Math.round((done / mine.length) * 100) : 0,
      basis: 'project',
      done,
      total: mine.length,
    };
  }

  if (goal.linked_course_id) {
    const items = ds.course_items.filter((i) => i.course_id === goal.linked_course_id);
    const done = items.filter((i) => i.completed).length;
    return {
      pct: items.length ? Math.round((done / items.length) * 100) : 0,
      basis: 'course',
      done,
      total: items.length,
    };
  }

  const done = goal.milestones.filter((m) => m.done).length;
  return {
    pct: goal.milestones.length ? Math.round((done / goal.milestones.length) * 100) : 0,
    basis: goal.milestones.length ? 'milestones' : 'none',
    done,
    total: goal.milestones.length,
  };
}

/** Plain-language source line, so the ring is never an unexplained number. */
export function progressLabel(p: GoalProgress): string {
  switch (p.basis) {
    case 'project':
      return `${p.done} of ${p.total} tasks closed`;
    case 'course':
      return `${p.done} of ${p.total} course items done`;
    case 'milestones':
      return `${p.done} of ${p.total} milestones`;
    default:
      return 'No milestones yet';
  }
}

/** Goals with a date, for the countdown widget — soonest first. */
export function datedGoals(ds: Dataset, userId: UserId): PersonalGoal[] {
  return goalsFor(ds, userId)
    .filter((g) => g.status === 'open' && g.target_date)
    .sort((a, b) => (a.target_date ?? '').localeCompare(b.target_date ?? ''));
}

export function nextGoalPosition(goals: PersonalGoal[]): number {
  return goals.reduce((max, g) => Math.max(max, g.position), 0) + 1;
}
