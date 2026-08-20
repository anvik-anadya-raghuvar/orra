import { describe, expect, it } from 'vitest';
import type { PageBlock } from '../../types';
import { insertImagesAtBlockCaret } from './wikiImageInsert';

const paragraph = (text: string): PageBlock => ({ id: 'text', type: 'paragraph', text });
const image = (id = 'image'): PageBlock => ({ id, type: 'image', src: 'data:image/jpeg;base64,x' });

function ids() {
  let n = 0;
  return () => `new-${++n}`;
}

describe('Notion-style wiki image insertion', () => {
  it('splits a text block at the caret and focuses the trailing text', () => {
    const result = insertImagesAtBlockCaret(paragraph('before after'), [image()], 6, 6, ids());
    expect(result.blocks).toEqual([
      { id: 'text', type: 'paragraph', text: 'before' },
      image(),
      { id: 'new-1', type: 'paragraph', text: ' after' },
    ]);
    expect(result).toMatchObject({ focusId: 'new-1', focusAtStart: true });
  });

  it('puts an image before the current text when the caret is at the start', () => {
    const result = insertImagesAtBlockCaret(paragraph('after'), [image()], 0, 0, ids());
    expect(result.blocks.map((block) => block.id)).toEqual(['image', 'text']);
    expect(result.blocks[1].text).toBe('after');
  });

  it('creates a new paragraph after an image pasted at the end', () => {
    const result = insertImagesAtBlockCaret(paragraph('before'), [image()], 6, 6, ids());
    expect(result.blocks.map((block) => block.type)).toEqual(['paragraph', 'image', 'paragraph']);
    expect(result.blocks[2]).toMatchObject({ id: 'new-1', text: '' });
  });

  it('preserves the order of a multi-image paste and replaces selected text', () => {
    const result = insertImagesAtBlockCaret(
      paragraph('before replace after'),
      [image('one'), image('two')],
      7,
      14,
      ids(),
    );
    expect(result.blocks.map((block) => block.id)).toEqual(['text', 'one', 'two', 'new-1']);
    expect(result.blocks[0].text).toBe('before ');
    expect(result.blocks[3].text).toBe(' after');
  });
});
