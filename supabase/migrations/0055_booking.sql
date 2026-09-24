-- ═══════════════════════════════════════════════════════════════════════
-- 0055 — a public page where someone outside can book time with you
--
-- ── booking_pages: one per person ──────────────────────────────────────
--
-- The rules a stranger's booking is checked against: which lengths, which
-- hours and days (in the host's zone), how much air around each meeting, how
-- much notice, how far ahead. Off by default — a page exists the moment you
-- open the settings card, but nobody can book it until you switch it on.
--
--   ics_token   a random secret. /functions/v1/ics?token=… serves your busy
--               time as a calendar feed so Google's "From URL" subscription
--               (and anything reading Google) sees ORRA blocks even with the
--               portal closed. The feed shows only "Busy (ORRA)", never
--               titles, because this URL is a bearer credential.
--   time_zone   the zone work hours are written in. NULL = profiles.time_zone.
--               The settings card fills it from the browser, because
--               day_events are stored as the wall clock of whoever made them.
--
-- Writes are owner-only (principle 2 is about capability, not visibility:
-- both people can do this, each for their own page). Reads are team-wide so
-- either can see the other's link.
--
-- ── bookings: what a guest asked for ───────────────────────────────────
--
-- Only the `book` edge function inserts, through public.book_slot() below,
-- which takes a per-host advisory lock so two guests racing for the same
-- slot cannot both get it. Nobody deletes: a declined booking keeps its row
-- so "who asked, and when" survives. Both people can read and update (confirm
-- or decline), matching every other shared table.
--
-- Rate limits live in the same locked function: 5 bookings per hashed IP per
-- day, 20 pending per host. The IP is hashed in the edge function with a
-- server secret; the raw address is never stored.
--
-- Every cap is the server-side half of the security gate. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── booking_pages ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.booking_pages (
  id              TEXT PRIMARY KEY,
  user_id         UUID NOT NULL UNIQUE REFERENCES public.profiles (id) ON DELETE CASCADE,
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL DEFAULT 'Book a call',
  is_active       BOOLEAN NOT NULL DEFAULT false,
  durations       INT[] NOT NULL DEFAULT '{30}',
  work_start_min  INT NOT NULL DEFAULT 600,
  work_end_min    INT NOT NULL DEFAULT 1080,
  work_days       INT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  buffer_min      INT NOT NULL DEFAULT 10,
  min_notice_min  INT NOT NULL DEFAULT 240,
  horizon_days    INT NOT NULL DEFAULT 21,
  time_zone       TEXT,
  ics_token       TEXT NOT NULL UNIQUE
                    DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.booking_pages DROP CONSTRAINT IF EXISTS booking_pages_slug_shape;
ALTER TABLE public.booking_pages ADD CONSTRAINT booking_pages_slug_shape
  CHECK (slug ~ '^[a-z0-9-]{3,40}$');
ALTER TABLE public.booking_pages DROP CONSTRAINT IF EXISTS booking_pages_title_bounded;
ALTER TABLE public.booking_pages ADD CONSTRAINT booking_pages_title_bounded
  CHECK (char_length(title) BETWEEN 1 AND 120);
ALTER TABLE public.booking_pages DROP CONSTRAINT IF EXISTS booking_pages_durations_bounded;
ALTER TABLE public.booking_pages ADD CONSTRAINT booking_pages_durations_bounded
  -- 1–6 lengths, each 10 minutes to 4 hours.
  -- (No subquery: CHECK constraints may not contain one.)
  CHECK (cardinality(durations) BETWEEN 1 AND 6
         AND array_position(durations, NULL) IS NULL
         AND 10 <= ALL (durations) AND 240 >= ALL (durations));
ALTER TABLE public.booking_pages DROP CONSTRAINT IF EXISTS booking_pages_hours_bounded;
ALTER TABLE public.booking_pages ADD CONSTRAINT booking_pages_hours_bounded
  CHECK (work_start_min BETWEEN 0 AND 1439 AND work_end_min BETWEEN 1 AND 1440
         AND work_end_min > work_start_min);
ALTER TABLE public.booking_pages DROP CONSTRAINT IF EXISTS booking_pages_days_bounded;
ALTER TABLE public.booking_pages ADD CONSTRAINT booking_pages_days_bounded
  -- ISO weekdays, 1 = Monday … 7 = Sunday. Empty is allowed: "no days" is a
  -- legitimate pause that keeps the link alive.
  CHECK (cardinality(work_days) <= 7 AND array_position(work_days, NULL) IS NULL
         AND work_days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]);
ALTER TABLE public.booking_pages DROP CONSTRAINT IF EXISTS booking_pages_rules_bounded;
ALTER TABLE public.booking_pages ADD CONSTRAINT booking_pages_rules_bounded
  CHECK (buffer_min BETWEEN 0 AND 120
         AND min_notice_min BETWEEN 0 AND 20160
         AND horizon_days BETWEEN 1 AND 60);
ALTER TABLE public.booking_pages DROP CONSTRAINT IF EXISTS booking_pages_tz_bounded;
ALTER TABLE public.booking_pages ADD CONSTRAINT booking_pages_tz_bounded
  CHECK (time_zone IS NULL OR char_length(time_zone) BETWEEN 1 AND 64);
ALTER TABLE public.booking_pages DROP CONSTRAINT IF EXISTS booking_pages_token_bounded;
ALTER TABLE public.booking_pages ADD CONSTRAINT booking_pages_token_bounded
  -- Long enough that guessing one is not a strategy.
  CHECK (char_length(ics_token) BETWEEN 32 AND 128);

ALTER TABLE public.booking_pages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_read ON public.booking_pages;
CREATE POLICY team_read ON public.booking_pages FOR SELECT
  USING (public.is_team_member());
DROP POLICY IF EXISTS own_write ON public.booking_pages;
CREATE POLICY own_write ON public.booking_pages FOR ALL
  USING (public.is_team_member() AND user_id = auth.uid())
  WITH CHECK (public.is_team_member() AND user_id = auth.uid());

-- ── bookings ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bookings (
  id            TEXT PRIMARY KEY,
  page_id       TEXT NOT NULL REFERENCES public.booking_pages (id) ON DELETE CASCADE,
  host_id       UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  guest_name    TEXT NOT NULL,
  guest_email   TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  start_at      TIMESTAMPTZ NOT NULL,
  end_at        TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  day_event_id  TEXT REFERENCES public.day_events (id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_hash       TEXT
);

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled'));
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_guest_bounded;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_guest_bounded
  CHECK (char_length(guest_name) BETWEEN 1 AND 120
         AND char_length(guest_email) BETWEEN 3 AND 200
         AND guest_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
         AND char_length(note) <= 1000);
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_span_bounded;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_span_bounded
  CHECK (end_at > start_at AND end_at - start_at <= interval '4 hours');
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_ip_hash_bounded;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_ip_hash_bounded
  CHECK (ip_hash IS NULL OR char_length(ip_hash) <= 128);

CREATE INDEX IF NOT EXISTS idx_bookings_host_start ON public.bookings (host_id, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_ip_recent ON public.bookings (ip_hash, created_at);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_read ON public.bookings;
CREATE POLICY team_read ON public.bookings FOR SELECT
  USING (public.is_team_member());
DROP POLICY IF EXISTS team_update ON public.bookings;
CREATE POLICY team_update ON public.bookings FOR UPDATE
  USING (public.is_team_member()) WITH CHECK (public.is_team_member());
-- No INSERT or DELETE policy: a signed-in client can do neither. Belt and
-- braces, because 0003 granted ALL on future tables to `authenticated`.
REVOKE INSERT, DELETE ON public.bookings FROM authenticated, anon, PUBLIC;

-- ── book_slot(): the only way a booking is written ─────────────────────
--
-- Everything that must be true at the moment of the write is checked here,
-- under a per-host transaction lock, so the edge function's earlier slot
-- computation is a fast pre-check and this is the truth:
--   · the page exists and is active
--   · the IP has not booked 5 times today, the host has < 20 pending
--   · nothing live overlaps [start - buffer, end + buffer): no pending or
--     confirmed booking, and no host day_event other than a reminder
-- Then the booking AND the host's calendar block are written together.
--
-- Raises with a machine-readable message the function maps to an HTTP code:
-- page_inactive · rate_limited_ip · rate_limited_host · slot_taken.
CREATE OR REPLACE FUNCTION public.book_slot(
  p_page_id    TEXT,
  p_start      TIMESTAMPTZ,
  p_end        TIMESTAMPTZ,
  p_name       TEXT,
  p_email      TEXT,
  p_note       TEXT,
  p_ip_hash    TEXT,
  p_time_zone  TEXT
) RETURNS TABLE (out_booking_id TEXT, out_day_event_id TEXT)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  pg          public.booking_pages%ROWTYPE;
  buf         INTERVAL;
  local_start TIMESTAMP;
  local_end   TIMESTAMP;
  new_booking TEXT := 'bk-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  new_event   TEXT := 'ev-bk-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  event_note  TEXT;
BEGIN
  SELECT * INTO pg FROM public.booking_pages WHERE id = p_page_id;
  IF NOT FOUND OR NOT pg.is_active THEN
    RAISE EXCEPTION 'page_inactive';
  END IF;

  -- One booking at a time per host. Transaction-scoped: released on commit.
  PERFORM pg_advisory_xact_lock(hashtextextended('orra-book:' || pg.user_id::text, 0));

  IF p_ip_hash IS NOT NULL AND (
       SELECT count(*) FROM public.bookings
        WHERE ip_hash = p_ip_hash AND created_at > now() - interval '1 day') >= 5 THEN
    RAISE EXCEPTION 'rate_limited_ip';
  END IF;
  IF (SELECT count(*) FROM public.bookings
       WHERE host_id = pg.user_id AND status = 'pending' AND end_at > now()) >= 20 THEN
    RAISE EXCEPTION 'rate_limited_host';
  END IF;

  buf := make_interval(mins => pg.buffer_min);

  IF EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.host_id = pg.user_id
       AND b.status IN ('pending', 'confirmed')
       AND b.start_at < p_end + buf AND p_start - buf < b.end_at
  ) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  local_start := p_start AT TIME ZONE p_time_zone;
  local_end   := p_end AT TIME ZONE p_time_zone;

  IF EXISTS (
    SELECT 1 FROM public.day_events e
     WHERE (e.user_id = pg.user_id OR e.user_id IS NULL OR e.invitee_id = pg.user_id)
       AND e.kind <> 'reminder'
       AND e.date BETWEEN local_start::date - 1 AND local_end::date + 1
       AND ((e.date + make_interval(mins => e.start_min)) AT TIME ZONE p_time_zone) < p_end + buf
       AND p_start - buf < ((e.date + make_interval(mins => e.end_min)) AT TIME ZONE p_time_zone)
  ) THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  -- A meeting that crosses the host's midnight cannot be one day_event row.
  -- Work hours make this impossible from the UI; refuse it rather than
  -- writing a block that lies about its end.
  IF local_end::date <> local_start::date AND local_end::time <> '00:00' THEN
    RAISE EXCEPTION 'slot_taken';
  END IF;

  event_note := left(
    'Booked through your ORRA page by ' || p_name || ' <' || p_email || '>'
      || CASE WHEN coalesce(p_note, '') <> '' THEN E'\n\n' || p_note ELSE '' END,
    2000);

  INSERT INTO public.day_events (id, user_id, date, start_min, end_min, label, kind, created_by, note)
  VALUES (
    new_event,
    pg.user_id,
    local_start::date,
    extract(hour FROM local_start)::int * 60 + extract(minute FROM local_start)::int,
    CASE WHEN local_end::date > local_start::date THEN 1440
         ELSE extract(hour FROM local_end)::int * 60 + extract(minute FROM local_end)::int END,
    left('Booking: ' || p_name, 200),
    'meeting',
    NULL,
    event_note
  );

  INSERT INTO public.bookings (id, page_id, host_id, guest_name, guest_email, note, start_at, end_at, status, day_event_id, ip_hash)
  VALUES (new_booking, pg.id, pg.user_id, p_name, p_email, coalesce(p_note, ''), p_start, p_end, 'pending', new_event, p_ip_hash);

  out_booking_id := new_booking;
  out_day_event_id := new_event;
  RETURN NEXT;
END
$fn$;

-- Only the edge function (service role) may call it.
REVOKE ALL ON FUNCTION public.book_slot(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_slot(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO service_role;

-- ── refuse to half-apply ───────────────────────────────────────────────
DO $mig$
BEGIN
  IF to_regclass('public.booking_pages') IS NULL OR to_regclass('public.bookings') IS NULL THEN
    RAISE EXCEPTION 'booking tables were not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'booking_pages' AND column_name = 'ics_token'
  ) THEN
    RAISE EXCEPTION 'booking_pages.ics_token is missing';
  END IF;
  IF has_function_privilege('anon', 'public.book_slot(text, timestamptz, timestamptz, text, text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'book_slot must not be callable by anon';
  END IF;
  -- day_events.kind must still accept the block book_slot writes.
  IF NOT (SELECT pg_get_constraintdef(oid) LIKE '%meeting%'
            FROM pg_constraint
           WHERE conrelid = 'public.day_events'::regclass AND conname = 'day_events_kind_check') THEN
    RAISE EXCEPTION 'day_events.kind no longer accepts meeting';
  END IF;

  RAISE NOTICE 'booking ready: pages, bookings and a locked book_slot()';
END
$mig$;

COMMIT;
