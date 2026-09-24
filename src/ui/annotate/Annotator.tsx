/**
 * Draw on a file.
 *
 * Open a PDF, a photo, a spreadsheet or a Word file; write on it with an
 * S Pen, an Apple Pencil, a finger or a mouse; save a flattened
 * "<name>.annotated.pdf" next to the original, which is kept untouched. The
 * ink is also kept as strokes (the `annotations` table), so opening the same
 * file again brings the marks back, editable.
 *
 * Lazy-loaded (see launch.tsx) — none of this is in the main bundle.
 *
 * ── Input model ──────────────────────────────────────────────────────────
 *
 * All pointer handling is ours (`touch-action: none` on the page area), for
 * one reason: on Android Chrome a stylus drag on a normally-scrollable page
 * *scrolls it*, cancelling the stroke. Owning the gestures means:
 *
 *  - pen      → always draws (or erases). A pen is never a scroll.
 *  - touch    → draws with one finger UNTIL a pen has been seen. After that
 *               fingers only scroll and pinch — palm rejection — and any
 *               touch while the pen is down is ignored outright.
 *  - 2 fingers→ pinch-zoom and pan, always; a finger stroke in progress is
 *               dropped when the second finger lands.
 *  - mouse    → left button draws; middle button, or the Hand tool, pans.
 *  - wheel    → scrolls; ctrl/⌘ + wheel (and trackpad pinch) zooms.
 *
 * ── Rendering ────────────────────────────────────────────────────────────
 *
 * Each page is a canvas (the file, painted only while near the viewport and
 * released when far, so a 200-page PDF never holds 200 bitmaps) under an SVG
 * of ink in page units. The stroke being drawn is written straight onto one
 * SVG path per animation frame — no React render per pointer move — and
 * committed to history on pen-lift.
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Hand,
  Highlighter,
  PenLine,
  Redo2,
  Scan,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { deleteFile, fileHref, humanBytes, rejectReason, uploadFile } from '../../lib/files';
import {
  HIGHLIGHT_COLORS,
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_SIZES,
  INK_BYTE_BUDGET,
  PEN_COLORS,
  PEN_SIZES,
  finalizePoints,
  inkHit,
  inkStrokeCount,
  makeInk,
  reconcileInk,
  strokeSvgPath,
  type InkStroke,
} from '../../lib/annotate/ink';
import { clampZoom, fitScale, renderScale, screenToPage, zoomScroll } from '../../lib/annotate/coords';
import { commit, eraseOp, redo as redoOp, startHistory, undo as undoOp, type InkHistory } from '../../lib/annotate/history';
import { annotatedName } from '../../lib/annotate/kinds';
import { UnsupportedFileError, loadSource, type LoadedSource, type PageSize } from '../../lib/annotate/sources';
import type { Attachment } from '../../types';
import { useScrollLock, useToast } from '../bits';
import { EASE, entrance, micro, spring, useAnimateIn } from '../motion';
import './annotate.css';

type Tool = 'pen' | 'highlighter' | 'eraser' | 'hand';

/** Session-scoped, like SketchCanvas: once a real pen has touched the glass,
 *  fingers are a hand resting on it, not a nib. */
let sawPen = false;

/** Outline paths are pure functions of an immutable stroke — compute once. */
const pathCache = new WeakMap<InkStroke, string>();
function pathOf(stroke: InkStroke): string {
  let d = pathCache.get(stroke);
  if (d === undefined) {
    d = strokeSvgPath(stroke);
    pathCache.set(stroke, d);
  }
  return d;
}

/* ── One page: file canvas + ink ─────────────────────────────────────── */

interface PageViewProps {
  index: number;
  size: PageSize;
  scale: number;
  src: LoadedSource;
  strokes: InkStroke[];
  hidden: Set<string> | null;
  root: HTMLElement | null;
  thumb?: boolean;
  setEl?: (index: number, el: HTMLDivElement | null) => void;
  setLive?: (index: number, el: SVGPathElement | null) => void;
}

