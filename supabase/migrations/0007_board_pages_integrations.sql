-- Board (sprints, links, backlog), wiki pages, and integration grants.
-- Safe to re-run.

-- ═══ Board ═════════════════════════════════════════════════════════════

-- 'backlog' joins the existing statuses. 'in_review' is deliberately kept:
-- the ranking engine scores it as "closing this unblocks the other person",
-- which a four-column board would silently discard.
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done'));

CREATE TABLE IF NOT EXISTS public.sprints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  starts_on DATE,
  ends_on DATE,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  position INT NOT NULL DEFAULT 0
);

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS sprint_id TEXT REFERENCES public.sprints (id) ON DELETE SET NULL,
  -- Manual position inside a column, so drag-to-reorder survives a reload.
  ADD COLUMN IF NOT EXISTS board_order INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.task_links (
  id TEXT PRIMARY KEY,
  from_task_id TEXT NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  to_task_id TEXT NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('blocks', 'blocked_by', 'related', 'child_of')),
  created_by UUID REFERENCES public.profiles (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A pair can hold one link of a given kind, and nothing links to itself.
  UNIQUE (from_task_id, to_task_id, type),
  CHECK (from_task_id <> to_task_id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_board ON public.tasks (status, board_order);
CREATE INDEX IF NOT EXISTS idx_tasks_sprint ON public.tasks (sprint_id);
CREATE INDEX IF NOT EXISTS idx_task_links_from ON public.task_links (from_task_id);
CREATE INDEX IF NOT EXISTS idx_task_links_to ON public.task_links (to_task_id);

INSERT INTO public.sprints (id, name, starts_on, ends_on, position) VALUES
  ('sprint-1', 'Current sprint', CURRENT_DATE - 3, CURRENT_DATE + 11, 1)
ON CONFLICT (id) DO NOTHING;

-- ═══ Wiki pages ════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'Untitled',
  icon TEXT NOT NULL DEFAULT '📄',
  -- Self-referencing tree. ON DELETE CASCADE means deleting a parent takes
  -- its whole subtree, which is what "delete this section" should mean.
  parent_page_id TEXT REFERENCES public.pages (id) ON DELETE CASCADE,
  blocks JSONB NOT NULL DEFAULT '[]',
  tags TEXT[] NOT NULL DEFAULT '{}',
  linked_task_ids TEXT[] NOT NULL DEFAULT '{}',
  is_archived BOOLEAN NOT NULL DEFAULT false,
  position INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.profiles (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_edited_by UUID REFERENCES public.profiles (id),
  last_edited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.page_comments (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES public.pages (id) ON DELETE CASCADE,
  author_id UUID REFERENCES public.profiles (id),
  body TEXT NOT NULL CHECK (char_length(body) <= 10000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pages_parent ON public.pages (parent_page_id, position);
CREATE INDEX IF NOT EXISTS idx_page_comments_page ON public.page_comments (page_id, created_at);

-- ═══ Integration grants ════════════════════════════════════════════════

-- Records WHICH scopes were granted, never a token. Google access tokens are
-- held in memory by the browser for the hour they live; nothing long-lived is
-- persisted, so a database leak cannot become a mailbox leak.
CREATE TABLE IF NOT EXISTS public.integration_grants (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  scopes TEXT[] NOT NULL DEFAULT '{}',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sync_at TIMESTAMPTZ,
  UNIQUE (user_id, provider)
);

-- ═══ RLS + grants ══════════════════════════════════════════════════════

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['sprints', 'task_links', 'pages', 'page_comments', 'integration_grants']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format(
        'CREATE POLICY team_all ON public.%I FOR ALL USING (public.is_team_member()) WITH CHECK (public.is_team_member())',
        t
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    EXECUTE format('GRANT ALL ON public.%I TO authenticated', t);
  END LOOP;
END $$;
