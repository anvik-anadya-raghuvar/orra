import { useMemo, useState } from 'react';
import { ExternalLink, Package, Plane } from 'lucide-react';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { fmtDateTime } from '../../lib/dates';
import { isTerminalOrder } from '../../lib/personalOrders';
import type {
  PersonalOrder,
  PersonalOrderKind,
  PersonalOrderLifecycleStatus,
  PhysicalOrderDetails,
  TravelOrderDetails,
} from '../../types';
import { SideSheet, useToast } from '../../ui/bits';

type OrderView = 'review' | 'active' | 'history';

const LIFECYCLE: PersonalOrderLifecycleStatus[] = [
  'ordered',
  'processing',
  'shipped',
  'out_for_delivery',
  'delivered',
  'booked',
  'changed',
  'completed',
  'cancelled',
  'return_started',
  'returned',
  'refund_pending',
  'refunded',
  'unknown',
];

const label = (value: string) => value.replace(/_/g, ' ');

function amountLabel(order: PersonalOrder) {
  if (order.amount == null) return null;
  if (!order.currency) return String(order.amount);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: order.currency }).format(order.amount);
  } catch {
    return `${order.currency} ${order.amount}`;
  }
}
function OrderRow({ order, onEdit }: { order: PersonalOrder; onEdit: () => void }) {
  const store = useStore();
  const toast = useToast();
  const source = useData((ds) =>
    ds.personal_order_events
      .filter((event) => event.order_id === order.id)
      .sort((a, b) => b.event_at.localeCompare(a.event_at))[0],
  );

  const confirm = () => {
    store.update(
      'personal_orders',
      order.id,
      { review_status: 'confirmed', reviewed_at: nowIso(), reviewed_by: store.meId },
      store.asMe({ summary: `Order confirmed — ${order.summary}` }),
    );
    toast('Moved to Active');
  };

  const dismiss = () => {
    store.update(
      'personal_orders',
      order.id,
      { review_status: 'dismissed', reviewed_at: nowIso(), reviewed_by: store.meId },
      store.asMe({ summary: `Order detection dismissed — ${order.summary}` }),
    );
    toast('Dismissed; this message will not resurface');
  };

  const physical = order.kind === 'physical' ? (order.details as PhysicalOrderDetails) : null;
  const travel = order.kind === 'travel' ? (order.details as TravelOrderDetails) : null;
  const route = travel?.origin || travel?.destination
    ? [travel.origin, travel.destination].filter(Boolean).join(' → ')
    : null;

  return (
    <article className="po-row">
      <div className="po-icon" aria-hidden>
        {order.kind === 'travel' ? <Plane size={17} /> : <Package size={17} />}
      </div>
      <div className="po-copy">
        <div className="po-titleline">
          <strong>{order.summary}</strong>
          <span className={`pill ${order.review_status === 'pending' ? 'soon' : isTerminalOrder(order) ? 'ok' : 'q'}`}>
            {label(order.lifecycle_status)}
          </span>
        </div>
        <span>{order.merchant}{order.external_reference ? ` · ${order.external_reference}` : ''}</span>
        {(route || physical?.tracking_number) && (
          <span>{route ?? `Tracking ${physical?.tracking_number}`}</span>
        )}
        <span className="po-meta">
          {amountLabel(order) && <i>{amountLabel(order)}</i>}
          {order.next_event_at && <i>{fmtDateTime(order.next_event_at)}</i>}
          <i>{order.account_email}</i>
        </span>
      </div>
      <div className="po-actions">
        {source?.source_url && (
          <a className="btn sm" href={source.source_url} target="_blank" rel="noreferrer">
            Gmail <ExternalLink size={11} />
          </a>
        )}
        <button className="btn sm" type="button" onClick={onEdit}>Edit</button>
        {order.review_status === 'pending' && (
          <>
            <button className="btn sm solid" type="button" onClick={confirm}>Confirm</button>
            <button className="btn sm" type="button" onClick={dismiss}>Dismiss</button>
          </>
        )}
      </div>
    </article>
  );
}

