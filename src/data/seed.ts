import type { Dataset } from '../types';
import { DEMO_USER_ID } from '../lib/demoScope';

/**
 * Seed dataset — mirrors the v10 prototype's demo content, expanded to the
 * full schema. All timestamps absolute (today in seed-world = 2026-08-18).
 * AN = Anadya, RG = Raghuvar.
 */
export const AN = 'u-anadya';
export const RG = 'u-raghuvar';
export const TEST = DEMO_USER_ID;

/**
 * Local dev credentials for mock mode ONLY.
 *
 * These are stripped from production builds: a production bundle must never
 * carry a plaintext password, and mock mode is not an authentication system.
 * A production build without VITE_SUPABASE_URL therefore cannot sign anyone
 * in at all (see gate.tsx), which is the correct failure mode — real auth is
 * Supabase email+password, and the allowlist trigger is the actual gate.
 */
const devPassword = (pw: string): string | undefined => (import.meta.env.DEV ? pw : undefined);

const D = (s: string) => s; // date literal helper, YYYY-MM-DD
const T = (s: string) => `${s}+05:30`; // IST timestamp literal

export function seedDataset(): Dataset {
  const ds = rawSeed();
  // Mirror 0012_workspaces.sql: notes and wiki pages belong to their author, so
  // mock mode splits the workspaces exactly the way the database does.
  return {
    ...ds,
    notes: ds.notes.map((n) => ({ ...n, owner_id: n.owner_id ?? n.created_by })),
    pages: ds.pages.map((p) => ({ ...p, owner_id: p.owner_id ?? p.created_by })),
  };
}

