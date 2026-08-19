/**
 * Subscriptions.
 *
 * Tracked for one reason: a renewal that surprises you has already cost you
 * money. The list is ordered by what renews next, not alphabetically, because
 * the only urgent question is "what is about to charge us".
 */
import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { newId, useData, useStore } from '../../data/store';
import { Avatar, CountUp, Modal, useToast } from '../../ui/bits';
import { staggerItem, staggerParent } from '../../ui/motion';
import { daysUntil, fmtDay, inr, todayIso } from '../../lib/dates';
import { monthlyRunRate, nextRenewal, upcomingSubscriptions } from '../../lib/tracker';
import type { Subscription } from '../../types';

/** Days-left chip: quiet when far off, warm when close, loud when overdue. */
function Countdown({ ends }: { ends: string | null }) {
  if (!ends) return <span className="mn-pill">no end date</span>;
  const d = daysUntil(ends, todayIso());
  const cls = d < 0 ? 'overdue' : d <= 7 ? 'due' : 'paid';
  return (
    <span className={`mn-pill ${cls}`}>
      {d < 0 ? `${-d}d ago` : d === 0 ? 'today' : `${d}d`}
    </span>
  );
}

function SubRow({ sub }: { sub: Subscription }) {
  const store = useStore();
  const toast = useToast();

  const renew = () => {
    const next = nextRenewal(sub);
    store.update(
      'subscriptions',
      sub.id,
      { ends_on: next },
      store.asMe({ summary: `${sub.name} renewed — next ${next ?? 'unset'}` }),
    );
    toast(`${sub.name} rolled to ${next ? fmtDay(next) : 'no date'}`);
  };

  return (
    <motion.div className="mn-sub" variants={staggerItem}>
      <span className="mn-sub-main">
        <b>{sub.name}</b>
        <span className="sub">
          {sub.billing_cycle === 'one_off' ? 'one-off' : sub.billing_cycle}
          {sub.ends_on && ` · ${fmtDay(sub.ends_on)}`}
        </span>
      </span>
      <Countdown ends={sub.ends_on} />
      <span className="mono mn-sub-amt">{inr(sub.amount)}</span>
      {sub.paid_by && <Avatar userId={sub.paid_by} size={22} />}
      <span className="mn-sub-acts">
        {sub.billing_cycle !== 'one_off' && (
          <button type="button" className="btn sm" onClick={renew}>
            Renewed
          </button>
        )}
        <button
          type="button"
          className="btn sm"
          onClick={() =>
            store.update(
              'subscriptions',
              sub.id,
              { is_active: !sub.is_active },
              store.asMe({ summary: `${sub.name} ${sub.is_active ? 'cancelled' : 'reactivated'}` }),
            )
          }
        >
          {sub.is_active ? 'Cancel' : 'Reactivate'}
        </button>
        <button
          type="button"
          className="btn sm danger"
          onClick={() => {
            if (!window.confirm(`Delete "${sub.name}"? It moves to Trash.`)) return;
            store.remove('subscriptions', sub.id, store.asMe({ summary: `Subscription removed — ${sub.name}` }));
            toast('Removed');
          }}
        >
          Delete
        </button>
      </span>
    </motion.div>
  );
}

export default function Subscriptions() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', amount: '', cycle: 'monthly', ends: '', url: '' });

  const active = useMemo(() => upcomingSubscriptions(ds), [ds.subscriptions]);
  const cancelled = useMemo(() => ds.subscriptions.filter((s) => !s.is_active), [ds.subscriptions]);
  const runRate = useMemo(() => monthlyRunRate(ds), [ds.subscriptions]);

  const add = () => {
    const name = form.name.trim();
    if (!name) return;
    store.insert(
      'subscriptions',
      {
        id: newId('sub'),
        name,
        amount: Math.max(0, Number(form.amount) || 0),
        currency: 'INR',
        billing_cycle: form.cycle as Subscription['billing_cycle'],
        ends_on: form.ends || null,
        url: form.url.trim() || null,
        project_id: null,
        paid_by: store.meId,
        is_active: true,
        notes: '',
        created_at: new Date().toISOString(),
      },
      store.asMe({ summary: `Subscription added — ${name}` }),
    );
    setForm({ name: '', amount: '', cycle: 'monthly', ends: '', url: '' });
    setOpen(false);
    toast('Added');
  };

  return (
    <div>
      <div className="mn-stats">
        <div className="mn-stat">
          <span className="eyebrow">Monthly run rate</span>
          <b className="mono">
            <CountUp value={Math.round(runRate)} format={(n) => inr(n)} />
          </b>
          <span className="sub">yearly plans amortised</span>
        </div>
        <div className="mn-stat">
          <span className="eyebrow">Active</span>
          <b className="mono">
            <CountUp value={active.length} />
          </b>
          <span className="sub">{cancelled.length} cancelled</span>
        </div>
      </div>

      <div className="mn-bar">
        <button type="button" className="btn solid" onClick={() => setOpen(true)}>
          + Subscription
        </button>
        <span className="tip" style={{ margin: 0 }}>
          Ordered by what renews next. Home shows whichever is closest.
        </span>
      </div>

      <motion.div {...staggerParent()}>
        {active.map((s) => (
          <SubRow key={s.id} sub={s} />
        ))}
        {active.length === 0 && <p className="tip">Nothing subscribed yet.</p>}
        {cancelled.length > 0 && (
          <>
            <div className="eyebrow" style={{ marginTop: 16 }}>
              Cancelled
            </div>
            {cancelled.map((s) => (
              <SubRow key={s.id} sub={s} />
            ))}
          </>
        )}
      </motion.div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add a subscription">
        <input className="mn-in" value={form.name} autoFocus placeholder="Name" aria-label="Name" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <div style={{ height: 8 }} />
        <input className="mn-in" value={form.amount} inputMode="decimal" placeholder="Amount" aria-label="Amount" onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
        <div style={{ height: 8 }} />
        <select className="mn-in" value={form.cycle} aria-label="Billing cycle" onChange={(e) => setForm((f) => ({ ...f, cycle: e.target.value }))}>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
          <option value="one_off">One-off</option>
        </select>
        <div style={{ height: 8 }} />
        <label className="mn-lbl" htmlFor="sub-ends">
          Renews or ends on
        </label>
        <input id="sub-ends" className="mn-in" type="date" value={form.ends} onChange={(e) => setForm((f) => ({ ...f, ends: e.target.value }))} />
        <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn" type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button className="btn solid" type="button" onClick={add} disabled={!form.name.trim()}>
            Add
          </button>
        </div>
      </Modal>
    </div>
  );
}
