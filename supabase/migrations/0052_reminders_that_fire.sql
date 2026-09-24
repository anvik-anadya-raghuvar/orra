-- ═══════════════════════════════════════════════════════════════════════
-- 0052 — reminders that actually fire, and a digest that actually sends
--
-- An audit on 2026-09-24 found every path from "something is due" to "your
-- phone buzzes" broken at once:
--
--   · Calendar reminders (0050) were stored and never sent. `dueReminders()`
--     in src/lib/calendar.ts had no caller, and nothing on the server looked.
--   · The morning digest (0040) read two settings, app.push_function_url and
--     app.push_service_key, that were never set -- Supabase does not let a
--     project owner set custom GUCs on the database any more -- so the cron
--     job "succeeded" 33 mornings running and sent nothing.
--   · The digest counted tasks by `assignee_id` only, so a task you were the
--     second assignee on (0045) was in the bell but not in the digest.
--   · Anyone holding the public anon key could call the SECURITY DEFINER
--     digest functions through /rpc.
--
-- What this does:
--
--   1. Reads the push function URL and a shared internal secret from Supabase
--      Vault (`orra_push_url`, `orra_internal_secret`) instead of GUCs. The
--      secret is the same value as the push function's ORRA_INTERNAL_SECRET,
--      and it is what lets the database call that function without a user.
--      The values are set out of band (never in a migration file):
--        select vault.create_secret('<url>',    'orra_push_url');
--        select vault.create_secret('<secret>', 'orra_internal_secret');
--   2. Adds tasks.remind_at / tasks.reminded_at, so a task can ping you at a
--      time -- not only a calendar block.
--   3. send_due_reminders(): every minute, pings whoever a calendar reminder
--      or a task reminder belongs to, once, and stamps reminded_at. Calendar
--      times are wall-clock minutes in their creator's time zone (one of you
--      is in India and one in Italy), so each event is read in that zone.
--      Anything more than an hour late is dropped rather than arriving stale,
--      matching dueReminders().
--   4. The digest now fires at 07:30 in EACH person's own time zone rather
--      than 02:00 UTC for both (which was 04:00 in Italy), at most once a day.
--   5. EXECUTE on all of these is revoked from public/anon/authenticated.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- ── task reminders ─────────────────────────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS remind_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tasks_pending_reminder
  ON public.tasks (remind_at) WHERE remind_at IS NOT NULL AND reminded_at IS NULL;

-- ── one digest per person per local day ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_digest_sent (
  user_id   UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  local_day DATE NOT NULL,
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, local_day)
);
ALTER TABLE public.push_digest_sent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_read ON public.push_digest_sent;
CREATE POLICY team_read ON public.push_digest_sent FOR SELECT USING (public.is_team_member());

-- ── the one place the database calls the push function ────────────────
CREATE OR REPLACE FUNCTION public.orra_push(
  p_user UUID, p_title TEXT, p_body TEXT, p_url TEXT, p_tag TEXT, p_kind TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  fn_url TEXT;
  fn_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO fn_url FROM vault.decrypted_secrets WHERE name = 'orra_push_url';
  SELECT decrypted_secret INTO fn_secret FROM vault.decrypted_secrets WHERE name = 'orra_internal_secret';
  IF fn_url IS NULL OR fn_secret IS NULL THEN
    -- Loud, not silent: this is exactly the failure that hid for a month.
    RAISE WARNING 'orra_push: vault secrets orra_push_url / orra_internal_secret are not set';
    RETURN false;
  END IF;

  PERFORM net.http_post(
    url     := fn_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-orra-internal', fn_secret
               ),
    body    := jsonb_build_object(
                 'user_id', p_user,
                 'title', left(p_title, 200),
                 'body', left(coalesce(p_body, ''), 500),
                 'url', coalesce(p_url, '/'),
                 'tag', coalesce(p_tag, 'orra'),
                 'kind', coalesce(p_kind, 'reminder')
               )
  );
  RETURN true;
END;
$$;

-- ── digest: same sentence, multi-assignee aware ────────────────────────
CREATE OR REPLACE FUNCTION public.attention_digest(p_user UUID, p_today DATE)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH counts AS (
    SELECT
      (SELECT count(*) FROM public.tasks t
        WHERE (t.assignee_id = p_user OR t.assignee_ids @> jsonb_build_array(p_user::text))
          AND t.status <> 'done'
          AND t.due_date IS NOT NULL
          AND t.due_date::date <= p_today)                                  AS tasks,
      (SELECT count(*) FROM public.fixed_dates f
        WHERE (f.owner_id IS NULL OR f.owner_id = p_user)
          AND f.date::date BETWEEN p_today AND p_today + 7)                 AS dates,
      (SELECT count(*) FROM public.ledger l
        WHERE l.status IN ('due', 'overdue'))                               AS money,
      (SELECT count(*) FROM public.subscriptions s
        WHERE s.is_active
          AND s.ends_on IS NOT NULL
          AND s.ends_on::date BETWEEN p_today AND p_today + 3)              AS renewals
  )
  SELECT CASE
    WHEN tasks + dates + money + renewals = 0 THEN NULL
    ELSE array_to_string(ARRAY[
      CASE WHEN tasks > 0 THEN tasks || ' task' || CASE WHEN tasks = 1 THEN '' ELSE 's' END || ' due' END,
      CASE WHEN dates > 0 THEN dates || ' date' || CASE WHEN dates = 1 THEN '' ELSE 's' END || ' coming up' END,
      CASE WHEN money + renewals > 0 THEN (money + renewals) || ' money item' || CASE WHEN money + renewals = 1 THEN '' ELSE 's' END END
    ]::text[], ' · ')
  END
  FROM counts;
$$;

