import { describe, expect, it } from 'vitest';
import type { AuditEntry, Comment, Dataset } from '../types';
import { buildTaskTimeline, timelineSummary } from './taskTimeline';

const AN = 'u-anadya';
const RG = 'u-raghuvar';

type Slice = Parameters<typeof buildTaskTimeline>[0];

let seq = 0;
const row = (p: Partial<AuditEntry>): AuditEntry => ({
  id: `a-${++seq}`,
  occurred_at: '2026-08-18T09:00:00.000Z',
  actor_id: AN,
  actor_label: 'Anadya',
  entity_type: 'task',
  entity_id: 'T-1',
  field_name: null,
  old_value: null,
  new_value: null,
  source: 'portal',
  ...p,
});

const comment = (p: Partial<Comment>): Comment => ({
  id: 'c-1',
  task_id: 'T-1',
  author_id: RG,
  body: 'looks right to me',
  is_decision: false,
  created_at: '2026-08-18T10:00:00.000Z',
  ...p,
});

const slice = (p: Partial<Slice>): Slice => ({
  audit_trail: [],
  comments: [],
  subtasks: [],
  task_links: [],
  screenshot_attachments: [],
  decisions: [],
  profiles: [
    { id: AN, name: 'Anadya' },
    { id: RG, name: 'Raghuvar' },
  ] as Dataset['profiles'],
  ...p,
});

const texts = (s: Slice, id = 'T-1') => buildTaskTimeline(s, id).map((e) => e.text);

describe('narrating what happened to a task', () => {
  it('reads stored values as sentences, not as column diffs', () => {
    const s = slice({
      audit_trail: [
        row({ field_name: 'status', old_value: 'todo', new_value: 'in_progress' }),
        row({ field_name: 'priority', old_value: 'low', new_value: 'urgent' }),
        row({ field_name: 'progress_pct', old_value: '10', new_value: '62' }),
      ],
    });
    expect(texts(s)).toEqual([
      'moved it To do → In progress',
      'asked for P0, was P3',
      'progress 10% → 62%',
    ]);
  });

  it('speaks the priority vocabulary the rest of the app uses', () => {
    // the stored value is "urgent"; every screen calls it P0
    const s = slice({
      audit_trail: [row({ field_name: 'priority', old_value: null, new_value: 'normal' })],
    });
    expect(texts(s)[0]).toBe('asked for P2');
  });

  it('resolves user ids to names', () => {
    const s = slice({
      audit_trail: [row({ field_name: 'assignee_id', old_value: AN, new_value: RG })],
    });
    expect(texts(s)[0]).toBe('reassigned it from Anadya to Raghuvar');
  });

  it('merges the two columns an accept writes into one event', () => {
    // acknowledged_at and accepted_priority are written by a single click;
    // two rows for one decision reads as the app stuttering
    const at = '2026-08-19T04:00:00.000Z';
    const s = slice({
      audit_trail: [
        row({ occurred_at: at, actor_id: RG, actor_label: 'Raghuvar', field_name: 'acknowledged_at', new_value: at }),
        row({ occurred_at: at, actor_id: RG, actor_label: 'Raghuvar', field_name: 'accepted_priority', new_value: 'high' }),
      ],
    });
    const out = buildTaskTimeline(s, 'T-1');
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('accepted it at P1');
    expect(out[0].kind).toBe('accepted');
  });

  it('still reports an accept that recorded no priority', () => {
    const s = slice({
      audit_trail: [row({ field_name: 'acknowledged_at', new_value: '2026-08-19T04:00:00.000Z' })],
    });
    expect(texts(s)).toEqual(['accepted the task']);
  });

  it('does not merge an accept with an unrelated change by someone else', () => {
    const at = '2026-08-19T04:00:00.000Z';
    const s = slice({
      audit_trail: [
        row({ occurred_at: at, actor_id: RG, actor_label: 'Raghuvar', field_name: 'acknowledged_at', new_value: at }),
        row({ occurred_at: at, actor_id: AN, actor_label: 'Anadya', field_name: 'status', old_value: 'todo', new_value: 'done' }),
      ],
    });
    expect(texts(s).sort()).toEqual(['accepted the task', 'moved it To do → Done']);
  });

  it('quotes a pushback reason instead of burying it in the sentence', () => {
    const s = slice({
      audit_trail: [row({ field_name: 'pushback_reason', new_value: 'not this week' })],
    });
    const [e] = buildTaskTimeline(s, 'T-1');
    expect(e.text).toBe('pushed it back');
    expect(e.detail).toBe('not this week');
    expect(e.kind).toBe('pushed_back');
  });

  it('names a field it has no prose for rather than dropping a real change', () => {
    const s = slice({ audit_trail: [row({ field_name: 'some_new_column', new_value: 'x' })] });
    expect(texts(s)).toEqual(['changed some new column']);
  });

  it('puts one birth marker on a task, not one per logged action', () => {
    // an export and an import are also logged without a field name; only the
    // earliest field-less row is the task coming into existence
    const s = slice({
      audit_trail: [
        row({ occurred_at: '2026-08-10T09:00:00.000Z', new_value: 'Task created — QA report' }),
        row({ occurred_at: '2026-08-16T11:47:00.000Z', new_value: 'Export generated — T-1.md' }),
      ],
    });
    const out = buildTaskTimeline(s, 'T-1');
    expect(out.map((e) => e.kind)).toEqual(['created', 'edit']);
    expect(out.map((e) => e.text)).toEqual(['Task created — QA report', 'Export generated — T-1.md']);
  });

  it('hides bookkeeping that carries no information', () => {
    const s = slice({
      audit_trail: [
        row({ field_name: 'board_order', old_value: '0', new_value: '3' }),
        row({ field_name: 'updated_at', new_value: 'x' }),
      ],
    });
    expect(texts(s)).toEqual([]);
  });
});

