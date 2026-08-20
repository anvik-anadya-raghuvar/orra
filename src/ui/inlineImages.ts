/**
 * A tiny, storage-friendly way to keep images in the flow of an existing text
 * column. The bytes continue to live in the owning image row/JSON value; the
 * text only carries a stable placement marker.
 *
 * Keeping placement separate from the data URL matters for tasks in
 * particular: screenshot rows are still independently annotatable and remain
 * part of the deterministic export, while the brief decides where each one is
 * shown.
 */

export const INLINE_IMAGE_PATTERN = /\{\{anvik-image:([A-Za-z0-9_-]+)\}\}/g;

export type InlineImagePart =
  | { kind: 'text'; text: string; start: number; end: number }
  | { kind: 'image'; id: string; start: number; end: number };

export function inlineImageMarker(id: string): string {
  return `{{anvik-image:${id}}}`;
}

export function splitInlineImages(value: string): InlineImagePart[] {
  const parts: InlineImagePart[] = [];
  let cursor = 0;
  INLINE_IMAGE_PATTERN.lastIndex = 0;
  for (const match of value.matchAll(INLINE_IMAGE_PATTERN)) {
    const start = match.index ?? 0;
    parts.push({ kind: 'text', text: value.slice(cursor, start), start: cursor, end: start });
    parts.push({ kind: 'image', id: match[1], start, end: start + match[0].length });
    cursor = start + match[0].length;
  }
  parts.push({ kind: 'text', text: value.slice(cursor), start: cursor, end: value.length });
  return parts;
}

export function inlineImageIds(value: string): string[] {
  return splitInlineImages(value)
    .filter((part): part is Extract<InlineImagePart, { kind: 'image' }> => part.kind === 'image')
    .map((part) => part.id);
}

/** Old notes/tasks have images but no placement markers. Show those at the end
 * and let the next edit persist that sensible legacy position. */
export function appendMissingInlineImages(value: string, ids: string[]): string {
  const placed = new Set(inlineImageIds(value));
  const missing = ids.filter((id) => !placed.has(id));
  if (!missing.length) return value;
  const gap = value && !value.endsWith('\n') ? '\n' : '';
  return `${value}${gap}${missing.map(inlineImageMarker).join('\n')}`;
}

export function insertInlineImages(
  value: string,
  offset: number,
  ids: string[],
): { value: string; caret: number } {
  if (!ids.length) return { value, caret: Math.min(Math.max(offset, 0), value.length) };
  const at = Math.min(Math.max(offset, 0), value.length);
  const before = value.slice(0, at);
  const after = value.slice(at);
  const prefix = before && !before.endsWith('\n') ? '\n' : '';
  const body = ids.map(inlineImageMarker).join('\n');
  const suffix = after && !after.startsWith('\n') ? '\n' : '';
  const inserted = `${prefix}${body}${suffix}`;
  return { value: `${before}${inserted}${after}`, caret: before.length + inserted.length };
}

export function replaceInlineTextPart(
  value: string,
  part: Extract<InlineImagePart, { kind: 'text' }>,
  text: string,
): string {
  return `${value.slice(0, part.start)}${text}${value.slice(part.end)}`;
}

export function removeInlineImage(value: string, id: string): string {
  const marker = inlineImageMarker(id);
  const at = value.indexOf(marker);
  if (at < 0) return value;
  let start = at;
  let end = at + marker.length;
  // Consume one adjacent separator so removing a block does not leave a run of
  // empty lines in the brief.
  if (value[end] === '\n') end += 1;
  else if (start > 0 && value[start - 1] === '\n') start -= 1;
  return `${value.slice(0, start)}${value.slice(end)}`;
}

/** Plain-text consumers (search snippets and JSON exports) should never leak
 * an internal placement marker. */
export function stripInlineImageMarkers(value: string): string {
  return value
    .replace(/\n?\{\{anvik-image:[A-Za-z0-9_-]+\}\}\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