function rawSeed(): Dataset {
  return {
    profiles: [
      {
        id: AN,
        email: 'anvik.anadya@gmail.com',
        password: devPassword('Anadya@2026'),
        name: 'Anadya',
        avatar_url: null,
        time_zone: 'Europe/Rome',
        status_text: 'Deep in the export engine · back at 4',
        status_expires_at: null,
        personalization: {
          song: true,
          photo: true,
          worth_knowing: true,
          life_radar: true,
          projects_strip: true,
          money_on_home: true,
        },
      },
      {
        id: RG,
        email: 'raghuvar.anvik@gmail.com',
        password: devPassword('Raghuvar@2026'),
        name: 'Raghuvar',
        avatar_url: null,
        time_zone: 'Asia/Kolkata',
        status_text: 'On vendor calls till 3',
        status_expires_at: null,
        personalization: {
          song: true,
          photo: false,
          worth_knowing: true,
          life_radar: false,
          projects_strip: true,
          money_on_home: false,
        },
      },
      ...(import.meta.env.DEV
        ? [
            {
              id: TEST,
              email: 'test@anvik.ops',
              password: devPassword('Test@2026'),
              name: 'Test',
              avatar_url: null,
              time_zone: 'Asia/Kolkata',
              status_text: 'Testing the local build',
              status_expires_at: null,
              personalization: {
                song: true,
                photo: true,
                worth_knowing: true,
                life_radar: true,
                projects_strip: true,
                money_on_home: true,
              },
            },
          ]
        : []),
    ],
    projects: [
      { id: 'anvik', name: 'Anvik', color: 'var(--indigo)', description: 'Scoring engine and core company', is_personal: false, created_at: T('2026-06-01T09:00:00') },
      { id: 'reg', name: 'Registry', color: 'var(--teal)', description: 'Registry data spine — collectors', is_personal: false, created_at: T('2026-06-01T09:00:00') },
      { id: 'con', name: 'Consumer', color: 'var(--stamp)', description: 'Consumer venture — rain gear', is_personal: false, created_at: T('2026-07-10T09:00:00') },
      { id: 'personal', name: 'Personal', color: 'var(--sky)', description: 'Life, study, relocation', is_personal: true, created_at: T('2026-06-01T09:00:00') },
    ],
    ranking_weights: { id: 1, objective_fit: 40, unblocks: 30, deadline: 30, updated_at: T('2026-08-01T09:00:00') },
    tags: [
      { id: 'tag-1', name: 'urgent-path', color: 'rose', created_by: AN, created_at: T('2026-07-01T09:00:00') },
      { id: 'tag-2', name: 'blocked', color: 'stamp', created_by: RG, created_at: T('2026-07-01T09:00:00') },
      { id: 'tag-3', name: 'needs-raghuvar', color: 'teal', created_by: AN, created_at: T('2026-07-02T09:00:00') },
      { id: 'tag-4', name: 'investor-facing', color: 'indigo', created_by: AN, created_at: T('2026-07-05T09:00:00') },
      { id: 'tag-5', name: 'visa', color: 'sky', created_by: AN, created_at: T('2026-07-08T09:00:00') },
      { id: 'tag-6', name: 'quick-win', color: 'teal', created_by: RG, created_at: T('2026-07-11T09:00:00') },
    ],
    objectives: [
      { id: 'okr-reg', title: 'Registry spine complete', project_id: 'reg', quarter: 'Q3', created_at: T('2026-07-01T09:00:00') },
      { id: 'okr-score', title: 'Scoring engine production-ready', project_id: 'anvik', quarter: 'Q3', created_at: T('2026-07-01T09:00:00') },
      { id: 'okr-con', title: 'Consumer venture validated', project_id: 'con', quarter: 'Q3', created_at: T('2026-07-10T09:00:00') },
      { id: 'okr-italy', title: 'Land in Italy, settled', project_id: 'personal', quarter: 'Q3', created_at: T('2026-07-01T09:00:00') },
    ],
    key_results: [
      { id: 'kr-1', objective_id: 'okr-reg', title: 'Collectors live in production', progress_pct: 72, position: 1 },
      { id: 'kr-2', objective_id: 'okr-reg', title: 'Entity resolution above 95%', progress_pct: 88, position: 2 },
      { id: 'kr-3', objective_id: 'okr-reg', title: 'Publishability policy signed off', progress_pct: 40, position: 3 },
      { id: 'kr-4', objective_id: 'okr-score', title: 'v3.8 frozen and regressed', progress_pct: 62, position: 1 },
      { id: 'kr-5', objective_id: 'okr-score', title: 'Two pilots scored end to end', progress_pct: 35, position: 2 },
      { id: 'kr-6', objective_id: 'okr-con', title: 'Two vendor quotes landed', progress_pct: 50, position: 1 },
      { id: 'kr-7', objective_id: 'okr-con', title: '50 pre-orders', progress_pct: 12, position: 2 },
      { id: 'kr-8', objective_id: 'okr-italy', title: 'Visa and permesso done', progress_pct: 30, position: 1 },
      { id: 'kr-9', objective_id: 'okr-italy', title: 'Housing secured', progress_pct: 0, position: 2 },
      { id: 'kr-10', objective_id: 'okr-italy', title: 'Week-1 reading finished', progress_pct: 15, position: 3 },
    ],
    tasks: [
      {
        id: 'T-47', title: 'Rain-gear vendor shortlist', description: 'Two quotes in hand, one pending. Decide before the sample run.', acceptance_criteria: '',
        project_id: 'con', type: 'ops', status: 'todo', priority: 'normal', assignee_id: AN, created_by: AN,
        start_date: D('2026-08-18'), due_date: D('2026-08-21'), objective_id: 'okr-con', tags: ['needs-raghuvar'], progress_pct: 10,
        effort: 'light', estimate_minutes: 25, impact: 2, is_stuck: false, blocked_reason: null,
        sprint_id: 'sprint-1', board_order: 0,
        created_at: T('2026-08-14T10:00:00'), updated_at: T('2026-08-17T10:00:00'),
      },
      {
        id: 'T-46', title: 'IBBI collector — retry backoff', description: '', acceptance_criteria: '',
        project_id: 'reg', type: 'code_change', status: 'todo', priority: 'normal', assignee_id: RG, created_by: RG,
        start_date: D('2026-08-19'), due_date: D('2026-08-22'), objective_id: 'okr-reg', tags: [], progress_pct: 5,
        effort: 'medium', estimate_minutes: 50, impact: 3, is_stuck: false, blocked_reason: null,
        sprint_id: 'sprint-1', board_order: 0,
        created_at: T('2026-08-14T11:00:00'), updated_at: T('2026-08-16T11:00:00'),
      },
      {
        id: 'T-45', title: 'AnvikSure v3.8 fixture regression', description: 'Regress the full fixture set before the version is frozen.', acceptance_criteria: '- Full fixture set green\n- No score drift beyond 0.5% on golden cases',
        project_id: 'anvik', type: 'code_change', status: 'in_progress', priority: 'urgent', assignee_id: AN, created_by: AN,
        start_date: D('2026-08-15'), due_date: D('2026-08-18'), objective_id: 'okr-score', tags: ['urgent-path'], progress_pct: 62,
        effort: 'heavy', estimate_minutes: 90, impact: 5, is_stuck: false, blocked_reason: null,
        sprint_id: 'sprint-1', board_order: 0,
        created_at: T('2026-08-12T09:00:00'), updated_at: T('2026-08-17T18:00:00'),
      },
      {
        id: 'T-44', title: 'Samadhaan collector — queue reorder', description: '', acceptance_criteria: '',
        project_id: 'reg', type: 'code_change', status: 'in_progress', priority: 'high', assignee_id: RG, created_by: RG,
        start_date: D('2026-08-14'), due_date: D('2026-08-19'), objective_id: 'okr-reg', tags: ['blocked'], progress_pct: 44,
        effort: 'medium', estimate_minutes: 55, impact: 4, is_stuck: false, blocked_reason: 'Needs fixture confirmation from Anadya',
        sprint_id: 'sprint-1', board_order: 0,
        created_at: T('2026-08-11T09:00:00'), updated_at: T('2026-08-17T09:00:00'),
      },
      {
        id: 'T-42', title: 'eCourts collector — QA report', description: 'Parser output diverges from the portal on pre-2019 case records. Evidence pinned below; verify against the DDL fixture before closing.', acceptance_criteria: '- Pre-2019 records parse to the same fields the portal shows\n- Karnataka bench legacy format covered by a fixture\n- QA report attached to the task',
        project_id: 'reg', type: 'code_change', status: 'in_review', priority: 'urgent', assignee_id: RG, created_by: AN,
        start_date: D('2026-08-16'), due_date: D('2026-08-20'), objective_id: 'okr-reg', tags: ['urgent-path'], progress_pct: 80,
        effort: 'medium', estimate_minutes: 70, impact: 5, is_stuck: false, blocked_reason: null,
        sprint_id: 'sprint-1', board_order: 0,
        // Handed over and long since picked up — in review at 80%. T-38 is the
        // one left unacknowledged, so the inbox strip has something to show.
        acknowledged_at: T('2026-08-10T10:00:00'),
        created_at: T('2026-08-10T09:00:00'), updated_at: T('2026-08-17T09:14:00'),
      },
      {
        id: 'T-41', title: 'Visa appointment — Milan consulate', description: 'Slot booking opens 8am. Documents checklist in the Notebook.', acceptance_criteria: '',
        project_id: 'personal', type: 'ops', status: 'in_progress', priority: 'urgent', assignee_id: AN, created_by: AN,
        start_date: D('2026-08-17'), due_date: D('2026-08-20'), objective_id: 'okr-italy', tags: ['visa'], progress_pct: 30,
        effort: 'light', estimate_minutes: 20, impact: 5, is_stuck: false, blocked_reason: null,
        sprint_id: 'sprint-1', board_order: 0,
        created_at: T('2026-08-09T09:00:00'), updated_at: T('2026-08-17T08:00:00'),
      },
      {
        id: 'T-40', title: 'Read: attention paper set, week 1', description: '', acceptance_criteria: '',
        project_id: 'personal', type: 'research', status: 'todo', priority: 'normal', assignee_id: AN, created_by: AN,
        start_date: D('2026-08-19'), due_date: D('2026-08-23'), objective_id: 'okr-italy', tags: [], progress_pct: 0,
        effort: 'heavy', estimate_minutes: 80, impact: 2, is_stuck: false, blocked_reason: null,
        sprint_id: 'sprint-1', board_order: 0,
        created_at: T('2026-08-08T09:00:00'), updated_at: T('2026-08-08T09:00:00'),
      },
      {
        id: 'T-38', title: 'Tighten SEO copy on anvik.club', description: '', acceptance_criteria: '',
        project_id: 'anvik', type: 'ops', status: 'todo', priority: 'low', assignee_id: AN, created_by: RG,
        start_date: D('2026-08-22'), due_date: D('2026-08-24'), objective_id: null, tags: ['quick-win'], progress_pct: 0,
        effort: 'light', estimate_minutes: 30, impact: 1, is_stuck: false, blocked_reason: null,
        sprint_id: 'sprint-1', board_order: 0,
        created_at: T('2026-08-07T09:00:00'), updated_at: T('2026-08-07T09:00:00'),
      },
      {
        id: 'T-36', title: 'Investor one-pager — traction numbers', description: '', acceptance_criteria: '',
        project_id: 'anvik', type: 'ops', status: 'todo', priority: 'high', assignee_id: AN, created_by: AN,
        start_date: D('2026-08-21'), due_date: D('2026-08-26'), objective_id: 'okr-score', tags: ['investor-facing'], progress_pct: 0,
        effort: 'medium', estimate_minutes: 60, impact: 4, is_stuck: false, blocked_reason: null,
        sprint_id: 'sprint-1', board_order: 0,
        created_at: T('2026-08-05T09:00:00'), updated_at: T('2026-08-05T09:00:00'),
      },
      {
        id: 'T-30', title: 'MCA collector — entity resolution', description: '', acceptance_criteria: '',
        project_id: 'reg', type: 'code_change', status: 'done', priority: 'normal', assignee_id: AN, created_by: AN,
        start_date: D('2026-08-10'), due_date: D('2026-08-14'), objective_id: 'okr-reg', tags: [], progress_pct: 100,
        effort: 'medium', estimate_minutes: 45, impact: 3, is_stuck: false, blocked_reason: null,
        sprint_id: 'sprint-1', board_order: 0,
        created_at: T('2026-08-01T09:00:00'), updated_at: T('2026-08-14T17:00:00'),
      },
    ],
    subtasks: [
      { id: 'st-1', task_id: 'T-42', title: 'Rerun parser on DDL fixture', completed: true, position: 1 },
      { id: 'st-2', task_id: 'T-42', title: 'Diff against portal HTML capture', completed: true, position: 2 },
      { id: 'st-3', task_id: 'T-42', title: 'Write QA summary note', completed: false, position: 3 },
      { id: 'st-4', task_id: 'T-47', title: 'Ask Surat for revised MOQ', completed: true, position: 1 },
      { id: 'st-5', task_id: 'T-47', title: 'Compare landed cost with duty', completed: false, position: 2 },
      { id: 'st-6', task_id: 'T-41', title: 'Book the 8am slot', completed: false, position: 1 },
      { id: 'st-7', task_id: 'T-41', title: 'Print bank statements', completed: true, position: 2 },
    ],
    comments: [
      { id: 'c-1', task_id: 'T-42', author_id: RG, body: 'Pinned the two divergent regions on the grid screenshot. The date column shifts by one on pre-2019 rows.', is_decision: false, created_at: T('2026-08-17T09:14:00') },
      { id: 'c-2', task_id: 'T-42', author_id: AN, body: 'Treat pre-2019 as its own parser branch — do not patch the main path.', is_decision: true, created_at: T('2026-08-17T10:02:00') },
      { id: 'c-3', task_id: 'T-45', author_id: AN, body: 'Golden cases 12 and 31 drifted 0.7% — inspecting before freeze.', is_decision: false, created_at: T('2026-08-17T16:40:00') },
    ],
    screenshot_attachments: [
      {
        id: 'shot-1', task_id: 'T-42', storage_path: 'screenshots/T-42/samadhaan_grid.png', filename: 'samadhaan_grid.png',
        mime: 'image/png', width: 1440, height: 900, uploaded_by: RG, created_at: T('2026-08-17T09:10:00'),
      },
    ],
    annotation_pins: [
      { id: 'pin-1', screenshot_id: 'shot-1', x_pct: 32.4, y_pct: 41.0, note: 'Date column shifted one cell left on pre-2019 rows', label: 'bug', author_id: RG, is_resolved: false, created_at: T('2026-08-17T09:12:00') },
      { id: 'pin-2', screenshot_id: 'shot-1', x_pct: 71.8, y_pct: 63.5, note: 'Case number truncated at 16 chars — NIC widens to 24 on 1 Sept', label: 'logic', author_id: RG, is_resolved: false, created_at: T('2026-08-17T09:14:00') },
    ],
    decisions: [
      { id: 'dec-1', question: 'Company rename — Trazio or stay Anvik?', project_id: 'anvik', recommendation: 'Trazio — cleanest uncontested candidate on screening.', owner_id: AN, status: 'open', opened_at: T('2026-06-02T09:00:00'), ruled_at: null, ruling_note: '' },
      { id: 'dec-2', question: 'Pricing metric — per verification or per seat?', project_id: 'anvik', recommendation: 'Per verification. Seats punish the behaviour we want.', owner_id: AN, status: 'open', opened_at: T('2026-08-11T09:00:00'), ruled_at: null, ruling_note: '' },
      { id: 'dec-3', question: 'Shell detection — hard gate or penalty tier?', project_id: 'anvik', recommendation: 'Binary hard gate.', owner_id: AN, status: 'ruled', opened_at: T('2026-08-02T09:00:00'), ruled_at: T('2026-08-14T09:00:00'), ruling_note: 'Binary hard gate. Revisit only if false positives cross 2%.' },
      { id: 'dec-4', question: 'Rain gear — Ludhiana or Surat for the sample run?', project_id: 'con', recommendation: 'Wait for Surat revision, decide Friday.', owner_id: RG, status: 'open', opened_at: T('2026-08-15T09:00:00'), ruled_at: null, ruling_note: '' },
    ],
    notes: [
      {
        id: 'n-1', title: 'Vendor call — rain gear', body: 'Ludhiana quotes ₹340/unit at 500 MOQ, 50% advance. Surat pending.', type: 'voice',
        project_id: 'con', task_id: 'T-47', tags: ['needs-raghuvar'], is_pinned: false,
        transcript: [
          { at: '00:41', text: 'Ludhiana can do 340 a unit but only at 500 minimum.' },
          { at: '06:12', text: 'Half in advance, half on dispatch.' },
          { at: '11:03', text: 'Surat will revise by Friday.' },
        ],
        checklist: [
          { text: 'Ask Surat for revised MOQ', done: true },
          { text: 'Compare landed cost with duty', done: false },
        ],
        source_ref: 'plaud:rec-2026-08-17-0730', created_by: AN, created_at: T('2026-08-17T07:30:00'),
      },
      {
        id: 'n-2', title: 'Parser edge cases', body: 'Pre-2019 eCourts records use two legacy formats. A third appears only in Karnataka benches.', type: 'plain',
        project_id: 'reg', task_id: 'T-42', tags: [], is_pinned: true, transcript: null, checklist: null, source_ref: null, created_by: AN, created_at: T('2026-08-17T11:00:00'),
      },
      {
        id: 'n-3', title: 'Decision — scoring floor', body: 'Shell detection stays a binary hard gate. Revisit only if false positives cross 2%.', type: 'plain',
        project_id: 'anvik', task_id: null, tags: [], is_pinned: false, transcript: null, checklist: null, source_ref: null, created_by: AN, created_at: T('2026-08-14T09:30:00'),
      },
      {
        id: 'n-4', title: 'Weekly — three commitments', body: '', type: 'meeting',
        project_id: 'anvik', task_id: null, tags: [], is_pinned: false, transcript: null,
        checklist: [
          { text: 'Ship the export engine', done: true },
          { text: 'Close two registry collectors', done: false },
          { text: 'Decide the company name', done: false },
        ],
        source_ref: null, created_by: RG, created_at: T('2026-08-11T09:00:00'),
      },
      {
        id: 'n-5', title: 'From mail — NIC cutover', body: 'Case-number field widens to 24 chars on 1 Sept.', type: 'email',
        project_id: 'reg', task_id: 'T-42', tags: [], is_pinned: false, transcript: null, checklist: null,
        source_ref: 'gmail:msg-nic-2026-08-17', created_by: AN, created_at: T('2026-08-17T09:12:00'),
      },
      {
        id: 'n-6', title: 'Walking note — pricing', body: 'Value metric should be per verification, not per seat.', type: 'voice',
        project_id: 'anvik', task_id: null, tags: [], is_pinned: false,
        transcript: [{ at: '02:20', text: 'Charge for the thing they value: a verified counterparty.' }],
        checklist: null, source_ref: 'plaud:rec-2026-08-12-1815', created_by: AN, created_at: T('2026-08-12T18:15:00'),
      },
    ],
    mail_items: [
      {
        id: 'm-1', account_email: 'anvik.anadya@gmail.com', sender: 'NIC eCourts', subject: 'Change notice — case number field', snippet: 'Case-number field widens to 24 chars effective 1 September.', received_at: T('2026-08-17T09:05:00'),
        gmail_link: 'https://mail.google.com/mail/u/0/#inbox', flag_reason: 'deadline 1 Sept detected', project_id: 'reg', converted_to_type: 'note', converted_to_id: 'n-5',
      },
      {
        id: 'm-2', account_email: 'anvik.anadya@gmail.com', sender: 'Milan consulate', subject: 'Appointment window opens Monday 8:00', snippet: 'Study-visa slots for September intake open Monday 8:00 CET.', received_at: T('2026-08-16T17:20:00'),
        gmail_link: 'https://mail.google.com/mail/u/0/#inbox', flag_reason: 'appointment window', project_id: 'personal', converted_to_type: null, converted_to_id: null,
      },
      {
        id: 'm-3', account_email: 'raghuvar.anvik@gmail.com', sender: 'Surat Textiles', subject: 'Revised quote by Friday', snippet: 'We will revise the MOQ and unit price by Friday EOD.', received_at: T('2026-08-15T14:00:00'),
        gmail_link: 'https://mail.google.com/mail/u/1/#inbox', flag_reason: null, project_id: 'con', converted_to_type: null, converted_to_id: null,
      },
    ],
    documents: [
      { id: 'doc-1', title: 'Passport', project_id: 'personal', expiry_date: D('2029-03-14'), deadline_note: '', cloud_ref_url: 'https://drive.google.com/', status_cache: 'ok' },
      { id: 'doc-2', title: 'Schengen study visa', project_id: 'personal', expiry_date: null, deadline_note: 'pending decision', cloud_ref_url: 'https://drive.google.com/', status_cache: 'soon' },
      { id: 'doc-3', title: 'Permesso di soggiorno', project_id: 'personal', expiry_date: null, deadline_note: 'within 8 days of arrival', cloud_ref_url: 'https://drive.google.com/', status_cache: 'over' },
      { id: 'doc-4', title: 'Health insurance — Italy', project_id: 'personal', expiry_date: D('2026-08-31'), deadline_note: '', cloud_ref_url: 'https://drive.google.com/', status_cache: 'soon' },
      { id: 'doc-5', title: 'Incorporation certificate', project_id: 'anvik', expiry_date: null, deadline_note: '', cloud_ref_url: 'https://drive.google.com/', status_cache: 'ok' },
      { id: 'doc-6', title: 'Founders agreement', project_id: 'anvik', expiry_date: D('2027-01-01'), deadline_note: 'renews 1 Jan 2027', cloud_ref_url: 'https://drive.google.com/', status_cache: 'ok' },
      { id: 'doc-7', title: 'University enrolment letter', project_id: 'personal', expiry_date: D('2026-08-25'), deadline_note: 'upload by 25 Aug', cloud_ref_url: 'https://drive.google.com/', status_cache: 'soon' },
      { id: 'doc-8', title: 'GST registration', project_id: 'anvik', expiry_date: null, deadline_note: '', cloud_ref_url: 'https://drive.google.com/', status_cache: 'ok' },
    ],
    people: [
      { id: 'p-1', name: 'Ludhiana Steel', role: 'Pilot customer', relationship_type: 'customer', project_id: 'anvik', time_zone: 'Asia/Kolkata', cadence_days: 14, last_contact_date: D('2026-08-10'), next_action: 'Send September pricing', notes: 'Prefers WhatsApp. Decision maker: Mr. Arora.', created_at: T('2026-06-15T09:00:00') },
      { id: 'p-2', name: 'Surat Textiles', role: 'Vendor · rain gear', relationship_type: 'vendor', project_id: 'con', time_zone: 'Asia/Kolkata', cadence_days: 7, last_contact_date: D('2026-08-16'), next_action: 'Chase revised MOQ', notes: 'Negotiable on advance.', created_at: T('2026-07-20T09:00:00') },
      { id: 'p-3', name: 'Prof. Bianchi', role: 'Politecnico · supervisor', relationship_type: 'university', project_id: 'personal', time_zone: 'Europe/Rome', cadence_days: 30, last_contact_date: null, next_action: 'Introduce yourself before term', notes: 'Works on interpretability. Read two papers first.', created_at: T('2026-08-01T09:00:00') },
      { id: 'p-4', name: 'R. Mehta', role: 'Angel · warm intro', relationship_type: 'investor', project_id: 'anvik', time_zone: 'Asia/Kolkata', cadence_days: 21, last_contact_date: D('2026-07-26'), next_action: 'Share the traction one-pager', notes: 'Asked about the PD dataset moat.', created_at: T('2026-07-01T09:00:00') },
      { id: 'p-5', name: 'CA Sharma', role: 'Compliance', relationship_type: 'vendor', project_id: 'anvik', time_zone: 'Asia/Kolkata', cadence_days: 30, last_contact_date: D('2026-08-13'), next_action: 'Q2 filings confirmation', notes: '', created_at: T('2026-06-01T09:00:00') },
      { id: 'p-6', name: 'Milan housing agent', role: 'Relocation', relationship_type: 'personal', project_id: 'personal', time_zone: 'Europe/Rome', cadence_days: 3, last_contact_date: D('2026-08-17'), next_action: 'Confirm viewing slot', notes: 'Two flats near Bovisa. Budget €800.', created_at: T('2026-08-05T09:00:00') },
    ],
    people_interactions: [
      { id: 'pi-1', person_id: 'p-1', occurred_on: D('2026-08-10'), summary: 'Call — pilot feedback, happy with verdicts', logged_by: AN },
      { id: 'pi-2', person_id: 'p-2', occurred_on: D('2026-08-16'), summary: 'Mail — revised quote promised Friday', logged_by: RG },
      { id: 'pi-3', person_id: 'p-4', occurred_on: D('2026-07-26'), summary: 'Coffee — walked the deck', logged_by: AN },
      { id: 'pi-4', person_id: 'p-5', occurred_on: D('2026-08-13'), summary: 'Mail — GST filed', logged_by: AN },
      { id: 'pi-5', person_id: 'p-6', occurred_on: D('2026-08-17'), summary: 'WhatsApp — sent listings', logged_by: AN },
    ],
    messages: [
      { id: 'msg-1', sender_id: RG, body: 'Pushed the pins on T-42 last night. Need your call before the NIC cutover.', task_ref_id: 'T-42', attachment_url: null, song_ref: null, promoted_to_type: null, promoted_to_id: null, created_at: T('2026-08-18T08:41:00') },
      { id: 'msg-2', sender_id: AN, body: 'Looking now. Also — chai at 4?', task_ref_id: null, attachment_url: null, song_ref: null, promoted_to_type: null, promoted_to_id: null, created_at: T('2026-08-18T08:56:00') },
      { id: 'msg-3', sender_id: RG, body: "Obviously. Surat still hasn't revised the MOQ, chasing today.", task_ref_id: null, attachment_url: null, song_ref: null, promoted_to_type: null, promoted_to_id: null, created_at: T('2026-08-18T09:02:00') },
    ],
    shared_daily: [
      { id: 'sd-1', date: D('2026-08-18'), song_title: 'Ilahi', song_artist: 'Pritam · Arijit Singh', song_url: 'https://www.youtube.com/watch?v=UBscsdrK0Bo', picked_by: RG, photo_url: null, photo_caption: null },
    ],
    courses: [
      { id: 'crs-1', title: 'Foundations of machine learning', schedule_label: 'Mon · Wed', is_expanded: true, position: 1 },
      { id: 'crs-2', title: 'Deep learning systems', schedule_label: 'Tue · Thu', is_expanded: false, position: 2 },
      { id: 'crs-3', title: 'AI ethics and regulation', schedule_label: 'Fri', is_expanded: false, position: 3 },
    ],
    course_items: [
      { id: 'ci-1', course_id: 'crs-1', title: 'Lecture set 1 notes', completed: true, position: 1 },
      { id: 'ci-2', course_id: 'crs-1', title: 'Problem set 0', completed: true, position: 2 },
      { id: 'ci-3', course_id: 'crs-1', title: 'Reading: attention paper set', completed: false, position: 3 },
      { id: 'ci-4', course_id: 'crs-1', title: 'Problem set 1', completed: false, position: 4 },
      { id: 'ci-5', course_id: 'crs-2', title: 'Environment setup', completed: true, position: 1 },
      { id: 'ci-6', course_id: 'crs-2', title: 'Lab 1 — autograd', completed: false, position: 2 },
      { id: 'ci-7', course_id: 'crs-2', title: 'Reading: systems survey', completed: false, position: 3 },
      { id: 'ci-8', course_id: 'crs-3', title: 'Syllabus review', completed: true, position: 1 },
      { id: 'ci-9', course_id: 'crs-3', title: 'EU AI Act summary', completed: false, position: 2 },
    ],
    reading_queue: [
      { id: 'rd-1', title: 'Attention Is All You Need', author: 'Vaswani et al.', status: 'done', position: 1 },
      { id: 'rd-2', title: 'Scaling laws — annotated memo', author: '', status: 'reading', position: 2 },
      { id: 'rd-3', title: 'EU AI Act — obligations summary', author: '', status: 'queued', position: 3 },
      { id: 'rd-4', title: 'Interpretability review (Bianchi)', author: '', status: 'queued', position: 4 },
    ],
    time_logs: [
      { id: 'tl-1', user_id: AN, date: D('2026-08-17'), kind: 'study', minutes: 90, course_id: 'crs-1' },
      { id: 'tl-2', user_id: AN, date: D('2026-08-17'), kind: 'founder', minutes: 340, course_id: null },
      { id: 'tl-3', user_id: AN, date: D('2026-08-16'), kind: 'study', minutes: 120, course_id: 'crs-2' },
      { id: 'tl-4', user_id: AN, date: D('2026-08-16'), kind: 'founder', minutes: 300, course_id: null },
      { id: 'tl-5', user_id: AN, date: D('2026-08-15'), kind: 'study', minutes: 60, course_id: 'crs-1' },
      { id: 'tl-6', user_id: AN, date: D('2026-08-15'), kind: 'founder', minutes: 380, course_id: null },
    ],
    life_admin: [
      { id: 'la-1', user_id: AN, item: 'Renew health insurance before flying', completed: false, created_at: T('2026-08-01T09:00:00') },
      { id: 'la-2', user_id: AN, item: 'Close the Gurugram gym membership', completed: false, created_at: T('2026-08-01T09:00:00') },
      { id: 'la-3', user_id: AN, item: 'Ship winter clothes ahead', completed: false, created_at: T('2026-08-01T09:00:00') },
    ],
    fixed_dates: [
      { id: 'fd-1', label: 'Flight to Milan', date: D('2026-09-12'), category: 'relocation' },
      { id: 'fd-2', label: 'Term starts — Politecnico', date: D('2026-09-21'), category: 'university' },
      { id: 'fd-3', label: 'NIC case-number cutover', date: D('2026-09-01'), category: 'business' },
      { id: 'fd-4', label: 'Enrolment letter upload', date: D('2026-08-25'), category: 'university' },
    ],
    ledger: [
      { id: 'lg-1', date: D('2026-08-17'), party: 'Founder contribution', category: 'Founder capital', project_id: 'anvik', direction: 'in', amount: 86000, status: 'paid', paid_by: RG, payer_allocations: [{ user_id: RG, amount: 86000 }], comments: 'Money put into the business; not revenue.', ends_on: null, subscription_id: null, receipt_url: null, linked_task_id: null, import_batch_id: null },
      { id: 'lg-2', date: D('2026-08-16'), party: 'AWS India', category: 'Infra', project_id: 'reg', direction: 'out', amount: 34200, status: 'paid', paid_by: null, payer_allocations: [{ user_id: RG, amount: 17100 }, { user_id: AN, amount: 17100 }], comments: 'Split equally between both founders.', ends_on: null, subscription_id: null, receipt_url: null, linked_task_id: null, import_batch_id: null },
      { id: 'lg-3', date: D('2026-08-15'), party: 'Surat Textiles', category: 'Sample run', project_id: 'con', direction: 'out', amount: 41500, status: 'overdue', paid_by: RG, payer_allocations: [{ user_id: RG, amount: 41500 }], comments: '', ends_on: null, subscription_id: null, receipt_url: null, linked_task_id: 'T-47', import_batch_id: null },
      { id: 'lg-4', date: D('2026-08-14'), party: 'Politecnico Milano', category: 'Tuition instalment', project_id: 'personal', direction: 'out', amount: 210000, status: 'due', paid_by: RG, payer_allocations: [{ user_id: RG, amount: 210000 }], comments: '', ends_on: null, subscription_id: null, receipt_url: null, linked_task_id: null, import_batch_id: null },
      { id: 'lg-5', date: D('2026-08-12'), party: 'MCA portal', category: 'Registry fees', project_id: 'reg', direction: 'out', amount: 12800, status: 'paid', paid_by: AN, payer_allocations: [{ user_id: AN, amount: 12800 }], comments: '', ends_on: null, subscription_id: null, receipt_url: null, linked_task_id: null, import_batch_id: null },
      { id: 'lg-6', date: D('2026-08-10'), party: 'Contract designer', category: 'People', project_id: 'anvik', direction: 'out', amount: 55000, status: 'due', paid_by: RG, payer_allocations: [{ user_id: RG, amount: 55000 }], comments: '', ends_on: null, subscription_id: null, receipt_url: null, linked_task_id: null, import_batch_id: null },
    ],
    import_batches: [],
    subscriptions: [
      { id: 'sub-1', name: 'Vercel Pro', amount: 1700, currency: 'INR', billing_cycle: 'monthly', ends_on: D('2026-08-24'), url: 'https://vercel.com', project_id: 'anvik', paid_by: AN, is_active: true, notes: '', created_at: T('2026-01-10T09:00:00') },
      { id: 'sub-2', name: 'Google Workspace', amount: 1416, currency: 'INR', billing_cycle: 'monthly', ends_on: D('2026-09-01'), url: null, project_id: 'anvik', paid_by: RG, is_active: true, notes: 'Two seats', created_at: T('2026-01-10T09:00:00') },
      { id: 'sub-3', name: 'Figma', amount: 12000, currency: 'INR', billing_cycle: 'yearly', ends_on: D('2027-02-01'), url: null, project_id: 'anvik', paid_by: AN, is_active: true, notes: '', created_at: T('2026-02-01T09:00:00') },
    ],
    audit_trail: [
      { id: 'a-1', occurred_at: T('2026-08-17T09:14:00'), actor_id: RG, actor_label: 'Raghuvar', entity_type: 'annotation_pin', entity_id: 'pin-2', field_name: null, old_value: null, new_value: 'Pin added on samadhaan_grid.png', source: 'portal' },
      { id: 'a-2', occurred_at: T('2026-08-17T09:12:00'), actor_id: null, actor_label: 'automated', entity_type: 'mail_item', entity_id: 'm-1', field_name: 'flag_reason', old_value: null, new_value: 'deadline 1 Sept detected', source: 'gmail' },
      { id: 'a-3', occurred_at: T('2026-08-17T07:30:00'), actor_id: null, actor_label: 'automated', entity_type: 'note', entity_id: 'n-1', field_name: null, old_value: null, new_value: 'Voice note synced — Vendor call, 14 min', source: 'plaud' },
      { id: 'a-4', occurred_at: T('2026-08-17T07:00:00'), actor_id: null, actor_label: 'automated', entity_type: 'digest', entity_id: 'digest-2026-08-17', field_name: null, old_value: null, new_value: 'Morning brief emailed to both members', source: 'gmail' },
      { id: 'a-5', occurred_at: T('2026-08-16T18:22:00'), actor_id: AN, actor_label: 'Anadya', entity_type: 'ledger', entity_id: 'batch-0', field_name: null, old_value: null, new_value: 'Ledger import — 128 rows, 3 duplicates skipped', source: 'drive' },
      { id: 'a-6', occurred_at: T('2026-08-16T11:47:00'), actor_id: AN, actor_label: 'Anadya', entity_type: 'task', entity_id: 'T-42', field_name: null, old_value: null, new_value: 'Export generated — T-42.md, 2 pins', source: 'claude_export' },
    ],
    automation_rules: [
      { id: 'r-1', trigger_label: 'Mail contains a date', trigger_value: 'date-detect', action_label: 'Flag in Mail tab', action_value: 'flag', is_active: true, last_fired_at: T('2026-08-17T09:12:00') },
      { id: 'r-2', trigger_label: 'Plaud sync completes', trigger_value: 'plaud-sync', action_label: 'Create voice note', action_value: 'note', is_active: true, last_fired_at: T('2026-08-17T07:30:00') },
      { id: 'r-3', trigger_label: 'Daily 07:00 IST', trigger_value: 'cron-0700', action_label: 'Send morning digest to both', action_value: 'digest', is_active: true, last_fired_at: T('2026-08-17T07:00:00') },
      { id: 'r-4', trigger_label: 'Task moved to Done', trigger_value: 'task-done', action_label: 'Nudge linked ledger entry', action_value: 'ledger-nudge', is_active: false, last_fired_at: null },
    ],
    daily_closeouts: [
      { id: 'dc-1', user_id: AN, date: D('2026-08-17'), shipped: 'Export engine skeleton', stuck: 'Fixture drift on golden cases', tomorrow: 'Freeze v3.8', created_at: T('2026-08-17T21:30:00') },
    ],
    day_plans: [],
    sprints: [
      { id: 'sprint-1', name: 'Current sprint', starts_on: D('2026-08-15'), ends_on: D('2026-08-29'), is_archived: false, position: 1 },
      { id: 'sprint-0', name: 'Sprint 0', starts_on: D('2026-08-01'), ends_on: D('2026-08-14'), is_archived: true, position: 0 },
    ],
    task_links: [
      { id: 'tl-1', from_task_id: 'T-44', to_task_id: 'T-42', type: 'blocked_by', created_by: RG, created_at: T('2026-08-17T09:00:00') },
      { id: 'tl-2', from_task_id: 'T-45', to_task_id: 'T-36', type: 'related', created_by: AN, created_at: T('2026-08-16T09:00:00') },
    ],
    integration_grants: [],
    personal_orders: [],
    personal_order_events: [],
    trash_items: [],
    page_comments: [
      { id: 'pc-1', page_id: 'pg-2', author_id: RG, body: 'Added the Karnataka bench case — see T-42.', created_at: T('2026-08-17T12:00:00') },
    ],
    pages: [
      {
        id: 'pg-1', title: 'Engineering handbook', icon: '📕', parent_page_id: null,
        blocks: [
          { id: 'b1', type: 'heading', level: 1, text: 'How we build' },
          { id: 'b2', type: 'paragraph', text: 'Small commits, a passing gate before the next phase, and evidence over assertion.' },
          { id: 'b3', type: 'callout', icon: '⚠️', color: 'stamp', text: 'Never put server-only secrets in client code.' },
          { id: 'b4', type: 'list', items: [{ text: 'Plan, then execute' }, { text: 'Verify, do not assert' }, { text: 'Commit after each passing gate' }] },
        ],
        tags: ['process'], linked_task_ids: [], is_archived: false, position: 1,
        created_by: AN, created_at: T('2026-08-10T09:00:00'), last_edited_by: AN, last_edited_at: T('2026-08-16T09:00:00'),
      },
      {
        id: 'pg-2', title: 'Registry parser notes', icon: '🧩', parent_page_id: 'pg-1',
        blocks: [
          { id: 'b1', type: 'heading', level: 2, text: 'Legacy formats' },
          { id: 'b2', type: 'paragraph', text: 'Pre-2019 eCourts records use two legacy formats. A third appears only in Karnataka benches — tracked in T-42.' },
          { id: 'b3', type: 'code', lang: 'sql', text: "select * from cases where filed_on < '2019-01-01';" },
          { id: 'b4', type: 'quote', text: 'Treat pre-2019 as its own parser branch — do not patch the main path.' },
          { id: 'b5', type: 'divider' },
          { id: 'b6', type: 'todo', items: [{ text: 'Cover Karnataka format with a fixture', done: false }, { text: 'Diff against the portal capture', done: true }] },
        ],
        tags: ['registry'], linked_task_ids: ['T-42'], is_archived: false, position: 2,
        created_by: RG, created_at: T('2026-08-14T09:00:00'), last_edited_by: RG, last_edited_at: T('2026-08-17T09:00:00'),
      },
    ],
    pulse_items: [
      { id: 'pulse-1', title: 'Open-weights model matches frontier on code benchmarks', source: 'Release notes', url: '', published_at: T('2026-08-18T06:00:00'), origin: 'auto', is_pinned: false, created_at: T('2026-08-18T06:00:00') },
      { id: 'pulse-2', title: 'EU AI Act — first GPAI obligations take effect', source: 'Commission notice', url: '', published_at: T('2026-08-17T09:00:00'), origin: 'auto', is_pinned: false, created_at: T('2026-08-17T09:00:00') },
      { id: 'pulse-3', title: 'New long-context eval suite published', source: 'Lab blog', url: '', published_at: T('2026-08-16T09:00:00'), origin: 'auto', is_pinned: false, created_at: T('2026-08-16T09:00:00') },
    ],
    // Empty on purpose: the intentions list is whatever you put in it today.
    day_plan_items: [],
    // A block is only ever a live session, never seeded.
    active_blocks: [],
    // Two goals for the test workspace, one derived from a project and one
    // from its own milestones, so the widget shows both shapes.
    personal_goals: [
      {
        id: 'pg-goal-1', user_id: RG, title: 'Get the Italian driving licence', notes: 'Theory first, then practical.',
        area: 'Life in Italy', why: 'Being able to move independently will make the new city feel workable.',
        next_action: 'Book the theory test', focus_state: 'now', reviewed_at: T('2026-08-18T09:00:00'),
        target_date: D('2026-11-30'), linked_project_id: null, linked_course_id: null,
        milestones: [
          { text: 'Book the theory test', done: true },
          { text: 'Pass the theory test', done: false },
          { text: 'Ten practical lessons', done: false },
        ],
        status: 'open', position: 1, created_at: T('2026-08-01T09:00:00'),
      },
      {
        id: 'pg-goal-2', user_id: RG, title: 'Consumer venture actually validated', notes: '',
        area: 'Venture', why: 'Decide with evidence before giving it another quarter.',
        next_action: 'Run five problem interviews', focus_state: 'later', reviewed_at: T('2026-08-18T09:00:00'),
        target_date: D('2026-10-15'), linked_project_id: 'con', linked_course_id: null,
        milestones: [], status: 'open', position: 2, created_at: T('2026-08-05T09:00:00'),
      },
    ],
    mood_items: [
      {
        id: 'mood-1', user_id: AN, kind: 'quote', title: 'Pinned',
        body: 'Make something people want.', url: null, storage_path: null,
        color: '', position: 1, pinned_at: T('2026-08-12T09:00:00'),
      },
      {
        id: 'mood-2', user_id: AN, kind: 'link', title: 'Bovisa flat listing',
        body: '', url: 'https://example.com/listing', storage_path: null,
        color: '', position: 2, pinned_at: T('2026-08-16T09:00:00'),
      },
    ],
    day_events: [
      { id: 'ev-1', user_id: AN, date: D('2026-08-18'), start_min: 9 * 60 + 30, end_min: 12 * 60, label: 'Build · Registry', kind: 'focus', task_id: 'T-42' },
      { id: 'ev-2', user_id: AN, date: D('2026-08-18'), start_min: 12 * 60 + 15, end_min: 13 * 60, label: 'Admin batch', kind: 'admin', task_id: null },
      { id: 'ev-3', user_id: null, date: D('2026-08-18'), start_min: 16 * 60, end_min: 16 * 60 + 30, label: 'Chai with Raghuvar', kind: 'personal', task_id: null },
      { id: 'ev-4', user_id: AN, date: D('2026-08-18'), start_min: 18 * 60, end_min: 19 * 60 + 30, label: 'Degree · protected', kind: 'study', task_id: null },
      { id: 'ev-5', user_id: RG, date: D('2026-08-18'), start_min: 11 * 60, end_min: 12 * 60, label: 'Vendor call · Surat', kind: 'meeting', task_id: 'T-47' },
    ],
  };
}

