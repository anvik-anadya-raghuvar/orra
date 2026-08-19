-- Goals become directions a person can actually act on.
--
-- Existing rows are preserved and appear in Now by default. The client keeps
-- the three-goal Now limit as a planning constraint; the database constrains
-- only shape and input size so migrations and imports remain recoverable.

ALTER TABLE public.personal_goals
  ADD COLUMN IF NOT EXISTS area TEXT NOT NULL DEFAULT ''
    CHECK (char_length(area) <= 100),
  ADD COLUMN IF NOT EXISTS why TEXT NOT NULL DEFAULT ''
    CHECK (char_length(why) <= 1000),
  ADD COLUMN IF NOT EXISTS next_action TEXT NOT NULL DEFAULT ''
    CHECK (char_length(next_action) <= 500),
  ADD COLUMN IF NOT EXISTS focus_state TEXT NOT NULL DEFAULT 'now'
    CHECK (focus_state IN ('now', 'later')),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
