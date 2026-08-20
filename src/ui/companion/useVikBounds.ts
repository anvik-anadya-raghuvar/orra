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

function measure(): Bounds {
  const tabbar = document.querySelector('.tabbar, [class*="tabbar"]');
  const header = document.querySelector('header, .topbar, [class*="topbar"]');
  const vh = window.innerHeight;
  return {
    width: window.innerWidth,
    height: vh,
    bottomInset: tabbar ? Math.max(0, vh - tabbar.getBoundingClientRect().top) : 0,
    topInset: header ? Math.max(0, header.getBoundingClientRect().bottom) : 0,
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
