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


/** One bucket of the in/out chart. `start` is the first day of the period, as
 *  YYYY-MM-DD. It was called `week` back when the chart was six weeks wide;
 *  the chart has grouped by month for a while and the name had not caught up. */
export interface PeriodBucket {
  start: string;
  in: number;
  out: number;
}

/** Every row in the selected range, grouped by calendar month. Unlike the old
 * "last six weeks" chart this never contradicts an All time/custom filter by
 * quietly dropping older entries. */
export function monthlyInOut(ledger: LedgerEntry[]): PeriodBucket[] {
  const buckets = new Map<string, PeriodBucket>();
  for (const row of ledger) {
    const key = `${row.date.slice(0, 7)}-01`;
    const bucket = buckets.get(key) ?? { start: key, in: 0, out: 0 };
    if (row.direction === 'in') bucket.in += row.amount;
    else bucket.out += row.amount;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export interface CategoryTotal {
  category: string;
  total: number;
}

export interface AttentionBucket {
  count: number;
  total: number;
}
export interface AttentionSummary {
  due: AttentionBucket;
  overdue: AttentionBucket;
}

/** Counts + totals of ledger rows that need a look — the "what matters" strip. */
export function attentionSummary(ledger: LedgerEntry[]): AttentionSummary {
  const due: AttentionBucket = { count: 0, total: 0 };
  const overdue: AttentionBucket = { count: 0, total: 0 };
  for (const row of ledger) {
    if (row.direction !== 'out') continue;
    if (row.status === 'due') {
      due.count += 1;
      due.total += row.amount;
    } else if (row.status === 'overdue') {
      overdue.count += 1;
      overdue.total += row.amount;
    }
  }
  return { due, overdue };
}

export interface ProjectSpend {
  project_id: string;
  total: number;
}

/** Out-only spend grouped by project — the four-way split for MiniBars small multiples. */
export function projectSpend(ledger: LedgerEntry[]): ProjectSpend[] {
  const map = new Map<string, number>();
  for (const row of ledger) {
    if (row.direction !== 'out') continue;
    map.set(row.project_id, (map.get(row.project_id) ?? 0) + row.amount);
  }
  return [...map.entries()]
    .map(([project_id, total]) => ({ project_id, total }))
    .sort((a, b) => b.total - a.total);
}

export interface NetPoint {
  date: string;
  net: number;
}

/** Running (cumulative) net across every date that has ledger activity, oldest first. */
export function cumulativeNet(ledger: LedgerEntry[]): NetPoint[] {
  const byDate = new Map<string, number>();
  for (const row of ledger) {
    const delta = row.direction === 'in' ? row.amount : -row.amount;
    byDate.set(row.date, (byDate.get(row.date) ?? 0) + delta);
  }
  const dates = [...byDate.keys()].sort();
  let running = 0;
  return dates.map((date) => {
    running += byDate.get(date)!;
    return { date, net: running };
  });
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

export function exportLedgerCsv(filename: string, ds: Dataset, rows: LedgerEntry[]) {
  const headers = [
    'Date',
    'Party',
    'Category',
    'Project',
    'Flow',
    'Amount',
    'Status',
    'Payer allocations',
    'Comments',
    'Renewal or end date',
  ];
  const body = rows.map((r) => [
    r.date,
    r.party,
    r.category,
    projName(ds, r.project_id),
    r.direction === 'in' ? 'Business contribution' : 'Business expense',
    r.amount,
    r.status,
    (r.payer_allocations?.length
      ? r.payer_allocations
      : r.paid_by
        ? [{ user_id: r.paid_by, amount: r.amount }]
        : []
    )
      .map((allocation) => {
        const name = ds.profiles.find((profile) => profile.id === allocation.user_id)?.name ?? allocation.user_id;
        return `${name}: ${allocation.amount}`;
      })
      .join(' | '),
    r.comments ?? '',
    r.ends_on ?? '',
  ]);
  downloadBlob(filename, toCsv(headers, body), 'text/csv;charset=utf-8;');
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
  const businessProjects = ds.projects.filter((project) => !project.is_personal);
  const fallback = businessProjects[0]?.id ?? '';
  if (!raw) return fallback;
  const needle = raw.trim().toLowerCase();
  const match = businessProjects.find(
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