function OrderEditor({ order, onClose }: { order: PersonalOrder | null; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const [kind, setKind] = useState<PersonalOrderKind>(order?.kind ?? 'physical');
  const [merchant, setMerchant] = useState(order?.merchant ?? '');
  const [summary, setSummary] = useState(order?.summary ?? '');
  const [reference, setReference] = useState(order?.external_reference ?? '');
  const [amount, setAmount] = useState(order?.amount?.toString() ?? '');
  const [currency, setCurrency] = useState(order?.currency ?? 'INR');
  const [nextEvent, setNextEvent] = useState(order?.next_event_at?.slice(0, 10) ?? '');
  const [lifecycle, setLifecycle] = useState<PersonalOrderLifecycleStatus>(
    order?.lifecycle_status ?? (kind === 'travel' ? 'booked' : 'ordered'),
  );
  const oldPhysical = order?.kind === 'physical' ? (order.details as PhysicalOrderDetails) : null;
  const oldTravel = order?.kind === 'travel' ? (order.details as TravelOrderDetails) : null;
  const [tracking, setTracking] = useState(oldPhysical?.tracking_number ?? '');
  const [carrier, setCarrier] = useState(oldPhysical?.carrier ?? '');
  const [origin, setOrigin] = useState(oldTravel?.origin ?? '');
  const [destination, setDestination] = useState(oldTravel?.destination ?? '');

  const save = () => {
    const cleanSummary = summary.trim();
    const cleanMerchant = merchant.trim();
    if (!cleanSummary || !cleanMerchant) {
      toast('Add a summary and merchant or provider');
      return;
    }
    const parsedAmount = amount.trim() ? Number(amount) : null;
    if (parsedAmount != null && !Number.isFinite(parsedAmount)) {
      toast('Amount must be a number');
      return;
    }
    const details: PersonalOrder['details'] = kind === 'physical'
      ? {
          items: oldPhysical?.items ?? [],
          carrier: carrier.trim() || null,
          tracking_number: tracking.trim() || null,
          tracking_url: oldPhysical?.tracking_url ?? null,
        }
      : {
          booking_reference: reference.trim() || null,
          origin: origin.trim() || null,
          destination: destination.trim() || null,
          departure_at: nextEvent ? new Date(`${nextEvent}T00:00:00`).toISOString() : null,
          arrival_at: oldTravel?.arrival_at ?? null,
          stay_end_at: oldTravel?.stay_end_at ?? null,
        };
    const next = nextEvent ? new Date(`${nextEvent}T00:00:00`).toISOString() : null;

    if (!order) {
      const created: PersonalOrder = {
        id: newId('ord'),
        user_id: store.meId,
        integration_grant_id: null,
        account_email: store.me.email,
        kind,
        review_status: 'confirmed',
        lifecycle_status: lifecycle,
        merchant: cleanMerchant,
        external_reference: reference.trim() || null,
        summary: cleanSummary,
        amount: parsedAmount,
        currency: currency.trim().toUpperCase() || null,
        next_event_at: next,
        details,
        manual_fields: ['kind', 'merchant', 'summary', 'external_reference', 'amount', 'currency', 'next_event_at', 'lifecycle_status', 'details'],
        reviewed_at: nowIso(),
        reviewed_by: store.meId,
        last_event_at: nowIso(),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      store.insert('personal_orders', created, store.asMe({ summary: `Order added — ${cleanSummary}` }));
      toast('Order or booking added');
    } else {
      const fields = new Set(order.manual_fields);
      const changed: [string, unknown, unknown][] = [
        ['kind', order.kind, kind],
        ['merchant', order.merchant, cleanMerchant],
        ['summary', order.summary, cleanSummary],
        ['external_reference', order.external_reference, reference.trim() || null],
        ['amount', order.amount, parsedAmount],
        ['currency', order.currency, currency.trim().toUpperCase() || null],
        ['next_event_at', order.next_event_at, next],
        ['lifecycle_status', order.lifecycle_status, lifecycle],
        ['details', JSON.stringify(order.details), JSON.stringify(details)],
      ];
      changed.forEach(([field, before, after]) => {
        if (before !== after) fields.add(field);
      });
      store.update(
        'personal_orders',
        order.id,
        {
          kind,
          merchant: cleanMerchant,
          summary: cleanSummary,
          external_reference: reference.trim() || null,
          amount: parsedAmount,
          currency: currency.trim().toUpperCase() || null,
          next_event_at: next,
          lifecycle_status: lifecycle,
          details,
          manual_fields: [...fields],
          updated_at: nowIso(),
        },
        store.asMe({ summary: `Order edited — ${cleanSummary}` }),
      );
      toast('Saved; corrected fields are protected from mail updates');
    }
    onClose();
  };

  return (
    <SideSheet
      open
      onClose={onClose}
      title={order ? 'Edit order or booking' : 'Add order or booking'}
      subtitle="Manual corrections stay authoritative when later emails arrive."
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn solid" type="button" onClick={save}>Save</button>
        </>
      }
    >
      <div className="po-form">
        <label>Type<select value={kind} onChange={(event) => setKind(event.target.value as PersonalOrderKind)}><option value="physical">Physical purchase</option><option value="travel">Travel booking</option></select></label>
        <label>Merchant or provider<input value={merchant} onChange={(event) => setMerchant(event.target.value)} /></label>
        <label>Summary<input value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <label>Order or booking reference<input value={reference} onChange={(event) => setReference(event.target.value)} /></label>
        <div className="po-form-pair">
          <label>Amount<input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
          <label>Currency<input maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value)} /></label>
        </div>
        <div className="po-form-pair">
          <label>Relevant date<input type="date" value={nextEvent} onChange={(event) => setNextEvent(event.target.value)} /></label>
          <label>Status<select value={lifecycle} onChange={(event) => setLifecycle(event.target.value as PersonalOrderLifecycleStatus)}>{LIFECYCLE.map((status) => <option value={status} key={status}>{label(status)}</option>)}</select></label>
        </div>
        {kind === 'physical' ? (
          <div className="po-form-pair">
            <label>Carrier<input value={carrier} onChange={(event) => setCarrier(event.target.value)} /></label>
            <label>Tracking number<input value={tracking} onChange={(event) => setTracking(event.target.value)} /></label>
          </div>
        ) : (
          <div className="po-form-pair">
            <label>Origin<input value={origin} onChange={(event) => setOrigin(event.target.value)} /></label>
            <label>Destination<input value={destination} onChange={(event) => setDestination(event.target.value)} /></label>
          </div>
        )}
      </div>
    </SideSheet>
  );
}

