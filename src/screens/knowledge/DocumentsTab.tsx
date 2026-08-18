import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useData, useStore, newId } from '../../data/store';
import { Modal, useToast } from '../../ui/bits';
import { staggerList, staggerItem } from '../../ui/motion';
import { daysUntil } from '../../lib/dates';
import type { DocumentRef } from '../../types';

function urgency(doc: DocumentRef): 'ok' | 'soon' | 'over' {
  if (doc.expiry_date) {
    const d = daysUntil(doc.expiry_date);
    if (d < 0) return 'over';
    if (d <= 30) return 'soon';
    return 'ok';
  }
  return doc.status_cache;
}

const URGENCY_LABEL: Record<'ok' | 'soon' | 'over', string> = {
  ok: 'fine',
  soon: 'coming up',
  over: 'act now',
};

export default function DocumentsTab() {
  const docs = useData((ds) => ds.documents);
  const projects = useData((ds) => ds.projects);
  const [adding, setAdding] = useState(false);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const projectColor = (id: string) => projects.find((p) => p.id === id)?.color ?? 'var(--slate)';

  return (
    <div>
      <div className="filters">
        <button className="btn sm solid" onClick={() => setAdding(true)}>
          + Document
        </button>
      </div>
      {docs.length === 0 ? (
        <p className="tip">No documents tracked yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <motion.table className="doc-table" variants={staggerList} initial="initial" animate="animate">
            <thead>
              <tr>
                <th>Document</th>
                <th>Project</th>
                <th>Expiry or deadline</th>
                <th>Status</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const u = urgency(d);
                return (
                  <motion.tr variants={staggerItem} key={d.id}>
                    <td data-label="Document" style={{ fontWeight: 500 }}>
                      {d.title}
                    </td>
                    <td data-label="Project">
                      <span className="tagc" style={{ background: 'var(--surf3)', color: projectColor(d.project_id) }}>
                        {projectName(d.project_id)}
                      </span>
                    </td>
                    <td data-label="Expiry / deadline" className="mono">
                      {d.expiry_date ?? d.deadline_note ?? '—'}
                    </td>
                    <td data-label="Status">
                      <span className={`pill ${u}`}>{URGENCY_LABEL[u]}</span>
                    </td>
                    <td data-label="Reference">
                      <a className="lk" href={d.cloud_ref_url} target="_blank" rel="noreferrer">
                        Open in Drive
                      </a>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </motion.table>
        </div>
      )}
      <p className="tip">
        Files stay in Drive; only the reference and the date live here. Anything within 30 days raises status
        automatically.
      </p>
      {adding && <AddDocumentModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddDocumentModal({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const projects = useData((ds) => ds.projects);
  const [title, setTitle] = useState('');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [expiry, setExpiry] = useState('');
  const [deadlineNote, setDeadlineNote] = useState('');
  const [url, setUrl] = useState('');

  const create = () => {
    const t = title.trim();
    if (!t) return;
    store.insert(
      'documents',
      {
        id: newId('doc'),
        title: t,
        project_id: projectId,
        expiry_date: expiry || null,
        deadline_note: deadlineNote,
        cloud_ref_url: url || 'https://drive.google.com/',
        status_cache: 'ok',
      },
      store.asMe({ summary: `Document added — ${t}` }),
    );
    toast('Document added');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="New document">
      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={inputStyle} />
      <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={inputStyle}>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
        Expiry date (optional)
      </label>
      <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} style={inputStyle} />
      <input
        type="text"
        value={deadlineNote}
        onChange={(e) => setDeadlineNote(e.target.value)}
        placeholder="Deadline note (optional)"
        style={inputStyle}
      />
      <input type="text" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Drive URL" style={inputStyle} />
      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn solid" onClick={create}>
          Add
        </button>
      </div>
    </Modal>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--line)',
  background: 'var(--surf2)',
  borderRadius: 10,
  padding: '10px 12px',
  font: 'inherit',
  fontSize: 13.5,
  color: 'var(--ink)',
  marginBottom: 11,
};
