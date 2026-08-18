import { motion } from 'framer-motion';
import { useData, useStore } from '../../data/store';
import { useToast } from '../../ui/bits';
import { staggerItem, staggerList } from '../../ui/motion';
import { fmtDateTime } from '../../lib/dates';

export default function ImportHistory() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();

  const batches = [...ds.import_batches].sort((a, b) => (a.imported_at < b.imported_at ? 1 : -1));

  if (batches.length === 0) {
    return <p className="tip">No imports yet — batches show up here once you run one.</p>;
  }

  const rollback = (batchId: string, filename: string) => {
    const rows = ds.ledger.filter((r) => r.import_batch_id === batchId);
    const ok = window.confirm(
      `Roll back "${filename}"? This removes ${rows.length} ledger row${rows.length === 1 ? '' : 's'} tied to this import and cannot be undone.`,
    );
    if (!ok) return;
    for (const r of rows) {
      store.remove('ledger', r.id, store.asMe({ summary: `Removed by rollback of ${filename}` }));
    }
    store.remove('import_batches', batchId, store.asMe({ summary: `Import batch rolled back — ${filename}` }));
    toast(`Rolled back "${filename}" — ${rows.length} row${rows.length === 1 ? '' : 's'} removed`);
  };

  return (
    <motion.div variants={staggerList} initial="initial" animate="animate">
      {batches.map((b) => {
        const person = ds.profiles.find((p) => p.id === b.imported_by)?.name ?? b.imported_by;
        return (
          <motion.div key={b.id} variants={staggerItem} className="mn-batch-row">
            <div>
              <p style={{ fontWeight: 500, fontSize: 13.5, margin: 0 }}>{b.filename}</p>
              <p className="mono" style={{ fontSize: 11, color: 'var(--mute)', margin: '3px 0 0' }}>
                {fmtDateTime(b.imported_at)} · {person} · {b.row_count} row{b.row_count === 1 ? '' : 's'}
                {b.duplicates_skipped ? ` · ${b.duplicates_skipped} duplicate${b.duplicates_skipped === 1 ? '' : 's'} skipped` : ''}
              </p>
            </div>
            <button className="btn sm" type="button" onClick={() => rollback(b.id, b.filename)}>
              Roll back batch
            </button>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
