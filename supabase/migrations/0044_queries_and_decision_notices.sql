-- ═══════════════════════════════════════════════════════════════════════
-- 0044 — queries, and telling someone a decision is theirs
--
-- Two kinds of question, deliberately not one table:
--
--   A DECISION is a fork in the work. It is assigned to one of them, it
--   blocks the tasks linked to it until it is ruled, and the ruling is kept
--   because it will be re-litigated in four months. That already exists.
--
--   A QUERY is "what did the accountant say about the GST date". It needs an
--   informal answer, not a ruling; it blocks nothing; and the answer is worth
--   keeping only until it has been read. Filing those as decisions would
--   bury the three that actually gate work under thirty that do not.
--
-- Queries carry NO project_id, unlike decisions. A query is a question
-- between two people, not a piece of project work, and requiring a project
-- would have meant a picker choosing one for you -- the exact thing being
-- removed everywhere else this week.
--
-- `asked_of` is who owes the answer. Not a permission: either of them can
-- answer or close any query, same as everything else here (principle 2).
-- It is the difference between "someone should look at this" and "you".
--
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, DROP-then-CREATE for policies
-- and constraints.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.queries (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 300),
  -- Room for the context that makes the question answerable, capped per the
  -- security gate's server-side input rule.
  detail TEXT NOT NULL DEFAULT '' CHECK (char_length(detail) <= 4000),
  asked_by UUID REFERENCES public.profiles (id),
  asked_of UUID REFERENCES public.profiles (id),
  -- 'answered' and 'closed' are different endings on purpose: answered means
  -- you got what you needed, closed means it stopped mattering. Collapsing
  -- them would lose the only signal that a question went stale unanswered.
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  answer TEXT NOT NULL DEFAULT '' CHECK (char_length(answer) <= 4000),
  answered_by UUID REFERENCES public.profiles (id),
  -- Optional, because most queries are about nothing in particular. When it
  -- is set, the task page can show it. ON DELETE SET NULL so binning a task
  -- never takes the question with it.
  task_id TEXT REFERENCES public.tasks (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

-- Every read is "the open ones first, newest first".
CREATE INDEX IF NOT EXISTS idx_queries_status ON public.queries (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_queries_task ON public.queries (task_id);

-- Same rule as every other shared table (principle 2, no role gating): both
-- allowlisted members, full access, nobody else anything. Deliberately NOT
-- owner RLS -- a query only works if the person being asked can read it.
ALTER TABLE public.queries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_all ON public.queries;
CREATE POLICY team_all ON public.queries FOR ALL
  USING (public.is_team_member())
  WITH CHECK (public.is_team_member());

-- ═══ Messages ══════════════════════════════════════════════════════════

-- Two more notices down the pipe 0012, 0033 and 0043 already use. A query is
-- pinged into the thread the moment it is asked -- that is the whole point of
-- an informal question -- and a decision landing on you is worth the same tap
-- on the shoulder that a task landing on you already gets.
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_kind_check;
ALTER TABLE public.messages ADD CONSTRAINT messages_kind_check
  CHECK (kind IN (
    'chat', 'photo', 'song',
    'task_assign', 'task_accept', 'task_pushback',
    'mention', 'query', 'decision_assign'
  ));
