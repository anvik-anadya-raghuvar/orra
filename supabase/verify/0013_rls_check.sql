-- Security gate for 0013_owner_rls.sql.
--
--   npx supabase db query --linked --file supabase/verify/0013_rls_check.sql
--
-- Every row of the result must read PASS.
--
-- The first version of this file only counted the other member's existing rows
-- and asserted zero. That passed even with RLS disabled, because both real
-- accounts happen to own no personal rows at all — every seeded day plan and
-- time log belongs to the test@orra.ops demo profile. A check that cannot
-- fail is not a check.
--
-- So this plants probe rows owned by the *other* member first, using the
-- privileged connection that bypasses RLS, and only then impersonates member A
-- to prove the probes are invisible. It also proves the WITH CHECK half:
-- A cannot write a row it would not be allowed to read. Everything is deleted
-- again at the end, so the database is left exactly as it was found.

-- Results accumulate in a local array rather than a temp table: once the block
-- switches to the `authenticated` role it has no write access to a table it
-- created as postgres, and the first run failed exactly there.
CREATE TEMP TABLE rls_result (ord TEXT, what TEXT, want TEXT, got TEXT, result TEXT);

DO $$
DECLARE
  a_id UUID; a_email TEXT;
  b_id UUID; b_email TEXT;
  seen INT;
  rejected BOOLEAN;
  rows_out TEXT[][] := ARRAY[]::TEXT[][];
  r TEXT[];
