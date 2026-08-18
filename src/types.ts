/** Entity model — mirrors supabase/migrations/0001_init.sql exactly. */

export type UserId = string; // profile id
export type TaskType = 'code_change' | 'ops' | 'finance' | 'research';
export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';
export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';
export type RelationshipType = 'customer' | 'vendor' | 'investor' | 'university' | 'personal';
export type NoteType = 'plain' | 'checklist' | 'meeting' | 'voice' | 'email';
export type AuditSource = 'portal' | 'gmail' | 'plaud' | 'drive' | 'claude_export' | 'rule';

export interface Profile {
  id: UserId;
  email: string;
  /** Mock-mode only: local password (never synced to Supabase, never audited). */
  password?: string;
  name: string;
  avatar_url: string | null;
  time_zone: string;
  status_text: string | null;
  status_expires_at: string | null;
  personalization: Personalization;
}

export interface Personalization {
  song: boolean;
  photo: boolean;
  worth_knowing: boolean;
  life_radar: boolean;
  projects_strip: boolean;
  money_on_home: boolean;
}

export interface Project {
  id: string;
  name: string;
  color: string; // css color or var()
  description: string;
  is_personal: boolean;
  created_at: string;
}

export interface RankingWeights {
  id: number;
  objective_fit: number;
  unblocks: number;
  deadline: number;
  updated_at: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string; // token name: indigo | teal | stamp | rose | sky | violet | slate
  created_by: UserId;
  created_at: string;
}

export interface Objective {
  id: string;
  title: string;
  project_id: string;
  quarter: string;
  created_at: string;
}

export interface KeyResult {
  id: string;
  objective_id: string;
  title: string;
  progress_pct: number;
  position: number;
}

export interface Task {
  id: string; // visible id, e.g. T-101
  title: string;
  description: string;
  acceptance_criteria: string;
  project_id: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: UserId | null;
  created_by: UserId;
  start_date: string | null; // YYYY-MM-DD
  due_date: string | null;
  objective_id: string | null;
  tags: string[];
  progress_pct: number;
  created_at: string;
  updated_at: string;
}

export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  completed: boolean;
  position: number;
}

export interface Comment {
  id: string;
  task_id: string;
  author_id: UserId;
  body: string;
  is_decision: boolean;
  created_at: string;
}

export interface ScreenshotAttachment {
  id: string;
  task_id: string;
  storage_path: string;
  filename: string;
  mime: string;
  width: number;
  height: number;
  uploaded_by: UserId;
  created_at: string;
  /** mock adapter only: data URL for local preview */
  data_url?: string;
}

export interface AnnotationPin {
  id: string;
  screenshot_id: string;
  x_pct: number; // 0–100, one decimal
  y_pct: number;
  note: string;
  author_id: UserId;
  is_resolved: boolean;
  created_at: string;
}

export interface Decision {
  id: string;
  question: string;
  project_id: string;
  recommendation: string;
  owner_id: UserId;
  status: 'open' | 'ruled';
  opened_at: string;
  ruled_at: string | null;
  ruling_note: string;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  type: NoteType;
  project_id: string;
  task_id: string | null;
  tags: string[];
  is_pinned: boolean;
  transcript: TranscriptLine[] | null;
  checklist: ChecklistItem[] | null;
  source_ref: string | null;
  created_by: UserId;
  created_at: string;
}
export interface TranscriptLine {
  at: string; // "MM:SS"
  text: string;
}
export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface MailItem {
  id: string;
  account_email: string;
  sender: string;
  subject: string;
  snippet: string;
  received_at: string;
  gmail_link: string;
  flag_reason: string | null;
  project_id: string | null;
  converted_to_type: 'task' | 'note' | 'decision' | null;
  converted_to_id: string | null;
}

export interface DocumentRef {
  id: string;
  title: string;
  project_id: string;
  expiry_date: string | null;
  deadline_note: string;
  cloud_ref_url: string;
  status_cache: 'ok' | 'soon' | 'over';
}

