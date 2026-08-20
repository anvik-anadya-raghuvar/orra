/**
 * The running block, over everything.
 *
 * Mounted app-wide rather than inside Home, because a block is a state the
 * whole portal is in: while one runs, navigation, mail and counts are gone.
 * It reappears after a reload because the block lives in the database — the
 * component holds no timer state worth losing, only a tick to re-render.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { newId, useData, useStore } from '../data/store';
import { useToast } from './bits';
import BlockCompanion from './companion/BlockCompanion';
import { entrance, micro } from './motion';
import { todayIso } from '../lib/dates';
import {
  SCOPE_COPY,
  activeBlockFor,
  blockLines,
  clockLabel,
  elapsedSec,
  logKind,
  loggedMinutes,
  resumePatch,
  targetPct,
  targetReached,
  type BlockLine,
} from '../lib/blocks';
import './block.css';

export default function BlockOverlay() {
  const ds = useData((d) => d);
  const store = useStore();
  const meId = useData((_, s) => s.meId);
  const toast = useToast();
  const reduced = useReducedMotion();
  const block = activeBlockFor(ds, meId);

  /* Only forces a repaint — the number itself is derived from started_at, so
     a missed tick (background tab, sleep) costs nothing. */
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!block || block.paused_at) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [block?.id, block?.paused_at]);

  const [chime, setChime] = useState(false);
  const reached = block ? targetReached(block) : false;
  useEffect(() => {
    if (reached && !chime) {
      setChime(true);
      toast('Target reached. Stand up, drink water — or keep going.');
    }
    if (!reached && chime) setChime(false);
  }, [reached, chime, toast]);

  if (!block) return null;

  const copy = SCOPE_COPY[block.scope];
  const lines = blockLines(ds, block, todayIso());
  const running = !block.paused_at;
  const seconds = elapsedSec(block);
  const pct = targetPct(block);
  const focusLine = block.focus_task_id
    ? ds.tasks.find((t) => t.id === block.focus_task_id)
    : null;
  const zoneTime = (timeZone: string) =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());

  const pauseResume = () => {
    if (running) {
      store.update(
        'active_blocks',
        block.id,
        { paused_at: new Date().toISOString() },
        store.asMe({ silent: true }),
      );
    } else {
      store.update('active_blocks', block.id, resumePatch(block), store.asMe({ silent: true }));
    }
  };

  const end = () => {
    const minutes = loggedMinutes(block);
    store.insert(
      'time_logs',
      {
        id: newId('tl'),
        user_id: meId,
        date: todayIso(),
        kind: logKind(block.scope, block.log_kind),
        minutes,
        course_id: block.course_id,
      },
      store.asMe({ summary: `${copy.label} — ${minutes} min logged` }),
    );
    store.remove('active_blocks', block.id, store.asMe({ silent: true }));
    toast(`${minutes} minute${minutes === 1 ? '' : 's'} logged — edit it in the time ledger.`);
  };

  const discard = () => {
    if (!window.confirm('Discard this block? The time will not be logged.')) return;
    store.remove('active_blocks', block.id, store.asMe({ summary: `${copy.label} discarded` }));
    toast('Discarded. Nothing logged.');
  };

  /** Ticking a line closes the real thing it stands for, never a copy. */
  const toggle = (line: BlockLine) => {
    if (line.customItemId) {
      store.update(
        'active_blocks',
        block.id,
        {
          custom_items: (block.custom_items ?? []).map((item) =>
            item.id === line.customItemId ? { ...item, done: !item.done } : item,
          ),
        },
        store.asMe({ silent: true }),
      );
      return;
    }
    if (line.taskId) {
      const task = ds.tasks.find((t) => t.id === line.taskId);
      if (!task) return;
      const next = task.status !== 'done';
      store.update(
        'tasks',
        task.id,
        next ? { status: 'done', progress_pct: 100 } : { status: 'in_progress' },
        store.asMe({ summary: `${task.id} ${next ? 'closed' : 'reopened'} in a ${copy.label.toLowerCase()}` }),
      );
      return;
    }
    if (line.courseItemId) {
      const item = ds.course_items.find((i) => i.id === line.courseItemId);
      if (!item) return;
      store.update(
        'course_items',
        item.id,
        { completed: !item.completed },
        store.asMe({ summary: `${item.title} ${!item.completed ? 'done' : 'reopened'}` }),
      );
      return;
    }
    // A typed intention: it owns its own done flag.
    const intention = ds.day_plan_items.find((i) => i.id === line.id);
    if (intention) {
      store.update(
        'day_plan_items',
        intention.id,
        { done: !intention.done },
        store.asMe({ silent: true }),
      );
    }
  };

  const setFocus = (line: BlockLine) => {
    if (!line.taskId) return;
    store.update(
      'active_blocks',
      block.id,
      { focus_task_id: line.taskId === block.focus_task_id ? null : line.taskId },
      store.asMe({ silent: true }),
    );
  };

  const surfaceStuck = () => {
    if (!focusLine) return;
    store.update(
      'tasks',
      focusLine.id,
      { is_stuck: true },
      store.asMe({ summary: `Surfaced as stuck in a ${copy.label.toLowerCase()}` }),
    );
    toast('Surfaced as stuck — not failed.');
  };

  return (
    <AnimatePresence>
      <motion.div
        className="blk-mask"
        role="dialog"
        aria-modal="true"
        aria-label={copy.label}
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: micro }}
        transition={entrance}
      >
        <div className="blk-now-art" aria-hidden>
          <span>N</span><i>:</i><span>OW</span>
        </div>
        <div className="blk-shell">
          <div className="blk-hd">
            <span className="eyebrow">{block.custom_label || copy.label}</span>
            <span className="spacer" />
            <span className="mono blk-meta">
              {lines.filter((l) => l.done).length}/{lines.length} done
            </span>
          </div>
          <p className="blk-blurb">{copy.blurb}</p>

          <div className="blk-zones" aria-label="Current time in India and Italy">
            <span><b>India</b> <i className="mono">{zoneTime('Asia/Kolkata')}</i></span>
            <span><b>Italy</b> <i className="mono">{zoneTime('Europe/Rome')}</i></span>
          </div>

          <div className={`blk-clock${running ? '' : ' paused'}`} aria-live="polite">
            {clockLabel(seconds)}
          </div>
          {pct !== null && (
            <div className="blk-target" aria-hidden>
              <motion.span animate={{ width: `${pct}%` }} transition={reduced ? { duration: 0 } : entrance} />
            </div>
          )}
          <div className="mono blk-meta">
            {block.target_minutes
              ? `of ${block.target_minutes} minutes${running ? '' : ' · paused'}`
              : running
                ? 'running'
                : 'paused'}
          </div>

          {focusLine && (
            <div className="blk-focus">
              <span className="eyebrow">Focusing on</span>
              <h2>{focusLine.title}</h2>
              <div className="mono blk-meta">
                {focusLine.id} · {focusLine.effort}
              </div>
            </div>
          )}

          {lines.length === 0 ? (
            <p className="blk-empty">Nothing open in this category. Rare — enjoy it.</p>
          ) : (
            <div className="blk-list">
              {lines.map((l) => (
                <div
                  key={l.id}
                  className={`blk-row${l.done ? ' done' : ''}${
                    l.taskId && l.taskId === block.focus_task_id ? ' is-focus' : ''
                  }`}
                >
                  <button
                    type="button"
                    className="blk-dot"
                    aria-pressed={l.done}
                    aria-label={`${l.done ? 'Reopen' : 'Complete'} ${l.label}`}
                    onClick={() => toggle(l)}
                  />
                  <button
                    type="button"
                    className="blk-label"
                    style={{ flex: 1, textAlign: 'left', color: 'inherit' }}
                    onClick={() => setFocus(l)}
                    title={l.taskId ? 'Focus on this one' : undefined}
                  >
                    {l.label}
                  </button>
                </div>
              ))}
            </div>
          )}

          <p className="blk-note">
            Navigation, mail and counts are hidden until this block ends.
          </p>
          <div className="blk-acts">
            <button type="button" className="btn solid" onClick={end}>
              End block &amp; log
            </button>
            <button type="button" className="btn" onClick={pauseResume}>
              {running ? 'Pause' : 'Resume'}
            </button>
            {focusLine && (
              <button type="button" className="btn" onClick={surfaceStuck}>
                I&apos;m stuck
              </button>
            )}
            <button type="button" className="btn danger" onClick={discard}>
              Discard
            </button>
          </div>
        </div>

        {/*
          Vik stays unmounted from the normal companion layer during your own
          block — a draggable, pokeable toy on top of a focus session would
          breach the one rule he is built around. This is a second, silent one
          instead: no pointer events, no bubble, no poke, no games, no xp. He
          marches, and he tires.
        */}
        <BlockCompanion minutes={Math.floor(seconds / 60)} />
      </motion.div>
    </AnimatePresence>
  );
}
