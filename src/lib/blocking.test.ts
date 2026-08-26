import { describe, expect, it } from 'vitest';
import { blockedTaskIds, blockingDecisions, isBlockedByDecision } from './blocking';
import type { Decision } from '../types';

const decision = (over: Partial<Decision>): Decision => ({
  id: 'dec-1',
  question: 'Which vendor?',
  project_id: 'p1',
  recommendation: '',
  owner_id: 'u-anadya',
  status: 'open',
  opened_at: '2026-08-01T09:00:00.000Z',
  ruled_at: null,
  ruling_note: '',
  task_ids: [],
  ...over,
});

describe('blockingDecisions', () => {
  it('returns the open decisions a task is linked to', () => {
    const rows = [
      decision({ id: 'a', task_ids: ['T-1', 'T-2'] }),
      decision({ id: 'b', task_ids: ['T-9'] }),
    ];
    expect(blockingDecisions(rows, 'T-1').map((d) => d.id)).toEqual(['a']);
  });

  it('ignores a ruled decision — ruling releases every task at once', () => {
    const rows = [decision({ id: 'a', status: 'ruled', ruled_at: 'x', task_ids: ['T-1'] })];
    expect(blockingDecisions(rows, 'T-1')).toEqual([]);
    expect(isBlockedByDecision(rows, 'T-1')).toBe(false);
  });

  it('orders oldest question first, so the longest wait reads first', () => {
    const rows = [
      decision({ id: 'new', opened_at: '2026-08-20T09:00:00.000Z', task_ids: ['T-1'] }),
      decision({ id: 'old', opened_at: '2026-06-01T09:00:00.000Z', task_ids: ['T-1'] }),
    ];
    expect(blockingDecisions(rows, 'T-1').map((d) => d.id)).toEqual(['old', 'new']);
  });

  it('treats a decision with no links, or absent task_ids, as blocking nothing', () => {
    const rows = [decision({ id: 'a' }), decision({ id: 'b', task_ids: undefined })];
    expect(isBlockedByDecision(rows, 'T-1')).toBe(false);
  });
});

describe('blockedTaskIds', () => {
  it('collects every blocked id across open decisions, de-duplicated', () => {
    const rows = [
      decision({ id: 'a', task_ids: ['T-1', 'T-2'] }),
      decision({ id: 'b', task_ids: ['T-2', 'T-3'] }),
      decision({ id: 'c', status: 'ruled', task_ids: ['T-4'] }),
    ];
    expect([...blockedTaskIds(rows)].sort()).toEqual(['T-1', 'T-2', 'T-3']);
  });

  it('is empty when nothing is open', () => {
    expect(blockedTaskIds([]).size).toBe(0);
  });
});
