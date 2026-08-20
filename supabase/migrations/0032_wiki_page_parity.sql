-- Notion-style page editing without importing Notion's database, permission,
-- or AI products. Page bodies remain JSONB; only collaboration/history need
-- relational rows of their own.

ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS cover_url TEXT,
  ADD COLUMN IF NOT EXISTS full_width BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ;

ALTER TABLE public.pages
  DROP CONSTRAINT IF EXISTS cap_pages_cover_url;
ALTER TABLE public.pages
  ADD CONSTRAINT cap_pages_cover_url
  CHECK (cover_url IS NULL OR char_length(cover_url) <= 700000);

ALTER TABLE public.page_comments
  ADD COLUMN IF NOT EXISTS block_id TEXT,
  ADD COLUMN IF NOT EXISTS anchor_text TEXT,
  ADD COLUMN IF NOT EXISTS parent_comment_id TEXT REFERENCES public.page_comments (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES public.profiles (id),
  ADD COLUMN IF NOT EXISTS reaction_user_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE public.page_comments
  DROP CONSTRAINT IF EXISTS cap_page_comments_anchor_text;
ALTER TABLE public.page_comments
  ADD CONSTRAINT cap_page_comments_anchor_text
  CHECK (anchor_text IS NULL OR char_length(anchor_text) <= 1000);

CREATE INDEX IF NOT EXISTS idx_page_comments_thread
  ON public.page_comments (page_id, parent_comment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_page_comments_block
  ON public.page_comments (page_id, block_id) WHERE block_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.page_revisions (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES public.pages (id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles (id),
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cap_page_revisions_snapshot CHECK (pg_column_size(snapshot) <= 1200000)
);

CREATE INDEX IF NOT EXISTS idx_page_revisions_page
  ON public.page_revisions (page_id, created_at DESC);

ALTER TABLE public.page_revisions ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  CREATE POLICY team_all ON public.page_revisions
    FOR ALL USING (public.is_team_member()) WITH CHECK (public.is_team_member());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
GRANT ALL ON public.page_revisions TO authenticated;
