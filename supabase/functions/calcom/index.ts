/**
 * Cal.com → your phone.
 *
 * Cal.com is the one booking system (it reads Google Calendar itself, live,
 * so it never double-books against a meeting ORRA has not synced yet). What it
 * cannot do on its own is reach ORRA: a booking arrived as an email and
 * nothing buzzed. Cal.com calls this webhook on every booking, reschedule and
 * cancellation; this turns each into a push to the host's devices.
 *
 * It also puts the booking on the host's ORRA calendar, straight away. The
 * Google mirror could do that too, but only while ORRA is open and its Google
 * token is fresh (an hour), so a booking often never appeared. To keep it to
 * one copy:
 *   · the row is id `calcom-<uid>` with external_event_id `calcom:<uid>` and
 *     no integration_grant_id — calendarPush skips anything with an
 *     external_event_id, so it is never copied back into Google, and the busy
 *     feed skips it too (Cal.com already knows its own bookings);
 *   · any Google mirror of the same meeting already in ORRA is removed here,
 *     and googleSync skips a Google event that matches a calcom row.
 *
 * Who is calling: the URL carries the host's secret feed token (the same one
 * the busy feed uses — booking_pages.ics_token), which is how the host is
 * found. It is a public endpoint for Cal.com's servers; the token is the key.
 *
 * Deploy: npx supabase functions deploy calcom --no-verify-jwt
 */
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isValidTimeZone, zonedParts } from '../_shared/booking.ts';

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
  // up by the secret token it presented. Writes only the host's own
  // `calcom-*` calendar rows (and removes a Google mirror of the same one).
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

  const uid = String(p.uid ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
  if (uid) {
    const guestEmail = String(p.attendees?.[0]?.email ?? '').slice(0, 200);
    // A reschedule arrives with the new uid and the old one in rescheduleUid
    // (older payloads: fromReschedule); the old block has to go either way.
    const oldUid = String(p.rescheduleUid ?? p.fromReschedule ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60);
    if (trigger === 'BOOKING_CANCELLED') {
      await sb.from('day_events').delete().eq('id', `calcom-${uid}`);
    } else {
      if (oldUid && oldUid !== uid) await sb.from('day_events').delete().eq('id', `calcom-${oldUid}`);
      const start = zonedParts(Date.parse(String(p.startTime)), zone);
      const endMs = Date.parse(String(p.endTime ?? p.startTime));
      const end = zonedParts(endMs, zone);
      // Wall-clock minutes on the start day; a meeting past midnight is shown
      // to the end of that day rather than split.
      const endMin = end.date === start.date ? Math.max(end.minutes, start.minutes + 5) : 1440;
      const row = {
        id: `calcom-${uid}`,
        user_id: page.user_id,
        date: start.date,
        start_min: start.minutes,
        end_min: Math.min(endMin, 1440),
        label: `${guest} — ${title}`.slice(0, 200),
        kind: 'meeting',
        task_id: null,
        created_by: page.user_id,
        external_event_id: `calcom:${uid}`,
        note: `Booked through Cal.com${guestEmail ? ` by ${guestEmail}` : ''}${trigger === 'BOOKING_REQUESTED' ? ' — waiting for your confirmation in Cal.com' : ''}.`,
      };
      const { error } = await sb.from('day_events').upsert(row, { onConflict: 'id' });
      if (!error) {
        // The same meeting may already be in ORRA as a Google mirror.
        await sb
          .from('day_events')
          .delete()
          .eq('user_id', page.user_id)
          .eq('date', row.date)
          .eq('start_min', row.start_min)
          .eq('end_min', row.end_min)
          .not('integration_grant_id', 'is', null);
      }
    }
  }

  await notify(page.user_id, line[0], line[1], `orra-calcom-${uid.slice(0, 40)}`);
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
