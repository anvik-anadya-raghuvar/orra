import { describe, expect, it } from 'vitest';
import type { DataAdapter } from '../data/adapter';
import { seedDataset } from '../data/seed';
import { AppStore } from '../data/store';
import type { IntegrationGrant } from '../types';
import {
  detectPersonalOrder,
  recordOrderDetection,
  type OrderMessageInput,
} from './personalOrders';

const adapter: DataAdapter = {
  kind: 'mock',
  async load() { return seedDataset(); },
  saveCollection() {},
  saveWeights() {},
};

const grant: IntegrationGrant = {
  id: 'ig-orders',
  user_id: 'u-anadya',
  provider: 'google',
  google_subject: 'google-subject',
  account_email: 'orders@example.com',
  display_name: 'Orders',
  scopes: [],
  connected_at: '2026-08-01T00:00:00.000Z',
  last_sync_at: null,
  is_active: true,
  gmail_history_id: null,
  initial_mail_scan_at: null,
  last_sync_error: null,
};

const message = (patch: Partial<OrderMessageInput> = {}): OrderMessageInput => ({
  id: 'message-1',
  threadId: 'thread-1',
  from: 'Example Shop <no-reply@example.shop>',
  subject: 'Order confirmed',
  snippet: 'Order number ABC-1234',
  receivedAt: '2026-08-18T10:00:00.000Z',
  link: 'https://mail.google.com/mail/u/?authuser=orders%40example.com#all/message-1',
  text: 'Thanks for your order. Order number ABC-1234. Total INR 2,499. Delivery on 2026-08-24.',
  html: '',
  ...patch,
});

const makeStore = (dataAdapter: DataAdapter = adapter) => {
  const ds = seedDataset();
  ds.personal_orders = [];
  ds.personal_order_events = [];
  ds.integration_grants = [grant];
  return new AppStore(ds, dataAdapter, 'u-anadya');
};

describe('deterministic personal order detection', () => {
  it('extracts physical purchases and travel bookings', () => {
    const physical = detectPersonalOrder(message());
    expect(physical).toMatchObject({
      kind: 'physical',
      external_reference: 'ABC-1234',
      amount: 2499,
      currency: 'INR',
      lifecycle_status: 'ordered',
    });

    const travel = detectPersonalOrder(message({
      id: 'travel-1',
      from: 'Rail Europe <booking@rail.example>',
      subject: 'Booking confirmed · train to Milan',
      snippet: 'Reservation number PNR-7788',
      text: 'Your train booking is confirmed. Reservation number PNR-7788. Departure on 2026-09-02. EUR 89.',
    }));
    expect(travel).toMatchObject({ kind: 'travel', external_reference: 'PNR-7788', currency: 'EUR' });
  });

  it('accepts supported structured schema and rejects subscriptions and weak single-signal mail', () => {
    const structured = detectPersonalOrder(message({
      html: '<script type="application/ld+json">{"@type":"ParcelDelivery","trackingNumber":"TRACK-9988","provider":{"name":"DHL"}}</script>',
    }));
    expect(structured?.confidence).toBe(0.96);
    expect(structured?.kind).toBe('physical');

    expect(detectPersonalOrder(message({
      subject: 'Your monthly subscription renews automatically',
      snippet: 'Membership charge',
      text: 'Your annual plan subscription renews automatically. INR 999.',
    }))).toBeNull();
    expect(detectPersonalOrder(message({
      subject: 'Order confirmed — software licence key',
      snippet: 'Your digital download is ready',
      text: 'Order number SOFT-9988. Digital download. INR 4,999.',
    }))).toBeNull();
    expect(detectPersonalOrder(message({
      from: 'A person <person@example.com>',
      subject: 'Order',
      snippet: '',
      text: 'order',
    }))).toBeNull();
  });

  it('parses Italian decimal and thousands separators without an AI service', () => {
    const italian = detectPersonalOrder(message({
      from: 'Negozio <ordini@negozio.it>',
      subject: 'Ordine confermato',
      snippet: 'Ordine numero ITA-7788',
      text: 'Grazie per il tuo ordine. Ordine numero ITA-7788. Totale 1.299,00 EUR. Consegna entro 24/08/2026.',
    }));
    expect(italian).toMatchObject({ amount: 1299, currency: 'EUR', lifecycle_status: 'ordered' });
  });
});

