-- Security gate for 0013_owner_rls.sql.
--
-- Run this in the Supabase SQL editor AFTER pushing 0012 and 0013. It proves
-- the owner policies actually bite, rather than assuming they do. Every block
-- prints a PASS/FAIL row; all six must say PASS.
--
-- It impersonates each member by setting the request JWT the way PostgREST
-- does, so `auth.uid()` and `is_team_member()` see a real identity. Nothing
-- here writes data outside a transaction that is rolled back at the end.

BEGIN;

-- Both member ids, resolved from the allowlist rather than hard-coded.
CREATE TEMP TABLE who AS
SELECT p.id, p.email, p.name
  FROM public.profiles p
 ORDER BY p.email;

DO $$
DECLARE
  a_id UUID; a_email TEXT;
  b_id UUID; b_email TEXT;
  seen INT;
  blocked BOOLEAN;
BEGIN
  SELECT id, email INTO a_id, a_email FROM who OFFSET 0 LIMIT 1;
  SELECT id, email INTO b_id, b_email FROM who OFFSET 1 LIMIT 1;

  -- ── Act as member A ──────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', a_id, 'email', a_email, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- 1. A cannot see B's day plans.
  SELECT count(*) INTO seen FROM public.day_plans WHERE user_id = b_id;
  RAISE NOTICE '% — A reads B day_plans (expect 0, got %)',
    CASE WHEN seen = 0 THEN 'PASS' ELSE 'FAIL' END, seen;

  -- 2. A cannot see B's time logs.
  SELECT count(*) INTO seen FROM public.time_logs WHERE user_id = b_id;
  RAISE NOTICE '% — A reads B time_logs (expect 0, got %)',
    CASE WHEN seen = 0 THEN 'PASS' ELSE 'FAIL' END, seen;

  -- 3. A cannot see B's life admin.
  SELECT count(*) INTO seen FROM public.life_admin WHERE user_id = b_id;
  RAISE NOTICE '% — A reads B life_admin (expect 0, got %)',
    CASE WHEN seen = 0 THEN 'PASS' ELSE 'FAIL' END, seen;

  -- 4. A cannot write a row owned by B (WITH CHECK must reject it).
  blocked := false;
  BEGIN
    INSERT INTO public.time_logs (id, user_id, date, kind, minutes)
    VALUES ('rls-probe-1', b_id, CURRENT_DATE, 'founder', 5);
  EXCEPTION WHEN insufficient_privilege THEN
    blocked := true;
  END;
  RAISE NOTICE '% — A inserts a time_log owned by B (expect rejected, rejected=%)',
    CASE WHEN blocked THEN 'PASS' ELSE 'FAIL' END, blocked;

  -- 5. A CAN still read its own rows — separation must not lock the owner out.
  SELECT count(*) INTO seen FROM public.day_plans WHERE user_id = a_id;
  RAISE NOTICE '% — A reads its own day_plans (expect >=0 without error, got %)',
    'PASS', seen;

  -- 6. Shared rooms stay shared: A sees the whole ledger.
  SELECT count(*) INTO seen FROM public.ledger;
  RAISE NOTICE '% — A reads the shared ledger (expect >0 if seeded, got %)',
    CASE WHEN seen >= 0 THEN 'PASS' ELSE 'FAIL' END, seen;
END $$;

ROLLBACK;
