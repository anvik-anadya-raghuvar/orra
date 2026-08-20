/** Entity model — mirrors supabase/migrations/0001_init.sql exactly. */

export type UserId = string; // profile id
export type TaskType = 'code_change' | 'ops' | 'finance' | 'research';
/** How much brain a task costs. Matched against the day's declared capacity. */
export type Effort = 'light' | 'medium' | 'heavy';
/** Declared capacity for the day — "how heavy do I want today to be". */
export type Capacity = 'light' | 'medium' | 'heavy';
/** Board columns. `backlog` is the unscheduled pool; `in_review` is kept
 *  deliberately — the ranking engine scores it as "closing this unblocks the
 *  other person", which is a real signal a 4-column board would throw away. */
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done';
/** Stored names are unchanged; P0–P3 is a display label over the same values
 *  (see PRIORITY_LABEL), so adopting Jira's vocabulary costs no migration. */
export type TaskPriority = 'urgent' | 'high' | 'normal' | 'low';
export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  urgent: 'P0',
  high: 'P1',
  normal: 'P2',
  low: 'P3',
};

/** How one task relates to another. Parent/child gives real subtasks. */
export type TaskLinkType = 'blocks' | 'blocked_by' | 'related' | 'child_of';
export interface TaskLink {
  id: string;
  from_task_id: string;
  to_task_id: string;
  type: TaskLinkType;
  created_by: UserId;
  created_at: string;
}

/** A sprint groups work in time. 'backlog' is the always-present catch-all. */
export interface Sprint {
  id: string;
  name: string;
  starts_on: string | null;
  ends_on: string | null;
  is_archived: boolean;
  position: number;
}
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
  /** Home utilities are opt-out so existing profiles receive them without a
   * migration rewriting every personalization JSON document. */
  weather_on_home?: boolean;
  world_clocks_on_home?: boolean;
  calendar_on_home?: boolean;
  weather_place?: {
    label: string;
    latitude: number;
    longitude: number;
    time_zone: string;
  } | null;
  world_clocks?: { label: string; time_zone: string }[];
  /** How this user has arranged their own Home grid. Absent means "however the
   *  packer lays it out", which is what a fresh account gets. A preference,
   *  never a permission — the other user's Home is unaffected by anything in
   *  here, exactly like the widget toggles above it. */
  home_layout?: HomeLayout;
  /** Which Personal widgets this user keeps. Personal has to fit two different
   *  lives — one with a degree in it, one without — so the whole room is
   *  composable rather than built around whichever life came first. Absent
   *  means "the defaults", which show everything. */
  personal_widgets?: Record<string, boolean>;
  /** How this user has arranged their own Personal grid. */
  personal_layout?: HomeLayout;
}

