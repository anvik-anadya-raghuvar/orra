import { describe, expect, it } from 'vitest';
import { mergeCardFields, parseCardText } from './cardScan';

/**
 * Real card layouts, typed out the way an OCR engine actually returns them —
 * ragged spacing, a stray label, the occasional misread character. The point
 * of these is not that the parser is right about everything; it is that when
 * somebody widens a regex, the cards that used to work still do.
 */

describe('parseCardText', () => {
  it('reads a plain Indian vendor card', () => {
    const f = parseCardText(
      [
        'SURAT TEXTILES PVT LTD',
        'Nilesh Patel',
        'Sales Manager',
        'M: +91 98250 41122',
        'T: 0261-2345678',
        'nilesh@surattextiles.in',
        'www.surattextiles.in',
        '14, Ring Road, Surat 395002',
      ].join('\n'),
    );
    expect(f.name).toBe('Nilesh Patel');
    expect(f.role).toBe('Sales Manager');
    expect(f.company).toBe('SURAT TEXTILES PVT LTD');
    expect(f.emails).toEqual(['nilesh@surattextiles.in']);
    // The mobile sorts ahead of the landline.
    expect(f.phones[0]).toBe('+91 98250 41122');
    expect(f.phones).toHaveLength(2);
    expect(f.links).toEqual([{ label: 'Website', url: 'https://www.surattextiles.in' }]);
  });

  it('uses the email local part to pick the name out of several candidates', () => {
    // Three name-shaped lines. Only the local part says which is the person.
    const f = parseCardText(
      ['Bovisa Living', 'Milano Nord', 'Chiara Rossi', 'c.rossi@bovisaliving.it'].join('\n'),
    );
    expect(f.name).toBe('Chiara Rossi');
  });

  it('falls back to the largest line when there is no email', () => {
    const lines = [
      { text: 'Bengaluru', height: 12 },
      { text: 'Ravi Menon', height: 34 },
      { text: 'Since 1998', height: 11 },
    ];
    // Deliberately not first in reading order: without sizes the parser would
    // answer 'Bengaluru', and the bounding boxes are what change the answer.
    const f = parseCardText(lines.map((l) => l.text).join('\n'), lines);
    expect(f.name).toBe('Ravi Menon');
  });

  it('separates platform links from the company website and orders them first', () => {
    const f = parseCardText(
      [
        'Anvik',
        'anadya@anvik.club',
        'anvik.club',
        'linkedin.com/in/anadya-raghuvar',
        'instagram.com/anvik.club',
      ].join('\n'),
    );
    expect(f.links.map((l) => l.label)).toEqual(['LinkedIn', 'Instagram', 'Website']);
    expect(f.links[0].url).toBe('https://linkedin.com/in/anadya-raghuvar');
  });

  it('does not re-read an email domain as a website link', () => {
    const f = parseCardText('R. Mehta\nr.mehta@example.com');
    expect(f.emails).toEqual(['r.mehta@example.com']);
    expect(f.links).toEqual([]);
  });

  it('prefers a personal address over a generic one', () => {
    const f = parseCardText('CA Sharma\ninfo@sharmaco.in\nsharma@sharmaco.in');
    expect(f.emails[0]).toBe('sharma@sharmaco.in');
  });

  it("survives OCR's usual damage to an @ and to digits", () => {
    const f = parseCardText(['Prof. Bianchi', 'bianchi (at) polimi.it', 'Tel. +39 O2 2399 l234'].join('\n'));
    expect(f.emails).toEqual(['bianchi@polimi.it']);
    // Inside a span that already matched as a phone number, every O is a zero
    // and every l is a one — including the ones a space away from a digit.
    expect(f.phones[0]).toBe('+39 02 2399 1234');
  });

  it('ignores numbers too long or too short to be a phone number', () => {
    const f = parseCardText(['GSTIN 24AAACS1234F1Z5', 'Suite 402', 'M 9876543210'].join('\n'));
    expect(f.phones).toEqual(['9876543210']);
  });

  it('drops label-only lines rather than treating them as a name', () => {
    const f = parseCardText(['Email:', 'Mobile', 'Kavita Iyer', 'kavita@iyerlegal.com'].join('\n'));
    expect(f.name).toBe('Kavita Iyer');
  });

  it('does not mistake an address line for the company', () => {
    const f = parseCardText(
      ['Arjun Rao', 'Head of Design', '221B Baker Street, Bandra', 'arjun@rao.design'].join('\n'),
    );
    expect(f.company).not.toContain('Baker Street');
    expect(f.role).toBe('Head of Design');
  });

  it('infers a company from the email domain when no line names one', () => {
    const f = parseCardText('Raghuvar\nraghuvar@anvik.club');
    expect(f.company).toBe('Anvik');
  });

  it('returns empty fields for empty or unreadable text', () => {
    expect(parseCardText('')).toEqual({ name: '', role: '', company: '', emails: [], phones: [], links: [] });
    expect(parseCardText('~~~ ||| ***').name).toBe('');
  });

  it('reads every line, not every other one', () => {
    // The /g regexes used to be module-level singletons shared between
    // `matchAll` and a `test` inside a filter, and `lastIndex` carrying over
    // made the filter skip alternate lines. Four consecutive contact lines is
    // the shape that caught it.
    const f = parseCardText(
      ['a@one.com', 'b@two.com', 'c@three.com', 'd@four.com'].join('\n'),
    );
    expect(f.emails).toHaveLength(4);
  });
});

describe('mergeCardFields', () => {
  it('lets the front win single fields and unions the lists', () => {
    const front = parseCardText('Nilesh Patel\nSales Manager\nnilesh@surattextiles.in\nM 9825041122');
    const back = parseCardText('SURAT TEXTILES PVT LTD\ninfo@surattextiles.in\nT 02612345678');
    const m = mergeCardFields(front, back);
    expect(m.name).toBe('Nilesh Patel');
    expect(m.company).toBe('SURAT TEXTILES PVT LTD'); // front had none, back did
    expect(m.emails).toEqual(['nilesh@surattextiles.in', 'info@surattextiles.in']);
    expect(m.phones).toHaveLength(2);
  });

  it('treats the same number written two ways as one number', () => {
    const front = parseCardText('M: +91 98250 41122');
    const back = parseCardText('Mob +919825041122');
    // Same digits, different punctuation — one entry, not two.
    expect(mergeCardFields(front, back).phones).toHaveLength(1);
  });
});