BEGIN
  SELECT id, email INTO a_id, a_email FROM public.profiles ORDER BY email OFFSET 0 LIMIT 1;
  SELECT id, email INTO b_id, b_email FROM public.profiles ORDER BY email OFFSET 1 LIMIT 1;

  -- ── Probes owned by B, written as the privileged role ─────────────────
  INSERT INTO public.day_plans (id, user_id, date, capacity)
    VALUES ('rls-probe-plan', b_id, DATE '2031-01-01', 'medium');
  INSERT INTO public.time_logs (id, user_id, date, kind, minutes)
    VALUES ('rls-probe-log', b_id, DATE '2031-01-01', 'founder', 42);
  INSERT INTO public.life_admin (id, user_id, item, completed)
    VALUES ('rls-probe-admin', b_id, 'probe', false);
  INSERT INTO public.daily_closeouts (id, user_id, date, shipped, stuck, tomorrow)
    VALUES ('rls-probe-close', b_id, DATE '2031-01-01', 'probe', '', '');
  INSERT INTO public.day_plan_items (id, user_id, date, text, source)
    VALUES ('rls-probe-item', b_id, DATE '2031-01-01', 'probe', 'manual');
  -- Tables added after this gate was first written.
  INSERT INTO public.personal_goals (id, user_id, title) VALUES ('rls-probe-goal', b_id, 'probe');
  INSERT INTO public.mood_items (id, user_id, kind, body) VALUES ('rls-probe-mood', b_id, 'note', 'probe');
  INSERT INTO public.active_blocks (id, user_id, scope) VALUES ('rls-probe-block', b_id, 'founder');

  -- Sanity: the probes really are there when nobody is impersonated.
  SELECT count(*) INTO seen FROM public.day_plans WHERE id = 'rls-probe-plan';
  INSERT INTO rls_result VALUES
    ('0', 'probe row exists before impersonation', '1', seen::text,
     CASE WHEN seen = 1 THEN 'PASS' ELSE 'FAIL' END);

  -- ── Become member A ───────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', a_id, 'email', a_email, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO seen FROM public.day_plans WHERE id = 'rls-probe-plan';
  rows_out := rows_out || ARRAY[ARRAY['1', 'A cannot read B day_plan', '0', seen::text,
    CASE WHEN seen = 0 THEN 'PASS' ELSE 'FAIL' END]];

  SELECT count(*) INTO seen FROM public.time_logs WHERE id = 'rls-probe-log';
  rows_out := rows_out || ARRAY[ARRAY['2', 'A cannot read B time_log', '0', seen::text,
    CASE WHEN seen = 0 THEN 'PASS' ELSE 'FAIL' END]];

  SELECT count(*) INTO seen FROM public.life_admin WHERE id = 'rls-probe-admin';
  rows_out := rows_out || ARRAY[ARRAY['3', 'A cannot read B life_admin', '0', seen::text,
    CASE WHEN seen = 0 THEN 'PASS' ELSE 'FAIL' END]];

  SELECT count(*) INTO seen FROM public.daily_closeouts WHERE id = 'rls-probe-close';
  rows_out := rows_out || ARRAY[ARRAY['4', 'A cannot read B closeout', '0', seen::text,
    CASE WHEN seen = 0 THEN 'PASS' ELSE 'FAIL' END]];

  SELECT count(*) INTO seen FROM public.day_plan_items WHERE id = 'rls-probe-item';
  rows_out := rows_out || ARRAY[ARRAY['5', 'A cannot read B intention', '0', seen::text,
    CASE WHEN seen = 0 THEN 'PASS' ELSE 'FAIL' END]];

  SELECT count(*) INTO seen FROM public.personal_goals WHERE id = 'rls-probe-goal';
  rows_out := rows_out || ARRAY[ARRAY['5a', 'A cannot read B goal', '0', seen::text,
    CASE WHEN seen = 0 THEN 'PASS' ELSE 'FAIL' END]];

  SELECT count(*) INTO seen FROM public.mood_items WHERE id = 'rls-probe-mood';
  rows_out := rows_out || ARRAY[ARRAY['5b', 'A cannot read B mood board', '0', seen::text,
    CASE WHEN seen = 0 THEN 'PASS' ELSE 'FAIL' END]];

  -- active_blocks is deliberately NOT owner-read (0028): a running block is
  -- live presence in a two-person workspace, and Home's "what they are up to"
  -- tile reads it on purpose. The contract there is read-team, write-owner —
  -- so this asserts both halves. Asserting the old contract made this gate
  -- report a failure that was really a stale expectation, while leaving the
  -- half that actually matters — that A cannot stop B's clock — untested.
  SELECT count(*) INTO seen FROM public.active_blocks WHERE id = 'rls-probe-block';
  rows_out := rows_out || ARRAY[ARRAY['5c', 'A can read B running block (presence, by design)', '1', seen::text,
    CASE WHEN seen = 1 THEN 'PASS' ELSE 'FAIL' END]];

  -- Reading it is presence; changing it is not. An UPDATE that matches no
  -- readable-and-writable row affects zero rows rather than raising, so this
  -- counts what changed instead of catching an exception.
  UPDATE public.active_blocks SET paused_at = now() WHERE id = 'rls-probe-block';
  GET DIAGNOSTICS seen = ROW_COUNT;
  rows_out := rows_out || ARRAY[ARRAY['5d', 'A cannot pause B running block', '0', seen::text,
    CASE WHEN seen = 0 THEN 'PASS' ELSE 'FAIL' END]];

  DELETE FROM public.active_blocks WHERE id = 'rls-probe-block';
  GET DIAGNOSTICS seen = ROW_COUNT;
  rows_out := rows_out || ARRAY[ARRAY['5e', 'A cannot end B running block', '0', seen::text,
    CASE WHEN seen = 0 THEN 'PASS' ELSE 'FAIL' END]];

  -- WITH CHECK: writing a row owned by the other member must be refused.
  rejected := false;
  BEGIN
    INSERT INTO public.time_logs (id, user_id, date, kind, minutes)
      VALUES ('rls-probe-forge', b_id, DATE '2031-01-01', 'founder', 5);
  EXCEPTION WHEN insufficient_privilege THEN
    rejected := true;
  END;
  rows_out := rows_out || ARRAY[ARRAY['6', 'A cannot write a row owned by B', 'rejected',
    CASE WHEN rejected THEN 'rejected' ELSE 'allowed' END,
    CASE WHEN rejected THEN 'PASS' ELSE 'FAIL' END]];

  -- A must still be able to write its own rows: separation, not lockout.
  BEGIN
    INSERT INTO public.time_logs (id, user_id, date, kind, minutes)
      VALUES ('rls-probe-own', a_id, DATE '2031-01-01', 'founder', 5);
    SELECT count(*) INTO seen FROM public.time_logs WHERE id = 'rls-probe-own';
  EXCEPTION WHEN insufficient_privilege THEN
    seen := 0;
  END;
  rows_out := rows_out || ARRAY[ARRAY['7', 'A can write its own row', '1', seen::text,
    CASE WHEN seen = 1 THEN 'PASS' ELSE 'FAIL' END]];

  -- Shared rooms stay shared.
  SELECT count(*) INTO seen FROM public.ledger;
  rows_out := rows_out || ARRAY[ARRAY['8', 'A reads the shared ledger', '>0', seen::text,
    CASE WHEN seen > 0 THEN 'PASS' ELSE 'FAIL' END]];

  SELECT count(*) INTO seen FROM public.tasks;
  rows_out := rows_out || ARRAY[ARRAY['9', 'A reads all tasks (shared on purpose)', '>0', seen::text,
    CASE WHEN seen > 0 THEN 'PASS' ELSE 'FAIL' END]];

  -- ── Back to the privileged role, and clean up every probe ─────────────
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', NULL, true);
  DELETE FROM public.day_plans      WHERE id = 'rls-probe-plan';
  DELETE FROM public.time_logs      WHERE id IN ('rls-probe-log', 'rls-probe-forge', 'rls-probe-own');
  DELETE FROM public.life_admin     WHERE id = 'rls-probe-admin';
  DELETE FROM public.daily_closeouts WHERE id = 'rls-probe-close';
  DELETE FROM public.day_plan_items WHERE id = 'rls-probe-item';
  DELETE FROM public.personal_goals  WHERE id = 'rls-probe-goal';
  DELETE FROM public.mood_items      WHERE id = 'rls-probe-mood';
  DELETE FROM public.active_blocks   WHERE id = 'rls-probe-block';

  SELECT count(*) INTO seen FROM public.day_plans WHERE id LIKE 'rls-probe-%';
  rows_out := rows_out || ARRAY[ARRAY['10', 'probes cleaned up', '0', seen::text,
    CASE WHEN seen = 0 THEN 'PASS' ELSE 'FAIL' END]];
  -- Back as postgres, so writing the results table is allowed again.
  FOREACH r SLICE 1 IN ARRAY rows_out LOOP
    -- ord carries letters now (5a, 5b), so the results table keeps it as text.
    INSERT INTO rls_result VALUES (r[1], r[2], r[3], r[4], r[5]);
  END LOOP;
END $$;

SELECT ord, what, want, got, result FROM rls_result ORDER BY ord;
