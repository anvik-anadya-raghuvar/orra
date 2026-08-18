import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useData, useStore } from '../../data/store';
import { CountUp, useToast } from '../../ui/bits';
import { entrance, staggerItem, staggerList } from '../../ui/motion';
import { fmtDay, inr } from '../../lib/dates';
import type { LedgerEntry } from '../../types';
import {
  NEXT_STATUS,
  categoryBreakdown,
  exportLedgerCsv,
  exportLedgerXlsx,
  pillClass,
  projColor,
  projName,
  weeklyInOut,
} from './common';
import EntryModal from './EntryModal';
import ImportModal from './ImportModal';
import ImportHistory from './ImportHistory';
import './money.css';

const toggle = (set: Set<string>, v: string): Set<string> => {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
};

export default function Money() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [projects, setProjects] = useState<Set<string>>(new Set());

  const totals = useMemo(() => {
    let inTotal = 0;
    let outTotal = 0;
    for (const r of ds.ledger) {
      if (r.direction === 'in') inTotal += r.amount;
      else outTotal += r.amount;
    }
    return { in: inTotal, out: outTotal, net: inTotal - outTotal };
  }, [ds.ledger]);

  const weeks = useMemo(() => weeklyInOut(ds.ledger, 6), [ds.ledger]);
  const weekMax = Math.max(1, ...weeks.flatMap((w) => [w.in, w.out]));

  const categories = useMemo(() => categoryBreakdown(ds.ledger), [ds.ledger]);
  const catMax = Math.max(1, ...categories.map((c) => c.total));

  const filtered = useMemo(
    () => (projects.size ? ds.ledger.filter((r) => projects.has(r.project_id)) : ds.ledger),
    [ds.ledger, projects],
  );
  const sorted = useMemo(() => [...filtered].sort((a, b) => (a.date < b.date ? 1 : -1)), [filtered]);

  const cycleStatus = (row: LedgerEntry) => {
    const next = NEXT_STATUS[row.status];
    store.update('ledger', row.id, { status: next }, store.asMe());
    toast(`${row.party} → ${next}`);
  };

  const exportCsv = () => exportLedgerCsv(`ledger-${new Date().toISOString().slice(0, 10)}.csv`, ds, sorted);
  const exportXlsx = () => exportLedgerXlsx(`ledger-${new Date().toISOString().slice(0, 10)}.xlsx`, ds, sorted);

  return (
    <div className="money-screen frame">
      <div className="top">
        <div className="disp">Money</div>
        <div className="spacer" />
        <button className="btn sm" type="button" onClick={() => setImportOpen(true)}>
          ↑ Import CSV / XLSX
        </button>
        <button className="btn sm solid" type="button" onClick={() => setAddOpen(true)}>
          + Entry
        </button>
      </div>

      <div className="wrap">
        {/* ── summary tiles ─────────────────────────────────────────── */}
        <div className="mn-tiles">
          <div className="mn-tile">
            <div className="n mono">
              <CountUp value={totals.in} format={inr} />
            </div>
            <div className="k">total in</div>
          </div>
          <div className="mn-tile">
            <div className="n mono">
              <CountUp value={totals.out} format={inr} />
            </div>
            <div className="k">total out</div>
          </div>
          <div className="mn-tile">
            <div className="n mono" style={{ color: totals.net >= 0 ? 'var(--teal)' : 'var(--rose)' }}>
              {totals.net < 0 ? '−' : ''}
              <CountUp value={Math.abs(totals.net)} format={inr} />
            </div>
            <div className="k">net</div>
          </div>
        </div>

        {/* ── in vs out, last 6 weeks ───────────────────────────────── */}
        <div className="mn-panel">
          <div className="mn-panel-head">
            <span className="eyebrow">In vs out · last 6 weeks</span>
            <span className="mn-legend">
              <i style={{ background: 'var(--teal)' }} /> in
              <i style={{ background: 'var(--rose)' }} /> out
            </span>
          </div>
          <div className="mn-chart">
            {weeks.map((w) => (
              <div className="mn-chart-col" key={w.week}>
                <div className="mn-chart-bars">
                  <motion.div
                    className="mn-bar in"
                    initial={{ height: 0 }}
                    animate={{ height: `${(w.in / weekMax) * 100}%` }}
                    transition={entrance}
                    title={`In: ${inr(w.in)}`}
                  />
                  <motion.div
                    className="mn-bar out"
                    initial={{ height: 0 }}
                    animate={{ height: `${(w.out / weekMax) * 100}%` }}
                    transition={entrance}
                    title={`Out: ${inr(w.out)}`}
                  />
                </div>
                <span className="mn-chart-label mono">{fmtDay(w.week)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── category breakdown (out only) ─────────────────────────── */}
        <div className="mn-panel">
          <div className="mn-panel-head">
            <span className="eyebrow">Spend by category</span>
          </div>
          {categories.length === 0 ? (
            <p className="tip" style={{ margin: 0 }}>
              Nothing spent yet.
            </p>
          ) : (
            <div className="mn-cat-list">
              {categories.map((c) => (
                <div className="mn-cat-row" key={c.category}>
                  <span className="mn-cat-name">{c.category}</span>
                  <div className="mn-cat-track">
                    <motion.div
                      className="mn-cat-fill"
                      initial={{ width: 0 }}
                      animate={{ width: `${(c.total / catMax) * 100}%` }}
                      transition={entrance}
                    />
                  </div>
                  <span className="mn-cat-amt mono">{inr(c.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── transaction table ──────────────────────────────────────── */}
        <div className="filters">
          {ds.projects.map((p) => (
            <button
              key={p.id}
              className="chip"
              type="button"
              aria-pressed={projects.has(p.id)}
              onClick={() => setProjects((s) => toggle(s, p.id))}
              style={{ borderLeft: `3px solid ${p.color}` }}
            >
              {p.name}
            </button>
          ))}
          {projects.size > 0 && (
            <button className="chip" type="button" onClick={() => setProjects(new Set())}>
              Clear filters
            </button>
          )}
          <span className="spacer" />
          <button className="btn sm" type="button" onClick={exportCsv}>
            ↓ CSV
          </button>
          <button className="btn sm" type="button" onClick={exportXlsx}>
            ↓ XLSX
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <motion.table className="mn-table" variants={staggerList} initial="initial" animate="animate">
            <thead>
              <tr>
                <th>Date</th>
                <th>Party</th>
                <th>Category</th>
                <th>Project</th>
                <th>Status</th>
                <th>Task</th>
                <th className="amt">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <motion.tr key={r.id} variants={staggerItem}>
                  <td data-label="Date" className="mono">
                    {fmtDay(r.date)}
                  </td>
                  <td data-label="Party">{r.party}</td>
                  <td data-label="Category">{r.category}</td>
                  <td data-label="Project">
                    <span className="tagc" style={{ background: 'var(--surf3)', color: projColor(ds, r.project_id) }}>
                      {projName(ds, r.project_id)}
                    </span>
                  </td>
                  <td data-label="Status">
                    <button
                      className={`pill ${pillClass(r.status)}`}
                      type="button"
                      onClick={() => cycleStatus(r)}
                      title="Click to change status"
                    >
                      {r.status}
                    </button>
                  </td>
                  <td data-label="Task">
                    {r.linked_task_id ? (
                      <Link className="lk" to={`/task/${r.linked_task_id}`}>
                        {r.linked_task_id}
                      </Link>
                    ) : (
                      <span className="tip" style={{ margin: 0 }}>
                        —
                      </span>
                    )}
                  </td>
                  <td
                    data-label="Amount"
                    className="amt mono"
                    style={{ color: r.direction === 'in' ? 'var(--teal)' : 'var(--rose)' }}
                  >
                    {r.direction === 'in' ? '+' : '−'}
                    {inr(r.amount)}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </motion.table>
          {sorted.length === 0 && <p className="tip">No entries match this filter.</p>}
        </div>

        {/* ── import history ─────────────────────────────────────────── */}
        <div className="mn-panel" style={{ marginTop: 18 }}>
          <div className="mn-panel-head">
            <span className="eyebrow">Import history</span>
          </div>
          <ImportHistory />
        </div>

        <p className="tip">
          Operational view, not your books. Both of you can see this — what appears on your Home is your
          own choice, set in Personalize.
        </p>
      </div>

      <EntryModal open={addOpen} onClose={() => setAddOpen(false)} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
