-- Tasks that come back.
--
-- Rent, the quarterly filing, the weekly review: things that happen on a
-- rhythm had to be typed out again every single time, which meant they were
-- remembered rather than tracked.
--
-- A task can now carry a repeat, and completing it CREATES the next
-- occurrence as a new row -- announced with a toast naming the new date.
-- That shape is deliberate and follows principle 3: nothing about the task
-- you just finished moves, silently or otherwise. Its due date stays what it
-- was, its history stays intact, and a separate row appears for next time.
-- Deleting or trashing a task ends the chain naturally, because the next one
-- is only ever minted at the moment of completion.
--
-- One JSONB column rather than repeat_unit TEXT + repeat_n INT: a single
-- nullable column reads as "no repeat" without a second field to keep in
-- step, and it can grow an end date or a skip-weekends rule later without
-- another migration.
--
-- Safe to re-run.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS repeat JSONB;

-- Tiny by construction -- {"every":2,"unit":"week"} is 26 bytes. The cap is
-- here so a malformed write cannot turn a task row into a document.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_repeat_bounded') THEN
    ALTER TABLE public.tasks
      ADD CONSTRAINT tasks_repeat_bounded CHECK (
        repeat IS NULL
        OR (jsonb_typeof(repeat) = 'object' AND pg_column_size(repeat) <= 200)
      );
  END IF;
END $$;
