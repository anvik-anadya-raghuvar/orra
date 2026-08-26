-- ═══════════════════════════════════════════════════════════════════════
-- 0043 — being tagged is a message, like every other notice
--
-- Tagging the other person in a task update has to reach them somewhere they
-- already look. `messages` is that place: the bell, unread counts, realtime
-- and read receipts all work on this table, and 0012 and 0033 already ran
-- handoff notices down the same pipe rather than building a second one.
--
-- The mention itself is not stored here — it lives as a `[[person:id|Name]]`
-- token inside the body it was written in, so it survives an edit and needs
-- no join table. This row is only the tap on the shoulder.
--
-- Re-runnable: DROP IF EXISTS then ADD, same shape as 0033.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_kind_check
  CHECK (kind IN ('chat', 'photo', 'song', 'task_assign', 'task_accept', 'task_pushback', 'mention'));
