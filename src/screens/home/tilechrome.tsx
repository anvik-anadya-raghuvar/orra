/**
 * Tile chrome — the controls that make Home a board the user arranges rather
 * than a layout they receive.
 *
 * Three affordances, all of them per-tile:
 *
 *  - **Expand.** The tile pops up at full size over the grid, rendering the
 *    same live node it renders in the grid, so everything inside it stays
 *    interactive. The pop-up also carries the "open the real page" jump, so a
 *    tile can be a summary without being a dead end.
 *  - **Move.** Press the grip and drag over any other tile to drop into that
 *    slot. Reordering happens live while dragging, then persists once.
 *  - **Resize.** Drag the bottom-right grip on the desktop grid for fine
 *    control, or pick a size in the pop-up — which is the accessible path, and
 *    the only sane one on a touch screen.
 *
 * The arrangement lives in `profiles.personalization.home_layout`. Per CLAUDE.md
 * that makes it a preference and never a permission: it changes this user's own
 * Home and nothing about what either user is allowed to see. The pure ordering
 * and sizing rules live in ./layout.ts and are tested there.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  GripVertical,
  RotateCcw,
  Settings2,
  X,
} from 'lucide-react';
import { useData, useDataset, useStore } from '../../data/store';
import { useScrollLock } from '../../ui/bits';
import { activeBlockFor } from '../../lib/blocks';
import { entrance, micro, spring, staggerItem } from '../../ui/motion';
import './arrange.css';
import type { HomeLayout } from '../../types';
import {
  MAX_COLS,
  MAX_ROWS,
  clampSpan,
  clearSize,
  isArranged,
  moveKey,
  withOrder,
  withSize,
  type Span,
} from './layout';

/* ── where each tile's full story actually lives ───────────────────────────
   Not every tile has a page behind it — the greeting band and the day ribbon
   ARE the whole thing — so this map is deliberately partial and the pop-up
   just omits the jump for anything missing. */
export const TILE_PAGE: Record<string, { label: string; to: string }> = {
  hero: { label: 'Work', to: '/work' },
  capacity: { label: 'Work', to: '/work' },
  plan: { label: 'Work', to: '/work' },
  stuck: { label: 'Work', to: '/work' },
  wins: { label: 'Personal', to: '/personal' },
  pulse: { label: 'Us', to: '/us' },
  thread: { label: 'Us', to: '/us' },
  photo: { label: 'Us', to: '/us' },
  ritual: { label: 'Work', to: '/work' },
  worth: { label: 'Notebook', to: '/knowledge' },
  life: { label: 'Personal', to: '/personal' },
  warmth: { label: 'People', to: '/people' },
  momentum: { label: 'Work', to: '/work' },
  split: { label: 'Work', to: '/work' },
  money: { label: 'Money', to: '/money' },
  calendar: { label: 'Work calendar', to: '/work' },
  projects: { label: 'Work', to: '/work' },
  subs: { label: 'Money', to: '/money' },
  quote: { label: 'Notebook', to: '/knowledge' },
  song: { label: 'Us', to: '/us' },
  'st-tasks': { label: 'Work', to: '/work' },
  'st-dec': { label: 'Work', to: '/work' },
  'st-people': { label: 'People', to: '/people' },
};

/** Heading for the pop-up. Kept beside TILE_PAGE rather than on the tile
 *  definitions so adding chrome costs Home's tile inventory nothing. */
export const TILE_TITLE: Record<string, string> = {
  greet: 'Today',
  hero: 'Top priority',
  capacity: 'Capacity',
  plan: 'Suggested plan',
  wins: 'Intention and win conditions',
  stuck: 'Blocked tasks',
  ribbon: "Today's schedule",
  calendar: 'Calendar',
  pulse: 'What they are up to',
  thread: 'Between us',
  photo: 'Moments',
  ritual: 'Next move',
  shutdown: 'Close the day',
  'close-log': 'Close log',
  worth: 'AI news',
  life: 'Personal radar',
  warmth: 'People going quiet',
  momentum: 'Momentum',
  split: 'Where the hours went',
  money: 'Money',
  subs: 'Renewing next',
  quote: 'Quote of the day',
  projects: 'Open per project',
  song: 'Song for today',
  weather: 'Weather',
  clocks: 'World clocks',
  'st-tasks': 'Tasks open',
  'st-dec': 'Decisions waiting',
  'st-people': 'People drifting',
};

