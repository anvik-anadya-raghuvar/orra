-- Your phone buzzes, even with everything closed.
--
-- Until now nothing could reach either of you unless a portal tab happened to
-- be open: the bell (0038's neighbour, ui/notifications.tsx) only exists while
-- the app is running, and the browser Notification it fires is suppressed the
-- moment the tab is in front. Which meant the one case that matters -- the app
-- shut, the phone in a pocket, a message or a deadline arriving -- reached
-- nobody.
--
-- Web Push fixes exactly that, and costs nothing: the delivery is done by the
-- browser vendors' own push services, so there is no third-party service and
-- no recurring bill. What this table holds is the addressing information for
-- each device that has opted in.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  -- The push service URL for this device. Unique because a browser may hand
  -- back the same endpoint after a re-subscribe, and a duplicate would mean
  -- the same phone buzzing twice for one message.
  endpoint TEXT NOT NULL UNIQUE CHECK (char_length(endpoint) <= 1000),
  -- RFC 8291 encryption material. Without both, a payload cannot be sealed
  -- for this device.
  p256dh TEXT NOT NULL CHECK (char_length(p256dh) <= 200),
  auth TEXT NOT NULL CHECK (char_length(auth) <= 100),
  -- Which device this is, in words, so a list of three subscriptions is
  -- something a person can actually manage.
  label TEXT NOT NULL DEFAULT 'This device' CHECK (char_length(label) <= 120),
  -- Set when a push service reports the subscription gone (404/410), so a
  -- dead device stops being retried without losing the record of it.
  expired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON public.push_subscriptions (user_id, expired_at);

-- Same rule as every other table here (principle 2, no role gating): both
-- allowlisted members, full access, nobody else anything. A subscription is
-- addressing information, not a secret -- and the pair share everything else.
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_all ON public.push_subscriptions;
CREATE POLICY team_all ON public.push_subscriptions FOR ALL
  USING (public.is_team_member())
  WITH CHECK (public.is_team_member());

-- ═══ Delivery log ══════════════════════════════════════════════════════
-- A push that silently fails is worse than no push at all, because you stop
-- checking. Every send lands here with its outcome, so "did that arrive?" is
-- answerable rather than a shrug.
CREATE TABLE IF NOT EXISTS public.push_log (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES public.profiles (id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (char_length(kind) <= 40),
  title TEXT NOT NULL CHECK (char_length(title) <= 200),
  body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 500),
  -- 'sent' | 'no_devices' | 'failed'
  outcome TEXT NOT NULL CHECK (char_length(outcome) <= 40),
  detail TEXT CHECK (detail IS NULL OR char_length(detail) <= 500),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_log_sent ON public.push_log (sent_at DESC);

ALTER TABLE public.push_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_read ON public.push_log;
CREATE POLICY team_read ON public.push_log FOR SELECT
  USING (public.is_team_member());
-- Written by the edge function under the service role, which bypasses RLS;
-- no client insert policy, so the log cannot be forged from a browser.
