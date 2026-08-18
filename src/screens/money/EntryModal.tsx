import { useState } from 'react';
import type { LedgerEntry } from '../../types';
import { newId, today, useData, useStore } from '../../data/store';
import { Modal, useToast } from '../../ui/bits';
import { inr } from '../../lib/dates';

export default function EntryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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

  const reset = () => {
    setDate(today());
    setParty('');
    setCategory('');
    setDirection('out');
    setAmount('');
    setStatus('paid');
  };

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
    store.insert(
      'ledger',
      {
        id: newId('lg'),
        date,
        party: cleanParty,
        category: category.trim() || 'Uncategorized',
        project_id: projectId,
        direction,
        amount: n,
        status,
        receipt_url: null,
        linked_task_id: null,
        import_batch_id: null,
      },
      store.asMe({ summary: `Ledger entry added — ${cleanParty}, ${inr(n)}` }),
    );
    toast(`Entry added — ${inr(n)} ${direction}`);
    reset();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="New ledger entry">
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
      </div>
      <div className="mn-acts">
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn solid" type="button" onClick={submit}>
          Add entry
        </button>
      </div>
    </Modal>
  );
}
