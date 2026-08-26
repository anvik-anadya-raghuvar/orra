/**
 * What's next — the board, in the order the ranking would start it.
 *
 * This was the "Priorities" tab, and it was mostly showing arithmetic about
 * nothing. Its largest factor was objective fit, which needed a task linked to
 * an OKR; migration 0035 deleted the seeded objectives and no screen in this
 * app has ever been able to create one, so the factor scored an identical zero
 * for every task, forever. Around it sat an objectives panel with no
 * objectives, key-result sliders with no key results, and a "Drifting —
 * pointing at nothing" list that necessarily contained the entire board.
 *
 * What is left reads only things the two of them actually set: the P0–P3 on
 * the task, whether finishing it frees other work, and when it is due. Same
 * three weights, live-editable, same visible maths — the numbers now come from
 * somewhere.
 *
 * The reasons are the point. `rankTasks` has always returned a `why` for every
 * task and nothing ever rendered it, which is most of why a column of scores
 * read as noise. A ranking you cannot interrogate is one you will not trust.
 */
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useData, useStore } from '../../data/store';
import { entrance, staggerItem, staggerParent } from '../../ui/motion';
import { todayIso } from '../../lib/dates';
import { rankTasks } from '../../lib/ranking';
import { BarRows } from '../../ui/viz';
import { Field } from './common';
import QuickEdit from './quickedit';
import type { Task } from '../../types';

const WEIGHTS = [
  { key: 'priority' as const, label: 'Priority' },
  { key: 'unblocks' as const, label: 'Unblocks' },
  { key: 'deadline' as const, label: 'Deadline' },
];

export default function NextTab() {
  const ds = useData((d) => d);
  const store = useStore();
  const [quick, setQuick] = useState<Task | null>(null);

  const w = ds.ranking_weights;
  const total = w.priority + w.unblocks + w.deadline || 1;
  const ranked = useMemo(() => rankTasks(ds, todayIso()), [ds]);

  const part = (factor: number, weight: number) => Math.round((factor * weight * 10) / total) / 10;

  const setWeight = (key: 'priority' | 'unblocks' | 'deadline', raw: string) => {
    const n = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    store.setWeights({ [key]: n }, store.asMe());
  };

  return (
    <div>
      {/* weights editor — changing a number re-ranks everything instantly */}
      <div className="wk-okr">
        <div className="eyebrow">Ranking weights · live</div>
        <div className="wk-weights" style={{ marginTop: 10 }}>
          {WEIGHTS.map((f) => (
            <Field key={f.key} label={f.label}>
              <input
                className="wk-in"
                type="number"
                min={0}
                max={100}
                inputMode="numeric"
                value={w[f.key]}
                onChange={(e) => setWeight(f.key, e.target.value)}
              />
            </Field>
          ))}
          <Field label="Total">
            <div className="wk-in mono" style={{ display: 'flex', alignItems: 'center' }}>
              {total}
            </div>
          </Field>
        </div>
        <p className="tip" style={{ marginBottom: 0 }}>
          <b>Priority</b> is the P0–P3 on the task. <b>Unblocks</b> is whether finishing it frees
          other work — a task others are linked behind, or one sitting in review. <b>Deadline</b> is
          how close the due date is. Each is scored 0–100, then weighted by its share of {total}.
          Being stuck, or waiting on an unruled decision, takes 30 off.
        </p>
      </div>

      {ranked.length > 0 && (
        <div className="wk-ovpanel" style={{ marginBottom: 14 }}>
          <span className="eyebrow" style={{ display: 'block', marginBottom: 10 }}>
            Score, top 10
          </span>
          <BarRows rows={ranked.slice(0, 10).map((r) => ({ label: r.task.title, value: r.score }))} />
        </div>
      )}

      {/* ranking table — tablet+ */}
      <div className="wk-wide wk-tblwrap">
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th className="amt">Priority</th>
              <th className="amt">Unblocks</th>
              <th className="amt">Deadline</th>
              <th className="amt">Score</th>
            </tr>
          </thead>
          <tbody>
            {ranked.slice(0, 10).map((r, i) => (
              <tr key={r.task.id} className={i === 0 ? 'wk-toprank' : undefined}>
                <td>
                  <button type="button" className="wk-task-open" onClick={() => setQuick(r.task)}>
                    <b style={{ fontWeight: 500 }}>{r.task.title}</b>
                    <span className="wk-math">{r.task.id}</span>
                  </button>
                  {r.why.length > 0 && (
                    <span className="wk-why">
                      {r.why.map((reason) => (
                        <span className="wk-whychip" key={reason}>
                          {reason}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td className="amt">
                  {part(r.priority, w.priority)}
                  <span className="wk-math">
                    {r.priority} × {w.priority}/{total}
                  </span>
                </td>
                <td className="amt">
                  {part(r.unblocks, w.unblocks)}
                  <span className="wk-math">
                    {r.unblocks} × {w.unblocks}/{total}
                  </span>
                </td>
                <td className="amt">
                  {part(r.deadline, w.deadline)}
                  <span className="wk-math">
                    {r.deadline} × {w.deadline}/{total}
                  </span>
                </td>
                <td className="amt">
                  <b>{r.score}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ranking cards — mobile */}
      <div className="wk-narrow">
        <motion.div {...staggerParent()}>
          {ranked.slice(0, 10).map((r, i) => (
            <motion.div
              key={r.task.id}
              variants={staggerItem}
              className={`wk-rankcard${i === 0 ? ' top' : ''}`}
            >
              <button type="button" className="wk-task-open" onClick={() => setQuick(r.task)}>
                <b style={{ fontWeight: 500, fontSize: 14 }}>{r.task.title}</b>
                <span className="wk-math">
                  {r.task.id} · score {r.score}
                </span>
              </button>
              <div className="wk-rankgrid">
                <div>
                  <b>{part(r.priority, w.priority)}</b>
                  <span className="wk-math">
                    pri {r.priority}×{w.priority}
                  </span>
                </div>
                <div>
                  <b>{part(r.unblocks, w.unblocks)}</b>
                  <span className="wk-math">
                    unb {r.unblocks}×{w.unblocks}
                  </span>
                </div>
                <div>
                  <b>{part(r.deadline, w.deadline)}</b>
                  <span className="wk-math">
                    due {r.deadline}×{w.deadline}
                  </span>
                </div>
                <div>
                  <b>{r.score}</b>
                  <span className="wk-math">/ {total}</span>
                </div>
              </div>
              {r.why.length > 0 && (
                <span className="wk-why">
                  {r.why.map((reason) => (
                    <span className="wk-whychip" key={reason}>
                      {reason}
                    </span>
                  ))}
                </span>
              )}
            </motion.div>
          ))}
        </motion.div>
      </div>

      {ranked.length === 0 && (
        <motion.p
          className="wk-empty"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0, transition: entrance }}
        >
          No open business tasks to rank.
        </motion.p>
      )}

      <QuickEdit task={quick} onClose={() => setQuick(null)} />
    </div>
  );
}
