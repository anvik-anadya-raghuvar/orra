import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useData, useStore, newId, nowIso } from '../../data/store';
import { Modal, TagChip, useToast } from '../../ui/bits';
import { staggerList, staggerItem } from '../../ui/motion';
import type { ChecklistItem, Note, NoteType } from '../../types';

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
  const notes = useData((ds) => ds.notes);
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

  return (
    <div>
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
        <motion.div className="notes-grid" variants={staggerList} initial="initial" animate="animate">
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
          source_ref: null,
          created_by: store.meId,
          created_at: nowIso(),
        },
        store.asMe({ summary: `Note created — ${t}` }),
      );
      toast('Note created');
    }
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={existing ? 'Edit note' : 'New note'}>
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

      <div className="mrowbtns" style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn solid" onClick={save}>
          Save
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
