-- ═══════════════════════════════════════════════════════════════════════
-- 0054 — draw on a file, keep the ink
--
-- Attachments (0036) made a PDF something the portal could hold. This makes
-- it something the portal can mark up: open a PDF, a photo, a spreadsheet or
-- a Word file, write on it with an S Pen, an Apple Pencil, a finger or a
-- mouse, and save a flattened "<name>.annotated.pdf" next to the original.
--
-- The flattened copy is an ordinary attachment row — nothing new is needed to
-- store it. What IS new is the ink itself, kept as strokes, so an annotation
-- can be re-opened next week and added to rather than started over on top of
-- a flattened picture of last week's.
--
-- ── annotations ────────────────────────────────────────────────────────
--
--   attachment_id         the file the ink is drawn over. One row per file;
--                         both of you draw on the same layer, the same way a
--                         printed copy on a shared desk works.
--   user_id               who started it.
--   page_count            pages the ink was drawn against, so a replaced
--                         file with fewer pages is noticed rather than
--                         silently mis-drawn.
--   strokes               {v, pages:[{w,h}], strokes:[[stroke…] per page]}.
--                         Capped at 2 MB — the client refuses at 1.8 MB, so
--                         the CHECK is a backstop nobody ever meets.
--   status                'draft' until someone marks it reviewed.
--   output_attachment_id  the latest flattened copy, so re-saving replaces
--                         it instead of stacking up annotated-annotated PDFs.
--
-- Cascades with its file: ink over a file that no longer exists is ink over
-- nothing.
--
-- ── the `files` bucket gets its server-side cap ─────────────────────────
--
-- 0036 capped the attachments ROW at 25 MB but left the bucket itself open,
-- so a hand-rolled upload could still park a larger object. The bucket now
-- refuses anything over 25 MB (26214400 bytes) — the same number files.ts
-- checks in the browser. Changing one means changing the other.
--
-- Same RLS as every other shared table (principle 2, no role gating). Safe to
-- re-run.
-- ═══════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.annotations (
  id TEXT PRIMARY KEY,
  attachment_id TEXT NOT NULL REFERENCES public.attachments (id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  page_count INT NOT NULL DEFAULT 0,
  strokes JSONB NOT NULL DEFAULT '{"v":1,"pages":[],"strokes":[]}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  output_attachment_id TEXT REFERENCES public.attachments (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Named constraints, dropped and re-added, so a re-run converges on these
-- exact rules rather than keeping whatever an earlier draft created.
ALTER TABLE public.annotations DROP CONSTRAINT IF EXISTS annotations_status_check;
ALTER TABLE public.annotations ADD CONSTRAINT annotations_status_check
  CHECK (status IN ('draft', 'reviewed'));

ALTER TABLE public.annotations DROP CONSTRAINT IF EXISTS cap_annotations_strokes;
ALTER TABLE public.annotations ADD CONSTRAINT cap_annotations_strokes
  CHECK (pg_column_size(strokes) <= 2 * 1024 * 1024);

ALTER TABLE public.annotations DROP CONSTRAINT IF EXISTS cap_annotations_page_count;
ALTER TABLE public.annotations ADD CONSTRAINT cap_annotations_page_count
  CHECK (page_count BETWEEN 0 AND 2000);

-- The only read that matters: "the ink on this file".
CREATE UNIQUE INDEX IF NOT EXISTS idx_annotations_attachment
  ON public.annotations (attachment_id);

ALTER TABLE public.annotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_all ON public.annotations;
CREATE POLICY team_all ON public.annotations FOR ALL
  USING (public.is_team_member())
  WITH CHECK (public.is_team_member());

-- ── storage: the server-side upload cap ────────────────────────────────
UPDATE storage.buckets
   SET file_size_limit = 26214400
 WHERE id = 'files'
   AND file_size_limit IS DISTINCT FROM 26214400;

-- ── refuse to half-apply ───────────────────────────────────────────────
DO $mig$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'annotations' AND policyname = 'team_all'
  ) THEN
    RAISE EXCEPTION 'annotations has no team policy';
  END IF;

  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'files')
     AND (SELECT file_size_limit FROM storage.buckets WHERE id = 'files') IS DISTINCT FROM 26214400 THEN
    RAISE EXCEPTION 'files bucket is still uncapped';
  END IF;

  RAISE NOTICE 'annotations storable; files bucket capped at 25 MB';
END
$mig$;

COMMIT;
