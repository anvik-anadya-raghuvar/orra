-- Per-user workspaces (principle 1: two workspaces, three shared rooms).
--
-- Separation here is *ownership*, not secrecy. These columns let each screen
-- show "mine" while both rows stay readable, which is what assignment,
-- promote-to-task, money↔task links and the Us thread all depend on. The
-- strictly-personal tables get real owner RLS in 0012's sibling migration.
--
-- Every column is nullable and NULL means "belongs to both", so the app keeps
-- working between deploying this and shipping the UI that writes them.
-- Safe to re-run.

-- ═══ Tasks ═════════════════════════════════════════════════════════════

-- Set when the assignee acknowledges work the *other* person pushed at them.
-- Until then the task sits in the "Assigned to you" inbox instead of silently
-- appearing mid-board.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

-- A task with no assignee belonged to nobody, which under ownership filtering
-- means it would vanish from both boards. Give it back to its author.
UPDATE public.tasks
   SET assignee_id = created_by
 WHERE assignee_id IS NULL AND created_by IS NOT NULL;

-- ═══ Owned-by-one-person content ═══════════════════════════════════════

ALTER TABLE public.notes         ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.profiles (id);
ALTER TABLE public.pages         ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.profiles (id);
ALTER TABLE public.documents     ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.profiles (id);
ALTER TABLE public.courses       ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.profiles (id);
ALTER TABLE public.reading_queue ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.profiles (id);
ALTER TABLE public.fixed_dates   ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.profiles (id);

-- Notes and wiki pages have a clear author, so backfill from it. Documents,
-- courses, reading and fixed dates deliberately stay NULL: a visa date or a
-- shared course concerns both people until someone claims it in the UI.
UPDATE public.notes SET owner_id = created_by WHERE owner_id IS NULL;
UPDATE public.pages SET owner_id = created_by WHERE owner_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_notes_owner ON public.notes (owner_id);
CREATE INDEX IF NOT EXISTS idx_pages_owner ON public.pages (owner_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON public.tasks (assignee_id);

-- ═══ Messages carry more than chat now ═════════════════════════════════

-- One pipe for everything that travels between the two people: chat, a sent
-- photo, a suggested song, and the notice that a task was assigned. Doing it
-- this way means the bell, unread counts, realtime and read receipts work for
-- all four without a second notification system.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'chat';

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_kind_check
  CHECK (kind IN ('chat', 'photo', 'song', 'task_assign'));
