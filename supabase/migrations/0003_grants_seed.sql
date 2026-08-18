-- Grants + minimal production seed.
--
-- This project rejects API access with "42501 permission denied" because
-- table-level privileges were never granted to the API roles. RLS is the real
-- security gate (is_team_member() checks the JWT email against allowlist);
-- these grants just let PostgREST reach the tables so RLS can do its job.

-- ═══ Grants ════════════════════════════════════════════════════════════

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Signed-in members get full table access; RLS still filters every row.
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

-- Future tables created from the dashboard inherit the same grant.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;

-- The broad grant above re-added UPDATE/DELETE on the audit trail — take it
-- back. Append-only at the database level is non-negotiable (principle 3).
REVOKE UPDATE, DELETE ON public.audit_trail FROM authenticated, anon, PUBLIC;

-- anon gets exactly one door: the keepalive ping (RLS still returns zero
-- rows to it — the request counting as API activity is all that matters).
GRANT SELECT ON public.keepalive TO anon;

-- ═══ Seed: the rows the app cannot invent for itself ═══════════════════
-- Projects are seeded database rows, never enum constants in code
-- (principle 8), and the ranking table needs objectives to point at.
-- Everything else (people, courses, notes, …) is created in-app.

INSERT INTO public.projects (id, name, color, description, is_personal) VALUES
  ('anvik', 'Anvik', 'var(--indigo)', 'Scoring engine and core company', false),
  ('reg', 'Registry', 'var(--teal)', 'Registry data spine — collectors', false),
  ('con', 'Consumer', 'var(--stamp)', 'Consumer venture', false),
  ('personal', 'Personal', 'var(--sky)', 'Life, study, relocation', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.objectives (id, title, project_id, quarter) VALUES
  ('okr-reg', 'Registry spine complete', 'reg', 'Q3'),
  ('okr-score', 'Scoring engine production-ready', 'anvik', 'Q3'),
  ('okr-con', 'Consumer venture validated', 'con', 'Q3'),
  ('okr-italy', 'Land in Italy, settled', 'personal', 'Q3')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.key_results (id, objective_id, title, progress_pct, position) VALUES
  ('kr-1', 'okr-reg', 'Collectors live in production', 0, 1),
  ('kr-2', 'okr-reg', 'Entity resolution above 95%', 0, 2),
  ('kr-3', 'okr-reg', 'Publishability policy signed off', 0, 3),
  ('kr-4', 'okr-score', 'v3.8 frozen and regressed', 0, 1),
  ('kr-5', 'okr-score', 'Two pilots scored end to end', 0, 2),
  ('kr-6', 'okr-con', 'Two vendor quotes landed', 0, 1),
  ('kr-7', 'okr-con', '50 pre-orders', 0, 2),
  ('kr-8', 'okr-italy', 'Visa and permesso done', 0, 1),
  ('kr-9', 'okr-italy', 'Housing secured', 0, 2),
  ('kr-10', 'okr-italy', 'Week-1 reading finished', 0, 3)
ON CONFLICT (id) DO NOTHING;
