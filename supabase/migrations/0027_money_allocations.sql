-- Money records founder contributions and business expenses. Splits must be
-- exact amounts, not a percentage note, and an expense may point at a dated
-- renewal tracker. Safe to re-run.

ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS payer_allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS comments TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ends_on DATE,
  ADD COLUMN IF NOT EXISTS subscription_id TEXT
    REFERENCES public.subscriptions (id) ON DELETE SET NULL;

ALTER TABLE public.ledger DROP CONSTRAINT IF EXISTS ledger_payer_allocations_array;
ALTER TABLE public.ledger ADD CONSTRAINT ledger_payer_allocations_array
  CHECK (jsonb_typeof(payer_allocations) = 'array');

ALTER TABLE public.ledger DROP CONSTRAINT IF EXISTS ledger_comments_bounded;
ALTER TABLE public.ledger ADD CONSTRAINT ledger_comments_bounded
  CHECK (char_length(comments) <= 2000);

CREATE INDEX IF NOT EXISTS idx_ledger_subscription
  ON public.ledger (subscription_id)
  WHERE subscription_id IS NOT NULL;

COMMENT ON COLUMN public.ledger.payer_allocations IS
  'Exact [{user_id, amount}] allocations. The client validates that their sum equals ledger.amount.';
COMMENT ON COLUMN public.ledger.ends_on IS
  'Optional service/renewal end date. Required by the client before an expense can become a subscription.';