-- Runs every 15 minutes; each person gets it in the first run at or after
-- 07:30 their time, once per local day.
CREATE OR REPLACE FUNCTION public.send_morning_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member RECORD;
  local_now TIMESTAMP;
  line TEXT;
BEGIN
  FOR member IN
    SELECT DISTINCT p.id, coalesce(nullif(p.time_zone, ''), 'Asia/Kolkata') AS tz
    FROM public.profiles p
    JOIN public.push_subscriptions s ON s.user_id = p.id AND s.expired_at IS NULL
  LOOP
    local_now := now() AT TIME ZONE member.tz;
    CONTINUE WHEN local_now::time < time '07:30' OR local_now::time >= time '10:00';

    INSERT INTO public.push_digest_sent (user_id, local_day)
    VALUES (member.id, local_now::date)
    ON CONFLICT DO NOTHING;
    CONTINUE WHEN NOT FOUND;  -- already sent today

    line := public.attention_digest(member.id, local_now::date);
    CONTINUE WHEN line IS NULL;  -- nothing due: say nothing at all

    PERFORM public.orra_push(member.id, 'Today', line, '/', 'orra-digest', 'digest');
  END LOOP;
END;
$$;

-- ── reminders ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_due_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ev RECORD;
  tk RECORD;
  who UUID;
  sent INTEGER := 0;
  hhmm TEXT;
BEGIN
  -- Calendar reminders. The candidate window is yesterday..tomorrow in UTC
  -- dates, which covers every time zone; the exact test is on fire_at.
  FOR ev IN
    SELECT e.*,
           ((e.date::date + make_interval(mins => e.start_min))
              AT TIME ZONE coalesce(nullif(tzp.time_zone, ''), 'Asia/Kolkata'))
             - make_interval(mins => e.remind_min_before) AS fire_at
    FROM public.day_events e
    LEFT JOIN public.profiles tzp ON tzp.id = coalesce(e.created_by, e.user_id)
    WHERE e.remind_min_before IS NOT NULL
      AND e.reminded_at IS NULL
      AND e.date::date BETWEEN current_date - 1 AND current_date + 1
    FOR UPDATE OF e SKIP LOCKED
  LOOP
    CONTINUE WHEN ev.fire_at > now();

    UPDATE public.day_events SET reminded_at = now() WHERE id = ev.id;
    -- More than an hour late: mark it spent, but do not send a stale ping.
    CONTINUE WHEN ev.fire_at < now() - interval '60 minutes';

    hhmm := lpad((ev.start_min / 60)::text, 2, '0') || ':' || lpad((ev.start_min % 60)::text, 2, '0');
    FOR who IN
      SELECT DISTINCT x FROM unnest(
        CASE WHEN ev.user_id IS NULL
             THEN ARRAY(SELECT id FROM public.profiles)
             ELSE ARRAY[ev.user_id, ev.invitee_id] END
      ) AS x WHERE x IS NOT NULL
    LOOP
      PERFORM public.orra_push(
        who,
        CASE WHEN ev.kind = 'reminder' THEN 'Reminder' ELSE 'Coming up at ' || hhmm END,
        ev.label || CASE WHEN ev.remind_min_before > 0 THEN ' · in ' || ev.remind_min_before || ' min' ELSE '' END,
        CASE WHEN ev.task_id IS NOT NULL THEN '/task/' || ev.task_id ELSE '/personal' END,
        'orra-rem-' || ev.id,
        'reminder'
      );
      sent := sent + 1;
    END LOOP;
  END LOOP;

  -- Task reminders: an absolute instant, so no time-zone arithmetic.
  FOR tk IN
    SELECT t.id, t.title, t.remind_at, t.assignee_id, t.assignee_ids, t.created_by
    FROM public.tasks t
    WHERE t.remind_at IS NOT NULL
      AND t.reminded_at IS NULL
      AND t.remind_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.tasks SET reminded_at = now() WHERE id = tk.id;
    CONTINUE WHEN tk.remind_at < now() - interval '60 minutes';

    FOR who IN
      SELECT DISTINCT x::uuid FROM (
        SELECT jsonb_array_elements_text(coalesce(tk.assignee_ids, '[]'::jsonb)) AS x
        UNION SELECT tk.assignee_id::text
      ) a WHERE x IS NOT NULL
    LOOP
      PERFORM public.orra_push(who, 'Reminder · ' || tk.id, tk.title, '/task/' || tk.id, 'orra-task-rem-' || tk.id, 'reminder');
      sent := sent + 1;
    END LOOP;
    -- Nobody assigned: remind whoever made it.
    IF jsonb_array_length(coalesce(tk.assignee_ids, '[]'::jsonb)) = 0 AND tk.assignee_id IS NULL AND tk.created_by IS NOT NULL THEN
      PERFORM public.orra_push(tk.created_by, 'Reminder · ' || tk.id, tk.title, '/task/' || tk.id, 'orra-task-rem-' || tk.id, 'reminder');
      sent := sent + 1;
    END IF;
  END LOOP;

  RETURN sent;
END;
$$;

-- ── nobody but cron (and the table owner) may run these ────────────────
REVOKE EXECUTE ON FUNCTION public.orra_push(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attention_digest(UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_morning_digest() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.send_due_reminders() FROM PUBLIC, anon, authenticated;

-- ── schedules ──────────────────────────────────────────────────────────
SELECT cron.unschedule(jobname) FROM cron.job
 WHERE jobname IN ('anvik-morning-digest', 'orra-morning-digest', 'orra-reminders');

SELECT cron.schedule('orra-morning-digest', '*/15 * * * *', $$SELECT public.send_morning_digest()$$);
SELECT cron.schedule('orra-reminders',      '* * * * *',    $$SELECT public.send_due_reminders()$$);

COMMIT;
