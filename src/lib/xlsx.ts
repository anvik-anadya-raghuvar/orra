/**
 * Reading and writing .xlsx, on top of jszip — which is already here for the
 * task export, so this adds a file format and not a dependency.
 *
 * SheetJS is the usual answer and is ~130 KB gzipped. That is a lot of library
 * for "a spreadsheet of ledger rows", and the shape actually needed is small:
 * one sheet, a header row, and cells that are text, numbers or dates. What
 * follows handles that shape properly and says so when it meets something it
 * does not.
 *
 * The read side deliberately produces the SAME thing papaparse does — a header
 * list and an array of `Record<string, string>` — so the Money importer's
 * mapping, preview, de-duplication and commit steps do not know or care which
 * format the file was. Excel support is one function, not a second pipeline.
 *
 * ── The two things a naive reader gets wrong ──────────────────────────────
 *
 * SHARED STRINGS. Excel does not put text in the sheet; it puts an index into
 * xl/sharedStrings.xml. A reader that ignores that imports every text column
 * as the numbers 0, 1, 2…
 *
 * DATES. A date cell is a plain number — days since 1899-12-30 — and the only
 * thing marking it as a date is its style pointing at a date number format.
 * Ignore that and "12 Aug 2026" imports as 46246, which the ledger will
 * happily store.
 */

/** Row shape, matching what papaparse's header mode returns. */
export type SheetRow = Record<string, string>;

export interface SheetData {
  headers: string[];
  rows: SheetRow[];
}

/* ── XML helpers ─────────────────────────────────────────────────────── */

