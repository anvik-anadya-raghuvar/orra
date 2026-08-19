-- Learning states are fixed because they drive behaviour (queued, reading,
-- done). Labels are deliberately open-ended and shared with the rest of the
-- portal, so a person can organise a course or reading item by any vocabulary
-- that makes sense to them without inventing a fake status.
-- Safe to re-run.

ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.reading_queue
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