export interface Person {
  id: string;
  name: string;
  role: string;
  relationship_type: RelationshipType;
  project_id: string | null;
  time_zone: string;
  cadence_days: number;
  last_contact_date: string | null; // YYYY-MM-DD
  next_action: string;
  notes: string;
  created_at: string;
}

export interface PersonInteraction {
  id: string;
  person_id: string;
  occurred_on: string;
  summary: string;
  logged_by: UserId;
}

export interface Message {
  id: string;
  sender_id: UserId;
  body: string;
  task_ref_id: string | null;
  attachment_url: string | null;
  song_ref: { title: string; artist: string; url: string } | null;
  promoted_to_type: 'task' | 'note' | 'decision' | null;
  promoted_to_id: string | null;
  created_at: string;
}

export interface SharedDaily {
  id: string;
  date: string;
  song_title: string;
  song_artist: string;
  song_url: string;
  picked_by: UserId;
  photo_url: string | null;
  photo_caption: string | null;
}

export interface Course {
  id: string;
  title: string;
  schedule_label: string;
  is_expanded: boolean;
  position: number;
}
export interface CourseItem {
  id: string;
  course_id: string;
  title: string;
  completed: boolean;
  position: number;
}
export interface ReadingItem {
  id: string;
  title: string;
  author: string;
  status: 'queued' | 'reading' | 'done';
  position: number;
}
export interface TimeLog {
  id: string;
  user_id: UserId;
  date: string;
  kind: 'study' | 'founder';
  minutes: number;
  course_id: string | null;
}
export interface LifeAdminItem {
  id: string;
  user_id: UserId;
  item: string;
  completed: boolean;
  created_at: string;
}
export interface FixedDate {
  id: string;
  label: string;
  date: string;
  category: string;
}

export interface LedgerEntry {
  id: string;
  date: string;
  party: string;
  category: string;
  project_id: string;
  direction: 'in' | 'out';
  amount: number;
  status: 'paid' | 'due' | 'overdue';
  receipt_url: string | null;
  linked_task_id: string | null;
  import_batch_id: string | null;
}
export interface ImportBatch {
  id: string;
  filename: string;
  row_count: number;
  duplicates_skipped: number;
  column_mapping: Record<string, string>;
  imported_by: UserId;
  imported_at: string;
}

export interface AuditEntry {
  id: string;
  occurred_at: string;
  actor_id: UserId | null;
  actor_label: string;
  entity_type: string;
  entity_id: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  source: AuditSource;
}

export interface AutomationRule {
  id: string;
  trigger_label: string;
  trigger_value: string;
  action_label: string;
  action_value: string;
  is_active: boolean;
  last_fired_at: string | null;
}

export interface DailyCloseout {
  id: string;
  user_id: UserId;
  date: string;
  shipped: string;
  stuck: string;
  tomorrow: string;
  created_at: string;
}

/** The whole in-memory dataset the store holds. */
export interface Dataset {
  profiles: Profile[];
  projects: Project[];
  ranking_weights: RankingWeights;
  tags: Tag[];
  objectives: Objective[];
  key_results: KeyResult[];
  tasks: Task[];
  subtasks: Subtask[];
  comments: Comment[];
  screenshot_attachments: ScreenshotAttachment[];
  annotation_pins: AnnotationPin[];
  decisions: Decision[];
  notes: Note[];
  mail_items: MailItem[];
  documents: DocumentRef[];
  people: Person[];
  people_interactions: PersonInteraction[];
  messages: Message[];
  shared_daily: SharedDaily[];
  courses: Course[];
  course_items: CourseItem[];
  reading_queue: ReadingItem[];
  time_logs: TimeLog[];
  life_admin: LifeAdminItem[];
  fixed_dates: FixedDate[];
  ledger: LedgerEntry[];
  import_batches: ImportBatch[];
  audit_trail: AuditEntry[];
  automation_rules: AutomationRule[];
  daily_closeouts: DailyCloseout[];
}

export type CollectionKey = keyof Omit<Dataset, 'ranking_weights'>;
