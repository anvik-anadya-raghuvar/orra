import type { Dataset, LedgerEntry } from '../../types';

/* ── shared vocabulary for the Money screen ───────────────────────────── */

export const projName = (ds: Dataset, id: string) => ds.projects.find((p) => p.id === id)?.name ?? id;
export const projColor = (ds: Dataset, id: string) =>
  ds.projects.find((p) => p.id === id)?.color ?? 'var(--slate)';

/** LedgerEntry.status is 'overdue' but the shared .pill CSS class is `.over`. */
export const pillClass = (status: LedgerEntry['status']) => (status === 'overdue' ? 'over' : status);
export const NEXT_STATUS: Record<LedgerEntry['status'], LedgerEntry['status']> = {
  paid: 'due',
  due: 'overdue',
  overdue: 'paid',
};

/** Monday (local) of the ISO-ish week containing this YYYY-MM-DD date. */
export function weekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}

export interface WeekBucket {
  week: string;
  in: number;
  out: number;
}

/** Buckets the ledger into the last `weeks` calendar weeks (Mon–Sun), oldest first. */
export function weeklyInOut(ledger: LedgerEntry[], weeks = 6): WeekBucket[] {
  const thisWeek = weekStart(new Date().toISOString().slice(0, 10));
  const keys: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(thisWeek + 'T00:00:00');
    d.setDate(d.getDate() - i * 7);
    keys.push(d.toISOString().slice(0, 10));
  }
  const buckets = new Map<string, WeekBucket>(keys.map((k) => [k, { week: k, in: 0, out: 0 }]));
  for (const row of ledger) {
    const b = buckets.get(weekStart(row.date));
    if (!b) continue;
    if (row.direction === 'in') b.in += row.amount;
    else b.out += row.amount;
  }
  return keys.map((k) => buckets.get(k)!);
}

export interface CategoryTotal {
  category: string;
  total: number;
}

/** Out-only spend grouped by category, descending. */
export function categoryBreakdown(ledger: LedgerEntry[]): CategoryTotal[] {
  const map = new Map<string, number>();
  for (const row of ledger) {
    if (row.direction !== 'out') continue;
    map.set(row.category, (map.get(row.category) ?? 0) + row.amount);
  }
  return [...map.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

/* ── CSV / XLSX export (lazy — xlsx is only imported when actually used) ─ */

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

export function exportLedgerCsv(filename: string, ds: Dataset, rows: LedgerEntry[]) {
  const headers = ['Date', 'Party', 'Category', 'Project', 'Direction', 'Amount', 'Status'];
  const body = rows.map((r) => [
    r.date,
    r.party,
    r.category,
    projName(ds, r.project_id),
    r.direction,
    r.amount,
    r.status,
  ]);
  downloadBlob(filename, toCsv(headers, body), 'text/csv;charset=utf-8;');
}

export async function exportLedgerXlsx(filename: string, ds: Dataset, rows: LedgerEntry[]) {
  const XLSX = await import('xlsx');
  const sheetRows = rows.map((r) => ({
    Date: r.date,
    Party: r.party,
    Category: r.category,
    Project: projName(ds, r.project_id),
    Direction: r.direction,
    Amount: r.amount,
    Status: r.status,
  }));
  const ws = XLSX.utils.json_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ledger');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  downloadBlob(filename, buf, 'application/octet-stream');
}

/* ── import parsing shared between the import modal steps ────────────── */

export type ImportField = 'date' | 'party' | 'category' | 'amount' | 'status' | 'project' | 'direction';
export const IMPORT_FIELDS: { key: ImportField; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'party', label: 'Party', required: true },
  { key: 'amount', label: 'Amount', required: true },
  { key: 'category', label: 'Category' },
  { key: 'project', label: 'Project' },
  { key: 'direction', label: 'Direction' },
  { key: 'status', label: 'Status' },
];

const SYNONYMS: Record<ImportField, string[]> = {
  date: ['date'],
  party: ['party', 'vendor', 'payee', 'client', 'customer', 'name'],
  category: ['category', 'type', 'desc'],
  amount: ['amount', 'amt', 'value', 'total'],
  status: ['status'],
  project: ['project'],
  direction: ['direction', 'flow', 'in/out', 'dr/cr'],
};

export type ColumnMapping = Record<ImportField, string>;

export function autoMapHeaders(headers: string[]): ColumnMapping {
  const lower = headers.map((h) => h.toLowerCase());
  const out = {} as ColumnMapping;
  for (const field of IMPORT_FIELDS.map((f) => f.key)) {
    const syns = SYNONYMS[field];
    const idx = lower.findIndex((h) => syns.some((s) => h.includes(s)));
    out[field] = idx >= 0 ? headers[idx] : '';
  }
  return out;
}

export type ParsedRow = Record<string, string>;

/** Parse a raw cell string into a YYYY-MM-DD date, falling back to today. */
export function parseImportDate(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

export function parseImportStatus(raw: string | undefined): LedgerEntry['status'] {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('over')) return 'overdue';
  if (s.includes('due')) return 'due';
  return 'paid';
}

export function parseImportDirection(raw: string | undefined, amount: number): LedgerEntry['direction'] {
  if (raw) {
    const s = raw.toLowerCase();
    if (s.includes('in') || s.includes('credit') || s.includes('cr')) return 'in';
    if (s.includes('out') || s.includes('debit') || s.includes('dr')) return 'out';
  }
  return amount < 0 ? 'out' : 'in';
}

export function resolveProjectId(ds: Dataset, raw: string | undefined): string {
  const fallback = ds.projects[0]?.id ?? '';
  if (!raw) return fallback;
  const needle = raw.trim().toLowerCase();
  const match = ds.projects.find(
    (p) => p.id.toLowerCase() === needle || p.name.toLowerCase() === needle,
  );
  return match?.id ?? fallback;
}

/** date + party (case-insensitive, trimmed) + amount identifies a duplicate. */
export function isDuplicate(ds: Dataset, date: string, party: string, amount: number): boolean {
  const p = party.trim().toLowerCase();
  return ds.ledger.some(
    (r) => r.date === date && r.party.trim().toLowerCase() === p && r.amount === amount,
  );
}
