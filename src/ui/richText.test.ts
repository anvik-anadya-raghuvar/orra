import { describe, expect, it } from 'vitest';
import { parseRichText } from './richText';

describe('rich text parser', () => {
  it('parses formatting, safe links, and mentions without HTML', () => {
    const parts = parseRichText(
      '**Bold** _italics_ [site](https://example.com) [[page:p-1|Plan]] [[person:u-1|Anadya]] [[date:2026-08-20]] T-42',
      (id) => id === 'T-42',
    );
    expect(parts.filter((part) => part.kind !== 'text').map((part) => part.kind)).toEqual([
      'mark', 'mark', 'link', 'page', 'person', 'date', 'task',
    ]);
  });

  it('leaves unknown task-looking ids as ordinary text', () => {
    expect(parseRichText('Unknown T-999', () => false)).toEqual([
      { kind: 'text', text: 'Unknown ' },
      { kind: 'text', text: 'T-999' },
    ]);
  });

  it('parses color and size marks', () => {
    const parts = parseRichText('{{color:rose|urgent}} and {{size:lg|BIG}}', () => false);
    expect(parts).toEqual([
      { kind: 'color', color: 'rose', text: 'urgent' },
      { kind: 'text', text: ' and ' },
      { kind: 'size', size: 'lg', text: 'BIG' },
    ]);
  });
});
