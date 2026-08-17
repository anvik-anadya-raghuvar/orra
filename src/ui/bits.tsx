import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useData } from '../data/store';
import { entrance } from './motion';

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

/* ── Modal (desktop dialog / mobile full-screen sheet) ───────────────── */
export function Modal({
  open,
  onClose,
  children,
  title,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(10,13,20,.5)',
            backdropFilter: 'blur(4px)',
            zIndex: 60,
            display: 'grid',
            placeItems: 'start center',
            padding: '54px 0 0',
            overflow: 'auto',
          }}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: entrance }}
            exit={{ opacity: 0, y: 10, transition: { duration: 0.15 } }}
            onClick={(e) => e.stopPropagation()}
            className="modal-sheet"
            style={{
              background: 'var(--surf)',
              border: '1px solid var(--line)',
              boxShadow: 'var(--sh2)',
              width: '100%',
              padding: 22,
            }}
          >
            {title && <h3 style={{ fontSize: 18, marginBottom: 13 }}>{title}</h3>}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
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
export function CountUp({ value, format }: { value: number; format?: (n: number) => string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const target = useRef(value);
  useEffect(() => {
    target.current = value;
    if (reduced) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const from = shown;
    const dur = 600;
    let raf: number;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from + (target.current - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduced]);
  const n = Math.round(shown);
  return <>{format ? format(n) : n.toLocaleString('en-IN')}</>;
}

/* ── Skeleton ─────────────────────────────────────────────────────────── */
export function Skeleton({ h = 16, w = '100%', style }: { h?: number; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skel" style={{ height: h, width: w, ...style }} aria-hidden />;
}

/* ── Progress bar ─────────────────────────────────────────────────────── */
export function ProgressBar({ pct, grad = 'linear-gradient(90deg,var(--violet),var(--indigo))' }: { pct: number; grad?: string }) {
  return (
    <div style={{ height: 5, borderRadius: 4, background: 'var(--line)', overflow: 'hidden' }}>
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        style={{ height: '100%', background: grad, borderRadius: 4 }}
      />
    </div>
  );
}
