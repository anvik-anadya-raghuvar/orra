import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Info, Trash2, X } from 'lucide-react';
import { useData } from '../data/store';
import { entrance, useAnimateIn } from './motion';

/* ── Contextual help ─────────────────────────────────────────────────── */
/** How much room to leave between the bubble and the edge of the screen. */
const TIP_MARGIN = 10;
/** Gap between the icon and the bubble. */
const TIP_GAP = 8;

/**
 * Compact help that works with hover, keyboard focus, and a tap.
 *
 * The bubble is portalled to `<body>` and positioned `fixed`, rather than
 * being an absolutely-positioned child of the icon. It has to be: these tips
 * sit inside tiles and headers that clip their overflow on purpose — a glance
 * must never scroll — so a bubble drawn inside one was cut off at the tile's
 * edge and, for a tip near the top of the page, cut off by the viewport too.
 * That is the "message box is hidden" bug: the sentence was rendering, in a
 * box nobody could see.
 *
 * Out in the body it cannot be clipped by anything, so the only remaining job
 * is arithmetic: centre on the icon, flip below it when there is no room
 * above, and clamp both edges into the viewport. Measured on open and re-run
 * on scroll and resize, because the anchor moves.
 */
export function InfoTip({ text, label = 'More information' }: { text: string; label?: string }) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; below: boolean } | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;
    const a = anchor.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    // Above by default — it is what a tip beside a heading reads as — but only
    // when the sentence genuinely fits there.
    const below = a.top - TIP_GAP - b.height < TIP_MARGIN;
    const top = below ? a.bottom + TIP_GAP : a.top - TIP_GAP - b.height;
    const centred = a.left + a.width / 2 - b.width / 2;
    const left = Math.max(
      TIP_MARGIN,
      Math.min(centred, window.innerWidth - TIP_MARGIN - b.width),
    );
    setPos({ top, left, below });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const on = () => place();
    // Capture phase: the page scrolls the document element, but a tip can also
    // sit inside a scrollable panel, and only a capturing listener hears both.
    window.addEventListener('scroll', on, true);
    window.addEventListener('resize', on);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('scroll', on, true);
      window.removeEventListener('resize', on);
      window.removeEventListener('keydown', key);
    };
  }, [open, place]);

  return (
    <>
      <span
        ref={anchorRef}
        className={`info-tip${open ? ' on' : ''}`}
        /* Focusable but deliberately not `role="button"`: these tips sit
           inside headers and, on Personal, inside a tile that is itself one
           big button, and a button inside a button is invalid. It announces
           its whole sentence through `aria-label`, so a screen reader never
           depends on opening it at all. */
        tabIndex={0}
        aria-label={`${label}. ${text}`}
        aria-describedby={open ? id : undefined}
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        /* Tap toggles. A touch screen has no hover, and the pointerenter above
           fires once on tap and then never leaves — so without this the bubble
           would open and stick. */
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <Info size={13} strokeWidth={2} aria-hidden />
      </span>
      {open &&
        createPortal(
          <span
            ref={bubbleRef}
            className={`info-tip-bubble${pos ? ' placed' : ''}${pos?.below ? ' below' : ''}`}
            id={id}
            role="tooltip"
            style={pos ? { top: pos.top, left: pos.left } : undefined}
          >
            {text}
          </span>,
          document.body,
        )}
    </>
  );
}

/* ── Restored draft notice ───────────────────────────────────────────────
   Shown at the top of a composer that just put back what you had typed. It
   says so out loud rather than silently refilling the fields, because a form
   that fills itself in with no explanation reads as a bug — and it offers the
   way out, since sometimes the answer is "no, I was starting again". */
export function DraftRestored({ onDiscard }: { onDiscard: () => void }) {
  return (
    <div className="draft-note" role="status">
      <span>
        Picked up where you left off — this was still unsaved from last time.
      </span>
      <button type="button" className="btn sm" onClick={onDiscard}>
        Start blank
      </button>
    </div>
  );
}