const PageView = memo(function PageView({
  index,
  size,
  scale,
  src,
  strokes,
  hidden,
  root,
  thumb = false,
  setEl,
  setLive,
}: PageViewProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [painted, setPainted] = useState(false);
  const paintedRef = useRef(false);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root,
      rootMargin: thumb ? '300px' : '900px 300px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root, thumb]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!near) {
      // Far away: give the bitmap back. A 40-page PDF at 2× is gigabytes of
      // pixels if every page stays painted.
      if (paintedRef.current) {
        canvas.width = 0;
        canvas.height = 0;
        paintedRef.current = false;
        setPainted(false);
      }
      return;
    }
    const ctrl = new AbortController();
    // Re-render after zoom settles; the first paint goes immediately.
    const t = window.setTimeout(
      () => {
        const s = renderScale(size.w, size.h, scale, thumb ? 1 : window.devicePixelRatio || 1);
        src
          .render(index, canvas, s, ctrl.signal)
          .then(() => {
            if (ctrl.signal.aborted) return;
            paintedRef.current = true;
            setPainted(true);
          })
          .catch((err) => {
            if (!ctrl.signal.aborted) console.warn('[annotate] page render failed', err);
          });
      },
      paintedRef.current ? 160 : 0,
    );
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [near, scale, src, index, size.w, size.h, thumb]);

  const highlights = strokes.filter((s) => s.tool === 'highlighter');
  const pens = strokes.filter((s) => s.tool !== 'highlighter');

  return (
    <div
      ref={(el) => {
        boxRef.current = el;
        setEl?.(index, el);
      }}
      className={`anno-page${thumb ? ' thumb' : ''}${painted ? '' : ' skel'}`}
      style={{ width: size.w * scale, height: size.h * scale }}
      data-page={thumb ? undefined : index}
    >
      <canvas ref={canvasRef} className="anno-canvas" aria-hidden />
      <svg
        className="anno-ink"
        viewBox={`0 0 ${size.w} ${size.h}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        {highlights.map((s) => (
          <path
            key={s.id}
            d={pathOf(s)}
            fill={s.color}
            fillOpacity={hidden?.has(s.id) ? 0.08 : HIGHLIGHT_OPACITY}
            style={{ mixBlendMode: 'multiply' }}
          />
        ))}
        {pens.map((s) => (
          <path key={s.id} d={pathOf(s)} fill={s.color} fillOpacity={hidden?.has(s.id) ? 0.18 : 1} />
        ))}
        {!thumb && <path ref={(el) => setLive?.(index, el)} className="anno-live" />}
      </svg>
    </div>
  );
});

/** Keep receiving moves when the pointer leaves the page mid-stroke. Can
 *  throw for a pointer the browser no longer considers active (a pen that
 *  lifted between events) — never worth losing the stroke over. */
function capture(el: HTMLElement, id: number) {
  try {
    el.setPointerCapture(id);
  } catch {
    /* not capturable; moves still arrive while over the page */
  }
}

/* ── Gesture state ───────────────────────────────────────────────────── */

type Drag =
  | {
      kind: 'draw';
      id: number;
      type: string;
      page: number;
      el: HTMLElement;
      pts: number[];
      tool: 'pen' | 'highlighter';
      color: string;
      size: number;
      sim: boolean;
      raf: number;
    }
  | { kind: 'erase'; id: number; type: string; page: number; el: HTMLElement; hits: Set<string> }
  | { kind: 'pan'; id: number; x: number; y: number }
  | { kind: 'pinch'; a: number; b: number; dist: number; zoom: number; mx: number; my: number };

const TOOL_META: { key: Tool; label: string; key1: string; Icon: typeof PenLine }[] = [
  { key: 'pen', label: 'Pen', key1: 'P', Icon: PenLine },
  { key: 'highlighter', label: 'Highlighter', key1: 'H', Icon: Highlighter },
  { key: 'eraser', label: 'Eraser', key1: 'E', Icon: Eraser },
  { key: 'hand', label: 'Scroll', key1: 'V', Icon: Hand },
];

export default function Annotator({
  attachment,
  blob,
  onClose,
}: {
  attachment: Attachment;
  blob?: Blob | null;
  onClose: () => void;
}) {
  const store = useStore();
  const toast = useToast();
  const reduced = useReducedMotion();
  // Skip the entrance entirely when it cannot run (reduced motion, or a
  // hidden tab starving rAF) — otherwise the sheet can sit half-transparent.
  const animateIn = useAnimateIn();
  const still = !!reduced || !animateIn;
  useScrollLock(true);

  const existing = useData((ds) => ds.annotations.find((a) => a.attachment_id === attachment.id));

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [src, setSrc] = useState<LoadedSource | null>(null);
  const [hist, setHist] = useState<InkHistory>(() => startHistory(makeInk([])));
  const histRef = useRef(hist);
  histRef.current = hist;

  const [tool, setTool] = useState<Tool>('pen');
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[1].hex);
  const [hlColor, setHlColor] = useState<string>(HIGHLIGHT_COLORS[0].hex);
  const [penSize, setPenSize] = useState(1);
  const [hlSize, setHlSize] = useState(1);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  const [fit, setFit] = useState(1);
  const [pageNo, setPageNo] = useState(0);
  const [penSeen, setPenSeen] = useState(sawPen);
  const [status, setStatus] = useState<'draft' | 'reviewed'>(existing?.status ?? 'draft');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<{ label: string; pct: number } | null>(null);
  const [erasing, setErasing] = useState<{ page: number; ids: Set<string> } | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [thumbEl, setThumbEl] = useState<HTMLElement | null>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const liveEls = useRef<(SVGPathElement | null)[]>([]);
  const drag = useRef<Drag | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);

  const scale = fit * zoom;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  /* ── load the file and any saved ink ─────────────────────────────── */
  useEffect(() => {
    let alive = true;
    let loaded: LoadedSource | null = null;
    (async () => {
      try {
        let bytes: ArrayBuffer;
        if (blob) {
          bytes = await blob.arrayBuffer();
        } else {
          const href = await fileHref(attachment.storage_path);
          if (!href) throw new UnsupportedFileError('The stored copy of this file could not be reached.');
          const res = await fetch(href);
          if (!res.ok) throw new UnsupportedFileError(`The file could not be downloaded (${res.status}).`);
          bytes = await res.arrayBuffer();
        }
        const s = await loadSource(bytes, attachment.filename, attachment.mime);
        if (!alive) {
          s.destroy();
          return;
        }
        loaded = s;
        const stored = store.ds.annotations.find((a) => a.attachment_id === attachment.id);
        setHist(startHistory(reconcileInk(stored?.strokes, s.pages)));
        setSrc(s);
        setPhase('ready');
      } catch (err) {
        if (!alive) return;
        setError(
          err instanceof UnsupportedFileError
            ? err.message
            : `This file could not be opened — ${(err as Error).message || 'unknown error'}.`,
        );
        setPhase('error');
      }
    })();
    return () => {
      alive = false;
      loaded?.destroy();
    };
    // The attachment id is the identity; a caption edit must not reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id]);

  /* ── focus in, focus back out ────────────────────────────────────── */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      if (opener?.isConnected) opener.focus?.({ preventScroll: true });
    };
  }, []);

  /* ── fit to width, and keep fitting as the box resizes ───────────── */
  useEffect(() => {
    if (!scrollEl || !src) return;
    const measure = () => setFit(fitScale(src.pages, scrollEl.clientWidth, scrollEl.clientWidth < 500 ? 16 : 48));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollEl, src]);

  useLayoutEffect(() => {
    const p = pendingScroll.current;
    const el = scrollRef.current;
    if (p && el) {
      el.scrollLeft = p.left;
      el.scrollTop = p.top;
    }
    pendingScroll.current = null;
  }, [zoom]);

  /** Zoom around a point inside the scroll box (default: its centre). */
  const applyZoom = useCallback((next: number, ax?: number, ay?: number): boolean => {
    const el = scrollRef.current;
    const z = clampZoom(next);
    if (!el || Math.abs(z - zoomRef.current) < 0.001) return false;
    const ox = ax ?? el.clientWidth / 2;
    const oy = ay ?? el.clientHeight / 2;
    pendingScroll.current = {
      left: zoomScroll(el.scrollLeft, ox, zoomRef.current, z),
      top: zoomScroll(el.scrollTop, oy, zoomRef.current, z),
    };
    zoomRef.current = z;
    setZoom(z);
    return true;
  }, []);

  /* ── ctrl/⌘ + wheel (and trackpad pinch) zooms ───────────────────── */
  useEffect(() => {
    if (!scrollEl) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = scrollEl.getBoundingClientRect();
      applyZoom(zoomRef.current * Math.exp(-e.deltaY * 0.0022), e.clientX - r.left, e.clientY - r.top);
    };
    scrollEl.addEventListener('wheel', onWheel, { passive: false });
    return () => scrollEl.removeEventListener('wheel', onWheel);
  }, [scrollEl, applyZoom]);

  /* ── which page is in view ───────────────────────────────────────── */
  const scrollRaf = useRef(0);
  const onScroll = () => {
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      const el = scrollRef.current;
      if (!el) return;
      const mid = el.scrollTop + el.clientHeight / 2;
      let best = 0;
      pageEls.current.forEach((p, i) => {
        if (p && p.offsetTop <= mid) best = i;
      });
      setPageNo(best);
    });
  };

  const goToPage = useCallback(
    (i: number) => {
      const el = scrollRef.current;
      const page = pageEls.current[i];
      if (!el || !page) return;
      el.scrollTo({ top: page.offsetTop - 12, behavior: reduced ? 'auto' : 'smooth' });
      setPageNo(i);
    },
    [reduced],
  );

  /* ── history ─────────────────────────────────────────────────────── */
  const record = useCallback(
    (next: InkHistory) => {
      if (next === histRef.current) return;
      histRef.current = next;
      setHist(next);
      setDirty(true);
    },
    [],
  );
  const doUndo = useCallback(() => record(undoOp(histRef.current)), [record]);
  const doRedo = useCallback(() => record(redoOp(histRef.current)), [record]);

  /* ── drawing ─────────────────────────────────────────────────────── */
  const clearLive = (page: number) => {
    const live = liveEls.current[page];
    if (live) live.setAttribute('d', '');
  };

  const paintLive = () => {
    const d = drag.current;
    if (!d || d.kind !== 'draw' || d.raf) return;
    d.raf = requestAnimationFrame(() => {
      d.raf = 0;
      if (drag.current !== d) return;
      const live = liveEls.current[d.page];
      if (!live) return;
      live.setAttribute('d', strokeSvgPath({ points: d.pts, size: d.size, tool: d.tool, sim: d.sim }));
      live.setAttribute('fill', d.color);
      live.setAttribute('fill-opacity', d.tool === 'highlighter' ? String(HIGHLIGHT_OPACITY) : '1');
      live.style.mixBlendMode = d.tool === 'highlighter' ? 'multiply' : '';
    });
  };

  const eraseAt = (d: Extract<Drag, { kind: 'erase' }>, cx: number, cy: number) => {
    const size = src?.pages[d.page];
    if (!size) return;
    const p = screenToPage(cx, cy, d.el.getBoundingClientRect(), size.w, size.h);
    const tol = 9 / Math.max(0.05, scaleRef.current);
    let changed = false;
    for (const s of histRef.current.ink.strokes[d.page] ?? []) {
      if (!d.hits.has(s.id) && inkHit(s, p.x, p.y, tol)) {
        d.hits.add(s.id);
        changed = true;
      }
    }
    if (changed) setErasing({ page: d.page, ids: new Set(d.hits) });
  };

  const endDrag = (cancelled: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'draw') {
      if (d.raf) cancelAnimationFrame(d.raf);
      clearLive(d.page);
      if (cancelled) return;
      const points = finalizePoints(d.pts);
      if (!points.length) return;
      const stroke: InkStroke = {
        id: newId('ink'),
        tool: d.tool,
        color: d.color,
        size: d.size,
        points,
        ...(d.sim ? { sim: true } : {}),
      };
      const approx = JSON.stringify(histRef.current.ink).length + JSON.stringify(stroke).length;
      if (approx > INK_BYTE_BUDGET) {
        toast(`This file holds as much ink as it can (${humanBytes(INK_BYTE_BUDGET)}). Save, or erase something first.`);
        return;
      }
      record(commit(histRef.current, { type: 'add', page: d.page, stroke }));
    } else if (d.kind === 'erase') {
      setErasing(null);
      if (!cancelled && d.hits.size) {
        record(commit(histRef.current, eraseOp(histRef.current.ink, d.page, (s) => d.hits.has(s.id))));
      }
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (phase !== 'ready' || saving || !src) return;
    const type = e.pointerType;
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (type === 'pen' && !sawPen) {
      sawPen = true;
      setPenSeen(true);
    }
    if (type === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const d = drag.current;
      // Palm rejection: a hand on the glass while the pen writes is ignored.
      if (d && (d.kind === 'draw' || d.kind === 'erase') && d.type === 'pen') return;
      if (touches.current.size >= 2) {
        // A second finger means pinch, never a stroke.
        if (d && (d.kind === 'draw' || d.kind === 'erase')) endDrag(true);
        const ids = [...touches.current.keys()].slice(-2);
        const a = touches.current.get(ids[0])!;
        const b = touches.current.get(ids[1])!;
        capture(scroller, e.pointerId);
        drag.current = {
          kind: 'pinch',
          a: ids[0],
          b: ids[1],
          dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          zoom: zoomRef.current,
          mx: (a.x + b.x) / 2,
          my: (a.y + b.y) / 2,
        };
        return;
      }
    }
    if (type === 'mouse' && e.button !== 0 && e.button !== 1) return;
    if (drag.current) return; // one gesture at a time
    const pageEl = (e.target as Element).closest<HTMLElement>('[data-page]');
    const pan =
      tool === 'hand' || !pageEl || (type === 'touch' && penSeen) || (type === 'mouse' && e.button === 1);
    capture(scroller, e.pointerId);
    if (pan) {
      drag.current = { kind: 'pan', id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    e.preventDefault();
    const page = Number(pageEl!.dataset.page);
    if (tool === 'eraser') {
      const d: Drag = { kind: 'erase', id: e.pointerId, type, page, el: pageEl!, hits: new Set() };
      drag.current = d;
      eraseAt(d, e.clientX, e.clientY);
      return;
    }
    const size = src.pages[page];
    const p = screenToPage(e.clientX, e.clientY, pageEl!.getBoundingClientRect(), size.w, size.h);
    const hl = tool === 'highlighter';
    drag.current = {
      kind: 'draw',
      id: e.pointerId,
      type,
      page,
      el: pageEl!,
      pts: [p.x, p.y, type === 'pen' ? e.pressure : 0.5],
      tool: hl ? 'highlighter' : 'pen',
      color: hl ? hlColor : penColor,
      size: hl ? HIGHLIGHT_SIZES[hlSize] : PEN_SIZES[penSize],
      sim: type !== 'pen',
      raf: 0,
    };
    paintLive();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const d = drag.current;
    const scroller = scrollRef.current;
    if (!d || !scroller) return;

    if (d.kind === 'pinch') {
      const a = touches.current.get(d.a);
      const b = touches.current.get(d.b);
      if (!a || !b) return;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const r = scroller.getBoundingClientRect();
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const zoomed = applyZoom(d.zoom * (dist / d.dist), mx - r.left, my - r.top);
      const dx = mx - d.mx;
      const dy = my - d.my;
      if (zoomed && pendingScroll.current) {
        pendingScroll.current.left -= dx;
        pendingScroll.current.top -= dy;
      } else {
        scroller.scrollLeft -= dx;
        scroller.scrollTop -= dy;
      }
      d.mx = mx;
      d.my = my;
      return;
    }
    if (d.id !== e.pointerId) return;

    if (d.kind === 'pan') {
      scroller.scrollLeft -= e.clientX - d.x;
      scroller.scrollTop -= e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      return;
    }

    const native = e.nativeEvent;
    const coalesced = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    const events = coalesced.length ? coalesced : [native];
    if (d.kind === 'erase') {
      for (const ev of events) eraseAt(d, ev.clientX, ev.clientY);
      return;
    }
    const size = src?.pages[d.page];
    if (!size) return;
    const rect = d.el.getBoundingClientRect();
    for (const ev of events) {
      const p = screenToPage(ev.clientX, ev.clientY, rect, size.w, size.h);
      d.pts.push(p.x, p.y, d.type === 'pen' ? ev.pressure : 0.5);
    }
    paintLive();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    touches.current.delete(e.pointerId);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pinch') {
      if (touches.current.size < 2) drag.current = null;
      return;
    }
    if (d.id !== e.pointerId) return;
    if (d.kind === 'pan') {
      drag.current = null;
      return;
    }
    endDrag(cancelled);
  };

  /* ── save: ink first, then the flattened PDF ─────────────────────── */
  const strokeCount = useMemo(() => inkStrokeCount(hist.ink), [hist.ink]);

  const save = async () => {
    if (!src || saving) return;
    const ink = histRef.current.ink;
    if (!strokeCount && !existing) {
      toast('Draw something first — there is nothing to save yet.');
      return;
    }
    setSaving({ label: 'Saving your ink…', pct: 0.02 });
    const now = nowIso();
    const annId = existing?.id ?? newId('ann');
    try {
      // 1. The strokes. Saved before anything else so a failed PDF export
      //    or upload never costs the ink itself. Silent on the big column:
      //    the trail is append-only, and a megabyte of coordinates in it
      //    would be there forever. The insert and status change are audited.
      if (!existing) {
        store.insert(
          'annotations',
          {
            id: annId,
            attachment_id: attachment.id,
            user_id: store.meId,
            page_count: src.pages.length,
            strokes: ink,
            status,
            output_attachment_id: null,
            created_at: now,
            updated_at: now,
          },
          store.asMe({ summary: `Annotated — ${attachment.filename}` }),
        );
      } else {
        store.update('annotations', annId, { strokes: ink, page_count: src.pages.length }, store.asMe({ silent: true }));
        if (existing.status !== status) {
          store.update('annotations', annId, { status }, store.asMe());
        }
      }

      // 2. Flatten.
      const name = annotatedName(attachment.filename);
      const { buildAnnotatedPdf } = await import('../../lib/annotate/exportPdf');
      const bytes = await buildAnnotatedPdf(src, ink, name.replace(/\.pdf$/i, ''), (done, total) =>
        setSaving({ label: `Flattening page ${done} of ${total}…`, pct: 0.05 + 0.75 * (done / total) }),
      );
      const file = new File([bytes as BlobPart], name, { type: 'application/pdf' });
      const reason = rejectReason(file);
      if (reason) throw new Error(`${reason} Your ink is saved; the flattened copy is not.`);

      // 3. Upload next to the original. A fresh storage path every time —
      //    signed URLs are CDN-cached, and an overwrite at the same path can
      //    serve last week's copy for an hour.
      setSaving({ label: 'Uploading…', pct: 0.85 });
      const priorId = store.ds.annotations.find((a) => a.id === annId)?.output_attachment_id;
      const prior = priorId ? store.ds.attachments.find((a) => a.id === priorId) : undefined;
      const path = await uploadFile(file, store.meId, newId('att'));
      let outId: string;
      if (prior) {
        outId = prior.id;
        store.update(
          'attachments',
          prior.id,
          { filename: name, bytes: file.size, storage_path: path, uploaded_by: store.meId, mime: 'application/pdf' },
          // Silent: in local mode the path IS the file (a data URL), and the
          // audit trail is not a place to keep a PDF.
          store.asMe({ silent: true }),
        );
        if (prior.storage_path !== path) void deleteFile(prior.storage_path);
      } else {
        outId = newId('att');
        store.insert(
          'attachments',
          {
            id: outId,
            entity_type: attachment.entity_type,
            entity_id: attachment.entity_id,
            filename: name,
            mime: 'application/pdf',
            bytes: file.size,
            storage_path: path,
            caption: `Annotated copy of ${attachment.filename}`,
            uploaded_by: store.meId,
            created_at: nowIso(),
          },
          store.asMe({ summary: `Annotated copy saved — ${name}` }),
        );
      }
      store.update('annotations', annId, { output_attachment_id: outId }, store.asMe({ silent: true }));
      setSaving({ label: 'Saved', pct: 1 });
      setDirty(false);
      toast(`${name} saved next to the original`);
      onClose();
    } catch (err) {
      toast((err as Error).message || 'Could not save the annotated copy.');
      setSaving(null);
    }
  };

  const requestClose = () => {
    if (saving) return;
    if (dirty && !window.confirm('Close without saving? Ink drawn since the last save will be lost.')) return;
    onClose();
  };

  /* ── keyboard ────────────────────────────────────────────────────── */
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (e.key === 'Escape') {
      // Capture phase + stop: the sheet underneath must not close too.
      e.preventDefault();
      e.stopPropagation();
      requestClose();
      return;
    }
    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) doRedo();
      else doUndo();
      return;
    }
    if (mod && k === 'y') {
      e.preventDefault();
      doRedo();
      return;
    }
    if (mod && k === 's') {
      e.preventDefault();
      void save();
      return;
    }
    if (mod || e.altKey) return;
    if (k === 'p') setTool('pen');
    else if (k === 'h') setTool('highlighter');
    else if (k === 'e') setTool('eraser');
    else if (k === 'v') setTool('hand');
    else if (k === '+' || k === '=') applyZoom(zoomRef.current * 1.25);
    else if (k === '-') applyZoom(zoomRef.current / 1.25);
    else if (k === '0') applyZoom(1);
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  /* ── render ──────────────────────────────────────────────────────── */
  const setPageEl = useCallback((i: number, el: HTMLDivElement | null) => {
    pageEls.current[i] = el;
  }, []);
  const setLiveEl = useCallback((i: number, el: SVGPathElement | null) => {
    liveEls.current[i] = el;
  }, []);

  const pages = src?.pages ?? [];
  const colors = tool === 'highlighter' ? HIGHLIGHT_COLORS : PEN_COLORS;
  const activeColor = tool === 'highlighter' ? hlColor : penColor;
  const sizes = tool === 'highlighter' ? HIGHLIGHT_SIZES : PEN_SIZES;
  const activeSize = tool === 'highlighter' ? hlSize : penSize;
  const showInkOptions = tool === 'pen' || tool === 'highlighter';
  const thumbScale = (p: PageSize) => 84 / Math.max(p.w, p.h * 0.75);

  const hint = penSeen
    ? 'Pen detected — the pen draws; fingers scroll and pinch to zoom.'
    : 'Draw with a pen, a finger or the mouse. Two fingers scroll and zoom; the ✋ tool scrolls with one.';

  return createPortal(
    <motion.div
      className="anno-mask"
      initial={still ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: still ? 0 : 0.2 }}
      onClick={(e) => {
        // Portalled, but React events still bubble through the component
        // tree — a click in here must not reach a card or sheet underneath.
        e.stopPropagation();
        if (e.target === e.currentTarget) requestClose();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onDragOver={(e) => e.stopPropagation()}
      onDrop={(e) => e.stopPropagation()}
    >
      <motion.div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Annotate ${attachment.filename}`}
        className="anno-panel"
        initial={still ? false : { opacity: 0, y: 24, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: still ? { duration: 0 } : entrance }}
      >
        <header className="anno-top">
          <button type="button" className="anno-btn" aria-label="Close" title="Close (Esc)" onClick={requestClose}>
            <X size={18} aria-hidden />
          </button>
          <div className="anno-title">
            <span className="anno-name" title={attachment.filename}>
              {attachment.filename}
            </span>
            <span className="anno-sub mono">
              {phase === 'ready'
                ? `${pages.length} page${pages.length === 1 ? '' : 's'} · ${strokeCount} mark${strokeCount === 1 ? '' : 's'}${dirty ? ' · unsaved' : ''}`
                : phase === 'loading'
                  ? 'Opening…'
                  : 'Cannot open'}
            </span>
          </div>
          <button
            type="button"
            className={`anno-btn anno-review${status === 'reviewed' ? ' on' : ''}`}
            aria-pressed={status === 'reviewed'}
            disabled={phase !== 'ready' || !!saving}
            onClick={() => {
              setStatus((s) => (s === 'reviewed' ? 'draft' : 'reviewed'));
              setDirty(true);
            }}
            title="Mark this file as reviewed"
          >
            <BadgeCheck size={16} aria-hidden />
            <span className="anno-lbl">{status === 'reviewed' ? 'Reviewed' : 'Mark reviewed'}</span>
          </button>
          <button
            type="button"
            className="btn sm solid anno-save"
            disabled={phase !== 'ready' || !!saving}
            onClick={() => void save()}
            title="Save a flattened PDF next to the original (Ctrl+S)"
          >
            {saving ? 'Saving…' : 'Save PDF'}
          </button>
        </header>

        <div className="anno-tools" role="toolbar" aria-label="Drawing tools">
          <div className="anno-group" role="group" aria-label="Tool">
            {TOOL_META.map(({ key, label, key1, Icon }) => (
              <button
                key={key}
                type="button"
                className={`anno-btn anno-tool${tool === key ? ' on' : ''}`}
                aria-pressed={tool === key}
                aria-label={label}
                title={`${label} (${key1})`}
                onClick={() => setTool(key)}
              >
                {tool === key && (
                  <motion.span
                    layoutId="anno-tool-pill"
                    className="anno-pill"
                    transition={reduced ? { duration: 0 } : spring}
                  />
                )}
                <Icon size={18} aria-hidden />
              </button>
            ))}
          </div>
          <AnimatePresence initial={false} mode="popLayout">
            {showInkOptions && (
              <motion.div
                key={tool}
                className="anno-group anno-ink-opts"
                role="group"
                aria-label={`${tool === 'highlighter' ? 'Highlighter' : 'Pen'} colour and width`}
                initial={reduced ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0, transition: reduced ? { duration: 0 } : micro }}
                exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transition: micro }}
              >
                {colors.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    className={`anno-btn anno-swatch${activeColor === c.hex ? ' on' : ''}`}
                    aria-pressed={activeColor === c.hex}
                    aria-label={c.label}
                    title={c.label}
                    onClick={() => (tool === 'highlighter' ? setHlColor(c.hex) : setPenColor(c.hex))}
                  >
                    <span style={{ background: c.hex }} />
                  </button>
                ))}
                {sizes.map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    className={`anno-btn anno-size${activeSize === i ? ' on' : ''}`}
                    aria-pressed={activeSize === i}
                    aria-label={['Fine', 'Medium', 'Bold'][i]}
                    title={['Fine', 'Medium', 'Bold'][i]}
                    onClick={() => (tool === 'highlighter' ? setHlSize(i) : setPenSize(i))}
                  >
                    <span style={{ width: 4 + i * 4, height: 4 + i * 4, background: activeColor }} />
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="anno-group anno-hist" role="group" aria-label="History">
            <button
              type="button"
              className="anno-btn"
              aria-label="Undo"
              title="Undo (Ctrl+Z)"
              disabled={!hist.undo.length}
              onClick={doUndo}
            >
              <Undo2 size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="anno-btn"
              aria-label="Redo"
              title="Redo (Ctrl+Shift+Z)"
              disabled={!hist.redo.length}
              onClick={doRedo}
            >
              <Redo2 size={18} aria-hidden />
            </button>
          </div>
        </div>

        <div className="anno-body">
          {pages.length > 1 && (
            <nav className="anno-thumbs" aria-label="Pages" ref={setThumbEl}>
              {pages.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  className={`anno-thumb${pageNo === i ? ' on' : ''}`}
                  aria-label={`Page ${i + 1}`}
                  aria-current={pageNo === i ? 'page' : undefined}
                  onClick={() => goToPage(i)}
                >
                  {src && (
                    <PageView
                      index={i}
                      size={p}
                      scale={thumbScale(p)}
                      src={src}
                      strokes={hist.ink.strokes[i] ?? []}
                      hidden={null}
                      root={thumbEl}
                      thumb
                    />
                  )}
                  <span className="anno-thumb-n mono">{i + 1}</span>
                </button>
              ))}
            </nav>
          )}

          <div
            className={`anno-scroll tool-${tool}`}
            ref={(el) => {
              scrollRef.current = el;
              setScrollEl(el);
            }}
            onScroll={onScroll}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => onPointerUp(e)}
            onPointerCancel={(e) => onPointerUp(e, true)}
            onContextMenu={(e) => {
              if (drag.current) e.preventDefault();
            }}
          >
            <div className="anno-pages">
              {phase === 'loading' && (
                <div className="anno-loading" aria-label="Opening the file">
                  <div className="skel anno-skel-page" />
                  <div className="skel anno-skel-page" />
                </div>
              )}
              {phase === 'error' && (
                <motion.div
                  className="anno-error"
                  role="alert"
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transition: reduced ? { duration: 0 } : entrance }}
                >
                  <p>{error}</p>
                  <button type="button" className="btn sm" onClick={onClose}>
                    Close
                  </button>
                </motion.div>
              )}
              {phase === 'ready' && src && (
                <>
                  <p className="anno-note">
                    {src.note ? `${src.note} ` : ''}
                    {hint}
                  </p>
                  {pages.map((p, i) => (
                    <PageView
                      key={i}
                      index={i}
                      size={p}
                      scale={scale}
                      src={src}
                      strokes={hist.ink.strokes[i] ?? []}
                      hidden={erasing && erasing.page === i ? erasing.ids : null}
                      root={scrollEl}
                      setEl={setPageEl}
                      setLive={setLiveEl}
                    />
                  ))}
                </>
              )}
            </div>
          </div>
        </div>

        <footer className="anno-foot">
          <div className="anno-group" role="group" aria-label="Page">
            <button
              type="button"
              className="anno-btn"
              aria-label="Previous page"
              disabled={pageNo <= 0}
              onClick={() => goToPage(pageNo - 1)}
            >
              <ChevronLeft size={18} aria-hidden />
            </button>
            <span className="anno-pageno mono" aria-live="polite">
              {pages.length ? `${pageNo + 1} / ${pages.length}` : '–'}
            </span>
            <button
              type="button"
              className="anno-btn"
              aria-label="Next page"
              disabled={pageNo >= pages.length - 1}
              onClick={() => goToPage(pageNo + 1)}
            >
              <ChevronRight size={18} aria-hidden />
            </button>
          </div>
          <div className="anno-group" role="group" aria-label="Zoom">
            <button
              type="button"
              className="anno-btn"
              aria-label="Zoom out"
              title="Zoom out (−)"
              onClick={() => applyZoom(zoomRef.current / 1.25)}
            >
              <ZoomOut size={18} aria-hidden />
            </button>
            <span className="anno-zoom mono">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              className="anno-btn"
              aria-label="Zoom in"
              title="Zoom in (+)"
              onClick={() => applyZoom(zoomRef.current * 1.25)}
            >
              <ZoomIn size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="anno-btn"
              aria-label="Fit to width"
              title="Fit to width (0)"
              onClick={() => applyZoom(1)}
            >
              <Scan size={18} aria-hidden />
            </button>
          </div>
        </footer>

        <AnimatePresence>
          {saving && (
            <motion.div
              className="anno-saving"
              role="status"
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: reduced ? { duration: 0 } : entrance }}
              exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transition: micro }}
            >
              <span>{saving.label}</span>
              <span className="anno-bar">
                <motion.span
                  className="anno-bar-fill"
                  initial={false}
                  animate={{ scaleX: saving.pct }}
                  transition={reduced ? { duration: 0 } : { duration: 0.25, ease: EASE as unknown as number[] }}
                />
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
