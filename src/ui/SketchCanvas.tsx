/**
 * Somewhere to actually write.
 *
 * A pen surface for a scribble or a wiki block: S Pen, Apple Pencil, finger,
 * or mouse. It does not recognise handwriting and it never will — what you
 * drew is stored as the strokes you drew (see lib/sketch.ts for why vectors
 * rather than a picture).
 *
 * Two things here are load-bearing rather than stylistic:
 *
 *  - **One commit per stroke.** `onChange` fires on pen-lift, never on move.
 *    The wiki debounces a page save 600 ms and writes a full revision
 *    snapshot per flush, and every store write appends to the audit trail;
 *    committing per pointermove would mean a revision and a trail entry per
 *    pixel. This is the same draft-then-commit shape the Home tile drag uses.
 *
 *  - **Coalesced events.** A stylus reports far faster than the browser
 *    fires pointermove, and `getCoalescedEvents()` is the whole difference
 *    between smooth ink and a polygon. It costs one line and no dependency.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Eraser, Maximize2, Minimize2, Pen, Redo2, Trash2, Undo2 } from 'lucide-react';
import { newId } from '../data/store';
import {
  SKETCH_COLORS,
  SKETCH_H,
  SKETCH_SIZES,
  SKETCH_W,
  SKETCH_WARN_RATIO,
  canAddStroke,
  isSketchData,
  makeSketch,
  quantizeStroke,
  simplifyPoints,
  sketchColorVar,
  sketchFullness,
  sketchIsEmpty,
  strokeHit,
  strokePathD,
  type SketchData,
  type SketchStroke,
} from '../lib/sketch';
import { useToast } from './bits';
import { entrance, micro } from './motion';
import './sketch.css';

/**
 * Palm rejection, in three lines.
 *
 * Once a real pen has been seen, treat touch as a hand resting on the glass
 * rather than a finger drawing. Session-scoped and deliberately not a
 * setting: someone who never picks up a stylus never trips it, and someone
 * who does expects exactly this.
 */
let sawPen = false;

const clamp = (n: number, max: number) => (n < 0 ? 0 : n > max ? max : n);

/** One stroke, painted. Split out so React can skip re-rendering settled ink
 *  while a new stroke is being drawn on the overlay above it. */
