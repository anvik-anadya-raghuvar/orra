/**
 * Undo and redo for ink, as a pure reducer.
 *
 * Operations rather than snapshots: a snapshot per stroke on a 40-page PDF is
 * 40 arrays copied per pen-lift, while an op is one stroke. Erasing records
 * each removed stroke with the index it came from, so undo puts it back in
 * the same z-order rather than on top.
 */
import type { InkData, InkStroke } from './ink';

export type InkOp =
  | { type: 'add'; page: number; stroke: InkStroke }
  | { type: 'erase'; page: number; removed: { stroke: InkStroke; index: number }[] }
  | { type: 'clear'; page: number; removed: InkStroke[] };

export interface InkHistory {
  ink: InkData;
  undo: InkOp[];
  redo: InkOp[];
}

/** How far back undo reaches. Old ops fall off; the ink itself stays. */
export const HISTORY_LIMIT = 200;

export function startHistory(ink: InkData): InkHistory {
  return { ink, undo: [], redo: [] };
}

function withLayer(ink: InkData, page: number, layer: InkStroke[]): InkData {
  const strokes = ink.strokes.slice();
  strokes[page] = layer;
  return { ...ink, strokes };
}

function apply(ink: InkData, op: InkOp): InkData {
  const layer = ink.strokes[op.page] ?? [];
  if (op.type === 'add') return withLayer(ink, op.page, [...layer, op.stroke]);
  if (op.type === 'clear') return withLayer(ink, op.page, []);
  const gone = new Set(op.removed.map((r) => r.stroke.id));
  return withLayer(ink, op.page, layer.filter((s) => !gone.has(s.id)));
}

function revert(ink: InkData, op: InkOp): InkData {
  const layer = ink.strokes[op.page] ?? [];
  if (op.type === 'add') return withLayer(ink, op.page, layer.filter((s) => s.id !== op.stroke.id));
  if (op.type === 'clear') return withLayer(ink, op.page, op.removed.slice());
  const next = layer.slice();
  // Ascending index order, so each insert lands where it originally was.
  for (const r of [...op.removed].sort((a, b) => a.index - b.index)) {
    next.splice(Math.min(r.index, next.length), 0, r.stroke);
  }
  return withLayer(ink, op.page, next);
}

/** Record and apply a new operation. Clears redo, as every editor does. */
export function commit(h: InkHistory, op: InkOp): InkHistory {
  if (op.type === 'erase' && !op.removed.length) return h;
  if (op.type === 'clear' && !op.removed.length) return h;
  const undo = [...h.undo, op];
  if (undo.length > HISTORY_LIMIT) undo.shift();
  return { ink: apply(h.ink, op), undo, redo: [] };
}

export function undo(h: InkHistory): InkHistory {
  const op = h.undo[h.undo.length - 1];
  if (!op) return h;
  return { ink: revert(h.ink, op), undo: h.undo.slice(0, -1), redo: [...h.redo, op] };
}

export function redo(h: InkHistory): InkHistory {
  const op = h.redo[h.redo.length - 1];
  if (!op) return h;
  return { ink: apply(h.ink, op), undo: [...h.undo, op], redo: h.redo.slice(0, -1) };
}

/** The erase op for strokes on `page` matching `hit`, with their indices. */
export function eraseOp(ink: InkData, page: number, hit: (s: InkStroke) => boolean): InkOp {
  const removed: { stroke: InkStroke; index: number }[] = [];
  (ink.strokes[page] ?? []).forEach((stroke, index) => {
    if (hit(stroke)) removed.push({ stroke, index });
  });
  return { type: 'erase', page, removed };
}
