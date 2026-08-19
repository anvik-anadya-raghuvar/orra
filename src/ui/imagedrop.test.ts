/**
 * `imageFilesFrom` is the whole paste path in one pure function, so it is
 * tested here rather than through a mounted panel. The awkward part it exists
 * to absorb: a pasted bitmap shows up in `DataTransfer.items` and often has no
 * entry in `.files`, while a dragged file shows up in both — and Firefox and
 * Safari disagree about which is populated. Getting the precedence wrong means
 * "Ctrl+V does nothing", which is exactly the bug this replaced.
 */

import { describe, expect, it } from 'vitest';
import { imageFilesFrom } from './imagedrop';

/** Enough of DataTransfer to exercise the branches — the real one is DOM-only. */
function transfer(
  items: { kind: string; type: string; file?: unknown }[],
  files: { type: string; name: string }[] = [],
): DataTransfer {
  return {
    items: items.map((i) => ({
      kind: i.kind,
      type: i.type,
      getAsFile: () => i.file ?? null,
    })),
    files,
  } as unknown as DataTransfer;
}

const png = { type: 'image/png', name: 'clip.png' };
const jpg = { type: 'image/jpeg', name: 'shot.jpg' };

describe('imageFilesFrom', () => {
  it('returns nothing for a null payload', () => {
    expect(imageFilesFrom(null)).toEqual([]);
  });

  it('reads a pasted bitmap off items when files is empty', () => {
    // The Snipping Tool / ⌘⇧4 case: an item, no file list.
    expect(imageFilesFrom(transfer([{ kind: 'file', type: 'image/png', file: png }]))).toEqual([
      png,
    ]);
  });

  it('falls back to files when items carries nothing usable', () => {
    // The drag-and-drop case on engines that leave items unpopulated.
    expect(imageFilesFrom(transfer([], [jpg]))).toEqual([jpg]);
  });

  it('does not double-count a file present in both items and files', () => {
    expect(imageFilesFrom(transfer([{ kind: 'file', type: 'image/png', file: png }], [png]))).toEqual(
      [png],
    );
  });

  it('ignores pasted text, which is what a caret paste means', () => {
    expect(imageFilesFrom(transfer([{ kind: 'string', type: 'text/plain' }]))).toEqual([]);
  });

  it('ignores a non-image file so a dropped PDF is not compressed as a JPEG', () => {
    expect(
      imageFilesFrom(transfer([{ kind: 'file', type: 'application/pdf', file: { type: 'application/pdf' } }])),
    ).toEqual([]);
    expect(imageFilesFrom(transfer([], [{ type: 'application/pdf', name: 'a.pdf' }]))).toEqual([]);
  });

  it('tolerates an item that claims to be a file but yields none', () => {
    expect(imageFilesFrom(transfer([{ kind: 'file', type: 'image/png' }]))).toEqual([]);
  });

  it('keeps the order images were pasted or dropped in', () => {
    const out = imageFilesFrom(
      transfer([
        { kind: 'file', type: 'image/png', file: png },
        { kind: 'string', type: 'text/html' },
        { kind: 'file', type: 'image/jpeg', file: jpg },
      ]),
    );
    expect(out).toEqual([png, jpg]);
  });
});
