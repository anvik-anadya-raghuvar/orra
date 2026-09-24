/**
 * A spreadsheet, cut into printable pages.
 *
 * Drawing on an .xlsx means drawing on *a picture of* it: there is no page in
 * a spreadsheet until someone decides where the page breaks are. This decides
 * them the way Excel's own print does — column widths from content, as many
 * rows as fit, "down, then over" when the sheet is wider than a page — with
 * the header row repeated on every page so page 4 still says what column C is.
 *
 * Pure geometry, measured in points on an A4-landscape page and a fixed
 * average character width, so the same sheet always breaks the same way and
 * the test needs no canvas.
 */
import type { SheetData } from '../xlsx';

export const SHEET_PAGE = { w: 842, h: 595 } as const; // A4 landscape, points
export const SHEET_MARGIN = 28;
export const SHEET_TITLE_H = 22;
export const SHEET_FOOTER_H = 16;
export const SHEET_HEADER_H = 20;
export const SHEET_ROW_H = 16;
/** Average glyph advance at the 8.5 pt body size. */
export const SHEET_CHAR_W = 4.9;
const COL_MIN = 40;
const COL_MAX = 230;
const CELL_PAD = 10;
/** A sheet big enough to need more than this is a database, not a page. */
export const SHEET_MAX_PAGES = 150;

export interface SheetPage {
  /** 0-based data row range [rowStart, rowEnd). */
  rowStart: number;
  rowEnd: number;
  /** 0-based column range [colStart, colEnd). */
  colStart: number;
  colEnd: number;
}

export interface SheetLayout {
  colWidths: number[];
  pages: SheetPage[];
  rowsPerPage: number;
  /** True when SHEET_MAX_PAGES cut the sheet short. */
  truncated: boolean;
}

/** Column width in points, from the longest value in it (header included). */
export function columnWidths(sheet: SheetData, sampleRows = 400): number[] {
  return sheet.headers.map((h) => {
    let longest = h.length;
    const n = Math.min(sheet.rows.length, sampleRows);
    for (let i = 0; i < n; i += 1) {
      const v = sheet.rows[i][h] ?? '';
      if (v.length > longest) longest = v.length;
    }
    return Math.round(Math.min(COL_MAX, Math.max(COL_MIN, longest * SHEET_CHAR_W + CELL_PAD)));
  });
}

/** Split column indices into runs that fit `width`. A column wider than the
 *  page on its own still gets a run of one (it is clipped, not dropped). */
export function columnRuns(widths: number[], width: number): [number, number][] {
  const runs: [number, number][] = [];
  let start = 0;
  let used = 0;
  widths.forEach((w, i) => {
    if (i > start && used + w > width) {
      runs.push([start, i]);
      start = i;
      used = 0;
    }
    used += w;
  });
  if (widths.length) runs.push([start, widths.length]);
  return runs;
}

export function paginateSheet(sheet: SheetData): SheetLayout {
  const colWidths = columnWidths(sheet);
  const usableW = SHEET_PAGE.w - SHEET_MARGIN * 2;
  const usableH =
    SHEET_PAGE.h - SHEET_MARGIN * 2 - SHEET_TITLE_H - SHEET_FOOTER_H - SHEET_HEADER_H;
  const rowsPerPage = Math.max(1, Math.floor(usableH / SHEET_ROW_H));
  const runs = columnRuns(colWidths, usableW);
  const pages: SheetPage[] = [];
  const rowCount = Math.max(1, sheet.rows.length); // an empty sheet is still one page
  let truncated = false;
  // Down, then over — the way Excel prints.
  outer: for (const [colStart, colEnd] of runs.length ? runs : [[0, 0] as [number, number]]) {
    for (let r = 0; r < rowCount; r += rowsPerPage) {
      if (pages.length >= SHEET_MAX_PAGES) {
        truncated = true;
        break outer;
      }
      pages.push({ rowStart: r, rowEnd: Math.min(sheet.rows.length, r + rowsPerPage), colStart, colEnd });
    }
  }
  return { colWidths, pages, rowsPerPage, truncated };
}

/** Cut a cell's text to what fits `width` points, with an ellipsis. */
export function clipCell(text: string, width: number, charW = SHEET_CHAR_W): string {
  const fits = Math.floor((width - CELL_PAD) / charW);
  if (fits <= 0) return '';
  if (text.length <= fits) return text;
  return fits <= 1 ? '…' : `${text.slice(0, fits - 1)}…`;
}

/** "A", "B" … "AA" — the column letters Excel shows. */
export function colLetter(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** The footer line — which slice of the sheet this page is. */
export function sheetPageLabel(page: SheetPage, index: number, total: number): string {
  const rows =
    page.rowEnd > page.rowStart ? `rows ${page.rowStart + 1}–${page.rowEnd}` : 'no rows';
  const cols =
    page.colEnd > page.colStart
      ? `columns ${colLetter(page.colStart)}–${colLetter(page.colEnd - 1)}`
      : 'no columns';
  return `Page ${index + 1} of ${total} · ${rows} · ${cols}`;
}
