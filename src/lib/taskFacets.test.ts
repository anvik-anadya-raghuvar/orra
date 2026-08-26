import { describe, expect, it } from 'vitest';
import {
  addedAssignees,
  assigneePatch,
  inAnyProject,
  isAssignedTo,
  projectPatch,
  taskAssignees,
  taskProjects,
  taskTypes,
  typePatch,
} from './taskFacets';

describe('reading a facet', () => {
  it('returns the list with the primary first', () => {
    expect(taskProjects({ project_id: 'a', project_ids: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('falls back to the primary for a row written before 0045', () => {
    // Every mock-mode localStorage save looks like this: scalars, no arrays.
    // Treating it as "belongs to nothing" would drop the card off its board.
    expect(taskProjects({ project_id: 'a', project_ids: undefined })).toEqual(['a']);
    expect(taskProjects({ project_id: 'a', project_ids: [] })).toEqual(['a']);
    expect(taskTypes({ type: 'ops', types: undefined })).toEqual(['ops']);
  });

  it('puts the primary first even when the list disagrees about order', () => {
    expect(taskProjects({ project_id: 'b', project_ids: ['a', 'b'] })).toEqual(['b', 'a']);
  });

  it('de-duplicates and drops blanks', () => {
    expect(taskProjects({ project_id: 'a', project_ids: ['a', '', '  ', 'b', 'b'] })).toEqual(['a', 'b']);
  });

  it('reads an empty type as no types rather than one blank one', () => {
    expect(taskTypes({ type: '', types: [] })).toEqual([]);
  });

  it('reads assignees as empty when nobody is assigned — the author fallback is workspace.ts’s job', () => {
    expect(taskAssignees({ assignee_id: null, assignee_ids: [] })).toEqual([]);
  });
});

describe('membership', () => {
  it('matches a task on any of its projects, not only the primary', () => {
    const t = { project_id: 'work', project_ids: ['work', 'life'] };
    expect(inAnyProject(t, new Set(['life']))).toBe(true);
    expect(inAnyProject(t, new Set(['other']))).toBe(false);
  });

  it('counts a second assignee as assigned', () => {
    const t = { assignee_id: 'u-anadya', assignee_ids: ['u-anadya', 'u-raghuvar'] };
    expect(isAssignedTo(t, 'u-raghuvar')).toBe(true);
    expect(isAssignedTo(t, 'u-anadya')).toBe(true);
    expect(isAssignedTo(t, 'u-nobody')).toBe(false);
  });
});

describe('writing a facet', () => {
  it('makes the first entry the primary, so ordering picks the card colour', () => {
    expect(projectPatch(['b', 'a'], 'fallback')).toEqual({ project_id: 'b', project_ids: ['b', 'a'] });
  });

  it('refuses an empty project list — the column is NOT NULL', () => {
    expect(projectPatch([], 'keep')).toEqual({ project_id: 'keep', project_ids: ['keep'] });
  });

  it('caps at the 8 the database checks for', () => {
    const many = Array.from({ length: 12 }, (_, i) => `p${i}`);
    expect(projectPatch(many, 'x').project_ids).toHaveLength(8);
  });

  it('allows an empty assignee list, because unassigned is a real state', () => {
    expect(assigneePatch([])).toEqual({ assignee_id: null, assignee_ids: [] });
  });

  it('keeps types in step with their primary', () => {
    expect(typePatch(['ops', 'legal'], '')).toEqual({ type: 'ops', types: ['ops', 'legal'] });
  });
});

describe('addedAssignees', () => {
  it('names only the people who are newly on it', () => {
    const prev = { assignee_id: 'u-anadya', assignee_ids: ['u-anadya'] };
    const next = { assignee_id: 'u-anadya', assignee_ids: ['u-anadya', 'u-raghuvar'] };
    expect(addedAssignees(prev, next)).toEqual(['u-raghuvar']);
  });

  it('says nothing when the same pair is re-saved', () => {
    const same = { assignee_id: 'u-anadya', assignee_ids: ['u-anadya', 'u-raghuvar'] };
    expect(addedAssignees(same, same)).toEqual([]);
  });

  it('says nothing when someone is removed', () => {
    const prev = { assignee_id: 'u-anadya', assignee_ids: ['u-anadya', 'u-raghuvar'] };
    const next = { assignee_id: 'u-anadya', assignee_ids: ['u-anadya'] };
    expect(addedAssignees(prev, next)).toEqual([]);
  });

  it('treats a pre-0045 row as already holding its primary', () => {
    const prev = { assignee_id: 'u-anadya', assignee_ids: undefined };
    const next = { assignee_id: 'u-anadya', assignee_ids: ['u-anadya'] };
    expect(addedAssignees(prev, next)).toEqual([]);
  });
});
