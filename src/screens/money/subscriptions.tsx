import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useData, useStore } from '../../data/store';
import { Avatar, CountUp, InfoTip, useToast } from '../../ui/bits';
import { staggerItem, staggerParent } from '../../ui/motion';
import { daysUntil, fmtDay, inr, todayIso } from '../../lib/dates';
import { monthlyRunRate, nextRenewal, upcomingSubscriptions } from '../../lib/tracker';
import type { Subscription } from '../../types';

function FeatureTitle({ children, tip }: { children: string; tip: string }) {
  return (
    <span className="eyebrow feature-label">
      {children}
      <InfoTip label={children} text={tip} />
    </span>
  );
}

function Countdown({ ends }: { ends: string | null }) {
  if (!ends) return <span className="mn-pill overdue">date missing</span>;
  const days = daysUntil(ends, todayIso());
  const cls = days < 0 ? 'overdue' : days <= 7 ? 'due' : 'paid';
  return (
    <span className={`mn-pill ${cls}`}>
      {days < 0 ? `${-days}d ago` : days === 0 ? 'today' : `${days}d`}
    </span>
  );
}

function SubRow({ sub }: { sub: Subscription }) {
  const ds = useData((data) => data);
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
    for (const entry of ds.ledger.filter((row) => row.subscription_id === sub.id)) {
      store.update('ledger', entry.id, { ends_on: next }, store.asMe());
    }
    toast(`${sub.name} rolled to ${next ? fmtDay(next) : 'no date'}`);
  };

  const remove = () => {
    if (!window.confirm(`Delete "${sub.name}"? It moves to Trash.`)) return;
    for (const entry of ds.ledger.filter((row) => row.subscription_id === sub.id)) {
      store.update('ledger', entry.id, { subscription_id: null }, store.asMe());
    }
    store.remove('subscriptions', sub.id, store.asMe({ summary: `Subscription removed — ${sub.name}` }));
    toast('Removed');
  };

  return (
    <motion.div className="mn-sub" variants={staggerItem}>
      <span className="mn-sub-main">
        <b>{sub.name}</b>
        <span className="sub">
          {sub.billing_cycle === 'one_off' ? 'ends once' : sub.billing_cycle}
          {sub.ends_on && ` · ${fmtDay(sub.ends_on)}`}
        </span>
        {sub.notes && <span className="mn-sub-note">{sub.notes}</span>}
      </span>
      <Countdown ends={sub.ends_on} />
      <span className="mono mn-sub-amt">{inr(sub.amount)}</span>
      {sub.paid_by && <Avatar userId={sub.paid_by} size={22} />}
      <span className="mn-sub-acts">
        {sub.billing_cycle !== 'one_off' && sub.ends_on && (
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
        <button type="button" className="btn sm danger" onClick={remove}>
          Delete
        </button>
      </span>
    </motion.div>
  );
}

export default function Subscriptions() {
  const ds = useData((data) => data);
  const active = useMemo(() => upcomingSubscriptions(ds), [ds.subscriptions]);
  const cancelled = useMemo(() => ds.subscriptions.filter((subscription) => !subscription.is_active), [ds.subscriptions]);
  const runRate = useMemo(() => monthlyRunRate(ds), [ds.subscriptions]);

  return (
    <div>
      <div className="mn-stats">
        <div className="mn-stat">
          <FeatureTitle tip="Active monthly plans plus one-twelfth of active yearly plans. One-time endings are excluded.">
            Monthly run rate
          </FeatureTitle>
          <b className="mono">
            <CountUp value={Math.round(runRate)} format={(value) => inr(value)} />
          </b>
        </div>
        <div className="mn-stat">
          <FeatureTitle tip="Dated subscription trackers that have not been cancelled.">Active</FeatureTitle>
          <b className="mono">
            <CountUp value={active.length} />
          </b>
          <span className="sub">{cancelled.length} cancelled</span>
        </div>
      </div>

      <div className="mn-section-title">
        <FeatureTitle tip="Created from an expense only after it has a renewal or end date; soonest date appears first.">
          Dated subscriptions
        </FeatureTitle>
      </div>

      <motion.div {...staggerParent()}>
        {active.map((subscription) => (
          <SubRow key={subscription.id} sub={subscription} />
        ))}
        {active.length === 0 && (
          <p className="tip">No active subscriptions. Add an expense with a renewal or end date to track one here.</p>
        )}
        {cancelled.length > 0 && (
          <>
            <div className="eyebrow" style={{ marginTop: 16 }}>
              Cancelled
            </div>
            {cancelled.map((subscription) => (
              <SubRow key={subscription.id} sub={subscription} />
            ))}
          </>
        )}
      </motion.div>
    </div>
  );
}
