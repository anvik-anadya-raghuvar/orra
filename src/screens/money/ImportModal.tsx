import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import type { LedgerEntry } from '../../types';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { InfoTip, SideSheet, useToast } from '../../ui/bits';
import { staggerItem, staggerList, staggerParent } from '../../ui/motion';
import { inr } from '../../lib/dates';
import {
  ColumnMapping,
  IMPORT_FIELDS,
  ImportField,
  ParsedRow,
  autoMapHeaders,
  isDuplicate,
  parseImportDate,
  parseImportDirection,
  parseImportStatus,
  resolveProjectId,
} from './common';

type Step = 'file' | 'map' | 'dupes';

const FIELD_HELP: Record<ImportField, string> = {
  date: 'Choose the CSV column containing the transaction date.',
  party: 'Choose the contribution source or expense recipient column.',
  category: 'Choose the reporting category column, if present.',
  amount: 'Choose the numeric amount column. Negative values are treated as expenses when no flow column exists.',
  status: 'Choose paid, due, or overdue status, if present.',
  project: 'Choose the business project column. Unknown or personal projects fall back to the first business project.',
  direction: 'Choose the flow column: contribution/in/credit or expense/out/debit.',
};

const emptyMapping = (): ColumnMapping =>
  ({ date: '', party: '', category: '', amount: '', status: '', project: '', direction: '' } as ColumnMapping);

