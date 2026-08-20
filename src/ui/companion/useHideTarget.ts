/**
 * Finding somewhere on the real page for him to hide.
 *
 * The choosing is pure (lib/companionGames/hideSeek.ts); this measures the
 * actual DOM and keeps the chosen rectangle current while you look for him.
 *
 * He cannot literally go behind a card — the companion layer is fixed at z-72
 * and the cards are in normal flow — so he is placed above the card's top edge
 * and clipped to his top half. That reads exactly like peeking, and unlike
 * colour-matching a mask strip it stays correct on translucent surfaces, which
 * several of ours are.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { peekAt, pickHideTarget, type Box } from '../../lib/companionGames/hideSeek';
import type { Bounds } from './useVikBounds';

/**
 * Where he might hide. Verified to exist: `.bt` is the Home bento tile and
 * `.wk-slot` the board card wrapper. `[data-vik-hide]` is the escape hatch for
 * anywhere that turns out to want opting in later.
 */
const SELECTOR = '[data-vik-hide], .bt, .wk-slot, .kn-ov-panel, .panel, .pcard';
const MODAL = '[aria-modal="true"], [role="dialog"], .modal, .sheet';

/** Stable enough to compare across a re-measure, cheap enough to compute. */
function keyFor(el: Element, index: number): string {
  const id = el.getAttribute('data-vik-hide') || el.getAttribute('data-key') || el.id;
  return id ? `k:${id}` : `i:${index}:${el.className}`;
}

function collect(): { boxes: Box[]; els: Map<string, Element> } {
  const els = new Map<string, Element>();
  const boxes: Box[] = [];
  document.querySelectorAll(SELECTOR).forEach((el, i) => {
    if (el.closest(MODAL)) return;
    const r = el.getBoundingClientRect();
    const key = keyFor(el, i);
    els.set(key, el);
    boxes.push({ key, top: r.top, left: r.left, width: r.width, height: r.height });
  });
  return { boxes, els };
}

export interface HidingSpot {
  key: string;
  left: number;
  top: number;
}

export function useHideTarget(bounds: Bounds, spriteW: number, spriteH: number) {
  const [spot, setSpot] = useState<HidingSpot | null>(null);
  const elRef = useRef<Element | null>(null);
  const keyRef = useRef<string | null>(null);

  const place = useCallback(() => {
    const el = elRef.current;
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const box: Box = { key: keyRef.current!, top: r.top, left: r.left, width: r.width, height: r.height };
    // Scrolled out of view, or the card grew past the edges: no longer usable.
    if (r.top < 0 || r.top + r.height > bounds.height - bounds.bottomInset) return false;
    setSpot({ key: box.key, ...peekAt(box, spriteW, spriteH) });
    return true;
  }, [bounds.height, bounds.bottomInset, spriteW, spriteH]);

  /** Choose a place. Returns its key, or null if the page has nowhere. */
  const choose = useCallback(
    (seed: number, exclude?: string): string | null => {
      const { boxes, els } = collect();
      const view = { width: bounds.width, height: bounds.height, bottomInset: bounds.bottomInset };
      const box = pickHideTarget(boxes, view, seed, exclude);
      if (!box) {
        elRef.current = null;
        keyRef.current = null;
        setSpot(null);
        return null;
      }
      elRef.current = els.get(box.key) ?? null;
      keyRef.current = box.key;
      setSpot({ key: box.key, ...peekAt(box, spriteW, spriteH) });
      return box.key;
    },
    [bounds.width, bounds.height, bounds.bottomInset, spriteW, spriteH],
  );

  const clear = useCallback(() => {
    elRef.current = null;
    keyRef.current = null;
    setSpot(null);
  }, []);

  // Keep the rectangle current while you look. Passive and rAF-coalesced: a
  // scroll handler that forces layout on every frame is worse than no game.
  useEffect(() => {
    if (!spot) return;
    let raf = 0;
    let lost = false;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (lost) return;
        if (!place()) {
          lost = true;
          setSpot(null);
        }
      });
    };
    window.addEventListener('scroll', update, { passive: true, capture: true });
    window.addEventListener('resize', update);
    const ro = elRef.current ? new ResizeObserver(update) : null;
    if (ro && elRef.current) ro.observe(elRef.current);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [spot?.key, place]);

  return { spot, choose, clear };
}
