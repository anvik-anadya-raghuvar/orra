import type { Task } from '../types';

/**
 * Single place new tasks are born. Every creation site goes through this, so
 * adding a Task field never leaves a call site silently constructing a
 * half-built row.
 */
export function makeTask(partial: Partial<Task> & Pick<Task, 'id' | 'title' | 'project_id' | 'created_by'>): Task {
  const now = new Date().toISOString();
  return {
    description: '',
    acceptance_criteria: '',
    type: 'ops',
    status: 'todo',
    priority: 'normal',
    assignee_id: partial.created_by,
    start_date: null,
    due_date: null,
    objective_id: null,
    tags: [],
    progress_pct: 0,
    effort: 'medium',
    estimate_minutes: 45,
    impact: 3,
    is_stuck: false,
    blocked_reason: null,
    created_at: now,
    updated_at: now,
    ...partial,
  };
}
