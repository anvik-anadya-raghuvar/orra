/**
 * The DOM half of text formatting. Every button in FormatToolbar, and every
 * formatting keyboard shortcut, ends up here.
 *
 * The bug this exists to fix: a controlled `<textarea>` whose value is
 * replaced by React state (`element.value = nextValue` under the hood) never
 * enters the browser's native undo stack. Click Bold, press Ctrl+Z, and
 * nothing happens — or worse, it undoes something from before you ever
 * touched the toolbar. `document.execCommand('insertText', …)` is the one
 * remaining way to mutate a textarea's value that the browser itself
 * records as an undoable edit, indistinguishable from typing. So every
 * formatting action here selects the affected range and re-inserts the new
 * text through execCommand; the resulting native `input` event is what
 * actually updates React state, via whatever `onChange` the textarea
 * already has. `onValue` is only a fallback for the rare environment where
 * execCommand is unavailable (older engines, some automated test runners).
 *
 * A plain function, not a hook — it holds no state of its own, so it is
 * safe to construct fresh on every render, including inside a `.map()`
 * (InlineImageEditor renders one text part per split image).
 */
import type { KeyboardEvent, RefObject } from 'react';
import { applyInlineFormat, insertInlineToken, toggleLineMarker, type SelectionEdit } from '../lib/textFormat';

export interface TextFormatting {
  apply: (before: string, after?: string, placeholder?: string) => void;
  insert: (token: string) => void;
  bullet: () => void;
}

function selectionOf(element: HTMLTextAreaElement | null, fallbackLength: number): [number, number] {
  if (!element) return [fallbackLength, fallbackLength];
  return [element.selectionStart ?? fallbackLength, element.selectionEnd ?? fallbackLength];
}

/** Replace the textarea's entire content through execCommand, so the whole
 *  edit — however it was computed — lands as one native undo step. */
function commit(
  element: HTMLTextAreaElement | null,
  result: SelectionEdit,
  onValue: (value: string, selectionStart: number, selectionEnd: number) => void,
): void {
  if (element) {
    element.focus();
    element.setSelectionRange(0, element.value.length);
    const native = typeof document.execCommand === 'function' && document.execCommand('insertText', false, result.value);
    if (native) {
      element.setSelectionRange(result.selectionStart, result.selectionEnd);
      return;
    }
  }
  onValue(result.value, result.selectionStart, result.selectionEnd);
}

export function createTextFormatting(
  textarea: RefObject<HTMLTextAreaElement>,
  value: string,
  onValue: (value: string, selectionStart: number, selectionEnd: number) => void,
): TextFormatting {
  return {
    apply: (before, after = before, placeholder = 'text') => {
      const element = textarea.current;
      const [start, end] = selectionOf(element, value.length);
      commit(element, applyInlineFormat(value, start, end, before, after, placeholder), onValue);
    },
    insert: (token) => {
      const element = textarea.current;
      const [start, end] = selectionOf(element, value.length);
      commit(element, insertInlineToken(value, start, end, token), onValue);
    },
    bullet: () => {
      const element = textarea.current;
      const [start, end] = selectionOf(element, value.length);
      commit(element, toggleLineMarker(value, start, end), onValue);
    },
  };
}

/** Ctrl/Cmd+B, +I, +U — the formatting shortcuts every text editor has.
 *  Returns true when it handled the key, so the caller can stop there. */
export function applyFormatShortcut(event: KeyboardEvent, formatting: TextFormatting): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  const key = event.key.toLowerCase();
  if (key === 'b') formatting.apply('**');
  else if (key === 'i') formatting.apply('_');
  else if (key === 'u') formatting.apply('__');
  else return false;
  event.preventDefault();
  return true;
}
