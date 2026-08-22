import { describe, expect, it } from 'vitest';
import { applyInlineFormat, insertInlineToken, isSafeExternalUrl, toggleLineMarker } from './textFormat';

describe('inline text formatting', () => {
  it('wraps a selection and places the selection inside the markers', () => {
    expect(applyInlineFormat('hello world', 6, 11, '**')).toEqual({
      value: 'hello **world**',
      selectionStart: 8,
      selectionEnd: 13,
    });
  });

  it('wraps a placeholder when nothing is selected', () => {
    expect(applyInlineFormat('hello ', 6, 6, '_', '_', 'italic')).toEqual({
      value: 'hello _italic_',
      selectionStart: 7,
      selectionEnd: 13,
    });
  });

  it('inserts mention tokens at the exact selection', () => {
    expect(insertInlineToken('hello there', 6, 11, '[[page:p|Plan]]').value).toBe('hello [[page:p|Plan]]');
  });

  it('rejects unsafe or malformed URLs', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('https://example.com')).toBe(true);
    expect(isSafeExternalUrl('mailto:a@b.com')).toBe(true);
  });
});

describe('toggleLineMarker', () => {
  it('adds a bullet to every non-blank line the selection touches', () => {
    const result = toggleLineMarker('first\nsecond\n\nthird', 0, 12);
    expect(result.value).toBe('- first\n- second\n\nthird');
  });

  it('removes the bullet again when every touched line already has one', () => {
    const result = toggleLineMarker('- first\n- second', 0, 17);
    expect(result.value).toBe('first\nsecond');
  });

  it('only touches the lines the selection spans', () => {
    const result = toggleLineMarker('one\ntwo\nthree', 4, 7);
    expect(result.value).toBe('one\n- two\nthree');
  });
});
