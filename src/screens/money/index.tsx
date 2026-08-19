import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useData, useStore } from '../../data/store';
import { Avatar, CountUp, InfoTip, useToast } from '../../ui/bits';
import { staggerItem, staggerList, staggerParent } from '../../ui/motion';
import { fmtDay, inr, todayIso } from '../../lib/dates';
import {
  RANGE_LABEL,
  inRange,
  monthlySpend,
  rangeBounds,
  summarise,
  topExpenses,
  type RangeKey,
} from '../../lib/tracker';
import type { LedgerEntry } from '../../types';
import { BarRows, Donut, GroupedBars, MiniBars, Sparkline, SplitBar, VIZ } from '../../ui/viz';
import {
  NEXT_STATUS,
  attentionSummary,
  categoryBreakdown,
  cumulativeNet,
  exportLedgerCsv,
  pillClass,
  projColor,
  projName,
  projectSpend,
  monthlyInOut,
} from './common';
import EntryModal from './EntryModal';
import ImportModal from './ImportModal';
import ImportHistory from './ImportHistory';
import Subscriptions from './subscriptions';
import './money.css';

const toggle = (set: Set<string>, v: string): Set<string> => {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
};

function FeatureTitle({ children, tip }: { children: string; tip: string }) {
  return (
    <span className="eyebrow feature-label">
      {children}
      <InfoTip label={children} text={tip} />
    </span>
  );
}

const statusLabel = (entry: LedgerEntry) => {
  if (entry.direction === 'in') {
    return entry.status === 'paid' ? 'added' : entry.status === 'due' ? 'planned' : 'late';
  }
  return entry.status;
};

