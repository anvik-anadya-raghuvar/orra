import { newId } from '../../data/store';
import type { PageBlock } from '../../types';
import { blockText, isListy } from './WikiBlocks';

type IdFactory = () => string;

function withText(block: PageBlock, id: string, text: string): PageBlock {
  if (isListy(block.type)) {
    const oldItems = block.items ?? [];
    return {
      ...block,
      id,
      items: text.split('\n').map((line, index) => ({
        text: line,
        ...(block.type === 'todo' ? { done: oldItems[index]?.done ?? false } : {}),
      })),
    };
  }
  return { ...block, id, text };
}

/**
 * Notion-style clipboard insertion: an image is a real block at the caret.
 * Selected text is replaced, text before the caret remains above the image,
 * and text after it remains immediately below. Pasting at the end creates a
 * fresh paragraph below the image so typing can continue without another
 * click.
 */
export function insertImagesAtBlockCaret(
  block: PageBlock,
  imageBlocks: PageBlock[],
  selectionStart: number,
  selectionEnd: number,
  makeId: IdFactory = () => newId('b'),
): { blocks: PageBlock[]; focusId: string; focusAtStart: boolean } {
  const value = blockText(block);
  const start = Math.min(Math.max(selectionStart, 0), value.length);
  const end = Math.min(Math.max(selectionEnd, start), value.length);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const next: PageBlock[] = [];

  if (before) next.push(withText(block, block.id, before));
  next.push(...imageBlocks);

  if (after) {
    const trailing = withText(block, before ? makeId() : block.id, after);
    next.push(trailing);
    return { blocks: next, focusId: trailing.id, focusAtStart: true };
  }

  // A media block never traps the caret. Like Notion, there is always an empty
  // text block immediately below it when the paste ends the current line.
  const paragraph: PageBlock = { id: makeId(), type: 'paragraph', text: '' };
  next.push(paragraph);
  return { blocks: next, focusId: paragraph.id, focusAtStart: true };
}
