-- The Personal room, for two different lives.
--
-- Personal was built around one of them: courses, a study rhythm, a study
-- timer. Only one of you is doing a degree, so for the other the whole screen
-- was furniture. It becomes a dashboard you compose — the same machinery Home
-- already uses — where each person keeps the widgets that match their life.
--
-- Two new tables:
--   personal_goals — ambitions that are not coursework. Progress is derived
--     where it can be (a linked project, a linked course) and falls back to a
--     milestone checklist, so a goal is never a number you have to maintain
--     by hand.
--   mood_items — the free page. Deliberately shapeless: no columns, no
--     status, no due date. Pin a thing and it stays pinned.
--
-- Both are strictly personal, so both get owner RLS like 0013's tables.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.personal_goals (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) <= 200),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  target_date DATE,
  -- Where progress comes from when set. Both null = the milestones decide.
  linked_project_id TEXT REFERENCES public.projects (id) ON DELETE SET NULL,
  linked_course_id TEXT REFERENCES public.courses (id) ON DELETE SET NULL,
  milestones JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'dropped')),
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_user ON public.personal_goals (user_id, position);

CREATE TABLE IF NOT EXISTS public.mood_items (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'note'
    CHECK (kind IN ('image', 'link', 'quote', 'note', 'song')),
  title TEXT NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  url TEXT,
  -- Images live in the `moments` bucket (0017), never inline in the row.
  storage_path TEXT,
  color TEXT NOT NULL DEFAULT '',
  position INT NOT NULL DEFAULT 0,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mood_user ON public.mood_items (user_id, position);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['personal_goals', 'mood_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS own_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY own_all ON public.%I FOR ALL
         USING (public.is_team_member() AND user_id = auth.uid())
         WITH CHECK (public.is_team_member() AND user_id = auth.uid())',
      t
    );
    EXECUTE format('GRANT ALL ON public.%I TO authenticated', t);
    -- Matches 0010: anon needs SELECT to reach the sign-in screen. RLS still
    -- returns nothing to them.
    EXECUTE format('GRANT SELECT ON public.%I TO anon', t);
  END LOOP;
END $$;