/* ── Tag chip ─────────────────────────────────────────────────────────── */
export function TagChip({ name, onRemove }: { name: string; onRemove?: () => void }) {
  const color = useData((ds) => ds.tags.find((t) => t.name === name)?.color ?? 'slate');
  return (
    <span
      className="tagc"
      style={{
        background: `var(--${color}-s, var(--surf3))`,
        color: `var(--${color}, var(--slate))`,
      }}
    >
      {name}
      {onRemove && (
        <button className="x" aria-label={`Remove tag ${name}`} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}

/* ── Avatar ───────────────────────────────────────────────────────────── */
export function Avatar({ userId, size = 26 }: { userId: string | null; size?: number }) {
  const profile = useData((ds) => ds.profiles.find((p) => p.id === userId));
  const cls = profile?.name === 'Anadya' ? 'a' : 'b';
  const initials = profile
    ? profile.name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '—';
  return (
    <span className={`av ${cls}`} style={{ width: size, height: size }} title={profile?.name}>
      {initials}
    </span>
  );
}

/* ── Overlay panels ───────────────────────────────────────────────────────
   Two shapes, one set of behaviours.

   `Modal` is the centered dialog — right for a yes/no, a short form, or a list
   of toggles, where a wide panel would be pomp.

   `SideSheet` is the right-anchored drawer — right for anything you compose
   rather than confirm: a new task, a note with a body and a checklist, a
   ledger entry. It is full height, so a long form scrolls rather than being
   truncated, and its actions stay pinned at the bottom where they can always
   be reached. Below 640px both collapse to the same full-screen sheet, per the
   responsive rule that modals become sheets on mobile.

   Shared behaviour: escape closes, the page behind is scroll-locked, focus
   moves into the panel on open and returns to the opener on close, and every
   movement is skipped under `prefers-reduced-motion`.                       */

/** True on phones. Watched rather than read once, so a rotate or a resized
 *  window re-picks the right geometry instead of animating the wrong axis. */
function useIsPhone() {
  const [phone, setPhone] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/**
 * Locks the page behind an overlay.
 *
 * On `<html>`, not `<body>`: this app scrolls the document element, so hiding
 * body overflow left the scrollbar in place — which meant the compensating
 * padding was pure over-compensation and the viewport stayed 10px narrower
 * than a fixed overlay expected, so a right-anchored sheet sat 10px shy of
 * the edge. Locking the real scroll container removes the bar, and the padding
 * then genuinely replaces its width so the page behind does not jump.
 *
 * Counted, because a side sheet may open a confirm dialog on top of it and the
 * inner one closing must not unlock the outer one.
 */
let lockCount = 0;
/** Exported because Home's tile side page is an overlay too — it is not built
 *  on Modal/SideSheet (its body has to stay inside the room's own CSS scope),
 *  but it locks the page behind it for exactly the same reason. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    if (lockCount === 0) {
      const bar = window.innerWidth - root.clientWidth;
      root.style.overflow = 'hidden';
      if (bar > 0) root.style.paddingRight = `${bar}px`;
    }
    lockCount += 1;
    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        root.style.overflow = '';
        root.style.paddingRight = '';
      }
    };
  }, [active]);
}

/** Escape to close, focus into the panel, focus back to the opener after. */
function usePanelBehaviour(open: boolean, onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    // A frame of delay, so the entrance transform does not fight the
    // scroll-into-view that focusing a field can trigger.
    const t = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      if (panel.contains(document.activeElement)) return;
      const first = panel.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
      );
      (first ?? panel).focus({ preventScroll: true });
    }, 40);
    return () => {
      window.clearTimeout(t);
      const opener = openerRef.current as HTMLElement | null;
      if (opener?.isConnected) opener.focus?.({ preventScroll: true });
    };
  }, [open]);

  return panelRef;
}

export interface PanelProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  /** A line under the title saying what this panel is for. Sheets only. */
  subtitle?: React.ReactNode;
  /** Pinned to the bottom of a side sheet, so Save is always reachable. */
  footer?: React.ReactNode;
  /** Wider drawer, for a panel that holds two columns of fields. */
  wide?: boolean;
}

export function Modal({ open, onClose, children, title }: PanelProps) {
  const reduced = useReducedMotion();
  const panelRef = usePanelBehaviour(open, onClose);
  useScrollLock(open);

  // Portalled to <body>, not rendered in place. A `position: fixed` element
  // resolves against the nearest ancestor with a transform, and Framer Motion
  // puts a transform on anything mid-animation — so an overlay rendered inside
  // an animating page was sized to that page's box rather than the viewport,
  // and an overlay inside a tile would have been clipped by it outright.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="panel-mask"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.2 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            initial={reduced ? false : { opacity: 0, y: 18, scale: 0.98 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: reduced ? { duration: 0 } : entrance,
            }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 10, transition: { duration: 0.15 } }}
            onClick={(e) => e.stopPropagation()}
            className="modal-sheet"
          >
            {title && <h3 className="panel-title">{title}</h3>}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * The drawer. Same props as Modal plus a pinned footer, so a caller can move
 * between the two shapes without rewriting its body.
 */
