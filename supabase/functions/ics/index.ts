/**
 * Your ORRA busy time as a calendar feed.
 *
 *   GET ?token=<booking_pages.ics_token>  → text/calendar
 *
 * Google Calendar → Other calendars → From URL. Google then polls this and
 * treats every block as busy, so its appointment pages (and anything else
 * that reads Google free/busy) stop offering time ORRA already holds — even
 * while the portal is closed, which the in-browser push (lib/calendarPush)
 * cannot cover.
 *
 * Privacy: the token is a bearer secret and the URL will sit in someone's
 * Google settings indefinitely, so the feed says WHEN and never WHAT. Every
 * event is "Busy (ORRA)"; there is deliberately no switch to show titles.
 * Rotating the token (settings card) kills an old URL.
 *
 * Window: 7 days back (so a just-finished meeting does not vanish mid-day
 * for someone looking at today), 60 ahead.
 *
 * Deploy:  npx supabase functions deploy ics --no-verify-jwt
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { addDays, buildIcs, icsBusy, isValidTimeZone, zonedParts } from '../../../src/lib/booking.ts';

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return text('GET only', 405);
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!TOKEN_RE.test(token)) return text('Not found', 404);

  // Service role because the caller is Google's fetcher, with no session:
  // this is the one read it needs to make on the host's behalf, scoped to
  // the single page whose secret token it presented, and it returns nothing
  // but start/end instants.
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: page } = await sb.from('booking_pages').select('user_id, time_zone').eq('ics_token', token).maybeSingle();
  if (!page) return text('Not found', 404);
  const { data: host } = await sb.from('profiles').select('time_zone').eq('id', page.user_id).maybeSingle();
  const zone = [page.time_zone, host?.time_zone, 'Asia/Kolkata'].find((z) => z && isValidTimeZone(z)) as string;

  const now = Date.now();
  const today = zonedParts(now, zone).date;
  const hostId = page.user_id as string;
  const { data: events, error } = await sb
    .from('day_events')
    .select('id, user_id, date, start_min, end_min, kind, invitee_id, confirmed_at, created_by, integration_grant_id, external_event_id')
    .or(`user_id.eq.${hostId},user_id.is.null,invitee_id.eq.${hostId}`)
    .gte('date', addDays(today, -7))
    .lte('date', addDays(today, 60));
  // A failed read must not publish an empty calendar: Google would take that
  // as "free all week" and clear every block it had.
  if (error) return text('Temporarily unavailable', 503);

  const body = buildIcs(icsBusy(events ?? [], hostId), { timeZone: zone, now });
  return new Response(req.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="orra-busy.ics"',
      'Cache-Control': 'private, max-age=300',
    },
  });
});
