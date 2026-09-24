/**
 * Overdue triage — a sheet for clearing the overdue pile in one sitting.
 *
 * Two steps, on purpose (principle 3: the app never silently moves a date):
 *
 *   1. Decide. Per row or for a selection: Today, Next Monday, a picked date,
 *      no date, or done. Deciding writes nothing — it only fills a plan.
 *   2. Review. Every planned change as "old date → new date", and one
 *      explicit "Apply N changes" button. Only that button writes, one
 *      store.update per task, each with its own audit summary.
 *
 * The list is the same `tasks` rows the board shows (principle 10) — this is a
 * view of them, never a copy. Pure logic lives in lib/triage.ts.
 *
 * Exported for any entry point: the Work board mounts it today; the bell can
 * open it later with the same two props.
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useData, useStore } from '../data/store';
import { SideSheet, useToast } from './bits';
import { entrance, staggerItem, staggerParent } from './motion';
import { daysUntil, fmtDay, todayIso } from '../lib/dates';
import { spawnNextOccurrence } from '../lib/repeatActions';
import {
  actionLabel,
  applyToSelection,
  buildPreview,
  nextMonday,
  overdueTasks,
  toggleAll,
  toggleSelected,
  undecide,
  type TriageAction,
  type TriagePlan,
} from '../lib/triage';
import './overdueTriage.css';

/** How many of my tasks are overdue — for an entry-point badge. */
export function useOverdueCount(): number {
  const tasks = useData((d) => d.tasks);
  const meId = useStore().meId;
  const today = todayIso();
  return useMemo(() => overdueTasks(tasks, meId, today).length, [tasks, meId, today]);
}

type Step = 'decide' | 'review';

/** actionLabel, with dates in the app's display format. */
function chipLabel(a: TriageAction, today: string): string {
  if (a.kind === 'nextMonday') return `Next Monday, ${fmtDay(nextMonday(today))}`;
  if (a.kind === 'date') return fmtDay(a.date);
  return actionLabel(a, today);
}

function ActionButtons({
  idBase,
  today,
  onPick,
  labelSuffix,
}: {
  idBase: string;
  today: string;
  onPick: (a: TriageAction) => void;
  /** Appended to each button's accessible name, e.g. "for TSK-12". */
  labelSuffix: string;
}) {
  const monday = nextMonday(today);
  return (
    <div className="ot-acts" role="group" aria-label={`Actions ${labelSuffix}`}>
      <button type="button" className="ot-btn" onClick={() => onPick({ kind: 'today' })} aria-label={`Move to today ${labelSuffix}`}>
        Today
      </button>
      <button
        type="button"
        className="ot-btn"
        onClick={() => onPick({ kind: 'nextMonday' })}
        aria-label={`Move to next Monday, ${fmtDay(monday)}, ${labelSuffix}`}
      >
        Next Mon
      </button>
      {/* The real date input covers the chip, so a tap opens the native
          picker directly on every platform. */}
      <label className="ot-btn ot-date">
        <span aria-hidden>Pick a date</span>
        <input
          id={`${idBase}-date`}
          type="date"
          min={today}
          aria-label={`Pick a date ${labelSuffix}`}
          onChange={(e) => e.target.value && onPick({ kind: 'date', date: e.target.value })}
        />
      </label>
      <button type="button" className="ot-btn" onClick={() => onPick({ kind: 'clear' })} aria-label={`Clear due date ${labelSuffix}`}>
        Clear date
      </button>
      <button type="button" className="ot-btn" onClick={() => onPick({ kind: 'done' })} aria-label={`Mark done ${labelSuffix}`}>
        Done
      </button>
    </div>
  );
}

