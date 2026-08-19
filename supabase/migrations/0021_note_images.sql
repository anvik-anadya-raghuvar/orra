-- Images on notes.
--
-- A note could hold a transcript, a checklist and free text, but not the one
-- thing you most often want to keep: the screenshot the note is *about*. That
-- forced a screenshot into a code-change task even when the thing being
-- recorded was not a task at all, so it never got kept anywhere.
--
-- Stored as JSONB rather than a table, deliberately. An image on a note has no
-- independent life: nothing links to it, nothing queries across them, and it
-- dies with the note. A row-per-image table would buy a join and nothing else.
-- The shape matches src/types.ts `AttachedImage`:
--
--   [{ id, filename, mime, width, height, bytes, data_url, created_at }]
--
-- `data_url` is a browser-compressed JPEG — capped at 1600px wide and ~300 KB
-- by src/lib/imageCompress.ts before it ever reaches here, so a note row stays
-- in the tens of kilobytes even with a few images on it. The cap is enforced
-- again below so a hand-written insert cannot blow a row up.
--
-- Safe to re-run.

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS images JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Server-side input cap (the security gate's "input caps enforced
-- server-side"): at most 12 images per note, and 8 MB of JSON for the column,
-- which is roughly 12 images at the compressor's own 300 KB ceiling plus slack.
-- The client refuses long before this; the constraint is what makes it true
-- when the client is not the one writing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'notes_images_bounded'
  ) THEN
    ALTER TABLE public.notes
      ADD CONSTRAINT notes_images_bounded CHECK (
        jsonb_typeof(images) = 'array'
        AND jsonb_array_length(images) <= 12
        AND pg_column_size(images) <= 8 * 1024 * 1024
      );
  END IF;
END $$;
