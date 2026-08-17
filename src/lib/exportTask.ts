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
  shots.forEach((shot, si) => {
    const n = si + 1;
    lines.push('');
    lines.push(`## Screenshot ${n} — ${shot.filename} (${shot.width}×${shot.height})`);
    lines.push(`![screenshot-${n}](assets/${shot.filename})`);
    lines.push('Pins:');
    const pins = ds.annotation_pins
      .filter((p) => p.screenshot_id === shot.id)
      .sort(byCreatedAt);
    pins.forEach((pin, pi) => {
      lines.push(
        `${pi + 1}. (x ${one(pin.x_pct)}%, y ${one(pin.y_pct)}%) ${profiles.get(pin.author_id) ?? '—'} — ${pin.note}`,
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
    lines.push(`- Note "${n.title}": ${(n.body || '').split('\n')[0]}`);
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

/** Bundle TASK.md + assets/ into a zip for download. Lazy-loads jszip. */
export async function exportTaskZip(ds: Dataset, taskId: string): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file('TASK.md', generateTaskExport(ds, taskId));
  const assets = zip.folder('assets');
  const shots = ds.screenshot_attachments
    .filter((s) => s.task_id === taskId)
    .sort(byCreatedAt);
  for (const shot of shots) {
    if (shot.data_url) {
      const b64 = shot.data_url.split(',')[1];
      assets?.file(shot.filename, b64, { base64: true });
    }
  }
  return zip.generateAsync({ type: 'blob' });
}

/** Derived pin numbering — row_number() over created_at, never stored. */
export function pinNumber(ds: Dataset, pinId: string): number {
  const pin = ds.annotation_pins.find((p) => p.id === pinId);
  if (!pin) return 0;
  const siblings = ds.annotation_pins
    .filter((p) => p.screenshot_id === pin.screenshot_id)
    .sort(byCreatedAt);
  return siblings.findIndex((p) => p.id === pinId) + 1;
}

export type { Task };
