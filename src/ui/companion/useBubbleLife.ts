/**
 * How long a bubble stays up. The countdown pauses while the pointer is over
 * it or focus is inside it — a moment with a link in it must not expire while
 * you are reaching for the link.
 */
import { useEffect, useRef } from 'react';

/** Exactly the handlers the bubble needs — not the whole HTMLAttributes bag,
 *  which collides with framer's own drag handlers on a motion component. */
export interface BubbleHoverProps {
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocusCapture: () => void;
  onBlurCapture: () => void;
}

interface Options {
  /** The live announcement, or null. Restarts the clock when it changes. */
  ttlMs: number | null;
  onExpire: () => void;
}

export function useBubbleLife({ ttlMs, onExpire }: Options) {
  const pausedRef = useRef(false);

  useEffect(() => {
    if (ttlMs == null) return;
    let deadline = Date.now() + ttlMs;
    const iv = window.setInterval(() => {
      if (pausedRef.current) deadline = Math.max(deadline, Date.now() + 1_200);
      else if (Date.now() >= deadline) onExpire();
    }, 400);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttlMs]);

  const pause = () => (pausedRef.current = true);
  const resume = () => (pausedRef.current = false);

  const hoverProps: BubbleHoverProps = {
    onMouseEnter: pause,
    onMouseLeave: resume,
    onFocusCapture: pause,
    onBlurCapture: resume,
  };

  return { hoverProps };
}
