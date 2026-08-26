/**
 * Tick boxes written inline in free text.
 *
 * A task's brief is where the steps get written — while you are describing
 * the thing, not after it exists — so the boxes live in the description
 * string itself rather than in a second table. `- [ ] ` and `- [x] ` extend
 * the `- ` bullet marker that `toggleLineMarker` and `FormattedText` already
 * understand, which is why a checklist line still renders as a list item
 * anywhere that has not been taught about boxes yet.
 *
 * Pure and DOM-free on purpose: the same functions read the boxes for the
 * tick strip, flip one when it is clicked, and compute the percentage the
 * board card draws. One definition of "how many of these are done".
 */

/** What the toolbar's checklist button writes. */
export const CHECK_MARKER = '- [ ] ';

/** `- [ ] step`, `- [x] step`, `* [X] step` — leading indent allowed. */
const CHECK_LINE = /^(\s*)([-*])\s\[([ xX])\]\s?(.*)$/;

export interface CheckItem {
  /** Index into the text's `\n`-split lines — the address for a toggle. */
  line: number;
  label: string;
  done: boolean;
}

/**
 * Read one line as a tick box, or null if it is not one.
 *
 * Exported because rendering needs the same answer as reading does, and a
 * renderer that re-derived "is this a checklist line" from its own regex is
 * how a box ends up drawn as a bullet reading "[ ] step".
 */
export function matchChecklistLine(raw: string): { label: string; done: boolean } | null {
  const match = CHECK_LINE.exec(raw ?? '');
  return match ? { label: match[4].trim(), done: match[3] !== ' ' } : null;
}

/** Every tick box in `text`, in the order they were written. */
export function readChecklist(text: string): CheckItem[] {
  const out: CheckItem[] = [];
  (text ?? '').split('\n').forEach((raw, line) => {
    const box = matchChecklistLine(raw);
    if (box) out.push({ line, ...box });
  });
  return out;
}

/**
 * Flip the box on one line and give back the whole text.
 *
 * Addressed by line rather than by label because two steps are allowed to
 * read the same — "chase the invoice" twice is a real checklist — and the
 * one you clicked is the one that should move.
 */
export function toggleChecklistLine(text: string, line: number): string {
  const lines = (text ?? '').split('\n');
  const raw = lines[line];
  if (raw === undefined) return text ?? '';
  const match = CHECK_LINE.exec(raw);
  if (!match) return text ?? '';
  const [, indent, bullet, state, label] = match;
  lines[line] = `${indent}${bullet} [${state === ' ' ? 'x' : ' '}] ${label}`;
  return lines.join('\n');
}

/**
 * How far along a task is, as the board card draws it.
 *
 * The brief's boxes and the subtask rows are counted together because they
 * are the same claim — "this part is finished" — made in two places, and a
 * card that showed only one of them would be wrong for whichever half the
 * writer happened to use. Returns null when there is nothing to count, so
 * the caller can leave a hand-set percentage alone rather than zeroing it.
 */
export function taskProgressPct(
  description: string,
  subtasks: { completed: boolean }[],
): number | null {
  const boxes = readChecklist(description);
  const total = boxes.length + subtasks.length;
  if (!total) return null;
  const done = boxes.filter((b) => b.done).length + subtasks.filter((s) => s.completed).length;
  return Math.round((done / total) * 100);
}
