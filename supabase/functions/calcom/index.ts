/**
 * Cal.com → your phone.
 *
 * Cal.com is the one booking system (it reads Google Calendar itself, live,
 * so it never double-books against a meeting ORRA has not synced yet). What it
 * cannot do on its own is reach ORRA: a booking arrived as an email and
 * nothing buzzed. Cal.com calls this webhook on every booking, reschedule and
 * cancellation; this turns each into a push to the host's devices.
 *
 * Deliberately NOT a calendar write. The booking is already in Google (Cal.com
 * put it there), and ORRA's Google sync mirrors it into the ORRA calendar;
 * writing a day_events row here too would show every booking twice — and the
 * Google push would copy that row back into Google a second time.
 *
 * Who is calling: the URL carries the host's secret feed token (the same one
 * the busy feed uses — booking_pages.ics_token), which is how the host is
 * found. It is a public endpoint for Cal.com's servers; the token is the key.
 *
 * Deploy: npx supabase functions deploy calcom --no-verify-jwt
 */
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isValidTimeZone } from '../_shared/booking.ts';

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** "Thu 25 Sep, 15:30" in the host's own zone. */
function when(iso: string, zone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!TOKEN_RE.test(token)) return json({ error: 'not found' }, 404);

  let event: any;
  try {
    const raw = await req.text();
    if (raw.length > 100_000) return json({ error: 'too large' }, 413);
    event = JSON.parse(raw);
  } catch {
    return json({ error: 'body must be JSON' }, 400);
  }

  // Service role: Cal.com has no ORRA session, and the host must be looked
  // up by the secret token it presented. Reads one row, writes nothing.
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data: page } = await sb.from('booking_pages').select('user_id, time_zone').eq('ics_token', token).maybeSingle();
  if (!page) return json({ error: 'not found' }, 404);
  const { data: host } = await sb.from('profiles').select('time_zone').eq('id', page.user_id).maybeSingle();
  const zone = [page.time_zone, host?.time_zone, 'Asia/Kolkata'].find((z) => z && isValidTimeZone(z)) as string;

  const trigger = String(event?.triggerEvent ?? '');
  const p = event?.payload ?? {};
  // Cal.com's "Ping test" button sends no booking; answer it so setup shows green.
  if (trigger === 'PING' || !p.startTime) {
    await notify(page.user_id, 'Cal.com is connected', 'New bookings will buzz this device.', 'orra-calcom-test');
    return json({ ok: true, ping: true });
  }

  const guest = String(p.attendees?.[0]?.name ?? p.attendees?.[0]?.email ?? 'Someone').slice(0, 80);
  const title = String(p.title ?? p.eventTitle ?? 'Meeting').slice(0, 100);
  const at = when(String(p.startTime), zone);

  const lines: Record<string, [string, string]> = {
    BOOKING_CREATED: ['New booking', `${guest} · ${at} — ${title}`],
    BOOKING_REQUESTED: ['Booking request', `${guest} wants ${at} — confirm it in Cal.com`],
    BOOKING_RESCHEDULED: ['Booking moved', `${guest} moved it to ${at} — ${title}`],
    BOOKING_CANCELLED: ['Booking cancelled', `${guest} cancelled ${at} — ${title}`],
  };
  const line = lines[trigger];
  if (!line) return json({ ok: true, ignored: trigger || 'unknown' });

  await notify(page.user_id, line[0], line[1], `orra-calcom-${String(p.uid ?? '').slice(0, 40)}`);
  return json({ ok: true });
});

/** Through the push function, as the database does (x-orra-internal). */
async function notify(userId: string, title: string, body: string, tag: string) {
  const secret = Deno.env.get('ORRA_INTERNAL_SECRET');
  if (!secret) return;
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-orra-internal': secret },
    body: JSON.stringify({ user_id: userId, title, body, url: '/personal', tag, kind: 'booking' }),
  }).catch(() => {});
}