/** Dev/perf helper — inflate the task list to n tasks for the p95 gate. */
export function generateBulkTasks(base: Dataset, n: number): Dataset {
  const tasks = [...base.tasks];
  const projects = ['anvik', 'reg', 'con', 'personal'];
  const types = ['code_change', 'ops', 'finance', 'research'] as const;
  const statuses = ['backlog', 'todo', 'in_progress', 'in_review', 'done'] as const;
  const pris = ['urgent', 'high', 'normal', 'low'] as const;
  for (let i = tasks.length; i < n; i++) {
    const num = 100 + i;
    tasks.push({
      id: `T-${num}`,
      title: `Seed task ${num}`,
      description: '',
      acceptance_criteria: '',
      project_id: projects[i % 4],
      type: types[i % 4],
      status: statuses[i % 5],
      priority: pris[i % 4],
      assignee_id: i % 2 === 0 ? AN : RG,
      created_by: AN,
      start_date: '2026-08-01',
      due_date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
      objective_id: i % 3 === 0 ? 'okr-reg' : null,
      tags: [],
      progress_pct: (i * 7) % 101,
      sprint_id: i % 3 === 0 ? null : 'sprint-1',
      board_order: i,
      effort: (['light', 'medium', 'heavy'] as const)[i % 3],
      estimate_minutes: 25 + (i % 4) * 20,
      impact: (i % 5) + 1,
      is_stuck: false,
      blocked_reason: null,
      created_at: `2026-07-${String((i % 28) + 1).padStart(2, '0')}T09:00:00+05:30`,
      updated_at: `2026-08-01T09:00:00+05:30`,
    });
  }
  return { ...base, tasks };
}