export default function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();

  const [step, setStep] = useState<Step>('file');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>(emptyMapping());

  const resetAll = () => {
    setStep('file');
    setBusy(false);
    setError(null);
    setFilename('');
    setHeaders([]);
    setRows([]);
    setMapping(emptyMapping());
  };

  const close = () => {
    resetAll();
    onClose();
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error('Choose a CSV file');
      const Papa = (await import('papaparse')).default;
      const text = await file.text();
      const parsed = Papa.parse<ParsedRow>(text, { header: true, skipEmptyLines: true });
      const hdrs = (parsed.meta.fields ?? []) as string[];
      let data = parsed.data as ParsedRow[];
      data = data.filter((r) => Object.values(r).some((v) => String(v ?? '').trim() !== ''));
      if (!hdrs.length || !data.length) {
        setError('No rows found in that file.');
        setBusy(false);
        return;
      }
      setHeaders(hdrs);
      setRows(data);
      setMapping(autoMapHeaders(hdrs));
      setFilename(file.name);
      setStep('map');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that CSV file.');
    } finally {
      setBusy(false);
    }
  };

  const mappingComplete = mapping.date && mapping.party && mapping.amount;

  const parsedRows = useMemo(() => {
    return rows.map((r) => {
      const rawAmount = parseFloat(String(r[mapping.amount] ?? '').replace(/[^0-9.-]/g, ''));
      const amount = Math.abs(isNaN(rawAmount) ? 0 : rawAmount);
      const date = parseImportDate(r[mapping.date] ?? '');
      const party = (r[mapping.party] ?? '').trim();
      const direction = parseImportDirection(mapping.direction ? r[mapping.direction] : undefined, rawAmount);
      const category = (mapping.category ? r[mapping.category] : '')?.trim() || 'Uncategorized';
      const status = parseImportStatus(mapping.status ? r[mapping.status] : undefined);
      const project_id = resolveProjectId(ds, mapping.project ? r[mapping.project] : undefined);
      const dup = isDuplicate(ds, date, party, amount);
      return { date, party, category, direction, status, project_id, amount, dup };
    });
  }, [rows, mapping, ds]);

  const skipped = parsedRows.filter((r) => r.dup).length;
  const willImport = parsedRows.length - skipped;

  const confirmImport = () => {
    const clean = parsedRows.filter((r) => !r.dup);
    const columnMapping: Record<string, string> = {};
    for (const f of IMPORT_FIELDS) if (mapping[f.key]) columnMapping[f.key] = mapping[f.key];

    const batch = store.insert(
      'import_batches',
      {
        id: newId('batch'),
        filename,
        row_count: clean.length,
        duplicates_skipped: skipped,
        column_mapping: columnMapping,
        imported_by: store.me.id,
        imported_at: nowIso(),
      },
      store.asMe({
        summary: `Ledger import — ${filename}, ${clean.length} rows, ${skipped} duplicates skipped`,
      }),
    );

    for (const r of clean) {
      store.insert(
        'ledger',
        {
          id: newId('lg'),
          date: r.date,
          party: r.party,
          category: r.category,
          project_id: r.project_id,
          direction: r.direction as LedgerEntry['direction'],
          amount: r.amount,
          status: r.status as LedgerEntry['status'],
          receipt_url: null,
          linked_task_id: null,
          import_batch_id: batch.id,
          paid_by: store.meId,
          payer_allocations: [{ user_id: store.meId, amount: r.amount }],
          split_pct: null,
          expense_kind: null,
          comments: '',
          ends_on: null,
          subscription_id: null,
        },
        store.asMe({ summary: `Imported from ${filename}` }),
      );
    }

    toast(`Imported ${clean.length} row${clean.length === 1 ? '' : 's'}${skipped ? ` · skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}` : ''}`);
    close();
  };

  const setField = (field: ImportField, value: string) =>
    setMapping((m) => ({ ...m, [field]: value }));

  return (
    /* Wide, because step 3 is a preview table of rows about to be written and
       a 620px dialog turns that into a column of ellipses. Each step keeps its
       own Back/Next pair inline — they move you through the flow rather than
       committing the panel, so they are not the sheet's footer. */
    <SideSheet open={open} onClose={close} title="Import money entries" wide>
      <div className="mn-steps">
        <span className={`${step === 'file' ? 'on' : ''} feature-label`}>
          1 · File
          <InfoTip label="CSV file" text="Upload a CSV with one header row. Nothing is saved at this step." />
        </span>
        <span className={`${step === 'map' ? 'on' : ''} feature-label`}>
          2 · Mapping
          <InfoTip label="Column mapping" text="Match your CSV columns to Money fields and check the preview." />
        </span>
        <span className={`${step === 'dupes' ? 'on' : ''} feature-label`}>
          3 · Duplicates
          <InfoTip label="Duplicate check" text="Rows with the same date, party, and amount as an existing entry are skipped." />
        </span>
      </div>

      {step === 'file' && (
        <div>
          <label className="mn-drop">
            <input
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {busy ? 'Reading file…' : 'Choose a CSV file'}
          </label>
          {error && (
            <p className="tip" style={{ color: 'var(--rose)' }}>
              {error}
            </p>
          )}
          <div className="mn-acts">
            <button className="btn" type="button" onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === 'map' && (
        <div>
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            {filename} · {rows.length} row{rows.length === 1 ? '' : 's'}
          </p>
          <div className="mn-ctl">
            {IMPORT_FIELDS.map((f) => (
              <label className="mn-fld" key={f.key}>
                <span className="mn-lbl feature-label">
                  {f.label}
                  {f.required ? ' *' : ''}
                  <InfoTip label={`${f.label} mapping`} text={FIELD_HELP[f.key]} />
                </span>
                <select
                  className="mn-in"
                  value={mapping[f.key]}
                  onChange={(e) => setField(f.key, e.target.value)}
                >
                  <option value="">— none —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="eyebrow feature-label" style={{ margin: '14px 0 8px' }}>
            Preview — first 3 rows
            <InfoTip label="Import preview" text="A read-only sample of the current mapping; it is not saved yet." />
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table className="mn-preview">
              <thead>
                <tr>
                  {IMPORT_FIELDS.map((f) => (
                    <th key={f.key}>{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 3).map((r, i) => (
                  <tr key={i}>
                    {IMPORT_FIELDS.map((f) => (
                      <td key={f.key} className="mono">
                        {mapping[f.key] ? r[mapping[f.key]] ?? '—' : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!mappingComplete && (
            <p className="tip" style={{ color: 'var(--rose)' }}>
              Map Date, Party, and Amount before continuing.
            </p>
          )}
          <div className="mn-acts">
            <button className="btn" type="button" onClick={() => setStep('file')}>
              Back
            </button>
            <button
              className="btn solid"
              type="button"
              disabled={!mappingComplete}
              onClick={() => setStep('dupes')}
            >
              Next — check duplicates
            </button>
          </div>
        </div>
      )}

      {step === 'dupes' && (
        <div>
          <div className="mn-import-summary">
            <span><strong>{skipped}</strong> duplicates skipped</span>
            <span><strong>{willImport}</strong> entries imported</span>
            <InfoTip label="Import result" text="Duplicate means the same date, party, and amount already exists in Money." />
          </div>
          <motion.div
            {...staggerParent()}
            style={{ maxHeight: 260, overflowY: 'auto' }}
          >
            {parsedRows.map((r, i) => (
              <motion.div key={i} variants={staggerItem} className="mn-duperow">
                <span className="mono">{r.date}</span>
                <span>{r.party || '—'}</span>
                <span className="amt" style={{ color: r.direction === 'in' ? 'var(--teal)' : 'var(--rose)' }}>
                  {r.direction === 'in' ? '+' : '−'}
                  {inr(r.amount)}
                </span>
                <span className={`pill ${r.dup ? 'over' : 'ok'}`}>{r.dup ? 'skip — duplicate' : 'will import'}</span>
              </motion.div>
            ))}
          </motion.div>
          <div className="mn-acts">
            <button className="btn" type="button" onClick={() => setStep('map')}>
              Back
            </button>
            <button className="btn solid" type="button" disabled={willImport === 0} onClick={confirmImport}>
              Import {willImport} row{willImport === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
    </SideSheet>
  );
}
