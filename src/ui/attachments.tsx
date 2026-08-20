/**
 * Files on anything.
 *
 * One panel, dropped into whichever room needs paperwork — a task, a scribble,
 * a wiki page, a decision, a fixed date, a ledger entry. It is the same
 * component everywhere on purpose: "where can I attach a document" should
 * never have a different answer depending on which room you happen to be in.
 *
 * The bytes go to the private `files` bucket (see lib/files.ts); this only
 * ever handles the reference row, so a 20 MB PDF costs Postgres a few hundred
 * characters. Every mutation goes through the store, which means an upload is
 * saved the instant it lands — there is no Save button between attaching a
 * file and it being on the record — and every one of them is audited.
 *
 * Drag-and-drop is an addition, never the only way in: the button is a real
 * `<label>` wrapping a real file input, so it works by tap and by keyboard.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Download, Paperclip, Trash2, Upload } from 'lucide-react';
import { newId, nowIso, useData, useStore } from '../data/store';
import { deleteFile, fileHref, fileKind, humanBytes, rejectReason, uploadFile } from '../lib/files';
import type { Attachment, AttachmentParent } from '../types';
import { useToast } from './bits';
import { entrance, micro, staggerItem } from './motion';
import './attachments.css';

/** How many files one thing may carry. A list longer than this is a folder,
 *  and a folder is a different feature. */
const MAX_PER_ENTITY = 25;

/** One row. Resolves its own signed URL, because the bucket is private and a
 *  stored path is not something an `<a href>` can use. */
function FileRow({
  file,
  onRemove,
  onCaption,
}: {
  file: Attachment;
  onRemove: () => void;
  onCaption: (text: string) => void;
}) {
  const [href, setHref] = useState<string | null | undefined>(undefined);
  const [caption, setCaption] = useState(file.caption ?? '');
  const uploader = useData((ds) => ds.profiles.find((p) => p.id === file.uploaded_by));
  const kind = fileKind(file.filename, file.mime);

  useEffect(() => {
    let alive = true;
    setHref(undefined);
    void fileHref(file.storage_path).then((url) => alive && setHref(url));
    return () => {
      alive = false;
    };
  }, [file.storage_path]);

  return (
    <motion.li className="att-row" variants={staggerItem} layout="position">
      <span className={`att-kind k-${kind.toLowerCase()}`} aria-hidden>
        {kind}
      </span>
      <span className="att-body">
        <span className="att-name" title={file.filename}>
          {file.filename}
        </span>
        <span className="att-meta mono">
          {humanBytes(file.bytes)}
          {uploader ? ` · ${uploader.name}` : ''} · {file.created_at.slice(0, 10)}
        </span>
        <input
          className="att-caption"
          value={caption}
          placeholder="What is this? (optional)"
          aria-label={`Note on ${file.filename}`}
          maxLength={300}
          onChange={(e) => setCaption(e.target.value)}
          /* Saved on blur rather than per keystroke: a caption is a sentence,
             and a row write per letter is a row write per letter. */
          onBlur={() => {
            if ((file.caption ?? '') !== caption) onCaption(caption);
          }}
        />
      </span>
      <span className="att-acts">
        {href === undefined ? (
          <span className="att-skel" aria-label="Preparing the link" />
        ) : href ? (
          <a
            className="btn sm icon"
            href={href}
            download={file.filename}
            target="_blank"
            rel="noreferrer"
            aria-label={`Download ${file.filename}`}
            title="Download"
          >
            <Download size={15} strokeWidth={2} aria-hidden />
          </a>
        ) : (
          <span className="att-gone" title="The stored copy could not be reached">
            missing
          </span>
        )}
        <button
          type="button"
          className="btn sm icon"
          aria-label={`Remove ${file.filename}`}
          title="Remove"
          onClick={onRemove}
        >
          <Trash2 size={15} strokeWidth={2} aria-hidden />
        </button>
      </span>
    </motion.li>
  );
}

