/**
 * Pure text-editing helpers shared by every free-text surface in the app —
 * wiki blocks, notes, and task descriptions all wrap a plain-text value in
 * the same lightweight markdown, so the string manipulation lives in one
 * place rather than being reinvented per screen.
 *
 * These functions never touch the DOM. The DOM side (which has to go
 * through `document.execCommand` so the browser's native undo/redo stack
 * stays intact) lives in `src/ui/textFormatting.ts`.
 */

export interface SelectionEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/** The palette this app already uses everywhere else (pills, warmth, tags) —
 *  reused here rather than inventing a second color system. */
export const FORMAT_COLORS: { key: string; label: string }[] = [
  { key: 'teal', label: 'Teal' },
  { key: 'sky', label: 'Sky' },
  { key: 'violet', label: 'Violet' },
  { key: 'indigo', label: 'Indigo' },
  { key: 'stamp', label: 'Amber' },
  { key: 'rose', label: 'Rose' },
];

export const FORMAT_SIZES: { key: string; label: string }[] = [
  { key: 'sm', label: 'Small' },
  { key: 'lg', label: 'Large' },
];

export function applyInlineFormat(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  before: string,
  after = before,
  placeholder = 'text',
): SelectionEdit {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const selected = value.slice(start, end) || placeholder;
  const inserted = `${before}${selected}${after}`;
  return {
    value: `${value.slice(0, start)}${inserted}${value.slice(end)}`,
    selectionStart: start + before.length,
    selectionEnd: start + before.length + selected.length,
  };
}

export function insertInlineToken(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  token: string,
): SelectionEdit {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const next = `${value.slice(0, start)}${token}${value.slice(end)}`;
  const caret = start + token.length;
  return { value: next, selectionStart: caret, selectionEnd: caret };
}

/**
 * Toggle a line-start marker (default `- `, a bullet) across every line the
 * selection touches. Blank lines are left alone. If every non-blank line in
 * range already carries the marker, it is removed instead — the same toggle
 * behaviour as the wiki's list block.
 */
export function toggleLineMarker(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  marker = '- ',
): SelectionEdit {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const searchFrom = Math.max(end - 1, lineStart);
  const nextBreak = value.indexOf('\n', searchFrom);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  const lines = value.slice(lineStart, lineEnd).split('\n');
  const marked = lines.filter((line) => line.trim());
  const allMarked = marked.length > 0 && marked.every((line) => line.startsWith(marker));
  const nextLines = lines.map((line) => {
    if (!line.trim()) return line;
    return allMarked ? line.slice(marker.length) : `${marker}${line}`;
  });
  const nextBlock = nextLines.join('\n');
  return {
    value: `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart + nextBlock.length,
  };
}

export function isSafeExternalUrl(value: string | undefined): boolean {
  if (!value) return false;
  if (!/^(https?:\/\/|mailto:)/i.test(value.trim())) return false;
  try {
    const url = new URL(value, 'https://anvik.local');
    return ['http:', 'https:', 'mailto:'].includes(url.protocol);
  } catch {
    return false;
  }
}
