import { describe, expect, it } from 'vitest';
import {
  effectivePressures,
  finalizePoints,
  inkBytes,
  inkHit,
  makeInk,
  polygonPath,
  radiusAt,
  reconcileInk,
  strokeOutline,
  strokeSvgPath,
  streamline,
  type InkStroke,
} from './ink';
import { clampZoom, fitScale, pageToScreen, renderScale, screenToPage, zoomScroll } from './coords';
import { commit, eraseOp, redo, startHistory, undo } from './history';
import { annotateKind, annotatedName, unsupportedReason } from './kinds';
import {
  SHEET_MAX_PAGES,
  clipCell,
  colLetter,
  columnRuns,
  paginateSheet,
  sheetPageLabel,
} from './sheetPages';
import { DOC_MARGIN, DOC_PAGE, layoutDoc, wrapTokens, type Measure } from './docLayout';
import { hexToRgb01, pageToPdfOps, strokeToPdfOp, viewToUser, type Placement } from './pdfPaths';

const pen = (points: number[], extra: Partial<InkStroke> = {}): InkStroke => ({
  id: 's1',
  tool: 'pen',
  color: '#dc2626',
  size: 3,
  points,
  ...extra,
});

/* ── stroke smoothing and outline ────────────────────────────────────── */

describe('ink outline', () => {
  it('finalizePoints keeps both ends, drops near-duplicates and rounds', () => {
    const raw = [0, 0, 0.5, 0.1, 0.1, 0.5, 0.2, 0.1, 0.5, 10.04, 10.06, 0.777];
    const out = finalizePoints(raw, 0.6);
    expect(out.slice(0, 3)).toEqual([0, 0, 0.5]);
    expect(out.slice(-3)).toEqual([10, 10.1, 0.78]);
    expect(out.length).toBe(6);
  });

  it('streamline never moves the first or last point', () => {
    const pts = [0, 0, 0.5, 10, 0, 0.5, 20, 10, 0.5, 30, 0, 0.5];
    const s = streamline(pts, 0.5);
    expect(s.slice(0, 2)).toEqual([0, 0]);
    expect(s.slice(-3, -1)).toEqual([30, 0]);
    // the middle is pulled back towards its predecessor
    expect(s[3]).toBeLessThan(10);
  });

  it('pressure widens the nib; thinning 0 keeps it constant', () => {
    expect(radiusAt(4, 1, 0.6)).toBeGreaterThan(radiusAt(4, 0.2, 0.6));
    expect(radiusAt(4, 1, 0)).toBe(radiusAt(4, 0.1, 0));
    expect(radiusAt(4, 0.5, 0.6)).toBeCloseTo(2);
  });

  it('simulated pressure thins fast strokes and is deterministic', () => {
    const slow = [0, 0, 0.5, 1, 0, 0.5, 2, 0, 0.5, 3, 0, 0.5, 4, 0, 0.5];
    const fast = [0, 0, 0.5, 40, 0, 0.5, 80, 0, 0.5, 120, 0, 0.5, 160, 0, 0.5];
    const ps = effectivePressures(slow, 3, true);
    const pf = effectivePressures(fast, 3, true);
    expect(pf[4]).toBeLessThan(ps[4]);
    expect(effectivePressures(fast, 3, true)).toEqual(pf);
  });

  it('a real pen pressure of 0 is clamped, never a zero-width line', () => {
    const p = effectivePressures([0, 0, 0, 5, 5, 0], 3, false);
    expect(Math.min(...p)).toBeGreaterThan(0);
  });

  it('a tap is a dot, a line is a closed outline around it', () => {
    const dot = strokeOutline(pen([10, 10, 0.5]));
    expect(dot.length).toBe(24);
    const line = strokeOutline(pen([0, 0, 0.5, 50, 0, 0.5, 100, 0, 0.5]));
    const ys = line.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ys)).toBeGreaterThan(0);
    expect(Math.min(...ys)).toBeLessThan(0);
    const xs = line.filter((_, i) => i % 2 === 0);
    // round caps reach past both ends
    expect(Math.min(...xs)).toBeLessThan(0);
    expect(Math.max(...xs)).toBeGreaterThan(100);
  });

  it('svg path is closed and identical for identical input', () => {
    const s = pen([0, 0, 0.3, 20, 5, 0.8, 40, 0, 0.6]);
    const a = strokeSvgPath(s);
    expect(a.startsWith('M')).toBe(true);
    expect(a.endsWith('Z')).toBe(true);
    expect(strokeSvgPath({ ...s })).toBe(a);
    expect(polygonPath([1, 2])).toBe('');
  });

  it('eraser hits within reach and misses outside it', () => {
    const s = pen([0, 0, 0.5, 100, 0, 0.5]);
    expect(inkHit(s, 50, 5, 4)).toBe(true);
    expect(inkHit(s, 50, 20, 4)).toBe(false);
  });

  it('reconcileInk rescales to re-measured pages and drops vanished pages', () => {
    const stored = makeInk([{ w: 100, h: 100 }, { w: 100, h: 100 }]);
    stored.strokes[0] = [pen([50, 50, 0.5])];
    stored.strokes[1] = [pen([10, 10, 0.5])];
    const out = reconcileInk(stored, [{ w: 200, h: 100 }]);
    expect(out.strokes).toHaveLength(1);
    expect(out.strokes[0][0].points).toEqual([100, 50, 0.5]);
    expect(reconcileInk('garbage', [{ w: 1, h: 1 }]).strokes).toEqual([[]]);
    expect(inkBytes(out)).toBeGreaterThan(0);
  });
});

