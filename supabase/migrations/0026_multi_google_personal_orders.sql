-- Multiple browser-authorised Google accounts plus private Personal Orders.
-- Access tokens deliberately remain in browser memory and never enter Postgres.

-- ═══ Connected Google account metadata ═════════════════════════════════

ALTER TABLE public.integration_grants
  ADD COLUMN IF NOT EXISTS google_subject TEXT,
  ADD COLUMN IF NOT EXISTS account_email TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS gmail_history_id TEXT,
  ADD COLUMN IF NOT EXISTS initial_mail_scan_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

-- The original schema allowed one provider row per portal user. Preserve that
-- row, but let the first reconnect fill its stable Google subject.
ALTER TABLE public.integration_grants
  DROP CONSTRAINT IF EXISTS integration_grants_user_id_provider_key;

UPDATE public.integration_grants g
   SET account_email = p.email,
       display_name = CASE WHEN g.display_name = '' THEN p.name ELSE g.display_name END
  FROM public.profiles p
 WHERE g.user_id = p.id
   AND g.account_email IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_grants_google_subject
  ON public.integration_grants (user_id, provider, google_subject)
  WHERE google_subject IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_grants_google_email
  ON public.integration_grants (user_id, provider, lower(account_email))
  WHERE account_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_integration_grants_owner_active
  ON public.integration_grants (user_id, is_active);

DROP POLICY IF EXISTS team_all ON public.integration_grants;
DROP POLICY IF EXISTS own_all ON public.integration_grants;
CREATE POLICY own_all ON public.integration_grants FOR ALL
  USING (public.is_team_member() AND user_id = auth.uid())
  WITH CHECK (public.is_team_member() AND user_id = auth.uid());

-- ═══ Account-aware synced rows ═════════════════════════════════════════

