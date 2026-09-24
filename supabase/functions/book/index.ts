/**
 * Public meeting booking.
 *
 *   GET  ?slug=anadya            → the page: title, host first name, lengths,
 *                                  host zone, and open slots per length
 *   POST {slug, start, duration, name, email, note}
 *                                → books it (pending), puts a block on the
 *                                  host's calendar, pings the host
 *
 * Public by design — a guest has no ORRA account — so it is deployed with
 * verify_jwt off and trusts nothing it is sent:
 *   · every field is capped and validated here AND by the table CHECKs
 *   · the slot is recomputed here from live data, then re-checked inside
 *     public.book_slot() under a per-host lock, which is what makes two
 *     guests racing for one slot safe
 *   · rate limits (5 per IP per day, 20 pending per host) live in that same
 *     locked function; the IP is stored only as a salted hash
 *   · an unknown slug and a switched-off page answer identically, so the
 *     endpoint cannot be used to discover which slugs exist
 *
 * Slot maths is src/lib/booking.ts — the exact code the tests cover and the
 * browser renders with. It has no imports so Deno can load it directly.
 *
 * Deploy:  npx supabase functions deploy book --no-verify-jwt
 * Secrets: ORRA_INTERNAL_SECRET (shared with `push`; also salts the IP hash)
 */
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  addDays,
  availabilityBusy,
  bookingIntervals,
  CAPS,
  computeSlots,
  eventInterval,
  firstName,
  isSlotOffered,
  isValidTimeZone,
  normaliseRules,
  SLUG_RE,
  validateGuest,
  zonedParts,
  type Interval,
  type Slot,
} from '../../../src/lib/booking.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const NOT_FOUND = () => json({ error: 'not_found', message: 'This booking page is not available.' }, 404);
const MAX_BODY_BYTES = 4096;

// The service role is used because a guest is anonymous: reading the host's
// calendar to compute free time, and writing a booking plus the host's
// calendar block, are exactly what RLS forbids to anon. The key stays in this
// function; nothing it returns includes a row the guest did not send, beyond
// the page's public title, the host's first name and bare free/busy slots.
const admin = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

type Admin = ReturnType<typeof admin>;

async function loadPage(sb: Admin, slug: string) {
  if (!SLUG_RE.test(slug)) return null;
  const { data: page } = await sb
    .from('booking_pages')
    .select('id, user_id, slug, title, is_active, durations, work_start_min, work_end_min, work_days, buffer_min, min_notice_min, horizon_days, time_zone')
    .eq('slug', slug)
    .maybeSingle();
  if (!page || !page.is_active) return null;
  const { data: host } = await sb.from('profiles').select('id, name, time_zone').eq('id', page.user_id).maybeSingle();
  if (!host) return null;
  const zone = [page.time_zone, host.time_zone, 'Asia/Kolkata'].find((z) => z && isValidTimeZone(z)) as string;
  return { page, host, zone, rules: normaliseRules(page) };
}

/** Everything that already holds the host's time, as instants. */
async function loadBusy(sb: Admin, hostId: string, zone: string, horizonDays: number, now: number): Promise<Interval[]> {
  const today = zonedParts(now, zone).date;
  const [{ data: events, error: evErr }, { data: bookings, error: bkErr }] = await Promise.all([
    sb
      .from('day_events')
      .select('id, user_id, date, start_min, end_min, kind, invitee_id, confirmed_at, created_by, integration_grant_id, external_event_id')
      .or(`user_id.eq.${hostId},user_id.is.null,invitee_id.eq.${hostId}`)
      .gte('date', addDays(today, -1))
      .lte('date', addDays(today, horizonDays + 1)),
    sb
      .from('bookings')
      .select('start_at, end_at, status')
      .eq('host_id', hostId)
      .in('status', ['pending', 'confirmed'])
      .gt('end_at', new Date(now).toISOString()),
  ]);
  // Fail closed: offering slots over a calendar we could not read is how a
  // double booking happens.
  if (evErr || bkErr) throw new Error(evErr?.message ?? bkErr?.message);
  return [
    ...availabilityBusy(events ?? [], hostId).map((e) => eventInterval(e, zone)),
    ...bookingIntervals((bookings ?? []) as any),
  ];
}