export function Attachments({
  entityType,
  entityId,
  label = 'Files',
  hint = 'PDFs, spreadsheets, documents — anything worth keeping with this.',
}: {
  entityType: AttachmentParent;
  entityId: string;
  label?: string;
  hint?: string;
}) {
  const store = useStore();
  const toast = useToast();
  const reduced = useReducedMotion();
  const files = useData((ds) =>
    ds.attachments
      .filter((a) => a.entity_type === entityType && a.entity_id === entityId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
  );
  const [busy, setBusy] = useState(0);
  const [over, setOver] = useState(false);
  const count = files.length;

  const take = useCallback(
    async (picked: File[]) => {
      if (!picked.length) return;
      const room = MAX_PER_ENTITY - count;
      if (room <= 0) {
        toast(`That is already ${MAX_PER_ENTITY} files — remove one first.`);
        return;
      }
      const batch = picked.slice(0, room);
      if (batch.length < picked.length) {
        toast(`Only the first ${batch.length} fit — the limit is ${MAX_PER_ENTITY} per item.`);
      }
      for (const file of batch) {
        const reason = rejectReason(file);
        if (reason) {
          toast(reason);
          continue;
        }
        setBusy((n) => n + 1);
        try {
          const id = newId('att');
          const storage_path = await uploadFile(file, store.meId, id);
          store.insert(
            'attachments',
            {
              id,
              entity_type: entityType,
              entity_id: entityId,
              filename: file.name,
              mime: file.type || 'application/octet-stream',
              bytes: file.size,
              storage_path,
              caption: null,
              uploaded_by: store.meId,
              created_at: nowIso(),
            },
            store.asMe({ summary: `File attached — ${file.name}` }),
          );
          toast(`${file.name} attached`);
        } catch (err) {
          toast((err as Error).message || `Could not attach ${file.name}`);
        } finally {
          setBusy((n) => n - 1);
        }
      }
    },
    [count, entityId, entityType, store, toast],
  );

  const remove = (file: Attachment) => {
    if (!window.confirm(`Remove "${file.filename}"? It moves to Trash and can be restored.`)) return;
    store.remove('attachments', file.id, store.asMe({ summary: `File removed — ${file.filename}` }));
    // Best effort: the row is what the app reads, so a failure here costs an
    // orphaned object rather than leaving a file nobody can get rid of.
    void deleteFile(file.storage_path);
    toast(`${file.filename} removed`);
  };

  return (
    <section
      className={`att${over ? ' att-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void take(Array.from(e.dataTransfer.files));
      }}
    >
      <header className="att-hd">
        <Paperclip size={14} strokeWidth={2} aria-hidden />
        <span className="eyebrow">{label}</span>
        {count > 0 && <span className="mono att-count">{count}</span>}
        <span className="spacer" />
        <label className="btn sm att-add">
          <Upload size={14} strokeWidth={2} aria-hidden />
          {busy ? 'Uploading…' : 'Add file'}
          <input
            type="file"
            multiple
            hidden
            onChange={(e) => {
              void take(Array.from(e.target.files ?? []));
              // The same file twice in a row must still fire a change event.
              e.target.value = '';
            }}
          />
        </label>
      </header>

      {count === 0 && !busy && (
        <p className="tip att-empty">{hint} Drop one here, or use Add file.</p>
      )}

      <motion.ul
        className="att-list"
        initial={reduced ? false : 'hidden'}
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: reduced ? 0 : 0.04 } } }}
      >
        <AnimatePresence initial={false}>
          {files.map((file) => (
            <FileRow
              key={file.id}
              file={file}
              onRemove={() => remove(file)}
              onCaption={(text) =>
                store.update(
                  'attachments',
                  file.id,
                  { caption: text.trim() || null },
                  store.asMe({ summary: `Note on ${file.filename}` }),
                )
              }
            />
          ))}
        </AnimatePresence>
        {/* A skeleton per file still uploading — never a spinner, never a
            blank gap where the row is about to be. */}
        {Array.from({ length: busy }).map((_, i) => (
          <motion.li
            className="att-row att-loading"
            key={`upload-${i}`}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: reduced ? { duration: 0 } : entrance }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, transition: micro }}
          >
            <span className="att-skel block" />
          </motion.li>
        ))}
      </motion.ul>
    </section>
  );
}
