-- Files, anywhere.
--
-- Until now the portal could hold a picture and nothing else. Screenshots
-- belong to a task, moments belong to the Us thread, note images live inline
-- in the note row — three separate image paths, none of which will take the
-- one thing this pair actually has to keep between two countries: a PDF. A
-- visa appointment letter, a signed contract, a rent receipt, the fee
-- statement the university sent, the spreadsheet the numbers came out of.
-- Those were being kept in a chat app and a downloads folder.
--
-- One table, one bucket, and a polymorphic parent, because the answer to
-- "where can I attach a file" has to be "wherever you are". A per-parent
-- column (task_id, note_id, page_id, …) would mean a migration and a new form
-- every time another room learns to hold paperwork.
--
-- Deliberately NOT how images work. An image is small, compressed in the
-- browser and stored inline as base64 because it is part of the thing it is
-- on. A file is arbitrary and can be tens of megabytes, so the bytes go to
-- private storage and only the reference is a row — which also keeps the
-- Postgres free tier out of the equation entirely.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.attachments (
  id TEXT PRIMARY KEY,
  -- The parent, as a pair. No foreign key is possible across many tables, so
  -- the pairing is enforced by the app and cleaned up by it too; the check
  -- below at least stops a typo becoming a permanent orphan nobody can find.
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'task', 'note', 'page', 'decision', 'person', 'ledger_entry',
    'personal_order', 'document', 'course', 'fixed_date', 'life_admin_item'
  )),
  entity_id TEXT NOT NULL,
  filename TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 260),
  mime TEXT NOT NULL CHECK (char_length(mime) <= 120),
  -- Server-side input cap, per the security gate. 25 MB is comfortably more
  -- than any document this pair actually exchanges and small enough that the
  -- 1 GB free storage tier holds hundreds of them.
  bytes BIGINT NOT NULL CHECK (bytes > 0 AND bytes <= 25 * 1024 * 1024),
  -- Path inside the `files` bucket: <uploader uuid>/<attachment id>/<name>.
  storage_path TEXT NOT NULL CHECK (char_length(storage_path) <= 1024),
  -- Optional one-line "what this is", so a list of PDFs is readable.
  caption TEXT CHECK (caption IS NULL OR char_length(caption) <= 300),
  uploaded_by UUID REFERENCES public.profiles (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every read is "the files on this thing", so that is the index.
CREATE INDEX IF NOT EXISTS idx_attachments_entity
  ON public.attachments (entity_type, entity_id, created_at DESC);

-- Same rule as every other table (principle 2, no role gating): both
-- allowlisted members, full access, nobody else anything.
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_all ON public.attachments;
CREATE POLICY team_all ON public.attachments FOR ALL
  USING (public.is_team_member())
  WITH CHECK (public.is_team_member());

-- ═══ Storage: the `files` bucket ═══════════════════════════════════════

-- Private, like every other bucket here. Reads go through short-lived signed
-- URLs, so knowing a path is not the same as being able to fetch it.
INSERT INTO storage.buckets (id, name, public)
VALUES ('files', 'files', false)
ON CONFLICT (id) DO NOTHING;

-- Both members read everything: a document attached to a shared decision is
-- pointless if only the uploader can open it. Writing and deleting stay
-- inside the uploader's own folder, so neither can overwrite the other's.
DROP POLICY IF EXISTS files_read ON storage.objects;
CREATE POLICY files_read ON storage.objects FOR SELECT
  USING (bucket_id = 'files' AND public.is_team_member());

DROP POLICY IF EXISTS files_insert ON storage.objects;
CREATE POLICY files_insert ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'files'
    AND public.is_team_member()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS files_update ON storage.objects;
CREATE POLICY files_update ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'files'
    AND public.is_team_member()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS files_delete ON storage.objects;
CREATE POLICY files_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'files'
    AND public.is_team_member()
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
