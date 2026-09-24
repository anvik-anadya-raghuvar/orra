import type { Dataset, MailItem, Note, Task } from '../types';
import { stripInlineImageMarkers } from '../ui/inlineImages';
import { taskAssignees, taskProjects, taskTypes } from './taskFacets';

/**
 * Coding-agent export generator — a PURE FUNCTION (principle 5). No LLM, no clock,
 * no randomness: identical task state → byte-identical output. Format is
 * IMPLEMENTATION-PLAN-v2.md §5, extended with code context, dependencies,
 * the thread, and the task's files.
 */

const byCreatedAt = <T extends { created_at: string; id: string }>(a: T, b: T) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

const iso8601Utc = (ts: string) => new Date(ts).toISOString().replace(/\.\d{3}Z$/, 'Z');

const one = (n: number) => n.toFixed(1);

/** Caps keep one chatty task from producing a brief nobody reads. */
export const EXPORT_CAPS = {
  /** Characters of a linked note's body. */
  noteBody: 2000,
  /** Characters of one thread comment or decision. */
  comment: 1000,
  /** Most recent non-decision comments carried into `## Thread`. */
  threadComments: 20,
} as const;

/**
 * Every zip entry carries this date instead of "now", so two exports of the
 * same task are byte-identical (principle 5). 1980-01-01 is the DOS epoch —
 * the earliest date a zip header can hold — which also reads as "not a real
 * timestamp" to anyone who looks.
 */
export const ZIP_FIXED_DATE = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

/**
 * A screenshot filename is user input. Give every asset a deterministic,
 * unique path so two pasted files called `Screenshot.jpg` cannot overwrite
 * one another in the handoff bundle (and path separators cannot escape the
 * assets folder).
 */
export function taskAssetName(filename: string, index: number): string {
  const leaf = filename.split(/[\\/]/).pop() || 'screenshot.jpg';
  const safe = leaf
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'screenshot.jpg';
  return `${String(index + 1).padStart(2, '0')}-${safe}`;
}

/** The single top folder the context zip unpacks into. */
export function bundleFolderName(taskId: string): string {
  return `orra-${taskId.replace(/[^A-Za-z0-9._-]+/g, '-')}`;
}

/**
 * What the bundle actually holds for one screenshot, relative to the bundle
 * root. TASK.md, HOW-TO-READ.md and CONTEXT.json are all written from this,
 * so none of them can point at a file the zip does not contain.
 */
export interface ShotAssets {
  /** The image TASK.md links. Null when no image data was stored. */
  image: string | null;
  /** True only when numbered markers were actually burned into `image`. */
  markersDrawn: boolean;
  /** The clean copy beside a marked image. Null when none was written. */
  original: string | null;
}

export interface TaskExportOptions {
  /**
   * The markdown travels alone (the .md download, Copy TASK.md): nothing sits
   * beside it, so image links are replaced by a note pointing at the zip.
   */
  standalone?: boolean;
  /** What the zip really wrote, per screenshot id. Omitted = the planned
   *  layout (marked image + clean original for every stored screenshot). */
  written?: Map<string, ShotAssets>;
}

/** The layout exportTaskZip aims for when annotation succeeds. */
function plannedAssets(ds: Dataset, taskId: string): Map<string, ShotAssets> {
  const out = new Map<string, ShotAssets>();
  taskShots(ds, taskId).forEach((shot, index) => {
    const asset = taskAssetName(shot.filename, index);
    out.set(
      shot.id,
      shot.data_url
        ? { image: `assets/${asset}`, markersDrawn: true, original: `assets/original-${asset}` }
        : { image: null, markersDrawn: false, original: null },
    );
  });
  return out;
}

const taskShots = (ds: Dataset, taskId: string) =>
  ds.screenshot_attachments.filter((s) => s.task_id === taskId).sort(byCreatedAt);

/* ── markdown text helpers ─────────────────────────────────────────────── */

/**
 * User text going into markdown. A raw `<td>` in a pin note is swallowed by
 * most renderers as an HTML tag, and a leading `>` turns a line into a quote.
 * A backslash escape keeps both readable raw and rendered.
 */
function md(text: string | null | undefined): string {
  return (text ?? '').replace(/\r\n?/g, '\n').replace(/[<>]/g, (c) => `\\${c}`);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()} …(truncated)` : text;
}

/**
 * Continuation lines of a list item, indented so a multi-line decision or pin
 * note stays inside its bullet instead of breaking out into a paragraph.
 */
function inItem(text: string): string {
  return text
    .split('\n')
    .map((line, i) => (i === 0 ? line : line.trim() ? `  ${line}` : ''))
    .join('\n');
}

/** Code spans cannot contain their own delimiter; paths never need one. */
const code = (text: string) => `\`${text.replace(/`/g, '')}\``;

/** Paths from the newline-separated `code_paths` column, in stored order. */
function codePaths(task: Task): string[] {
  return (task.code_paths ?? '')
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
}

