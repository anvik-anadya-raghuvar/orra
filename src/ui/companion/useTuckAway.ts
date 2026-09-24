/**
 * Phone-only: when should Vik get out of the way?
 *
 * On a 375px screen he sat on top of whatever you were working on — in the
 * hands-on test he covered the very screenshot being pinned. So on phones he
 * steps aside whenever you are doing something precise:
 *
 *  - a text field, textarea or contenteditable has focus (you are typing, the
 *    keyboard is up, and the dock is exactly where the caret ends up);
 *  - a modal or sheet is open (every Modal/SideSheet in ui/bits carries
 *    `aria-modal="true"` and is portalled to <body>). His own status panel is
 *    one of those too; it stays up, only the robot behind it steps aside;
 *  - an image is in pin mode (`.pinning` on the surface) or a pin draft is
 *    being written (`.pindraft`).
 *
 * DOM signals rather than a context: the screens that open these never have
 * to know he exists. The observer only runs on phones, and batches to one
 * check per frame.
 */
import { useEffect, useState } from 'react';

const PHONE = '(max-width: 640px)';

function typingInto(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.closest('.companion')) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(
      el.type,
    );
  }
  return false;
}

function busyElsewhere(): boolean {
  const modals = document.querySelectorAll('[aria-modal="true"]');
  for (const m of Array.from(modals)) {
    if (!m.closest('.companion')) return true;
  }
  return document.querySelector('.pinning, .pindraft') != null;
}

export function shouldTuck(): boolean {
  return typingInto(document.activeElement) || busyElsewhere();
}

export function useTuckAway(): { phone: boolean; tucked: boolean } {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(PHONE).matches,
  );
  const [tucked, setTucked] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    if (!phone) {
      setTucked(false);
      return;
    }
    let frame = 0;
    const check = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setTucked(shouldTuck());
      });
    };
    check();
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', check);
    const obs = new MutationObserver(check);
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'aria-modal'],
    });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', check);
      obs.disconnect();
    };
  }, [phone]);

  return { phone, tucked: phone && tucked };
}