describe('review and lifecycle rules', () => {
  it('waits for the parent order before inserting its immutable evidence', async () => {
    const writes: string[] = [];
    let parentConfirmed = false;
    const confirmedAdapter: DataAdapter = {
      ...adapter,
      async saveCollectionConfirmed(key) {
        writes.push(key);
        if (key === 'personal_orders') parentConfirmed = true;
        if (key === 'personal_order_events' && !parentConfirmed) return 'parent order is missing';
        return null;
      },
    };
    const store = makeStore(confirmedAdapter);

    await recordOrderDetection(store, grant, message(), detectPersonalOrder(message())!);

    expect(writes).toEqual(['personal_orders', 'personal_order_events']);
    expect(store.ds.personal_orders).toHaveLength(1);
    expect(store.ds.personal_order_events).toHaveLength(1);
  });

  it('does not leave unsaved evidence in memory when a confirmed insert fails', async () => {
    const confirmedAdapter: DataAdapter = {
      ...adapter,
      async saveCollectionConfirmed(key) {
        return key === 'personal_order_events' ? 'RLS rejected evidence' : null;
      },
    };
    const store = makeStore(confirmedAdapter);

    await expect(
      recordOrderDetection(store, grant, message(), detectPersonalOrder(message())!),
    ).rejects.toThrow('RLS rejected evidence');
    expect(store.ds.personal_orders).toHaveLength(1);
    expect(store.ds.personal_order_events).toHaveLength(0);
  });

  it('creates one pending review and one immutable event per Gmail message', async () => {
    const store = makeStore();
    const detection = detectPersonalOrder(message())!;
    await recordOrderDetection(store, grant, message(), detection);
    await recordOrderDetection(store, grant, message(), detection);
    expect(store.ds.personal_orders).toHaveLength(1);
    expect(store.ds.personal_orders[0].review_status).toBe('pending');
    expect(store.ds.personal_order_events).toHaveLength(1);
  });

  it('suppresses dismissed references and leaves ambiguous updates in Review', async () => {
    const store = makeStore();
    const first = detectPersonalOrder(message())!;
    await recordOrderDetection(store, grant, message(), first);
    store.update('personal_orders', store.ds.personal_orders[0].id, { review_status: 'dismissed' }, store.asMe());

    const sameReference = message({ id: 'message-2', receivedAt: '2026-08-19T10:00:00.000Z', subject: 'Order shipped', text: 'Order number ABC-1234 shipped. Tracking number TRACK-123456.' });
    await recordOrderDetection(store, grant, sameReference, detectPersonalOrder(sameReference)!);
    expect(store.ds.personal_orders).toHaveLength(1);
    expect(store.ds.personal_orders[0].review_status).toBe('dismissed');

    const ambiguous = message({ id: 'message-3', threadId: 'thread-3', receivedAt: '2026-08-20T10:00:00.000Z', snippet: 'Order number NEW-9999', text: 'Order number NEW-9999 shipped. Tracking number TRACK-999999.' });
    await recordOrderDetection(store, grant, ambiguous, detectPersonalOrder(ambiguous)!);
    expect(store.ds.personal_orders).toHaveLength(2);
    expect(store.ds.personal_orders[1].review_status).toBe('pending');
  });

  it('updates exact confirmed matches, protects manual fields, and ignores older lifecycle mail', async () => {
    const store = makeStore();
    await recordOrderDetection(store, grant, message(), detectPersonalOrder(message())!);
    const order = store.ds.personal_orders[0];
    store.update(
      'personal_orders',
      order.id,
      { review_status: 'confirmed', lifecycle_status: 'shipped', manual_fields: ['lifecycle_status'] },
      store.asMe(),
    );

    const delivered = message({ id: 'message-4', receivedAt: '2026-08-21T10:00:00.000Z', subject: 'Order delivered', text: 'Order number ABC-1234 delivered.' });
    await recordOrderDetection(store, grant, delivered, detectPersonalOrder(delivered)!);
    expect(store.ds.personal_orders[0].lifecycle_status).toBe('shipped');

    store.update('personal_orders', order.id, { manual_fields: [] }, store.asMe());
    const older = message({ id: 'message-5', receivedAt: '2026-08-10T10:00:00.000Z', subject: 'Order processing', text: 'Order number ABC-1234 is processing.' });
    await recordOrderDetection(store, grant, older, detectPersonalOrder(older)!);
    expect(store.ds.personal_orders[0].last_event_at).toBe('2026-08-21T10:00:00.000Z');
    expect(store.ds.personal_orders[0].lifecycle_status).toBe('shipped');
  });

  it('keeps a same-thread update in Review when a confirmed order has no exact reference', async () => {
    const store = makeStore();
    await recordOrderDetection(store, grant, message(), detectPersonalOrder(message())!);
    store.update('personal_orders', store.ds.personal_orders[0].id, { review_status: 'confirmed' }, store.asMe());
    const ambiguous = message({
      id: 'message-no-ref',
      snippet: 'Your package shipped',
      subject: 'Package shipped',
      text: 'Your package shipped and is on its way.',
      receivedAt: '2026-08-22T10:00:00.000Z',
    });
    await recordOrderDetection(store, grant, ambiguous, detectPersonalOrder(ambiguous)!);
    expect(store.ds.personal_orders).toHaveLength(2);
    expect(store.ds.personal_orders[1].review_status).toBe('pending');
  });
});
