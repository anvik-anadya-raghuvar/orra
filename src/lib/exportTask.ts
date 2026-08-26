import type { Dataset, Task } from '../types';
import { stripInlineImageMarkers } from '../ui/inlineImages';
import { taskAssignees, taskProjects, taskTypes } from './taskFacets';

/**
 * Coding-agent export generator — a PURE FUNCTION (principle 4). No LLM, no clock,
 * no randomness: identical task state → byte-identical output. Format is
 * IMPLEMENTATION-PLAN-v2.md §5, implemented exactly.
 */

const byCreatedAt = <T extends { created_at: string; id: string }>(a: T, b: T) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

const iso8601Utc = (ts: string) => new Date(ts).toISOString().replace(/\.\d{3}Z$/, 'Z');

const one = (n: number) => n.toFixed(1);

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

export function generateTaskExport(ds: Dataset, taskId: string): string {
  const task = ds.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`No task ${taskId}`);
  const profiles = new Map(ds.profiles.map((p) => [p.id, p.name]));
  /* Every project and every person, primary first, joined in the order the
     task carries them. Still a pure function of the row (principle 5): the
     lists are read, never sorted or de-duplicated differently per call. */
  const projectNames = taskProjects(task)
    .map((id) => ds.projects.find((p) => p.id === id)?.name ?? id)
    .join(', ');
  const assigneeNames = taskAssignees(task)
    .map((id) => profiles.get(id) ?? id)
    .join(', ');

  const lines: string[] = [];
  lines.push(`# ${task.id} · ${task.title}`);
  lines.push(
    `Project: ${projectNames || '—'} · Priority: ${task.priority} · Status: ${task.status}`,
  );
  lines.push(`Assignee: ${assigneeNames || '—'} · Due: ${task.due_date ?? '—'}`);
  lines.push('');
  lines.push('## Objective');
  lines.push(stripInlineImageMarkers(task.description) || '—');

  const shots = ds.screenshot_attachments
    .filter((s) => s.task_id === task.id)
    .sort(byCreatedAt);
  const pinNumbers = taskPinNumbers(ds, task.id);
  shots.forEach((shot, si) => {
    const n = si + 1;
    const asset = taskAssetName(shot.filename, si);
    lines.push('');
    lines.push(`## Screenshot ${n} — ${shot.filename} (${shot.width}×${shot.height})`);
    if (shot.data_url) {
      lines.push(`![screenshot-${n}](assets/${asset})`);
      lines.push(
        '_Numbered markers are drawn on this image; each matches a pin below._',
      );
    } else {
      // Better an explicit note than a broken image link to a file the zip
      // could never contain.
      lines.push(
        `> No image data stored for this screenshot — the pin coordinates below still locate each change.`,
      );
    }
    lines.push('Pins:');
    const pins = ds.annotation_pins
      .filter((p) => p.screenshot_id === shot.id)
      .sort(byCreatedAt);
    pins.forEach((pin) => {
      // The label goes in front of the note so an agent reading this can tell
      // a copy tweak from a logic bug without inferring it from prose. Omitted
      // entirely when unset, so output stays stable for uncategorised pins.
      const label = pin.label ? `[${pin.label}] ` : '';
      const state = pin.is_resolved ? ' (resolved)' : '';
      // Task-global number: screenshot 2's first pin continues the sequence.
      lines.push(
        `${pinNumbers.get(pin.id)}. (x ${one(pin.x_pct)}%, y ${one(pin.y_pct)}%) ${profiles.get(pin.author_id) ?? '—'} — ${label}${pin.note}${state}`,
      );
    });
  });

  const decisions = ds.comments
    .filter((c) => c.task_id === task.id && c.is_decision)
    .sort(byCreatedAt);
  lines.push('');
  lines.push('## Decisions');
  if (decisions.length) {
    for (const d of decisions) {
      lines.push(`- ${profiles.get(d.author_id) ?? '—'} (${iso8601Utc(d.created_at)}): ${d.body}`);
    }
  } else {
    lines.push('- none recorded');
  }

  lines.push('');
  lines.push('## Background');
  const linkedNotes = ds.notes
    .filter((n) => n.task_id === task.id)
    .sort(byCreatedAt);
  for (const n of linkedNotes) {
    // Attribute the note: either of them can add context to a task, and who
    // said it changes how a reader weighs it.
    const who = profiles.get(n.created_by);
    lines.push(
      `- Note "${n.title}"${who ? ` (${who})` : ''}: ${stripInlineImageMarkers(n.body || '').split('\n')[0]}`,
    );
  }
  const linkedMail = ds.mail_items
    .filter((m) => m.converted_to_id === task.id || (m.project_id === task.project_id && m.flag_reason))
    .sort((a, b) => a.received_at.localeCompare(b.received_at));
  for (const m of linkedMail) {
    lines.push(`- Mail "${m.subject}": ${m.snippet}`);
  }
  const costs = ds.ledger
    .filter((l) => l.linked_task_id === task.id)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const c of costs) {
    lines.push(`- Cost: ${c.party}, INR ${c.amount}, ${c.status}`);
  }
  if (!linkedNotes.length && !linkedMail.length && !costs.length) lines.push('- none linked');

  lines.push('');
  lines.push('## Acceptance criteria');
  const criteria = task.acceptance_criteria
    .split('\n')
    .map((l) => l.replace(/^-\s*/, '').trim())
    .filter(Boolean);
  if (criteria.length) {
    for (const c of criteria) lines.push(`- [ ] ${c}`);
  } else {
    const openSubs = ds.subtasks
      .filter((s) => s.task_id === task.id && !s.completed)
      .sort((a, b) => a.position - b.position);
    lines.push('> Warning: no acceptance criteria set — falling back to open subtasks.');
    for (const s of openSubs) lines.push(`- [ ] ${s.title}`);
  }

  lines.push('');
  lines.push('## Agent instructions');
  lines.push(
    'Each pin is a located change request: its coordinates identify the exact region in the',
  );
  lines.push(
    'screenshot above. Implement the acceptance criteria only — do not expand scope. Report',
  );
  lines.push('a diff summary mapped to each criterion.');
  lines.push('');
  return lines.join('\n');
}

