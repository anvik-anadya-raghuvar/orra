import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useData, useStore } from '../../data/store';
import { useToast } from '../../ui/bits';
import { entrance, spring, staggerItem, staggerList, staggerParent } from '../../ui/motion';
import { todayIso } from '../../lib/dates';
import { rankTasks } from '../../lib/ranking';
import { BarRows, MiniBars, Ring, VIZ } from '../../ui/viz';
import { Field, projColor, projName } from './common';
import QuickEdit from './quickedit';
import type { Task } from '../../types';

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
  const [quick, setQuick] = useState<Task | null>(null);

  // This room ranks business work only. Personal goals have their own model
  // and workspace under Personal; letting relocation/course objectives leak
  // into this list made two unrelated things both look like "Goals".
  const personalProjects = useMemo(
    () => new Set(ds.projects.filter((project) => project.is_personal).map((project) => project.id)),
    [ds.projects],
  );
  const businessObjectives = useMemo(
    () => ds.objectives.filter((objective) => !personalProjects.has(objective.project_id)),
    [ds.objectives, personalProjects],
  );

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

  const drifting = ds.tasks.filter(
    (t) => t.status !== 'done' && !personalProjects.has(t.project_id) && !t.objective_id,
  );

  /** average KR progress per objective — drives the Ring on each card and the MiniBars snapshot. */
  const objAvg = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of businessObjectives) {
      const krs = ds.key_results.filter((k) => k.objective_id === o.id);
      map.set(
        o.id,
        krs.length ? Math.round(krs.reduce((a, k) => a + k.progress_pct, 0) / krs.length) : 0,
      );
    }
    return map;
  }, [businessObjectives, ds.key_results]);

  return (
    <div>
      {/* objective progress snapshot — a glance instead of parsing per-KR percentages */}
      {businessObjectives.length > 0 && (
        <div className="wk-ovpanel" style={{ marginBottom: 14 }}>
          <span className="eyebrow" style={{ display: 'block', marginBottom: 10 }}>
            Objective progress · avg KR
          </span>
          <MiniBars
            items={businessObjectives.map((o) => ({
              label: o.title,
              value: objAvg.get(o.id) ?? 0,
              max: 100,
              color: VIZ.seq,
            }))}
            format={(n) => `${n}%`}
          />
        </div>
      )}

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

      {/* score, visualised — the table below still has the maths, this is the shape of it */}
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
                  <button type="button" className="wk-task-open" onClick={() => setQuick(r.task)}>
                    <b style={{ fontWeight: 500 }}>{r.task.title}</b>
                    <span className="wk-math">
                      {r.task.id} ·{' '}
                      {r.task.objective_id
                        ? ds.objectives.find((o) => o.id === r.task.objective_id)?.title
                        : 'no objective'}
                    </span>
                  </button>
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
        <motion.div {...staggerParent()}>
          {ranked.slice(0, 10).map((r, i) => (
            <motion.div
              key={r.task.id}
              variants={staggerItem}
              className={`wk-rankcard${i === 0 ? ' top' : ''}${
                !r.task.objective_id ? ' drift' : ''
              }`}
            >
              <button type="button" className="wk-task-open" onClick={() => setQuick(r.task)}>
                <b style={{ fontWeight: 500, fontSize: 14 }}>{r.task.title}</b>
                <span className="wk-math">
                  {r.task.id} · score {r.score}
                </span>
              </button>
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
      <motion.div {...staggerParent()}>
        {businessObjectives.map((o) => {
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
                <div className="spacer" />
                <Ring
                  pct={objAvg.get(o.id) ?? 0}
                  size={36}
                  color={VIZ.seq}
                  label={`Average key result progress ${objAvg.get(o.id) ?? 0}%`}
                />
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
              <button type="button" className="wk-task-open" onClick={() => setQuick(t)}>
                {t.title}{' '}
                <span className="mono" style={{ fontSize: 10, color: 'var(--mute)' }}>
                  {t.id}
                </span>
              </button>
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
              {businessObjectives.map((o) => (
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
      {quick && <QuickEdit task={quick} onClose={() => setQuick(null)} />}
    </div>
  );
}
