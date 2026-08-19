-- Custom block timers, team-visible live presence, and canonical task ↔ decision links.

ALTER TABLE public.active_blocks DROP CONSTRAINT IF EXISTS active_blocks_scope_check;
ALTER TABLE public.active_blocks ADD CONSTRAINT active_blocks_scope_check
  CHECK (scope IN ('founder', 'study', 'personal', 'today_plan', 'intentions', 'custom'));

ALTER TABLE public.active_blocks
  ADD COLUMN IF NOT EXISTS custom_label TEXT,
  ADD COLUMN IF NOT EXISTS custom_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS log_kind TEXT;

ALTER TABLE public.active_blocks DROP CONSTRAINT IF EXISTS active_blocks_custom_items_array;
ALTER TABLE public.active_blocks ADD CONSTRAINT active_blocks_custom_items_array
  CHECK (jsonb_typeof(custom_items) = 'array');
ALTER TABLE public.active_blocks DROP CONSTRAINT IF EXISTS active_blocks_log_kind_check;
ALTER TABLE public.active_blocks ADD CONSTRAINT active_blocks_log_kind_check
  CHECK (log_kind IS NULL OR log_kind IN ('founder', 'study', 'personal'));

-- Running a block is live presence for the two-person workspace. Everyone on
-- the team may read it; only the person whose clock it is may mutate it.
DROP POLICY IF EXISTS own_all ON public.active_blocks;
DROP POLICY IF EXISTS team_read ON public.active_blocks;
DROP POLICY IF EXISTS own_insert ON public.active_blocks;
DROP POLICY IF EXISTS own_update ON public.active_blocks;
DROP POLICY IF EXISTS own_delete ON public.active_blocks;
CREATE POLICY team_read ON public.active_blocks FOR SELECT
  USING (public.is_team_member());
CREATE POLICY own_insert ON public.active_blocks FOR INSERT
  WITH CHECK (public.is_team_member() AND user_id = auth.uid());
CREATE POLICY own_update ON public.active_blocks FOR UPDATE
  USING (public.is_team_member() AND user_id = auth.uid())
  WITH CHECK (public.is_team_member() AND user_id = auth.uid());
CREATE POLICY own_delete ON public.active_blocks FOR DELETE
  USING (public.is_team_member() AND user_id = auth.uid());

ALTER TABLE public.decisions
  ADD COLUMN IF NOT EXISTS task_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.decisions DROP CONSTRAINT IF EXISTS decisions_task_ids_array;
ALTER TABLE public.decisions ADD CONSTRAINT decisions_task_ids_array
  CHECK (jsonb_typeof(task_ids) = 'array');

ALTER TABLE public.comments
  ADD COLUMN IF NOT EXISTS decision_id TEXT REFERENCES public.decisions (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_comments_decision ON public.comments (decision_id);
