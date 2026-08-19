import React, { useId, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useAnimateIn } from './motion';

/**
 * Chart primitives.
 *
 * Palette note: every colour here was checked with the dataviz validator
 * (all-pairs gate) against both the light surface (#FFF) and the dark surface
 * (#151B28). Categorical is capped at THREE slots because four simultaneous
 * hues cannot clear CVD separation inside the dark mode lightness band — for
 * four-way splits (e.g. the projects) use small multiples via <MiniBars>,
 * one hue each, rather than four competing colours in one chart.
 *
 * Categorical order is fixed and never cycled. Series colour follows the
 * entity, never its rank. Every series is direct-labelled, so identity is
 * never carried by colour alone.
 */

export const VIZ = {
  cat: ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)'],
  in: 'var(--viz-in)',
  out: 'var(--viz-out)',
  seq: 'var(--viz-seq)',
  grid: 'var(--line)',
  ink: 'var(--ink)',
  mute: 'var(--mute)',
} as const;

// Animation is decoration: a hidden tab starves rAF, so a chart that animates
// from an empty state would render empty forever. useAnimateIn() returns false
// there and every primitive falls back to its final geometry.
const useMotionOk = useAnimateIn;

/* ── Tooltip shell ────────────────────────────────────────────────────── */
function Tip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: 'translate(-50%,-115%)',
        background: 'var(--ink)',
        color: 'var(--bg)',
        padding: '6px 9px',
        borderRadius: 8,
        fontSize: 11.5,
        fontFamily: '"IBM Plex Mono", monospace',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
        zIndex: 5,
        boxShadow: 'var(--sh2)',
      }}
    >
      {children}
    </div>
  );
}

