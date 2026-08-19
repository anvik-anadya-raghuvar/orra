import React, { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useData, useStore, newId, nowIso } from '../../data/store';
import { SideSheet, TagChip, useToast } from '../../ui/bits';
import {
  ImageDrop,
  ImageStrip,
  processImages,
  useImagePaste,
  type DroppedImage,
} from '../../ui/imagedrop';
import { staggerList, staggerItem, staggerParent } from '../../ui/motion';
import { fmtDay } from '../../lib/dates';
import { ownRows } from '../../lib/workspace';
import { makeBlock } from './WikiBlocks';
import type { PageBlock } from '../../types';
import { HeatStrip, MiniBars } from '../../ui/viz';
import { MAX_NOTE_IMAGES } from '../../types';
import type { AttachedImage, ChecklistItem, Note, NoteType } from '../../types';

const NOTE_TYPE_ORDER: NoteType[] = ['plain', 'checklist', 'meeting', 'voice', 'email'];
const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  plain: 'Plain',
  checklist: 'Checklist',
  meeting: 'Meeting',
  voice: 'Voice',
  email: 'Email',
};

const TYPE_FILTERS: { key: NoteType | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'plain', label: 'Plain' },
  { key: 'checklist', label: 'Checklist' },
  { key: 'meeting', label: 'Meeting' },
  { key: 'voice', label: 'Voice' },
  { key: 'email', label: 'Email' },
];

function noteHaystack(n: Note): string {
  return [
    n.title,
    n.body,
    ...(n.transcript ?? []).map((t) => t.text),
    ...(n.checklist ?? []).map((c) => c.text),
    ...n.tags,
  ]
    .join(' ')
    .toLowerCase();
}

