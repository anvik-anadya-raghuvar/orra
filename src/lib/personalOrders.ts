import type { AppStore } from '../data/store';
import { newId, nowIso } from '../data/store';
import type {
  IntegrationGrant,
  PersonalOrder,
  PersonalOrderEvent,
  PersonalOrderKind,
  PersonalOrderLifecycleStatus,
  PhysicalOrderDetails,
  TravelOrderDetails,
} from '../types';

export interface OrderMessageInput {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  link: string;
  text: string;
  html: string;
}

export interface OrderDetection {
  kind: PersonalOrderKind;
  merchant: string;
  external_reference: string | null;
  summary: string;
  amount: number | null;
  currency: string | null;
  next_event_at: string | null;
  lifecycle_status: PersonalOrderLifecycleStatus;
  details: PhysicalOrderDetails | TravelOrderDetails;
  confidence: number;
  reason: string;
}

const TRAVEL = /\b(flight|airline|hotel|hostel|train|rail|booking|reservation|itinerary|check[ -]?in|boarding|pnr|volo|treno|albergo|prenotazion[ei]|viaggio)\b/i;
const PHYSICAL = /\b(order|purchase|parcel|package|shipment|shipping|dispatch|delivery|delivered|tracking|courier|ordine|acquisto|pacco|spedizion[ei]|spedito|consegna|corriere)\b/i;
const RECURRING = /\b(subscription|membership|recurring|renews? (?:on|automatically)|monthly plan|annual plan|abbonamento|rinnovo automatico)\b/i;
const NON_PHYSICAL_SERVICE = /\b(digital download|software|licen[cs]e key|online course|consulting|service fee|app purchase|cloud storage|domain renewal|web hosting|e-?book|gift card|download digitale|servizio)\b/i;

const STATUS_PATTERNS: [PersonalOrderLifecycleStatus, RegExp][] = [
  ['refunded', /\b(refund(?:ed| complete)|rimborso (?:emesso|completato))\b/i],
  ['refund_pending', /\b(refund (?:is )?(?:pending|processing|initiated)|rimborso (?:in corso|avviato))\b/i],
  ['returned', /\b(return (?:received|complete|completed)|reso (?:ricevuto|completato))\b/i],
  ['return_started', /\b(return (?:requested|started|authori[sz]ed)|reso (?:richiesto|avviato))\b/i],
  ['cancelled', /\b(cancelled|canceled|annullat[oa])\b/i],
  ['delivered', /\b(delivered|consegnat[oa])\b/i],
  ['out_for_delivery', /\b(out for delivery|in consegna)\b/i],
  ['shipped', /\b(shipped|dispatched|spedito|in transito)\b/i],
  ['changed', /\b(schedule change|itinerary change|booking (?:was )?changed|cambio (?:orario|itinerario))\b/i],
  ['completed', /\b(trip complete|stay complete|journey complete|viaggio completato)\b/i],
  ['booked', /\b(booking confirmed|reservation confirmed|flight confirmed|prenotazione confermata)\b/i],
  ['processing', /\b(processing|being prepared|preparazione|in lavorazione)\b/i],
  ['ordered', /\b(order confirmed|thanks for your order|purchase confirmed|ordine confermato|grazie per il tuo ordine)\b/i],
];

const headerName = (from: string) => {
  const display = from.match(/^\s*"?([^"<]+?)"?\s*</)?.[1]?.trim();
  if (display) return display;
  const email = from.match(/<?([^<>\s]+@[^<>\s]+)>?/)?.[1] ?? from;
  const domain = email.split('@')[1]?.split('.')[0] ?? email;
  return domain.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

const normaliseRef = (value: string) => value.replace(/^[#:\s-]+|[.,;:)]+$/g, '').trim();

function extractReference(text: string): string | null {
  const stopWords = new Set([
    'CONFIRMED', 'CONFIRMATION', 'PROCESSING', 'SHIPPED', 'DISPATCHED', 'DELIVERED',
    'CANCELLED', 'CANCELED', 'CHANGED', 'UPDATE', 'UPDATED', 'NUMBER', 'BOOKING',
    'ORDINE', 'CONFERMATO', 'SPEDITO', 'CONSEGNATO',
  ]);
  const matches = text.matchAll(
    /\b(?:order|booking|reservation|confirmation|reference|pnr|ordine|prenotazione)(?:\s+(?:number|no\.?|code|id|numero|codice))?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,})\b/gi,
  );
  for (const match of matches) {
    const candidate = normaliseRef(match[1]).toUpperCase();
    if (!stopWords.has(candidate)) return candidate;
  }
  return null;
}