/* ── page ↔ screen ───────────────────────────────────────────────────── */

describe('coordinates', () => {
  const rect = { left: 100, top: 50, width: 297.5, height: 421 };

  it('maps screen to page units and back exactly', () => {
    const p = screenToPage(100 + 297.5 / 2, 50 + 421, rect, 595, 842);
    expect(p.x).toBeCloseTo(297.5);
    expect(p.y).toBeCloseTo(842);
    const s = pageToScreen(p.x, p.y, rect, 595, 842);
    expect(s.x).toBeCloseTo(100 + 297.5 / 2);
    expect(s.y).toBeCloseTo(471);
  });

  it('top-left of the page is the origin at any zoom', () => {
    expect(screenToPage(100, 50, { ...rect, width: 1190, height: 1684 }, 595, 842)).toEqual({ x: 0, y: 0 });
  });

  it('fit, clamp, zoom-around-anchor and canvas caps', () => {
    expect(fitScale([{ w: 595 }, { w: 842 }], 866, 24)).toBeCloseTo(1);
    expect(clampZoom(10)).toBe(4);
    expect(clampZoom(0.01)).toBe(0.5);
    expect(clampZoom(Number.NaN)).toBe(1);
    // anchor point stays put: content at (100+200)/1 = 300 → 300*2 - 200
    expect(zoomScroll(100, 200, 1, 2)).toBe(400);
    const s = renderScale(595, 842, 10, 3, 12_000_000);
    expect(595 * 842 * s * s).toBeLessThanOrEqual(12_000_001);
    expect(renderScale(595, 842, 1, 2)).toBe(2);
  });
});

/* ── undo / redo ─────────────────────────────────────────────────────── */

describe('history', () => {
  it('add, erase, undo and redo restore exact order', () => {
    let h = startHistory(makeInk([{ w: 10, h: 10 }]));
    const a = pen([1, 1, 0.5], { id: 'a' });
    const b = pen([5, 5, 0.5], { id: 'b' });
    const c = pen([9, 9, 0.5], { id: 'c' });
    h = commit(h, { type: 'add', page: 0, stroke: a });
    h = commit(h, { type: 'add', page: 0, stroke: b });
    h = commit(h, { type: 'add', page: 0, stroke: c });
    h = commit(h, eraseOp(h.ink, 0, (s) => s.id === 'b'));
    expect(h.ink.strokes[0].map((s) => s.id)).toEqual(['a', 'c']);
    h = undo(h);
    expect(h.ink.strokes[0].map((s) => s.id)).toEqual(['a', 'b', 'c']);
    h = undo(h);
    expect(h.ink.strokes[0].map((s) => s.id)).toEqual(['a', 'b']);
    h = redo(h);
    h = redo(h);
    expect(h.ink.strokes[0].map((s) => s.id)).toEqual(['a', 'c']);
    // a new op clears redo
    h = undo(h);
    h = commit(h, { type: 'add', page: 0, stroke: pen([2, 2, 0.5], { id: 'd' }) });
    expect(h.redo).toHaveLength(0);
  });

  it('an erase that hit nothing is not an undo step', () => {
    const h = startHistory(makeInk([{ w: 10, h: 10 }]));
    expect(commit(h, eraseOp(h.ink, 0, () => false))).toBe(h);
  });
});

