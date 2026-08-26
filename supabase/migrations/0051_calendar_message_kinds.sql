-- ═══════════════════════════════════════════════════════════════════════
-- 0051 — calendar invites ride the same notice pipe as everything else
--
-- Blocking time with somebody, and their accepting it, are two more notices.
-- They go down the pipe 0012, 0033, 0043 and 0044 already use — one `messages`
-- row, so the bell, unread counts, realtime, read receipts and (since the push
-- wiring moved into `notice()`) the phone ping all work without a second
-- system.
--
-- Separate migration from 0050 only because 0050 was already applied when the
-- notices were written. Same feature.
--
-- Re-runnable: DROP IF EXISTS then ADD, same shape as 0033/0043/0044.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_kind_check
  CHECK (kind IN (
    'chat', 'photo', 'song',
    'task_assign', 'task_accept', 'task_pushback',
    'mention', 'query', 'decision_assign',
    'calendar_invite', 'calendar_confirm'
  ));
