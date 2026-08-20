/**
 * A month, at a glance.
 *
 * Work's Board already has a full calendar; this is the small sibling that
 * belongs on a dashboard — the same month, reduced until it fits in a tile and
 * still answering the only question a dashboard calendar is asked: what is
 * coming, and which days are already full.
 *
 * Two deliberate limits:
 *   · Day cells are marks, not controls. A seven-column grid inside a tile
 *     cannot give every day a 44px touch target without ceasing to be a month,
 *     so no day performs an action and nothing is reachable only by tapping
 *     one. Everything actionable is in the list underneath, at full size.
 *   · It reads rows, it never writes them. Editing a day happens on the page
 *     the tile opens, which is where the whole form already lives.
 *
 * `items` is supplied by the caller rather than derived here, because Home and
 * Personal mean different things by "what is on": Home counts assigned work and
 * shared events, Personal counts personal projects, fixed dates and travel. One
 * row, many views — the same task appears in both without being copied.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { todayIso } from '../lib/dates';
import { entrance, useAnimateIn } from './motion';
import './monthcal.css';

/** One thing sitting on a day. `tone` picks the mark's colour, nothing else. */
export interface MonthItem {
  id: string;
  /** Local ISO date, YYYY-MM-DD. */
  date: string;
  label: string;
  /** Shown after the label in the list — a time, a count, a kind. */
  meta?: string;
  tone: 'event' | 'task' | 'date';
  /** Where this item opens, if it opens anywhere. */
  to?: string;
}

const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-08-24` becomes `24 Aug`. Never constructs a Date, so it cannot drift
 *  by a day depending on which of the two time zones the browser is in. */
export function shortDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''}`.trim();
}

