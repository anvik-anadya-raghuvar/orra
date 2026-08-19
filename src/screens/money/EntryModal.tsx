import { useEffect, useState } from 'react';
import type { LedgerEntry } from '../../types';
import { newId, today, useData, useStore } from '../../data/store';
import { SideSheet, useToast } from '../../ui/bits';
import { inr } from '../../lib/dates';
import { myTasks } from '../../lib/workspace';

/**
 * One form for both adding and correcting an entry.
 *
 * Correcting used to be impossible: a mistyped amount could only be undone by
 * rolling back a whole import, and a hand-typed row not at all.
 */
export default function EntryModal({
  open,
  entry,
  onClose,
}: {
  open: boolean;
  /** Present when correcting an existing row; absent when adding. */
  entry?: LedgerEntry | null;
  onClose: () => void;
}) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();

  const [date, setDate] = useState(today());
  const [party, setParty] = useState('');
  const [category, setCategory] = useState('');
  const [projectId, setProjectId] = useState(ds.projects[0]?.id ?? '');
  const [direction, setDirection] = useState<LedgerEntry['direction']>('out');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<LedgerEntry['status']>('paid');
  const [paidBy, setPaidBy] = useState<string>('');
  const [splitPct, setSplitPct] = useState('');
  const [expenseKind, setExpenseKind] = useState<'' | 'one_time' | 'recurring'>('');
  const [taskId, setTaskId] = useState('');

  /* Load the row being corrected, and reset cleanly when the modal reopens as
     an add — otherwise the last edit's values leak into the next new entry. */
  useEffect(() => {
    if (!open) return;
    setDate(entry?.date ?? today());
    setParty(entry?.party ?? '');
    setCategory(entry?.category ?? '');
    setProjectId(entry?.project_id ?? ds.projects[0]?.id ?? '');
    setDirection(entry?.direction ?? 'out');
    setAmount(entry ? String(entry.amount) : '');
    setStatus(entry?.status ?? 'paid');
    setPaidBy(entry?.paid_by ?? (entry ? '' : store.meId));
    setSplitPct(entry?.split_pct != null ? String(entry.split_pct) : '');
    setExpenseKind(entry?.expense_kind ?? '');
    setTaskId(entry?.linked_task_id ?? '');
  }, [open, entry?.id]);

  const linkable = myTasks(ds.tasks, store.meId).filter((t) => t.status !== 'done');

  const submit = () => {
    const cleanParty = party.trim();
    const n = Math.abs(Number(amount));
    if (!cleanParty) {
      toast('Who paid or was paid — party is required');
      return;
    }
    if (!n || Number.isNaN(n)) {
      toast('Enter an amount greater than zero');
      return;
    }
    const pct = splitPct.trim() === '' ? null : Math.max(0, Math.min(100, Number(splitPct) || 0));
    const fields = {
      date,
      party: cleanParty,
      category: category.trim() || 'Uncategorized',
      project_id: projectId,
      direction,
      amount: n,
      status,
      paid_by: paidBy || null,
      split_pct: pct,
      expense_kind: expenseKind || null,
      linked_task_id: taskId || null,
    };

    if (entry) {
      store.update(
        'ledger',
        entry.id,
        fields,
        store.asMe({ summary: `Ledger entry corrected — ${cleanParty}, ${inr(n)}` }),
      );
      toast('Entry updated');
    } else {
      store.insert(
        'ledger',
        {
          id: newId('lg'),
          ...fields,
          receipt_url: null,
          import_batch_id: null,
        },
        store.asMe({ summary: `Ledger entry added — ${cleanParty}, ${inr(n)}` }),
      );
      toast(`Entry added — ${inr(n)} ${direction}`);
    }
    onClose();
  };

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title={entry ? 'Correct this entry' : 'New ledger entry'}
      subtitle="Shared — both of you see the tracker."
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn solid" type="button" onClick={submit}>
            {entry ? 'Save changes' : 'Add entry'}
          </button>
        </>
      }
    >
      <div className="mn-ctl">
        <label className="mn-fld">
          <span className="mn-lbl">Date</span>
          <input className="mn-in" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="mn-fld">
          <span className="mn-lbl">Party</span>
          <input
            className="mn-in"
            type="text"
            value={party}
            autoFocus
            placeholder="Who paid or was paid"
            onChange={(e) => setParty(e.target.value)}
          />
        </label>
        <label className="mn-fld">
          <span className="mn-lbl">Category</span>
          <input
            className="mn-in"
            type="text"
            value={category}
            placeholder="e.g. Infra, Sample run"
            onChange={(e) => setCategory(e.target.value)}
          />
        </label>
        <label className="mn-fld">
          <span className="mn-lbl">Project</span>
          <select className="mn-in" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {ds.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mn-fld">
          <span className="mn-lbl">Direction</span>
          <select
            className="mn-in"
            value={direction}
            onChange={(e) => setDirection(e.target.value as LedgerEntry['direction'])}
          >
            <option value="in">In</option>
            <option value="out">Out</option>
          </select>
        </label>
        <label className="mn-fld">
          <span className="mn-lbl">Amount (₹)</span>
          <input
            className="mn-in"
            type="number"
            min={0}
            inputMode="decimal"
            value={amount}
            placeholder="0"
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="mn-fld">
          <span className="mn-lbl">Status</span>
          <select
            className="mn-in"
            value={status}
            onChange={(e) => setStatus(e.target.value as LedgerEntry['status'])}
          >
            <option value="paid">Paid</option>
            <option value="due">Due</option>
            <option value="overdue">Overdue</option>
          </select>
        </label>
        <label className="mn-fld">
          <span className="mn-lbl">Paid by</span>
          <select className="mn-in" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            <option value="">—</option>
            {store.members.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mn-fld">
          <span className="mn-lbl">Their share (%)</span>
          <input
            className="mn-in"
            type="number"
            min={0}
            max={100}
            inputMode="numeric"
            value={splitPct}
            placeholder="leave blank if not split"
            onChange={(e) => setSplitPct(e.target.value)}
          />
        </label>
        <label className="mn-fld">
          <span className="mn-lbl">Kind</span>
          <select
            className="mn-in"
            value={expenseKind}
            onChange={(e) => setExpenseKind(e.target.value as '' | 'one_time' | 'recurring')}
          >
            <option value="">Uncategorised</option>
            <option value="one_time">One-off</option>
            <option value="recurring">Recurring</option>
          </select>
        </label>
        <label className="mn-fld">
          <span className="mn-lbl">Link a task</span>
          <select className="mn-in" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">—</option>
            {linkable.map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} · {t.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="tip" style={{ marginTop: 4 }}>
        A share is a note about how an expense was split. Nothing here works out who owes whom.
      </p>
    </SideSheet>
  );
}
