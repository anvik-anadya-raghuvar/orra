/**
 * The three things a task can now be more than one of: project, type, person.
 *
 * Each facet is stored twice on purpose (see 0045): a scalar PRIMARY that
 * carries the foreign key, the NOT NULL and the ownership fence, and a JSONB
 * list that carries membership. The primary is always element 0 of its list.
 *
 * Everything reads through here so that pairing can never be re-invented
 * slightly differently per screen — which matters most for rows that predate
 * the migration. Every mock-mode save in localStorage, and any row written by
 * an older tab still open, has the scalars and no arrays at all; `read` treats
 * a missing or empty list as "just the primary" rather than as "belongs to
 * nothing", so a stale row keeps working instead of vanishing from its board.
 *
 * Pure and dependency-free: called inside render paths and inside filters that
 * run per card.
 */
import type { Task, UserId } from '../types';

/** Matches the server-side cap in 0045. */
export const MAX_FACET = 8;

/** A list plus its primary, de-duplicated, primary first, blanks dropped. */
function read(primary: string | null | undefined, list: string[] | null | undefined): string[] {
  const out: string[] = [];
  const push = (value: string | null | undefined) => {
    const clean = (value ?? '').trim();
    if (clean && !out.includes(clean)) out.push(clean);
  };
  push(primary);
  for (const value of list ?? []) push(value);
  return out;
}

/** Every project this task belongs to, its primary first. */
export function taskProjects(t: Pick<Task, 'project_id' | 'project_ids'>): string[] {
  return read(t.project_id, t.project_ids);
}

/** Every type this task carries, its primary first. */
export function taskTypes(t: Pick<Task, 'type' | 'types'>): string[] {
  return read(t.type, t.types);
}

/**
 * Everyone this task is assigned to, primary first.
 *
 * Empty when nobody is assigned — deliberately NOT falling back to the
 * author here. That fallback is an ownership rule and it lives in
 * lib/workspace.ts, which is the one place allowed to answer "is this mine".
 */
export function taskAssignees(t: Pick<Task, 'assignee_id' | 'assignee_ids'>): UserId[] {
  return read(t.assignee_id, t.assignee_ids);
}

/** True when any of this task's projects is in `ids`. */
export function inAnyProject(t: Pick<Task, 'project_id' | 'project_ids'>, ids: Set<string>): boolean {
  return taskProjects(t).some((id) => ids.has(id));
}

/** True when `userId` is one of the people this task is assigned to. */
export function isAssignedTo(t: Pick<Task, 'assignee_id' | 'assignee_ids'>, userId: UserId): boolean {
  return taskAssignees(t).includes(userId);
}

/**
 * Turn a chosen list into the column pair to write.
 *
 * The first entry becomes the primary, so reordering the list in a picker is
 * how you choose which project colours the card and which person the handoff
 * notice goes to. An empty list is refused for projects and types — both are
 * NOT NULL in the database — so the caller keeps whatever it had.
 */
export function projectPatch(
  ids: string[],
  fallback: string,
): Pick<Task, 'project_id' | 'project_ids'> {
  const clean = read(null, ids).slice(0, MAX_FACET);
  return clean.length
    ? { project_id: clean[0], project_ids: clean }
    : { project_id: fallback, project_ids: [fallback] };
}

export function typePatch(values: string[], fallback: string): Pick<Task, 'type' | 'types'> {
  const clean = read(null, values).slice(0, MAX_FACET);
  return clean.length ? { type: clean[0], types: clean } : { type: fallback, types: fallback ? [fallback] : [] };
}

/**
 * Assignees, which unlike the other two may legitimately be empty — an
 * unassigned task is a real state the board already knows how to draw.
 */
export function assigneePatch(ids: UserId[]): Pick<Task, 'assignee_id' | 'assignee_ids'> {
  const clean = read(null, ids).slice(0, MAX_FACET);
  return clean.length ? { assignee_id: clean[0], assignee_ids: clean } : { assignee_id: null, assignee_ids: [] };
}

/**
 * Who newly appears in `next` that was not in `prev`.
 *
 * Assignment notices are per person: adding Raghuvar to a task Anadya already
 * had should tell Raghuvar and say nothing to Anadya, and re-saving the same
 * pair should say nothing at all.
 */
export function addedAssignees(
  prev: Pick<Task, 'assignee_id' | 'assignee_ids'>,
  next: Pick<Task, 'assignee_id' | 'assignee_ids'>,
): UserId[] {
  const before = new Set(taskAssignees(prev));
  return taskAssignees(next).filter((id) => !before.has(id));
}
