import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MotionConfig, motion } from 'framer-motion';
import { newId, nowIso, useData, useDataset, useStore } from '../../data/store';
import { Avatar, TagChip, useToast } from '../../ui/bits';
import { entrance } from '../../ui/motion';
import { generateTaskExport, exportTaskZip } from '../../lib/exportTask';
import { fmtTime, inr } from '../../lib/dates';
import { notifyAssignment } from '../../lib/handoff';
import { PRIORITIES, STATUSES, TYPES } from '../work/common';
import Checklist from './Checklist';
import Screenshots from './Screenshots';
import type { Task, TaskPriority, TaskStatus, TaskType } from '../../types';
import './task.css';

/** Tags stay centrally managed — new tag names rotate through this palette
 *  rather than being hard-coded per task (principle 7). */
const TAG_COLORS = ['indigo', 'teal', 'stamp', 'rose', 'sky', 'violet'];

const byCreated = <T extends { created_at: string; id: string }>(a: T, b: T) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const task = useData((ds) => ds.tasks.find((t) => t.id === id));

  if (!task) {
    return (
      <div className="tpage">
        <div className="frame">
          <div className="wrap" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <p className="none" style={{ marginBottom: 14, fontSize: 14 }}>
              Task {id ?? ''} not found.
            </p>
            <Link className="btn sm solid" to="/work">
              ← Back to Work
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // key={task.id} so local draft state (title/description/composer) resets
  // cleanly when navigating from one task straight to another.
  return <TaskDetail key={task.id} task={task} />;
}

function TaskDetail({ task }: { task: Task }) {
  const store = useStore();
  const ds = useDataset();
  const toast = useToast();
  const navigate = useNavigate();

  const [title, setTitle] = useState(task.title);
  const [desc, setDesc] = useState(task.description);
  const [addingTag, setAddingTag] = useState(false);
  const [tagDraft, setTagDraft] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [isDecision, setIsDecision] = useState(false);

  const saveTitle = () => {
    const t = title.trim();
    if (!t) {
      setTitle(task.title);
      return;
    }
    if (t !== task.title) {
      store.update('tasks', task.id, { title: t }, store.asMe({ summary: `Title changed on ${task.id}` }));
    }
  };

  const saveDesc = () => {
    if (desc !== task.description) {
      store.update(
        'tasks',
        task.id,
        { description: desc },
        store.asMe({ summary: `Description updated on ${task.id}` }),
      );
    }
  };

  const setField = <K extends keyof Task>(field: K, value: Task[K]) => {
    store.update('tasks', task.id, { [field]: value } as Partial<Task>, store.asMe());
    // Reassignment moves this task to the other workspace — announce it.
    if (field === 'assignee_id') {
      notifyAssignment(store, task, value as Task['assignee_id']);
    }
  };

  const commitTag = () => {
    const name = tagDraft.trim();
    if (name) {
      if (!task.tags.includes(name)) {
        store.update(
          'tasks',
          task.id,
          { tags: [...task.tags, name] },
          store.asMe({ summary: `Tag added to ${task.id}: ${name}` }),
        );
      }
      if (!ds.tags.some((t) => t.name === name)) {
        const color = TAG_COLORS[ds.tags.length % TAG_COLORS.length];
        store.insert(
          'tags',
          { id: newId('tag'), name, color, created_by: store.me.id, created_at: nowIso() },
          store.asMe({ summary: `Tag created: ${name}` }),
        );
      }
    }
    setTagDraft('');
    setAddingTag(false);
  };

  const removeTag = (name: string) =>
    store.update(
      'tasks',
      task.id,
      { tags: task.tags.filter((t) => t !== name) },
      store.asMe({ summary: `Tag removed from ${task.id}: ${name}` }),
    );

  const copyMd = async () => {
    try {
      await navigator.clipboard.writeText(generateTaskExport(ds, task.id));
      toast('TASK.md copied to clipboard');
    } catch {
      toast('Clipboard blocked — could not copy');
    }
  };

  const downloadZip = async () => {
    try {
      const blob = await exportTaskZip(ds, task.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${task.id}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(`${task.id}.zip downloaded`);
    } catch {
      toast('Export failed — try again');
    }
  };

  const addNote = () => {
    const t = noteTitle.trim();
    if (!t) return;
    store.insert(
      'notes',
      {
        id: newId('note'),
        title: t,
        body: '',
        type: 'plain',
        project_id: task.project_id,
        task_id: task.id,
        tags: [],
        is_pinned: false,
        transcript: null,
        checklist: null,
        source_ref: null,
        created_by: store.me.id,
        created_at: nowIso(),
      },
      store.asMe({ summary: `Note linked to ${task.id}: ${t}` }),
    );
    setNoteTitle('');
  };

  const submitComment = () => {
    const body = commentBody.trim();
    if (!body) {
      toast('Write something before posting');
      return;
    }
    store.insert(
      'comments',
      {
        id: newId('c'),
        task_id: task.id,
        author_id: store.me.id,
        body,
        is_decision: isDecision,
        created_at: nowIso(),
      },
      store.asMe({
        summary: isDecision ? `Decision recorded on ${task.id}` : `Comment added to ${task.id}`,
      }),
    );
    setCommentBody('');
    setIsDecision(false);
  };

  const deleteTask = () => {
    if (
      !window.confirm(
        `Delete ${task.id} — "${task.title}"? It moves to Trash and can be restored from Admin → Data.`,
      )
    )
      return;
    store.remove('tasks', task.id, store.asMe({ summary: `Task deleted — ${task.title}` }));
    toast(`${task.id} deleted`);
    navigate('/work');
  };

  const messageAboutThis = () => {
    store.insert(
      'messages',
      {
        id: newId('msg'),
        sender_id: store.me.id,
        body: `About ${task.id}: `,
        task_ref_id: task.id,
        attachment_url: null,
        song_ref: null,
        promoted_to_type: null,
        promoted_to_id: null,
        created_at: nowIso(),
      },
      store.asMe(),
    );
    navigate('/us');
  };

  const scheduleUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
    `Call re ${task.id}`,
  )}`;

  const linkedNotes = ds.notes.filter((n) => n.task_id === task.id).sort(byCreated);
  const comments = ds.comments.filter((c) => c.task_id === task.id).sort(byCreated);
  const linkedLedger = ds.ledger.filter((l) => l.linked_task_id === task.id);
  const linkedMail = ds.mail_items.filter((m) => m.converted_to_id === task.id);
  const hasConnected = linkedLedger.length > 0 || linkedMail.length > 0;

  return (
    <div className="tpage">
      <MotionConfig reducedMotion="user">
        <motion.div
          className="frame tw"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={entrance}
        >
          <div className="tl-main">
            <p className="crumb">
              <Link to="/work">Work</Link> / {task.id}
            </p>

            <input
              className="tin"
              value={title}
              aria-label="Task title"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />

            <textarea
              className="ta"
              value={desc}
              placeholder="What needs to happen, and why…"
              aria-label="Task description"
              onChange={(e) => setDesc(e.target.value)}
              onBlur={saveDesc}
            />

            <div className="tagrow" style={{ marginTop: 12 }}>
              {task.tags.map((name) => (
                <TagChip key={name} name={name} onRemove={() => removeTag(name)} />
              ))}
              {addingTag ? (
                <input
                  autoFocus
                  className="taginput"
                  value={tagDraft}
                  placeholder="tag name"
                  aria-label="New tag name"
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitTag();
                    }
                    if (e.key === 'Escape') {
                      setTagDraft('');
                      setAddingTag(false);
                    }
                  }}
                  onBlur={commitTag}
                />
              ) : (
                <button type="button" className="tagadd" onClick={() => setAddingTag(true)}>
                  + tag
                </button>
              )}
            </div>

            <div className="ctl">
              <div>
                <label htmlFor="tf-status">Status</label>
                <select
                  id="tf-status"
                  value={task.status}
                  onChange={(e) => setField('status', e.target.value as TaskStatus)}
                >
                  {STATUSES.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="tf-assignee">Assignee</label>
                <select
                  id="tf-assignee"
                  value={task.assignee_id ?? ''}
                  onChange={(e) => setField('assignee_id', e.target.value || null)}
                >
                  <option value="">Unassigned</option>
                  {ds.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="tf-project">Project</label>
                <select
                  id="tf-project"
                  value={task.project_id}
                  onChange={(e) => setField('project_id', e.target.value)}
                >
                  {ds.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="tf-start">Start</label>
                <input
                  id="tf-start"
                  type="date"
                  value={task.start_date ?? ''}
                  onChange={(e) => setField('start_date', e.target.value || null)}
                />
              </div>
              <div>
                <label htmlFor="tf-due">Due</label>
                <input
                  id="tf-due"
                  type="date"
                  value={task.due_date ?? ''}
                  onChange={(e) => setField('due_date', e.target.value || null)}
                />
              </div>
              <div>
                <label htmlFor="tf-okr">Objective</label>
                <select
                  id="tf-okr"
                  value={task.objective_id ?? ''}
                  onChange={(e) => setField('objective_id', e.target.value || null)}
                >
                  <option value="">— none —</option>
                  {ds.objectives.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="wide">
                <label>Priority</label>
                <div className="seg" role="group" aria-label="Priority">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      aria-pressed={task.priority === p.key}
                      onClick={() => setField('priority', p.key as TaskPriority)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="wide">
                <label>Type — decides what this page shows</label>
                <div className="seg" role="group" aria-label="Task type">
                  {TYPES.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      aria-pressed={task.type === t.key}
                      onClick={() => setField('type', t.key as TaskType)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {task.type === 'code_change' && <Screenshots task={task} />}

            {task.type === 'ops' && (
              <section aria-label="Checklist">
                <div className="eyebrow" style={{ marginBottom: 8 }}>
                  Checklist
                </div>
                <Checklist task={task} placeholder="+ Add a step" />
              </section>
            )}
          </div>

          <div className="tside">
            {task.type === 'code_change' && (
              <div className="exportbox">
                <div className="eyebrow" style={{ color: 'var(--indigo)' }}>
                  Code-change task
                </div>
                <p>
                  Pins and criteria are ready. Export builds TASK.md plus screenshots,
                  deterministically — no model in the loop.
                </p>
                <div className="acts">
                  <button type="button" className="btn solid sm" onClick={copyMd}>
                    Copy TASK.md
                  </button>
                  <button type="button" className="btn sm" onClick={downloadZip}>
                    Download .zip
                  </button>
                </div>
              </div>
            )}

            {task.type !== 'ops' && (
              <section>
                <h3>Subtasks</h3>
                <Checklist task={task} placeholder="+ Add subtask" showProgress={false} />
              </section>
            )}

            <section>
              <h3>Notes on this task</h3>
              {linkedNotes.map((n) => (
                <div className="lrow" key={n.id}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b>{n.title}</b>
                    <span className="sn">{(n.body || '').split('\n')[0] || '—'}</span>
                  </span>
                </div>
              ))}
              {!linkedNotes.length && (
                <p className="none" style={{ marginBottom: 9 }}>
                  None yet.
                </p>
              )}
              <input
                className="addin"
                value={noteTitle}
                placeholder="+ Write a note here"
                aria-label="New linked note title"
                onChange={(e) => setNoteTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addNote();
                  }
                }}
                onBlur={addNote}
              />
            </section>

            <section>
              <h3>Thread</h3>
              {comments.map((c) => {
                const author = ds.profiles.find((p) => p.id === c.author_id);
                return (
                  <div className="cmt" key={c.id}>
                    <Avatar userId={c.author_id} />
                    <div>
                      <div className="n">
                        {author?.name ?? '—'}
                        <span className="w">{fmtTime(c.created_at)}</span>
                        {c.is_decision && <span className="dec">DECISION</span>}
                      </div>
                      <p>{c.body}</p>
                    </div>
                  </div>
                );
              })}
              {!comments.length && (
                <p className="none" style={{ marginBottom: 9 }}>
                  No updates yet.
                </p>
              )}
              <div className="composer">
                <textarea
                  value={commentBody}
                  placeholder="Write an update…"
                  aria-label="New comment"
                  onChange={(e) => setCommentBody(e.target.value)}
                />
                <label className="flagline">
                  <input
                    type="checkbox"
                    checked={isDecision}
                    onChange={(e) => setIsDecision(e.target.checked)}
                  />
                  Flag as decision
                </label>
                <button type="button" className="btn sm solid" onClick={submitComment}>
                  Post
                </button>
              </div>
            </section>

            <section>
              <h3>Connected items</h3>
              {linkedLedger.map((l) => (
                <div className="conn" key={l.id}>
                  <span>{l.party}</span>
                  <span className="spacer" />
                  <span className="mono">
                    {l.direction === 'out' ? '−' : '+'}
                    {inr(l.amount)}
                  </span>
                  <span className={`pill ${l.status === 'overdue' ? 'over' : l.status}`}>
                    {l.status}
                  </span>
                </div>
              ))}
              {linkedMail.map((m) => (
                <a
                  className="conn"
                  key={m.id}
                  href={m.gmail_link}
                  target="_blank"
                  rel="noreferrer"
                >
                  <span>{m.subject}</span>
                  <span className="spacer" />
                  <span className="mono" style={{ color: 'var(--mute)' }}>
                    {m.sender}
                  </span>
                </a>
              ))}
              {!hasConnected && <p className="none">Nothing linked yet.</p>}
            </section>

            <div className="sideacts">
              <a
                className="btn"
                href={scheduleUrl}
                target="_blank"
                rel="noreferrer"
              >
                Schedule a call
              </a>
              <button type="button" className="btn" onClick={messageAboutThis}>
                Message about this
              </button>
              <button type="button" className="btn danger" onClick={deleteTask}>
                Delete task
              </button>
            </div>
          </div>
        </motion.div>
      </MotionConfig>
    </div>
  );
}
