import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { newId, nowIso, useData, useDataset, useStore } from '../../data/store';
import { Avatar, TagChip, useToast } from '../../ui/bits';
import { entrance, micro } from '../../ui/motion';
import { generateTaskExport, exportTaskZip } from '../../lib/exportTask';
import { fmtDay, fmtTime, inr, todayIso } from '../../lib/dates';
import { notifyAssignment, notifyMention } from '../../lib/handoff';
import { mentionedIds } from '../../lib/mentions';
import { taskProgressPct, toggleChecklistLine } from '../../lib/checklist';
import { blockingDecisions } from '../../lib/blocking';
import { addedAssignees, assigneePatch, projectPatch, taskAssignees, taskProjects, taskTypes, typePatch } from '../../lib/taskFacets';
import { MAX_REPEAT_EVERY, REPEAT_UNITS, describeRepeat, normalizeRepeat } from '../../lib/repeat';
import { spawnNextOccurrence } from '../../lib/repeatActions';
import { intentionRowForTask, intentionsFor } from '../../lib/dayPlan';
import { stripInlineImageMarkers } from '../../ui/inlineImages';
import { PRIORITIES, STATUSES, typeLabel } from '../work/common';
import { ProjectCombo, TypeCombo } from '../../ui/pickers';
import Checklist from './Checklist';
import Screenshots from './Screenshots';
import { Attachments } from '../../ui/attachments';
import { BriefChecklist } from '../../ui/BriefChecklist';
import { MentionPicker } from '../../ui/MentionPicker';
import { FacetChips, FacetToggles } from '../../ui/FacetPicker';
import { FormattedText } from '../../ui/richText';
import Timeline from './Timeline';
import type { Task, TaskPriority, TaskStatus } from '../../types';
import { DictateField } from '../../ui/dictation';
import './task.css';

/** Tags stay centrally managed — new tag names rotate through this palette
 *  rather than being hard-coded per task (principle 7). */
const TAG_COLORS = ['indigo', 'teal', 'stamp', 'rose', 'sky', 'violet'];

/** The task page's two views. Both are the same row (principle 10) — one shows
 *  its current state, the other everything that ever happened to it. */
type TaskTab = 'task' | 'workflow';

