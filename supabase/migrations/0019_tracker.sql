-- Money becomes the Tracker: who paid, what kind of spend, and subscriptions.
--
-- The ledger recorded an amount and a direction but never who actually paid
-- it, which between two founders is the first thing either of you asks. It
-- also could not tell a one-off from something that renews, so "what do we
-- spend every month" was a question the screen could not answer.
--
-- `split_pct` is bookkeeping colour, not a debt ledger: it records that an
-- expense was shared and roughly how, and nothing in the portal computes what
-- one of you owes the other. That was an explicit decision — this is a record
-- of cash in and cash out, not a settlement system.
--
-- Safe to re-run.

ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES public.profiles (id),
  ADD COLUMN IF NOT EXISTS split_pct INT,
  ADD COLUMN IF NOT EXISTS expense_kind TEXT;

ALTER TABLE public.ledger DROP CONSTRAINT IF EXISTS ledger_split_pct_check;
ALTER TABLE public.ledger ADD CONSTRAINT ledger_split_pct_check
  CHECK (split_pct IS NULL OR (split_pct >= 0 AND split_pct <= 100));

ALTER TABLE public.ledger DROP CONSTRAINT IF EXISTS ledger_expense_kind_check;
ALTER TABLE public.ledger ADD CONSTRAINT ledger_expense_kind_check
  CHECK (expense_kind IS NULL OR expense_kind IN ('one_time', 'recurring'));

CREATE INDEX IF NOT EXISTS idx_ledger_date ON public.ledger (date DESC);

-- ═══ Subscriptions ═════════════════════════════════════════════════════

-- Shared, like the rest of the money room: a renewal charges the company
-- whoever's card is on it.
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) <= 200),
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  billing_cycle TEXT NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'yearly', 'one_off')),
  -- The date it next renews or lapses. This is the whole point of the table:
  -- a renewal that surprises you has already cost you money.
  ends_on DATE,
  url TEXT,
  project_id TEXT REFERENCES public.projects (id) ON DELETE SET NULL,
  paid_by UUID REFERENCES public.profiles (id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_ends ON public.subscriptions (ends_on);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_all ON public.subscriptions;
CREATE POLICY team_all ON public.subscriptions FOR ALL
  USING (public.is_team_member()) WITH CHECK (public.is_team_member());

GRANT ALL ON public.subscriptions TO authenticated;
GRANT SELECT ON public.subscriptions TO anon;
