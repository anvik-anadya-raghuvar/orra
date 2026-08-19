-- Category blocks: one timer, several scopes, and it survives a reload.
--
-- There were two unrelated timers before. The founder one lived in a Home
-- overlay counting down from 50 minutes; the study one was a stopwatch inside
-- a Personal widget, holding its elapsed seconds in component state — so
-- navigating away or reloading silently threw the session away, and neither
-- knew the other existed.
--
-- A block is now a *category of work plus a clock*: founder, study, personal,
-- today's saved plan, or today's intentions. The row below is the whole state.
-- Elapsed time is derived from started_at rather than counted in the browser,
-- which is what makes a reload (or a different device) pick the block back up
-- exactly where it was.
--
-- One row per person: starting a second block while one runs is not a thing a
-- person can do, so the schema says so too.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.active_blocks (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles (id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'founder'
    CHECK (scope IN ('founder', 'study', 'personal', 'today_plan', 'intentions')),
  -- The one thing highlighted inside the block. The list itself is derived
  -- live from the scope, never snapshotted, so closing a task elsewhere is
  -- reflected here immediately.
  focus_task_id TEXT REFERENCES public.tasks (id) ON DELETE SET NULL,
  course_id TEXT REFERENCES public.courses (id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set while paused; NULL means running.
  paused_at TIMESTAMPTZ,
  paused_total_sec INT NOT NULL DEFAULT 0 CHECK (paused_total_sec >= 0),
  -- Founder blocks aim at 50 minutes; a study block runs open-ended.
  target_minutes INT CHECK (target_minutes IS NULL OR target_minutes > 0)
);

ALTER TABLE public.active_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_all ON public.active_blocks;
CREATE POLICY own_all ON public.active_blocks FOR ALL
  USING (public.is_team_member() AND user_id = auth.uid())
  WITH CHECK (public.is_team_member() AND user_id = auth.uid());

GRANT ALL ON public.active_blocks TO authenticated;
-- Matches 0010: anon needs SELECT so a signed-out visitor reaches the sign-in
-- screen rather than a boot error. RLS still returns nothing to them.
GRANT SELECT ON public.active_blocks TO anon;

-- ═══ time_logs gains a third kind ══════════════════════════════════════

-- Personal hours were previously logged as 'founder' or not at all, which
-- quietly inflated the founder side of the study-vs-founder split bar. That
-- bar is meant to referee whether the degree got real hours, so a personal
-- errand must not count as founder time. It stays out of both sides and shows
-- only in the time ledger.
ALTER TABLE public.time_logs DROP CONSTRAINT IF EXISTS time_logs_kind_check;
ALTER TABLE public.time_logs ADD CONSTRAINT time_logs_kind_check
  CHECK (kind IN ('study', 'founder', 'personal'));