export default function PersonalOrders() {
  const meId = useData((_, state) => state.meId);
  const orders = useData((ds) => ds.personal_orders).filter((order) => order.user_id === meId);
  const [view, setView] = useState<OrderView>('review');
  const [editing, setEditing] = useState<PersonalOrder | 'new' | null>(null);
  const buckets = useMemo(
    () => ({
      review: orders.filter((order) => order.review_status === 'pending'),
      active: orders.filter((order) => order.review_status === 'confirmed' && !isTerminalOrder(order)),
      history: orders.filter((order) => order.review_status === 'dismissed' || (order.review_status === 'confirmed' && isTerminalOrder(order))),
    }),
    [orders],
  );
  const rows = [...buckets[view]].sort((a, b) =>
    (a.next_event_at ?? a.last_event_at).localeCompare(b.next_event_at ?? b.last_event_at),
  );

  return (
    <div className="pbig personal-orders">
      <div className="phead po-head">
        <div><h3>Personal orders</h3><span className="eyebrow">purchases and travel, never subscriptions</span></div>
        <button className="btn sm solid" type="button" onClick={() => setEditing('new')}>+ Add order or booking</button>
      </div>
      <div className="ptabs po-tabs" role="tablist" aria-label="Personal order views">
        {(['review', 'active', 'history'] as OrderView[]).map((key) => (
          <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}>
            {key[0].toUpperCase() + key.slice(1)} <span>{buckets[key].length}</span>
          </button>
        ))}
      </div>
      <div className="po-list">
        {rows.map((order) => <OrderRow key={order.id} order={order} onEdit={() => setEditing(order)} />)}
        {rows.length === 0 && (
          <p className="tip">{view === 'review' ? 'No detections waiting for you.' : view === 'active' ? 'No active deliveries or upcoming trips.' : 'No order history yet.'}</p>
        )}
      </div>
      {editing && <OrderEditor order={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
