-- Edit and delete on your own sent messages.
--
-- Delete already worked at the database level — `messages` sits under the
-- general team-wide policy from 0001, which both members always had, and the
-- app's own `store.remove` already routes every delete through Trash. What
-- was missing was purely client-side: no button. Nothing to migrate for it.
--
-- Editing needs one column. `edited_at` is set once, on the first edit, and
-- never cleared — the bubble shows "(edited)" once it exists rather than
-- comparing against a history it doesn't keep. A message's whole edit history
-- already lives in `audit_trail` (every `body` change on a message writes an
-- old_value/new_value line there), so this column is a display flag, not the
-- record of truth.
--
-- Safe to re-run.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
