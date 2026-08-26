-- ═══════════════════════════════════════════════════════════════════════
-- 0049 — the ranking's first factor is priority, not objective fit
--
-- `objective_fit` weighted a task by the OKR it pointed at. That factor was
-- unreachable: 0035 deleted the seeded objectives, and nothing in the app has
-- ever been able to create an objective or a key result — no screen inserts
-- into either table. So the dropdown on the task page was permanently empty,
-- every task scored an identical zero on the largest of the three weights,
-- and 40% of the ranking was dead arithmetic.
--
-- The replacement is the P0–P3 you already set on every task. Same column,
-- renamed rather than dropped and re-added, so the number the two of them have
-- tuned survives — 40 stays 40, it just now means what the label says.
--
-- objectives and key_results are deliberately NOT dropped. They hold no rows,
-- they cost nothing, and a later decision to build OKRs properly should not
-- have to start by recreating tables. This migration only stops the ranking
-- pretending to read them.
--
-- Re-runnable: guarded on the column still being there under the old name.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

DO $mig$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ranking_weights'
       AND column_name = 'objective_fit'
  ) THEN
    ALTER TABLE public.ranking_weights RENAME COLUMN objective_fit TO priority;
    RAISE NOTICE 'ranking_weights.objective_fit renamed to priority';
  ELSE
    RAISE NOTICE 'ranking_weights.priority already in place; nothing to do';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ranking_weights'
       AND column_name = 'priority'
  ) THEN
    RAISE EXCEPTION 'ranking_weights has no priority column after the rename';
  END IF;
END
$mig$;

COMMIT;
