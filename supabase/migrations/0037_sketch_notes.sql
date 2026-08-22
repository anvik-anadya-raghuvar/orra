-- Handwriting, kept as handwriting.
--
-- The portal could hold a typed word and a pasted picture and nothing in
-- between: there was no way to simply write on the screen with a pen. A
-- scribble can now be a sketch — and the rule the whole feature is built on
-- is that ink stays ink. Nothing recognises the handwriting or turns it into
-- text; what was drawn is what is stored.
--
-- Stored as vector strokes in JSONB rather than an image, because a
-- handwritten page is tens of kilobytes as points and megabytes as a PNG,
-- because vectors stay sharp at any size, and because a stroke keeps a theme
-- *token* ('teal') rather than a hex value, so ink drawn in daylight is
-- still legible in the dark theme.
--
-- Note that wiki pages needed no migration for the same feature: page blocks
-- live in an unconstrained JSONB column by design. Scribbles did, because
-- notes.type has been a closed CHECK since 0001 — which is the constraint
-- this widens.
--
-- Safe to re-run.

-- ═══ The type ══════════════════════════════════════════════════════════
-- Declared inline in 0001, so Postgres named it notes_type_check. Widened
-- rather than dropped: unlike tasks.type (freed in 0035), a note's type
-- picks which editor renders, so an invented value would have nothing to
-- open it with.
ALTER TABLE public.notes DROP CONSTRAINT IF EXISTS notes_type_check;
ALTER TABLE public.notes ADD CONSTRAINT notes_type_check
  CHECK (type IN ('plain', 'checklist', 'meeting', 'voice', 'email', 'sketch'));

-- ═══ The ink ═══════════════════════════════════════════════════════════
-- Nullable: every note written before today has no sketch, and the client
-- reads this through `?? null`.
ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS sketch JSONB;

-- Twice the client's own 256 KB budget, on purpose — the same relationship
-- 0021 set up for images. The client refuses a stroke past its budget with a
-- sentence; this constraint is the backstop for anything not going through
-- the client, and should never be what a person actually meets.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notes_sketch_bounded') THEN
    ALTER TABLE public.notes
      ADD CONSTRAINT notes_sketch_bounded CHECK (
        sketch IS NULL
        OR (jsonb_typeof(sketch) = 'object' AND pg_column_size(sketch) <= 512 * 1024)
      );
  END IF;
END $$;