ALTER TABLE public.mail_items
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.profiles (id),
  ADD COLUMN IF NOT EXISTS integration_grant_id TEXT REFERENCES public.integration_grants (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gmail_message_id TEXT,
  ADD COLUMN IF NOT EXISTS gmail_thread_id TEXT;

UPDATE public.mail_items m
   SET owner_id = p.id
  FROM public.profiles p
 WHERE m.owner_id IS NULL
   AND lower(m.account_email) = lower(p.email);

UPDATE public.mail_items
   SET gmail_message_id = substring(id from 4)
 WHERE gmail_message_id IS NULL AND id LIKE 'gm-%';

UPDATE public.mail_items m
   SET integration_grant_id = g.id
  FROM public.integration_grants g
 WHERE m.integration_grant_id IS NULL
   AND m.owner_id = g.user_id
   AND lower(m.account_email) = lower(coalesce(g.account_email, ''));

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_account_message
  ON public.mail_items (integration_grant_id, gmail_message_id)
  WHERE integration_grant_id IS NOT NULL AND gmail_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mail_owner_received
  ON public.mail_items (owner_id, received_at DESC);

DROP POLICY IF EXISTS team_all ON public.mail_items;
DROP POLICY IF EXISTS own_all ON public.mail_items;
CREATE POLICY own_all ON public.mail_items FOR ALL
  USING (public.is_team_member() AND owner_id = auth.uid())
  WITH CHECK (public.is_team_member() AND owner_id = auth.uid());

ALTER TABLE public.day_events
  ADD COLUMN IF NOT EXISTS integration_grant_id TEXT REFERENCES public.integration_grants (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_event_id TEXT,
  ADD COLUMN IF NOT EXISTS account_email TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT;

UPDATE public.day_events e
   SET external_event_id = substring(e.id from 6),
       integration_grant_id = g.id,
       account_email = g.account_email
  FROM public.integration_grants g
 WHERE e.id LIKE 'gcal-%'
   AND e.user_id = g.user_id
   AND e.integration_grant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_day_event_account_external
  ON public.day_events (integration_grant_id, external_event_id)
  WHERE integration_grant_id IS NOT NULL AND external_event_id IS NOT NULL;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES public.profiles (id),
  ADD COLUMN IF NOT EXISTS integration_grant_id TEXT REFERENCES public.integration_grants (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS account_email TEXT;

-- ═══ Personal Orders ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.personal_orders (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  integration_grant_id TEXT REFERENCES public.integration_grants (id) ON DELETE SET NULL,
  account_email TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('physical', 'travel')),
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'confirmed', 'dismissed')),
  lifecycle_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (lifecycle_status IN (
      'unknown', 'ordered', 'processing', 'shipped', 'out_for_delivery',
      'delivered', 'booked', 'changed', 'completed', 'cancelled',
      'return_started', 'returned', 'refund_pending', 'refunded'
    )),
  merchant TEXT NOT NULL DEFAULT '' CHECK (char_length(merchant) <= 300),
  external_reference TEXT CHECK (char_length(external_reference) <= 300),
  summary TEXT NOT NULL DEFAULT '' CHECK (char_length(summary) <= 2000),
  amount NUMERIC(14, 2) CHECK (amount IS NULL OR amount >= 0),
  currency TEXT CHECK (currency IS NULL OR char_length(currency) <= 8),
  next_event_at TIMESTAMPTZ,
  details JSONB NOT NULL DEFAULT '{}',
  manual_fields TEXT[] NOT NULL DEFAULT '{}',
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES public.profiles (id),
  last_event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.personal_order_events (
  id TEXT PRIMARY KEY,
  -- No cascading delete: parsed evidence is immutable once recorded.
  order_id TEXT NOT NULL REFERENCES public.personal_orders (id),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  integration_grant_id TEXT REFERENCES public.integration_grants (id) ON DELETE SET NULL,
  gmail_message_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'unknown', 'ordered', 'processing', 'shipped', 'out_for_delivery',
    'delivered', 'booked', 'changed', 'completed', 'cancelled',
    'return_started', 'returned', 'refund_pending', 'refunded'
  )),
  event_at TIMESTAMPTZ NOT NULL,
  sender TEXT NOT NULL CHECK (char_length(sender) <= 500),
  subject TEXT NOT NULL CHECK (char_length(subject) <= 1000),
  source_url TEXT NOT NULL CHECK (char_length(source_url) <= 2000),
  detection_reason TEXT NOT NULL CHECK (char_length(detection_reason) <= 1000),
  confidence NUMERIC(4, 3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  parsed_fields JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_order_event_message
  ON public.personal_order_events (integration_grant_id, gmail_message_id)
  WHERE integration_grant_id IS NOT NULL AND gmail_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_personal_orders_review
  ON public.personal_orders (user_id, review_status, next_event_at);
CREATE INDEX IF NOT EXISTS idx_personal_orders_reference
  ON public.personal_orders (user_id, integration_grant_id, external_reference)
  WHERE external_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_personal_order_events_order
  ON public.personal_order_events (order_id, event_at DESC);

ALTER TABLE public.personal_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_order_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS own_all ON public.personal_orders;
CREATE POLICY own_all ON public.personal_orders FOR ALL
  USING (public.is_team_member() AND user_id = auth.uid())
  WITH CHECK (
    public.is_team_member()
    AND user_id = auth.uid()
    AND (
      integration_grant_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.integration_grants g
        WHERE g.id = integration_grant_id AND g.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS own_select ON public.personal_order_events;
DROP POLICY IF EXISTS own_insert ON public.personal_order_events;
CREATE POLICY own_select ON public.personal_order_events FOR SELECT
  USING (public.is_team_member() AND user_id = auth.uid());
CREATE POLICY own_insert ON public.personal_order_events FOR INSERT
  WITH CHECK (
    public.is_team_member()
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.personal_orders o
      WHERE o.id = order_id AND o.user_id = auth.uid()
    )
    AND (
      integration_grant_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.integration_grants g
        WHERE g.id = integration_grant_id AND g.user_id = auth.uid()
      )
    )
  );

GRANT ALL ON public.personal_orders TO authenticated;
GRANT SELECT, INSERT ON public.personal_order_events TO authenticated;
REVOKE UPDATE, DELETE ON public.personal_order_events FROM authenticated, anon;

COMMENT ON TABLE public.personal_order_events IS
  'Append-only parsed Gmail evidence. Raw message bodies, HTML, attachments and OAuth tokens are forbidden.';