export default function Money() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();

  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [projects, setProjects] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<LedgerEntry['status']>>(new Set());
  const [tab, setTab] = useState<'money' | 'subs'>('money');
  const [range, setRange] = useState<RangeKey>('all');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const businessProjects = useMemo(() => ds.projects.filter((project) => !project.is_personal), [ds.projects]);
  const businessProjectIds = useMemo(() => new Set(businessProjects.map((project) => project.id)), [businessProjects]);

  /* One range, applied before anything is counted — the summary, every chart
     and the export then describe the same set of rows by construction. */
  const bounds = useMemo(() => {
    if (range === 'custom') {
      return { from: custom.from || '0000-01-01', to: custom.to || '9999-12-31' };
    }
    return rangeBounds(range, todayIso());
  }, [range, custom.from, custom.to]);

  const inWindow = useMemo(
    () => ds.ledger.filter((r) => businessProjectIds.has(r.project_id) && inRange(r, bounds.from, bounds.to)),
    [ds.ledger, businessProjectIds, bounds.from, bounds.to],
  );

  const totals = useMemo(() => summarise(inWindow), [inWindow]);
  const monthly = useMemo(() => monthlySpend(inWindow), [inWindow]);
  const biggest = useMemo(() => topExpenses(inWindow), [inWindow]);

  const periods = useMemo(() => monthlyInOut(inWindow), [inWindow]);
  const categories = useMemo(() => categoryBreakdown(inWindow), [inWindow]);

  /* ── donut: top 2 categories + Other, headline net in the centre ─────── */
  const spendSlices = useMemo(() => {
    const top = categories.slice(0, 2).map((c) => ({ label: c.category, value: c.total }));
    const rest = categories.slice(2).reduce((a, c) => a + c.total, 0);
    return rest > 0 ? [...top, { label: 'Other', value: rest }] : top;
  }, [categories]);

  /* ── cumulative net sparkline ──────────────────────────────────────── */
  const netSeries = useMemo(() => cumulativeNet(inWindow), [inWindow]);

  /* ── spend per project — four-way split, small multiples not colours ─ */
  const spendByProject = useMemo(
    () =>
      projectSpend(inWindow).map((p) => ({
        label: projName(ds, p.project_id),
        value: p.total,
        color: projColor(ds, p.project_id),
      })),
    [inWindow, ds.projects],
  );

  /* ── needs attention: due + overdue, weighted and one tap from a filter ─ */
  const attn = useMemo(() => attentionSummary(inWindow), [inWindow]);

  const filtered = useMemo(
    () =>
      inWindow.filter(
        (r) =>
          (!projects.size || projects.has(r.project_id)) &&
          (!statuses.size || statuses.has(r.status)),
      ),
    [inWindow, projects, statuses],
  );
  const sorted = useMemo(() => [...filtered].sort((a, b) => (a.date < b.date ? 1 : -1)), [filtered]);

  const toggleStatus = (s: LedgerEntry['status']) =>
    setStatuses((set) => {
      const next = new Set(set);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const cycleStatus = (row: LedgerEntry) => {
    const next = NEXT_STATUS[row.status];
    store.update('ledger', row.id, { status: next }, store.asMe());
    toast(`${row.party} → ${statusLabel({ ...row, status: next })}`);
  };

  const exportCsv = () => exportLedgerCsv(`ledger-${new Date().toISOString().slice(0, 10)}.csv`, ds, sorted);

  return (
    <div className="money-screen frame">
      <div className="top">
        <div className="disp feature-label">
          Money
          <InfoTip
            label="Money"
            text="Tracks founder contributions into the business and business expenses. Contributions are not revenue."
          />
        </div>
        <div className="mn-tabs" role="tablist" aria-label="Money sections">
          <button role="tab" aria-selected={tab === 'money'} onClick={() => setTab('money')}>
            Entries
          </button>
          <button role="tab" aria-selected={tab === 'subs'} onClick={() => setTab('subs')}>
            Subscriptions
          </button>
        </div>
        <div className="spacer" />
        {tab === 'money' && (
          <>
            <button className="btn sm" type="button" onClick={() => setImportOpen(true)}>
              ↑ Import CSV
            </button>
            <button className="btn sm solid" type="button" onClick={() => setAddOpen(true)}>
              + Entry
            </button>
          </>
        )}
      </div>

      {tab === 'subs' ? (
        <div className="wrap">
          <Subscriptions />
        </div>
      ) : (
      <div className="wrap">
        {/* ── the range everything below describes ──────────────────── */}
        <div className="mn-bar">
          {(['month', 'quarter', 'year', 'all'] as RangeKey[]).map((k) => (
            <button
              key={k}
              className="chip"
              type="button"
              aria-pressed={range === k}
              onClick={() => setRange(k)}
            >
              {RANGE_LABEL[k]}
            </button>
          ))}
          <button
            className="chip"
            type="button"
            aria-pressed={range === 'custom'}
            onClick={() => setRange('custom')}
          >
            Custom
          </button>
          {range === 'custom' && (
            <>
              <input
                className="mn-in sm"
                type="date"
                aria-label="From date"
                value={custom.from}
                onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              />
              <input
                className="mn-in sm"
                type="date"
                aria-label="To date"
                value={custom.to}
                onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              />
            </>
          )}
          <span className="spacer" />
          <span className="mono sub">{totals.count} entries</span>
        </div>

        {/* ── summary tiles ─────────────────────────────────────────── */}
        <div className="mn-tiles">
          <div className="mn-tile">
            <div className="n mono">
              <CountUp value={totals.in} format={inr} />
            </div>
            <div className="k feature-label">
              business contributions
              <InfoTip label="Business contributions" text="Money the founders put into the business. This is not sales revenue." />
            </div>
          </div>
          <div className="mn-tile">
            <div className="n mono">
              <CountUp value={totals.out} format={inr} />
            </div>
            <div className="k feature-label">
              expenses
              <InfoTip label="Expenses" text="Money paid or still payable for business costs." />
            </div>
          </div>
          <div className="mn-tile">
            <div className="n mono" style={{ color: totals.net >= 0 ? 'var(--teal)' : 'var(--rose)' }}>
              {totals.net < 0 ? '−' : ''}
              <CountUp value={Math.abs(totals.net)} format={inr} />
            </div>
            <div className="k feature-label">
              contribution balance
              <InfoTip label="Contribution balance" text="Founder contributions minus expenses in the selected range; it is not profit or revenue." />
            </div>
          </div>
        </div>

        {/* ── what needs attention — the screen tells you, you don't scan for it ── */}
        {(attn.due.count > 0 || attn.overdue.count > 0) && (
          <div className="mn-panel mn-attn">
            <div className="mn-panel-head">
              <FeatureTitle tip="Unpaid or overdue expenses only. Click a card to filter the entry table.">Needs attention</FeatureTitle>
              {statuses.size > 0 && (
                <button className="chip" type="button" onClick={() => setStatuses(new Set())}>
                  Clear
                </button>
              )}
            </div>
            <div className="mn-attn-grid">
              <button
                type="button"
                className="mn-attn-card"
                aria-pressed={statuses.has('due')}
                onClick={() => toggleStatus('due')}
              >
                <span className="mn-attn-n mono" style={{ color: 'var(--stamp)' }}>
                  <CountUp value={attn.due.count} />
                </span>
                <span className="mn-attn-k">due · {inr(attn.due.total)}</span>
              </button>
              <button
                type="button"
                className="mn-attn-card"
                aria-pressed={statuses.has('overdue')}
                onClick={() => toggleStatus('overdue')}
              >
                <span className="mn-attn-n mono" style={{ color: 'var(--rose)' }}>
                  <CountUp value={attn.overdue.count} />
                </span>
                <span className="mn-attn-k">overdue · {inr(attn.overdue.total)}</span>
              </button>
            </div>
            <SplitBar
              parts={[
                { label: 'Due', value: attn.due.total, color: 'var(--stamp)' },
                { label: 'Overdue', value: attn.overdue.total, color: 'var(--rose)' },
              ]}
              height={10}
            />
          </div>
        )}

        {/* ── in vs out, over the exact selected range ─────────────── */}
        <div className="mn-panel">
          <div className="mn-panel-head">
            <FeatureTitle tip="Founder contributions compared with business expenses for the same date range used everywhere on this page.">
              Contributions vs expenses
            </FeatureTitle>
          </div>
          {periods.length ? (
            <GroupedBars
              groups={periods.map((period) =>
                new Intl.DateTimeFormat('en-GB', { month: 'short', year: '2-digit' }).format(
                  new Date(`${period.week}T00:00:00`),
                ),
              )}
              seriesA={periods.map((period) => period.in)}
              seriesB={periods.map((period) => period.out)}
              labelA="Contributions"
              labelB="Expenses"
              format={inr}
            />
          ) : (
            <p className="tip" style={{ margin: 0 }}>Nothing in this range.</p>
          )}
        </div>

        {/* ── spend composition + cumulative net ──────────────────────── */}
        <div className="mn-panel mn-composition">
          <div className="mn-comp-col">
            <FeatureTitle tip="How total expenses are divided across categories.">Spend composition</FeatureTitle>
            {spendSlices.length === 0 ? (
              <p className="tip" style={{ margin: 0 }}>
                Nothing spent yet.
              </p>
            ) : (
              <>
                <Donut slices={spendSlices} centerValue={inr(totals.out)} centerLabel="expenses" />
                <div className="viz-legend">
                  {spendSlices.map((s, i) => (
                    <span key={s.label}>
                      <i style={{ background: VIZ.cat[i % VIZ.cat.length] }} />
                      {s.label}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="mn-comp-col">
            <FeatureTitle tip="A running total of founder contributions minus expenses over time.">
              Running contribution balance
            </FeatureTitle>
            {netSeries.length < 2 ? (
              <p className="tip" style={{ margin: 0 }}>
                Not enough activity yet.
              </p>
            ) : (
              <Sparkline
                values={netSeries.map((p) => p.net)}
                labels={netSeries.map((p) => fmtDay(p.date))}
                format={(n) => (n < 0 ? '−' : '') + inr(n)}
              />
            )}
          </div>
        </div>

        {/* ── category breakdown (out only) ─────────────────────────── */}
        <div className="mn-panel">
          <div className="mn-panel-head">
            <FeatureTitle tip="Expenses only, grouped by the category saved on each entry.">Spend by category</FeatureTitle>
          </div>
          {categories.length === 0 ? (
            <p className="tip" style={{ margin: 0 }}>
              Nothing spent yet.
            </p>
          ) : (
            <BarRows rows={categories.map((c) => ({ label: c.category, value: c.total }))} format={inr} />
          )}
        </div>

        {/* ── what we spend each month ──────────────────────────────── */}
        <div className="mn-panel">
          <div className="mn-panel-head">
            <FeatureTitle tip="Business expenses grouped by calendar month in the selected range.">Spend per month</FeatureTitle>
          </div>
          {monthly.length === 0 ? (
            <p className="tip" style={{ margin: 0 }}>
              Nothing spent in this range.
            </p>
          ) : (
            <MiniBars items={monthly} format={inr} />
          )}
        </div>

        {/* ── the biggest single things, which is usually the answer ─── */}
        <div className="mn-panel">
          <div className="mn-panel-head">
            <FeatureTitle tip="The largest individual business expenses in the selected range.">Most expensive</FeatureTitle>
          </div>
          {biggest.length === 0 ? (
            <p className="tip" style={{ margin: 0 }}>
              Nothing spent in this range.
            </p>
          ) : (
            <BarRows
              rows={biggest.map((e) => ({ label: `${e.party} · ${fmtDay(e.date)}`, value: e.amount }))}
              format={inr}
            />
          )}
        </div>

        {/* ── spend per project — small multiples, not four competing colours ── */}
        <div className="mn-panel">
          <div className="mn-panel-head">
            <FeatureTitle tip="Expenses only, grouped by the project selected on each entry.">Spend per project</FeatureTitle>
          </div>
          {spendByProject.length === 0 ? (
            <p className="tip" style={{ margin: 0 }}>
              Nothing spent yet.
            </p>
          ) : (
            <MiniBars items={spendByProject} format={inr} />
          )}
        </div>

        {/* ── transaction table ──────────────────────────────────────── */}
        <div className="mn-section-title">
          <FeatureTitle tip="The source-of-truth list behind every total and chart above. Edit a row to see its exact payer allocation and comments.">
            Money entries
          </FeatureTitle>
        </div>
        <div className="filters">
          {businessProjects.map((p) => (
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
          {(projects.size > 0 || statuses.size > 0) && (
            <button
              className="chip"
              type="button"
              onClick={() => {
                setProjects(new Set());
                setStatuses(new Set());
              }}
            >
              Clear filters
            </button>
          )}
          <span className="spacer" />
          <button className="btn sm" type="button" onClick={exportCsv}>
            ↓ CSV
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <motion.table className="mn-table" {...staggerParent()}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Party</th>
                <th>Category</th>
                <th>Project</th>
                <th>Flow</th>
                <th>Status</th>
                <th>Funded / paid by</th>
                <th>Task</th>
                <th>Comments</th>
                <th className="amt">Amount</th>
                <th aria-label="Row actions" />
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
                  <td data-label="Flow">
                    <span className={`mn-flow ${r.direction}`}>
                      {r.direction === 'in' ? 'Contribution' : 'Expense'}
                    </span>
                  </td>
                  <td data-label="Status">
                    <button
                      className={`pill ${pillClass(r.status)}`}
                      type="button"
                      onClick={() => cycleStatus(r)}
                      title="Click to change status"
                    >
                      {statusLabel(r)}
                    </button>
                  </td>
                  <td data-label="Funded / paid by">
                    {(r.payer_allocations?.length || r.paid_by) ? (
                      <span className="mn-payers">
                        {(r.payer_allocations?.length
                          ? r.payer_allocations
                          : [{ user_id: r.paid_by!, amount: r.amount }]
                        ).map((allocation) => (
                          <span className="mn-payer" key={allocation.user_id}>
                            <Avatar userId={allocation.user_id} size={22} />
                            <span className="mono">{inr(allocation.amount)}</span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="tip" style={{ margin: 0 }}>
                        —
                      </span>
                    )}
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
                  <td data-label="Comments" className="mn-comment-cell" title={r.comments ?? ''}>
                    {r.comments || '—'}
                  </td>
                  <td
                    data-label="Amount"
                    className="amt mono"
                    style={{ color: r.direction === 'in' ? 'var(--teal)' : 'var(--rose)' }}
                  >
                    {r.direction === 'in' ? '+' : '−'}
                    {inr(r.amount)}
                  </td>
                  <td data-label="" className="mn-rowacts">
                    <button type="button" className="btn sm" onClick={() => setEditing(r)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn sm danger"
                      onClick={() => {
                        if (!window.confirm(`Delete this ${inr(r.amount)} entry for ${r.party}? It moves to Trash.`))
                          return;
                        store.remove('ledger', r.id, store.asMe({ summary: `Ledger entry removed — ${r.party}` }));
                        toast('Removed — restorable from Settings → Data');
                      }}
                    >
                      Delete
                    </button>
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
            <FeatureTitle tip="Each CSV import can be rolled back as one batch if it brought in the wrong rows.">Import history</FeatureTitle>
          </div>
          <ImportHistory />
        </div>
      </div>
      )}

      <EntryModal open={addOpen} onClose={() => setAddOpen(false)} />
      <EntryModal open={!!editing} entry={editing} onClose={() => setEditing(null)} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
