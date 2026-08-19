-- Inline image data on task screenshots.
--
-- The client has stored pasted screenshots as browser-compressed data URLs
-- since the annotation work — but only the mock adapter ever accepted them:
-- this column was never added to production, so pasting a screenshot onto a
-- task silently failed against Supabase while working perfectly in local
-- demos. The column IS the fix.
--
-- Same shape and the same server-side cap story as notes.images (0021):
-- src/lib/imageCompress.ts caps at 1600px / ~300 KB before anything is sent,
-- and the constraint makes that true even when the client is not the writer
-- (300 KB binary ≈ 400 K base64 chars; 600 K leaves slack for the header).
--
-- Safe to re-run.

ALTER TABLE public.screenshot_attachments
  ADD COLUMN IF NOT EXISTS data_url TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'screenshot_data_url_cap'
  ) THEN
    ALTER TABLE public.screenshot_attachments
      ADD CONSTRAINT screenshot_data_url_cap
      CHECK (data_url IS NULL OR length(data_url) <= 600000);
  END IF;
END $$;
