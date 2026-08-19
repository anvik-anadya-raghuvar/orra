-- Sending a photo or a song to the other person.
--
-- The shared daily ritual is retired: one photo and one song per date that
-- both people saw, with no sender and no reply. What was actually wanted is
-- directed — "Raghuvar shared a moment", "Raghuvar suggested this song" —
-- and repliable where it lands.
--
-- Everything rides `messages`, which already has kind (0012) plus the
-- attachment_url and song_ref columns that have sat unused since 0001. That
-- means the bell, unread counts, realtime, read receipts and the Us thread all
-- work for a sent photo without a second notification system.
--
-- Photo bytes go to Storage, not into a Postgres row. shared_daily has been
-- keeping ~200KB base64 data URLs inline; a handful is fine, a year of daily
-- sends is not, on a 500MB free tier.
--
-- Safe to re-run.

-- A reply points at the moment it answers, so the Home widget can show the
-- exchange without opening Us.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id TEXT REFERENCES public.messages (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON public.messages (reply_to_id);
CREATE INDEX IF NOT EXISTS idx_messages_kind_created ON public.messages (kind, created_at DESC);

-- ═══ Storage: the `moments` bucket ═════════════════════════════════════

-- Private. Reads go through short-lived signed URLs, so an object is not
-- fetchable by anyone who happens to learn its path.
INSERT INTO storage.buckets (id, name, public)
VALUES ('moments', 'moments', false)
ON CONFLICT (id) DO NOTHING;

-- Both members can read every moment: they are sent between exactly these two
-- people, and the recipient obviously has to see them. Writes and deletes are
-- restricted to the uploader's own folder, so neither can overwrite or remove
-- the other's.
DROP POLICY IF EXISTS moments_read ON storage.objects;
CREATE POLICY moments_read ON storage.objects FOR SELECT
  USING (bucket_id = 'moments' AND public.is_team_member());

DROP POLICY IF EXISTS moments_insert ON storage.objects;
CREATE POLICY moments_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'moments'
    AND public.is_team_member()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS moments_update ON storage.objects;
CREATE POLICY moments_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'moments'
    AND public.is_team_member()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS moments_delete ON storage.objects;
CREATE POLICY moments_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'moments'
    AND public.is_team_member()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