export function SideSheet({ open, onClose, children, title, subtitle, footer, wide }: PanelProps) {
  const reduced = useReducedMotion();
  const phone = useIsPhone();
  const panelRef = usePanelBehaviour(open, onClose);
  useScrollLock(open);

  // On a phone the drawer is a bottom sheet, so it rises; on a pointer screen
  // it is anchored right, so it slides in from the edge it is attached to.
  const from = phone ? { y: 28, x: 0 } : { x: 44, y: 0 };

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="panel-mask side"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.2 }}
          onClick={onClose}
        >
          <motion.aside
            ref={panelRef as React.RefObject<HTMLDivElement>}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`side-sheet${wide ? ' wide' : ''}`}
            initial={reduced ? false : { opacity: 0, ...from }}
            animate={{ opacity: 1, x: 0, y: 0, transition: reduced ? { duration: 0 } : entrance }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, ...from, transition: { duration: 0.18 } }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="ss-hd">
              <div className="ss-ttl">
                {title && <h3>{title}</h3>}
                {subtitle && <p className="tip">{subtitle}</p>}
              </div>
              <button type="button" className="ss-x" aria-label="Close" onClick={onClose}>
                <X size={17} strokeWidth={2} aria-hidden />
              </button>
            </header>
            <div className="ss-body">{children}</div>
            {footer && <footer className="ss-ft">{footer}</footer>}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ── Toast ────────────────────────────────────────────────────────────── */
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number>();
  const show = useCallback((m: string) => {
    setMsg(m);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2600);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <AnimatePresence>
        {msg && (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 12, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 8, x: '-50%' }}
            transition={entrance}
          >
            {msg}
          </motion.div>
        )}
      </AnimatePresence>
    </ToastCtx.Provider>
  );
}

/* ── CountUp — numbers count up on first appearance ──────────────────── */
/**
 * The displayed number is always correct; the count-up is decoration.
 *
 * It deliberately does NOT start at 0 and rely on an animation to arrive at
 * the real value: a hidden tab throttles requestAnimationFrame to nothing, so
 * that design renders a permanent, confident-looking zero. Here the value is
 * right on first paint and the animation only ever replays over it.
 */
export function CountUp({ value, format }: { value: number; format?: (n: number) => string }) {
  const animate = useAnimateIn();
  const [shown, setShown] = useState(value);
  const raf = useRef<number>();

  useEffect(() => {
    if (!animate) {
      setShown(value);
      return;
    }
    const from = 0;
    const start = performance.now();
    const dur = 600;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from + (value - from) * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else setShown(value); // always land exactly on the real value
    };
    raf.current = requestAnimationFrame(tick);
    // Safety net: if rAF is starved (tab hidden mid-flight), snap to the truth.
    const guard = window.setTimeout(() => setShown(value), dur + 250);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      window.clearTimeout(guard);
    };
  }, [value, animate]);

  const n = Math.round(shown);
  return <>{format ? format(n) : n.toLocaleString('en-IN')}</>;
}

/* ── Skeleton ─────────────────────────────────────────────────────────── */
export function Skeleton({ h = 16, w = '100%', style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skel" style={{ height: h, width: w, ...style }} aria-hidden />;
}

/* ── Progress bar ─────────────────────────────────────────────────────── */
export function ProgressBar({ pct, grad = 'linear-gradient(90deg,var(--violet),var(--indigo))' }: { pct: number; grad?: string }) {
  // initial={false} when animation can't run, so the bar renders filled
  // rather than staying at width 0 in a background tab.
  const animate = useAnimateIn();
  return (
    <div style={{ height: 5, borderRadius: 4, background: 'var(--line)', overflow: 'hidden' }}>
      <motion.div
        initial={animate ? { width: 0 } : false}
        animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        style={{ height: '100%', background: grad, borderRadius: 4 }}
      />
    </div>
  );
}

/** Two-step delete — arms for 3s, then confirms. No browser dialog: a native
 *  confirm() blocks the render thread and cannot be themed. The delete this
 *  triggers always goes through AppStore.remove, which routes it to Trash, so
 *  "armed" reads as "sure?" rather than "forever". */
export function DeleteBtn({ onConfirm, label }: { onConfirm: () => void; label: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [armed]);

  if (armed) {
    return (
      <button
        type="button"
        className="picon armed"
        aria-label={`Confirm delete ${label}`}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        <span className="mono">sure?</span>
      </button>
    );
  }
  return (
    <button type="button" className="picon" aria-label={`Delete ${label}`} onClick={() => setArmed(true)}>
      <Trash2 size={14} strokeWidth={1.8} />
    </button>
  );
}
