import { describe, expect, it } from 'vitest';
import type { Page, PageBlock } from '../../types';
import {
  descendantEnd,
  duplicateBlocks,
  isBlockHidden,
  isVerificationCurrent,
  pageBacklinks,
  pageBreadcrumbs,
  parseSimpleTable,
} from './wikiEditor';

const block = (id: string, indent = 0, type: PageBlock['type'] = 'paragraph'): PageBlock => ({
  id,
  type,
  indent,
  text: id,
});

const page = (id: string, parent_page_id: string | null = null, blocks: PageBlock[] = []): Page => ({
  id,
  parent_page_id,
  blocks,
  title: id,
  icon: '📄',
  tags: [],
  linked_task_ids: [],
  is_archived: false,
  position: 1,
  created_by: 'u',
  last_edited_by: 'u',
  created_at: '2026-01-01',
  last_edited_at: '2026-01-01',
});

describe('wiki editor operations', () => {
  it('hides all indented descendants of a collapsed toggle', () => {
    const blocks = [{ ...block('toggle', 0, 'toggle'), collapsed: true }, block('child', 1), block('grandchild', 2), block('next', 0)];
    expect(isBlockHidden(blocks, 1)).toBe(true);
    expect(isBlockHidden(blocks, 2)).toBe(true);
    expect(isBlockHidden(blocks, 3)).toBe(false);
    expect(descendantEnd(blocks, 0)).toBe(3);
  });

  it('duplicates selected blocks immediately after their originals', () => {
    let id = 0;
    const result = duplicateBlocks([block('a'), block('b')], new Set(['a', 'b']), () => `copy-${++id}`);
    expect(result.map((candidate) => candidate.id)).toEqual(['a', 'copy-1', 'b', 'copy-2']);
  });

  it('normalizes a tab-separated simple table', () => {
    expect(parseSimpleTable('a\tb\nc')).toEqual([['a', 'b'], ['c', '']]);
  });

  it('builds breadcrumbs and backlinks without databases', () => {
    const root = page('root');
    const child = page('child', 'root');
    const linking = page('linking', null, [{ ...block('p'), text: 'See [[page:child|Child]]' }]);
    expect(pageBreadcrumbs(child, [root, child, linking]).map((candidate) => candidate.id)).toEqual(['root', 'child']);
    expect(pageBacklinks('child', [root, child, linking]).map((candidate) => candidate.id)).toEqual(['linking']);
  });

  it('treats indefinite and unexpired verification as current', () => {
    expect(isVerificationCurrent({ ...page('p'), verified_at: '2026-01-01', verification_expires_at: null }, 0)).toBe(true);
    expect(isVerificationCurrent({ ...page('p'), verified_at: '2026-01-01', verification_expires_at: '2026-02-01' }, Date.parse('2026-03-01'))).toBe(false);
  });
});
