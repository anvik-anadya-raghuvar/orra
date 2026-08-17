# Anvik Ops — Implementation Plan v2 (authoritative)

This supersedes the agent's first draft plan. It keeps everything that draft got right, corrects six things it got wrong or invented, and closes four gaps it left open. Hand this back to Antigravity as the corrected plan and instruct it to build against **this document**, not its own.

---

## 0. Corrections to the previous plan — read first

| # | Issue in draft | Correction |
|---|---|---|
| 1 | Allowlist hard-coded `anadya@anvik.ops` / `raghuvar@anvik.ops` | Wrong domain and probably wrong addresses entirely. Use the two real Google sign-in addresses filled into §1.1 below. **Blocking — must be filled before the auth trigger is written.** |
| 2 | Ranking weights invented as constants (40/35/25) | Weights are correct in spirit but must live in a `ranking_weights` table, editable without a code change. Default 40 / 30 / 30. |
| 3 | Task IDs as `ANV-101` | Confirmed in §1.1. Whatever is chosen is permanent — changing later is a migration. |
| 4 | Task detail built as a modal | Build as a **routed page** at `/task/:id`, not a modal. It must have its own URL so it can be kept open in a second tab alongside a coding session. A modal is acceptable only for quick-peek from the Us chat. |
| 5 | Keepalive mentioned in architecture but assigned to no build step | Promoted to an explicit deliverable in Step 1 with a real committed file. |
| 6 | RLS covered tables and audit trail, but not Storage | Storage bucket policies are a named requirement, in Step 1, verified in the gate. |

Additions the draft made that are **approved**: Framer Motion for transitions; the local mock-data engine as a build accelerator (with the condition in §4 Step 1); Vitest for the determinism test; `xlsx` + `papaparse` for import/export.

---

## 1. Decisions required before any code