const TABS: { key: TaskTab; label: string }[] = [
  { key: 'task', label: 'Task' },
  { key: 'workflow', label: 'Workflow' },
];

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
  const commentRef = useRef<HTMLTextAreaElement>(null);
  /** Which half of the page is showing. The Workflow trail used to sit at the
   *  bottom of the sidebar, below six other sections — findable only by
   *  scrolling past everything. It is a view of the task, not an aside to it. */
  const [tab, setTab] = useState<TaskTab>('task');
  /* Needed up here, not with the other derived lists further down: the
     brief's tick boxes and these rows are counted as one checklist, so
     saving a tick needs both halves in hand. */
  const subtasks = ds.subtasks.filter((s) => s.task_id === task.id);
  const blockers = blockingDecisions(ds.decisions, task.id);

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

  const saveDesc = (value = desc) => {
    if (value !== task.description) {
      store.update(
        'tasks',
        task.id,
        { description: value },
        store.asMe({ summary: `Description updated on ${task.id}` }),
      );
      /* Tagging someone in the brief has to reach them exactly like tagging
         them in the thread does, or the toolbar's @ control is a decoration
         in the one place people actually write the context. Diffed against
         what the brief already said, so re-saving after a typo fix does not
         ring the bell again. */
      const fresh = mentionedIds(value).filter((id) => !mentionedIds(task.description).includes(id));
      if (fresh.length) notifyMention(store, value, `in the brief on ${task.id}`, task.id);
    }
  };

  /**
   * Tick one of the brief's boxes.
   *
   * The description and the percentage move in one update, not two: the
   * board card reads `progress_pct`, and a card that briefly disagreed with
   * the task page is the kind of thing you only notice as "the board is
   * lying". `taskProgressPct` counts the brief's boxes and the subtask rows
   * together — the same claim made in two places.
   */
  const toggleBriefStep = (line: number) => {
    const next = toggleChecklistLine(desc, line);
    setDesc(next);
    const pct = taskProgressPct(next, subtasks);
    store.update(
      'tasks',
      task.id,
      pct === null ? { description: next } : { description: next, progress_pct: pct },
      store.asMe({ summary: `Step ticked on ${task.id}` }),
    );
  };

  /**
   * Facet writers. Each goes through lib/taskFacets so the primary and its
   * list are written in one update and can never disagree — the invariant
   * 0045 refuses to half-apply on.
   */
  const saveProjects = (ids: string[]) =>
    store.update(
      'tasks',
      task.id,
      projectPatch(ids, task.project_id),
      store.asMe({ summary: `Projects changed on ${task.id}` }),
    );

  const saveTypes = (values: string[]) =>
    store.update(
      'tasks',
      task.id,
      typePatch(values, task.type),
      store.asMe({ summary: `Types changed on ${task.id}` }),
    );

  /* Notices are per person: adding Raghuvar to a task Anadya already had
     tells Raghuvar and says nothing to Anadya, and re-saving the same pair
     says nothing at all. */
  const saveAssignees = (ids: string[]) => {
    const patch = assigneePatch(ids);
    store.update('tasks', task.id, patch, store.asMe({ summary: `Assignees changed on ${task.id}` }));
    for (const id of addedAssignees(task, patch)) notifyAssignment(store, task, id);
  };

  const setField = <K extends keyof Task>(field: K, value: Task[K]) => {
    store.update('tasks', task.id, { [field]: value } as Partial<Task>, store.asMe());
    // Reassignment moves this task to the other workspace — announce it.
    if (field === 'assignee_id') {
      notifyAssignment(store, task, value as Task['assignee_id']);
    }
    // Finishing a repeating task creates the next one as a new row, named and
    // dated in a toast. Guarded on the transition so re-picking 'done' on an
    // already-done task cannot mint a second successor.
    if (field === 'status' && value === 'done' && task.status !== 'done') {
      const next = spawnNextOccurrence(store, task);
      if (next) toast(`Next one created — ${next.id}, due ${fmtDay(next.due_date!)}`);
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
      a.download = `${task.id}-context.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(`${task.id} context folder downloaded`);
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
      store.asMe({ summary: `Scribble linked to ${task.id}: ${t}` }),
    );
    setNoteTitle('');
  };

  const submitComment = () => {
    const body = commentBody.trim();
    if (!body) {
      toast('Write something before posting');
      return;
    }
    const decisionId = isDecision ? newId('dec') : null;
    if (decisionId) {
      store.insert(
        'decisions',
        {
          id: decisionId,
          question: body,
          project_id: task.project_id,
          recommendation: body,
          owner_id: store.me.id,
          status: 'open',
          opened_at: nowIso(),
          ruled_at: null,
          ruling_note: '',
          task_ids: [task.id],
        },
        store.asMe({ summary: `Decision opened from ${task.id}` }),
      );
    }
    store.insert(
      'comments',
      {
        id: newId('c'),
        task_id: task.id,
        author_id: store.me.id,
        body,
        is_decision: isDecision,
        decision_id: decisionId,
        created_at: nowIso(),
      },
      store.asMe({
        summary: isDecision ? `Decision recorded on ${task.id}` : `Comment added to ${task.id}`,
      }),
    );
    // After the comment exists, so the bell never points at a row that is not
    // there yet. Silent when nobody but you was tagged.
    notifyMention(store, body, `in the thread on ${task.id}`, task.id);
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

  /* Pulling a task onto today's list is the bridge between "this exists" and
     "this is what I am doing today" — the two used to be unconnected. */
  const todayIntentions = intentionsFor(ds, store.meId, todayIso());
  const onToday = todayIntentions.some((i) => i.task_id === task.id);
  const addToToday = () => {
    const row = intentionRowForTask(todayIntentions, {
      id: newId('dpi'),
      userId: store.meId,
      date: todayIso(),
      task: task,
    });
    if (!row) return;
    store.insert('day_plan_items', row, store.asMe({ summary: `${task.id} added to today's intentions` }));
    toast('Added to today’s intentions');
  };

  const linkedNotes = ds.notes.filter((n) => n.task_id === task.id).sort(byCreated);
  const comments = ds.comments.filter((c) => c.task_id === task.id).sort(byCreated);
  const linkedDecisions = ds.decisions.filter((decision) => (decision.task_ids ?? []).includes(task.id));
  const linkedLedger = ds.ledger.filter((l) => l.linked_task_id === task.id);
  const linkedMail = ds.mail_items.filter((m) => m.converted_to_id === task.id);
  const hasConnected = linkedLedger.length > 0 || linkedMail.length > 0;

  return (
    <div className="tpage">
      <MotionConfig reducedMotion="user">
        <motion.div
          className="frame"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={entrance}
        >
          <div className="thead">
            <p className="crumb">
              <Link to="/work">Work</Link> / {task.id}
            </p>
            <div className="sub2" role="tablist" aria-label="Task views">
              {TABS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  id={`tk-tab-${key}`}
                  aria-controls={`tk-panel-${key}`}
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* mode="wait" so one panel is gone before the next rises — a
              cross-fade of two full-height columns reads as a flicker.
              MotionConfig reducedMotion="user" above turns both into cuts. */}
          <AnimatePresence mode="wait" initial={false}>
            {tab === 'task' ? (
              <motion.div
                key="task"
                className="tw"
                id="tk-panel-task"
                role="tabpanel"
                aria-labelledby="tk-tab-task"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: entrance }}
                exit={{ opacity: 0, y: -6, transition: micro }}
              >
            <div className="tl-main">
              <DictateField label="Dictate the task title" className="tin-wrap">
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
              </DictateField>

              {/* Derived from the decision rows, never written onto the task
                  — so ruling one releases every task it held at once. The
                  banner is above the brief because "you cannot move this yet"
                  has to be read before the work is, not after. */}
              {blockers.length > 0 && (
                <div className="tk-blocked" role="status">
                  <span className="tk-blocked-tag">Blocked</span>
                  <div>
                    {blockers.map((decision) => (
                      <p key={decision.id}>
                        Waiting on{' '}
                        <b>{ds.profiles.find((p) => p.id === decision.owner_id)?.name ?? 'someone'}</b>{' '}
                        to rule: {decision.question}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <Screenshots
                task={task}
                description={desc}
                onDescriptionChange={setDesc}
                onDescriptionCommit={saveDesc}
              />

              <BriefChecklist text={desc} onToggle={toggleBriefStep} />

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
                <div className="wide">
                  <label>Assignees</label>
                  <FacetToggles
                    label="assignees"
                    options={store.members}
                    values={taskAssignees(task)}
                    onChange={saveAssignees}
                  />
                </div>
                <div className="wide">
                  <label htmlFor="tf-project">Projects</label>
                  <FacetChips
                    label="projects"
                    values={taskProjects(task)}
                    onChange={saveProjects}
                    color={(id) => ds.projects.find((p) => p.id === id)?.color}
                    render={(id) => ds.projects.find((p) => p.id === id)?.name ?? id}
                  />
                  {/* The combo adds rather than replaces, so it always opens
                      empty -- a value in it would read as "the project", which
                      is exactly the singular this field stopped being. */}
                  <ProjectCombo
                    id="tf-project"
                    value=""
                    placeholder="Add a project, or type a new one"
                    onChange={(id) => id && saveProjects([...taskProjects(task), id])}
                  />
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
                  {/* Marking this done creates the next one as a new row and
                      names it — this task's dates never move (principle 3). */}
                  <label htmlFor="tf-repeat">Repeats — {describeRepeat(task.repeat).toLowerCase()}</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      id="tf-repeat"
                      value={task.repeat?.every ?? 0}
                      onChange={(e) => {
                        const every = Number(e.target.value);
                        setField('repeat', every ? normalizeRepeat({ every, unit: task.repeat?.unit ?? 'week' }) : null);
                      }}
                    >
                      <option value={0}>Never</option>
                      {Array.from({ length: MAX_REPEAT_EVERY }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          Every {n === 1 ? '' : `${n} `}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Repeat unit"
                      value={task.repeat?.unit ?? 'week'}
                      disabled={!task.repeat}
                      onChange={(e) =>
                        setField('repeat', normalizeRepeat({ every: task.repeat?.every ?? 1, unit: e.target.value as 'day' | 'week' | 'month' }))
                      }
                    >
                      {REPEAT_UNITS.map((unit) => (
                        <option key={unit} value={unit}>
                          {task.repeat?.every === 1 ? unit : `${unit}s`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="wide">
                  <label>Priority</label>
                  <div className="seg" role="group" aria-label="Priority">
                    {PRIORITIES.map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        aria-pressed={task.priority === p.key}
                        aria-label={`${p.label} — ${p.hint}`}
                        title={p.hint}
                        onClick={() => setField('priority', p.key as TaskPriority)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="wide">
                  <label htmlFor="tf-type">Types — the first one decides which panels render below</label>
                  {/* Through typeLabel, like the board card and the filter
                      chips. Rendering the raw value here made one stored type
                      read "pre launch" on this page and "Pre Launch" on the
                      board -- the same split-in-two confusion 0046 just fixed
                      in the data. */}
                  <FacetChips
                    label="types"
                    values={taskTypes(task)}
                    onChange={saveTypes}
                    render={(value) => typeLabel(value)}
                  />
                  <TypeCombo
                    id="tf-type"
                    value=""
                    placeholder="Add a type, or type a new one"
                    onChange={(t) => t && saveTypes([...taskTypes(task), t])}
                  />
                </div>
              </div>

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
              {/* The generator has never cared about the type — it writes
                  `Task type: ...` into TASK.md and walks whatever evidence and
                  criteria exist. Gating the button on code_change only meant a
                  research task could hold pinned screenshots that nothing could
                  ever export, which is the one thing this app is built to do. */}
              {(
                <div className="exportbox">
                  <div className="eyebrow" style={{ color: 'var(--indigo)' }}>
                    {task.type === 'code_change' ? 'Code-change task' : 'Export'}
                  </div>
                  <p>
                    {task.type === 'code_change'
                      ? 'A ready-to-use context folder: TASK.md, CONTEXT.json, marked screenshots, and clean originals. Pin numbers follow the order you added them across every image.'
                      : 'Build a context folder with TASK.md, CONTEXT.json, and any marked screenshots — deterministic, with no model in the loop.'}
                  </p>
                  <div className="acts">
                    <button type="button" className="btn solid sm" onClick={copyMd}>
                      Copy TASK.md
                    </button>
                    <button type="button" className="btn sm" onClick={downloadZip}>
                      Download context folder
                    </button>
                  </div>
                </div>
              )}

              {/* Screenshots above are evidence inside the brief and carry
                  pins; this is the general case — the spec PDF, the client's
                  spreadsheet, the signed scope. Attaching one saves it there
                  and then, with no separate Save. */}
              <section aria-label="Files on this task">
                <h3>Files</h3>
                <Attachments
                  entityType="task"
                  entityId={task.id}
                  hint="The brief, the spreadsheet, the signed scope — anything this task needs to be worked from."
                />
              </section>

              {task.type !== 'ops' && (
                <section>
                  <h3>Subtasks</h3>
                  <Checklist task={task} placeholder="+ Add subtask" showProgress={false} />
                </section>
              )}

              <section>
                <h3>Decisions</h3>
                <p className="none" style={{ marginBottom: 9 }}>
                  These are the same decision rows shown in Work → Decisions.
                </p>
                <div className="task-decision-list">
                  {ds.decisions.map((decision) => {
                    const linked = (decision.task_ids ?? []).includes(task.id);
                    return (
                      <label key={decision.id}>
                        <input
                          type="checkbox"
                          checked={linked}
                          onChange={() =>
                            store.update(
                              'decisions',
                              decision.id,
                              {
                                task_ids: linked
                                  ? (decision.task_ids ?? []).filter((id) => id !== task.id)
                                  : [...(decision.task_ids ?? []), task.id],
                              },
                              store.asMe({ summary: `${linked ? 'Unlinked' : 'Linked'} ${task.id} ${linked ? 'from' : 'to'} decision` }),
                            )
                          }
                        />
                        <span>
                          <b>{decision.question}</b>
                          <small>{decision.status}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {!linkedDecisions.length && !ds.decisions.length && <p className="none">No decisions yet.</p>}
              </section>

              <section>
                <h3>Scribbles on this task</h3>
                {linkedNotes.map((n) => (
                  <div className="lrow" key={n.id}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <b>{n.title}</b>
                      <span className="sn">{stripInlineImageMarkers(n.body || '').split('\n')[0] || '—'}</span>
                    </span>
                  </div>
                ))}
                {!linkedNotes.length && (
                  <p className="none" style={{ marginBottom: 9 }}>
                    None yet.
                  </p>
                )}
                <DictateField label="Dictate a scribble title">
                  <input
                    className="addin"
                    value={noteTitle}
                    placeholder="+ Write a scribble here"
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
                </DictateField>
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
                        {/* Was a bare <p>{c.body}</p>, which rendered a tag as
                            the raw `[[person:…]]` token. Same renderer the
                            notes and the wiki use, so a mention, a link and a
                            tick box all read the same wherever they appear. */}
                        <FormattedText text={c.body} />
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
                  <DictateField label="Dictate this update">
                    <textarea
                      ref={commentRef}
                      value={commentBody}
                      placeholder="Write an update…"
                      aria-label="New comment"
                      onChange={(e) => setCommentBody(e.target.value)}
                    />
                  </DictateField>
                  <div className="composer-tools">
                    <MentionPicker
                      textarea={commentRef}
                      value={commentBody}
                      onValue={(next) => setCommentBody(next)}
                      label="Tag someone in this update"
                    />
                    <label className="flagline">
                      <input
                        type="checkbox"
                        checked={isDecision}
                        onChange={(e) => setIsDecision(e.target.checked)}
                      />
                      Flag as decision
                    </label>
                  </div>
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
                <button type="button" className="btn solid" onClick={addToToday} disabled={onToday}>
                  {onToday ? 'On today’s list' : 'Add to today’s intentions'}
                </button>
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
            ) : (
              <motion.div
                key="workflow"
                className="tflow"
                id="tk-panel-workflow"
                role="tabpanel"
                aria-labelledby="tk-tab-workflow"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: entrance }}
                exit={{ opacity: 0, y: -6, transition: micro }}
              >
                <Timeline taskId={task.id} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </MotionConfig>
    </div>
  );
}
