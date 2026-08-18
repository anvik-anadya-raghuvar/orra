-- Day-plan layer: declared capacity ("how heavy do I want today to be"),
-- today's intention, win conditions, a timeline of events, and the founder-life
-- metadata on tasks that capacity matching needs.

-- ═══ Task metadata ═════════════════════════════════════════════════════

ALTER TABLE public.tasks
  ADD COLUMN effort TEXT NOT NULL DEFAULT 'medium'
    CHECK (effort IN ('light', 'medium', 'heavy')),
  ADD COLUMN estimate_minutes INT NOT NULL DEFAULT 45 CHECK (estimate_minutes >= 0),
  ADD COLUMN impact INT NOT NULL DEFAULT 3 CHECK (impact BETWEEN 1 AND 5),
  ADD COLUMN is_stuck BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN blocked_reason TEXT;

-- ═══ Day plans: one row per person per day ═════════════════════════════

CREATE TABLE public.day_plans (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  date DATE NOT NULL,
  capacity TEXT NOT NULL DEFAULT 'medium' CHECK (capacity IN ('light', 'medium', 'heavy')),
  intention TEXT NOT NULL DEFAULT '' CHECK (char_length(intention) <= 500),
  wins JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

-- ═══ Day events: today's timeline ══════════════════════════════════════

CREATE TABLE public.day_events (
  id TEXT PRIMARY KEY,
  -- NULL user_id = a shared block both people see
  user_id UUID REFERENCES public.profiles (id) ON DELETE CASCADE,
  date DATE NOT NULL,
  start_min INT NOT NULL CHECK (start_min BETWEEN 0 AND 1440),
  end_min INT NOT NULL CHECK (end_min BETWEEN 0 AND 1440),
  label TEXT NOT NULL CHECK (char_length(label) <= 200),
  kind TEXT NOT NULL DEFAULT 'focus'
    CHECK (kind IN ('focus', 'meeting', 'study', 'admin', 'personal')),
  task_id TEXT REFERENCES public.tasks (id) ON DELETE SET NULL,
  CHECK (end_min > start_min)
);

CREATE INDEX idx_day_plans_user_date ON public.day_plans (user_id, date);
CREATE INDEX idx_day_events_date ON public.day_events (date, start_min);
CREATE INDEX idx_tasks_stuck ON public.tasks (is_stuck) WHERE is_stuck;

-- ═══ RLS — same team-wide policy as every other table ══════════════════

ALTER TABLE public.day_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.day_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY team_all ON public.day_plans FOR ALL
  USING (public.is_team_member()) WITH CHECK (public.is_team_member());
CREATE POLICY team_all ON public.day_events FOR ALL
  USING (public.is_team_member()) WITH CHECK (public.is_team_member());
