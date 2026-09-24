/**
 * A Word document, laid out onto A4 pages — approximately.
 *
 * mammoth turns a .docx into clean semantic HTML (headings, paragraphs,
 * lists, tables, images) and deliberately throws the visual formatting away.
 * That is the right trade for this feature: the point is to mark up what a
 * document *says*, and a faithful Word renderer in the browser does not exist
 * at any size worth shipping. So this lays the semantic blocks out itself —
 * word-wrapped, paginated, with tables as ruled grids — and the Annotator
 * says plainly that the layout is approximate.
 *
 * Pure: text measurement is injected, so the layout is testable in node with
 * a fake measurer and deterministic for a given one.
 */

export interface DocRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type DocTextStyle = 'h1' | 'h2' | 'h3' | 'p' | 'li';

export type DocBlock =
  | { kind: 'text'; style: DocTextStyle; runs: DocRun[]; bullet?: string; depth?: number }
  | { kind: 'image'; src: string; w: number; h: number }
  | { kind: 'row'; cells: DocRun[][]; header?: boolean };

export type DocOp =
  | { t: 'text'; x: number; y: number; text: string; size: number; bold: boolean; italic: boolean }
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill?: boolean }
  | { t: 'image'; x: number; y: number; w: number; h: number; src: string };

export type Measure = (text: string, size: number, bold: boolean, italic: boolean) => number;

export const DOC_PAGE = { w: 595, h: 842 } as const; // A4 portrait, points
export const DOC_MARGIN = 56;
export const DOC_MAX_PAGES = 200;

const SIZE: Record<DocTextStyle, number> = { h1: 20, h2: 16, h3: 13, p: 11, li: 11 };
const AFTER: Record<DocTextStyle, number> = { h1: 10, h2: 8, h3: 6, p: 7, li: 3 };
const CELL_SIZE = 9.5;
const CELL_PAD = 4;
const LINE = 1.35;

interface Token {
  text: string;
  bold: boolean;
  italic: boolean;
}

/** Runs → words, each keeping its run's style. Whitespace collapses. */
function tokens(runs: DocRun[], forceBold = false): Token[] {
  const out: Token[] = [];
  for (const run of runs) {
    for (const word of run.text.split(/\s+/)) {
      if (word) out.push({ text: word, bold: forceBold || !!run.bold, italic: !!run.italic });
    }
  }
  return out;
}

/**
 * Greedy word wrap. A word longer than the whole line is hard-broken by
 * characters rather than overflowing the page edge.
 */
export function wrapTokens(
  toks: Token[],
  width: number,
  size: number,
  measure: Measure,
): { words: Token[]; widths: number[] }[] {
  const lines: { words: Token[]; widths: number[] }[] = [];
  let cur: Token[] = [];
  let widths: number[] = [];
  let used = 0;
  const space = measure(' ', size, false, false);
  const push = () => {
    if (cur.length) lines.push({ words: cur, widths });
    cur = [];
    widths = [];
    used = 0;
  };
  for (const tok of toks) {
    let w = measure(tok.text, size, tok.bold, tok.italic);
    if (w > width) {
      // Hard-break an unbreakable run (a URL, a long number).
      push();
      let piece = '';
      for (const ch of tok.text) {
        const next = piece + ch;
        if (piece && measure(next, size, tok.bold, tok.italic) > width) {
          lines.push({ words: [{ ...tok, text: piece }], widths: [measure(piece, size, tok.bold, tok.italic)] });
          piece = ch;
        } else piece = next;
      }
      if (piece) {
        cur = [{ ...tok, text: piece }];
        w = measure(piece, size, tok.bold, tok.italic);
        widths = [w];
        used = w;
      }
      continue;
    }
    const add = cur.length ? space + w : w;
    if (cur.length && used + add > width) push();
    used += cur.length ? space + w : w;
    cur.push(tok);
    widths.push(w);
  }
  push();
  return lines;
}

export interface DocLayout {
  pages: DocOp[][];
  truncated: boolean;
}

