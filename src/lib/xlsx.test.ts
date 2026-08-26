import { describe, expect, it } from 'vitest';
import {
  columnIndex,
  columnLetter,
  escapeXml,
  isDateFormat,
  isoToSerial,
  readXlsx,
  serialToIso,
  unescapeXml,
  writeXlsx,
} from './xlsx';

const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

describe('cell references', () => {
  it('reads the base-26-without-zero column letters', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('Z9')).toBe(25);
    expect(columnIndex('AA1')).toBe(26);
    expect(columnIndex('AB100')).toBe(27);
  });

  it('writes them back', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
    expect(columnLetter(27)).toBe('AB');
  });

  it('round-trips across the boundary where naive base-26 breaks', () => {
    for (const i of [0, 25, 26, 51, 52, 701, 702]) {
      expect(columnIndex(`${columnLetter(i)}1`)).toBe(i);
    }
  });
});

describe('xml text', () => {
  it('escapes and unescapes the five entities', () => {
    const raw = `Tom & "Jerry" <a> 'b'`;
    expect(unescapeXml(escapeXml(raw))).toBe(raw);
  });

  it('decodes numeric entities Excel writes for odd characters', () => {
    expect(unescapeXml('caf&#233;')).toBe('café');
    expect(unescapeXml('&#x20AC;9')).toBe('€9');
  });

  it('strips control characters, which Excel refuses outright', () => {
    // A stray one pasted from a bank statement corrupts the whole file.
    const withCtrl = `a${String.fromCharCode(0)}b${String.fromCharCode(7)}c`;
    expect(escapeXml(withCtrl)).toBe('abc');
  });

  it('keeps tab, newline and carriage return, which are legal', () => {
    expect(escapeXml('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });
});

describe('dates', () => {
  it('matches Excel exactly for every date after the phantom leap day', () => {
    // Excel believes 1900 was a leap year, so its serial 60 is an imaginary
    // 29 February. The 1899-12-30 offset absorbs that from 1 March 1900 (serial
    // 61) onward, which covers every date a ledger will ever hold.
    expect(serialToIso(61)).toBe('1900-03-01');
    expect(serialToIso(46260)).toBe('2026-08-26');
    expect(isoToSerial('2026-08-26')).toBe(46260);
  });

  it('is knowingly one day out for the 59 days before that, and that is fine', () => {
    // Stated rather than hidden: Excel shows serial 1 as 1900-01-01. Correcting
    // it would mean special-casing dates no ledger contains, at the cost of a
    // branch in the path every real row goes through.
    expect(serialToIso(1)).toBe('1899-12-31');
  });

  it('round-trips an ISO date', () => {
    expect(serialToIso(isoToSerial('2026-08-26')!)).toBe('2026-08-26');
  });

  it('refuses a date it cannot parse rather than inventing one', () => {
    expect(isoToSerial('not a date')).toBeNull();
  });

  it('treats y and d as dates but never a bare m, which means minutes', () => {
    expect(isDateFormat('yyyy-mm-dd')).toBe(true);
    expect(isDateFormat('dd/mm/yy')).toBe(true);
    expect(isDateFormat('h:mm:ss')).toBe(false);
    expect(isDateFormat('#,##0.00')).toBe(false);
  });

  it('ignores literals and colour codes inside a format', () => {
    expect(isDateFormat('[Red]#,##0')).toBe(false);
    expect(isDateFormat('#,##0 "days"')).toBe(false);
  });
});

describe('write then read', () => {
  it('round-trips headers, text, numbers and dates', async () => {
    const blob = await writeXlsx(
      'Ledger',
      ['Date', 'Party', 'Amount'],
      [
        [{ value: '2026-08-26', date: true }, { value: 'Ludhiana Steel' }, { value: 55000 }],
        [{ value: '2026-09-01', date: true }, { value: 'CA Sharma' }, { value: 12000.5 }],
      ],
    );
    const out = await readXlsx(await bytes(blob));
    expect(out.headers).toEqual(['Date', 'Party', 'Amount']);
    expect(out.rows).toEqual([
      { Date: '2026-08-26', Party: 'Ludhiana Steel', Amount: '55000' },
      { Date: '2026-09-01', Party: 'CA Sharma', Amount: '12000.5' },
    ]);
  });

  it('survives text that would otherwise break the XML', async () => {
    const nasty = 'R&D <urgent> "final" — café';
    const blob = await writeXlsx('S', ['Note'], [[{ value: nasty }]]);
    const out = await readXlsx(await bytes(blob));
    expect(out.rows[0].Note).toBe(nasty);
  });

  it('writes an unparseable date as its own text rather than a wrong number', async () => {
    const blob = await writeXlsx('S', ['When'], [[{ value: 'sometime in May', date: true }]]);
    const out = await readXlsx(await bytes(blob));
    expect(out.rows[0].When).toBe('sometime in May');
  });

  it('leaves empty cells empty instead of shifting the row', async () => {
    const blob = await writeXlsx(
      'S',
      ['A', 'B', 'C'],
      [[{ value: 'x' }, { value: null }, { value: 'z' }]],
    );
    const out = await readXlsx(await bytes(blob));
    expect(out.rows[0]).toEqual({ A: 'x', B: '', C: 'z' });
  });

  it('produces a sheet with no rows for headers alone', async () => {
    const out = await readXlsx(await bytes(await writeXlsx('S', ['Only'], [])));
    expect(out.headers).toEqual(['Only']);
    expect(out.rows).toEqual([]);
  });

  it('trims a sheet name to what Excel allows', async () => {
    // Excel refuses > 31 chars and the characters : \ / ? * [ ]
    const blob = await writeXlsx('a/very:long[name]'.repeat(4), ['A'], [[{ value: '1' }]]);
    expect((await bytes(blob)).length).toBeGreaterThan(0);
  });
});

describe('reading what Excel actually writes', () => {
  /** A workbook built the way Excel does: shared strings and styled dates. */
  async function excelShaped(): Promise<Uint8Array> {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    );
    zip.file(
      'xl/sharedStrings.xml',
      `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3">
<si><t>Date</t></si><si><t>Party</t></si><si><r><t>Ludhiana</t></r><r><t> Steel</t></r></si></sst>`,
    );
    zip.file(
      'xl/styles.xml',
      `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>
<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="165" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    );
    zip.file(
      'xl/worksheets/sheet1.xml',
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" s="1"><v>46265</v></c><c r="B2" t="s"><v>2</v></c></row>
</sheetData></worksheet>`,
    );
    return zip.generateAsync({ type: 'uint8array' });
  }

  it('resolves shared strings instead of importing their indexes', async () => {
    // The failure this guards: every text column arriving as 0, 1, 2…
    const out = await readXlsx(await excelShaped());
    expect(out.headers).toEqual(['Date', 'Party']);
  });

  it('joins run-formatted text into one value', async () => {
    // Bolding half a cell must not split it into two.
    const out = await readXlsx(await excelShaped());
    expect(out.rows[0].Party).toBe('Ludhiana Steel');
  });

  it('converts a styled serial into a real date, not the number 46265', async () => {
    const out = await readXlsx(await excelShaped());
    expect(out.rows[0].Date).toBe('2026-08-31');
  });

  it('explains itself when handed something that is not a workbook', async () => {
    await expect(readXlsx(new TextEncoder().encode('id,name\n1,a'))).rejects.toThrow(/xlsx/i);
  });
});