function extractTracking(text: string): string | null {
  const match = text.match(
    /\b(?:tracking|shipment|parcel|spedizione)(?:\s+(?:number|no\.?|id|numero|codice))?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{5,})\b/i,
  );
  return match ? normaliseRef(match[1]).toUpperCase() : null;
}

function extractAmount(text: string): { amount: number; currency: string } | null {
  const before = text.match(/(?:₹|INR\s?|€|EUR\s?|\$|USD\s?)\s*([0-9][0-9,.]*)/i);
  const after = text.match(/\b([0-9][0-9,.]*)\s*(INR|EUR|USD)\b/i);
  const raw = before?.[1] ?? after?.[1];
  if (!raw) return null;
  const compact = raw.replace(/\s/g, '');
  const comma = compact.lastIndexOf(',');
  const dot = compact.lastIndexOf('.');
  let normalised = compact;
  if (comma >= 0 && dot >= 0) {
    normalised = comma > dot
      ? compact.replace(/\./g, '').replace(',', '.')
      : compact.replace(/,/g, '');
  } else if (comma >= 0) {
    const decimals = compact.length - comma - 1;
    normalised = decimals > 0 && decimals <= 2 ? compact.replace(',', '.') : compact.replace(/,/g, '');
  } else if (dot >= 0) {
    const decimals = compact.length - dot - 1;
    normalised = decimals === 3 ? compact.replace(/\./g, '') : compact;
  }
  const amount = Number(normalised);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const marker = (before?.[0] ?? after?.[2] ?? '').toUpperCase();
  const currency = marker.includes('₹') || marker.includes('INR')
    ? 'INR'
    : marker.includes('€') || marker.includes('EUR')
      ? 'EUR'
      : 'USD';
  return { amount, currency };
}

function extractNextDate(text: string, receivedAt: string): string | null {
  const labelled = text.match(
    /\b(?:arriv(?:es|ing|al)|deliver(?:y|ed by)|departure|check[ -]?in|on|entro|consegna|partenza)\s*(?:on|by|il|prevista)?\s*[:,-]?\s*((?:\d{4}-\d{2}-\d{2})|(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})|(?:[A-Z][a-z]{2,8}\s+\d{1,2}(?:,\s*\d{4})?))/i,
  );
  if (!labelled) return null;
  const value = labelled[1];
  let parsed = Date.parse(value);
  if (!Number.isFinite(parsed) && /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(value)) {
    const [day, month, yearRaw] = value.split(/[\/-]/).map(Number);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    parsed = Date.UTC(year, month - 1, day, 12);
  }
  if (!Number.isFinite(parsed) && !/\d{4}/.test(value)) {
    parsed = Date.parse(`${value}, ${new Date(receivedAt).getFullYear()}`);
  }
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function findSchemaObjects(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const scripts = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of scripts) {
    try {
      const value = JSON.parse(match[1].trim()) as unknown;
      const queue = Array.isArray(value) ? [...value] : [value];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const obj = item as Record<string, unknown>;
        out.push(obj);
        const graph = obj['@graph'];
        if (Array.isArray(graph)) queue.push(...graph);
      }
    } catch {
      // Malformed structured data is common in transactional mail; generic
      // extraction below remains available and no raw body is ever logged.
    }
  }
  return out;
}

function schemaDetection(message: OrderMessageInput): OrderDetection | null {
  const objects = findSchemaObjects(message.html);
  const supported = objects.find((obj) => {
    const type = String(obj['@type'] ?? '');
    return /Order|ParcelDelivery|FlightReservation|LodgingReservation|TrainReservation/i.test(type);
  });
  if (!supported) return null;

  const type = String(supported['@type'] ?? '');
  const kind: PersonalOrderKind = /Flight|Lodging|Train|Reservation/i.test(type) ? 'travel' : 'physical';
  const seller = supported.seller ?? supported.provider ?? supported.airline ?? supported.reservationFor;
  const merchant =
    typeof seller === 'string'
      ? seller
      : seller && typeof seller === 'object'
        ? String((seller as Record<string, unknown>).name ?? headerName(message.from))
        : headerName(message.from);
  const reference = String(
    supported.orderNumber ?? supported.reservationNumber ?? supported.trackingNumber ?? '',
  ).trim() || extractReference(`${message.subject}\n${message.text}`);
  const amountObj = supported.priceSpecification;
  const amount =
    typeof supported.price === 'number'
      ? supported.price
      : amountObj && typeof amountObj === 'object'
        ? Number((amountObj as Record<string, unknown>).price)
        : null;
  const currency = String(
    supported.priceCurrency ??
      (amountObj && typeof amountObj === 'object'
        ? (amountObj as Record<string, unknown>).priceCurrency ?? ''
        : ''),
  ).trim() || null;
  const body = `${message.subject}\n${message.text}`;
  const lifecycle = STATUS_PATTERNS.find(([, pattern]) => pattern.test(body))?.[0] ?? (kind === 'travel' ? 'booked' : 'ordered');
  const next = String(
    supported.expectedArrivalUntil ?? supported.departureTime ?? supported.checkinTime ?? '',
  ).trim();
  const next_event_at = next && Number.isFinite(Date.parse(next)) ? new Date(next).toISOString() : extractNextDate(body, message.receivedAt);
  const tracking = String(supported.trackingNumber ?? '').trim() || extractTracking(body);

  return {
    kind,
    merchant,
    external_reference: reference ? reference.toUpperCase() : null,
    summary: message.subject,
    amount: Number.isFinite(amount) ? Number(amount) : null,
    currency,
    next_event_at,
    lifecycle_status: lifecycle,
    details:
      kind === 'physical'
        ? { items: [], carrier: null, tracking_number: tracking, tracking_url: null }
        : {
            booking_reference: reference || null,
            origin: null,
            destination: null,
            departure_at: next_event_at,
            arrival_at: null,
            stay_end_at: null,
          },
    confidence: 0.96,
    reason: `Structured ${type || 'commerce'} data`,
  };
}

