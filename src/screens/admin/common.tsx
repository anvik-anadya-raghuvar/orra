import type { AuditEntry, Dataset } from '../../types';

/* ── CSV export ──────────────────────────────────────────────────────── */

function csvEscape(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
}

export function downloadBlob(filename: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function auditChangeText(e: AuditEntry): string {
  if (e.field_name) return `${e.field_name}: ${e.old_value ?? ''} → ${e.new_value ?? ''}`;
  return e.new_value ?? e.old_value ?? '';
}

export function exportAuditCsv(filename: string, rows: AuditEntry[]) {
  const headers = ['When', 'Actor', 'Entity type', 'Entity id', 'Change', 'Source'];
  const body = rows.map((e) => [e.occurred_at, e.actor_label, e.entity_type, e.entity_id, auditChangeText(e), e.source]);
  downloadBlob(filename, toCsv(headers, body), 'text/csv;charset=utf-8;');
}

/* ── tags ─────────────────────────────────────────────────────────────── */

export const TAG_COLORS = ['indigo', 'teal', 'stamp', 'rose', 'sky', 'violet', 'slate'] as const;

/** How many tasks + notes currently carry this tag name. */
export function tagUsageCounts(ds: Dataset): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of ds.tasks) for (const name of t.tags) counts[name] = (counts[name] ?? 0) + 1;
  for (const n of ds.notes) for (const name of n.tags) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
}
