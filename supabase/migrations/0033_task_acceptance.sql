-- Task handoff becomes a two-sided conversation.
--
-- Before this, assigning work was one-directional: the assignee got an inbox
-- row and a "Got it" button that set acknowledged_at, and that was the whole
-- protocol. The assigner never learned the task had been accepted, never saw
-- what the assignee thought it was worth, and had no way to be told "not this
-- week". Work could sit in the inbox indefinitely with nobody notified.
--
-- Three columns close that loop:
--
--   accepted_priority  what the ASSIGNEE commits to, alongside the existing
--                      `priority`, which stays what the ASSIGNER asked for.
--                      Deliberately a second column rather than an overwrite:
--                      "you asked P0, I can do P2" is the single most useful
--                      signal in a two-person company, and overwriting would
--                      throw it away. NULL until accepted.
--
--   pushback_reason    set when the assignee hands it back rather than
--                      accepting. The task stays assigned to them — this is a
--                      flag for a conversation, not a way to bounce work into
--                      limbo where neither board shows it.
--
--   pushed_back_at     when that happened, so the inbox can order by it and
--                      the assigner's card can say how long it has been open.
--
-- State is derived, never stored as an enum:
--   acknowledged_at NULL + pushback_reason NULL  → waiting in their inbox
--   acknowledged_at set                          → accepted, on their board
--   pushback_reason set, acknowledged_at NULL    → pushed back to the assigner
--
-- Accepting clears any pushback, so the two can never both be live.
-- Safe to re-run.

-- ═══ Tasks ═════════════════════════════════════════════════════════════

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS accepted_priority TEXT,
  ADD COLUMN IF NOT EXISTS pushback_reason   TEXT,
  ADD COLUMN IF NOT EXISTS pushed_back_at    TIMESTAMPTZ;

-- Same vocabulary as `priority` (0001_init.sql). NULL passes: it is the normal
-- state for anything not yet accepted, and for every task a person assigned to
-- themselves, which needs no acceptance at all.
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_accepted_priority_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_accepted_priority_check
  CHECK (accepted_priority IS NULL
         OR accepted_priority IN ('urgent', 'high', 'normal', 'low'));

-- Server-side input cap, matching the reasoning in 0030_input_caps.sql: the
-- anon key ships in the browser bundle, so anything the client can write a
-- script can write. Far above anything a person would type.
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_pushback_reason_len;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_pushback_reason_len
  CHECK (pushback_reason IS NULL OR char_length(pushback_reason) <= 2000);

-- Backfill: a task already accepted under the old one-button flow committed to
-- whatever priority it carried at the time. Leaving these NULL would render
-- every historical task as "never accepted" in the new UI.
UPDATE public.tasks
   SET accepted_priority = priority
 WHERE acknowledged_at IS NOT NULL AND accepted_priority IS NULL;

-- The inbox and the assigner's "waiting on them" strip both read these.
CREATE INDEX IF NOT EXISTS idx_tasks_acknowledged ON public.tasks (acknowledged_at);

-- ═══ Messages ══════════════════════════════════════════════════════════

-- The reply half of the handoff rides the same pipe as the assignment notice
-- (0012_workspaces.sql): one messages row, so the bell, unread counts,
-- realtime and read receipts work for it without a second system.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_kind_check
  CHECK (kind IN ('chat', 'photo', 'song', 'task_assign', 'task_accept', 'task_pushback'));
