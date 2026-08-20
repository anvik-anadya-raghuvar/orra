import type { Page, PageBlock } from '../../types';

export const MAX_BLOCK_INDENT = 6;

export interface SelectionEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

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

export function clampIndent(indent: number | undefined): number {
  return Math.max(0, Math.min(MAX_BLOCK_INDENT, indent ?? 0));
}

export function withIndent(block: PageBlock, delta: -1 | 1): PageBlock {
  return { ...block, indent: clampIndent(clampIndent(block.indent) + delta) };
}

/** A collapsed toggle hides every following block that is more deeply indented. */
export function isBlockHidden(blocks: PageBlock[], index: number): boolean {
  const indent = clampIndent(blocks[index]?.indent);
  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = blocks[i];
    const candidateIndent = clampIndent(candidate.indent);
    if (candidateIndent >= indent) continue;
    if (candidate.type === 'toggle' && candidate.collapsed) return true;
    return isBlockHidden(blocks, i);
  }
  return false;
}

/** The contiguous descendant range belonging to a block in the flat outline. */
export function descendantEnd(blocks: PageBlock[], index: number): number {
  const indent = clampIndent(blocks[index]?.indent);
  let end = index + 1;
  while (end < blocks.length && clampIndent(blocks[end].indent) > indent) end += 1;
  return end;
}

export function duplicateBlocks(
  blocks: PageBlock[],
  selectedIds: Set<string>,
  makeId: () => string,
): PageBlock[] {
  if (!selectedIds.size) return blocks;
  const out: PageBlock[] = [];
  for (const block of blocks) {
    out.push(block);
    if (selectedIds.has(block.id)) out.push({ ...block, id: makeId() });
  }
  return out;
}

export function parseSimpleTable(value: string): string[][] {
  const rows = value.split('\n').map((row) => row.split('\t'));
  const width = Math.max(2, ...rows.map((row) => row.length));
  return rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));
}

export function serializeSimpleTable(rows: string[][] | undefined): string {
  return (rows?.length ? rows : [['', ''], ['', '']]).map((row) => row.join('\t')).join('\n');
}

export function pageBreadcrumbs(page: Page, pages: Page[]): Page[] {
  const byId = new Map(pages.map((candidate) => [candidate.id, candidate]));
  const trail: Page[] = [page];
  const seen = new Set([page.id]);
  let parent = page.parent_page_id;
  while (parent && !seen.has(parent)) {
    const candidate = byId.get(parent);
    if (!candidate) break;
    trail.unshift(candidate);
    seen.add(candidate.id);
    parent = candidate.parent_page_id;
  }
  return trail;
}

export function pageBacklinks(pageId: string, pages: Page[]): Page[] {
  const marker = `[[page:${pageId}|`;
  return pages.filter((page) =>
    page.blocks.some(
      (block) =>
        block.page_id === pageId ||
        (typeof block.text === 'string' && block.text.includes(marker)) ||
        block.items?.some((item) => item.text.includes(marker)),
    ),
  );
}

export function isVerificationCurrent(page: Page, now = Date.now()): boolean {
  if (!page.verified_at) return false;
  if (!page.verification_expires_at) return true;
  return new Date(page.verification_expires_at).getTime() > now;
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
