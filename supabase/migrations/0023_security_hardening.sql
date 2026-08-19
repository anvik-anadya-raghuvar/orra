-- Close the two production-data escape hatches found in the full audit.
--
-- 1. The test fixture account was allowlisted as a third team member. Under
--    the original team-wide RLS policy that meant it could read the founders'
--    real shared rooms. Development testing now uses the local mock adapter;
--    the database test identity may remain for migration history, but it is no
--    longer a team member and RLS therefore returns it no rows.
--
-- 2. The news cron wrote with the public anon key. `origin = 'auto'` is not
--    authentication — any caller could spoof it. The GitHub job now uses its
--    server-side SUPABASE_SERVICE_ROLE_KEY secret, so public write policies
--    and grants are removed. The key never enters the browser bundle.
--
-- Safe to re-run.

DELETE FROM public.allowlist WHERE email = 'test@anvik.ops';

DROP POLICY IF EXISTS pulse_anon_insert ON public.pulse_items;
DROP POLICY IF EXISTS pulse_anon_update ON public.pulse_items;
DROP POLICY IF EXISTS pulse_anon_select ON public.pulse_items;

REVOKE INSERT, UPDATE, DELETE ON public.pulse_items FROM anon;

-- Keep the append-only guarantee explicit after changing table grants.
REVOKE UPDATE, DELETE ON public.audit_trail FROM authenticated, anon, PUBLIC;
