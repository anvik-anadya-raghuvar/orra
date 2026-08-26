import type { Task } from '../types';
import { assigneePatch, projectPatch, typePatch } from './taskFacets';

/**
 * Single place new tasks are born. Every creation site goes through this, so
 * adding a Task field never leaves a call site silently constructing a
 * half-built row.
 *
 * Since 0045 that includes the three facet lists. They are applied AFTER the
 * caller's own fields, from whatever the caller ended up with, so a creation
 * site that only knows about the scalars — mail conversion, a repeat, the Us
 * promote modal, quick capture — still produces a row whose primaries are
 * element 0 of their own lists. That pairing is the invariant 0045 refuses to
 * half-apply on, and it would rot immediately if each call site had to
 * remember it.
 */
export function makeTask(partial: Partial<Task> & Pick<Task, 'id' | 'title' | 'project_id' | 'created_by'>): Task {
  const now = new Date().toISOString();
  /* Unassigned is a real state, so "no assignee_id key at all" (assign it to
     the author, the long-standing default) and "assignee_id: null" (nobody,
     said deliberately) have to stay distinguishable. */
  const assignees =
    partial.assignee_ids ??
    (partial.assignee_id === undefined
      ? [partial.created_by]
      : partial.assignee_id
        ? [partial.assignee_id]
        : []);
  return {
    description: '',
    acceptance_criteria: '',
    status: 'todo',
    priority: 'normal',
    start_date: null,
    due_date: null,
    objective_id: null,
    tags: [],
    progress_pct: 0,
    sprint_id: null,
    board_order: 0,
    effort: 'medium',
    estimate_minutes: 45,
    impact: 3,
    is_stuck: false,
    blocked_reason: null,
    created_at: now,
    updated_at: now,
    ...partial,
    ...projectPatch(partial.project_ids ?? [], partial.project_id),
    ...typePatch(partial.types ?? [], partial.type ?? 'ops'),
    ...assigneePatch(assignees),
  };
}
