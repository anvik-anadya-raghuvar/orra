-- Today's intentions, as a list that points at real work.
--
-- `day_plans.intention` was one free-text line with no connection to anything:
-- you could write "ship the export engine" and the board never knew. And the
-- planned day itself was computed on every render and thrown away, so "the
-- plan" changed shape whenever a task did.
--
-- This table is both: a per-user list for one date where each row is either a
-- typed line or a pointer at a task. Ticking a row that points at a task closes
-- the task (principle 10 — one row, many views), and saving the planner's picks
-- writes `source = 'planner'` rows so the day survives a reload.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.day_plan_items (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  date DATE NOT NULL,
  -- Null for a typed intention; set when this line is a real task.
  task_id TEXT REFERENCES public.tasks (id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '' CHECK (char_length(text) <= 300),
  done BOOLEAN NOT NULL DEFAULT false,
  position INT NOT NULL DEFAULT 0,
  -- 'manual' typed by hand · 'task' promoted from a task · 'planner' saved
  -- from the capacity plan.
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'task', 'planner')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One line per task per day: promoting the same task twice is a no-op, not a
-- duplicate. Partial, because typed intentions have no task_id to key on.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dpi_once_per_task
  ON public.day_plan_items (user_id, date, task_id)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dpi_user_date
  ON public.day_plan_items (user_id, date, position);

ALTER TABLE public.day_plan_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_all ON public.day_plan_items;
CREATE POLICY own_all ON public.day_plan_items FOR ALL
  USING (public.is_team_member() AND user_id = auth.uid())
  WITH CHECK (public.is_team_member() AND user_id = auth.uid());

GRANT ALL ON public.day_plan_items TO authenticated;
-- Matches 0010: anon needs SELECT so a signed-out visitor reaches the sign-in
-- screen instead of a boot error. RLS still returns nothing to them.
GRANT SELECT ON public.day_plan_items TO anon;
