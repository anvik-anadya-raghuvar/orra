/**
 * The reflow preview.
 *
 * Principle 3: the app never silently moves a date. When a predecessor slips,
 * this offers the whole cascade as a list you can read, argue with, and
 * partially accept — nothing is written until "Apply" is pressed, and each row
 * can be unticked.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useData, useStore } from '../../data/store';
import { Modal, useToast } from '../../ui/bits';
import { entrance, staggerItem, staggerParent } from '../../ui/motion';
import { computeReflow, type ReflowMove } from '../../lib/schedule';
import { fmtDay, todayIso } from '../../lib/dates';
import { myTasks } from '../../lib/workspace';

/** "20 Aug → 26 Aug", or "— → 26 Aug" when there was no date before. */
function DateShift({ from, to }: { from: string | null; to: string | null }) {
  if (!to || to === from) return <span className="mono rf-same">{from ? fmtDay(from) : '—'}</span>;
  return (
    <span className="mono">
      <s className="rf-old">{from ? fmtDay(from) : '—'}</s> → <b>{fmtDay(to)}</b>
    </span>
  );
}

export default function ReflowBanner() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [skip, setSkip] = useState<Set<string>>(new Set());

  const today = todayIso();
  const moves = useMemo(
    () => computeReflow(myTasks(ds.tasks, store.meId), ds.task_links, today),
    [ds.tasks, ds.task_links, store.meId, today],
  );

  if (!moves.length) return null;

  const chosen = moves.filter((m) => !skip.has(m.task_id));

  const apply = () => {
    for (const m of chosen) {
      store.update(
        'tasks',
        m.task_id,
        {
          ...(m.to_start ? { start_date: m.to_start } : {}),
          ...(m.to_due ? { due_date: m.to_due } : {}),
        },
        store.asMe({ summary: `${m.task_id} rescheduled by dependency reflow` }),
      );
    }
    store.note(
      'reflow',
      `Reflow applied — ${chosen.length} task${chosen.length === 1 ? '' : 's'} moved`,
      store.asMe(),
    );
    toast(`${chosen.length} task${chosen.length === 1 ? '' : 's'} moved.`);
    setOpen(false);
    setSkip(new Set());
  };

  return (
    <>
      <motion.div
        className="wk-reflow"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0, transition: entrance }}
      >
        <span className="eyebrow">Schedule needs a reflow</span>
        <span className="wk-reflow-txt">
          {moves.length === 1
            ? '1 task starts before the work it depends on can finish.'
            : `${moves.length} tasks start before the work they depend on can finish.`}
        </span>
        <button type="button" className="btn sm solid" onClick={() => setOpen(true)}>
          Preview reflow
        </button>
      </motion.div>

      <Modal open={open} onClose={() => setOpen(false)} title="Reflow the schedule">
        <p className="tip" style={{ marginTop: 0 }}>
          Nothing moves until you apply this. Untick anything you would rather leave alone.
        </p>
        <motion.ul className="rf-list" {...staggerParent()}>
          {moves.map((m: ReflowMove) => (
            <motion.li key={m.task_id} variants={staggerItem} className="rf-row">
              <label className="rf-pick">
                <input
                  type="checkbox"
                  checked={!skip.has(m.task_id)}
                  onChange={() =>
                    setSkip((s) => {
                      const next = new Set(s);
                      if (next.has(m.task_id)) next.delete(m.task_id);
                      else next.add(m.task_id);
                      return next;
                    })
                  }
                />
                <span className="rf-ttl">
                  <span className="mono">{m.task_id}</span> {m.title}
                </span>
              </label>
              <div className="rf-dates">
                <span className="rf-lbl">Start</span>
                <DateShift from={m.from_start} to={m.to_start} />
                <span className="rf-lbl">Due</span>
                <DateShift from={m.from_due} to={m.to_due} />
              </div>
              <p className="rf-why">{m.reason}</p>
            </motion.li>
          ))}
        </motion.ul>
        <div className="rowgap" style={{ marginTop: 14 }}>
          <button type="button" className="btn solid" onClick={apply} disabled={!chosen.length}>
            Apply reflow{chosen.length !== moves.length ? ` (${chosen.length})` : ''}
          </button>
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Not now
          </button>
        </div>
      </Modal>
    </>
  );
}
