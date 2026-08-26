-- Sanity gate for 0042–0045.
--
--   npx supabase db query --linked --file supabase/verify/0042_0045_check.sql
--
-- Every row of the result must read PASS. Read-only: this file plants nothing
-- and deletes nothing, unlike 0013_rls_check.sql, because everything it needs
-- to assert is about schema and about rows that already exist.

WITH checks AS (

  -- ── 0042: anvik.club, and Pre Launch gone ────────────────────────────
  SELECT '0042.1' AS ord, 'exactly one project named anvik.club' AS what,
         '1' AS want,
         (SELECT count(*)::text FROM public.projects WHERE name = 'anvik.club') AS got

  UNION ALL SELECT '0042.2', 'no project still named Anvik or Pre Launch', '0',
    (SELECT count(*)::text FROM public.projects
      WHERE lower(btrim(name)) IN ('anvik','anvik club','anvikclub','pre launch','prelaunch','pre-launch','pre_launch'))

  UNION ALL SELECT '0042.3', 'at least one task carries type ''pre launch''', 'true',
    (SELECT (count(*) >= 1)::text FROM public.tasks WHERE type = 'pre launch')

  UNION ALL SELECT '0042.4', 'every task points at a project that exists', '0',
    (SELECT count(*)::text FROM public.tasks t
      WHERE NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id = t.project_id))

  -- ── 0043 / 0044: the notice kinds the app now sends ──────────────────
  UNION ALL SELECT '0043.1', 'messages.kind allows mention/query/decision_assign', 'true',
    (SELECT (pg_get_constraintdef(oid) LIKE '%mention%'
         AND pg_get_constraintdef(oid) LIKE '%query%'
         AND pg_get_constraintdef(oid) LIKE '%decision_assign%')::text
       FROM pg_constraint
      WHERE conrelid = 'public.messages'::regclass AND conname = 'messages_kind_check')

  -- ── 0044: the queries table the adapter now loads ────────────────────
  UNION ALL SELECT '0044.1', 'public.queries exists', '1',
    (SELECT count(*)::text FROM pg_class WHERE oid = to_regclass('public.queries'))

  UNION ALL SELECT '0044.2', 'RLS is enabled on queries', 'true',
    (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.queries'::regclass)

  UNION ALL SELECT '0044.3', 'queries carries the team_all policy', '1',
    (SELECT count(*)::text FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'queries' AND policyname = 'team_all')

  -- ── 0045: the three facet lists ──────────────────────────────────────
  UNION ALL SELECT '0045.1', 'tasks has project_ids, types, assignee_ids', '3',
    (SELECT count(*)::text FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tasks'
        AND column_name IN ('project_ids','types','assignee_ids'))

  UNION ALL SELECT '0045.2', 'every task''s primary project is in its own list', '0',
    (SELECT count(*)::text FROM public.tasks
      WHERE NOT (project_ids @> jsonb_build_array(project_id)))

  UNION ALL SELECT '0045.3', 'every assigned task''s primary is in its own list', '0',
    (SELECT count(*)::text FROM public.tasks
      WHERE assignee_id IS NOT NULL AND NOT (assignee_ids @> jsonb_build_array(assignee_id)))

  UNION ALL SELECT '0045.4', 'no task left with an empty project list', '0',
    (SELECT count(*)::text FROM public.tasks WHERE jsonb_array_length(project_ids) = 0)

  UNION ALL SELECT '0045.5', 'the three array CHECK constraints exist', '3',
    (SELECT count(*)::text FROM pg_constraint
      WHERE conrelid = 'public.tasks'::regclass
        AND conname IN ('tasks_project_ids_array','tasks_types_array','tasks_assignee_ids_array'))

  -- ── the audit trail is still append-only (principle 4) ───────────────
  UNION ALL SELECT 'core.1', 'audit_trail still refuses UPDATE and DELETE', '2',
    (SELECT count(*)::text FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'audit_trail'
        AND policyname IN ('audit_no_update','audit_no_delete'))
)
SELECT ord, what, want, got,
       CASE WHEN got IS NOT DISTINCT FROM want THEN 'PASS' ELSE 'FAIL' END AS result
  FROM checks
 ORDER BY ord;