function StrokePath({ stroke }: { stroke: SketchStroke }) {
  const d = strokePathD(stroke);
  if (!d) return null;
  return (
    <path
      d={d}
      fill="none"
      stroke={sketchColorVar(stroke.color)}
      strokeWidth={stroke.size}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/**
 * The read view — an inline SVG, so ink stays sharp at any size and picks up
 * the theme's colours rather than baking them in.
 */
export function SketchSvg({
  data,
  className = '',
  label = 'Sketch',
}: {
  data: SketchData | null | undefined;
  className?: string;
  label?: string;
}) {
  const safe = isSketchData(data) ? data : null;
  return (
    <svg
      className={`sk-svg ${className}`.trim()}
      viewBox={`0 0 ${safe?.w ?? SKETCH_W} ${safe?.h ?? SKETCH_H}`}
      role="img"
      aria-label={label}
      preserveAspectRatio="xMidYMid meet"
    >
      {(safe?.strokes ?? []).map((stroke) => (
        <StrokePath key={stroke.id} stroke={stroke} />
      ))}
    </svg>
  );
}

type Tool = 'pen' | 'eraser';

export function SketchCanvas({
  value,
  onChange,
  expandable = false,
  ariaLabel = 'Drawing surface',
}: {
  value: SketchData | null | undefined;
  onChange: (next: SketchData) => void;
  expandable?: boolean;
  ariaLabel?: string;
}) {
  const toast = useToast();
  const reduced = useReducedMotion();
  const data = useMemo(() => (isSketchData(value) ? value : makeSketch()), [value]);

  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('ink');
  const [size, setSize] = useState<number>(SKETCH_SIZES[1]);
  const [expanded, setExpanded] = useState(false);
  const [undoStack, setUndoStack] = useState<SketchStroke[][]>([]);
  const [redoStack, setRedoStack] = useState<SketchStroke[][]>([]);

  const surface = useRef<HTMLDivElement | null>(null);
  /** The stroke being drawn right now. A ref, not state: it is appended to on
   *  every coalesced sample and copying the array each time would be the one
   *  thing slow enough to be felt. */
  const live = useRef<SketchStroke | null>(null);
  /** Strokes the eraser has passed over this gesture, hidden immediately and
   *  removed for real on release. */
  const erasing = useRef<Set<string>>(new Set());
  const [, forceRender] = useState(0);
  const paint = useCallback(() => forceRender((n) => n + 1), []);

  /** Every mutation goes through here so undo history and the commit are
   *  never out of step. */
  const commit = useCallback(
    (strokes: SketchStroke[]) => {
      setUndoStack((stack) => [...stack.slice(-49), data.strokes]);
      setRedoStack([]);
      onChange({ ...data, strokes });
    },
    [data, onChange],
  );

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (!stack.length) return stack;
      const previous = stack[stack.length - 1];
      setRedoStack((redo) => [...redo, data.strokes]);
      onChange({ ...data, strokes: previous });
      return stack.slice(0, -1);
    });
  }, [data, onChange]);

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (!stack.length) return stack;
      const next = stack[stack.length - 1];
      setUndoStack((undoStackNow) => [...undoStackNow, data.strokes]);
      onChange({ ...data, strokes: next });
      return stack.slice(0, -1);
    });
  }, [data, onChange]);

  const pointAt = useCallback((clientX: number, clientY: number) => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return {
      x: clamp(((clientX - rect.left) / rect.width) * data.w, data.w),
      y: clamp(((clientY - rect.top) / rect.height) * data.h, data.h),
    };
  }, [data.h, data.w]);

  /** Detaches the in-flight gesture, if there is one. Kept in a ref so an
   *  unmount mid-stroke cannot strand window listeners. */
  const endGesture = useRef<(() => void) | null>(null);
  useEffect(() => () => endGesture.current?.(), []);

  const onPointerDown = (event: React.PointerEvent) => {
    // Let a right-click or a middle-click be what it is; pen and touch have
    // no meaningful button state, so only mouse is filtered.
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    if (event.pointerType === 'pen') sawPen = true;
    else if (event.pointerType === 'touch' && sawPen) return;

    const start = pointAt(event.clientX, event.clientY);
    if (!start) return;
    event.preventDefault();
    endGesture.current?.();
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      /* the window listeners below are what actually track the gesture */
    }

    const erasingNow = tool === 'eraser';
    if (erasingNow) {
      erasing.current = new Set();
      data.strokes.forEach((stroke) => {
        if (strokeHit(stroke, start.x, start.y)) erasing.current.add(stroke.id);
      });
    } else {
      const pressure = event.pressure > 0 ? event.pressure : 0.5;
      live.current = { id: newId('st'), color, size, points: [start.x, start.y, pressure] };
    }

    // Listeners are attached here rather than from an effect, because an
    // effect only runs after the next render — and the first pointermove can
    // arrive before that, which would silently drop the start of a stroke.
    // Tracked on the window so a stroke that leaves the surface mid-flick
    // still ends cleanly instead of hanging until the next click.
    const move = (moveEvent: PointerEvent) => {
      if (erasingNow) {
        const at = pointAt(moveEvent.clientX, moveEvent.clientY);
        if (!at) return;
        let changed = false;
        data.strokes.forEach((stroke) => {
          if (erasing.current.has(stroke.id)) return;
          if (strokeHit(stroke, at.x, at.y)) {
            erasing.current.add(stroke.id);
            changed = true;
          }
        });
        if (changed) paint();
        return;
      }
      const drawing = live.current;
      if (!drawing) return;
      // The smoothness of the whole feature lives on this line: a stylus
      // reports far faster than pointermove fires, and the samples in between
      // are the difference between ink and a polygon.
      const samples = moveEvent.getCoalescedEvents?.() ?? [moveEvent];
      for (const sample of samples.length ? samples : [moveEvent]) {
        const at = pointAt(sample.clientX, sample.clientY);
        if (!at) continue;
        drawing.points.push(at.x, at.y, sample.pressure > 0 ? sample.pressure : 0.5);
      }
      paint();
    };

    const detach = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      endGesture.current = null;
    };

    function finish() {
      detach();
      if (erasingNow) {
        const gone = erasing.current;
        erasing.current = new Set();
        if (gone.size) commit(data.strokes.filter((stroke) => !gone.has(stroke.id)));
        else paint();
        return;
      }
      const drawing = live.current;
      live.current = null;
      if (!drawing) return;
      const finished = quantizeStroke({ ...drawing, points: simplifyPoints(drawing.points) });
      if (finished.points.length < 3) {
        paint();
        return;
      }
      if (!canAddStroke(data, finished)) {
        toast('This sketch is full — erase something, or start another one.');
        paint();
        return;
      }
      commit([...data.strokes, finished]);
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    endGesture.current = detach;
    paint();
  };

  const fullness = sketchFullness(data);
  const visible = data.strokes.filter((stroke) => !erasing.current.has(stroke.id));

  const board = (
    <div className={`sk-board${expanded ? ' sk-expanded' : ''}`}>
      <div className="sk-tools" role="toolbar" aria-label="Drawing tools">
        <div className="sk-group" role="group" aria-label="Tool">
          <button
            type="button"
            className={`sk-btn${tool === 'pen' ? ' on' : ''}`}
            aria-pressed={tool === 'pen'}
            aria-label="Pen"
            title="Pen"
            onClick={() => setTool('pen')}
          >
            <Pen size={15} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className={`sk-btn${tool === 'eraser' ? ' on' : ''}`}
            aria-pressed={tool === 'eraser'}
            aria-label="Eraser — removes a whole stroke"
            title="Eraser"
            onClick={() => setTool('eraser')}
          >
            <Eraser size={15} strokeWidth={2} aria-hidden />
          </button>
        </div>

        <div className="sk-group" role="group" aria-label="Ink colour">
          {SKETCH_COLORS.map((swatch) => (
            <button
              key={swatch.key}
              type="button"
              className={`sk-swatch${color === swatch.key && tool === 'pen' ? ' on' : ''}`}
              style={{ ['--sk-swatch' as string]: sketchColorVar(swatch.key) }}
              aria-pressed={color === swatch.key}
              aria-label={swatch.label}
              title={swatch.label}
              onClick={() => {
                setColor(swatch.key);
                setTool('pen');
              }}
            >
              <span aria-hidden />
            </button>
          ))}
        </div>

        <div className="sk-group" role="group" aria-label="Pen size">
          {SKETCH_SIZES.map((option) => (
            <button
              key={option}
              type="button"
              className={`sk-size${size === option ? ' on' : ''}`}
              aria-pressed={size === option}
              aria-label={`${option === 3 ? 'Fine' : option === 6 ? 'Medium' : 'Broad'} nib`}
              title={option === 3 ? 'Fine' : option === 6 ? 'Medium' : 'Broad'}
              onClick={() => {
                setSize(option);
                setTool('pen');
              }}
            >
              <span aria-hidden style={{ width: option + 2, height: option + 2 }} />
            </button>
          ))}
        </div>

        <span className="sk-spacer" />

        <div className="sk-group" role="group" aria-label="History">
          <button
            type="button"
            className="sk-btn"
            aria-label="Undo"
            title="Undo"
            disabled={!undoStack.length}
            onClick={undo}
          >
            <Undo2 size={15} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className="sk-btn"
            aria-label="Redo"
            title="Redo"
            disabled={!redoStack.length}
            onClick={redo}
          >
            <Redo2 size={15} strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className="sk-btn"
            aria-label="Clear the whole sketch"
            title="Clear"
            disabled={sketchIsEmpty(data)}
            onClick={() => {
              if (!window.confirm('Clear everything on this sketch?')) return;
              commit([]);
            }}
          >
            <Trash2 size={15} strokeWidth={2} aria-hidden />
          </button>
          {expandable && (
            <button
              type="button"
              className="sk-btn"
              aria-label={expanded ? 'Leave full screen' : 'Draw full screen'}
              title={expanded ? 'Close' : 'Full screen'}
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded ? <Minimize2 size={15} strokeWidth={2} aria-hidden /> : <Maximize2 size={15} strokeWidth={2} aria-hidden />}
            </button>
          )}
        </div>
      </div>

      <div
        ref={surface}
        className={`sk-surface${tool === 'eraser' ? ' sk-erasing' : ''}`}
        style={{ aspectRatio: `${data.w} / ${data.h}` }}
        role="application"
        aria-label={ariaLabel}
        onPointerDown={onPointerDown}
      >
        <svg
          className="sk-svg"
          viewBox={`0 0 ${data.w} ${data.h}`}
          aria-hidden
          preserveAspectRatio="xMidYMid meet"
        >
          {visible.map((stroke) => (
            <StrokePath key={stroke.id} stroke={stroke} />
          ))}
          {live.current && <StrokePath stroke={live.current} />}
        </svg>
        {sketchIsEmpty(data) && !live.current && (
          <p className="sk-empty">Write or draw here — pen, finger, or mouse.</p>
        )}
      </div>

      {fullness >= SKETCH_WARN_RATIO && (
        <p className="tip sk-full">
          This sketch is nearly full ({Math.round(fullness * 100)}%). Start another one for the rest.
        </p>
      )}
    </div>
  );

  if (!expanded) return board;
  // Portalled so a parent's overflow or transform cannot clip full screen.
  return createPortal(
    <AnimatePresence>
      <motion.div
        className="sk-fullscreen"
        role="dialog"
        aria-modal="true"
        aria-label="Full screen drawing"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1, transition: reduced ? { duration: 0 } : entrance }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, transition: micro }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setExpanded(false);
        }}
      >
        {board}
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
