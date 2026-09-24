-- ═══════════════════════════════════════════════════════════════════════
-- 0053 — code context for the coding-agent export
--
-- The export exists to drive a coding session, and until now it could not say
-- WHERE the code is. An agent handed TASK.md had to be told the repository and
-- branch out of band, every time. Four nullable columns fix that:
--
--   projects.repo_url        the repository this project's code lives in.
--   projects.default_branch  the branch work starts from by default.
--   tasks.branch             this task's own branch; overrides the default.
--   tasks.code_paths         newline-separated paths the work touches — a
--                            hint for the agent, never a constraint.
--
-- All nullable: most projects (and every personal one) have no repository,
-- and a missing value simply leaves the export's Code context section out.
-- Projects stay seeded rows (principle 9) — this adds columns, not constants.
--
-- Every cap is the server-side half of the security gate. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

-- ── projects ───────────────────────────────────────────────────────────
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS repo_url       TEXT,
  ADD COLUMN IF NOT EXISTS default_branch TEXT;

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS cap_projects_repo_url;
ALTER TABLE public.projects ADD CONSTRAINT cap_projects_repo_url
  CHECK (repo_url IS NULL OR char_length(repo_url) <= 500);

ALTER TABLE public.projects DROP CONSTRAINT IF EXISTS cap_projects_default_branch;
ALTER TABLE public.projects ADD CONSTRAINT cap_projects_default_branch
  CHECK (default_branch IS NULL OR char_length(default_branch) <= 200);

-- ── tasks ──────────────────────────────────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS branch     TEXT,
  ADD COLUMN IF NOT EXISTS code_paths TEXT;

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS cap_tasks_branch;
ALTER TABLE public.tasks ADD CONSTRAINT cap_tasks_branch
  CHECK (branch IS NULL OR char_length(branch) <= 200);

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS cap_tasks_code_paths;
ALTER TABLE public.tasks ADD CONSTRAINT cap_tasks_code_paths
  CHECK (code_paths IS NULL OR char_length(code_paths) <= 2000);

-- ── refuse to half-apply ───────────────────────────────────────────────
DO $mig$
DECLARE
  missing int;
BEGIN
  SELECT 2 - count(*) INTO missing
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'projects'
     AND column_name IN ('repo_url', 'default_branch');
  IF missing <> 0 THEN
    RAISE EXCEPTION 'projects is missing % of the 2 code-context columns', missing;
  END IF;

  SELECT 2 - count(*) INTO missing
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tasks'
     AND column_name IN ('branch', 'code_paths');
  IF missing <> 0 THEN
    RAISE EXCEPTION 'tasks is missing % of the 2 code-context columns', missing;
  END IF;

  RAISE NOTICE 'code context storable: projects.repo_url/default_branch, tasks.branch/code_paths';
END
$mig$;

COMMIT;
