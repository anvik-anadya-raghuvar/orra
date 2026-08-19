-- Pin the search_path on every SECURITY DEFINER function.
--
-- A SECURITY DEFINER function runs as its owner — here `postgres`, which owns
-- every table and bypasses RLS. Without a pinned `search_path` it resolves
-- unqualified names using the *caller's* path, so anyone who can create an
-- object in a schema that sits earlier on that path can shadow something the
-- function touches and have it executed as the owner. It is the standard
-- Postgres privilege-escalation shape and what Supabase's own linter flags as
-- `function_search_path_mutable`.
--
-- Not currently exploitable on this project: `anon`, `authenticated` and
-- `service_role` all have CREATE on neither `public` nor `extensions`, so
-- there is nowhere to plant the shadow. This is defence in depth — one future
-- GRANT, or an extension installed into a schema on the path, turns a closed
-- door into an open one. `is_team_member()` in particular is the function every
-- single RLS policy in this database calls, so if it can be subverted then
-- nothing else in here matters.
--
-- `search_path = ''` rather than a named list: all three bodies already
-- schema-qualify everything they touch (public.allowlist, public.profiles,
-- auth.jwt()), and pg_catalog stays implicitly searched for operators and
-- types, so an empty path is both the strictest and the correct one.
--
-- rls_auto_enable already sets pg_catalog and is left alone.
--
-- Safe to re-run. Verified by supabase/verify/0013_rls_check.sql, which
-- exercises is_team_member() on every assertion it makes.

ALTER FUNCTION public.is_team_member() SET search_path = '';
ALTER FUNCTION public.enforce_allowlist() SET search_path = '';
ALTER FUNCTION public.provision_profile() SET search_path = '';