/** Every `<tag …>…</tag>` and `<tag … />`, as [attributes, innerXml] pairs. */
function elements(xml: string, tag: string): { attrs: string; inner: string }[] {
  const out: { attrs: string; inner: string }[] = [];
  const re = new RegExp(`<${tag}(\\s[^>]*?)?(/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push({ attrs: m[1] ?? '', inner: m[3] ?? '' });
  return out;
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

export function unescapeXml(text: string): string {
  return (text ?? '').replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body] ?? whole;
  });
}

export function escapeXml(text: string): string {
  return (text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    /* Excel rejects the C0 control range outright, and a stray one in a
       pasted bank description would corrupt the whole file. Filtered by
       code point rather than a regex range: the escape sequences in a
       character class do not survive being written to disk, and the file
       ends up holding the real control bytes instead. */
    .split('')
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join('');
}

/* ── cell references ─────────────────────────────────────────────────── */

/** "C7" → 2. Column letters are base-26 with no zero, so A=0, Z=25, AA=26. */
export function columnIndex(ref: string): number {
  const letters = /^([A-Za-z]+)/.exec(ref ?? '')?.[1] ?? '';
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 0 → "A", 26 → "AA". */
export function columnLetter(index: number): string {
  let n = Math.max(0, Math.floor(index)) + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/* ── dates ───────────────────────────────────────────────────────────── */

/** Built-in number format ids Excel reserves for dates and times. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/**
 * True when a format code describes a date.
 *
 * Tested on 'y' and 'd' but never on 'm' alone: in Excel's format language an
 * `m` following an `h` means minutes, so "h:mm" would otherwise read as a date.
 */
export function isDateFormat(code: string): boolean {
  const stripped = (code ?? '').replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
  return /[yd]/i.test(stripped);
}

/**
 * Excel's day number to an ISO date.
 *
 * The epoch is 1899-12-30, not the 1900-01-01 you would expect, because Excel
 * deliberately kept Lotus 1-2-3's belief that 1900 was a leap year. Serial 60
 * is that imaginary 29 February; the offset absorbs it for every real date
 * after it, which is every date this app will ever see.
 */
export function serialToIso(serial: number): string {
  const ms = Math.round(serial * 86_400_000) + Date.UTC(1899, 11, 30);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

/** An ISO date back to Excel's serial, for writing. */
export function isoToSerial(iso: string): number | null {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.round((ms - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/* ── reading ─────────────────────────────────────────────────────────── */

function parseSharedStrings(xml: string): string[] {
  return elements(xml, 'si').map((si) =>
    /* A run-formatted string is several <r><t> pieces that join into one
       value — bolding half a cell must not split it into two columns. */
    elements(si.inner, 't')
      .map((t) => unescapeXml(t.inner))
      .join(''),
  );
}

/** Style index → true when that style formats its number as a date. */
function parseDateStyles(stylesXml: string): Set<number> {
  const custom = new Map<number, string>();
  for (const fmt of elements(stylesXml, 'numFmt')) {
    const id = Number(attr(fmt.attrs, 'numFmtId'));
    const code = attr(fmt.attrs, 'formatCode') ?? '';
    if (Number.isFinite(id)) custom.set(id, unescapeXml(code));
  }
  const cellXfs = elements(stylesXml, 'cellXfs')[0];
  const dateStyles = new Set<number>();
  if (!cellXfs) return dateStyles;
  elements(cellXfs.inner, 'xf').forEach((xf, index) => {
    const id = Number(attr(xf.attrs, 'numFmtId') ?? '0');
    if (BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))) {
      dateStyles.add(index);
    }
  });
  return dateStyles;
}

/**
 * Turn the first worksheet of an .xlsx into headers and rows.
 *
 * The first non-empty row is the header. Blank rows are dropped, and a column
 * with no header gets a positional name rather than being silently discarded,
 * so nothing in the file becomes invisible.
 */
export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<SheetData> {
  const JSZip = (await import('jszip')).default;
  let zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('That file is not a readable .xlsx — if it came from Excel, try Save As and pick "Excel Workbook".');
  }

  const sheetPath = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort()[0];
  if (!sheetPath) throw new Error('That workbook has no worksheets in it.');

  const [sheetXml, sharedXml, stylesXml] = await Promise.all([
    zip.file(sheetPath)!.async('string'),
    zip.file('xl/sharedStrings.xml')?.async('string') ?? Promise.resolve(''),
    zip.file('xl/styles.xml')?.async('string') ?? Promise.resolve(''),
  ]);

  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
  const dateStyles = stylesXml ? parseDateStyles(stylesXml) : new Set<number>();

  const grid: string[][] = [];
  for (const row of elements(sheetXml, 'row')) {
    const cells: string[] = [];
    for (const cell of elements(row.inner, 'c')) {
      const ref = attr(cell.attrs, 'r') ?? '';
      const type = attr(cell.attrs, 't');
      const style = Number(attr(cell.attrs, 's') ?? '-1');
      const at = ref ? columnIndex(ref) : cells.length;

      let value = '';
      if (type === 'inlineStr') {
        value = elements(cell.inner, 't').map((t) => unescapeXml(t.inner)).join('');
      } else {
        const raw = elements(cell.inner, 'v')[0]?.inner ?? '';
        if (type === 's') {
          value = shared[Number(raw)] ?? '';
        } else if (type === 'b') {
          value = raw === '1' ? 'TRUE' : 'FALSE';
        } else if (type === 'str' || type === 'e') {
          value = unescapeXml(raw);
        } else if (raw !== '' && dateStyles.has(style) && Number.isFinite(Number(raw))) {
          value = serialToIso(Number(raw));
        } else {
          value = unescapeXml(raw);
        }
      }
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    grid.push(cells);
  }

  const firstUsed = grid.findIndex((r) => r.some((c) => c.trim() !== ''));
  if (firstUsed === -1) return { headers: [], rows: [] };

  const rawHeaders = grid[firstUsed];
  const headers = rawHeaders.map((h, i) => h.trim() || `Column ${columnLetter(i)}`);
  const rows: SheetRow[] = [];
  for (const line of grid.slice(firstUsed + 1)) {
    if (!line.some((c) => (c ?? '').trim() !== '')) continue;
    const row: SheetRow = {};
    headers.forEach((h, i) => {
      row[h] = (line[i] ?? '').trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

/* ── writing ─────────────────────────────────────────────────────────── */

export interface WriteCell {
  value: string | number | null | undefined;
  /** Write as a real Excel date rather than text, so it sorts and filters. */
  date?: boolean;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/* Two cell styles: 0 plain, 1 an ISO date. numFmtId 164 is the first id
   Excel leaves free for custom formats. */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>
<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;

function sheetXml(headers: string[], rows: WriteCell[][]): string {
  const lines: string[] = [];
  const headerCells = headers
    .map((h, i) => `<c r="${columnLetter(i)}1" t="inlineStr"><is><t>${escapeXml(h)}</t></is></c>`)
    .join('');
  lines.push(`<row r="1">${headerCells}</row>`);

  rows.forEach((row, r) => {
    const cells = row
      .map((cell, i) => {
        const ref = `${columnLetter(i)}${r + 2}`;
        if (cell?.value === null || cell?.value === undefined || cell.value === '') return '';
        if (cell.date) {
          const serial = isoToSerial(String(cell.value));
          /* A date that will not parse is written as the text it is, rather
             than dropped or turned into a wrong number. */
          return serial === null
            ? `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(cell.value))}</t></is></c>`
            : `<c r="${ref}" s="1"><v>${serial}</v></c>`;
        }
        if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
          return `<c r="${ref}"><v>${cell.value}</v></c>`;
        }
        return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(cell.value))}</t></is></c>`;
      })
      .join('');
    lines.push(`<row r="${r + 2}">${cells}</row>`);
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lines.join('')}</sheetData></worksheet>`;
}

/**
 * Build an .xlsx with one sheet.
 *
 * Inline strings rather than a shared-string table: it costs a few bytes on a
 * file of a few hundred rows and removes an entire class of index bug from
 * the writer.
 */
export async function writeXlsx(
  sheetName: string,
  headers: string[],
  rows: WriteCell[][],
): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  /* Excel's sheet-name rules: 31 characters, and none of : \ / ? * [ ] */
  const safeName = escapeXml((sheetName || 'Sheet1').replace(/[:\\/?*[\]]/g, ' ').slice(0, 31)) || 'Sheet1';

  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', ROOT_RELS);
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${safeName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
  );
  zip.file('xl/_rels/workbook.xml.rels', WORKBOOK_RELS);
  zip.file('xl/styles.xml', STYLES);
  zip.file('xl/worksheets/sheet1.xml', sheetXml(headers, rows));

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