export function OverdueTriage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tasks = useData((d) => d.tasks);
  const store = useStore();
  const toast = useToast();
  const reduced = useReducedMotion();
  const today = todayIso();

  const overdue = useMemo(() => overdueTasks(tasks, store.meId, today), [tasks, store.meId, today]);
  const ids = useMemo(() => overdue.map((t) => t.id), [overdue]);

  const [plan, setPlan] = useState<TriagePlan>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<Step>('decide');

  // A fresh start every time the sheet opens — a half-made plan from last
  // week must never be applied by a confirm today.
  useEffect(() => {
    if (!open) return;
    setPlan({});
    setSelected(new Set());
    setStep('decide');
  }, [open]);

  // Drop selections for rows that stopped being overdue while open.
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.includes(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [ids]);

  const preview = useMemo(() => buildPreview(overdue, plan, today), [overdue, plan, today]);
  const allSelected = ids.length > 0 && ids.every((id) => selected.has(id));
  const n = preview.length;

  const apply = () => {
    for (const change of preview) {
      store.update('tasks', change.taskId, change.patch, store.asMe({ summary: change.summary }));
      if (change.markDone) {
        const t = tasks.find((x) => x.id === change.taskId);
        const next = t ? spawnNextOccurrence(store, t) : null;
        if (next) toast(`Next one created — ${next.id}, due ${fmtDay(next.due_date!)}`);
      }
    }
    toast(`${n} change${n === 1 ? '' : 's'} applied`);
    setPlan({});
    setSelected(new Set());
    setStep('decide');
    if (overdue.length <= n) onClose();
  };

  const footer =
    step === 'decide' ? (
      <>
        <button className="btn" type="button" onClick={onClose}>
          Close
        </button>
        <button className="btn solid" type="button" disabled={n === 0} onClick={() => setStep('review')}>
          {n ? `Review ${n} change${n === 1 ? '' : 's'}` : 'Nothing decided yet'}
        </button>
      </>
    ) : (
      <>
        <button className="btn" type="button" onClick={() => setStep('decide')}>
          Back
        </button>
        <button className="btn solid" type="button" disabled={n === 0} onClick={apply}>
          Apply {n} change{n === 1 ? '' : 's'}
        </button>
      </>
    );

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title={step === 'decide' ? 'Overdue triage' : 'Review changes'}
      subtitle={
        step === 'decide'
          ? 'Decide what each overdue task becomes. Nothing changes until you review and apply.'
          : 'These are the only changes that will be written. Nothing else moves.'
      }
      wide
      footer={footer}
    >
      {overdue.length === 0 ? (
        <p className="tip" style={{ marginTop: 0 }}>
          Nothing of yours is overdue. Clear pile.
        </p>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          {step === 'decide' ? (
            <motion.div
              key="decide"
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: reduced ? { duration: 0 } : entrance }}
              exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -6, transition: { duration: 0.15 } }}
            >
              <div className="ot-bulk">
                <label className="ot-check">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected((s) => toggleAll(s, ids))}
                  />
                  <span>
                    {allSelected ? 'All selected' : `Select all ${ids.length}`}
                    {selected.size > 0 && !allSelected ? ` · ${selected.size} selected` : ''}
                  </span>
                </label>
                {selected.size > 0 && (
                  <ActionButtons
                    idBase="ot-bulk"
                    today={today}
                    labelSuffix={`for ${selected.size} selected`}
                    onPick={(a) => setPlan((p) => applyToSelection(p, selected, a))}
                  />
                )}
              </div>

              <motion.ul className="ot-list" {...staggerParent()}>
                {overdue.map((t) => {
                  const decided = plan[t.id];
                  const late = -daysUntil(t.due_date!, today);
                  return (
                    <motion.li key={t.id} variants={staggerItem} className={`ot-row${decided ? ' decided' : ''}`}>
                      <div className="ot-head">
                        <label className="ot-check">
                          <input
                            type="checkbox"
                            checked={selected.has(t.id)}
                            onChange={() => setSelected((s) => toggleSelected(s, t.id))}
                            aria-label={`Select ${t.id}: ${t.title}`}
                          />
                          <span className="ot-title">
                            <span className="mono ot-id">{t.id}</span> {t.title}
                          </span>
                        </label>
                        <span className="ot-late mono">
                          due {fmtDay(t.due_date!)} · {late}d overdue
                        </span>
                      </div>
                      {decided ? (
                        <div className="ot-decision" aria-live="polite">
                          <span className="ot-chip">→ {chipLabel(decided, today)}</span>
                          <button
                            type="button"
                            className="ot-btn"
                            onClick={() => setPlan((p) => undecide(p, t.id))}
                            aria-label={`Undo decision for ${t.id}`}
                          >
                            Undo
                          </button>
                        </div>
                      ) : (
                        <ActionButtons
                          idBase={`ot-${t.id}`}
                          today={today}
                          labelSuffix={`for ${t.id}`}
                          onPick={(a) => setPlan((p) => ({ ...p, [t.id]: a }))}
                        />
                      )}
                    </motion.li>
                  );
                })}
              </motion.ul>
            </motion.div>
          ) : (
            <motion.div
              key="review"
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: reduced ? { duration: 0 } : entrance }}
              exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -6, transition: { duration: 0.15 } }}
            >
              <motion.ul className="ot-list" aria-label="Changes to apply" {...staggerParent()}>
                {preview.map((c) => (
                  <motion.li key={c.taskId} variants={staggerItem} className="ot-row">
                    <span className="ot-title">
                      <span className="mono ot-id">{c.taskId}</span> {c.title}
                    </span>
                    <span className="ot-diff mono">
                      {c.markDone ? (
                        <>mark done · due date stays {c.fromDue ? fmtDay(c.fromDue) : 'none'}</>
                      ) : (
                        <>
                          <s>{c.fromDue ? fmtDay(c.fromDue) : 'no date'}</s>
                          {' → '}
                          <b>{c.toDue ? fmtDay(c.toDue) : 'no due date'}</b>
                        </>
                      )}
                    </span>
                  </motion.li>
                ))}
              </motion.ul>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </SideSheet>
  );
}

export default OverdueTriage;

/** The board's entry point: visible only when something is overdue. */
export function OverdueTriageButton({ className = '' }: { className?: string }) {
  const count = useOverdueCount();
  const [open, setOpen] = useState(false);
  if (count === 0 && !open) return null;
  return (
    <>
      {count > 0 && (
        <button
          type="button"
          className={`ot-entry ${className}`.trim()}
          aria-label={`${count} overdue task${count === 1 ? '' : 's'} — triage`}
          onClick={() => setOpen(true)}
        >
          <span className="ot-entry-n mono">{count}</span> overdue — triage
        </button>
      )}
      <OverdueTriage open={open} onClose={() => setOpen(false)} />
    </>
  );
}
