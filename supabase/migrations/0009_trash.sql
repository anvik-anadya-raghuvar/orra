-- Trash: every delete in the app becomes recoverable, not just the demo purge.
-- Safe to re-run.

-- The full row as it was the instant before removal, so Restore can put it
-- back byte-for-byte rather than reconstructing it from an audit summary.
-- Unlike audit_trail this is a normal table — UPDATE/DELETE stay available,
-- because "permanently delete" and "restore" are both real actions here.
CREATE TABLE IF NOT EXISTS public.trash_items (
  id TEXT PRIMARY KEY,
  collection TEXT NOT NULL,
  row_id TEXT NOT NULL,
  row_data JSONB NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  deleted_by UUID REFERENCES public.profiles (id),
  deleted_by_label TEXT NOT NULL DEFAULT '',
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trash_items_deleted_at ON public.trash_items (deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_trash_items_collection ON public.trash_items (collection);

ALTER TABLE public.trash_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- No role gating (principle 2): either of you can see and restore anything
  -- either of you deleted.
  CREATE POLICY team_all ON public.trash_items
    FOR ALL USING (public.is_team_member()) WITH CHECK (public.is_team_member());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT ALL ON public.trash_items TO authenticated;
