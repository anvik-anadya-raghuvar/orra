/**
 * Vik noticing what you are doing elsewhere in the portal.
 *
 * Deliberately small reactions to things that happen a lot: a nudge while you
 * type, a look while you drag a card, a thinking face while you search. The
 * temptation with all of these is to make them bigger, which turns a companion
 * into a distraction — the whole set is one 260ms bounce and two expression
 * changes.
 *
 * Every listener is passive, document-level and rAF-coalesced, and all of them
 * are suppressed while anything else has the floor. Typing is the one that
 * would otherwise fire hundreds of times a minute, so it is throttled hard.
 */
import { useEffect } from 'react';
import type { Gesture } from '../../lib/companionPose';

/** A keystroke nudge at most this often — typing is not a drum solo. */
const TYPE_THROTTLE_MS = 2_400;

/** Where the portal's search inputs live. */
const SEARCH = 'input[type="search"], .srch input, input[class*="srch"], input[placeholder*="Search" i]';
/** A board card being dragged. */
const CARD = '.wk-slot';

export type Reaction = 'typing' | 'searching' | 'dragging' | null;

interface Options {
  enabled: boolean;
  doGesture: (g: Gesture) => void;
  /** Read at fire time — nothing here interrupts anything that matters. */
  busy: () => boolean;
  onReaction: (r: Reaction) => void;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

export function useAppReactions({ enabled, doGesture, busy, onReaction }: Options) {
  useEffect(() => {
    if (!enabled) return;
    let lastType = 0;
    let clearTimer = 0;

    const settle = (ms: number) => {
      window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(() => onReaction(null), ms);
    };

    const onKey = (e: KeyboardEvent) => {
      if (!isTypingTarget(e.target) || busy()) return;
      const now = Date.now();
      if (now - lastType < TYPE_THROTTLE_MS) return;
      lastType = now;
      doGesture('bounce');
      onReaction('typing');
      settle(2_000);
    };

    const onFocusIn = (e: FocusEvent) => {
      if (busy()) return;
      const el = e.target as HTMLElement | null;
      if (el?.matches?.(SEARCH)) {
        onReaction('searching');
        settle(6_000);
      }
    };

    const onDragStart = (e: Event) => {
      if (busy()) return;
      const el = e.target as HTMLElement | null;
      if (!el?.closest?.(CARD)) return;
      onReaction('dragging');
      settle(4_000);
    };
    const onDragEnd = () => settle(400);

    document.addEventListener('keydown', onKey, { passive: true });
    document.addEventListener('focusin', onFocusIn, { passive: true });
    document.addEventListener('dragstart', onDragStart, { passive: true });
    document.addEventListener('dragend', onDragEnd, { passive: true });
    return () => {
      window.clearTimeout(clearTimer);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('dragstart', onDragStart);
      document.removeEventListener('dragend', onDragEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
