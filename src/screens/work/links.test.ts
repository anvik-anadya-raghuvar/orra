import { describe, expect, it } from 'vitest';
import { canonicalLink, linkExists } from './common';

describe('task relationships are stored once', () => {
  it('treats "related" as symmetric', () => {
    expect(canonicalLink('T-1', 'T-2', 'related')).toBe(canonicalLink('T-2', 'T-1', 'related'));
  });

  it('treats blocks and blocked_by as the same fact', () => {
    expect(canonicalLink('T-1', 'T-2', 'blocks')).toBe(canonicalLink('T-2', 'T-1', 'blocked_by'));
  });

  it('keeps child_of directional — a child is not its own parent', () => {
    expect(canonicalLink('T-1', 'T-2', 'child_of')).not.toBe(
      canonicalLink('T-2', 'T-1', 'child_of'),
    );
  });

  it('rejects the reverse spelling of an existing link', () => {
    const links = [{ from_task_id: 'T-45', to_task_id: 'T-36', type: 'related' as const }];
    // the exact bug seen on the board: adding the mirror produced a duplicate row
    expect(linkExists(links, 'T-36', 'T-45', 'related')).toBe(true);
    expect(linkExists(links, 'T-45', 'T-36', 'related')).toBe(true);
  });

  it('rejects the inverse of a blocking link', () => {
    const links = [{ from_task_id: 'T-44', to_task_id: 'T-42', type: 'blocked_by' as const }];
    expect(linkExists(links, 'T-42', 'T-44', 'blocks')).toBe(true);
  });

  it('still allows a genuinely different relationship', () => {
    const links = [{ from_task_id: 'T-1', to_task_id: 'T-2', type: 'related' as const }];
    expect(linkExists(links, 'T-1', 'T-2', 'child_of')).toBe(false);
    expect(linkExists(links, 'T-1', 'T-3', 'related')).toBe(false);
  });
});
