import { describe, expect, it } from 'vitest';
import {
  appendMissingInlineImages,
  inlineImageIds,
  insertInlineImages,
  removeInlineImage,
  splitInlineImages,
  stripInlineImageMarkers,
} from './inlineImages';

describe('inline image placement', () => {
  it('inserts an image at the caret between text', () => {
    const result = insertInlineImages('before after', 6, ['img-1']);
    expect(result.value).toBe('before\n{{anvik-image:img-1}}\n after');
    expect(inlineImageIds(result.value)).toEqual(['img-1']);
  });

  it('keeps image order for a multi-image paste', () => {
    const result = insertInlineImages('brief', 5, ['a', 'b']);
    expect(inlineImageIds(result.value)).toEqual(['a', 'b']);
  });

  it('places legacy unreferenced images at the end once', () => {
    const value = appendMissingInlineImages('body\n{{anvik-image:a}}', ['a', 'b']);
    expect(inlineImageIds(value)).toEqual(['a', 'b']);
    expect(appendMissingInlineImages(value, ['a', 'b'])).toBe(value);
  });

  it('splits text and images without losing source positions', () => {
    const parts = splitInlineImages('one{{anvik-image:x}}two');
    expect(parts.map((part) => part.kind)).toEqual(['text', 'image', 'text']);
    expect(parts[2]).toMatchObject({ kind: 'text', text: 'two', start: 20 });
  });

  it('removes one placement and hides markers from plain text consumers', () => {
    const value = 'one\n{{anvik-image:x}}\ntwo';
    expect(removeInlineImage(value, 'x')).toBe('one\ntwo');
    expect(stripInlineImageMarkers(value)).toBe('one\ntwo');
  });
});