/** The month `offset` months away from the one today falls in. */
function useMonthGrid(offset: number) {
  return useMemo(() => {
    const base = new Date(todayIso() + 'T00:00:00');
    const view = new Date(base.getFullYear(), base.getMonth() + offset, 1);
    const year = view.getFullYear();
    const month = view.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    // Monday-first, to match the Board's calendar rather than fight it.
    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
    const iso = (d: number) =>
      `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const label = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(view);
    const short = new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(view);
    return { days, firstDow, iso, label, short };
  }, [offset]);
}

export function MonthCalendar({
  items,
  openTo,
  openLabel,
  upcoming = 3,
  emptyText = 'Nothing on the calendar yet.',
  readOnly = false,
  fit = false,
}: {
  items: MonthItem[];
  /** Where "all of it" lives — the room this is a glance of. */
  openTo?: string;
  openLabel?: string;
  /** How many upcoming items to list under the grid. */
  upcoming?: number;
  emptyText?: string;
  /**
   * Drop every control and every link, leaving only the reading.
   *
   * Personal's tiles wrap their whole glance in one button — tap anywhere,
   * open the side page — so a control inside one is both invalid HTML and a
   * trap for the tap. In that position the month is a picture of the month and
   * the working version is one tap away.
   */
  readOnly?: boolean;
  /**
   * Make the month fill exactly the box it is given, however tall that is.
   *
   * A day cell used to be square, which is right in a narrow tile and wrong in
   * a wide one: at four columns across a cell was ~250px tall, six of those
   * rows came to well over a thousand pixels, and the tile — which clips, by
   * design, so a glance can never scroll — simply cut the month off after the
   * second week. In fit mode the six week rows share whatever height is left
   * over instead of asking for a square, so the whole month is on screen at
   * every tile size and nothing is ever hidden below the fold.
   */
  fit?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const m = useMonthGrid(offset);
  const today = todayIso();
  const animate = useAnimateIn();

  const byDay = useMemo(() => {
    const map = new Map<string, MonthItem[]>();
    for (const it of items) {
      const day = map.get(it.date);
      if (day) day.push(it);
      else map.set(it.date, [it]);
    }
    return map;
  }, [items]);

  const start = m.iso(1);
  const end = m.iso(m.days);
  const inMonth = useMemo(
    () => items.filter((it) => it.date >= start && it.date <= end).length,
    [items, start, end],
  );

  /* "Next" means next from today, not next in the month being browsed: step
     forward three months and the list still says what is actually coming. */
  const next = useMemo(
    () =>
      items
        .filter((it) => it.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date) || a.label.localeCompare(b.label))
        .slice(0, upcoming),
    [items, today, upcoming],
  );

  return (
    <div className={`mcal${fit ? ' fit' : ''}`}>
      <div className={`mcal-bar${readOnly ? ' flat' : ''}`}>
        {!readOnly && (
          <button
            type="button"
            className="mcal-step"
            aria-label="Previous month"
            onClick={() => setOffset((o) => o - 1)}
          >
            <ChevronLeft size={16} strokeWidth={2} aria-hidden />
          </button>
        )}
        <strong className="mcal-label">{m.label}</strong>
        {!readOnly && offset !== 0 && (
          <button type="button" className="mcal-today" onClick={() => setOffset(0)}>
            Today
          </button>
        )}
        <span className="spacer" />
        <span className="mono mcal-count">
          {inMonth} on {m.short}
        </span>
        {!readOnly && (
          <button
            type="button"
            className="mcal-step"
            aria-label="Next month"
            onClick={() => setOffset((o) => o + 1)}
          >
            <ChevronRight size={16} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>

      <div className="mcal-grid" role="grid" aria-label={`${m.label}, days with something on`}>
        {DOW.map((d, i) => (
          <div className="mcal-dow" key={i} aria-hidden>
            {d}
          </div>
        ))}
        {Array.from({ length: m.firstDow }).map((_, i) => (
          <div className="mcal-day empty" key={`pad${i}`} aria-hidden />
        ))}
        {Array.from({ length: m.days }).map((_, i) => {
          const day = i + 1;
          const iso = m.iso(day);
          const on = byDay.get(iso) ?? [];
          const tones = Array.from(new Set(on.map((x) => x.tone))).slice(0, 3);
          return (
            <motion.div
              key={iso}
              role="gridcell"
              className={`mcal-day${iso === today ? ' is-today' : ''}${iso < today ? ' is-past' : ''}`}
              /* The count is spoken, because a dot cannot be. */
              aria-label={
                on.length ? `${day}, ${on.length} item${on.length === 1 ? '' : 's'}` : `${day}`
              }
              title={on.length ? on.map((x) => x.label).join(' · ') : undefined}
              initial={animate ? { opacity: 0, scale: 0.96 } : false}
              animate={{
                opacity: 1,
                scale: 1,
                /* Reduced motion gets the finished state, not a faster version
                   of the animation — the month simply is there. */
                transition: animate
                  ? { ...entrance, delay: Math.min(0.24, i * 0.004) }
                  : { duration: 0 },
              }}
            >
              <span className="mcal-n">{day}</span>
              <span className="mcal-dots" aria-hidden>
                {tones.map((t) => (
                  <i className={`mcal-dot ${t}`} key={t} />
                ))}
              </span>
            </motion.div>
          );
        })}
      </div>

      <div className="mcal-next">
        {next.length === 0 && <p className="tip mcal-empty">{emptyText}</p>}
        {next.map((it) => {
          const body = (
            <>
              <i className={`mcal-dot ${it.tone}`} aria-hidden />
              <span className="mcal-nlabel">{it.label}</span>
              <span className="mono mcal-nmeta">{it.meta ?? shortDate(it.date)}</span>
            </>
          );
          return it.to && !readOnly ? (
            <Link className="mcal-row" to={it.to} key={it.id}>
              {body}
            </Link>
          ) : (
            <div className="mcal-row" key={it.id}>
              {body}
            </div>
          );
        })}
        {openTo && !readOnly && (
          <Link className="mcal-open" to={openTo}>
            {openLabel ?? 'Open the calendar'}
          </Link>
        )}
      </div>
    </div>
  );
}