/**
 * Bundle TASK.md + assets/ into a zip. Lazy-loads jszip.
 *
 * Screenshots are written with their pin markers BURNED IN, numbered to match
 * the list in TASK.md. Shipping the raw image plus a list of percentages would
 * make the reader compute where "x 32.4%" lands and hope they picked the right
 * element; a marker drawn at that point removes the guess entirely.
 */
export async function exportTaskZip(ds: Dataset, taskId: string): Promise<Blob> {
  const [{ default: JSZip }, { annotateScreenshot }] = await Promise.all([
    import('jszip'),
    import('./annotateImage'),
  ]);
  const zip = new JSZip();
  zip.file('TASK.md', generateTaskExport(ds, taskId));
  zip.file('README.md', bundleReadme(ds, taskId));
  zip.file('CONTEXT.json', generateTaskContext(ds, taskId));

  const assets = zip.folder('assets');
  const shots = ds.screenshot_attachments.filter((s) => s.task_id === taskId).sort(byCreatedAt);
  const pinNumbers = taskPinNumbers(ds, taskId);

  for (const [index, shot] of shots.entries()) {
    if (!shot.data_url) continue; // nothing stored to annotate
    const asset = taskAssetName(shot.filename, index);
    // Burn the TASK-global number into each marker, so marker "5" on the
    // second screenshot is the same pin 5 the markdown talks about.
    const pins = ds.annotation_pins
      .filter((p) => p.screenshot_id === shot.id)
      .sort(byCreatedAt)
      .map((p) => ({ ...p, n: pinNumbers.get(p.id) ?? 0 }));
    try {
      const annotated = await annotateScreenshot(shot.data_url, pins);
      assets?.file(asset, annotated.dataUrl.split(',')[1], { base64: true });
      // The clean original travels too, for anyone who wants the unmarked view.
      assets?.file(`original-${asset}`, shot.data_url.split(',')[1], { base64: true });
    } catch {
      // Annotation is an enhancement; never lose the evidence because of it.
      assets?.file(asset, shot.data_url.split(',')[1], { base64: true });
    }
  }
  return zip.generateAsync({ type: 'blob' });
}