function criteriaOf(task: Task): string[] {
  return task.acceptance_criteria
    .split('\n')
    .map((l) => l.replace(/^-\s*(\[[ xX]\]\s*)?/, '').trim())
    .filter(Boolean);
}

/**
 * A criterion that a person has to confirm — a report attached, a sign-off,
 * a call made. Flagged so an agent does not claim it "passed" from a diff.
 * A fixed word list, so the flag is a pure function of the text.
 */
const MANUAL_CRITERION =
  /\b(attach(ed|ment)?|report|sign(ed)?[- ]?off|signed|approv\w*|confirm(ed)? (with|by)|call(ed)?|e-?mail(ed)?|meet(ing)?|agree\w*|book(ed)?|sen[dt]|ask(ed)?|review(ed)? by|present\w*|publish\w*)\b/i;

export function isManualCriterion(text: string): boolean {
  return MANUAL_CRITERION.test(text);
}

interface CodeContext {
  repo_url: string | null;
  branch: string | null;
  branch_source: 'task' | 'project' | null;
  paths: string[];
}

function codeContextOf(ds: Dataset, task: Task): CodeContext {
  const project = ds.projects.find((p) => p.id === task.project_id);
  const taskBranch = task.branch?.trim() || null;
  const projectBranch = project?.default_branch?.trim() || null;
  return {
    repo_url: project?.repo_url?.trim() || null,
    branch: taskBranch ?? projectBranch,
    branch_source: taskBranch ? 'task' : projectBranch ? 'project' : null,
    paths: codePaths(task),
  };
}

type Relation = 'blocked_by' | 'blocks' | 'parent' | 'child' | 'related';
const RELATION_LABEL: Record<Relation, string> = {
  blocked_by: 'Blocked by',
  blocks: 'Blocks',
  parent: 'Child of',
  child: 'Parent of',
  related: 'Related to',
};
const RELATION_ORDER: Relation[] = ['blocked_by', 'blocks', 'parent', 'child', 'related'];

/**
 * Every link touching the task, seen from this task's side. `A blocks B` and
 * `B blocked_by A` are one fact, so both spellings land in the same bucket
 * and a pair stated both ways is listed once.
 */
