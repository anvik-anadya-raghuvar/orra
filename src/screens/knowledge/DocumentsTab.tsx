import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useData, useStore, newId } from '../../data/store';
import { ProgressBar, SideSheet, useToast } from '../../ui/bits';
import { staggerList, staggerItem, staggerParent } from '../../ui/motion';
import { daysUntil } from '../../lib/dates';
import { BarRows } from '../../ui/viz';
import type { DocumentRef } from '../../types';
import type { DriveFile } from '../../lib/google';
import { getToken, googleConfigured, recentDrive, searchDrive } from '../../lib/google';
import { hasScope } from '../../lib/googleSync';

function urgency(doc: DocumentRef): 'ok' | 'soon' | 'over' {
  if (doc.expiry_date) {
    const d = daysUntil(doc.expiry_date);
    if (d < 0) return 'over';
    if (d <= 30) return 'soon';
    return 'ok';
  }
  return doc.status_cache;
}

/** How close the expiry is, 0 (far off) → 100 (overdue) — drives the per-row proximity bar. */
function proximityPct(doc: DocumentRef): number {
  if (doc.expiry_date) {
    const d = daysUntil(doc.expiry_date);
    if (d <= 0) return 100;
    return Math.max(4, Math.round(100 - (Math.min(d, 90) / 90) * 100));
  }
  const bucket = doc.status_cache;
  return bucket === 'over' ? 100 : bucket === 'soon' ? 55 : 8;
}

const URGENCY_LABEL: Record<'ok' | 'soon' | 'over', string> = {
  ok: 'fine',
  soon: 'coming up',
  over: 'act now',
};
const URGENCY_COLOR: Record<'ok' | 'soon' | 'over', string> = {
  ok: 'var(--teal)',
  soon: 'var(--stamp)',
  over: 'var(--rose)',
};

export default function DocumentsTab() {
  const docs = useData((ds) => ds.documents);
  const projects = useData((ds) => ds.projects);
  const store = useStore();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  /** A typo'd expiry used to mean delete and re-add. */
  const [editing, setEditing] = useState<DocumentRef | null>(null);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const projectColor = (id: string) => projects.find((p) => p.id === id)?.color ?? 'var(--slate)';

  const remove = (d: DocumentRef) => {
    if (!window.confirm(`Delete "${d.title}"? It moves to Trash and can be restored from Admin → Data.`))
      return;
    store.remove('documents', d.id, store.asMe({ summary: `Document removed — ${d.title}` }));
    toast('Document removed');
  };

  // Most urgent first — impossible to miss, not something you have to sort for.
  const sorted = useMemo(
    () => [...docs].sort((a, b) => proximityPct(b) - proximityPct(a)),
    [docs],
  );
  const counts = useMemo(() => {
    let ok = 0;
    let soon = 0;
    let over = 0;
    for (const d of docs) {
      const u = urgency(d);
      if (u === 'ok') ok += 1;
      else if (u === 'soon') soon += 1;
      else over += 1;
    }
    return { ok, soon, over };
  }, [docs]);

  return (
    <div>
      <div className="filters">
        <button className="btn sm solid" onClick={() => setAdding(true)}>
          + Document
        </button>
      </div>
      {docs.length > 0 && (
        <div className="kn-ov-panel" style={{ marginBottom: 16 }}>
          <span className="eyebrow">Document health</span>
          <BarRows
            rows={[
              { label: 'Fine', value: counts.ok, color: URGENCY_COLOR.ok },
              { label: 'Coming up', value: counts.soon, color: URGENCY_COLOR.soon },
              { label: 'Act now', value: counts.over, color: URGENCY_COLOR.over },
            ]}
          />
        </div>
      )}
      {docs.length === 0 ? (
        <p className="tip">No documents tracked yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <motion.table className="doc-table" {...staggerParent()}>
            <thead>
              <tr>
                <th>Document</th>
                <th>Project</th>
                <th>Expiry or deadline</th>
                <th>Proximity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d) => {
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
                    <td data-label="Proximity">
                      <span className={`pill ${u}`} style={{ marginBottom: 6, display: 'inline-block' }}>
                        {URGENCY_LABEL[u]}
                      </span>
                      <div style={{ minWidth: 84 }}>
                        <ProgressBar pct={proximityPct(d)} grad={URGENCY_COLOR[u]} />
                      </div>
                    </td>
                    <td data-label="Actions" className="doc-acts">
                      <a
                        className="btn sm"
                        href={d.cloud_ref_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open
                      </a>
                      <button type="button" className="btn sm" onClick={() => setEditing(d)}>
                        Edit
                      </button>
                      <button type="button" className="btn sm danger" onClick={() => remove(d)}>
                        Delete
                      </button>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </motion.table>
        </div>
      )}
      <p className="tip">
        Documents are links to files in your Google Drive, plus the date that matters. Add one by
        searching Drive or pasting a link — the file itself stays in Drive, so nothing here can go
        stale against it. Anything inside 30 days raises its own status.
      </p>
      {adding && <AddDocumentModal onClose={() => setAdding(false)} />}
      {editing && <EditDocumentModal doc={editing} onClose={() => setEditing(null)} />}
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
    <SideSheet
      open
      onClose={onClose}
      title="New document"
      subtitle="A reference to a file that lives elsewhere — nothing is copied here."
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn solid" type="button" onClick={create}>
            Add
          </button>
        </>
      }
    >
      <DrivePicker
        onPick={(f) => {
          if (!title.trim()) setTitle(f.name);
          setUrl(f.link);
        }}
      />
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
    </SideSheet>
  );
}

