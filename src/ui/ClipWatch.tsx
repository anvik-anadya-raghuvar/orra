/**
 * One watcher for every clipped tile list.
 *
 * Tiles never scroll themselves — `.bt-scroll` is `overflow: hidden` and the
 * full list lives on the tile's side page. The only question a tile has to
 * answer is "is anything actually hidden?", and the answer must be measured:
 * fading the bottom of a list that fits would be a lie, and skipping the fade
 * on one that doesn't would look cut off.
 *
 * A single ResizeObserver + MutationObserver pair covers every such element
 * in the app — tiles mount, unmount, resize, and change content constantly,
 * and per-tile React state for this was just this logic duplicated N times.
 * The class toggle happens outside React on purpose: it never re-renders
 * anything.
 */
import { useEffect } from 'react';

const SELECTOR = '.bt-scroll';

export default function ClipWatch() {
  useEffect(() => {
    const check = (el: Element) =>
      el.classList.toggle('clipping', el.scrollHeight > el.clientHeight + 1);

    const ro = new ResizeObserver((entries) => entries.forEach((e) => check(e.target)));
    const seen = new WeakSet<Element>();
    const scan = () => {
      document.querySelectorAll(SELECTOR).forEach((el) => {
        if (!seen.has(el)) {
          seen.add(el);
          ro.observe(el);
        }
        // Checked directly on every scan, not left to the ResizeObserver: RO
        // only fires when the BOX changes, and these boxes are fixed by the
        // grid — a list growing inside one changes scrollHeight while the box
        // stays identical, which RO never reports. The mutation that grew the
        // list triggers this scan instead.
        check(el);
      });
    };
    scan();

    // New tiles appear on navigation, tab switches, and customise toggles.
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  return null;
}