export function layoutDoc(blocks: DocBlock[], measure: Measure): DocLayout {
  const pages: DocOp[][] = [[]];
  const left = DOC_MARGIN;
  const width = DOC_PAGE.w - DOC_MARGIN * 2;
  const bottom = DOC_PAGE.h - DOC_MARGIN;
  let y = DOC_MARGIN;
  let truncated = false;
  const page = () => pages[pages.length - 1];
  const newPage = (): boolean => {
    if (pages.length >= DOC_MAX_PAGES) {
      truncated = true;
      return false;
    }
    pages.push([]);
    y = DOC_MARGIN;
    return true;
  };
  const space = (size: number) => measure(' ', size, false, false);

  for (const block of blocks) {
    if (truncated) break;
    if (block.kind === 'text') {
      const size = SIZE[block.style];
      const lh = size * LINE;
      const indent = block.style === 'li' ? 16 + (block.depth ?? 0) * 14 : 0;
      const heading = block.style !== 'p' && block.style !== 'li';
      const lines = wrapTokens(tokens(block.runs, heading), width - indent, size, measure);
      if (!lines.length) {
        y += size * 0.6; // an empty paragraph is still a gap
        continue;
      }
      // Keep a heading with at least the first line after it.
      if (heading && y + lh * 2.5 > bottom && page().length && !newPage()) break;
      lines.forEach((line, li) => {
        if (truncated) return;
        if (y + lh > bottom && !newPage()) return;
        const base = y + size;
        if (li === 0 && block.bullet) {
          page().push({ t: 'text', x: left + indent - 12, y: base, text: block.bullet, size, bold: false, italic: false });
        }
        let x = left + indent;
        line.words.forEach((w, wi) => {
          page().push({ t: 'text', x, y: base, text: w.text, size, bold: w.bold, italic: w.italic });
          x += line.widths[wi] + space(size);
        });
        y += lh;
      });
      y += AFTER[block.style];
      continue;
    }

    if (block.kind === 'image') {
      if (block.w <= 0 || block.h <= 0) continue;
      const maxH = bottom - DOC_MARGIN;
      const s = Math.min(1, width / block.w, maxH / block.h);
      const w = block.w * s;
      const h = block.h * s;
      if (y + h > bottom && page().length && !newPage()) break;
      page().push({ t: 'image', x: left, y, w, h, src: block.src });
      y += h + 8;
      continue;
    }

    // A table row: equal columns, each cell wrapped inside its own box.
    const n = Math.max(1, block.cells.length);
    const cw = width / n;
    const lh = CELL_SIZE * LINE;
    const wrapped = block.cells.map((cell) => wrapTokens(tokens(cell, block.header), cw - CELL_PAD * 2, CELL_SIZE, measure));
    const maxRowH = bottom - DOC_MARGIN;
    const rowLines = Math.max(1, ...wrapped.map((l) => l.length));
    const rowH = Math.min(maxRowH, rowLines * lh + CELL_PAD * 2);
    if (y + rowH > bottom && page().length && !newPage()) break;
    wrapped.forEach((lines, ci) => {
      const x0 = left + ci * cw;
      page().push({ t: 'rect', x: x0, y, w: cw, h: rowH, fill: !!block.header });
      lines.forEach((line, li) => {
        const base = y + CELL_PAD + li * lh + CELL_SIZE;
        if (base > y + rowH - CELL_PAD / 2) return; // clipped — the row hit the page limit
        let x = x0 + CELL_PAD;
        line.words.forEach((w, wi) => {
          page().push({ t: 'text', x, y: base, text: w.text, size: CELL_SIZE, bold: w.bold, italic: w.italic });
          x += line.widths[wi] + space(CELL_SIZE);
        });
      });
    });
    y += rowH;
  }
  return { pages, truncated };
}

/** The canvas font string for an op — shared by the renderer and the measurer. */
export function fontFor(size: number, bold: boolean, italic: boolean): string {
  return `${italic ? 'italic ' : ''}${bold ? '600 ' : '400 '}${size}px Georgia, 'Times New Roman', serif`;
}