/** Deterministic and deliberately conservative: review receives plausible
 * orders, not every invoice containing the word "order". */
export function detectPersonalOrder(message: OrderMessageInput): OrderDetection | null {
  const body = `${message.subject}\n${message.snippet}\n${message.text}`.slice(0, 120_000);
  // Recurring billing and non-physical services belong to the existing
  // Subscriptions/Money surfaces, even when their email also says "order".
  if (RECURRING.test(body) || NON_PHYSICAL_SERVICE.test(body)) return null;
  const structured = schemaDetection(message);
  if (structured) return structured;

  const travel = TRAVEL.test(body);
  const physical = PHYSICAL.test(body);
  if (!travel && !physical) return null;

  const reference = extractReference(body);
  const tracking = extractTracking(body);
  const amount = extractAmount(body);
  const matchedLifecycle = STATUS_PATTERNS.find(([, pattern]) => pattern.test(body))?.[0];
  const lifecycle = matchedLifecycle ?? (travel ? 'booked' : 'ordered');
  const next = extractNextDate(body, message.receivedAt);
  const signals = [
    travel || physical,
    reference !== null,
    tracking !== null,
    amount !== null,
    matchedLifecycle !== undefined,
    /no-?reply|orders?|booking|travel|airline|hotel|courier/i.test(message.from),
  ].filter(Boolean).length;
  if (signals < 2) return null;
  const confidence = Math.min(0.92, 0.44 + signals * 0.09);
  if (confidence < 0.68) return null;

  const kind: PersonalOrderKind = travel ? 'travel' : 'physical';
  return {
    kind,
    merchant: headerName(message.from),
    external_reference: reference,
    summary: message.subject || message.snippet.slice(0, 200),
    amount: amount?.amount ?? null,
    currency: amount?.currency ?? null,
    next_event_at: next,
    lifecycle_status: lifecycle,
    details:
      kind === 'physical'
        ? { items: [], carrier: null, tracking_number: tracking, tracking_url: null }
        : {
            booking_reference: reference,
            origin: null,
            destination: null,
            departure_at: next,
            arrival_at: null,
            stay_end_at: null,
          },
    confidence,
    reason: `${signals} independent commerce/travel signals`,
  };
}

export const isTerminalOrder = (order: PersonalOrder): boolean => {
  if (order.review_status !== 'confirmed') return order.review_status === 'dismissed';
  return ['delivered', 'completed', 'cancelled', 'returned', 'refunded'].includes(order.lifecycle_status);
};

const sameRef = (a: string | null, b: string | null) =>
  !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();

const trackingOf = (order: PersonalOrder) =>
  order.kind === 'physical' ? (order.details as PhysicalOrderDetails).tracking_number : null;

