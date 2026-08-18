-- Fix: signed-out visitors could never reach the sign-in screen.
--
-- gate.tsx's signIn() comment says it plainly: "The store booted with the
-- anonymous (empty) dataset" — StoreProvider is supposed to load successfully
-- for a logged-out visitor, get zero rows back from RLS, and render the sign-
-- in form. Instead 0003 only ever granted anon a door to `keepalive`, so
-- every other table came back "42501 permission denied" instead of an empty
-- result set. adapter.load() treats a majority-table failure as fatal, so
-- StoreProvider stopped dead on a "Couldn't load the portal" screen that
-- Gate never got a chance to replace — no signed-out visitor could sign in.
--
-- RLS (team_all, is_team_member()) already returns zero rows to anon; this
-- just lets PostgREST reach the tables so RLS can do that job, matching the
-- reasoning already in 0003 for the authenticated grant.

GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO anon;

-- Audit trail stays append-only for every role, no exceptions.
REVOKE UPDATE, DELETE ON public.audit_trail FROM authenticated, anon, PUBLIC;
