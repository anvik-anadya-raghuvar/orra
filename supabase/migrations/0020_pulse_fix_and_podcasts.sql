-- Make the news cron able to write, and give it podcasts.
--
-- 0006 granted anon INSERT and UPDATE on pulse_items so the GitHub Action
-- could write with the anon key — but a GRANT is not a policy, and the only
-- policy on the table required is_team_member(), which reads the email claim
-- of a signed-in member. The cron has no such claim, so every write it has
-- ever attempted was rejected by RLS.
--
-- Proven before writing this: impersonating anon, the insert raises 42501, and
-- the table holds exactly one row — the seed's "Waiting for the first
-- scheduled fetch" placeholder. The tile has been showing three hard-coded
-- headlines because nothing else could ever arrive.
--
-- The fix is a policy scoped as tightly as the job needs: anon may write rows
-- it marks `origin = 'auto'`, and nothing else. It cannot touch a row either of
-- you pinned by hand (`origin = 'manual'`), and it still cannot read anything.
--
-- Safe to re-run.

ALTER TABLE public.pulse_items
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'news';

ALTER TABLE public.pulse_items DROP CONSTRAINT IF EXISTS pulse_items_kind_check;
ALTER TABLE public.pulse_items ADD CONSTRAINT pulse_items_kind_check
  CHECK (kind IN ('news', 'podcast'));

CREATE INDEX IF NOT EXISTS idx_pulse_kind ON public.pulse_items (kind, published_at DESC);

-- The cron may add automated items…
DROP POLICY IF EXISTS pulse_anon_insert ON public.pulse_items;
CREATE POLICY pulse_anon_insert ON public.pulse_items FOR INSERT TO anon
  WITH CHECK (origin = 'auto');

-- …and refresh the ones it added, never a hand-pinned one.
DROP POLICY IF EXISTS pulse_anon_update ON public.pulse_items;
CREATE POLICY pulse_anon_update ON public.pulse_items FOR UPDATE TO anon
  USING (origin = 'auto') WITH CHECK (origin = 'auto');

-- No anon DELETE: the job only ever adds and refreshes.


-- The cron upserts (INSERT … ON CONFLICT DO UPDATE) so a re-run refreshes a
-- headline instead of duplicating it. Postgres has to *read* the conflicting
-- row to merge onto it, and with no SELECT policy that read fails — which
-- surfaces confusingly as "new row violates row-level security policy" on a
-- statement that is not really inserting. Verified against production: a plain
-- insert returned 201 while the identical upsert returned 42501.
--
-- So anon may read exactly the rows it is allowed to write: automated ones.
-- Hand-pinned items stay invisible to it, and it still cannot read anything a
-- signed-out visitor could not already infer from a public news feed.
DROP POLICY IF EXISTS pulse_anon_select ON public.pulse_items;
CREATE POLICY pulse_anon_select ON public.pulse_items FOR SELECT TO anon
  USING (origin = 'auto');