/** A small, self-contained picture that renders without Storage or a network. */
const TEST_MOMENT_PHOTO = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop stop-color="#6f75d9"/><stop offset="0.55" stop-color="#f1a56f"/><stop offset="1" stop-color="#f7d5a2"/>
      </linearGradient>
      <linearGradient id="water" x1="0" y1="0" x2="1" y2="0">
        <stop stop-color="#243f58"/><stop offset="1" stop-color="#4f6d76"/>
      </linearGradient>
    </defs>
    <rect width="960" height="640" fill="url(#sky)"/>
    <circle cx="735" cy="150" r="64" fill="#ffe5a8" opacity=".92"/>
    <path d="M0 380L120 295l88 56 112-142 112 147 95-86 118 94 92-62 133 78v260H0z" fill="#273849" opacity=".92"/>
    <path d="M0 445c145-34 287-25 423 3s308 39 537-7v199H0z" fill="url(#water)"/>
    <path d="M0 490c155-28 307-16 456 14s306 30 504-4" fill="none" stroke="#f8d7a2" stroke-width="9" opacity=".42"/>
    <g fill="#fff3d4" opacity=".82">
      <rect x="95" y="380" width="10" height="13"/><rect x="127" y="365" width="12" height="15"/>
      <rect x="350" y="346" width="11" height="15"/><rect x="387" y="376" width="12" height="16"/>
      <rect x="610" y="380" width="11" height="14"/><rect x="650" y="362" width="12" height="16"/>
    </g>
    <text x="48" y="72" fill="white" font-family="system-ui, sans-serif" font-size="28" font-weight="650" opacity=".9">Evening reset · test fixture</text>
  </svg>
