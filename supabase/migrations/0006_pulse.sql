-- "Worth knowing" — the AI/LLM news tile.
--
-- Was three hard-coded strings in the bundle. This makes it real data, filled
-- by a scheduled GitHub Action (.github/workflows/pulse.yml) that reads public
-- RSS feeds. A browser cannot fetch those directly (CORS), and there is no
-- server in this stack — the cron IS the backend, and it stays on free tiers.

CREATE TABLE IF NOT EXISTS public.pulse_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'auto' = fetched by the cron, 'manual' = pinned by hand in the app.
  origin TEXT NOT NULL DEFAULT 'auto' CHECK (origin IN ('auto', 'manual')),
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pulse_published ON public.pulse_items (published_at DESC);

ALTER TABLE public.pulse_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY team_all ON public.pulse_items FOR ALL
    USING (public.is_team_member()) WITH CHECK (public.is_team_member());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT ALL ON public.pulse_items TO authenticated;

-- The cron writes with the anon key, so it needs exactly these two verbs and
-- nothing else. RLS still applies to reads.
GRANT INSERT, UPDATE ON public.pulse_items TO anon;

-- Seed so the tile is never empty before the first cron run.
INSERT INTO public.pulse_items (id, title, source, url, origin) VALUES
  ('pulse-seed-1', 'Waiting for the first scheduled fetch', 'Anvik Ops', '', 'manual')
ON CONFLICT (id) DO NOTHING;
