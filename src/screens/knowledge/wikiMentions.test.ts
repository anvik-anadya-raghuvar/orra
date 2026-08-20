import { describe, expect, it } from 'vitest';
import { parseRichText } from './wikiMentions';

describe('wiki rich text parser', () => {
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
});
