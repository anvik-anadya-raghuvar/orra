import type { Dataset, Task } from '../types';

/**
 * Claude-export generator — a PURE FUNCTION (principle 4). No LLM, no clock,
 * no randomness: identical task state → byte-identical output. Format is
 * IMPLEMENTATION-PLAN-v2.md §5, implemented exactly.
 */

const byCreatedAt = <T extends { created_at: string }>(a: T, b: T) =>
  a.created_at.localeCompare(b.created_at) || (a as unknown as { id: string }).id.localeCompare((b as unknown as { id: string }).id);

const iso8601Utc = (ts: string) => new Date(ts).toISOString().replace(/\.\d{3}Z$/, 'Z');

const one = (n: number) => n.toFixed(1);

export function generateTaskExport(ds: Dataset, taskId: string): string {
  const task = ds.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`No task ${taskId}`);
  const project = ds.projects.find((p) => p.id === task.project_id);
  const assignee = ds.profiles.find((p) => p.id === task.assignee_id);
  const profiles = new Map(ds.profiles.map((p) => [p.id, p.name]));

  const lines: string[] = [];
  lines.push(`# ${task.id} · ${task.title}`);
  lines.push(
    `Project: ${project?.name ?? '—'} · Priority: ${task.priority} · Status: ${task.status}`,
  );
  lines.push(`Assignee: ${assignee?.name ?? '—'} · Due: ${task.due_date ?? '—'}`);
  lines.push('');
  lines.push('## Objective');
  lines.push(task.description || '—');

  const shots = ds.screenshot_attachments
    .filter((s) => s.task_id === task.id)
    .sort(byCreatedAt);
  const pinNumbers = taskPinNumbers(ds, task.id);
  shots.forEach((shot, si) => {
    const n = si + 1;
    lines.push('');
    lines.push(`## Screenshot ${n} — ${shot.filename} (${shot.width}×${shot.height})`);
    if (shot.data_url) {
      lines.push(`![screenshot-${n}](assets/${shot.filename})`);
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
      `- Note "${n.title}"${who ? ` (${who})` : ''}: ${(n.body || '').split('\n')[0]}`,
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

  const assets = zip.folder('assets');
  const shots = ds.screenshot_attachments.filter((s) => s.task_id === taskId).sort(byCreatedAt);
  const pinNumbers = taskPinNumbers(ds, taskId);

  for (const shot of shots) {
    if (!shot.data_url) continue; // nothing stored to annotate
    // Burn the TASK-global number into each marker, so marker "5" on the
    // second screenshot is the same pin 5 the markdown talks about.
    const pins = ds.annotation_pins
      .filter((p) => p.screenshot_id === shot.id)
      .sort(byCreatedAt)
      .map((p) => ({ ...p, n: pinNumbers.get(p.id) ?? 0 }));
    try {
      const annotated = await annotateScreenshot(shot.data_url, pins);
      assets?.file(shot.filename, annotated.dataUrl.split(',')[1], { base64: true });
      // The clean original travels too, for anyone who wants the unmarked view.
      assets?.file(`original-${shot.filename}`, shot.data_url.split(',')[1], { base64: true });
    } catch {
      // Annotation is an enhancement; never lose the evidence because of it.
      assets?.file(shot.filename, shot.data_url.split(',')[1], { base64: true });
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
    withImages
      ? '- `assets/*.png` — screenshots with **numbered markers drawn on them**. Marker ① is pin 1 in TASK.md, ② is pin 2, and so on. One sequence runs across the whole task: a second screenshot continues the numbering rather than restarting at 1.'
      : '- `assets/` — empty: no screenshot image data was stored for this task.',
    withImages ? '- `assets/original-*.png` — the same screenshots without markers.' : '',
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
 * Derived pin numbering — one sequence per TASK, never stored.
 *
 * The sequence runs across every screenshot in the task in upload order, so
 * the first pin on a second screenshot continues the count (5, 6, …) rather
 * than restarting at 1. A task therefore has exactly one "pin 3", and saying
 * "tag 3 is this change" is unambiguous no matter which image it sits on.
 * row_number() over (screenshot age, pin age) — deleting a pin closes the gap.
 */
export function taskPinNumbers(ds: Dataset, taskId: string): Map<string, number> {
  const shots = ds.screenshot_attachments
    .filter((s) => s.task_id === taskId)
    .sort(byCreatedAt);
  const numbers = new Map<string, number>();
  let n = 0;
  for (const shot of shots) {
    const pins = ds.annotation_pins
      .filter((p) => p.screenshot_id === shot.id)
      .sort(byCreatedAt);
    for (const pin of pins) numbers.set(pin.id, ++n);
  }
  return numbers;
}

export function pinNumber(ds: Dataset, pinId: string): number {
  const pin = ds.annotation_pins.find((p) => p.id === pinId);
  if (!pin) return 0;
  const shot = ds.screenshot_attachments.find((s) => s.id === pin.screenshot_id);
  if (!shot) return 0;
  return taskPinNumbers(ds, shot.task_id).get(pinId) ?? 0;
}

export type { Task };
