import React, { useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useData, useStore, newId, nowIso } from '../../data/store';
import { SideSheet, TagChip, useToast } from '../../ui/bits';
import { ProjectCombo } from '../../ui/pickers';
import {
  ImageDrop,
  processImages,
  useImagePaste,
  type DroppedImage,
} from '../../ui/imagedrop';
import { InlineImageContent, InlineImageEditor } from '../../ui/InlineImageEditor';
import {
  appendMissingInlineImages,
  insertInlineImages,
  removeInlineImage,
  splitInlineImages,
  stripInlineImageMarkers,
} from '../../ui/inlineImages';
import { staggerItem, staggerParent } from '../../ui/motion';
import { fmtDay, localDay, todayIso } from '../../lib/dates';
import { ownRows } from '../../lib/workspace';
import { makeBlock } from './WikiBlocks';
import type { PageBlock } from '../../types';
import { HeatStrip, MiniBars } from '../../ui/viz';
import { MAX_NOTE_IMAGES } from '../../types';
import type { AttachedImage, ChecklistItem, Note, NoteType } from '../../types';
import { DictateField } from '../../ui/dictation';

const NOTE_TYPE_ORDER: NoteType[] = ['plain', 'checklist', 'meeting', 'voice', 'email'];
const NOTE_LABEL_COLORS = ['indigo', 'violet', 'teal', 'amber', 'rose', 'slate'] as const;
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
    stripInlineImageMarkers(n.body),
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
      const iso = todayIso(d);
      const count = notes.filter((n) => localDay(n.created_at) === iso).length;
      cells.push({ label: fmtDay(iso), value: count });
    }
    return cells;
  }, [notes]);

  return (
    <div>
      {notes.length > 0 && (
        <div className="kn-overview">
          <div className="kn-ov-panel">
            <span className="eyebrow">Scribbles by type</span>
            <MiniBars items={typeCounts} />
          </div>
          <div className="kn-ov-panel">
            <span className="eyebrow">Created · last 21 days</span>
            <HeatStrip cells={activityCells} />
          </div>
        </div>
      )}
      <div className="filters">
        <DictateField label="Search by voice" className="grow">
          <input
            className="srch"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search scribbles, transcripts, tags…"
            aria-label="Search scribbles"
          />
        </DictateField>
        <button className="btn sm solid" onClick={() => setOpenId('new')}>
          + Scribble
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
        store.asMe({ summary: `Subtask created from scribble "${note.title}"` }),
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
    const noteImages = note.images ?? [];
    const placedBody = appendMissingInlineImages(note.body || '', noteImages.map((image) => image.id));
    for (const part of splitInlineImages(placedBody)) {
      if (part.kind === 'image') {
        const image = noteImages.find((item) => item.id === part.id);
        if (image) blocks.push({ ...makeBlock('image'), src: image.data_url, alt: image.filename });
        continue;
      }
      for (const line of part.text.split('\n')) {
        if (line.trim()) blocks.push({ ...makeBlock('paragraph'), text: line.trim() });
      }
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
      store.asMe({ summary: `Scribble "${note.title || 'Untitled'}" became a Wiki page` }),
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
      {(note.body || note.images?.length) && (
        <InlineImageContent
          className="note-inline-content"
          value={note.body}
          imageIds={(note.images ?? []).map((image) => image.id)}
          renderText={(text) => <p className="body">{text}</p>}
          renderImage={(id) => {
            const image = note.images?.find((item) => item.id === id);
            return image ? (
              <img
                className="note-inline-image"
                src={image.data_url}
                alt={image.filename}
                loading="lazy"
                decoding="async"
                width={image.width}
                height={image.height}
              />
            ) : null;
          }}
        />
      )}
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
          title="Copy this scribble into the Wiki as an editable page — lines, to-dos and images become real blocks"
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
  const allTags = useData((ds) => ds.tags);
  const existing = useData((ds) => ds.notes.find((n) => n.id === noteId)) ?? null;

  const [title, setTitle] = useState(existing?.title ?? '');
  const existingImages = existing?.images ?? [];
  const [body, setBody] = useState(
    appendMissingInlineImages(existing?.body ?? '', existingImages.map((image) => image.id)),
  );
  const [type, setType] = useState<NoteType>(existing?.type ?? 'plain');
  const [projectId, setProjectId] = useState(existing?.project_id ?? projects[0]?.id ?? '');
  const [taskId, setTaskId] = useState(existing?.task_id ?? '');
  const [tags, setTags] = useState<string[]>(existing?.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [pinned, setPinned] = useState(existing?.is_pinned ?? false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(existing?.checklist ?? []);
  const [itemDraft, setItemDraft] = useState('');
  const [images, setImages] = useState<AttachedImage[]>(existingImages);
  const [imgBusy, setImgBusy] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef(body.length);
  const imagesRef = useRef(images);

  /** Paste, drop and picker all arrive here. The cap matches the CHECK
   *  constraint in migration 0021, so the client refuses before the database
   *  has to. */
  const addImage = (img: DroppedImage, offset = caretRef.current) => {
    if (imagesRef.current.length >= MAX_NOTE_IMAGES) {
      toast(`A scribble holds at most ${MAX_NOTE_IMAGES} images`);
      return;
    }
    const image: AttachedImage = {
      id: newId('img'),
      filename: img.filename,
      mime: 'image/jpeg',
      width: img.width,
      height: img.height,
      bytes: img.bytes,
      data_url: img.data_url,
      created_at: nowIso(),
    };
    imagesRef.current = [...imagesRef.current, image];
    setImages(imagesRef.current);
    setBody((current) => {
      const inserted = insertInlineImages(current, offset, [image.id]);
      caretRef.current = inserted.caret;
      return inserted.value;
    });
  };

  const pasteImages = (files: File[], offset = caretRef.current) => {
    setImgBusy(true);
    let nextOffset = offset;
    void processImages(files, (image) => {
      addImage(image, nextOffset);
      nextOffset = caretRef.current;
    })
      .then(() => toast('Image pasted into the scribble'))
      .catch((err: Error) => toast(err.message || 'That image could not be pasted'))
      .finally(() => setImgBusy(false));
  };

  // Ctrl/Cmd+V while the sheet is open, wherever the caret is — except inside
  // the title or body, where a paste means text.
  useImagePaste(
    sheetRef,
    (files) => pasteImages(files),
    true,
    toast,
  );

  const addTag = () => {
    const v = tagDraft.trim();
    if (!v || tags.includes(v)) return;
    setTags([...tags, v]);
    if (!allTags.some((tag) => tag.name.toLowerCase() === v.toLowerCase())) {
      store.insert(
        'tags',
        {
          id: newId('tag'),
          name: v,
          color: NOTE_LABEL_COLORS[allTags.length % NOTE_LABEL_COLORS.length],
          created_by: store.meId,
          created_at: nowIso(),
        },
        store.asMe({ summary: `Label created — ${v}` }),
      );
    }
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
    /* notes.project_id is NOT NULL — with no projects yet, the field starts
       empty rather than defaulting to one that does not exist. */
    if (!projectId) {
      toast('Choose or type a project for this scribble');
      return;
    }
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
        store.asMe({ summary: `Scribble created — ${t}` }),
      );
      toast('Note created');
    }
    onClose();
  };

  const remove = () => {
    if (!existing) return;
    if (!window.confirm(`Delete "${existing.title || 'this scribble'}"? This cannot be undone.`)) return;
    store.remove('notes', existing.id, store.asMe({ summary: `Scribble deleted — ${existing.title}` }));
    toast('Scribble deleted');
    onClose();
  };

  return (
    <SideSheet
      open
      onClose={onClose}
      title={existing ? 'Edit scribble' : 'New scribble'}
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
      <DictateField label="Dictate the title">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          style={inputStyle}
        />
      </DictateField>
      <InlineImageEditor
        value={body}
        imageIds={images.map((image) => image.id)}
        onChange={setBody}
        onPasteFiles={pasteImages}
        onCaretChange={(offset) => { caretRef.current = offset; }}
        onUnusableImage={toast}
        placeholder="Body"
        ariaLabel="Scribble body"
        className="note-inline-editor"
        renderImage={(id) => {
          const image = images.find((item) => item.id === id);
          if (!image) return null;
          return (
            <figure className="note-inline-figure">
              <img
                src={image.data_url}
                alt={image.filename}
                loading="lazy"
                decoding="async"
                width={image.width}
                height={image.height}
              />
              <figcaption>
                <span>{image.filename}</span>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    imagesRef.current = imagesRef.current.filter((item) => item.id !== id);
                    setImages(imagesRef.current);
                    setBody((current) => removeInlineImage(current, id));
                  }}
                >
                  Remove
                </button>
              </figcaption>
            </figure>
          );
        }}
      />
      <ImageDrop
        onImage={(image) => addImage(image)}
        onError={toast}
        busy={imgBusy}
        setBusy={setImgBusy}
        compact
        label={images.length ? 'Insert another image here' : 'Insert an image here'}
        hint="Paste, drop, or choose a file"
      />
      <div style={{ height: 11 }} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 11 }}>
        <select aria-label="Note type" value={type} onChange={(e) => setType(e.target.value as NoteType)} style={{ ...inputStyle, marginBottom: 0, flex: 1, minWidth: 130 }}>
          {(['plain', 'checklist', 'meeting', 'voice', 'email'] as NoteType[]).map((tp) => (
            <option key={tp} value={tp}>
              {tp}
            </option>
          ))}
        </select>
        <ProjectCombo
          value={projectId}
          onChange={setProjectId}
          style={{ flex: 1, minWidth: 130 }}
          inputStyle={{ ...inputStyle, marginBottom: 0 }}
        />
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
      <select aria-label="Attach to task" value={taskId} onChange={(e) => setTaskId(e.target.value)} style={inputStyle}>
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
        {pinned ? 'Pinned' : 'Pin this scribble'}
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