`)}`;

/** Replace only identity values; row ids and the two real profiles stay intact. */
function remapFixtureUsers<T>(value: T): T {
  if (value === AN || value === RG) return TEST as T;
  if (Array.isArray(value)) return value.map(remapFixtureUsers) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, remapFixtureUsers(child)]),
    ) as T;
  }
  return value;
}

const localDate = (offsetDays = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

/**
 * A complete, isolated mock workspace for test@anvik.ops.
 *
 * It starts from the worked example so every shared room is populated, then
 * remaps all user-owned rows to the test identity. The two founder profiles
 * remain unchanged and are present only so avatars and the Us counterpart can
 * render. This dataset is stored under a test-only localStorage key.
 */
export function seedTestDataset(): Dataset {
  const base = seedDataset();
  if (!import.meta.env.DEV || !base.profiles.some((profile) => profile.id === TEST)) return base;

  const out = remapFixtureUsers(base);
  out.profiles = base.profiles;

  const now = new Date();
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  const today = localDate();
  const yesterday = localDate(-1);

  out.mail_items = out.mail_items.map((item) => ({
    ...item,
    owner_id: TEST,
    account_email: 'test@anvik.ops',
  }));
  out.documents = out.documents.map((item) => ({
    ...item,
    owner_id: TEST,
    account_email: 'test@anvik.ops',
  }));
  out.courses = out.courses.map((item) => ({ ...item, owner_id: TEST }));
  out.reading_queue = out.reading_queue.map((item) => ({ ...item, owner_id: TEST }));
  out.fixed_dates = out.fixed_dates.map((item) => ({ ...item, owner_id: TEST }));
  out.screenshot_attachments = out.screenshot_attachments.map((item) => ({
    ...item,
    data_url: TEST_MOMENT_PHOTO,
  }));
  out.notes = out.notes.map((note, index) =>
    index === 0
      ? {
          ...note,
          images: [
            {
              id: 'test-note-photo', filename: 'evening-reset.svg', mime: 'image/svg+xml',
              width: 960, height: 640, bytes: TEST_MOMENT_PHOTO.length,
              data_url: TEST_MOMENT_PHOTO, created_at: at(90),
            },
          ],
        }
      : note,
  );
  out.shared_daily = out.shared_daily.map((item) => ({
    ...item,
    picked_by: TEST,
    photo_url: TEST_MOMENT_PHOTO,
    photo_caption: 'Evening reset · test fixture',
  }));
  out.audit_trail = out.audit_trail.map((item) => ({
    ...item,
    actor_label: item.actor_id === TEST ? 'Test' : item.actor_label,
  }));

  out.import_batches = [
    {
      id: 'test-import-batch', filename: 'mock-ledger-august.csv', row_count: 2,
      duplicates_skipped: 1, imported_by: TEST,
      column_mapping: { Date: 'date', Party: 'party', Amount: 'amount', Direction: 'direction' },
      imported_at: at(2 * 24 * 60),
    },
  ];
  out.ledger = out.ledger.map((item, index) => ({
    ...item,
    paid_by: TEST,
    payer_allocations: [{ user_id: TEST, amount: item.amount }],
    split_pct: item.direction === 'out' ? 100 : null,
    expense_kind: item.direction === 'out' ? (index % 2 === 0 ? 'one_time' : 'recurring') : null,
    import_batch_id: index < 2 ? 'test-import-batch' : item.import_batch_id,
  }));

  out.day_plans = [
    {
      id: 'test-day-plan', user_id: TEST, date: today, capacity: 'medium',
      intention: 'Exercise every room with realistic fixture data',
      wins: [
        { text: 'Review the priority board', done: true },
        { text: 'Check Notebook and Money states', done: false },
        { text: 'Reply to the shared moment', done: false },
      ],
      created_at: at(180),
    },
  ];
  out.day_plan_items = [
    { id: 'test-plan-task', user_id: TEST, date: today, task_id: 'T-42', text: 'Review the collector QA report', done: false, position: 1, source: 'task', created_at: at(175) },
    { id: 'test-plan-manual', user_id: TEST, date: today, task_id: null, text: 'Walk through every module once', done: false, position: 2, source: 'manual', created_at: at(170) },
  ];
  out.day_events = [
    { id: 'test-event-focus', user_id: TEST, date: today, start_min: 9 * 60 + 30, end_min: 11 * 60, label: 'Fixture review · focused', kind: 'focus', task_id: 'T-42' },
    { id: 'test-event-admin', user_id: TEST, date: today, start_min: 11 * 60 + 30, end_min: 12 * 60 + 15, label: 'Notebook and Money pass', kind: 'admin', task_id: null },
    { id: 'test-event-personal', user_id: TEST, date: today, start_min: 17 * 60, end_min: 18 * 60, label: 'Evening reset', kind: 'personal', task_id: null },
  ];
  out.daily_closeouts = [
    ...out.daily_closeouts,
    { id: 'test-closeout', user_id: TEST, date: yesterday, shipped: 'Mock workspace isolation', stuck: 'Photo fixture needed a local-safe source', tomorrow: 'Test every room end to end', created_at: at(12 * 60) },
  ];

  out.messages = [
    ...out.messages,
    {
      id: 'test-msg-photo', sender_id: AN, body: 'A quiet reset before the next pass.', kind: 'photo',
      reply_to_id: null, task_ref_id: null, attachment_url: TEST_MOMENT_PHOTO, song_ref: null,
      promoted_to_type: null, promoted_to_id: null, read_at: null, created_at: at(8),
    },
    {
      id: 'test-msg-song', sender_id: AN, body: 'This felt right for the build.', kind: 'song',
      reply_to_id: null, task_ref_id: null, attachment_url: null,
      song_ref: { title: 'Ilahi', artist: 'Pritam · Arijit Singh', url: 'https://www.youtube.com/watch?v=UBscsdrK0Bo' },
      promoted_to_type: null, promoted_to_id: null, read_at: null, created_at: at(6),
    },
    {
      id: 'test-msg-reply', sender_id: TEST, body: 'Perfect test pair — photo and song both render.', kind: 'chat',
      reply_to_id: 'test-msg-photo', task_ref_id: null, attachment_url: null, song_ref: null,
      promoted_to_type: null, promoted_to_id: null, read_at: null, created_at: at(4),
    },
  ];

  out.mood_items = [
    ...out.mood_items,
    { id: 'test-mood-photo', user_id: TEST, kind: 'image', title: 'Evening reset', body: 'Keep one calm image in view.', url: null, storage_path: TEST_MOMENT_PHOTO, color: '', position: 3, pinned_at: at(60) },
    { id: 'test-mood-song', user_id: TEST, kind: 'song', title: 'Ilahi', body: 'Pritam · Arijit Singh', url: 'https://www.youtube.com/watch?v=UBscsdrK0Bo', storage_path: null, color: 'indigo', position: 4, pinned_at: at(55) },
    { id: 'test-mood-note', user_id: TEST, kind: 'note', title: 'Test intention', body: 'Every room should tell a coherent story.', url: null, storage_path: null, color: 'teal', position: 5, pinned_at: at(50) },
  ];

  out.personal_orders = [
    {
      id: 'test-order-physical', user_id: TEST, integration_grant_id: null, account_email: 'test@anvik.ops',
      kind: 'physical', review_status: 'pending', lifecycle_status: 'out_for_delivery', merchant: 'Field Notes',
      external_reference: 'FN-2048', summary: 'Notebook set · three pack', amount: 1890, currency: 'INR',
      next_event_at: at(-90), details: { items: ['Pitch black notebook set'], carrier: 'Blue Dart', tracking_number: 'TEST2048', tracking_url: null },
      manual_fields: [], reviewed_at: null, reviewed_by: null, last_event_at: at(35), created_at: at(3 * 24 * 60), updated_at: at(35),
    },
    {
      id: 'test-order-travel', user_id: TEST, integration_grant_id: null, account_email: 'test@anvik.ops',
      kind: 'travel', review_status: 'confirmed', lifecycle_status: 'booked', merchant: 'IndiGo',
      external_reference: 'TESTPNR', summary: 'Bengaluru → Delhi', amount: 6840, currency: 'INR',
      next_event_at: at(-2 * 24 * 60), details: { booking_reference: 'TESTPNR', origin: 'BLR', destination: 'DEL', departure_at: at(-2 * 24 * 60), arrival_at: at(-2 * 24 * 60 - 165), stay_end_at: null },
      manual_fields: [], reviewed_at: at(24 * 60), reviewed_by: TEST, last_event_at: at(2 * 24 * 60), created_at: at(5 * 24 * 60), updated_at: at(24 * 60),
    },
  ];
  out.personal_order_events = [
    { id: 'test-order-event-1', order_id: 'test-order-physical', user_id: TEST, integration_grant_id: null, gmail_message_id: 'mock-field-notes-1', event_type: 'out_for_delivery', event_at: at(35), sender: 'updates@fieldnotes.example', subject: 'Your order is out for delivery', source_url: '', detection_reason: 'Delivery status phrase matched', confidence: 0.97, parsed_fields: { carrier: 'Blue Dart' }, created_at: at(34) },
    { id: 'test-order-event-2', order_id: 'test-order-travel', user_id: TEST, integration_grant_id: null, gmail_message_id: 'mock-indigo-1', event_type: 'booked', event_at: at(2 * 24 * 60), sender: 'itinerary@indigo.example', subject: 'Booking confirmed · TESTPNR', source_url: '', detection_reason: 'Booking reference and itinerary matched', confidence: 0.99, parsed_fields: { origin: 'BLR', destination: 'DEL' }, created_at: at(2 * 24 * 60 - 1) },
  ];

  return out;
}
