-- Pins carry a category as well as a note, so an exported TASK.md tells a
-- coding agent whether a marked region is a bug, a copy tweak or a layout
-- change — instead of leaving it to infer that from prose.
ALTER TABLE public.annotation_pins
  ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';