/* ── file kinds ──────────────────────────────────────────────────────── */

describe('kinds', () => {
  it('recognises what can be drawn on', () => {
    expect(annotateKind('a.PDF')).toBe('pdf');
    expect(annotateKind('b.xlsx')).toBe('xlsx');
    expect(annotateKind('c.docx')).toBe('docx');
    expect(annotateKind('d.jpeg')).toBe('image');
    expect(annotateKind('blob', 'image/png')).toBe('image');
    expect(annotateKind('e.doc')).toBeNull();
    expect(annotateKind('f.heic', 'image/heic')).toBeNull();
    expect(unsupportedReason('e.doc')).toMatch(/PDF/);
  });

  it('names the flattened copy', () => {
    expect(annotatedName('Lease.pdf')).toBe('Lease.annotated.pdf');
    expect(annotatedName('Lease.annotated.pdf')).toBe('Lease.annotated.pdf');
    expect(annotatedName('scan')).toBe('scan.annotated.pdf');
    expect(annotatedName('fees.2026.xlsx')).toBe('fees.2026.annotated.pdf');
  });
});

/* ── xlsx pagination ─────────────────────────────────────────────────── */

describe('sheet pagination', () => {
  const sheet = (cols: number, rows: number, width = 5) => {
    const headers = Array.from({ length: cols }, (_, i) => `H${i}`);
    return {
      headers,
      rows: Array.from({ length: rows }, (_, r) =>
        Object.fromEntries(headers.map((h) => [h, 'x'.repeat(width) + r])),
      ),
    };
  };

  it('fits a small sheet on one page', () => {
    const l = paginateSheet(sheet(3, 10));
    expect(l.pages).toEqual([{ rowStart: 0, rowEnd: 10, colStart: 0, colEnd: 3 }]);
  });

  it('breaks rows down, then columns over, with no row lost', () => {
    const s = sheet(12, 100, 40);
    const l = paginateSheet(s);
    const runs = new Set(l.pages.map((p) => `${p.colStart}-${p.colEnd}`));
    expect(runs.size).toBeGreaterThan(1);
    // down-then-over: the first pages share the first column run
    expect(l.pages[0].colStart).toBe(0);
    expect(l.pages[1].colStart).toBe(0);
    const firstRun = l.pages.filter((p) => p.colStart === 0);
    const covered = firstRun.reduce((n, p) => n + (p.rowEnd - p.rowStart), 0);
    expect(covered).toBe(100);
    expect(l.pages.every((p) => p.rowEnd - p.rowStart <= l.rowsPerPage)).toBe(true);
  });

  it('caps absurd sheets and says so', () => {
    const l = paginateSheet(sheet(2, 20000));
    expect(l.pages).toHaveLength(SHEET_MAX_PAGES);
    expect(l.truncated).toBe(true);
  });

  it('an empty sheet is still one page', () => {
    expect(paginateSheet({ headers: [], rows: [] }).pages).toHaveLength(1);
  });

  it('column runs, clipping and labels', () => {
    expect(columnRuns([100, 100, 100], 250)).toEqual([[0, 2], [2, 3]]);
    expect(columnRuns([400], 250)).toEqual([[0, 1]]);
    expect(clipCell('hello world', 1000)).toBe('hello world');
    expect(clipCell('hello world', 40).endsWith('…')).toBe(true);
    expect(colLetter(0)).toBe('A');
    expect(colLetter(27)).toBe('AB');
    expect(sheetPageLabel({ rowStart: 0, rowEnd: 30, colStart: 0, colEnd: 4 }, 0, 3)).toBe(
      'Page 1 of 3 · rows 1–30 · columns A–D',
    );
  });
});

/* ── docx layout ─────────────────────────────────────────────────────── */