/* ── sizes offered as presets ──────────────────────────────────────────────
   Named shapes rather than two number steppers: "make this wide" is what
   someone actually wants, and a preset stays meaningful at every grid width
   because the renderer clamps it. Fine control is the corner grip. */
export const SIZE_PRESETS: { label: string; span: Span }[] = [
  { label: 'Small', span: { cols: 1, rows: 1 } },
  { label: 'Wide', span: { cols: 2, rows: 1 } },
  { label: 'Tall', span: { cols: 1, rows: 2 } },
  { label: 'Big', span: { cols: 2, rows: 2 } },
  { label: 'Full width', span: { cols: 4, rows: 1 } },
  { label: 'Half the room', span: { cols: 4, rows: 2 } },
];

/** setPointerCapture throws (NotFoundError) for a pointer id the browser is not
 *  currently tracking, which is easy to hit with synthetic events and with pen
 *  input on some engines. Both gestures listen on window, so capture is an
 *  ergonomic bonus and never load-bearing — swallow the failure. */
function capture(e: React.PointerEvent) {
  try {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  } catch {
    /* gesture still tracks on the window listeners */
  }
}

export interface ArrangeApi {
  /** The layout to render with — the stored one, or the live draft mid-gesture. */
  layout: HomeLayout | null;
  gridRef: React.RefObject<HTMLDivElement>;
  dragKey: string | null;
  resizeKey: string | null;
  openKey: string | null;
  setOpenKey: (k: string | null) => void;
  startDrag: (key: string) => (e: React.PointerEvent) => void;
  startResize: (key: string, span: Span) => (e: React.PointerEvent) => void;
  setSpan: (key: string, span: Span) => void;
  resetSpan: (key: string) => void;
  resetAll: () => void;
  arranged: boolean;
  /** Nudge a tile one slot in the order — the keyboard path for "move". */
  nudge: (key: string, delta: number) => void;
  /**
   * Tell the hook what Home is currently showing, in the order it is showing
   * it. A drop target can only be resolved against that list, but the list
   * itself depends on `layout`, which this hook owns — so it is handed back in
   * rather than passed in. Safe to call during render: it only writes a ref.
   */
  syncKeys: (keys: string[]) => void;
  /** The room this grid belongs to, so the side page can say "big on Personal"
   *  rather than always claiming to be arranging Home. */
  room: string;
}

/** Which stored arrangement a grid reads and writes. Home was the only grid
 *  when this was written; Personal now uses the same gestures against its own
 *  field, so the key is a parameter rather than a constant. */
export type LayoutField = 'home_layout' | 'personal_layout';

