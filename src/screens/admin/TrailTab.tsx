import { useState } from 'react';
import { motion } from 'framer-motion';
import { useData } from '../../data/store';
import { staggerItem, staggerList } from '../../ui/motion';
import { fmtDateTime } from '../../lib/dates';
import { exportAuditCsv, exportAuditXlsx } from './common';

const PAGE = 100;

export default function TrailTab() {
  const audit = useData((ds) => ds.audit_trail);
  const [visible, setVisible] = useState(PAGE);

  // The store always prepends new rows, so the collection is already
  // newest-first — sort defensively in case a batch of imports lands out
  // of strict chronological order.
  const sorted = [...audit].sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
  const shown = sorted.slice(0, visible);

  const exportCsv = () => exportAuditCsv(`audit-trail-${new Date().toISOString().slice(0, 10)}.csv`, sorted);
  const exportXlsx = () => exportAuditXlsx(`audit-trail-${new Date().toISOString().slice(0, 10)}.xlsx`, sorted);

  return (
    <div>
      <div className="filters">
        <button className="btn sm" type="button" onClick={exportCsv}>
          ↓ CSV
        </button>
        <button className="btn sm" type="button" onClick={exportXlsx}>
          ↓ XLSX
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <motion.table className="ad-table" variants={staggerList} initial="initial" animate="animate">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Where</th>
              <th>What changed</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <motion.tr key={e.id} variants={staggerItem}>
                <td data-label="When" className="mono" style={{ whiteSpace: 'nowrap' }}>
                  {fmtDateTime(e.occurred_at)}
                </td>
                <td data-label="Who">{e.actor_label}</td>
                <td data-label="Where" className="mono">
                  {e.entity_type} · {e.entity_id}
                </td>
                <td data-label="What changed" className="diff mono">
                  {e.field_name ? (
                    <>
                      <s>{e.old_value ?? '—'}</s> → <b>{e.new_value ?? '—'}</b>
                    </>
                  ) : (
                    e.new_value ?? e.old_value ?? '—'
                  )}
                </td>
                <td data-label="Source">
                  <span className={`src ${e.source}`}>{e.source}</span>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </motion.table>
      </div>

      {sorted.length === 0 && <p className="tip">Nothing in the trail yet.</p>}

      {visible < sorted.length && (
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button className="btn sm" type="button" onClick={() => setVisible((v) => v + PAGE)}>
            Load more ({sorted.length - visible} more)
          </button>
        </div>
      )}

      <p className="tip">
        Append-only at the database level — no one can edit or delete a row here, including an owner.
      </p>
    </div>
  );
}
