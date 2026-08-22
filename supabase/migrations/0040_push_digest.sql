-- The morning digest.
--
-- 0039 gave push a delivery route; this is the one sender that has to fire
-- with nobody's browser open. A message push is easy — the person sending it
-- is by definition online, so their client calls the function. "Three things
-- are due today" has no such sender, so it needs the database to do it.
--
-- pg_cron runs the schedule, pg_net makes the call. Both are Supabase
-- built-ins on the free tier: no worker, no third-party scheduler, nothing
-- recurring to pay for.
--
-- ── On the duplication ────────────────────────────────────────────────────
-- The rules below mirror src/lib/attention.ts, which is the browser's
-- definition of "needs you". Two implementations of one rule is a real cost
-- and worth naming: the alternative was a server that could run TypeScript,
-- which this project deliberately does not have. The horizons are named as
-- constants here so a change is at least a one-line edit on each side, and
-- the counts are deliberately coarse — the digest says how many, the app says
-- which, so a drift shows up as a number being off rather than a wrong list.
--
-- Safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- What needs this person today, as one sentence. Mirrors attentionSummary().
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
        WHERE t.assignee_id = p_user
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

-- Ask the push function to notify everyone who has something waiting.
-- SECURITY DEFINER so cron (which runs as the table owner, not a member) can
-- read the profiles it needs; the function itself takes no arguments from a
-- caller, so there is nothing to inject.
CREATE OR REPLACE FUNCTION public.send_morning_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  member RECORD;
  line TEXT;
  fn_url TEXT := current_setting('app.push_function_url', true);
  fn_key TEXT := current_setting('app.push_service_key', true);
BEGIN
  IF fn_url IS NULL OR fn_key IS NULL THEN
    RAISE NOTICE 'push function url/key not configured; skipping digest';
    RETURN;
  END IF;

  FOR member IN
    SELECT DISTINCT p.id
    FROM public.profiles p
    JOIN public.push_subscriptions s ON s.user_id = p.id AND s.expired_at IS NULL
  LOOP
    line := public.attention_digest(member.id, current_date);
    CONTINUE WHEN line IS NULL;  -- nothing due: say nothing at all

    PERFORM net.http_post(
      url     := fn_url,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || fn_key
                 ),
      body    := jsonb_build_object(
                   'user_id', member.id,
                   'title', 'Today',
                   'body', line,
                   'url', '/',
                   'tag', 'anvik-digest',
                   'kind', 'digest'
                 )
    );
  END LOOP;
END;
$$;

-- 07:30 IST — before either working day starts, and late enough that it is
-- not a 3am buzz for whoever is in Italy. Cron runs in UTC: 02:00 UTC.
SELECT cron.unschedule('anvik-morning-digest')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'anvik-morning-digest');

SELECT cron.schedule('anvik-morning-digest', '0 2 * * *', $$SELECT public.send_morning_digest()$$);