/** Owns the arrangement gestures for a bento grid. */
export function useHomeArrange(field: LayoutField = 'home_layout'): ArrangeApi {
  const store = useStore();
  const me = useData((_, s) => s.me);
  const stored = me.personalization[field] ?? null;

  // A gesture writes to the draft on every pointer move so the grid reflows
  // under the finger; the store is written once, on release, so the audit trail
  // gets one entry per rearrangement instead of one per pixel.
  const [draft, setDraft] = useState<HomeLayout | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [resizeKey, setResizeKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const keysRef = useRef<string[]>([]);
  const syncKeys = useCallback((keys: string[]) => {
    keysRef.current = keys;
  }, []);
  const storedRef = useRef(stored);
  storedRef.current = stored;

  const layout = draft ?? stored;

  const commit = useCallback(
    (next: HomeLayout, summary: string) => {
      setDraft(null);
      store.update(
        'profiles',
        me.id,
        { personalization: { ...me.personalization, [field]: next } },
        store.asMe({ summary }),
      );
    },
    [store, me.id, me.personalization, field],
  );

  /* ── move ── */
  const dragRef = useRef<{ key: string; order: string[]; moved: boolean } | null>(null);

  const startDrag = useCallback(
    (key: string) => (e: React.PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      // Capture keeps the gesture alive if the pointer leaves the grip, but it
      // throws for a pointer the browser does not consider active. The drag
      // tracks on window listeners regardless, so a failure here is cosmetic.
      capture(e);
      dragRef.current = { key, order: keysRef.current.slice(), moved: false };
      setDragKey(key);
    },
    [],
  );

  useEffect(() => {
    if (!dragKey) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      // Pointer capture keeps events coming to the grip, but hit testing is
      // unaffected — so the element under the finger is still the drop target.
      const host = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(
        '[data-tilekey]',
      ) as HTMLElement | null;
      const target = host?.dataset.tilekey;
      if (!target || target === d.key) return;
      const next = moveKey(d.order, d.key, target);
      if (next.join(' ') === d.order.join(' ')) return;
      d.order = next;
      d.moved = true;
      setDraft(withOrder(storedRef.current, next));
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDragKey(null);
      if (!d) return;
      if (!d.moved) {
        setDraft(null);
        return;
      }
      commit(withOrder(storedRef.current, d.order), 'Home tiles rearranged');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragKey, commit]);

  const nudge = useCallback(
    (key: string, delta: number) => {
      const cur = keysRef.current;
      const i = cur.indexOf(key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= cur.length) return;
      commit(withOrder(storedRef.current, moveKey(cur, key, cur[j])), 'Home tiles rearranged');
    },
    [commit],
  );

  /* ── resize ── */
  const resizeRef = useRef<
    | {
        key: string;
        x: number;
        y: number;
        cols: number;
        rows: number;
        cw: number;
        rh: number;
        span: Span;
        last: Span;
        changed: boolean;
      }
    | null
  >(null);

  /** One grid cell plus one gap, in px — the distance a pointer must travel to
   *  mean "one more column". Read off the live grid so it stays correct across
   *  breakpoints without duplicating the numbers from the stylesheet. */
  const cellMetrics = () => {
    const g = gridRef.current;
    if (!g) return null;
    const cs = getComputedStyle(g);
    const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length;
    const rowH = parseFloat(cs.gridAutoRows);
    if (!cols || !Number.isFinite(rowH) || rowH <= 0) return null;
    const gapX = parseFloat(cs.columnGap) || 0;
    const gapY = parseFloat(cs.rowGap) || 0;
    return { cols, cw: (g.clientWidth - gapX * (cols - 1)) / cols + gapX, rh: rowH + gapY };
  };

  const startResize = useCallback(
    (key: string, span: Span) => (e: React.PointerEvent) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const m = cellMetrics();
      // No metrics means the single-column mobile grid, where "columns" is not
      // a thing a drag can express. The pop-up's size presets still work.
      if (!m) return;
      e.preventDefault();
      e.stopPropagation();
      capture(e);
      resizeRef.current = {
        key,
        x: e.clientX,
        y: e.clientY,
        cols: m.cols,
        rows: MAX_ROWS,
        cw: m.cw,
        rh: m.rh,
        span,
        last: span,
        changed: false,
      };
      setResizeKey(key);
    },
    [],
  );

  useEffect(() => {
    if (!resizeKey) return;
    const onMove = (e: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      const dc = Math.round((e.clientX - r.x) / r.cw);
      const dr = Math.round((e.clientY - r.y) / r.rh);
      const next = clampSpan(
        Math.min(r.span.cols + dc, r.cols),
        Math.min(r.span.rows + dr, r.rows),
      );
      if (next.cols === r.last.cols && next.rows === r.last.rows) return;
      r.last = next;
      r.changed = true;
      setDraft(withSize(storedRef.current, r.key, next));
    };
    const onUp = () => {
      const r = resizeRef.current;
      resizeRef.current = null;
      setResizeKey(null);
      if (!r) return;
      if (!r.changed) {
        setDraft(null);
        return;
      }
      commit(withSize(storedRef.current, r.key, r.last), 'Home tile resized');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [resizeKey, commit]);

  const setSpan = useCallback(
    (key: string, span: Span) => commit(withSize(storedRef.current, key, span), 'Home tile resized'),
    [commit],
  );
  const resetSpan = useCallback(
    (key: string) => commit(clearSize(storedRef.current, key), 'Home tile size reset'),
    [commit],
  );
  const resetAll = useCallback(
    () => commit({ order: [], size: {} }, 'Home arrangement reset'),
    [commit],
  );

  return {
    layout,
    gridRef,
    dragKey,
    resizeKey,
    openKey,
    setOpenKey,
    startDrag,
    startResize,
    setSpan,
    resetSpan,
    resetAll,
    arranged: isArranged(stored),
    nudge,
    syncKeys,
    room: field === 'personal_layout' ? 'Personal' : 'Home',
  };
}

/**
 * "Put Home back the way it shipped." Self-contained — it reads and writes the
 * same personalization row the hook does, so the Customise modal can offer it
 * without being handed an ArrangeApi it has no other use for. Renders nothing
 * until there is actually an arrangement to undo.
 */
export function ResetArrangement({ field = 'home_layout' }: { field?: LayoutField } = {}) {
  const store = useStore();
  const me = useData((_, s) => s.me);
  const layout = me.personalization[field] ?? null;
  if (!isArranged(layout)) return null;
  const moved = layout?.order.length ?? 0;
  const sized = Object.keys(layout?.size ?? {}).length;
  return (
    <div className="swrow">
      <RotateCcw size={17} strokeWidth={1.7} color="var(--slate)" aria-hidden />
      <span className="txt">
        Reset the arrangement
        <small>
          {moved ? 'Your tile order' : 'Your tile sizes'}
          {moved && sized ? ` and ${sized} resized tile${sized === 1 ? '' : 's'}` : ''} — back to the
          default layout. Widgets you have switched off stay off.
        </small>
      </span>
      <button
        type="button"
        className="btn sm"
        onClick={() =>
          store.update(
            'profiles',
            me.id,
            { personalization: { ...me.personalization, [field]: { order: [], size: {} } } },
            store.asMe({
              summary: `${field === 'home_layout' ? 'Home' : 'Personal'} arrangement reset`,
            }),
          )
        }
      >
        Reset
      </button>
    </div>
  );
}

/* ── the tile shell ────────────────────────────────────────────────────── */

export function BentoTile({
  tileKey,
  span,
  className,
  style,
  api,
  children,
}: {
  tileKey: string;
  /** The span actually being rendered — what a resize gesture starts from. */
  span: Span;
  className: string;
  style: React.CSSProperties;
  api: ArrangeApi;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const dragging = api.dragKey === tileKey;
  const resizing = api.resizeKey === tileKey;
  const page = TILE_PAGE[tileKey];

  const openFromSurface = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return;
    if (
      target.closest(
        'button, a, input, select, textarea, label, [role="button"], [role="link"], .bt-chrome, .bt-corner',
      )
    )
      return;
    api.setOpenKey(tileKey);
  };

  return (
    <motion.section
      data-tilekey={tileKey}
      data-span-cols={span.cols}
      data-span-rows={span.rows}
      className={`${className}${dragging ? ' bt-dragging' : ''}${
        api.dragKey && !dragging ? ' bt-dropzone' : ''
      }${resizing ? ' bt-resizing' : ''}`}
      variants={staggerItem}
      layout={reduced ? false : 'position'}
      transition={reduced ? { duration: 0 } : spring}
      tabIndex={0}
      aria-label={`Open ${TILE_TITLE[tileKey] ?? tileKey}`}
      onClick={(e) => openFromSurface(e.target)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        api.setOpenKey(tileKey);
      }}
      /* The tilt has to live here rather than in CSS: this tile is
         layout-animated, so Framer writes an inline transform every frame and
         a stylesheet `:hover { transform }` is silently discarded. Skipped
         while dragging or resizing, where the gesture owns the transform. */
      whileHover={
        reduced || dragging || resizing
          ? undefined
          : { y: -4, rotateX: 1.6, rotateY: -1.6, transition: micro }
      }
      style={{ ...style, transformPerspective: 1000 }}
    >
      {children}

      {/* Always in the DOM so it is reachable by tab and by touch; CSS fades it
          in on hover and focus on pointer-fine devices only. Never hover-only. */}
      <div className="bt-chrome" role="group" aria-label={`Arrange ${tileKey} tile`}>
        {page && (
          <Link
            className="bt-cbtn"
            to={page.to}
            aria-label={`Open ${page.label}`}
            title={`Open ${page.label}`}
          >
            <ArrowUpRight size={15} strokeWidth={2} aria-hidden />
          </Link>
        )}
        <button
          type="button"
          className="bt-cbtn bt-grip"
          aria-label="Move this tile — drag, or use the arrow keys"
          title="Drag to move"
          onPointerDown={api.startDrag(tileKey)}
          onKeyDown={(e) => {
            const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
            if (!d) return;
            e.preventDefault();
            api.nudge(tileKey, d);
          }}
        >
          <GripVertical size={15} strokeWidth={2} aria-hidden />
        </button>
      </div>

      {/* Corner grip: fine-grained resize on a grid that actually has columns.
          Hidden from assistive tech because the pop-up's size presets are the
          equivalent action in a form everything can operate. */}
      <span
        className="bt-corner"
        aria-hidden
        onPointerDown={api.startResize(tileKey, span)}
        title="Drag to resize"
      />
    </motion.section>
  );
}

/* ── the pop-up ────────────────────────────────────────────────────────── */

/** Everything the browser will hand focus to inside the side page. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function TileSheet({
  tileKey,
  title,
  span,
  api,
  children,
}: {
  tileKey: string;
  title: string;
  span: Span;
  api: ArrangeApi;
  children: React.ReactNode;
}) {
  const close = useCallback(() => api.setOpenKey(null), [api]);
  const page = TILE_PAGE[tileKey];
  const stored = api.layout?.size?.[tileKey];
  const other = useStore().other.name;
  const [view, setView] = useState<'feature' | 'display'>('feature');
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => setView('feature'), [tileKey]);

  /* The room behind an overlay must not scroll under it — without this the
     wheel moved the grid while the page sat still on top of it, and removing
     the page's scrollbar is also what lets a `100vw` overlay sit flush against
     the real right edge rather than 10px shy of it. */
  useScrollLock(true);

  /* Focus goes into the page on open and back to the tile on close, and Tab
     stays inside while it is open — the same contract Modal and SideSheet
     honour. Without it, tabbing walked straight out into the room underneath. */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      const el = sheetRef.current;
      if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    }, 40);
    return () => {
      window.clearTimeout(t);
      if (opener?.isConnected) opener.focus?.({ preventScroll: true });
    };
  }, [tileKey]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== 'Tab') return;
      const el = sheetRef.current;
      if (!el) return;
      const f = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (document.activeElement === first || document.activeElement === el)) {
        e.preventDefault();
        last.focus();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [close]);

  const active = useMemo(() => clampSpan(span.cols, span.rows), [span.cols, span.rows]);

  return (
    <motion.div
      className="tilesheet-mask"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: micro }}
      transition={{ duration: 0.2 }}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <motion.div
        ref={sheetRef}
        tabIndex={-1}
        className="tilesheet"
        /* A side page, so it slides in from the edge it lives on rather than
           popping up in the middle of the room. Mobile covers the screen, where
           the rise reads better than a sideways slide. */
        initial={{ opacity: 0, x: 36 }}
        animate={{ opacity: 1, x: 0, transition: entrance }}
        exit={{ opacity: 0, x: 24, transition: micro }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="tilesheet-hd">
          {view === 'display' && (
            <button
              type="button"
              className="btn sm icon"
              aria-label="Back to widget"
              onClick={() => setView('feature')}
            >
              <ChevronLeft size={16} strokeWidth={2} aria-hidden />
            </button>
          )}
          <b>{view === 'feature' ? title : `${title} · display`}</b>
          <span className="spacer" />
          {view === 'feature' && page && (
            <Link className="btn sm solid" to={page.to} onClick={close}>
              Open {page.label}
              <ArrowUpRight size={14} strokeWidth={2.2} aria-hidden />
            </Link>
          )}
          {view === 'feature' && (
            <button type="button" className="btn sm" onClick={() => setView('display')}>
              <Settings2 size={14} strokeWidth={2} aria-hidden />
              Display
            </button>
          )}
          <button type="button" className="btn sm icon" aria-label="Close" onClick={close}>
            <X size={16} strokeWidth={2} aria-hidden />
          </button>
        </header>

        {/* The live widget, at a size where it can actually be read and used —
            same component, same store, so nothing inside it is a screenshot.
            Deliberately NOT a `.bt`: on the grid the tile is a card, but here
            the page is already the card and a second border inside it was just
            a box drawn inside a box. */}
        <div className={`tilesheet-body${view === 'display' ? ' display-page' : ''}`}>
          {view === 'feature' ? (
            <div className="tilesheet-tile">{children}</div>
          ) : (
            <div className="tilesheet-display">
              <div>
                <span className="eyebrow">How much room it gets on {api.room}</span>
                <div
                  className="tilesheet-sizes"
                  role="group"
                  aria-label={`How much room this gets on ${api.room}`}
                >
                  {SIZE_PRESETS.map((p) => {
                    const on = active.cols === p.span.cols && active.rows === p.span.rows;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        className={`chip shape${on ? ' on' : ''}`}
                        aria-pressed={on}
                        aria-label={`${p.label} — ${p.span.cols} across, ${p.span.rows} down`}
                        onClick={() => api.setSpan(tileKey, p.span)}
                      >
                        {p.label}
                        <small className="mono" aria-hidden>
                          {p.span.cols}&times;{p.span.rows}
                        </small>
                      </button>
                    );
                  })}
                  {stored && (
                    <button
                      type="button"
                      className="chip"
                      onClick={() => api.resetSpan(tileKey)}
                      title="Go back to the size this one started at"
                    >
                      <RotateCcw size={13} strokeWidth={2} aria-hidden /> Back to default
                    </button>
                  )}
                </div>
              </div>
              <div>
                <span className="eyebrow">Where it sits</span>
                <div className="tilesheet-sizes" role="group" aria-label="Where this sits in the room">
                  <button type="button" className="chip" onClick={() => api.nudge(tileKey, -1)}>
                    <ChevronLeft size={13} strokeWidth={2.2} aria-hidden /> Further up
                  </button>
                  <button type="button" className="chip" onClick={() => api.nudge(tileKey, 1)}>
                    Further down <ChevronRight size={13} strokeWidth={2.2} aria-hidden />
                  </button>
                </div>
              </div>
              <p className="tip">
                {api.room} is {MAX_COLS} across and {MAX_ROWS} down at its widest. The grid closes
                around every change, and narrower screens shrink it to fit. Dragging and corner
                resizing remain available with a mouse. This arrangement is yours only; {other}{' '}
                keeps their own.
              </p>
              <button
                type="button"
                className="btn solid tilesheet-back"
                onClick={() => setView('feature')}
              >
                Back to {title}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

export function TileSheetHost({
  api,
  tiles,
}: {
  api: ArrangeApi;
  tiles: { key: string; title: string; span: Span; node: React.ReactNode }[];
}) {
  const open = api.openKey ? tiles.find((t) => t.key === api.openKey) : undefined;

  // Starting a block freezes the whole portal, so any open side page closes
  // itself: without this, ending the block dropped you back into a stale
  // sheet you had mentally finished with.
  const ds = useDataset();
  const meId = useData((_, s) => s.meId);
  const frozen = Boolean(activeBlockFor(ds, meId));
  useEffect(() => {
    if (frozen && api.openKey) api.setOpenKey(null);
  }, [frozen]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AnimatePresence>
      {open && (
        <TileSheet key={open.key} tileKey={open.key} title={open.title} span={open.span} api={api}>
          {open.node}
        </TileSheet>
      )}
    </AnimatePresence>
  );
}
