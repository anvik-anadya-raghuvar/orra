/**
 * Escape goes back one step — never all the way out.
 *
 * Every overlay used to put its own Escape listener on `window`. Listeners on
 * the same target all fire, so a single Escape inside an image viewer or a
 * half-written pin closed the viewer AND the New task sheet behind it,
 * dropping you on the board with the draft gone from view.
 *
 * Now each layer that Escape can close registers here while it is open, and
 * one listener closes only the most recently opened one. A field that handles
 * Escape itself (revert an inline edit, dismiss a picker) calls
 * `event.preventDefault()`, and the stack then leaves the event alone.
 */
import { useEffect, useRef } from 'react';

type Layer = { current: () => void };

const stack: Layer[] = [];

function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  top.current();
}

/** While `active`, Escape calls `onEscape` — but only if this is the top layer. */
export function useEscapeLayer(active: boolean, onEscape: () => void) {
  const handler = useRef(onEscape);
  handler.current = onEscape;

  useEffect(() => {
    if (!active) return undefined;
    const layer: Layer = { current: () => handler.current() };
    if (!stack.length) window.addEventListener('keydown', onKey);
    stack.push(layer);
    return () => {
      const at = stack.indexOf(layer);
      if (at >= 0) stack.splice(at, 1);
      if (!stack.length) window.removeEventListener('keydown', onKey);
    };
  }, [active]);
}