/**
 * Search Drive and attach a file by reference.
 *
 * Deliberately not a full Drive sync: `documents` tracks the handful of things
 * with an expiry you care about, so mirroring a whole Drive would bury them.
 * Picking a file fills the title and the reference URL; the file never moves.
 */
function DrivePicker({ onPick }: { onPick: (f: DriveFile) => void }) {
  const store = useStore();
  useData((ds) => ds.integration_grants);
  const [q, setQ] = useState('');
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Opening a modal must never make a Google popup appear out of nowhere, so
   * the picker only searches once a *silent* token is in hand. If the session
   * has none, it offers a button and waits to be asked.
   */
  const [ready, setReady] = useState(false);
  const connected = googleConfigured() && hasScope(store, 'drive');

  useEffect(() => {
    if (!connected) return;
    let alive = true;
    getToken(['drive'], { interactive: false })
      .then((t) => alive && setReady(!!t))
      .catch(() => alive && setReady(false));
    return () => {
      alive = false;
    };
  }, [connected]);

  // Debounced: one request per pause in typing, not one per keystroke.
  useEffect(() => {
    if (!connected || !ready) return;
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      const run = q.trim() ? searchDrive(q.trim()) : recentDrive();
      run
        .then((r) => alive && setFiles(r))
        .catch((e) => alive && setError(e instanceof Error ? e.message : 'Drive search failed'))
        .finally(() => alive && setLoading(false));
    }, 280);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, connected, ready]);

  if (!connected)
    return (
      <p className="tip" style={{ marginTop: 0 }}>
        {googleConfigured()
          ? 'Connect Google in Admin → Connections to search Drive instead of pasting a URL.'
          : 'Paste the Drive URL below. Searching Drive needs the Google client id.'}
      </p>
    );

  if (!ready)
    return (
      <div style={{ marginBottom: 11 }}>
        <p className="tip" style={{ marginTop: 0 }}>
          Drive is granted, but this session has no access token yet.
        </p>
        <button
          type="button"
          className="btn sm"
          onClick={() =>
            getToken(['drive'])
              .then((t) => setReady(!!t))
              .catch((e) => setError(e instanceof Error ? e.message : 'Google declined'))
          }
        >
          Ask Google for Drive access
        </button>
      </div>
    );

  return (
    <div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search Drive by name"
        style={inputStyle}
      />
      {error && (
        <p className="tip" style={{ marginTop: 0 }}>
          {error}
        </p>
      )}
      {files.length > 0 && (
        <div className="drive-results">
          {files.map((f) => (
            <button key={f.id} type="button" onClick={() => onPick(f)}>
              {f.name}
            </button>
          ))}
        </div>
      )}
      {!loading && !error && files.length === 0 && (
        <p className="tip" style={{ marginTop: 0 }}>
          Nothing in Drive matches that.
        </p>
      )}
    </div>
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

/**
 * Correcting a document.
 *
 * A mistyped expiry date previously meant deleting the row and re-adding it,
 * which lost the audit trail's sense of a single document being amended.
 */
function EditDocumentModal({ doc, onClose }: { doc: DocumentRef; onClose: () => void }) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [title, setTitle] = useState(doc.title);
  const [projectId, setProjectId] = useState(doc.project_id);
  const [expiry, setExpiry] = useState(doc.expiry_date ?? '');
  const [note, setNote] = useState(doc.deadline_note ?? '');
  const [url, setUrl] = useState(doc.cloud_ref_url);

  const save = () => {
    const clean = title.trim();
    if (!clean) {
      toast('A document needs a title');
      return;
    }
    store.update(
      'documents',
      doc.id,
      {
        title: clean,
        project_id: projectId,
        expiry_date: expiry || null,
        deadline_note: note.trim(),
        cloud_ref_url: url.trim() || doc.cloud_ref_url,
      },
      store.asMe({ summary: `Document updated — ${clean}` }),
    );
    toast('Document updated');
    onClose();
  };

  return (
    <SideSheet
      open
      onClose={onClose}
      title="Edit document"
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn solid" type="button" onClick={save}>
            Save changes
          </button>
        </>
      }
    >
      <label className="kn-fld">
        <span className="kn-lbl">Title</span>
        <input className="kn-in" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="kn-fld">
        <span className="kn-lbl">Project</span>
        <select className="kn-in" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {ds.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="kn-fld">
        <span className="kn-lbl">Expiry date</span>
        <input className="kn-in" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </label>
      <label className="kn-fld">
        <span className="kn-lbl">Deadline note</span>
        <input
          className="kn-in"
          value={note}
          placeholder="e.g. within 8 days of arrival"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <label className="kn-fld">
        <span className="kn-lbl">Drive link</span>
        <input className="kn-in" value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
    </SideSheet>
  );
}