function findMatchedOrder(
  store: AppStore,
  grant: IntegrationGrant,
  message: OrderMessageInput,
  detection: OrderDetection,
): PersonalOrder | null {
  const mine = store.ds.personal_orders.filter(
    (order) => order.user_id === store.meId && order.integration_grant_id === grant.id,
  );
  const exact = mine.find((order) => sameRef(order.external_reference, detection.external_reference));
  if (exact) return exact;
  const tracking = detection.kind === 'physical' ? (detection.details as PhysicalOrderDetails).tracking_number : null;
  const tracked = mine.find((order) => sameRef(trackingOf(order), tracking));
  if (tracked) return tracked;
  const threadedEvent = store.ds.personal_order_events.find(
    (event) =>
      event.user_id === store.meId &&
      event.integration_grant_id === grant.id &&
      event.parsed_fields.gmail_thread_id === message.threadId,
  );
  if (!threadedEvent) return null;
  const threadedOrder = store.ds.personal_orders.find((order) => order.id === threadedEvent.order_id) ?? null;
  // A thread is enough to keep one pending review together or to suppress a
  // dismissed conversation. It is deliberately not enough to mutate a
  // confirmed record: those require an exact reference or tracking number.
  return threadedOrder?.review_status === 'confirmed' ? null : threadedOrder;
}

function mergeDetection(order: PersonalOrder, detection: OrderDetection, eventAt: string): Partial<PersonalOrder> {
  if (Date.parse(eventAt) < Date.parse(order.last_event_at)) return {};
  const locked = new Set(order.manual_fields);
  const patch: Partial<PersonalOrder> = {
    last_event_at: eventAt,
    updated_at: nowIso(),
  };
  if (!locked.has('lifecycle_status')) patch.lifecycle_status = detection.lifecycle_status;
  if (!locked.has('next_event_at') && detection.next_event_at) patch.next_event_at = detection.next_event_at;
  if (!locked.has('external_reference') && !order.external_reference && detection.external_reference) {
    patch.external_reference = detection.external_reference;
  }
  if (!locked.has('amount') && order.amount == null && detection.amount != null) patch.amount = detection.amount;
  if (!locked.has('currency') && !order.currency && detection.currency) patch.currency = detection.currency;
  if (!locked.has('details')) {
    patch.details = { ...order.details, ...detection.details } as PersonalOrder['details'];
  }
  return patch;
}

/** Store a parsed candidate/event idempotently. Returns whether a new review
 * row was created; exact updates attach to the existing order. */
export async function recordOrderDetection(
  store: AppStore,
  grant: IntegrationGrant,
  message: OrderMessageInput,
  detection: OrderDetection,
): Promise<{ created: boolean; orderId: string }> {
  const priorEvent = store.ds.personal_order_events.find(
    (event) => event.integration_grant_id === grant.id && event.gmail_message_id === message.id,
  );
  if (priorEvent) return { created: false, orderId: priorEvent.order_id };

  let order = findMatchedOrder(store, grant, message, detection);
  const eventAt = message.receivedAt || nowIso();
  let created = false;
  if (!order) {
    const id = newId('ord');
    order = {
      id,
      user_id: store.meId,
      integration_grant_id: grant.id,
      account_email: grant.account_email ?? store.me.email,
      kind: detection.kind,
      review_status: 'pending',
      lifecycle_status: detection.lifecycle_status,
      merchant: detection.merchant,
      external_reference: detection.external_reference,
      summary: detection.summary,
      amount: detection.amount,
      currency: detection.currency,
      next_event_at: detection.next_event_at,
      details: detection.details,
      manual_fields: [],
      reviewed_at: null,
      reviewed_by: null,
      last_event_at: eventAt,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    await store.insertConfirmed(
      'personal_orders',
      order,
      { actor: null, actorLabel: 'automated', source: 'gmail', summary: `Order review detected — ${order.summary}` },
    );
    created = true;
  } else if (order.review_status !== 'dismissed') {
    const patch = mergeDetection(order, detection, eventAt);
    if (Object.keys(patch).length) {
      store.update('personal_orders', order.id, patch, {
        actor: null,
        actorLabel: 'automated',
        source: 'gmail',
        summary: `Order updated from mail — ${order.summary}`,
      });
    }
  }

  const event: PersonalOrderEvent = {
    id: newId('oe'),
    order_id: order.id,
    user_id: store.meId,
    integration_grant_id: grant.id,
    gmail_message_id: message.id,
    event_type: detection.lifecycle_status,
    event_at: eventAt,
    sender: message.from.slice(0, 500),
    subject: message.subject.slice(0, 1000),
    source_url: message.link.slice(0, 2000),
    detection_reason: detection.reason.slice(0, 1000),
    confidence: detection.confidence,
    parsed_fields: {
      gmail_thread_id: message.threadId,
      merchant: detection.merchant,
      external_reference: detection.external_reference,
      amount: detection.amount,
      currency: detection.currency,
      next_event_at: detection.next_event_at,
      details: detection.details,
    },
    created_at: nowIso(),
  };
  await store.insertConfirmed(
    'personal_order_events',
    event,
    { actor: null, actorLabel: 'automated', source: 'gmail', silent: true },
  );
  return { created, orderId: order.id };
}
