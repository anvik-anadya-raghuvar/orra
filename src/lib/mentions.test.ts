import { describe, expect, it } from 'vitest';
import { mentionExcerpt, mentionToken, mentionedIds, mentionsSomeoneElse } from './mentions';

describe('mentionToken', () => {
  it('writes the token parseRichText already reads', () => {
    expect(mentionToken('u-raghuvar', 'Raghuvar')).toBe('[[person:u-raghuvar|Raghuvar]]');
  });
});

describe('mentionedIds', () => {
  it('finds every tagged person in order', () => {
    const text = 'ping [[person:u-raghuvar|Raghuvar]] and [[person:u-anadya|Anadya]] on this';
    expect(mentionedIds(text)).toEqual(['u-raghuvar', 'u-anadya']);
  });

  it('de-duplicates — three tags is emphasis, not three notifications', () => {
    const text = '[[person:u-raghuvar|Raghuvar]] [[person:u-raghuvar|Raghuvar]] [[person:u-raghuvar|Rag]]';
    expect(mentionedIds(text)).toEqual(['u-raghuvar']);
  });

  it('is empty for plain text, a bare @, and nothing at all', () => {
    expect(mentionedIds('no tags here')).toEqual([]);
    expect(mentionedIds('@raghuvar is not a token')).toEqual([]);
    expect(mentionedIds('')).toEqual([]);
  });
});

describe('mentionsSomeoneElse', () => {
  it('is true only when someone other than me is tagged', () => {
    const other = 'see [[person:u-raghuvar|Raghuvar]]';
    expect(mentionsSomeoneElse(other, 'u-anadya')).toBe(true);
    expect(mentionsSomeoneElse(other, 'u-raghuvar')).toBe(false);
  });

  it('ignores a self-tag sitting beside a real one', () => {
    const both = '[[person:u-anadya|Anadya]] and [[person:u-raghuvar|Raghuvar]]';
    expect(mentionsSomeoneElse(both, 'u-anadya')).toBe(true);
    expect(mentionsSomeoneElse('[[person:u-anadya|Anadya]] only', 'u-anadya')).toBe(false);
  });
});

describe('mentionExcerpt', () => {
  it('flattens tokens back to @Name so a notice reads as a sentence', () => {
    expect(mentionExcerpt('can [[person:u-raghuvar|Raghuvar]] sit with me')).toBe('can @Raghuvar sit with me');
  });

  it('collapses whitespace and trims', () => {
    expect(mentionExcerpt('  two\n\nlines   here ')).toBe('two lines here');
  });

  it('truncates long bodies with an ellipsis, keeping the limit', () => {
    const out = mentionExcerpt('x'.repeat(200), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith('…')).toBe(true);
  });

  it('leaves a body exactly at the limit alone', () => {
    expect(mentionExcerpt('x'.repeat(20), 20)).toBe('x'.repeat(20));
  });
});