export default function NotesTab() {
  const allNotes = useData((ds) => ds.notes);
  const meId = useData((_, s) => s.meId);
  // My notes plus anything still unclaimed (principle 1).
  const notes = useMemo(() => ownRows(allNotes, meId), [allNotes, meId]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<NoteType | 'all'>('all');
  const [openId, setOpenId] = useState<string | 'new' | null>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes
      .filter((n) => typeFilter === 'all' || n.type === typeFilter)
      .filter((n) => !q || noteHaystack(n).includes(q))
      .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || b.created_at.localeCompare(a.created_at));
  }, [notes, query, typeFilter]);

  /* ── overview strip: counts by type + creation activity, last 21 days ─── */
  const typeCounts = useMemo(
    () =>
      NOTE_TYPE_ORDER.map((t) => ({
        label: NOTE_TYPE_LABEL[t],
        value: notes.filter((n) => n.type === t).length,
        // voice notes get the same accent used on their card border, so the
        // strip and the grid below speak the same visual language.
        color: t === 'voice' ? 'var(--stamp)' : undefined,
      })),
    [notes],
  );
  const activityCells = useMemo(() => {
    const days = 21;
    const cells: { label: string; value: number }[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const count = notes.filter((n) => n.created_at.slice(0, 10) === iso).length;
      cells.push({ label: fmtDay(iso), value: count });
    }
    return cells;
  }, [notes]);

  return (
    <div>
      {notes.length > 0 && (
        <div className="kn-overview">
          <div className="kn-ov-panel">
            <span className="eyebrow">Notes by type</span>
            <MiniBars items={typeCounts} />
          </div>
          <div className="kn-ov-panel">
            <span className="eyebrow">Created · last 21 days</span>
            <HeatStrip cells={activityCells} />
          </div>
        </div>
      )}
      <div className="filters">
        <input
          className="srch"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes, transcripts, tags…"
          aria-label="Search notes"
        />
        <button className="btn sm solid" onClick={() => setOpenId('new')}>
          + Note
        </button>
      </div>
      <div className="filters">
        {TYPE_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            className="chip"
            aria-pressed={typeFilter === key}
            onClick={() => setTypeFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <p className="tip">Nothing matches — try a different search or filter.</p>
      ) : (
        <motion.div className="notes-grid" {...staggerParent()}>
          {list.map((n) => (
            <NoteCard key={n.id} note={n} onOpen={() => setOpenId(n.id)} />
          ))}
        </motion.div>
      )}

      {openId && (
        <NoteEditor
          noteId={openId === 'new' ? null : openId}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function NoteCard({ note, onOpen }: { note: Note; onOpen: () => void }) {
  const store = useStore();
  const toast = useToast();
  const canPushSubtasks = !!(note.task_id && note.checklist && note.checklist.some((c) => !c.done));

  const pushSubtasks = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!note.task_id || !note.checklist) return;
    const taskId = note.task_id;
    const existing = store.ds.subtasks.filter((s) => s.task_id === taskId);
    let pos = existing.length ? Math.max(...existing.map((s) => s.position)) : 0;
    const unchecked = note.checklist.filter((c) => !c.done);
    unchecked.forEach((c) => {
      pos += 1;
      store.insert(
        'subtasks',
        { id: newId('st'), task_id: taskId, title: c.text, completed: false, position: pos },
        store.asMe({ summary: `Subtask created from note "${note.title}"` }),
      );
    });
    toast(`${unchecked.length} action item${unchecked.length === 1 ? '' : 's'} pushed as subtasks`);
  };

  /* A note is quick capture; a Wiki page is where something gets structure —
     lines you can reorder, to-dos, embeds, images between paragraphs. This is
     the bridge: everything the note holds becomes real blocks on a new page.
     The note itself stays where it was — this grows a copy, it does not eat
     the original. */
  const makePage = (e: React.MouseEvent) => {
    e.stopPropagation();
    const blocks: PageBlock[] = [];
    for (const line of (note.body || '').split('\n')) {
      if (line.trim()) blocks.push({ ...makeBlock('paragraph'), text: line.trim() });
    }
    for (const t of note.transcript ?? []) {
      blocks.push({ ...makeBlock('paragraph'), text: `${t.at} — ${t.text}` });
    }
    if (note.checklist?.length) {
      blocks.push({
        ...makeBlock('todo'),
        items: note.checklist.map((c) => ({ text: c.text, done: c.done })),
      });
    }
    for (const im of note.images ?? []) {
      blocks.push({ ...makeBlock('image'), src: im.data_url, alt: im.filename });
    }
    if (!blocks.length) blocks.push(makeBlock('paragraph'));
    const siblings = store.ds.pages.filter((p) => !p.parent_page_id);
    store.insert(
      'pages',
      {
        id: newId('pg'),
        title: note.title || 'Untitled note',
        icon: '📝',
        parent_page_id: null,
        blocks,
        tags: [...note.tags],
        linked_task_ids: note.task_id ? [note.task_id] : [],
        is_archived: false,
        position: siblings.length + 1,
        created_by: store.meId,
        owner_id: store.meId,
        created_at: nowIso(),
        last_edited_by: store.meId,
        last_edited_at: nowIso(),
      },
      store.asMe({ summary: `Note "${note.title || 'Untitled'}" became a Wiki page` }),
    );
    toast('Now a Wiki page — open the Wiki tab to build on it');
  };

  // A div, not a button: the card contains its own action button and nesting
  // buttons is invalid HTML. The title is the real focusable control; the card
  // surface is a mouse convenience that delegates to it.
  return (
    <motion.div
      variants={staggerItem}
      className={`note-card type-${note.type}`}
      onClick={onOpen}
    >
      <h4>
        <button type="button" className="note-open" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
          {note.title || 'Untitled'}
        </button>
        {note.is_pinned && <span className="pinflag">pinned</span>}
      </h4>
      {note.type === 'voice' && (
        <div className="wave" aria-hidden>
          {Array.from({ length: 11 }, (_, i) => (
            <i key={i} style={{ height: `${35 + ((i * 17) % 60)}%`, animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>
      )}
      {note.type === 'voice' && note.transcript && note.transcript.length > 0 && (
        <div className="transcript">
          {note.transcript.map((t, i) => (
            <div className="tline" key={i}>
              <span className="tat">{t.at}</span>
              {t.text}
            </div>
          ))}
        </div>
      )}
      {note.body && <p className="body">{note.body}</p>}
      {note.checklist && note.checklist.length > 0 && (
        <div>
          {note.checklist.map((c, i) => (
            <div className="check-item" key={i}>
              <span className={`bx ${c.done ? 'on' : ''}`} />
              <span style={c.done ? { textDecoration: 'line-through', color: 'var(--mute)' } : undefined}>
                {c.text}
              </span>
            </div>
          ))}
        </div>
      )}
      {(note.images?.length ?? 0) > 0 && (
        <div className="note-shots">
          {(note.images ?? []).slice(0, 4).map((im) => (
            <img
              key={im.id}
              src={im.data_url}
              alt={im.filename}
              loading="lazy"
              decoding="async"
              width={im.width}
              height={im.height}
            />
          ))}
          {(note.images?.length ?? 0) > 4 && (
            <span className="note-shots-more">+{(note.images?.length ?? 0) - 4}</span>
          )}
        </div>
      )}
      {canPushSubtasks && (
        <button
          type="button"
          className="btn sm subtask-btn"
          onClick={(e) => {
            e.stopPropagation();
            pushSubtasks(e);
          }}
        >
          Turn action items into subtasks
        </button>
      )}
      <div className="note-foot">
        <span>{new Date(note.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
        {note.tags.map((t) => (
          <TagChip key={t} name={t} />
        ))}
        {note.source_ref && <span className="src">{note.source_ref.split(':')[0]}</span>}
        <button
          type="button"
          className="btn sm note-to-page"
          title="Copy this note into the Wiki as an editable page — lines, to-dos and images become real blocks"
          onClick={makePage}
        >
          Make it a page
        </button>
      </div>
    </motion.div>
  );
}

function NoteEditor({ noteId, onClose }: { noteId: string | null; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const projects = useData((ds) => ds.projects);
  const tasks = useData((ds) => ds.tasks);
  const existing = useData((ds) => ds.notes.find((n) => n.id === noteId)) ?? null;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [type, setType] = useState<NoteType>(existing?.type ?? 'plain');
  const [projectId, setProjectId] = useState(existing?.project_id ?? projects[0]?.id ?? '');
  const [taskId, setTaskId] = useState(existing?.task_id ?? '');
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [pinned, setPinned] = useState(existing?.is_pinned ?? false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(existing?.checklist ?? []);
  const [itemDraft, setItemDraft] = useState('');
  const [images, setImages] = useState<AttachedImage[]>(existing?.images ?? []);
  const [imgBusy, setImgBusy] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  /** Paste, drop and picker all arrive here. The cap matches the CHECK
   *  constraint in migration 0021, so the client refuses before the database
   *  has to. */
  const addImage = (img: DroppedImage) => {
    setImages((prev) => {
      if (prev.length >= MAX_NOTE_IMAGES) {
        toast(`A note holds at most ${MAX_NOTE_IMAGES} images`);
        return prev;
      }
      return [
        ...prev,
        {
          id: newId('img'),
          filename: img.filename,
          mime: 'image/jpeg',
          width: img.width,
          height: img.height,
          bytes: img.bytes,
          data_url: img.data_url,
          created_at: nowIso(),
        },
      ];
    });
  };

  // Ctrl/Cmd+V while the sheet is open, wherever the caret is — except inside
  // the title or body, where a paste means text.
  useImagePaste(
    sheetRef,
    (files) => {
      setImgBusy(true);
      void processImages(files, addImage)
        .then(() => toast('Screenshot attached — it saves with the note'))
        .catch((err: Error) => toast(err.message || 'That image could not be attached'))
        .finally(() => setImgBusy(false));
    },
    true,
    toast,
  );

  const addTag = () => {
    const v = tagDraft.trim();
    if (!v || tags.includes(v)) return;
    setTags([...tags, v]);
    setTagDraft('');
  };
  const addItem = () => {
    const v = itemDraft.trim();
    if (!v) return;
    setChecklist([...checklist, { text: v, done: false }]);
    setItemDraft('');
  };
  const toggleItem = (i: number) => {
    setChecklist(checklist.map((c, idx) => (idx === i ? { ...c, done: !c.done } : c)));
  };

  const save = () => {
    const t = title.trim() || 'Untitled';
    if (existing) {
      store.update(
        'notes',
        existing.id,
        {
          title: t,
          body,
          type,
          project_id: projectId,
          task_id: taskId || null,
          tags,
          is_pinned: pinned,
          checklist: checklist.length ? checklist : null,
          images,
        },
        store.asMe(),
      );
      toast('Note saved');
    } else {
      store.insert(
        'notes',
        {
          id: newId('n'),
          title: t,
          body,
          type,
          project_id: projectId,
          task_id: taskId || null,
          tags,
          is_pinned: pinned,
          transcript: null,
          checklist: checklist.length ? checklist : null,
          images,
          source_ref: null,
          created_by: store.meId,
          owner_id: store.meId,
          created_at: nowIso(),
        },
        store.asMe({ summary: `Note created — ${t}` }),
      );
      toast('Note created');
    }
    onClose();
  };

  const remove = () => {
    if (!existing) return;
    if (!window.confirm(`Delete "${existing.title || 'this note'}"? This cannot be undone.`)) return;
    store.remove('notes', existing.id, store.asMe({ summary: `Note deleted — ${existing.title}` }));
    toast('Note deleted');
    onClose();
  };

  return (
    <SideSheet
      open
      onClose={onClose}
      title={existing ? 'Edit note' : 'New note'}
      subtitle="Paste a screenshot straight in with Ctrl+V — it is compressed in the browser."
      footer={
        <>
          {existing && (
            <button
              type="button"
              className="btn sm"
              onClick={remove}
              style={{ color: 'var(--rose)', marginRight: 'auto' }}
            >
              Delete
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn solid" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div ref={sheetRef}>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        style={inputStyle}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Body"
        style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 11 }}>
        <select value={type} onChange={(e) => setType(e.target.value as NoteType)} style={{ ...inputStyle, marginBottom: 0, flex: 1, minWidth: 130 }}>
          {(['plain', 'checklist', 'meeting', 'voice', 'email'] as NoteType[]).map((tp) => (
            <option key={tp} value={tp}>
              {tp}
            </option>
          ))}
        </select>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ ...inputStyle, marginBottom: 0, flex: 1, minWidth: 130 }}>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="eyebrow" style={{ marginBottom: 6 }}>
        Checklist
      </div>
      {checklist.map((c, i) => (
        <button type="button" key={i} className="check-item tappable" onClick={() => toggleItem(i)}>
          <span className={`bx ${c.done ? 'on' : ''}`} />
          <span style={c.done ? { textDecoration: 'line-through', color: 'var(--mute)' } : undefined}>{c.text}</span>
        </button>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 14 }}>
        <input
          type="text"
          value={itemDraft}
          onChange={(e) => setItemDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addItem())}
          placeholder="+ Add a checklist item"
          style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
        />
        <button type="button" className="btn sm" onClick={addItem} style={{ minHeight: 40 }}>
          Add
        </button>
      </div>

      <div className="eyebrow" style={{ marginBottom: 6 }}>
        Images {images.length ? `· ${images.length}/${MAX_NOTE_IMAGES}` : ''}
      </div>
      <ImageDrop
        onImage={addImage}
        onError={(m) => toast(m)}
        busy={imgBusy}
        setBusy={setImgBusy}
        label="Add an image"
        hint="Paste with Ctrl+V, drop a file, or click to browse"
      />
      <ImageStrip
        images={images}
        onRemove={(id) => setImages((prev) => prev.filter((im) => im.id !== id))}
      />
      <div style={{ height: 14 }} />

      <div className="eyebrow" style={{ marginBottom: 6 }}>
        Tags
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {tags.map((t) => (
          <TagChip key={t} name={t} onRemove={() => setTags(tags.filter((x) => x !== t))} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          type="text"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
          placeholder="+ Add a tag"
          style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
        />
        <button type="button" className="btn sm" onClick={addTag} style={{ minHeight: 40 }}>
          Add
        </button>
      </div>

      <div className="eyebrow" style={{ marginBottom: 6 }}>
        Attach to task
      </div>
      <select value={taskId} onChange={(e) => setTaskId(e.target.value)} style={inputStyle}>
        <option value="">— none —</option>
        {tasks.map((t) => (
          <option key={t.id} value={t.id}>
            {t.id} — {t.title}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="chip"
        aria-pressed={pinned}
        onClick={() => setPinned((p) => !p)}
        style={{ marginBottom: 14 }}
      >
        {pinned ? 'Pinned' : 'Pin this note'}
      </button>

      </div>
    </SideSheet>
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
