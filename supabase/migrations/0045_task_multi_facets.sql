-- ═══════════════════════════════════════════════════════════════════════
-- 0045 — a task can belong to more than one project, type and person
--
-- Real work does not respect one-of-each. "Tighten the SEO copy" is
-- anvik.club AND pre-launch; "draft the founders agreement" is ops AND legal;
-- and half of what these two do is genuinely both of theirs. Forcing a single
-- value meant picking the least wrong one and losing the rest.
--
-- ── why the scalar columns stay ────────────────────────────────────────
--
-- project_id, type and assignee_id are NOT dropped. They remain the PRIMARY
-- value and every array is defined to carry that primary as element 0.
--
-- That is not timidity, it is what these columns are load-bearing for:
--   · project_id carries a FOREIGN KEY onto projects(id) and a NOT NULL. A
--     JSONB array can express neither, so dropping it would trade a
--     database-enforced guarantee for an application-enforced one.
--   · assignee_id is the ownership fence (principle 1) that 0012 backfilled
--     and that lib/workspace.ts reads. Rewriting the fence and widening it in
--     the same migration is how you find out months later which of the two
--     changes broke it.
--   · thirty-odd read sites use them, and a task with no primary has no
--     stable answer to "which project colour does this card take".
--
-- So: the array is the truth about membership, the scalar is the truth about
-- identity, and the app keeps them in step through lib/taskFacets.ts, which
-- is also where a row written before this migration (arrays absent, as in
-- every mock-mode localStorage save) is normalised on read.
--
-- Capped at 8 entries each — a server-side input cap per the security gate,
-- and far past anything a two-person company needs.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS, and each backfill only touches
-- rows whose array is still empty.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS project_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS types        JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assignee_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_project_ids_array;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_project_ids_array
  CHECK (jsonb_typeof(project_ids) = 'array' AND jsonb_array_length(project_ids) <= 8);

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_types_array;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_types_array
  CHECK (jsonb_typeof(types) = 'array' AND jsonb_array_length(types) <= 8);

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_assignee_ids_array;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_assignee_ids_array
  CHECK (jsonb_typeof(assignee_ids) = 'array' AND jsonb_array_length(assignee_ids) <= 8);

-- ── backfill: every existing task becomes a one-entry list ──────────────
-- Guarded on emptiness rather than on a migration flag, so re-running cannot
-- overwrite a task someone has since given a second project.
UPDATE public.tasks
   SET project_ids = jsonb_build_array(project_id)
 WHERE jsonb_array_length(project_ids) = 0;

UPDATE public.tasks
   SET types = jsonb_build_array(type)
 WHERE jsonb_array_length(types) = 0
   AND coalesce(btrim(type), '') <> '';

UPDATE public.tasks
   SET assignee_ids = jsonb_build_array(assignee_id)
 WHERE jsonb_array_length(assignee_ids) = 0
   AND assignee_id IS NOT NULL;

-- ── refuse to half-apply ───────────────────────────────────────────────
-- A task whose primary is missing from its own list is the exact drift this
-- design exists to prevent, and it is invisible until a filter quietly stops
-- matching a card that is plainly on screen.
DO $mig$
DECLARE
  orphan_project  int;
  orphan_assignee int;
BEGIN
  SELECT count(*) INTO orphan_project
    FROM public.tasks
   WHERE NOT (project_ids @> jsonb_build_array(project_id));

  SELECT count(*) INTO orphan_assignee
    FROM public.tasks
   WHERE assignee_id IS NOT NULL
     AND NOT (assignee_ids @> jsonb_build_array(assignee_id));

  IF orphan_project > 0 OR orphan_assignee > 0 THEN
    RAISE EXCEPTION
      'Backfill incomplete: % task(s) missing their primary project and % missing their primary assignee',
      orphan_project, orphan_assignee;
  END IF;

  RAISE NOTICE 'tasks widened: % row(s) now carry project/type/assignee lists',
    (SELECT count(*) FROM public.tasks);
END
$mig$;

COMMIT;
