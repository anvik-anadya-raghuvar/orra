/**
 * The rectangle Vik is allowed to be in.
 *
 * The viewport minus the header, the mobile tabbar and the safe areas. Every
 * game that moves him clamps to this, so nothing can put him under the tabbar
 * or behind a notch — which is exactly the sort of thing that only shows up on
 * a real phone, at the worst moment.
 *
 * Measured from the live layout rather than assumed, because the tabbar only
 * exists below 640px and the safe area only exists on some devices.
 */
import { useEffect, useState } from 'react';

export interface Bounds {
  width: number;
  height: number;
  /** Space at the bottom he must stay clear of. */
  bottomInset: number;
  topInset: number;
}

/**
 * A rect, but only if the element is actually on screen.
 *
 * The mobile tabbar stays in the DOM at every width and is simply
 * `display:none` above the phone breakpoint — a `display:none` element's
 * `getBoundingClientRect()` comes back as all zeros, not "absent". Trusting
 * that blindly turned "how much room is there at the bottom" into "none of
 * it", on every desktop and tablet screen: the safe rect collapsed to
 * nothing and hide-and-seek could never find anywhere to hide. Checking the
 * rect actually has size is the fix.
 */
function visibleRect(el: Element | null): DOMRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0 ? r : null;
}

function measure(): Bounds {
  const tabbar = visibleRect(document.querySelector('.tabbar, [class*="tabbar"]'));
  const header = visibleRect(document.querySelector('header, .topbar, [class*="topbar"]'));
  const vh = window.innerHeight;
  return {
    width: window.innerWidth,
    height: vh,
    bottomInset: tabbar ? Math.max(0, vh - tabbar.top) : 0,
    topInset: header ? Math.max(0, header.bottom) : 0,
  };
}

export function useVikBounds(): Bounds {
  const [bounds, setBounds] = useState<Bounds>(() =>
    typeof window === 'undefined'
      ? { width: 0, height: 0, bottomInset: 0, topInset: 0 }
      : measure(),
  );

  useEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setBounds(measure()));
    };
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return bounds;
}
