-- Read receipts for the two-person thread, so a message can pop once and then
-- stay quiet. With exactly two members the reader is always "not the sender",
-- so one nullable timestamp is unambiguous — no per-recipient join table.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

-- Unread lookups are the hot path for the notification bell.
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON public.messages (created_at DESC)
  WHERE read_at IS NULL;

-- Realtime must actually broadcast these rows for a popup to appear without a
-- refresh. Adding the table to the publication is what makes that work.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- already published
  WHEN undefined_object THEN NULL;  -- publication absent on this plan
END $$;