### 1.1 Blocking — fill these in
- **Allowlisted email 1 (Anadya's real Google account):** `________________`
- **Allowlisted email 2 (Raghuvar's real Google account):** `________________`
- **Task ID scheme:** choose one — `ANV-101` (project-prefixed, per-project counters) / `T-101` (single global counter) / no visible ID at all (title only)
- **Supabase project URL and anon key:** create the project first; the agent should not provision a backend blind

### 1.2 Non-blocking, sensible defaults applied unless overridden
- Ranking weights: objective fit 40, unblocks 30, deadline proximity 30
- Decision "stale" threshold: 7 days
- Focus block length: 50 minutes
- Screenshot compression target: ≤300 KB post-compression, hard reject >2 MB
- Default relationship cadences: customer 14d, vendor 7d, investor 21d, university 30d, personal 3d
- Timezones: `Asia/Kolkata` and `Europe/Rome`, both always displayed in the header

---

## 2. Architecture

**Frontend:** Vite + React 18 + TypeScript + Tailwind + Lucide icons + Framer Motion. Client-side routing with real URLs for every screen and for individual tasks.

**Backend:** Supabase — Postgres, Supabase Auth (Google OAuth), Supabase Storage (private bucket `screenshots`), Supabase Realtime (for the Us chat and board updates). **Not Firebase.**

**Hosting:** Cloudflare Pages free tier (permits commercial use, unlimited bandwidth, free subdomain). No purchased domain.

**Email:** notification and digest mail sends through the connected Google account via Gmail API `gmail.send` scope, app kept in testing mode with the two allowlisted addresses as test users. No third-party mail service, no domain required.

**Cost target:** ₹0 recurring. Any decision that risks leaving a free tier must be flagged, not silently accepted.

### Governing principles (enforce in every screen)
1. **The portal stays whole.** No global workspace mode. Project filtering is local to a screen and never changes which tabs exist or what Home shows.
2. **No role gating.** Both users see everything including Money. Per-user curation of their own Home is a preference, never a permission. There is no "owners only" check anywhere in the codebase.
3. **Append-only trail.** Every meaningful mutation writes actor, entity, field, old value, new value, source. Enforced by revoking UPDATE and DELETE at the database level.
4. **Tags are free-form,** user-invented, colored, centrally managed.
5. **The export generator is a pure function.** No LLM in the pipeline. Byte-identical output for identical input, proven by test.
6. **Task type changes what the task page renders,** not just a badge.
7. **Personal life never blends into the business ranking algorithm.** Two separate systems.

---

## 3. Database schema

All tables get `ENABLE ROW LEVEL SECURITY` with policies checking that `auth.jwt() ->> 'email'` exists in `allowlist`. Timestamps are `TIMESTAMPTZ`. Foreign keys enforced.

**Identity and config**
1. `allowlist` — `email PK`, `name`, `role`, `invited_at`
2. `profiles` — `id UUID PK → auth.users`, `email UNIQUE`, `name`, `avatar_url`, `time_zone`, `status_text`, `status_expires_at`, `personalization JSONB`
3. `projects` — `id TEXT PK`, `name`, `color`, `description`, `is_personal BOOLEAN`, `created_at` *(seeded rows, never enum constants in code)*
4. `ranking_weights` — `id PK`, `objective_fit INT`, `unblocks INT`, `deadline INT`, `updated_at` *(single row, editable)*
5. `tags` — `id PK`, `name UNIQUE`, `color`, `created_by`, `created_at`

**Work**
6. `objectives` — `id PK`, `title`, `project_id FK`, `quarter`, `created_at`
7. `key_results` — `id PK`, `objective_id FK`, `title`, `progress_pct INT`, `position INT`
8. `tasks` — `id PK`, `title`, `description TEXT` (≤50 000 chars), `acceptance_criteria TEXT`, `project_id FK`, `type` (`code_change|ops|finance|research`), `status` (`todo|in_progress|in_review|done`), `priority` (`urgent|high|normal|low`), `assignee_id FK`, `created_by FK`, `start_date`, `due_date`, `objective_id FK NULL`, `tags TEXT[]`, `progress_pct INT`, `created_at`, `updated_at`
9. `subtasks` — `id PK`, `task_id FK`, `title`, `completed BOOLEAN`, `position INT`
10. `comments` — `id PK`, `task_id FK`, `author_id FK`, `body` (≤10 000), `is_decision BOOLEAN`, `created_at`
11. `screenshot_attachments` — `id PK`, `task_id FK`, `storage_path`, `filename`, `mime`, `width INT`, `height INT`, `uploaded_by FK`, `created_at`
12. `annotation_pins` — `id PK`, `screenshot_id FK`, `x_pct NUMERIC(5,1) CHECK 0–100`, `y_pct NUMERIC(5,1) CHECK 0–100`, `note` (≤5 000), `author_id FK`, `is_resolved BOOLEAN`, `created_at` *(pin number is derived at render/export time by `row_number() OVER (PARTITION BY screenshot_id ORDER BY created_at)` — never stored, so deletions can't create gaps)*
13. `decisions` — `id PK`, `question`, `project_id FK`, `recommendation`, `owner_id FK`, `status` (`open|ruled`), `opened_at`, `ruled_at NULL`, `ruling_note`

**Knowledge**
14. `notes` — `id PK`, `title`, `body`, `type` (`plain|checklist|meeting|voice|email`), `project_id FK`, `task_id FK NULL`, `tags TEXT[]`, `is_pinned BOOLEAN`, `transcript JSONB NULL`, `checklist JSONB NULL`, `source_ref TEXT NULL`, `created_by FK`, `created_at`
15. `mail_items` — `id PK`, `account_email`, `sender`, `subject`, `snippet`, `received_at`, `gmail_link`, `flag_reason NULL`, `project_id FK NULL`, `converted_to_type NULL`, `converted_to_id NULL` *(never store full message bodies)*
16. `documents` — `id PK`, `title`, `project_id FK`, `expiry_date NULL`, `deadline_note`, `cloud_ref_url`, `status_cache`

**People and communication**
17. `people` — `id PK`, `name`, `role`, `relationship_type` (`customer|vendor|investor|university|personal`), `project_id FK NULL`, `time_zone`, `cadence_days INT`, `last_contact_date`, `next_action`, `notes`, `created_at`
18. `people_interactions` — `id PK`, `person_id FK`, `occurred_on DATE`, `summary`, `logged_by FK`
19. `messages` — `id PK`, `sender_id FK`, `body` (≤5 000), `task_ref_id FK NULL`, `attachment_url NULL`, `song_ref JSONB NULL`, `promoted_to_type NULL`, `promoted_to_id NULL`, `created_at`
20. `shared_daily` — `id PK`, `date DATE`, `song_title`, `song_artist`, `song_url`, `picked_by FK`, `photo_url NULL`, `photo_caption NULL`

**Personal**
21. `courses` — `id PK`, `title`, `schedule_label`, `is_expanded BOOLEAN`, `position INT`
22. `course_items` — `id PK`, `course_id FK`, `title`, `completed BOOLEAN`, `position INT`
23. `reading_queue` — `id PK`, `title`, `author`, `status` (`queued|reading|done`), `position INT`
24. `time_logs` — `id PK`, `user_id FK`, `date`, `kind` (`study|founder`), `minutes INT`, `course_id FK NULL`
25. `life_admin` — `id PK`, `user_id FK`, `item`, `completed BOOLEAN`, `created_at`
26. `fixed_dates` — `id PK`, `label`, `date`, `category`

**Money**
27. `ledger` — `id PK`, `date`, `party`, `category`, `project_id FK`, `direction` (`in|out`), `amount NUMERIC(14,2)`, `status` (`paid|due|overdue`), `receipt_url NULL`, `linked_task_id FK NULL`, `import_batch_id NULL`
28. `import_batches` — `id PK`, `filename`, `row_count INT`, `duplicates_skipped INT`, `column_mapping JSONB`, `imported_by FK`, `imported_at` *(enables whole-batch rollback)*

**System**
29. `audit_trail` — `id PK`, `occurred_at`, `actor_id FK NULL`, `actor_label` (person name or `automated`), `entity_type`, `entity_id`, `field_name NULL`, `old_value NULL`, `new_value NULL`, `source` (`portal|gmail|plaud|drive|claude_export|rule`)
30. `automation_rules` — `id PK`, `trigger_label`, `trigger_value`, `action_label`, `action_value`, `is_active BOOLEAN`, `last_fired_at NULL`
31. `keepalive` — `id INT PK DEFAULT 1`, `pinged_at`
32. `daily_closeouts` — `id PK`, `user_id FK`, `date`, `shipped`, `stuck`, `tomorrow`, `created_at` *(the evening ritual entries — the draft plan omitted this table entirely)*

### Security specifics
```sql
-- allowlist gate at signup
CREATE TRIGGER on_auth_user_created BEFORE INSERT ON auth.users ...
  -- raises exception if NEW.email not in public.allowlist

-- append-only trail
REVOKE UPDATE, DELETE ON public.audit_trail FROM authenticated, anon, PUBLIC;

-- storage: private bucket, signed URLs only (1 hour expiry)
CREATE POLICY "team reads screenshots" ON storage.objects FOR SELECT
  USING (bucket_id = 'screenshots' AND is_team_member());
CREATE POLICY "team uploads screenshots" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'screenshots' AND is_team_member());
CREATE POLICY "uploader or owner deletes" ON storage.objects FOR DELETE
  USING (bucket_id = 'screenshots' AND (owner = auth.uid() OR is_owner()));
```

**Indexes:** `tasks(status)`, `tasks(assignee_id)`, `tasks(project_id)`, `tasks(due_date)`, `subtasks(task_id, position)`, `comments(task_id, created_at)`, `annotation_pins(screenshot_id, created_at)`, `messages(created_at DESC)`, `audit_trail(occurred_at DESC)`, `ledger(date DESC)`, `people(last_contact_date)`.

---

## 4. Build order

Each step ends with its gate met before the next begins.

**Step 1 — Foundation.** Vite/React/TS/Tailwind/Framer scaffold with real routing. Supabase project connected. Full schema + RLS + storage policies + allowlist trigger applied. `.github/workflows/keepalive.yml` committed and running on a 3-day cron hitting the `keepalive` table. Seed data across every table. Cloudflare Pages connected to the repo.
*Mock-data condition: a local mock layer is permitted to accelerate UI work, but it must be behind a single swappable data adapter, and every screen must be proven against real Supabase before that screen counts as done. No screen ships on mock data.*
**Gate:** both real emails sign in on mobile; a third Google account is rejected with a clear message; keepalive workflow green; a direct storage URL without a signed token returns 403.

**Step 2 — Home.** Three time-of-day modes with a manual mode switcher. Ambient facts row (dual-city weather, days to relocation, days to business deadline, runway, decisions open >7d). Morning: top-ranked task card with progress ring, score, and "why this one" link. Midday: single focus card with 50-minute timer. Evening: shutdown ritual writing to `daily_closeouts`, streak counter, digest email to both. Three summary tiles. Quick-capture input writing a real note. Optional personal layer with six independent per-user toggles (song, photo, worth-knowing, life radar, projects strip, money on Home) stored in `profiles.personalization`. Optional projects strip with the on-demand snapshot modal.
**Gate:** every toggle persists per user and does not affect the other user's Home; quick capture produces a retrievable note; closing the day writes a trail row.

**Step 3 — Work.** Board with Kanban, List, Calendar, Timeline views over the same data. Filter row: project chips, assigned-to-me, task type, dynamic tag chips built from live data. Goals tab with the ranking table showing per-column math read from `ranking_weights`, objective cards with slider-editable key results, and a drifting section with inline objective linking. Decisions tab with open/ruled register, >7-day urgent styling, new-decision modal, rule-and-close action.
**Gate:** changing a weight row changes the displayed ranking without a redeploy; a task with no objective visibly sinks in rank.

**Step 4 — Task detail (routed page).** `/task/:id`. Inline-editable title and description. Controls for status, assignee, project, start, due, objective, priority segment, type segment. Free-form tag add/remove. Code-change type: click-to-place pins on a screenshot at percentage coordinates, numbered stamps synced to a list below, resolve toggle, upload with client-side compression. Ops type: editable checklist. Sidebar: export box (code tasks only), subtasks, linked notes with inline create, comment thread with decision flagging, connected items, schedule-call deep link, message-about-this button.
**Gate:** a pin placed at desktop width lands on the same element at 380px; export produces byte-identical output twice; a code-type task shows the export box and an ops-type task does not.

**Step 5 — Knowledge.** Notes tab: full-text search across title, body, and transcript; type filters; masonry cards; click-to-open editor with title, body, checklist items, tags, pin, task attachment; voice notes with waveform and timestamped transcript plus "turn action items into subtasks". Mail tab: dual-account read-only list, flags, three conversion actions carrying `source_ref`. Documents tab: table with computed urgency status, Drive reference picker, add-document.
**Gate:** search finds a phrase that exists only inside a voice transcript; a conversion from mail produces an item traceable back to its message.

**Step 6 — People.** Card grid with warmth bars computed from `last_contact_date` against `cadence_days`. Type filters plus drifting filter. Log-touch resets warmth and appends to `people_interactions`. Full profile editor. Drifting banner.
**Gate:** logging a touch refills the bar and writes both an interaction row and a trail row.

**Step 7 — Us.** Realtime two-person thread. Promote any message to task, note, or decision with prefill and back-reference. Task attachment chips. Self-declared status with expiry. Shared song and photo of the day. Four ritual prefill buttons. Weekly promoted-count summary.
**Gate:** a message sent by one user appears for the other in under 2 seconds without refresh.

**Step 8 — Personal.** Expandable courses driving progress from checklist state. Reading queue cycling on tap. Study timer logging real minutes to `time_logs`. Study-vs-founder split bar computed from logs. Life admin checklist. Fixed dates. Relocation documents surfaced here as well as in Knowledge.
**Gate:** stopping a timer changes the split bar and writes a trail row; nothing on this screen influences the Work ranking table.

**Step 9 — Money.** No access check of any kind. Summary tiles, in-vs-out chart, category breakdown, transaction table with project filter chips. CSV/XLSX import with header auto-mapping, duplicate preview, and batch recording. CSV/XLSX export.
**Gate:** signing in as either user renders the module identically; an import creates one `import_batches` row and is reversible as a unit.

**Step 10 — Admin.** Trail with old-struck/new-bold rendering, source chips, CSV and XLSX export, and no edit or delete affordance. Rules list with toggles. Tag manager with usage counts, create, recolor, delete-everywhere. Connections cards.
**Gate:** an authenticated UPDATE against `audit_trail` fails at the database, with the error output pasted as evidence.

---

## 5. Export format (implement exactly)

```
# {task_id} · {title}
Project: {project} · Priority: {priority} · Status: {status}
Assignee: {assignee} · Due: {YYYY-MM-DD}

## Objective
{description}

## Screenshot {n} — {filename} ({width}×{height})
![screenshot-{n}](assets/{filename})
Pins:
{i}. (x {x}%, y {y}%) {author} — {note}

## Decisions
- {author} ({ISO-8601 UTC}): {decision-flagged comment}

## Background
- Note "{title}": {first line}
- Mail "{subject}": {snippet}
- Cost: {party}, INR {amount}, {status}

## Acceptance criteria
- [ ] {from acceptance_criteria field, or open subtasks as fallback with a warning}

## Agent instructions
Each pin is a located change request: its coordinates identify the exact region in the
screenshot above. Implement the acceptance criteria only — do not expand scope. Report
a diff summary mapped to each criterion.
```
Determinism rules: screenshots ordered by `created_at`; pins numbered by `created_at` within each screenshot; coordinates to exactly one decimal; timestamps ISO-8601 UTC; only `is_decision = true` comments included; no generated-at timestamp anywhere in the body. Zip contains `TASK.md` plus `assets/`.

---

## 6. Verification gates — evidence required, not assertions

**Security**
- [ ] Non-allowlisted JWT SELECT against every table returns zero rows — paste the output
- [ ] `UPDATE audit_trail` and `DELETE FROM audit_trail` both fail as `authenticated` — paste the errors
- [ ] `grep -rn "service_role" ./dist` returns nothing — paste the result
- [ ] Direct storage object URL without a signed token returns 403 — paste the response
- [ ] Signup with a non-allowlisted Google account is rejected by the trigger, not the UI
- [ ] Length caps rejected server-side, not only in the form

**Correctness**
- [ ] Vitest: two consecutive exports of identical task state are byte-identical
- [ ] Vitest: pin numbering stays contiguous after deleting a middle pin
- [ ] Ranking output changes when `ranking_weights` changes, with no redeploy

**Performance**
- [ ] p95 task-list fetch under 300 ms with 500 seeded tasks
- [ ] Production JS bundle ≤300 KB gzipped — paste the build output
- [ ] Screenshots lazy-loaded; annotation layer renders with no layout shift

**Manual**
- [ ] Both themes designed, adaptive to system preference, manual toggle persists
- [ ] `prefers-reduced-motion` disables all animation
- [ ] Pin coordinates hold across desktop → mobile resize
- [ ] Full keyboard navigation with visible focus rings, AA contrast in both themes
- [ ] Every screen verified against real Supabase, not mock data

---

## 7. Explicitly out of scope

No client or external access. No third user. No in-app video calling — calendar deep links only. No AI generation anywhere in the export pipeline. No native mobile app. No payments. No general-ledger accounting — Money is an operational view, not books of account.

---

## 8. Timeline and kill criteria

Target: core loop (Steps 1–5) usable daily within four weekends; full system within six. If the export does not drive a coding session cleanly by the end of Step 4, freeze and reassess — that feature is the reason this is being built rather than bought. If the whole thing is not in daily use before the Italy move, freeze the repo, fall back to ClickUp Free for the team, and resume at winter break.