function dependenciesOf(ds: Dataset, taskId: string) {
  const seen = new Set<string>();
  const out: { relation: Relation; task_id: string; title: string | null; status: string | null }[] = [];
  for (const l of [...ds.task_links].sort(byCreatedAt)) {
    let relation: Relation | null = null;
    let other = '';
    if (l.from_task_id === taskId) {
      other = l.to_task_id;
      relation = l.type === 'blocks' ? 'blocks' : l.type === 'blocked_by' ? 'blocked_by' : l.type === 'child_of' ? 'parent' : 'related';
    } else if (l.to_task_id === taskId) {
      other = l.from_task_id;
      relation = l.type === 'blocks' ? 'blocked_by' : l.type === 'blocked_by' ? 'blocks' : l.type === 'child_of' ? 'child' : 'related';
    }
    if (!relation || other === taskId) continue;
    const key = `${relation}|${other}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const t = ds.tasks.find((x) => x.id === other);
    out.push({ relation, task_id: other, title: t?.title ?? null, status: t?.status ?? null });
  }
  return out.sort((a, b) => RELATION_ORDER.indexOf(a.relation) - RELATION_ORDER.indexOf(b.relation));
}

const linkedNotesOf = (ds: Dataset, taskId: string): Note[] =>
  ds.notes.filter((n) => n.task_id === taskId).sort(byCreatedAt);

/**
 * Mail that belongs to THIS task: converted into it, or into a note that is
 * linked to it. Not every flagged mail in the project — those are about the
 * project, and a brief padded with them hides the one that matters.
 */
function linkedMailOf(ds: Dataset, taskId: string, notes: Note[]): MailItem[] {
  const noteIds = new Set(notes.map((n) => n.id));
  return ds.mail_items
    .filter(
      (m) =>
        (m.converted_to_type === 'task' && m.converted_to_id === taskId) ||
        (m.converted_to_type === 'note' && m.converted_to_id != null && noteIds.has(m.converted_to_id)),
    )
    .sort((a, b) => a.received_at.localeCompare(b.received_at) || a.id.localeCompare(b.id));
}

const taskFilesOf = (ds: Dataset, taskId: string) =>
  ds.attachments.filter((a) => a.entity_type === 'task' && a.entity_id === taskId).sort(byCreatedAt);

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} KB`;

/* ── TASK.md ───────────────────────────────────────────────────────────── */

export function generateTaskExport(
  ds: Dataset,
  taskId: string,
  options: TaskExportOptions = {},
): string {
  const task = ds.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`No task ${taskId}`);
  const profiles = new Map(ds.profiles.map((p) => [p.id, p.name]));
  const who = (id: string | null | undefined) => md(profiles.get(id ?? '') ?? '—');
  /* Every project and every person, primary first, joined in the order the
     task carries them. Still a pure function of the row (principle 5): the
     lists are read, never sorted or de-duplicated differently per call. */
  const projectNames = taskProjects(task)
    .map((id) => ds.projects.find((p) => p.id === id)?.name ?? id)
    .join(', ');
  const assigneeNames = taskAssignees(task)
    .map((id) => profiles.get(id) ?? id)
    .join(', ');
  const types = taskTypes(task);
  /* Principle 7: the primary type changes what the brief says, not just a
     label. A code change gets its code context and a verification recipe; a
     research task gets no instructions to go and edit code. */
  const isCode = types.includes('code_change');
  const isResearch = !isCode && task.type === 'research';
  const assets = options.written ?? plannedAssets(ds, task.id);

  const lines: string[] = [];
  lines.push(`# ${task.id} · ${md(task.title)}`);
  lines.push(
    `Project: ${md(projectNames) || '—'} · Priority: ${task.priority} · Status: ${task.status}`,
  );
  lines.push(
    `Assignee: ${md(assigneeNames) || '—'} · Start: ${task.start_date ?? '—'} · Due: ${task.due_date ?? '—'}`,
  );
  lines.push(
    `Type: ${md(types.join(', ')) || '—'} · Tags: ${task.tags.length ? md(task.tags.join(', ')) : '—'}`,
  );
  if (task.is_stuck || task.blocked_reason) {
    lines.push('');
    lines.push(
      `> **${task.is_stuck ? 'Stuck' : 'Blocked'}:** ${md(task.blocked_reason?.trim() || 'no reason given').replace(/\n/g, ' ')}`,
    );
  }
  lines.push('');
  lines.push('## Objective');
  lines.push(md(stripInlineImageMarkers(task.description)) || '—');

  const cc = codeContextOf(ds, task);
  if (isCode || cc.repo_url || cc.branch || cc.paths.length) {
    lines.push('');
    lines.push('## Code context');
    if (!cc.repo_url && !cc.branch && !cc.paths.length) {
      lines.push('- Not set — add a repository on the project, or a branch and paths on the task.');
    } else {
      lines.push(`- Repository: ${cc.repo_url ? code(cc.repo_url) : '—'}`);
      lines.push(
        `- Branch: ${cc.branch ? `${code(cc.branch)}${cc.branch_source === 'project' ? ' (project default)' : ''}` : '—'}`,
      );
      if (cc.paths.length) {
        lines.push('- Paths:');
        for (const p of cc.paths) lines.push(`  - ${code(p)}`);
      }
    }
  }

  const deps = dependenciesOf(ds, task.id);
  if (deps.length) {
    lines.push('');
    lines.push('## Dependencies');
    for (const d of deps) {
      lines.push(
        `- ${RELATION_LABEL[d.relation]}: **${md(d.task_id)}** · ${d.title ? `${md(d.title)} (${d.status})` : '(not found)'}`,
      );
    }
  }

  const pinNumbers = taskPinNumbers(ds, task.id);
  const pinLine = (pin: Dataset['annotation_pins'][number]) => {
    // The label goes in front of the note so an agent reading this can tell
    // a copy tweak from a logic bug without inferring it from prose. Omitted
    // entirely when unset, so output stays stable for uncategorised pins.
    const label = pin.label ? `[${md(pin.label)}] ` : '';
    // Task-global number, in bold, matching the marker burned onto the image:
    // a bullet rather than an ordered list, whose renderer would renumber it.
    return `- **Pin ${pinNumbers.get(pin.id)}** (x ${one(pin.x_pct)}%, y ${one(pin.y_pct)}%) ${who(pin.author_id)} — ${label}${inItem(md(pin.note))}`;
  };
  let openPinCount = 0;
  let resolvedPinCount = 0;
  taskShots(ds, task.id).forEach((shot, si) => {
    const n = si + 1;
    const a = assets.get(shot.id) ?? { image: null, markersDrawn: false, original: null };
    lines.push('');
    lines.push(`## Screenshot ${n} — ${md(shot.filename)} (${shot.width}×${shot.height})`);
    if (!shot.data_url) {
      // Better an explicit note than a broken image link to a file the zip
      // could never contain.
      lines.push(
        `> No image data stored for this screenshot — the pin coordinates below still locate each change.`,
      );
    } else if (options.standalone) {
      // Nothing travels beside a lone .md — a relative link would be broken.
      lines.push(`_(screenshot ${n} — included in the Context folder zip)_`);
    } else if (a.image) {
      lines.push(`![screenshot-${n}](${a.image})`);
      lines.push(
        a.markersDrawn
          ? '_Numbered markers are drawn on this image; each matches a pin below._'
          : '_Markers could not be drawn on this copy — use each pin’s coordinates, measured from the top-left._',
      );
    }
    const pins = ds.annotation_pins.filter((p) => p.screenshot_id === shot.id).sort(byCreatedAt);
    const open = pins.filter((p) => !p.is_resolved);
    const resolved = pins.filter((p) => p.is_resolved);
    openPinCount += open.length;
    resolvedPinCount += resolved.length;
    // A blank line first: straight after the "> No image data" note, "Pins:"
    // would otherwise be swallowed into the quote as a lazy continuation.
    lines.push('');
    if (open.length) {
      lines.push('Pins:');
      for (const pin of open) lines.push(pinLine(pin));
    } else {
      lines.push(resolved.length ? 'Pins: none open' : 'Pins: none');
    }
    if (resolved.length) {
      lines.push('');
      lines.push('Resolved — do not act:');
      for (const pin of resolved) lines.push(pinLine(pin));
    }
  });

  const comments = ds.comments.filter((c) => c.task_id === task.id).sort(byCreatedAt);
  const commentLine = (c: (typeof comments)[number]) =>
    `- ${who(c.author_id)} (${iso8601Utc(c.created_at)}): ${inItem(clip(md(c.body), EXPORT_CAPS.comment))}`;

  const decisions = comments.filter((c) => c.is_decision);
  lines.push('');
  lines.push('## Decisions');
  if (decisions.length) {
    for (const d of decisions) lines.push(commentLine(d));
  } else {
    lines.push('- none recorded');
  }

  const talk = comments.filter((c) => !c.is_decision);
  if (talk.length) {
    lines.push('');
    lines.push('## Thread');
    const kept = talk.slice(-EXPORT_CAPS.threadComments);
    if (kept.length < talk.length) {
      lines.push(`_${talk.length - kept.length} earlier comments omitted._`);
    }
    for (const c of kept) lines.push(commentLine(c));
  }

  lines.push('');
  lines.push('## Background');
  const linkedNotes = linkedNotesOf(ds, task.id);
  for (const n of linkedNotes) {
    // Attribute the note: either of them can add context to a task, and who
    // said it changes how a reader weighs it.
    const author = profiles.get(n.created_by);
    const body = clip(md(stripInlineImageMarkers(n.body || '').trim()), EXPORT_CAPS.noteBody);
    lines.push(`- Note "${md(n.title)}"${author ? ` (${md(author)})` : ''}: ${inItem(body || '—')}`);
  }
  const linkedMail = linkedMailOf(ds, task.id, linkedNotes);
  for (const m of linkedMail) {
    lines.push(`- Mail "${md(m.subject)}" from ${md(m.sender)}: ${inItem(md(m.snippet))}`);
  }
  const costs = ds.ledger
    .filter((l) => l.linked_task_id === task.id)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const c of costs) {
    lines.push(`- Cost: ${md(c.party)}, INR ${c.amount}, ${c.status}`);
  }
  if (!linkedNotes.length && !linkedMail.length && !costs.length) lines.push('- none linked');

  const files = taskFilesOf(ds, task.id);
  if (files.length) {
    lines.push('');
    lines.push('## Files');
    lines.push('_Listed, not bundled — open them from the task in ORRA._');
    for (const f of files) {
      lines.push(
        `- ${md(f.filename)} (${md(f.mime) || 'file'}, ${kb(f.bytes)})${f.caption ? ` — ${md(f.caption).replace(/\n/g, ' ')}` : ''}`,
      );
    }
  }

  const subtasks = ds.subtasks
    .filter((s) => s.task_id === task.id)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  if (subtasks.length) {
    lines.push('');
    lines.push('## Subtasks');
    for (const s of subtasks) lines.push(`- [${s.completed ? 'x' : ' '}] ${md(s.title)}`);
  }

  lines.push('');
  lines.push('## Acceptance criteria');
  const criteria = criteriaOf(task);
  let manualCount = 0;
  if (criteria.length) {
    for (const c of criteria) {
      const manual = isManualCriterion(c);
      if (manual) manualCount += 1;
      lines.push(`- [ ] ${md(c)}${manual ? ' _(manual check — not provable from code)_' : ''}`);
    }
  } else {
    const openSubs = subtasks.filter((s) => !s.completed);
    lines.push('> Warning: no acceptance criteria set — falling back to open subtasks.');
    for (const s of openSubs) lines.push(`- [ ] ${md(s.title)}`);
  }

  lines.push('');
  lines.push('## Agent instructions');
  if (isResearch) {
    lines.push('This is a research task: no code changes are expected. Answer the objective from');
    lines.push('the background and any sources you find, and stay inside the acceptance criteria.');
    lines.push('Report findings mapped to each criterion, with a source for every claim.');
    lines.push('');
    lines.push('**How to verify:** every criterion has an answer and a source a person can check.');
  } else {
    if (openPinCount) {
      lines.push(
        'Each pin is a located change request: its coordinates identify the exact region in the',
      );
      lines.push('screenshot above, and its number matches the marker on the image.');
    }
    if (resolvedPinCount) {
      lines.push('Pins under "Resolved — do not act" are already done; do not change them again.');
    }
    if (isCode) {
      lines.push('Implement the acceptance criteria only — do not expand scope. Work on the branch and');
      lines.push('paths under Code context when they are given. Report a diff summary mapped to each');
      lines.push('criterion.');
      lines.push('');
      lines.push(
        '**How to verify:** for each criterion, name the test or command that proves it and paste its output.',
      );
      if (openPinCount) {
        lines.push('For each open pin, confirm the region at its marker now shows the requested change.');
      }
      if (manualCount) {
        lines.push('Criteria marked _manual check_ cannot be proven from code — list them for a person to confirm.');
      }
    } else {
      lines.push('Complete the acceptance criteria only — do not expand scope. Report what was done,');
      lines.push('mapped to each criterion.');
      lines.push('');
      lines.push(
        `**How to verify:** each criterion has evidence a person can check.${manualCount ? ' Criteria marked _manual check_ need a person to confirm them.' : ''}`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

/* ── the context folder (zip) ─────────────────────────────────────────── */

/**
 * Bundle TASK.md + HOW-TO-READ.md + CONTEXT.json + assets/ into a zip under
 * one top folder, `orra-<TASK-ID>/`, so unpacking it into a repo cannot
 * overwrite that repo's own README. Lazy-loads jszip.
 *
 * Screenshots are written with their pin markers BURNED IN, numbered to match
 * the list in TASK.md. Shipping the raw image plus a list of percentages would
 * make the reader compute where "x 32.4%" lands and hope they picked the right
 * element; a marker drawn at that point removes the guess entirely.
 *
 * Byte-identical for identical task state (principle 5): every entry carries
 * ZIP_FIXED_DATE rather than the clock, and entries are added in a fixed order.
 * The text files are written AFTER annotation, from what was really written,
 * so none of them promises a marker or a file that is not there.
 */
export async function exportTaskZip(ds: Dataset, taskId: string): Promise<Blob> {
  const [{ default: JSZip }, { annotateScreenshot }] = await Promise.all([
    import('jszip'),
    import('./annotateImage'),
  ]);
  if (!ds.tasks.some((t) => t.id === taskId)) throw new Error(`No task ${taskId}`);
  const pinNumbers = taskPinNumbers(ds, taskId);
  const written = new Map<string, ShotAssets>();
  const blobs: { path: string; base64: string }[] = [];

  for (const [index, shot] of taskShots(ds, taskId).entries()) {
    if (!shot.data_url) {
      written.set(shot.id, { image: null, markersDrawn: false, original: null });
      continue; // nothing stored to annotate
    }
    const asset = taskAssetName(shot.filename, index);
    const raw = shot.data_url.split(',')[1] ?? '';
    // Burn the TASK-global number into each marker, so marker "5" on the
    // second screenshot is the same pin 5 the markdown talks about.
    const pins = ds.annotation_pins
      .filter((p) => p.screenshot_id === shot.id)
      .sort(byCreatedAt)
      .map((p) => ({ ...p, n: pinNumbers.get(p.id) ?? 0 }));
    try {
      const annotated = await annotateScreenshot(shot.data_url, pins);
      blobs.push({ path: `assets/${asset}`, base64: annotated.dataUrl.split(',')[1] ?? '' });
      // The clean original travels too, for anyone who wants the unmarked view.
      blobs.push({ path: `assets/original-${asset}`, base64: raw });
      written.set(shot.id, { image: `assets/${asset}`, markersDrawn: true, original: `assets/original-${asset}` });
    } catch {
      // Annotation is an enhancement; never lose the evidence because of it.
      // The clean image is written once and every text file says so.
      blobs.push({ path: `assets/${asset}`, base64: raw });
      written.set(shot.id, { image: `assets/${asset}`, markersDrawn: false, original: null });
    }
  }

  const zip = new JSZip();
  const root = bundleFolderName(taskId);
  const at = { date: ZIP_FIXED_DATE, createFolders: false };
  zip.file(`${root}/`, null, { ...at, dir: true });
  zip.file(`${root}/TASK.md`, generateTaskExport(ds, taskId, { written }), at);
  zip.file(`${root}/HOW-TO-READ.md`, bundleReadme(ds, taskId, written), at);
  zip.file(`${root}/CONTEXT.json`, generateTaskContext(ds, taskId, { written }), at);
  if (blobs.length) {
    zip.file(`${root}/assets/`, null, { ...at, dir: true });
    for (const b of blobs) zip.file(`${root}/${b.path}`, b.base64, { ...at, base64: true });
  }
  return zip.generateAsync({ type: 'blob' });
}

/** Orientation for whoever opens the bundle — human or coding agent. */
export function bundleReadme(
  ds: Dataset,
  taskId: string,
  written: Map<string, ShotAssets> = plannedAssets(ds, taskId),
): string {
  const task = ds.tasks.find((t) => t.id === taskId);
  const all = [...written.values()];
  const marked = all.filter((a) => a.image && a.markersDrawn).length;
  const unmarked = all.filter((a) => a.image && !a.markersDrawn).length;
  const originals = all.filter((a) => a.original).length;

  const out: string[] = [
    `# ${taskId} — handoff bundle`,
    '',
    'Start with `TASK.md`. Everything in this folder describes that one ORRA task.',
    '',
    '## Contents',
    '',
    '- `TASK.md` — the brief: objective, code context, located change requests, decisions, acceptance criteria.',
    '- `CONTEXT.json` — the same task, screenshots, and globally numbered pins in a machine-readable hierarchy.',
  ];
  if (marked) {
    out.push(
      '- `assets/NN-*` — screenshots with **numbered markers drawn on them**. Marker 1 is Pin 1 in TASK.md, marker 2 is Pin 2, and so on. One sequence follows the order pins were added across the whole task; returning to an earlier screenshot continues the sequence rather than renumbering it.',
    );
  }
  if (unmarked) {
    out.push(
      '- Some screenshots are included without markers (they could not be drawn); TASK.md says which. Use the pin coordinates for those.',
    );
  }
  if (originals) out.push('- `assets/original-*` — the same screenshots without markers.');
  if (!marked && !unmarked) out.push('- No screenshot images are included: none were stored for this task.');
  out.push(
    '',
    '## How to read it',
    '',
    '1. Open `TASK.md`.',
    '2. For each pin, find the matching region in the screenshot — the numbered marker where one is drawn, otherwise the percentages, measured from the top-left.',
    '3. A pin may be tagged with the kind of change it wants, for example `[bug]`, `[copy]`, `[layout]`, `[styling]`, `[logic]`, `[question]`.',
    '4. Pins under "Resolved — do not act" are done. Leave them alone.',
    '5. Implement the acceptance criteria only. Do not expand scope.',
  );
  if (task) {
    out.push('', `Task type: ${taskTypes(task).join(', ') || '—'}. Status: ${task.status}.`);
  }
  out.push('');
  return out.join('\n');
}

/**
 * Deterministic machine-readable companion to TASK.md. Coding agents can
 * consume this without parsing prose, while humans keep the markdown view.
 * Additive to orra-task-context/v1: existing keys keep their meaning.
 */
export function generateTaskContext(
  ds: Dataset,
  taskId: string,
  options: { written?: Map<string, ShotAssets> } = {},
): string {
  const task = ds.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`No task ${taskId}`);
  const project = ds.projects.find((p) => p.id === task.project_id);
  const written = options.written ?? plannedAssets(ds, taskId);
  const numbers = taskPinNumbers(ds, taskId);
  const notes = linkedNotesOf(ds, taskId);
  const context = {
    schema: 'orra-task-context/v1',
    task: {
      id: task.id,
      title: task.title,
      objective: stripInlineImageMarkers(task.description),
      project: project?.name ?? null,
      /* Added beside `project`/`type` rather than replacing them: the schema
         is still orra-task-context/v1 and anything already reading the
         singular keys keeps working. The primary is element 0 of each. */
      projects: taskProjects(task).map((id) => ds.projects.find((p) => p.id === id)?.name ?? id),
      type: task.type,
      types: taskTypes(task),
      tags: [...task.tags],
      priority: task.priority,
      status: task.status,
      start_date: task.start_date,
      due_date: task.due_date,
      is_stuck: task.is_stuck,
      blocked_reason: task.blocked_reason,
      acceptance_criteria: criteriaOf(task),
      manual_criteria: criteriaOf(task).filter(isManualCriterion),
    },
    code: codeContextOf(ds, task),
    dependencies: dependenciesOf(ds, taskId),
    subtasks: ds.subtasks
      .filter((s) => s.task_id === taskId)
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((s) => ({ title: s.title, completed: s.completed })),
    screenshots: taskShots(ds, taskId).map((shot, index) => {
      const a = written.get(shot.id) ?? { image: null, markersDrawn: false, original: null };
      return {
        number: index + 1,
        filename: shot.filename,
        /** Exactly what the bundle holds: null for anything not written. */
        annotated_asset: a.markersDrawn ? a.image : null,
        original_asset: a.markersDrawn ? a.original : a.image,
        markers_drawn: a.markersDrawn,
        width: shot.width,
        height: shot.height,
        pins: ds.annotation_pins
          .filter((pin) => pin.screenshot_id === shot.id)
          .sort(byCreatedAt)
          .map((pin) => ({
            number: numbers.get(pin.id),
            label: pin.label || null,
            note: pin.note,
            x_pct: Number(one(pin.x_pct)),
            y_pct: Number(one(pin.y_pct)),
            resolved: pin.is_resolved,
            do_not_act: pin.is_resolved,
          })),
      };
    }),
    files: taskFilesOf(ds, taskId).map((f) => ({
      filename: f.filename,
      mime: f.mime,
      bytes: f.bytes,
      caption: f.caption,
      bundled: false,
    })),
    background: {
      notes: notes.map((n) => ({
        title: n.title,
        body: clip(stripInlineImageMarkers(n.body || '').trim(), EXPORT_CAPS.noteBody),
      })),
      mail: linkedMailOf(ds, taskId, notes).map((m) => ({ subject: m.subject, sender: m.sender, snippet: m.snippet })),
    },
  };
  return `${JSON.stringify(context, null, 2)}\n`;
}

/**
 * Derived pin numbering — one sequence per TASK, never stored.
 *
 * The sequence follows pin creation time across every screenshot in the task.
 * This detail matters when someone returns to screenshot 1 after annotating
 * screenshot 2: that new change is pin 7, not a new pin 4 inserted into the
 * middle of the series. A task therefore has exactly one current "pin 3" and
 * its handoff reads in the same order the requests were made.
 */
export function taskPinNumbers(ds: Dataset, taskId: string): Map<string, number> {
  const shotIds = new Set(
    ds.screenshot_attachments.filter((s) => s.task_id === taskId).map((s) => s.id),
  );
  const pins = ds.annotation_pins
    .filter((pin) => shotIds.has(pin.screenshot_id))
    .sort(byCreatedAt);
  const numbers = new Map<string, number>();
  pins.forEach((pin, index) => numbers.set(pin.id, index + 1));
  return numbers;
}

export function pinNumber(ds: Dataset, pinId: string): number {
  const pin = ds.annotation_pins.find((p) => p.id === pinId);
  if (!pin) return 0;
  const shot = ds.screenshot_attachments.find((s) => s.id === pin.screenshot_id);
  if (!shot) return 0;
  return taskPinNumbers(ds, shot.task_id).get(pinId) ?? 0;
}

/* ── HTML / Word export ───────────────────────────────────────────────── */

/** Escape for HTML text and attribute contexts. */
function esc(value: string): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Paragraphs from free text, blank-line separated, newlines kept as breaks. */
function paragraphs(text: string): string {
  const clean = stripInlineImageMarkers(text ?? '').trim();
  if (!clean) return '<p class="none">&mdash;</p>';
  return clean
    .split(/\n{2,}/)
    .map((block) => `<p>${esc(block).replace(/\n/g, '<br />')}</p>`)
    .join('\n');
}

/**
 * The same export as TASK.md, as a self-contained HTML document.
 *
 * Exists because "send me that task" usually means a person, not an agent.
 * Markdown is the right thing to hand a coding agent and the wrong thing to
 * hand an accountant, and the zip is neither: it is a folder you have to
 * unpack before you can read a word of it.
 *
 * Self-contained on purpose. Images are the data URLs already on the rows, so
 * the file opens with its screenshots intact straight from an email
 * attachment, with no assets folder and nothing to fetch. That also makes this
 * the single thing the Word export and the print-to-PDF path both render,
 * rather than three generators drifting apart.
 *
 * Pure, like `generateTaskExport` (principle 5): same task state gives
 * byte-identical output. Nothing here reads a clock, and every list uses the
 * comparators the markdown already uses.
 *
 * `forWord` swaps the root element for the namespaced one Word expects and
 * adds Word's head markers. The body is identical, so the two can never disagree about content.
 */
export function generateTaskHtml(
  ds: Dataset,
  taskId: string,
  options: { forWord?: boolean } = {},
): string {
  const task = ds.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`No task ${taskId}`);
  const profiles = new Map(ds.profiles.map((p) => [p.id, p.name]));
  const projectNames = taskProjects(task)
    .map((id) => ds.projects.find((p) => p.id === id)?.name ?? id)
    .join(', ');
  const assigneeNames = taskAssignees(task)
    .map((id) => profiles.get(id) ?? id)
    .join(', ');

  const out: string[] = [];
  out.push(`<h1>${esc(task.id)} &middot; ${esc(task.title)}</h1>`);
  out.push(
    `<p class="meta">Project: ${esc(projectNames || '-')} &middot; Priority: ${esc(task.priority)} &middot; Status: ${esc(task.status)}<br />` +
      `Assignee: ${esc(assigneeNames || '-')} &middot; Due: ${esc(task.due_date ?? '-')} &middot; Type: ${esc(taskTypes(task).join(', ') || '-')}</p>`,
  );

  out.push('<h2>Objective</h2>');
  out.push(paragraphs(task.description));

  const shots = ds.screenshot_attachments.filter((s) => s.task_id === task.id).sort(byCreatedAt);
  const pinNumbers = taskPinNumbers(ds, task.id);
  shots.forEach((shot, si) => {
    out.push(`<h2>Screenshot ${si + 1} &mdash; ${esc(shot.filename)} (${shot.width}&times;${shot.height})</h2>`);
    if (shot.data_url) {
      out.push(`<img class="shot" src="${esc(shot.data_url)}" alt="${esc(shot.filename)}" />`);
    } else {
      out.push('<p class="warn">No image data stored for this screenshot &mdash; the pin coordinates below still locate each change.</p>');
    }
    const pins = ds.annotation_pins.filter((p) => p.screenshot_id === shot.id).sort(byCreatedAt);
    if (pins.length) {
      out.push('<ol class="pins">');
      for (const pin of pins) {
        const label = pin.label ? `<b>[${esc(pin.label)}]</b> ` : '';
        const state = pin.is_resolved ? ' <em>(resolved)</em>' : '';
        out.push(
          `<li value="${pinNumbers.get(pin.id)}">(x ${one(pin.x_pct)}%, y ${one(pin.y_pct)}%) ${esc(profiles.get(pin.author_id) ?? '-')} &mdash; ${label}${esc(pin.note)}${state}</li>`,
        );
      }
      out.push('</ol>');
    }
  });

  out.push('<h2>Decisions</h2>');
  const decisions = ds.comments.filter((c) => c.task_id === task.id && c.is_decision).sort(byCreatedAt);
  if (decisions.length) {
    out.push('<ul>');
    for (const d of decisions) {
      out.push(`<li>${esc(profiles.get(d.author_id) ?? '-')} (${iso8601Utc(d.created_at)}): ${esc(d.body)}</li>`);
    }
    out.push('</ul>');
  } else {
    out.push('<p class="none">none recorded</p>');
  }

  out.push('<h2>Background</h2>');
  const background: string[] = [];
  const notes = linkedNotesOf(ds, task.id);
  for (const n of notes) {
    const who = profiles.get(n.created_by);
    // The whole note up to the cap, as the markdown carries it — a first line
    // alone was usually just the note's own heading.
    const body = clip(stripInlineImageMarkers(n.body || '').trim(), EXPORT_CAPS.noteBody);
    background.push(
      `Note &ldquo;${esc(n.title)}&rdquo;${who ? ` (${esc(who)})` : ''}: ${esc(body || '-').replace(/\n/g, '<br />')}`,
    );
  }
  for (const m of linkedMailOf(ds, task.id, notes)) {
    background.push(`Mail &ldquo;${esc(m.subject)}&rdquo;: ${esc(m.snippet)}`);
  }
  for (const c of ds.ledger
    .filter((l) => l.linked_task_id === task.id)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    background.push(`Cost: ${esc(c.party)}, INR ${c.amount}, ${esc(c.status)}`);
  }
  out.push(
    background.length
      ? `<ul>${background.map((row) => `<li>${row}</li>`).join('')}</ul>`
      : '<p class="none">none linked</p>',
  );

  out.push('<h2>Acceptance criteria</h2>');
  const criteria = task.acceptance_criteria
    .split('\n')
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter(Boolean);
  if (!criteria.length) {
    out.push('<p class="warn">No acceptance criteria set &mdash; falling back to open subtasks.</p>');
  }
  const rows = criteria.length
    ? criteria
    : ds.subtasks
        .filter((s) => s.task_id === task.id && !s.completed)
        .sort((a, b) => a.position - b.position)
        .map((s) => s.title);
  out.push(
    rows.length
      ? `<ul class="checks">${rows.map((r) => `<li>&#9744; ${esc(r)}</li>`).join('')}</ul>`
      : '<p class="none">&mdash;</p>',
  );

  const root = options.forWord
    ? '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">'
    : '<html lang="en">';

  /* Deliberately plain and dark-on-white: this is read on paper, in Word, or
     in somebody else's inbox, none of which inherit the portal's theme. */
  return [
    '<!DOCTYPE html>',
    root,
    '<head>',
    '<meta charset="utf-8" />',
    /* Word-HTML markers: ProgId tells Word this .doc is its own HTML flavour
       and the WordDocument block opens it in Print layout, not Web layout.
       Head-only, so the body stays identical to the plain HTML. */
    ...(options.forWord
      ? [
          '<meta name="ProgId" content="Word.Document" />',
          '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->',
        ]
      : []),
    `<title>${esc(task.id)} ${esc(task.title)}</title>`,
    '<style>',
    "body { font-family: Georgia, 'Times New Roman', serif; color: #111; background: #fff; max-width: 760px; margin: 32px auto; padding: 0 20px; line-height: 1.55; }",
    'h1 { font-size: 22px; margin: 0 0 4px; }',
    'h2 { font-size: 15px; margin: 26px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; text-transform: uppercase; letter-spacing: 0.06em; }',
    'p { margin: 0 0 10px; }',
    '.meta { font-size: 13px; color: #555; margin-bottom: 18px; }',
    '.none { color: #777; font-style: italic; }',
    '.warn { color: #8a5a00; }',
    'img.shot { max-width: 100%; border: 1px solid #ccc; border-radius: 4px; }',
    'ol.pins { padding-left: 22px; }',
    'ol.pins li { margin: 4px 0; }',
    'ul.checks { list-style: none; padding-left: 0; }',
    'ul.checks li { margin: 4px 0; }',
    '@media print { body { margin: 0; max-width: none; } h2 { page-break-after: avoid; } img.shot { page-break-inside: avoid; } }',
    '</style>',
    '</head>',
    '<body>',
    out.join('\n'),
    '</body>',
    '</html>',
  ].join('\n');
}

export type { Task };