/* ── Sparkline: change over time, one series ─────────────────────────── */
export function Sparkline({
  values,
  labels,
  height = 40,
  color = VIZ.seq,
  format = (n: number) => String(n),
}: {
  values: number[];
  labels?: string[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId().replace(/:/g, '');
  const motionOk = useMotionOk();
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const w = 100;
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? w / 2 : (i / (values.length - 1)) * w;
    const y = height - ((v - min) / span) * (height - 6) - 3;
    return [x, y] as const;
  });
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${d} L${w},${height} L0,${height} Z`;

  return (
    <div style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${w} ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block', overflow: 'visible' }}
        role="img"
        aria-label={`Trend, ${values.length} points, latest ${format(values[values.length - 1])}`}
      >
        <defs>
          <linearGradient id={`sp${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#sp${gid})`} />
        <motion.path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          initial={motionOk ? { pathLength: 0 } : false}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
        {hover !== null && (
          <circle
            cx={pts[hover][0]}
            cy={pts[hover][1]}
            r={4}
            fill={color}
            stroke="var(--surf)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {/* invisible hit columns — hit targets larger than the marks */}
        {values.map((_, i) => (
          <rect
            key={i}
            x={(i / values.length) * w}
            y={0}
            width={w / values.length}
            height={height}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      {hover !== null && (
        <Tip x={(pts[hover][0] / w) * 100 + '%' as unknown as number} y={pts[hover][1]}>
          {labels?.[hover] ? `${labels[hover]} · ` : ''}
          {format(values[hover])}
        </Tip>
      )}
    </div>
  );
}

/* ── Grouped bars: two series over time (in vs out) ──────────────────── */
export function GroupedBars({
  groups,
  seriesA,
  seriesB,
  labelA,
  labelB,
  format = (n: number) => String(n),
  height = 120,
}: {
  groups: string[];
  seriesA: number[];
  seriesB: number[];
  labelA: string;
  labelB: string;
  format?: (n: number) => string;
  height?: number;
}) {
  const [hover, setHover] = useState<{ i: number; s: 'a' | 'b' } | null>(null);
  const motionOk = useMotionOk();
  const max = Math.max(...seriesA, ...seriesB, 1);

  return (
    <div>
      <div className="viz-legend">
        <span>
          <i style={{ background: VIZ.in }} />
          {labelA}
        </span>
        <span>
          <i style={{ background: VIZ.out }} />
          {labelB}
        </span>
      </div>
      <div className="viz-bars" style={{ height }}>
        {groups.map((g, i) => (
          <div className="viz-bargroup" key={g}>
            <div className="viz-barpair">
              {(['a', 'b'] as const).map((s) => {
                const v = s === 'a' ? seriesA[i] : seriesB[i];
                const pct = (v / max) * 100;
                return (
                  <motion.button
                    key={s}
                    type="button"
                    className="viz-bar"
                    style={{ background: s === 'a' ? VIZ.in : VIZ.out }}
                    initial={motionOk ? { height: 0 } : false}
                    animate={{ height: `${Math.max(pct, v > 0 ? 2 : 0)}%` }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: i * 0.04 }}
                    onMouseEnter={() => setHover({ i, s })}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover({ i, s })}
                    onBlur={() => setHover(null)}
                    aria-label={`${g}, ${s === 'a' ? labelA : labelB}, ${format(v)}`}
                  />
                );
              })}
            </div>
            <span className="viz-barlabel mono">{g}</span>
          </div>
        ))}
        {hover && (
          <div className="viz-tip mono">
            {groups[hover.i]} · {hover.s === 'a' ? labelA : labelB}{' '}
            {format(hover.s === 'a' ? seriesA[hover.i] : seriesB[hover.i])}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Ranked bar rows: magnitude, one hue, always direct-labelled ─────── */
export function BarRows({
  rows,
  format = (n: number) => String(n),
  color = VIZ.seq,
  max: maxOverride,
}: {
  rows: { label: string; value: number; color?: string }[];
  format?: (n: number) => string;
  color?: string;
  max?: number;
}) {
  const motionOk = useMotionOk();
  const max = maxOverride ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="viz-rows">
      {rows.map((r, i) => (
        <div className="viz-row" key={r.label}>
          <span className="viz-rowlabel">{r.label}</span>
          <span className="viz-rowtrack">
            <motion.i
              style={{ background: r.color ?? color }}
              initial={motionOk ? { width: 0 } : false}
              animate={{ width: `${(r.value / max) * 100}%` }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: i * 0.04 }}
            />
          </span>
          <span className="viz-rowvalue mono">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Donut: composition, ≤3 slices + Other ───────────────────────────── */
export function Donut({
  slices,
  size = 108,
  centerLabel,
  centerValue,
}: {
  slices: { label: string; value: number; color?: string }[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const motionOk = useMotionOk();
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const r = 15.9155;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="viz-donutwrap">
      <svg viewBox="0 0 36 36" style={{ width: size, height: size }} role="img" aria-label={centerLabel}>
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--surf3)" strokeWidth="4.2" />
        {slices.map((s, i) => {
          const frac = s.value / total;
          const dash = frac * circ;
          const el = (
            <motion.circle
              key={s.label}
              cx="18"
              cy="18"
              r={r}
              fill="none"
              stroke={s.color ?? VIZ.cat[i % VIZ.cat.length]}
              strokeWidth="4.2"
              strokeLinecap="butt"
              // 2px surface gap between segments
              strokeDasharray={`${Math.max(0, dash - 0.7)} ${circ - Math.max(0, dash - 0.7)}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 18 18)"
              initial={motionOk ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      {(centerValue || centerLabel) && (
        <div className="viz-donutcenter">
          {centerValue && <b>{centerValue}</b>}
          {centerLabel && <span>{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}

/* ── Ring gauge: a single percentage ─────────────────────────────────── */
export function Ring({
  pct,
  size = 46,
  color = VIZ.seq,
  label,
}: {
  pct: number;
  size?: number;
  color?: string;
  label?: string;
}) {
  const motionOk = useMotionOk();
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <svg viewBox="0 0 36 36" style={{ width: size, height: size, flex: 'none' }} role="img" aria-label={label ?? `${clamped}%`}>
      <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--surf3)" strokeWidth="3.6" />
      <motion.circle
        cx="18"
        cy="18"
        r="15.9"
        fill="none"
        stroke={color}
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeDasharray="100"
        transform="rotate(-90 18 18)"
        initial={motionOk ? { strokeDashoffset: 100 } : false}
        animate={{ strokeDashoffset: 100 - clamped }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      />
    </svg>
  );
}

/* ── Heatmap strip: activity per day ─────────────────────────────────── */
export function HeatStrip({
  cells,
  format = (n: number) => String(n),
}: {
  cells: { label: string; value: number }[];
  format?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...cells.map((c) => c.value), 1);
  return (
    <div className="viz-heat">
      {cells.map((c, i) => {
        // sequential: one hue, light→dark by magnitude
        const t = c.value / max;
        return (
          <button
            type="button"
            key={c.label + i}
            className="viz-heatcell"
            style={{
              background:
                c.value === 0
                  ? 'var(--surf3)'
                  : `color-mix(in oklab, var(--viz-seq) ${Math.round(18 + t * 82)}%, var(--surf))`,
            }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
            aria-label={`${c.label}: ${format(c.value)}`}
          />
        );
      })}
      {hover !== null && (
        <div className="viz-tip mono">
          {cells[hover].label} · {format(cells[hover].value)}
        </div>
      )}
    </div>
  );
}

/* ── Stacked split bar: two-part composition ─────────────────────────── */
export function SplitBar({
  parts,
  height = 12,
}: {
  parts: { label: string; value: number; color: string }[];
  height?: number;
}) {
  const motionOk = useMotionOk();
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  return (
    <div>
      <div className="viz-split" style={{ height }}>
        {parts.map((p) => (
          <motion.span
            key={p.label}
            style={{ background: p.color }}
            initial={motionOk ? { flexGrow: 0 } : false}
            animate={{ flexGrow: p.value / total }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            title={`${p.label}: ${p.value}`}
          />
        ))}
      </div>
      <div className="viz-legend">
        {parts.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Small multiples: the four-way split, one hue each ───────────────── */
export function MiniBars({
  items,
  format = (n: number) => String(n),
}: {
  items: { label: string; value: number; max?: number; color?: string }[];
  format?: (n: number) => string;
}) {
  const motionOk = useMotionOk();
  return (
    <div className="viz-minis">
      {items.map((it, i) => {
        const max = it.max ?? Math.max(...items.map((x) => x.value), 1);
        return (
          <div className="viz-mini" key={it.label}>
            <span className="viz-minilabel">{it.label}</span>
            <span className="viz-minitrack">
              <motion.i
                style={{ background: it.color ?? VIZ.seq }}
                initial={motionOk ? { width: 0 } : false}
                animate={{ width: `${(it.value / max) * 100}%` }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1], delay: i * 0.05 }}
              />
            </span>
            <b className="mono">{format(it.value)}</b>
          </div>
        );
      })}
    </div>
  );
}

/* ── Day timeline: today's events as a single ribbon ─────────────────── */
export function DayRibbon({
  events,
  nowMin,
  startHour = 7,
  endHour = 22,
  onPick,
}: {
  events: { id: string; start_min: number; end_min: number; label: string; kind: string; accountLabel?: string | null }[];
  nowMin: number;
  startHour?: number;
  endHour?: number;
  onPick?: (id: string) => void;
}) {
  const span = (endHour - startHour) * 60;
  const pos = (m: number) => ((m - startHour * 60) / span) * 100;
  const kindColor: Record<string, string> = {
    focus: 'var(--viz-1)',
    meeting: 'var(--viz-2)',
    study: 'var(--viz-3)',
    admin: 'var(--mute)',
    personal: 'var(--viz-in)',
  };
  const hours = useMemo(
    () => Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i).filter((h) => h % 3 === 0),
    [startHour, endHour],
  );
  return (
    <div className="viz-ribbon">
      <div className="viz-ribbontrack">
        {hours.map((h) => (
          <span key={h} className="viz-ribbontick" style={{ left: `${pos(h * 60)}%` }}>
            <i />
            <em className="mono">{String(h).padStart(2, '0')}</em>
          </span>
        ))}
        {events.map((e) => (
          <button
            type="button"
            key={e.id}
            className="viz-ribbonev"
            style={{
              left: `${Math.max(0, pos(e.start_min))}%`,
              width: `${Math.max(2, pos(e.end_min) - pos(e.start_min))}%`,
              background: kindColor[e.kind] ?? 'var(--viz-seq)',
            }}
            onClick={() => onPick?.(e.id)}
            title={`${e.label} · ${String(Math.floor(e.start_min / 60)).padStart(2, '0')}:${String(e.start_min % 60).padStart(2, '0')}${e.accountLabel ? ` · ${e.accountLabel}` : ''}`}
          >
            <span>{e.label}</span>
            {e.accountLabel && <small>{e.accountLabel}</small>}
          </button>
        ))}
        {nowMin >= startHour * 60 && nowMin <= endHour * 60 && (
          <span className="viz-ribbonnow" style={{ left: `${pos(nowMin)}%` }} aria-label="now" />
        )}
      </div>
    </div>
  );
}
