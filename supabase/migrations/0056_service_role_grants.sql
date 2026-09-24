-- ═══════════════════════════════════════════════════════════════════════
-- 0056 — let the edge functions read the tables they are written for
--
-- The Cal.com busy feed answered "Not found" for a link that existed. The
-- real error, once surfaced, was 42501 (insufficient_privilege): the edge
-- functions connect as service_role, and this project's default privileges
-- (0003, 0010) only ever granted new tables to `authenticated` and `anon`.
-- Tables made since — booking_pages, bookings, annotations, push_digest_sent,
-- and possibly push_subscriptions / push_log — were unreadable to every edge
-- function, so the busy feed, the booking page and the Cal.com webhook could
-- not find anything, and push could not read the devices it pushes to.
--
-- service_role already bypasses RLS by design; it only lacked table grants.
-- This grants them on everything in public and sets the default so a future
-- table does not repeat this. It changes nothing for the two signed-in
-- members or for anon: their access is still exactly what RLS and the grants
-- above allow (bookings keeps INSERT/DELETE revoked from them, 0055).
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;

-- The members' own access to the new tables, stated rather than assumed from
-- default privileges (RLS still decides which rows).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_pages TO authenticated;
GRANT SELECT, UPDATE ON public.bookings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.annotations TO authenticated;
GRANT SELECT ON public.push_digest_sent TO authenticated;

-- Refuse to half-apply: the one read that failed must now be allowed.
DO $chk$
BEGIN
  IF NOT has_table_privilege('service_role', 'public.booking_pages', 'SELECT') THEN
    RAISE EXCEPTION 'service_role still cannot read booking_pages';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.push_subscriptions', 'SELECT') THEN
    RAISE EXCEPTION 'service_role still cannot read push_subscriptions';
  END IF;
END
$chk$;

COMMIT;
