/**
 * The workflow view: everything that ever happened to one task.
 *
 * Rendered as the Task page's "Workflow" tab, which is what names the panel —
 * hence no heading of its own here.
 *
 * The narration itself lives in `lib/taskTimeline.ts` as a pure function, so
 * this file is only presentation — a rail, a marker per event, and a filter.
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useData } from '../../data/store';
import { entrance, micro, staggerItem, staggerParent } from '../../ui/motion';
import { fmtDateTime } from '../../lib/dates';
import { buildTaskTimeline, type TimelineEvent, type TimelineKind } from '../../lib/taskTimeline';

/** Marker glyph per kind. Text, not icons — they stay legible at 11px. */
const GLYPH: Record<TimelineKind, string> = {
  created: '✦',
  assigned: '→',
  accepted: '✓',
  pushed_back: '↩',
  status: '◆',
  priority: '!',
  progress: '%',
  schedule: '📅',
  blocked: '⚠',
  comment: '💬',
  subtask: '☑',
  link: '🔗',
  evidence: '📎',
  decision: '⚖',
  edit: '✎',
};

/**
 * Coarse groups for the filter. Deliberately fewer buttons than there are
 * kinds — a filter with fifteen options is a second problem, not a solution.
 */
const GROUPS: { key: string; label: string; kinds: TimelineKind[] }[] = [
  { key: 'all', label: 'Everything', kinds: [] },
  {
    key: 'handoff',
    label: 'Handoff',
    kinds: ['created', 'assigned', 'accepted', 'pushed_back'],
  },
  { key: 'progress', label: 'Progress', kinds: ['status', 'progress', 'subtask', 'blocked'] },
  { key: 'talk', label: 'Comments', kinds: ['comment', 'decision'] },
];

export default function Timeline({ taskId }: { taskId: string }) {
  const ds = useData((d) => d);
  const [group, setGroup] = useState('all');
  const [newestFirst, setNewestFirst] = useState(false);
  const still = useReducedMotion();

  const all = useMemo(() => buildTaskTimeline(ds, taskId), [ds, taskId]);

  const events = useMemo(() => {
    const picked = GROUPS.find((g) => g.key === group);
    const filtered =
      !picked || picked.kinds.length === 0
        ? all
        : all.filter((e) => picked.kinds.includes(e.kind));
    return newestFirst ? [...filtered].reverse() : filtered;
  }, [all, group, newestFirst]);

  if (all.length === 0) {
    return (
      <section aria-label="Task history">
        <p className="none">
          Nothing recorded yet. Every change from here on is logged — the trail is
          append-only, so this cannot be edited after the fact.
        </p>
      </section>
    );
  }

  return (
    <section aria-label="Task history">
      <div className="tl-controls">
        <div className="tl-filters" role="group" aria-label="Filter history">
          {GROUPS.map((g) => {
            const n = g.kinds.length === 0 ? all.length : all.filter((e) => g.kinds.includes(e.kind)).length;
            return (
              <button
                key={g.key}
                type="button"
                className="tl-filter"
                aria-pressed={group === g.key}
                disabled={n === 0}
                onClick={() => setGroup(g.key)}
              >
                {g.label} <span className="mono">{n}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="tl-filter"
          aria-pressed={newestFirst}
          onClick={() => setNewestFirst((v) => !v)}
        >
          {newestFirst ? 'Newest first' : 'Oldest first'}
        </button>
      </div>

      <motion.ol className="tl" {...staggerParent()}>
        <AnimatePresence initial={false}>
          {events.map((e) => (
            <motion.li
              key={e.id}
              className={`tl-row k-${e.kind}`}
              variants={staggerItem}
              layout={still ? false : 'position'}
              initial={still ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0, transition: still ? { duration: 0 } : entrance }}
              exit={still ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transition: micro }}
            >
              <span className="tl-mark" aria-hidden="true">
                {GLYPH[e.kind]}
              </span>
              <div className="tl-body">
                <p className="tl-line">
                  <b>{e.actor}</b> {e.text}
                </p>
                {e.detail && <blockquote className="tl-detail">{e.detail}</blockquote>}
                <time className="tl-when mono" dateTime={e.at}>
                  {fmtDateTime(e.at)}
                </time>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ol>

      {events.length === 0 && <p className="none">Nothing of that kind on this task.</p>}
    </section>
  );
}

export type { TimelineEvent };