describe('everything that touched the task, not just the task row', () => {
  it('carries comment bodies, which the trail alone does not preserve', () => {
    const s = slice({ comments: [comment({ body: 'starting Friday' })] });
    const [e] = buildTaskTimeline(s, 'T-1');
    expect(e.text).toBe('commented');
    expect(e.detail).toBe('starting Friday');
    expect(e.actor).toBe('Raghuvar');
  });

  it('marks a decision comment apart from ordinary chat', () => {
    const s = slice({ comments: [comment({ is_decision: true })] });
    expect(buildTaskTimeline(s, 'T-1')[0].kind).toBe('decision');
  });

  it('includes subtask ticks by resolving the child back to its parent', () => {
    const s = slice({
      subtasks: [{ id: 'st-1', task_id: 'T-1', title: 'a', completed: true, position: 1 }],
      audit_trail: [
        row({ entity_type: 'subtask', entity_id: 'st-1', field_name: 'completed', new_value: 'true' }),
        // a subtask of a different task must not leak in
        row({ entity_type: 'subtask', entity_id: 'st-99', field_name: 'completed', new_value: 'true' }),
      ],
    });
    expect(texts(s)).toEqual(['ticked a subtask']);
  });

  it('keeps another task’s history out entirely', () => {
    const s = slice({
      audit_trail: [
        row({ entity_id: 'T-1', field_name: 'status', old_value: 'todo', new_value: 'done' }),
        row({ entity_id: 'T-2', field_name: 'status', old_value: 'todo', new_value: 'done' }),
      ],
      comments: [comment({ id: 'c-2', task_id: 'T-2', body: 'other task' })],
    });
    expect(buildTaskTimeline(s, 'T-1')).toHaveLength(1);
  });
});

describe('ordering', () => {
  it('tells the story oldest first', () => {
    const s = slice({
      audit_trail: [
        row({ occurred_at: '2026-08-20T09:00:00.000Z', field_name: 'status', old_value: 'in_progress', new_value: 'done' }),
        row({ occurred_at: '2026-08-18T09:00:00.000Z', new_value: 'created the task' }),
      ],
    });
    expect(texts(s)).toEqual(['created the task', 'moved it In progress → Done']);
  });

  it('is stable when two events share a timestamp', () => {
    const at = '2026-08-18T09:00:00.000Z';
    const s = slice({
      audit_trail: [
        row({ id: 'a-z', occurred_at: at, field_name: 'title', new_value: 'x' }),
        row({ id: 'a-a', occurred_at: at, field_name: 'effort', new_value: 'heavy' }),
      ],
    });
    const once = buildTaskTimeline(s, 'T-1').map((e) => e.id);
    const twice = buildTaskTimeline(s, 'T-1').map((e) => e.id);
    expect(once).toEqual(twice);
    expect(once).toEqual(['a-a', 'a-z']);
  });

  it('summarises the span for the section header', () => {
    const s = slice({
      audit_trail: [
        row({ occurred_at: '2026-08-18T09:00:00.000Z', new_value: 'created the task' }),
        row({ occurred_at: '2026-08-20T09:00:00.000Z', field_name: 'status', old_value: 'todo', new_value: 'done' }),
      ],
    });
    const sum = timelineSummary(buildTaskTimeline(s, 'T-1'));
    expect(sum).toEqual({
      count: 2,
      first: '2026-08-18T09:00:00.000Z',
      last: '2026-08-20T09:00:00.000Z',
    });
  });

  it('returns nothing for a task with no history rather than throwing', () => {
    expect(buildTaskTimeline(slice({}), 'T-404')).toEqual([]);
    expect(timelineSummary([])).toEqual({ count: 0, first: null, last: null });
  });
});
