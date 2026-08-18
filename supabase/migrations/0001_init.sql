-- Anvik Ops — full schema, RLS, allowlist trigger, append-only trail, storage policies.
-- Apply with: supabase db push  (or paste into the SQL editor of the project).

-- ═══ Identity and config ═══════════════════════════════════════════════

CREATE TABLE public.allowlist (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The two member addresses. Auth is Supabase email+password (no Google OAuth):
-- create these two users in Authentication → Users with temp passwords and
-- disable public signups. The trigger below still hard-rejects any other email.
INSERT INTO public.allowlist (email, name, role) VALUES
  ('anvik.anadya@gmail.com', 'Anadya', 'member'),
  ('raghuvar.anvik@gmail.com', 'Raghuvar', 'member');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  time_zone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  status_text TEXT,
  status_expires_at TIMESTAMPTZ,
  personalization JSONB NOT NULL DEFAULT '{"song":true,"photo":true,"worth_knowing":true,"life_radar":true,"projects_strip":true,"money_on_home":true}'
);

CREATE TABLE public.projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_personal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.ranking_weights (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  objective_fit INT NOT NULL DEFAULT 40,
  unblocks INT NOT NULL DEFAULT 30,
  deadline INT NOT NULL DEFAULT 30,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.ranking_weights (id) VALUES (1);

CREATE TABLE public.tags (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  color TEXT NOT NULL DEFAULT 'slate',
  created_by UUID REFERENCES public.profiles (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══ Work ══════════════════════════════════════════════════════════════

CREATE TABLE public.objectives (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES public.projects (id),
  quarter TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.key_results (
  id TEXT PRIMARY KEY,
  objective_id TEXT NOT NULL REFERENCES public.objectives (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  progress_pct INT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  position INT NOT NULL DEFAULT 0
);

CREATE TABLE public.tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 50000),
  acceptance_criteria TEXT NOT NULL DEFAULT '',
  project_id TEXT NOT NULL REFERENCES public.projects (id),
  type TEXT NOT NULL CHECK (type IN ('code_change', 'ops', 'finance', 'research')),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'in_review', 'done')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  assignee_id UUID REFERENCES public.profiles (id),
  created_by UUID REFERENCES public.profiles (id),
  start_date DATE,
  due_date DATE,
  objective_id TEXT REFERENCES public.objectives (id),
  tags TEXT[] NOT NULL DEFAULT '{}',
  progress_pct INT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  position INT NOT NULL DEFAULT 0
);

CREATE TABLE public.comments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  author_id UUID REFERENCES public.profiles (id),
  body TEXT NOT NULL CHECK (char_length(body) <= 10000),
  is_decision BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.screenshot_attachments (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  uploaded_by UUID REFERENCES public.profiles (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pin number is derived at render/export time by
-- row_number() OVER (PARTITION BY screenshot_id ORDER BY created_at) — never stored.
CREATE TABLE public.annotation_pins (
  id TEXT PRIMARY KEY,
  screenshot_id TEXT NOT NULL REFERENCES public.screenshot_attachments (id) ON DELETE CASCADE,
  x_pct NUMERIC(5, 1) NOT NULL CHECK (x_pct >= 0 AND x_pct <= 100),
  y_pct NUMERIC(5, 1) NOT NULL CHECK (y_pct >= 0 AND y_pct <= 100),
  note TEXT NOT NULL CHECK (char_length(note) <= 5000),
  author_id UUID REFERENCES public.profiles (id),
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.decisions (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES public.projects (id),
  recommendation TEXT NOT NULL DEFAULT '',
  owner_id UUID REFERENCES public.profiles (id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ruled')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ruled_at TIMESTAMPTZ,
  ruling_note TEXT NOT NULL DEFAULT ''
);

-- ═══ Knowledge ═════════════════════════════════════════════════════════

CREATE TABLE public.notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'plain' CHECK (type IN ('plain', 'checklist', 'meeting', 'voice', 'email')),
  project_id TEXT NOT NULL REFERENCES public.projects (id),
  task_id TEXT REFERENCES public.tasks (id) ON DELETE SET NULL,
  tags TEXT[] NOT NULL DEFAULT '{}',
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  transcript JSONB,
  checklist JSONB,
  source_ref TEXT,
  created_by UUID REFERENCES public.profiles (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Never store full message bodies (schema note §3.15).
CREATE TABLE public.mail_items (
  id TEXT PRIMARY KEY,
  account_email TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT NOT NULL,
  snippet TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  gmail_link TEXT NOT NULL,
  flag_reason TEXT,
  project_id TEXT REFERENCES public.projects (id),
  converted_to_type TEXT CHECK (converted_to_type IN ('task', 'note', 'decision')),
  converted_to_id TEXT
);

CREATE TABLE public.documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES public.projects (id),
  expiry_date DATE,
  deadline_note TEXT NOT NULL DEFAULT '',
  cloud_ref_url TEXT NOT NULL DEFAULT '',
  status_cache TEXT NOT NULL DEFAULT 'ok' CHECK (status_cache IN ('ok', 'soon', 'over'))
);

-- ═══ People and communication ══════════════════════════════════════════

CREATE TABLE public.people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('customer', 'vendor', 'investor', 'university', 'personal')),
  project_id TEXT REFERENCES public.projects (id),
  time_zone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  cadence_days INT NOT NULL DEFAULT 14,
  last_contact_date DATE,
  next_action TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.people_interactions (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES public.people (id) ON DELETE CASCADE,
  occurred_on DATE NOT NULL,
  summary TEXT NOT NULL,
  logged_by UUID REFERENCES public.profiles (id)
);

CREATE TABLE public.messages (
  id TEXT PRIMARY KEY,
  sender_id UUID REFERENCES public.profiles (id),
  body TEXT NOT NULL CHECK (char_length(body) <= 5000),
  task_ref_id TEXT REFERENCES public.tasks (id) ON DELETE SET NULL,
  attachment_url TEXT,
  song_ref JSONB,
  promoted_to_type TEXT CHECK (promoted_to_type IN ('task', 'note', 'decision')),
  promoted_to_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.shared_daily (
  id TEXT PRIMARY KEY,
  date DATE NOT NULL,
  song_title TEXT NOT NULL DEFAULT '',
  song_artist TEXT NOT NULL DEFAULT '',
  song_url TEXT NOT NULL DEFAULT '',
  picked_by UUID REFERENCES public.profiles (id),
  photo_url TEXT,
  photo_caption TEXT
);

-- ═══ Personal ══════════════════════════════════════════════════════════

CREATE TABLE public.courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  schedule_label TEXT NOT NULL DEFAULT '',
  is_expanded BOOLEAN NOT NULL DEFAULT false,
  position INT NOT NULL DEFAULT 0
);

CREATE TABLE public.course_items (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES public.courses (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  position INT NOT NULL DEFAULT 0
);

CREATE TABLE public.reading_queue (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'reading', 'done')),
  position INT NOT NULL DEFAULT 0
);

CREATE TABLE public.time_logs (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES public.profiles (id),
  date DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('study', 'founder')),
  minutes INT NOT NULL CHECK (minutes >= 0),
  course_id TEXT REFERENCES public.courses (id) ON DELETE SET NULL
);

CREATE TABLE public.life_admin (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES public.profiles (id),
  item TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.fixed_dates (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  date DATE NOT NULL,
  category TEXT NOT NULL DEFAULT ''
);

-- ═══ Money ═════════════════════════════════════════════════════════════

CREATE TABLE public.import_batches (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  row_count INT NOT NULL DEFAULT 0,
  duplicates_skipped INT NOT NULL DEFAULT 0,
  column_mapping JSONB NOT NULL DEFAULT '{}',
  imported_by UUID REFERENCES public.profiles (id),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.ledger (
  id TEXT PRIMARY KEY,
  date DATE NOT NULL,
  party TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  project_id TEXT NOT NULL REFERENCES public.projects (id),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  amount NUMERIC(14, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'due' CHECK (status IN ('paid', 'due', 'overdue')),
  receipt_url TEXT,
  linked_task_id TEXT REFERENCES public.tasks (id) ON DELETE SET NULL,
  import_batch_id TEXT REFERENCES public.import_batches (id) ON DELETE SET NULL
);

-- ═══ System ════════════════════════════════════════════════════════════

CREATE TABLE public.audit_trail (
  id TEXT PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id UUID REFERENCES public.profiles (id),
  actor_label TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field_name TEXT,
  old_value TEXT,
  new_value TEXT,
  source TEXT NOT NULL CHECK (source IN ('portal', 'gmail', 'plaud', 'drive', 'claude_export', 'rule'))
);

CREATE TABLE public.automation_rules (
  id TEXT PRIMARY KEY,
  trigger_label TEXT NOT NULL,
  trigger_value TEXT NOT NULL,
  action_label TEXT NOT NULL,
  action_value TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_fired_at TIMESTAMPTZ
);

CREATE TABLE public.keepalive (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pinged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.keepalive (id) VALUES (1);

CREATE TABLE public.daily_closeouts (
  id TEXT PRIMARY KEY,
  user_id UUID REFERENCES public.profiles (id),
  date DATE NOT NULL,
  shipped TEXT NOT NULL DEFAULT '',
  stuck TEXT NOT NULL DEFAULT '',
  tomorrow TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ═══ Indexes ═══════════════════════════════════════════════════════════

CREATE INDEX idx_tasks_status ON public.tasks (status);
CREATE INDEX idx_tasks_assignee ON public.tasks (assignee_id);
CREATE INDEX idx_tasks_project ON public.tasks (project_id);
CREATE INDEX idx_tasks_due ON public.tasks (due_date);
CREATE INDEX idx_subtasks_task ON public.subtasks (task_id, position);
CREATE INDEX idx_comments_task ON public.comments (task_id, created_at);
CREATE INDEX idx_pins_shot ON public.annotation_pins (screenshot_id, created_at);
CREATE INDEX idx_messages_created ON public.messages (created_at DESC);
CREATE INDEX idx_audit_occurred ON public.audit_trail (occurred_at DESC);
CREATE INDEX idx_ledger_date ON public.ledger (date DESC);
CREATE INDEX idx_people_last ON public.people (last_contact_date);

-- ═══ Security: helper, RLS, allowlist trigger, append-only trail ══════

CREATE OR REPLACE FUNCTION public.is_team_member() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.allowlist WHERE email = (auth.jwt() ->> 'email')
  );
$$;

-- RLS on every table: full access for allowlisted members, nothing for anyone else.
-- No role gating anywhere (principle 2) — both members see everything, including money.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY team_all ON public.%I FOR ALL USING (public.is_team_member()) WITH CHECK (public.is_team_member())',
      t
    );
  END LOOP;
END $$;

-- Append-only audit trail (principle 3): revoke UPDATE/DELETE at the database.
REVOKE UPDATE, DELETE ON public.audit_trail FROM authenticated, anon, PUBLIC;
CREATE POLICY audit_no_update ON public.audit_trail AS RESTRICTIVE FOR UPDATE USING (false);
CREATE POLICY audit_no_delete ON public.audit_trail AS RESTRICTIVE FOR DELETE USING (false);

-- Allowlist gate at signup — rejected by the trigger, not the UI.
CREATE OR REPLACE FUNCTION public.enforce_allowlist() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.allowlist WHERE email = NEW.email) THEN
    RAISE EXCEPTION 'This address is not on the Anvik Ops allowlist.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_allowlist();

-- Auto-provision the profile row after an allowed signup.
CREATE OR REPLACE FUNCTION public.provision_profile() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE((SELECT name FROM public.allowlist WHERE email = NEW.email), NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_provision
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.provision_profile();

-- ═══ Storage: private bucket, signed URLs only (1h expiry set client-side) ══

INSERT INTO storage.buckets (id, name, public) VALUES ('screenshots', 'screenshots', false);

CREATE POLICY "team reads screenshots" ON storage.objects FOR SELECT
  USING (bucket_id = 'screenshots' AND public.is_team_member());
CREATE POLICY "team uploads screenshots" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'screenshots' AND public.is_team_member());
CREATE POLICY "uploader deletes screenshots" ON storage.objects FOR DELETE
  USING (bucket_id = 'screenshots' AND owner = auth.uid());
