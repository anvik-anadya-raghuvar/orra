import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useData, useStore } from '../../data/store';
import { useToast } from '../../ui/bits';
import { entrance, spring, staggerItem, staggerList } from '../../ui/motion';
import { todayIso } from '../../lib/dates';
import { rankTasks } from '../../lib/ranking';
import { Field, projColor, projName } from './common';

const WEIGHTS = [
  { key: 'objective_fit' as const, label: 'Objective fit' },
  { key: 'unblocks' as const, label: 'Unblocks' },
  { key: 'deadline' as const, label: 'Deadline' },
];

export default function GoalsTab() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, number>>({});

  const w = ds.ranking_weights;
  const total = w.objective_fit + w.unblocks + w.deadline || 1;
  const ranked = useMemo(() => rankTasks(ds, todayIso()), [ds]);

  const part = (factor: number, weight: number) => Math.round((factor * weight * 10) / total) / 10;

  const setWeight = (key: 'objective_fit' | 'unblocks' | 'deadline', raw: string) => {
    const n = Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
    store.setWeights({ [key]: n }, store.asMe());
  };

  const krValue = (id: string, stored: number) => draft[id] ?? stored;
  const commitKr = (id: string, stored: number) => {
    const v = draft[id];
    if (v === undefined || v === stored) return;
    store.update('key_results', id, { progress_pct: v }, store.asMe());
    setDraft((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
    toast(`Key result → ${v}%`);
  };

  const personal = new Set(ds.projects.filter((p) => p.is_personal).map((p) => p.id));
  const drifting = ds.tasks.filter(
    (t) => t.status !== 'done' && !personal.has(t.project_id) && !t.objective_id,
  );

  return (
    <div>
      <p style={{ fontSize: 14, color: 'var(--slate)', maxWidth: '66ch', margin: '0 0 14px' }}>
        Objectives are what make the ranking honest. Every business task points at one; the pointer
        is what lets the portal tell you where to start. Today's order, with the maths visible.
      </p>

      {/* weights editor — changing a number re-ranks the table instantly */}
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
          Each factor is scored 0–100, then weighted by its share of {total}. No redeploy — the order
          below changes as you type.
        </p>
      </div>

      {/* ranking table — tablet+ */}
      <div className="wk-wide wk-tblwrap">
        <table>
          <thead>
            <tr>
              <th>Task</th>
              <th className="amt">Objective fit</th>
              <th className="amt">Unblocks</th>
              <th className="amt">Deadline</th>
              <th className="amt">Score</th>
            </tr>
          </thead>
          <tbody>
            {ranked.slice(0, 10).map((r, i) => (
              <tr
                key={r.task.id}
                className={
                  i === 0 ? 'wk-toprank' : !r.task.objective_id ? 'wk-driftrow' : undefined
                }
              >
                <td>
                  <Link to={`/task/${r.task.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <b style={{ fontWeight: 500 }}>{r.task.title}</b>
                    <span className="wk-math">
                      {r.task.id} ·{' '}
                      {r.task.objective_id
                        ? ds.objectives.find((o) => o.id === r.task.objective_id)?.title
                        : 'no objective'}
                    </span>
                  </Link>
                </td>
                <td className="amt">
                  {part(r.objectiveFit, w.objective_fit)}
                  <span className="wk-math">
                    {r.objectiveFit} × {w.objective_fit}/{total}
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
        <motion.div variants={staggerList} initial="initial" animate="animate">
          {ranked.slice(0, 10).map((r, i) => (
            <motion.div
              key={r.task.id}
              variants={staggerItem}
              className={`wk-rankcard${i === 0 ? ' top' : ''}${
                !r.task.objective_id ? ' drift' : ''
              }`}
            >
              <Link to={`/task/${r.task.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                <b style={{ fontWeight: 500, fontSize: 14 }}>{r.task.title}</b>
                <span className="wk-math">
                  {r.task.id} · score {r.score}
                </span>
              </Link>
              <div className="wk-rankgrid">
                <div>
                  <b>{part(r.objectiveFit, w.objective_fit)}</b>
                  <span className="wk-math">
                    fit {r.objectiveFit}×{w.objective_fit}
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
            </motion.div>
          ))}
        </motion.div>
      </div>

      {ranked.length === 0 && <p className="wk-empty">No open business tasks to rank.</p>}

      <div style={{ height: 18 }} />

      {/* objectives + key results */}
      <motion.div variants={staggerList} initial="initial" animate="animate">
        {ds.objectives.map((o) => {
          const krs = ds.key_results
            .filter((k) => k.objective_id === o.id)
            .sort((a, b) => a.position - b.position);
          const pointed = ds.tasks.filter((t) => t.objective_id === o.id).length;
          return (
            <motion.div key={o.id} className="wk-okr" variants={staggerItem}>
              <div className="eyebrow" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span
                  className="tagc"
                  style={{ background: 'var(--surf3)', color: projColor(ds, o.project_id) }}
                >
                  {projName(ds, o.project_id)}
                </span>
                <span className="pill q">{o.quarter}</span>
              </div>
              <h4 style={{ fontSize: 17, marginTop: 7 }}>{o.title}</h4>
              {krs.map((kr) => {
                const v = krValue(kr.id, kr.progress_pct);
                return (
                  <div className="wk-kr" key={kr.id}>
                    <span className="wk-krt">{kr.title}</span>
                    <span className="wk-krbar">
                      <motion.span
                        style={{
                          display: 'block',
                          height: '100%',
                          background: 'linear-gradient(90deg,var(--teal),var(--sky))',
                        }}
                        animate={{ width: `${v}%` }}
                        transition={spring}
                      />
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={v}
                      aria-label={`${kr.title} progress`}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [kr.id]: Number(e.target.value) }))
                      }
                      onPointerUp={() => commitKr(kr.id, kr.progress_pct)}
                      onKeyUp={() => commitKr(kr.id, kr.progress_pct)}
                      onBlur={() => commitKr(kr.id, kr.progress_pct)}
                    />
                    <span className="wk-krv">{v}%</span>
                  </div>
                );
              })}
              <p className="tip" style={{ marginBottom: 0 }}>
                {pointed} task{pointed === 1 ? '' : 's'} pointed here
              </p>
            </motion.div>
          );
        })}
      </motion.div>

      {/* drifting */}
      <motion.div
        className="wk-okr"
        style={{ borderStyle: 'dashed' }}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0, transition: entrance }}
      >
        <div className="eyebrow" style={{ color: 'var(--rose)' }}>
          Drifting — pointing at nothing
        </div>
        {drifting.map((t) => (
          <div className="wk-kr" key={t.id}>
            <span className="wk-krt" style={{ flex: 1 }}>
              <Link to={`/task/${t.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                {t.title}{' '}
                <span className="mono" style={{ fontSize: 10, color: 'var(--mute)' }}>
                  {t.id}
                </span>
              </Link>
            </span>
            <select
              className="wk-in"
              style={{ width: 'auto', minWidth: 190, flex: '0 1 auto' }}
              value=""
              aria-label={`Link ${t.id} to an objective`}
              onChange={(e) => {
                if (!e.target.value) return;
                store.update('tasks', t.id, { objective_id: e.target.value }, store.asMe());
                toast(`${t.id} linked to an objective`);
              }}
            >
              <option value="">Point it at…</option>
              {ds.objectives.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.title}
                </option>
              ))}
            </select>
          </div>
        ))}
        {drifting.length === 0 && (
          <p className="tip" style={{ margin: '10px 0 0' }}>
            Nothing adrift.
          </p>
        )}
        <p className="tip" style={{ marginBottom: 0 }}>
          A task with no objective scores zero on fit and never reaches the top. Either it earns a
          pointer or it probably shouldn't exist.
        </p>
      </motion.div>
    </div>
  );
}