describe('doc layout', () => {
  const measure: Measure = (text, size) => text.length * size * 0.5;

  it('wraps words within the width and hard-breaks a monster word', () => {
    const lines = wrapTokens(
      [{ text: 'aaaa', bold: false, italic: false }, { text: 'bbbb', bold: false, italic: false }],
      30,
      10,
      measure,
    );
    expect(lines).toHaveLength(2);
    const long = wrapTokens([{ text: 'x'.repeat(50), bold: false, italic: false }], 50, 10, measure);
    expect(long.length).toBeGreaterThan(1);
  });

  it('paginates long text and keeps every op inside the margins', () => {
    const para = { kind: 'text' as const, style: 'p' as const, runs: [{ text: 'word '.repeat(400) }] };
    const out = layoutDoc([para, para, para], measure);
    expect(out.pages.length).toBeGreaterThan(1);
    for (const ops of out.pages) {
      for (const op of ops) {
        expect(op.y).toBeLessThanOrEqual(DOC_PAGE.h - DOC_MARGIN + 0.01);
        expect(op.x).toBeGreaterThanOrEqual(DOC_MARGIN - 12);
      }
    }
  });

  it('lays out a table row as ruled cells and scales images to fit', () => {
    const out = layoutDoc(
      [
        { kind: 'row', header: true, cells: [[{ text: 'Name' }], [{ text: 'Amount' }]] },
        { kind: 'image', src: 'data:image/png;base64,x', w: 2000, h: 1000 },
      ],
      measure,
    );
    const ops = out.pages[0];
    expect(ops.filter((o) => o.t === 'rect')).toHaveLength(2);
    const img = ops.find((o) => o.t === 'image');
    expect(img && img.t === 'image' && img.w).toBeCloseTo(DOC_PAGE.w - DOC_MARGIN * 2);
  });
});

/* ── strokes → pdf-lib paths ─────────────────────────────────────────── */

describe('pdf paths', () => {
  const box = { x: 0, y: 0, width: 600, height: 800 };
  const place = (rotation: number, b = box): Placement => {
    const shown = rotation % 180 ? { w: b.height, h: b.width } : { w: b.width, h: b.height };
    return { box: b, rotation, inkW: shown.w, inkH: shown.h };
  };

  it('maps the shown top-left corner correctly for every rotation', () => {
    expect(viewToUser(0, 0, place(0))).toEqual({ x: 0, y: 800 });
    expect(viewToUser(0, 0, place(90))).toEqual({ x: 0, y: 0 });
    expect(viewToUser(0, 0, place(180))).toEqual({ x: 600, y: 0 });
    expect(viewToUser(0, 0, place(270))).toEqual({ x: 600, y: 800 });
    expect(viewToUser(0, 0, place(-90))).toEqual({ x: 600, y: 800 });
  });

  it('respects a crop box offset and rescales ink drawn at a different size', () => {
    const b = { x: 20, y: 30, width: 600, height: 800 };
    expect(viewToUser(10, 10, place(0, b))).toEqual({ x: 30, y: 820 });
    const half: Placement = { box, rotation: 0, inkW: 300, inkH: 400 };
    expect(viewToUser(150, 200, half)).toEqual({ x: 300, y: 400 });
  });

  it('produces a deterministic, y-flipped path with the right paint', () => {
    const s = pen([100, 100, 0.5, 200, 120, 0.7, 300, 100, 0.4]);
    const a = strokeToPdfOp(s, place(0));
    const b = strokeToPdfOp({ ...s, points: s.points.slice() }, place(0));
    expect(a).toEqual(b);
    expect(a!.d.startsWith('M')).toBe(true);
    // user y = 800 - ~100 → written as about -700
    expect(a!.d).toMatch(/-69\d/);
    expect(a!.color).toEqual(hexToRgb01('#dc2626'));
    expect(a!.opacity).toBe(1);
  });

  it('draws highlighters first, translucent and multiplied', () => {
    const ops = pageToPdfOps(
      [pen([0, 0, 0.5, 10, 10, 0.5]), pen([0, 0, 0.5, 10, 0, 0.5], { id: 'h', tool: 'highlighter', color: '#facc15', size: 16 })],
      place(0),
    );
    expect(ops[0].multiply).toBe(true);
    expect(ops[0].opacity).toBeLessThan(1);
    expect(ops[1].multiply).toBe(false);
  });

  it('parses hex colours to 0–1 channels', () => {
    expect(hexToRgb01('#ffffff')).toEqual({ r: 1, g: 1, b: 1 });
    expect(hexToRgb01('nonsense')).toEqual(hexToRgb01('#111827'));
  });
});
