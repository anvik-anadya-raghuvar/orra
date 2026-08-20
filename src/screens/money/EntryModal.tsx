import { useEffect, useMemo, useState } from 'react';
import type { LedgerEntry, LedgerPayerAllocation, Subscription } from '../../types';
import { newId, today, useData, useStore } from '../../data/store';
import { InfoTip, SideSheet, useToast } from '../../ui/bits';
import { Attachments } from '../../ui/attachments';
import { inr } from '../../lib/dates';
import { myTasks } from '../../lib/workspace';
import { DictateField } from '../../ui/dictation';
import { ProjectCombo } from '../../ui/pickers';

const toCents = (value: number) => Math.round(value * 100);

function FieldLabel({ children, tip }: { children: string; tip: string }) {
  return (
    <span className="mn-lbl feature-label">
      {children}
      <InfoTip label={children} text={tip} />
    </span>
  );
}

/** One form for founder contributions and business expenses. */
export default function EntryModal({
  open,
  entry,
  onClose,
}: {
  open: boolean;
  entry?: LedgerEntry | null;
  onClose: () => void;
}) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const businessProjects = useMemo(() => ds.projects.filter((project) => !project.is_personal), [ds.projects]);

  const [date, setDate] = useState(today());
  const [party, setParty] = useState('');
  const [category, setCategory] = useState('');
  const [projectId, setProjectId] = useState(businessProjects[0]?.id ?? '');
  const [direction, setDirection] = useState<LedgerEntry['direction']>('out');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<LedgerEntry['status']>('paid');
  const [paidBy, setPaidBy] = useState('');
  const [splitPayment, setSplitPayment] = useState(false);
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>({});
  const [endsOn, setEndsOn] = useState('');
  const [trackSubscription, setTrackSubscription] = useState(false);
  const [subscriptionCycle, setSubscriptionCycle] = useState<Subscription['billing_cycle']>('monthly');
  const [comments, setComments] = useState('');
  const [taskId, setTaskId] = useState('');

  const linkedSubscription = entry?.subscription_id
    ? ds.subscriptions.find((subscription) => subscription.id === entry.subscription_id)
    : undefined;

  /* Upgrade old percentage rows into exact editable amounts when opened. */
  useEffect(() => {
    if (!open) return;
    const entryAmount = entry?.amount ?? 0;
    let allocations = (entry?.payer_allocations ?? []).filter((allocation) => allocation.amount > 0);
    if (!allocations.length && entry?.paid_by) {
      const other = store.members.find((member) => member.id !== entry.paid_by);
      if (
        entry.direction === 'out' &&
        entry.split_pct != null &&
        entry.split_pct > 0 &&
        entry.split_pct < 100 &&
        other
      ) {
        const primaryAmount = Math.round(entryAmount * entry.split_pct) / 100;
        allocations = [
          { user_id: entry.paid_by, amount: primaryAmount },
          { user_id: other.id, amount: entryAmount - primaryAmount },
        ];
      } else {
        allocations = [{ user_id: entry.paid_by, amount: entryAmount }];
      }
    }

    setDate(entry?.date ?? today());
    setParty(entry?.party ?? '');
    setCategory(entry?.category ?? '');
    setProjectId(entry?.project_id ?? businessProjects[0]?.id ?? '');
    setDirection(entry?.direction ?? 'out');
    setAmount(entry ? String(entry.amount) : '');
    setStatus(entry?.status ?? 'paid');
    setPaidBy(allocations.length === 1 ? allocations[0].user_id : entry?.paid_by ?? store.meId);
    setSplitPayment(allocations.length > 1);
    setPayerAmounts(
      Object.fromEntries(allocations.map((allocation) => [allocation.user_id, String(allocation.amount)])),
    );
    setEndsOn(entry?.ends_on ?? linkedSubscription?.ends_on ?? '');
    setTrackSubscription(Boolean(entry?.subscription_id));
    setSubscriptionCycle(linkedSubscription?.billing_cycle ?? 'monthly');
    setComments(entry?.comments ?? '');
    setTaskId(entry?.linked_task_id ?? '');
  }, [open, entry?.id]);

  const linkable = myTasks(ds.tasks, store.meId).filter((task) => task.status !== 'done');
  const allocatedTotal = useMemo(
    () =>
      store.members.reduce(
        (total, member) => total + Math.max(0, Number(payerAmounts[member.id]) || 0),
        0,
      ),
    [payerAmounts, store.members],
  );

  const submit = () => {
    const cleanParty = party.trim();
    const n = Math.abs(Number(amount));
    if (!cleanParty) {
      toast(direction === 'in' ? 'Name the source of this contribution' : 'Name who the expense was paid to');
      return;
    }
    if (!n || Number.isNaN(n)) {
      toast('Enter an amount greater than zero');
      return;
    }
    /* A ledger row must belong to a project. Before the project field could
       create one, this was guaranteed by there always being a seeded project
       to default to; now a fresh workspace can genuinely have none. */
    if (!projectId) {
      toast('Choose or type a project for this entry');
      return;
    }

    let allocations: LedgerPayerAllocation[];
    if (direction === 'out' && splitPayment) {
      allocations = store.members
        .map((member) => ({ user_id: member.id, amount: Math.max(0, Number(payerAmounts[member.id]) || 0) }))
        .filter((allocation) => allocation.amount > 0);
      if (allocations.length < 2) {
        toast('Enter an amount for each person who paid');
        return;
      }
      if (toCents(allocations.reduce((sum, allocation) => sum + allocation.amount, 0)) !== toCents(n)) {
        toast(`The payer amounts must total ${inr(n)} — they currently total ${inr(allocatedTotal)}`);
        return;
      }
    } else {
      if (!paidBy) {
        toast(direction === 'in' ? 'Choose who contributed the money' : 'Choose who paid');
        return;
      }
      allocations = [{ user_id: paidBy, amount: n }];
    }

    if ((trackSubscription || entry?.subscription_id) && !endsOn) {
      toast('A subscription needs a renewal or end date');
      return;
    }

    const singlePayer = allocations.length === 1 ? allocations[0].user_id : null;
    let subscriptionId = entry?.subscription_id ?? null;
    if (direction === 'out' && trackSubscription && endsOn) {
      if (subscriptionId) {
        store.update(
          'subscriptions',
          subscriptionId,
          {
            name: cleanParty,
            amount: n,
            billing_cycle: subscriptionCycle,
            ends_on: endsOn,
            project_id: projectId || null,
            paid_by: singlePayer,
            notes: comments.trim(),
            is_active: true,
          },
          store.asMe({ summary: `Subscription updated from expense — ${cleanParty}` }),
        );
      } else {
        subscriptionId = newId('sub');
        store.insert(
          'subscriptions',
          {
            id: subscriptionId,
            name: cleanParty,
            amount: n,
            currency: 'INR',
            billing_cycle: subscriptionCycle,
            ends_on: endsOn,
            url: null,
            project_id: projectId || null,
            paid_by: singlePayer,
            is_active: true,
            notes: comments.trim(),
            created_at: new Date().toISOString(),
          },
          store.asMe({ summary: `Subscription created from expense — ${cleanParty}` }),
        );
      }
    }

    const fields = {
      date,
      party: cleanParty,
      category: category.trim() || 'Uncategorized',
      project_id: projectId,
      direction,
      amount: n,
      status,
      paid_by: singlePayer,
      payer_allocations: allocations,
      split_pct: null,
      expense_kind: null,
      comments: comments.trim(),
      ends_on: direction === 'out' ? endsOn || null : null,
      subscription_id: direction === 'out' ? subscriptionId : null,
      linked_task_id: taskId || null,
    };

    if (entry) {
      store.update(
        'ledger',
        entry.id,
        fields,
        store.asMe({ summary: `Money entry corrected — ${cleanParty}, ${inr(n)}` }),
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
        store.asMe({ summary: `Money entry added — ${cleanParty}, ${inr(n)}` }),
      );
      toast(direction === 'in' ? `Contribution added — ${inr(n)}` : `Expense added — ${inr(n)}`);
    }
    onClose();
  };

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title={entry ? 'Correct money entry' : 'New money entry'}
      wide
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
          <FieldLabel tip="The date the contribution entered the business or the expense occurred.">Date</FieldLabel>
          <input className="mn-in" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="mn-fld">
          <FieldLabel tip="Inflow means founder money put into the business; it is never treated as revenue.">Flow</FieldLabel>
          <select
            className="mn-in"
            value={direction}
            onChange={(event) => {
              const next = event.target.value as LedgerEntry['direction'];
              setDirection(next);
              if (next === 'in') {
                setSplitPayment(false);
                setEndsOn('');
                setTrackSubscription(false);
              }
            }}
          >
            <option value="in" disabled={Boolean(entry?.subscription_id)}>Business contribution</option>
            <option value="out">Business expense</option>
          </select>
        </label>
        <label className="mn-fld">
          <FieldLabel tip={direction === 'in' ? 'Where the contributed money came from.' : 'The vendor or person the expense was paid to.'}>
            {direction === 'in' ? 'Contribution source' : 'Paid to'}
          </FieldLabel>
          <DictateField label={direction === 'in' ? 'Dictate the source' : 'Dictate who this was paid to'}>
            <input
              className="mn-in"
              type="text"
              value={party}
              autoFocus
              placeholder={direction === 'in' ? 'e.g. Founder contribution' : 'e.g. AWS, fabric supplier'}
              onChange={(event) => setParty(event.target.value)}
            />
          </DictateField>
        </label>
        <label className="mn-fld">
          <FieldLabel tip="A reporting label used by the spend breakdowns.">Category</FieldLabel>
          <DictateField label="Dictate the category">
            <input
              className="mn-in"
              type="text"
              value={category}
              placeholder="e.g. Infrastructure, sample run"
              onChange={(event) => setCategory(event.target.value)}
            />
          </DictateField>
        </label>
        <label className="mn-fld">
          <FieldLabel tip="The business project this money movement belongs to.">Project</FieldLabel>
          <ProjectCombo
            className="mn-in"
            businessOnly
            value={projectId}
            onChange={setProjectId}
          />
        </label>
        <label className="mn-fld">
          <FieldLabel tip="The full amount. Split payer amounts must add up to this exactly.">Amount (₹)</FieldLabel>
          <input
            className="mn-in"
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            value={amount}
            placeholder="0"
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label className="mn-fld">
          <FieldLabel tip={direction === 'in' ? 'Added means the contribution is in the business; planned and late are still expected.' : 'Paid has left the business; due and overdue still need payment.'}>
            Status
          </FieldLabel>
          <select
            className="mn-in"
            value={status}
            onChange={(event) => setStatus(event.target.value as LedgerEntry['status'])}
          >
            <option value="paid">{direction === 'in' ? 'Added' : 'Paid'}</option>
            <option value="due">{direction === 'in' ? 'Planned' : 'Due'}</option>
            <option value="overdue">{direction === 'in' ? 'Late' : 'Overdue'}</option>
          </select>
        </label>
        {!(direction === 'out' && splitPayment) && (
          <label className="mn-fld">
            <FieldLabel tip={direction === 'in' ? 'The founder who put this money into the business.' : 'The person whose account or card paid the expense.'}>
              {direction === 'in' ? 'Contributed by' : 'Paid by'}
            </FieldLabel>
            <select className="mn-in" value={paidBy} onChange={(event) => setPaidBy(event.target.value)}>
              <option value="">Choose a person</option>
              {store.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {direction === 'out' && (
          <div className="mn-fld mn-span-2">
            <div className="mn-checkrow">
              <label>
                <input
                  type="checkbox"
                  checked={splitPayment}
                  onChange={(event) => setSplitPayment(event.target.checked)}
                />
                Expense was paid by more than one person
              </label>
              <InfoTip
                label="Split payment"
                text="Enter the exact amount each person paid. The entry cannot save unless those amounts equal the full expense."
              />
            </div>
            {splitPayment && (
              <div className="mn-allocation-grid">
                {store.members.map((member) => (
                  <label className="mn-fld" key={member.id}>
                    <span className="mn-lbl">{member.name} paid (₹)</span>
                    <input
                      className="mn-in"
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      value={payerAmounts[member.id] ?? ''}
                      placeholder="0"
                      onChange={(event) =>
                        setPayerAmounts((current) => ({ ...current, [member.id]: event.target.value }))
                      }
                    />
                  </label>
                ))}
                <div className="mn-allocation-total">
                  Allocated {inr(allocatedTotal)} of {inr(Math.abs(Number(amount)) || 0)}
                </div>
              </div>
            )}
          </div>
        )}

        {direction === 'out' && (
          <label className="mn-fld">
            <FieldLabel tip="Add this only when access, coverage, or the next renewal has a known date. It unlocks subscription tracking.">
              Renewal or end date
            </FieldLabel>
            <input
              className="mn-in"
              type="date"
              value={endsOn}
              onChange={(event) => {
                setEndsOn(event.target.value);
                if (!event.target.value && !entry?.subscription_id) setTrackSubscription(false);
              }}
            />
          </label>
        )}

        {direction === 'out' && endsOn && (
          <div className="mn-fld">
            <div className="mn-checkrow">
              <label>
                <input
                  type="checkbox"
                  checked={trackSubscription || Boolean(entry?.subscription_id)}
                  disabled={Boolean(entry?.subscription_id)}
                  onChange={(event) => setTrackSubscription(event.target.checked)}
                />
                Track in Subscriptions
              </label>
              <InfoTip
                label="Track in subscriptions"
                text="Creates one dated renewal record from this expense. It does not create another expense."
              />
            </div>
            {(trackSubscription || entry?.subscription_id) && (
              <select
                className="mn-in"
                aria-label="Billing cycle"
                value={subscriptionCycle}
                onChange={(event) => setSubscriptionCycle(event.target.value as Subscription['billing_cycle'])}
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="one_off">Ends once</option>
              </select>
            )}
          </div>
        )}

        <label className="mn-fld">
          <FieldLabel tip="Optional link back to the Work task that caused or approved this movement.">Linked task</FieldLabel>
          <select className="mn-in" value={taskId} onChange={(event) => setTaskId(event.target.value)}>
            <option value="">None</option>
            {linkable.map((task) => (
              <option key={task.id} value={task.id}>
                {task.id} · {task.title}
              </option>
            ))}
          </select>
        </label>
        <label className="mn-fld mn-span-2">
          <FieldLabel tip="Add any decision, payment detail, invoice context, or reason you will need later.">Comments</FieldLabel>
          <DictateField label="Dictate the context">
            <textarea
              className="mn-in mn-comments"
              maxLength={2000}
              value={comments}
              placeholder="Optional context"
              onChange={(event) => setComments(event.target.value)}
            />
          </DictateField>
        </label>
      </div>
      {/* The receipt itself. Only once the entry exists — a file has to hang
          off a row, and inventing the row here would put an unsaved ledger
          line in the books. */}
      {entry ? (
        <div style={{ marginTop: 14 }}>
          <Attachments
            entityType="ledger_entry"
            entityId={entry.id}
            label="Receipt"
            hint="The invoice, the bank confirmation, the receipt PDF."
          />
        </div>
      ) : (
        <p className="tip" style={{ marginTop: 14 }}>
          Save this entry, then reopen it to attach the invoice or receipt.
        </p>
      )}
    </SideSheet>
  );
}
