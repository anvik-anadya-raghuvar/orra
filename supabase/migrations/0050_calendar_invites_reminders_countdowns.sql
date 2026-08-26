-- ═══════════════════════════════════════════════════════════════════════
-- 0050 — block time WITH somebody, be reminded, and count down to things
--
-- Three asks that are all the calendar, so they extend the two tables the
-- calendar already has rather than inventing a third and a fourth.
--
-- ── day_events: you can now tag the other person ───────────────────────
--
-- `user_id` already said whose block it is (NULL = shared). What it could not
-- say is "this one is with YOU" — the difference between blocking two hours to
-- write, and blocking twenty minutes to talk to Raghuvar. So:
--
--   invitee_id   who it is with. NULL for a solo block, which is most of them.
--   confirmed_at when they said yes. NULL = they have not yet.
--   created_by   who proposed it, so "waiting on them" and "waiting on me" are
--                distinguishable without guessing from user_id.
--
-- The invite APPEARS on both calendars immediately and is marked unconfirmed
-- until accepted, rather than hiding until accepted. Two people who already
-- share a workspace do not need an RSVP gate to see that a time was suggested;
-- they need to see it, and to see that it is not agreed yet.
--
-- `kind` gains 'call' and 'reminder'. 'call' because "talk at 4" is the whole
-- point of tagging somebody, and it reads differently from a meeting. And
-- 'reminder' because a reminder IS a calendar event — a thing at a time that
-- should ping you — and giving it its own table would mean a second calendar
-- to merge into every view that already reads this one.
--
--   remind_min_before  minutes ahead to ping. NULL = no reminder. 0 = at the
--                      time itself, which is what a bare reminder wants.
--   reminded_at        set when the ping goes out, so it fires once. It is a
--                      timestamp rather than a boolean because "when did this
--                      fire" is the first question when one does not arrive.
--
-- ── fixed_dates: countdowns ────────────────────────────────────────────
--
-- Already the right table — a label and a date is exactly a countdown, and
-- Home already reads the nearest one. It gains ownership and a pin so a
-- countdown can be shared, and so Home can show the ones you chose rather
-- than only the single next one.
--
--   owner_id     NULL = both of you. Matches day_events' convention exactly.
--   created_by   who added it.
--   pinned_home  show it on Home as a countdown.
--   note         optional, because "why does this date matter" fades fast.
--
-- Every cap is the server-side half of the security gate. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── day_events ─────────────────────────────────────────────────────────
ALTER TABLE public.day_events
  ADD COLUMN IF NOT EXISTS invitee_id        UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by        UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS remind_min_before INT,
  ADD COLUMN IF NOT EXISTS reminded_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS note              TEXT;

ALTER TABLE public.day_events DROP CONSTRAINT IF EXISTS day_events_kind_check;
ALTER TABLE public.day_events DROP CONSTRAINT IF EXISTS day_events_kind_check1;
ALTER TABLE public.day_events ADD CONSTRAINT day_events_kind_check
  CHECK (kind IN ('focus', 'meeting', 'study', 'admin', 'personal', 'call', 'reminder'));

ALTER TABLE public.day_events DROP CONSTRAINT IF EXISTS day_events_remind_bounded;
ALTER TABLE public.day_events ADD CONSTRAINT day_events_remind_bounded
  -- Up to a week ahead. Longer than that is a countdown, not a reminder.
  CHECK (remind_min_before IS NULL OR remind_min_before BETWEEN 0 AND 10080);

ALTER TABLE public.day_events DROP CONSTRAINT IF EXISTS day_events_note_bounded;
ALTER TABLE public.day_events ADD CONSTRAINT day_events_note_bounded
  CHECK (note IS NULL OR char_length(note) <= 2000);

-- "What is on my calendar" now includes what somebody put there for me.
CREATE INDEX IF NOT EXISTS idx_day_events_invitee ON public.day_events (invitee_id, date);
-- The reminder sweep asks only for events that still owe a ping.
CREATE INDEX IF NOT EXISTS idx_day_events_pending_reminder
  ON public.day_events (date) WHERE remind_min_before IS NOT NULL AND reminded_at IS NULL;

-- ── fixed_dates ────────────────────────────────────────────────────────
ALTER TABLE public.fixed_dates
  ADD COLUMN IF NOT EXISTS owner_id    UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by  UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pinned_home BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS note        TEXT;

ALTER TABLE public.fixed_dates DROP CONSTRAINT IF EXISTS fixed_dates_note_bounded;
ALTER TABLE public.fixed_dates ADD CONSTRAINT fixed_dates_note_bounded
  CHECK (note IS NULL OR char_length(note) <= 500);

ALTER TABLE public.fixed_dates DROP CONSTRAINT IF EXISTS cap_fixed_dates_label;
ALTER TABLE public.fixed_dates ADD CONSTRAINT cap_fixed_dates_label
  CHECK (char_length(label) BETWEEN 1 AND 200);

CREATE INDEX IF NOT EXISTS idx_fixed_dates_pinned ON public.fixed_dates (date) WHERE pinned_home;

-- ── refuse to half-apply ───────────────────────────────────────────────
DO $mig$
DECLARE
  missing int;
BEGIN
  SELECT 6 - count(*) INTO missing
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'day_events'
     AND column_name IN ('invitee_id', 'confirmed_at', 'created_by', 'remind_min_before', 'reminded_at', 'note');
  IF missing <> 0 THEN
    RAISE EXCEPTION 'day_events is missing % of the 6 new columns', missing;
  END IF;

  SELECT 4 - count(*) INTO missing
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'fixed_dates'
     AND column_name IN ('owner_id', 'created_by', 'pinned_home', 'note');
  IF missing <> 0 THEN
    RAISE EXCEPTION 'fixed_dates is missing % of the 4 new columns', missing;
  END IF;

  -- A 'call' that the CHECK still rejects would fail silently at the first
  -- save rather than here, which is the wrong place to find out.
  IF NOT (SELECT pg_get_constraintdef(oid) LIKE '%call%'
            FROM pg_constraint
           WHERE conrelid = 'public.day_events'::regclass AND conname = 'day_events_kind_check') THEN
    RAISE EXCEPTION 'day_events.kind still rejects call/reminder';
  END IF;

  RAISE NOTICE 'calendar widened: invites, reminders and countdowns are storable';
END
$mig$;

COMMIT;