export interface HomeLayout {
  /** Tile keys in the order they are laid out. Keys that no longer exist are
   *  ignored on read; tiles absent from the list keep their declared position
   *  relative to the tiles around them, so a new widget never has to be
   *  re-placed by hand after an update. */
  order: string[];
  /** Explicit span overrides per tile key, as [columns, rows] at the four-column
   *  desktop grid. Narrower grids clamp these down rather than storing a second
   *  set, so there is exactly one arrangement to reason about. */
  size: Record<string, [number, number]>;
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
  /** Which sprint this sits in. Null = the backlog. */
  sprint_id: string | null;
  /** Manual order inside a board column, so drag-to-reorder sticks. */
  board_order: number;
  /** Founder-life metadata — drives capacity matching and the stuck zone. */
  effort: Effort;
  estimate_minutes: number;
  impact: number; // 1–5, leverage
  is_stuck: boolean;
  blocked_reason: string | null;
  /** Set when the assignee accepts work the other person pushed at them.
   *  Absent or null while it still sits in their "Assigned to you" inbox —
   *  optional so every task-creation site does not have to write it. */
  acknowledged_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** One row per user per day: declared capacity, intention, and win conditions. */
export interface DayPlan {
  id: string;
  user_id: UserId;
  date: string; // YYYY-MM-DD
  capacity: Capacity;
  intention: string;
  wins: WinCondition[];
  created_at: string;
}
export interface WinCondition {
  text: string;
  done: boolean;
}

/**
 * One line of today's intentions. Either a typed line (`task_id` null) or a
 * pointer at real work — ticking one of those closes the task itself, because
 * the task row is the single source of truth (principle 10).
 */
export interface DayPlanItem {
  id: string;
  user_id: UserId;
  date: string; // YYYY-MM-DD
  task_id: string | null;
  text: string;
  done: boolean;
  position: number;
  /** 'manual' typed · 'task' promoted from a task · 'planner' saved from the plan. */
  source: 'manual' | 'task' | 'planner';
  created_at: string;
}

/** A block on today's timeline — meetings, protected study, focus blocks. */
export interface DayEvent {
  id: string;
  user_id: UserId | null; // null = shared
  date: string;
  start_min: number; // minutes from midnight, local
  end_min: number;
  label: string;
  kind: 'focus' | 'meeting' | 'study' | 'admin' | 'personal';
  task_id: string | null;
  /** Present for events mirrored from a connected Google account. */
  integration_grant_id?: string | null;
  external_event_id?: string | null;
  account_email?: string | null;
  source_url?: string | null;
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
  /** When a comment raised a real decision, this points at the canonical row. */
  decision_id?: string | null;
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

/** What kind of change a pin is asking for. Free-form on purpose — these are
 *  the common ones the UI offers, not a closed set stored as an enum. */
export const PIN_LABELS = ['bug', 'copy', 'layout', 'styling', 'logic', 'question'] as const;

export interface AnnotationPin {
  id: string;
  screenshot_id: string;
  x_pct: number; // 0–100, one decimal
  y_pct: number;
  /** The requested change, in the author's words. */
  note: string;
  /** Category, e.g. 'bug' or 'copy'. Empty when uncategorised. */
  label: string;
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
  /** Tasks that need or are governed by this decision. Kept on the canonical
   * decision row so Decisions and task editors are always the same view. */
  task_ids?: string[];
}

/**
 * An image kept inline on the row that owns it — today a note.
 *
 * Not a `screenshot_attachments` row: those exist to be annotated, are keyed
 * to a task, and are what the export engine walks. This is the plainer thing —
 * a picture you keep because the note is about it — so it lives in the note's
 * own JSONB and dies with it. `data_url` is a browser-compressed JPEG, capped
 * at 1600px and ~300 KB by src/lib/imageCompress.ts before it is ever stored.
 */
export interface AttachedImage {
  id: string;
  filename: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  data_url: string;
  created_at: string;
}

/** How many images one note may carry — mirrored by the CHECK constraint in
 *  migration 0021, which is what enforces it when the client is not writing. */
export const MAX_NOTE_IMAGES = 12;

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
  /** Absent on rows written before migration 0021 — always read through `?? []`. */
  images?: AttachedImage[] | null;
  source_ref: string | null;
  created_by: UserId;
  /** Whose workspace this sits in. Null = shared, shows for both. */
  owner_id?: UserId | null;
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
  /** Whose Notebook this belongs to. Older shared/demo rows may be null. */
  owner_id?: UserId | null;
  integration_grant_id?: string | null;
  gmail_message_id?: string | null;
  gmail_thread_id?: string | null;
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
  owner_id?: UserId | null;
  integration_grant_id?: string | null;
  account_email?: string | null;
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

/** Everything that travels between the two people rides this one table, so
 *  the bell, unread counts, realtime and read receipts work for all of it. */
export type MessageKind = 'chat' | 'photo' | 'song' | 'task_assign';

export interface Message {
  id: string;
  sender_id: UserId;
  body: string;
  /** Optional so pre-0012 rows read as plain chat. */
  kind?: MessageKind;
  /** The moment this answers, so a reply can be shown where the moment landed. */
  reply_to_id?: string | null;
  task_ref_id: string | null;
  attachment_url: string | null;
  song_ref: { title: string; artist: string; url: string } | null;
  promoted_to_type: 'task' | 'note' | 'decision' | null;
  promoted_to_id: string | null;
  /** When the *other* person read it. Null/absent = still unread. Two people
   *  only, so one column is unambiguous: the reader is never the sender.
   *  Optional so a newly-sent message is unread by omission — every creation
   *  site would otherwise have to remember to write `read_at: null`. */
  read_at?: string | null;
  /** Set once, on the first edit, and never cleared — a display flag, not a
   *  history. The actual before/after of every edit is in audit_trail. */
  edited_at?: string | null;
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
  /** Optional while older local/demo rows are still read; persisted by 0025. */
  tags?: string[];
  owner_id?: UserId | null;
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
  /** Optional while older local/demo rows are still read; persisted by 0025. */
  tags?: string[];
  owner_id?: UserId | null;
}
export interface TimeLog {
  id: string;
  user_id: UserId;
  date: string;
  /** 'personal' stays out of the study-vs-founder split bar on purpose — an
   *  errand is not founder time and must not inflate that side. */
  kind: 'study' | 'founder' | 'personal';
  minutes: number;
  course_id: string | null;
}

/** Which slice of work a block wraps around. The list is derived from this at
 *  render time, never snapshotted. */
export type BlockScope = 'founder' | 'study' | 'personal' | 'today_plan' | 'intentions' | 'custom';

/**
 * A running (or paused) block. One row per person: the whole timer state,
 * held in the database so a reload or a different device resumes it rather
 * than silently losing the session.
 */
export interface ActiveBlock {
  id: string;
  user_id: UserId;
  scope: BlockScope;
  focus_task_id: string | null;
  course_id: string | null;
  started_at: string;
  /** Set while paused; null means running. */
  paused_at: string | null;
  paused_total_sec: number;
  target_minutes: number | null;
  /** Only custom blocks snapshot their handwritten checklist; every standard
   * scope continues to derive its lines from the real tasks/items. */
  custom_label?: string | null;
  custom_items?: { id: string; text: string; done: boolean }[];
  log_kind?: TimeLog['kind'] | null;
}
export interface LifeAdminItem {
  id: string;
  user_id: UserId;
  item: string;
  completed: boolean;
  created_at: string;
}
export interface Milestone {
  text: string;
  done: boolean;
}

/**
 * An ambition that is not coursework — the other half of a personal life.
 * Progress is derived from a linked project or course where one is set, and
 * from the milestones otherwise, so it is never a number to maintain by hand.
 */
export interface PersonalGoal {
  id: string;
  user_id: UserId;
  title: string;
  /** A loose human label such as Health, Home or Learning. It is deliberately
   *  free text: this portal never forces someone's life into an enum. */
  area?: string;
  /** The reason this deserves attention now, distinct from general notes. */
  why?: string;
  /** One concrete action that can move the goal without re-planning it. */
  next_action?: string;
  /** At most three open goals should sit in Now; the rest wait in Later. */
  focus_state?: 'now' | 'later';
  /** Last deliberate review, used to keep quiet goals from going stale. */
  reviewed_at?: string | null;
  notes: string;
  target_date: string | null;
  linked_project_id: string | null;
  linked_course_id: string | null;
  milestones: Milestone[];
  status: 'open' | 'done' | 'dropped';
  position: number;
  created_at: string;
}

/** Anything pinned to the free page. No status, no due date, on purpose. */
export interface MoodItem {
  id: string;
  user_id: UserId;
  kind: 'image' | 'link' | 'quote' | 'note' | 'song';
  title: string;
  body: string;
  url: string | null;
  storage_path: string | null;
  color: string;
  position: number;
  pinned_at: string;
}

export interface FixedDate {
  id: string;
  label: string;
  date: string;
  category: string;
  owner_id?: UserId | null;
}

/**
 * A subscription. Tracked for one reason: a renewal that surprises you has
 * already cost you money.
 */
export interface Subscription {
  id: string;
  name: string;
  amount: number;
  currency: string;
  billing_cycle: 'monthly' | 'yearly' | 'one_off';
  ends_on: string | null;
  url: string | null;
  project_id: string | null;
  paid_by: UserId | null;
  is_active: boolean;
  notes: string;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  date: string;
  party: string;
  category: string;
  project_id: string;
  direction: 'in' | 'out';
  /** Who actually paid — the first thing either founder asks about a row. */
  paid_by?: UserId | null;
  /** Legacy percentage annotation. New rows use exact payer allocations. */
  split_pct?: number | null;
  /** Exact cash paid or contributed by each person. The UI requires these
   *  amounts to add up to the entry amount before it will save. */
  payer_allocations?: LedgerPayerAllocation[] | null;
  /** Context attached to this money movement. */
  comments?: string | null;
  /** Only expenses with this date can be promoted into Subscriptions. */
  ends_on?: string | null;
  /** The renewal tracker created from this expense, when applicable. */
  subscription_id?: string | null;
  /** Legacy classification retained so older rows remain readable. */
  expense_kind?: 'one_time' | 'recurring' | null;
  amount: number;
  status: 'paid' | 'due' | 'overdue';
  receipt_url: string | null;
  linked_task_id: string | null;
  import_batch_id: string | null;
}

export interface LedgerPayerAllocation {
  user_id: UserId;
  amount: number;
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

/** A "worth knowing" headline — filled by the AI-pulse cron, or pinned by hand. */
export interface PulseItem {
  id: string;
  title: string;
  source: string;
  url: string;
  published_at: string;
  origin: 'auto' | 'manual';
  /** Optional so rows written before 0020 read as news. */
  kind?: 'news' | 'podcast';
  is_pinned: boolean;
  created_at: string;
}

/* ── Wiki pages ─────────────────────────────────────────────────────── */

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'todo'
  | 'image'
  | 'code'
  | 'callout'
  | 'divider'
  | 'quote';

/** One block of a page. Kept as a discriminated-ish shape in JSONB so the
 *  editor can add block types without a migration each time. */
export interface PageBlock {
  id: string;
  type: BlockType;
  /** heading/paragraph/quote/callout/code text */
  text?: string;
  /** heading only, 1–3 */
  level?: number;
  /** list/todo items */
  items?: { text: string; done?: boolean }[];
  /** image */
  src?: string;
  alt?: string;
  /** code */
  lang?: string;
  /** callout */
  icon?: string;
  color?: string;
}

export interface Page {
  id: string;
  title: string;
  icon: string;
  parent_page_id: string | null;
  blocks: PageBlock[];
  tags: string[];
  /** Tasks this page is about; mentions like "T-45" are resolved on render. */
  linked_task_ids: string[];
  is_archived: boolean;
  position: number;
  created_by: UserId;
  owner_id?: UserId | null;
  created_at: string;
  last_edited_by: UserId;
  last_edited_at: string;
}

export interface PageComment {
  id: string;
  page_id: string;
  author_id: UserId;
  body: string;
  created_at: string;
}

/* ── External integrations ──────────────────────────────────────────── */

export type IntegrationProvider = 'google';
/** Which Google scopes the user actually granted, so the UI can be honest
 *  about what works rather than assuming a blanket connection. */
export interface IntegrationGrant {
  id: string;
  user_id: UserId;
  provider: IntegrationProvider;
  scopes: string[];
  connected_at: string;
  last_sync_at: string | null;
  /** Stable Google identity. Null only on the pre-migration legacy grant. */
  google_subject?: string | null;
  account_email?: string | null;
  display_name?: string;
  is_active?: boolean;
  gmail_history_id?: string | null;
  initial_mail_scan_at?: string | null;
  last_sync_error?: string | null;
}

export type PersonalOrderKind = 'physical' | 'travel';
export type PersonalOrderReviewStatus = 'pending' | 'confirmed' | 'dismissed';
export type PersonalOrderLifecycleStatus =
  | 'unknown'
  | 'ordered'
  | 'processing'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'booked'
  | 'changed'
  | 'completed'
  | 'cancelled'
  | 'return_started'
  | 'returned'
  | 'refund_pending'
  | 'refunded';

export interface PhysicalOrderDetails {
  items: string[];
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
}

export interface TravelOrderDetails {
  booking_reference: string | null;
  origin: string | null;
  destination: string | null;
  departure_at: string | null;
  arrival_at: string | null;
  stay_end_at: string | null;
}

/** One reviewed life-admin record, shown in Review, Active or History. */
export interface PersonalOrder {
  id: string;
  user_id: UserId;
  integration_grant_id: string | null;
  account_email: string;
  kind: PersonalOrderKind;
  review_status: PersonalOrderReviewStatus;
  lifecycle_status: PersonalOrderLifecycleStatus;
  merchant: string;
  external_reference: string | null;
  summary: string;
  amount: number | null;
  currency: string | null;
  next_event_at: string | null;
  details: PhysicalOrderDetails | TravelOrderDetails;
  manual_fields: string[];
  reviewed_at: string | null;
  reviewed_by: UserId | null;
  last_event_at: string;
  created_at: string;
  updated_at: string;
}

/** Parsed evidence only. Full Gmail bodies and HTML are never persisted. */
export interface PersonalOrderEvent {
  id: string;
  order_id: string;
  user_id: UserId;
  integration_grant_id: string | null;
  gmail_message_id: string | null;
  event_type: PersonalOrderLifecycleStatus;
  event_at: string;
  sender: string;
  subject: string;
  source_url: string;
  detection_reason: string;
  confidence: number;
  parsed_fields: Record<string, unknown>;
  created_at: string;
}

/**
 * A snapshot of a removed row, kept so any delete in the app is recoverable —
 * not just the demo purge. `row_data` is the full row as it was the instant
 * before it was removed, so Restore can put it back byte-for-byte rather than
 * reconstructing it from the audit trail's one-line summary.
 */
export interface TrashItem {
  id: string;
  collection: string;
  row_id: string;
  row_data: Record<string, unknown>;
  label: string;
  deleted_by: UserId | null;
  deleted_by_label: string;
  deleted_at: string;
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
  day_plans: DayPlan[];
  day_plan_items: DayPlanItem[];
  day_events: DayEvent[];
  active_blocks: ActiveBlock[];
  personal_goals: PersonalGoal[];
  mood_items: MoodItem[];
  subscriptions: Subscription[];
  pulse_items: PulseItem[];
  task_links: TaskLink[];
  sprints: Sprint[];
  pages: Page[];
  page_comments: PageComment[];
  integration_grants: IntegrationGrant[];
  personal_orders: PersonalOrder[];
  personal_order_events: PersonalOrderEvent[];
  trash_items: TrashItem[];
}

export type CollectionKey = keyof Omit<Dataset, 'ranking_weights'>;