/** Orientation for whoever opens the bundle — human or coding agent. */
function bundleReadme(ds: Dataset, taskId: string): string {
  const task = ds.tasks.find((t) => t.id === taskId);
  const shots = ds.screenshot_attachments.filter((s) => s.task_id === taskId);
  const withImages = shots.filter((s) => s.data_url).length;
  return [
    `# ${taskId} — handoff bundle`,
    '',
    'Contents:',
    '- `TASK.md` — the brief: objective, located change requests, decisions, acceptance criteria.',
    '- `CONTEXT.json` — the same task, screenshots, and globally numbered pins in a machine-readable hierarchy.',
    withImages
      ? '- `assets/*` — screenshots with **numbered markers drawn on them**. Marker ① is pin 1 in TASK.md, ② is pin 2, and so on. One sequence follows the order pins were added across the whole task; returning to an earlier screenshot continues the sequence rather than renumbering it.'
      : '- `assets/` — empty: no screenshot image data was stored for this task.',
    withImages ? '- `assets/original-*` — the same screenshots without markers.' : '',
    '',
    'How to read it:',
    '1. Open `TASK.md`.',
    '2. For each pin, look at the matching numbered marker in the screenshot — that is the exact region being talked about. Percentages are given too, measured from the top-left.',
    '3. A pin is tagged with the kind of change it wants: `[bug]`, `[copy]`, `[layout]`, `[styling]`, `[logic]`, `[question]`.',
    '4. Implement the acceptance criteria only. Do not expand scope.',
    '',
    task ? `Task type: ${task.type}. Status: ${task.status}.` : '',
    '',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

/**
 * Deterministic machine-readable companion to TASK.md. Coding agents can
 * consume this without parsing prose, while humans keep the markdown view.
 */
export function generateTaskContext(ds: Dataset, taskId: string): string {
  const task = ds.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`No task ${taskId}`);
  const project = ds.projects.find((p) => p.id === task.project_id);
  const shots = ds.screenshot_attachments
    .filter((s) => s.task_id === taskId)
    .sort(byCreatedAt);
  const numbers = taskPinNumbers(ds, taskId);
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
      priority: task.priority,
      status: task.status,
      due_date: task.due_date,
      acceptance_criteria: task.acceptance_criteria
        .split('\n')
        .map((line) => line.replace(/^-\s*/, '').trim())
        .filter(Boolean),
    },
    screenshots: shots.map((shot, index) => ({
      number: index + 1,
      filename: shot.filename,
      annotated_asset: shot.data_url ? `assets/${taskAssetName(shot.filename, index)}` : null,
      original_asset: shot.data_url ? `assets/original-${taskAssetName(shot.filename, index)}` : null,
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
        })),
    })),
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
 * `forWord` swaps only the root element for the namespaced one Word expects.
 * The body is identical, so the two can never disagree about content.
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
  for (const n of ds.notes.filter((note) => note.task_id === task.id).sort(byCreatedAt)) {
    const who = profiles.get(n.created_by);
    background.push(
      `Note &ldquo;${esc(n.title)}&rdquo;${who ? ` (${esc(who)})` : ''}: ${esc(stripInlineImageMarkers(n.body || '').split('\n')[0])}`,
    );
  }
  for (const m of ds.mail_items
    .filter((mail) => mail.converted_to_id === task.id || (mail.project_id === task.project_id && mail.flag_reason))
    .sort((a, b) => a.received_at.localeCompare(b.received_at))) {
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