async function hashIp(req: Request): Promise<string | null> {
  const ip =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '';
  if (!ip) return null;
  const salt = Deno.env.get('ORRA_INTERNAL_SECRET') ?? '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Ping the host. Best effort: a booking that saved must not report failure
 *  because a phone was offline. */
async function notifyHost(hostId: string, name: string, startIso: string, zone: string) {
  const secret = Deno.env.get('ORRA_INTERNAL_SECRET');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!secret) return;
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(startIso));
  try {
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // The anon key only gets the request past the gateway's JWT check;
        // x-orra-internal is what `push` actually trusts.
        ...(anon ? { Authorization: `Bearer ${anon}`, apikey: anon } : {}),
        'x-orra-internal': secret,
      },
      body: JSON.stringify({
        user_id: hostId,
        title: 'New booking request',
        body: `${name} · ${when}. Confirm or decline in Personal.`,
        url: '/personal',
        tag: 'booking',
        kind: 'booking',
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* the calendar block is already there; the push is a courtesy */
  }
}

async function handleGet(url: URL) {
  const sb = admin();
  const found = await loadPage(sb, (url.searchParams.get('slug') ?? '').toLowerCase());
  if (!found) return NOT_FOUND();
  const { page, host, zone, rules } = found;
  const now = Date.now();
  const busy = await loadBusy(sb, host.id, zone, rules.horizon_days, now);
  const slots: Record<string, Slot[]> = {};
  for (const duration of rules.durations) {
    slots[duration] = computeSlots({ rules, timeZone: zone, duration, busy, now });
  }
  return json({
    slug: page.slug,
    title: page.title,
    host: firstName(host.name),
    timeZone: zone,
    durations: rules.durations,
    slots,
  });
}

async function handlePost(req: Request) {
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413);
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'bad_request', message: 'Body must be JSON.' }, 400);
  }
  const guest = validateGuest({ name: body?.name, email: body?.email, note: body?.note });
  if (!guest.ok) return json({ error: 'invalid', message: guest.error }, 400);
  const duration = Number(body?.duration);
  const start = Date.parse(String(body?.start ?? ''));
  if (!Number.isInteger(duration) || duration < CAPS.durationMin || duration > CAPS.durationMax || !Number.isFinite(start)) {
    return json({ error: 'invalid', message: 'Pick a time from the list.' }, 400);
  }

  const sb = admin();
  const found = await loadPage(sb, String(body?.slug ?? '').toLowerCase());
  if (!found) return NOT_FOUND();
  const { page, host, zone, rules } = found;
  if (!rules.durations.includes(duration)) return json({ error: 'invalid', message: 'That length is not offered.' }, 400);

  const now = Date.now();
  const busy = await loadBusy(sb, host.id, zone, rules.horizon_days, now);
  const startIso = new Date(start).toISOString();
  if (!isSlotOffered({ rules, timeZone: zone, duration, busy, now }, startIso)) {
    return json({ error: 'slot_taken', message: 'That time was just taken. Here are the times still open.' }, 409);
  }

  const { data, error } = await sb.rpc('book_slot', {
    p_page_id: page.id,
    p_start: startIso,
    p_end: new Date(start + duration * 60_000).toISOString(),
    p_name: guest.value.name,
    p_email: guest.value.email,
    p_note: guest.value.note,
    p_ip_hash: await hashIp(req),
    p_time_zone: zone,
  });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('slot_taken')) return json({ error: 'slot_taken', message: 'That time was just taken. Here are the times still open.' }, 409);
    if (msg.includes('rate_limited')) return json({ error: 'rate_limited', message: 'Too many requests for now. Please try again tomorrow.' }, 429);
    if (msg.includes('page_inactive')) return NOT_FOUND();
    console.error('[book] book_slot failed:', msg);
    return json({ error: 'server', message: 'Something went wrong on our side. Please try again.' }, 500);
  }

  await notifyHost(host.id, guest.value.name, startIso, zone);
  const row = Array.isArray(data) ? data[0] : data;
  return json({
    ok: true,
    id: row?.out_booking_id ?? null,
    status: 'pending',
    start: startIso,
    end: new Date(start + duration * 60_000).toISOString(),
    host: firstName(host.name),
    timeZone: zone,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (req.method === 'GET') return await handleGet(new URL(req.url));
    if (req.method === 'POST') return await handlePost(req);
    return json({ error: 'method_not_allowed' }, 405);
  } catch (err) {
    console.error('[book] unexpected:', (err as Error)?.message);
    return json({ error: 'server', message: 'Something went wrong on our side. Please try again.' }, 500);
  }
});
