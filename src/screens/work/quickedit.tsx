import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { Task, TaskLinkType, TaskPriority, TaskStatus } from '../../types';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { SideSheet, TagChip, useToast } from '../../ui/bits';
import { micro } from '../../ui/motion';
import { notifyAssignment } from '../../lib/handoff';
import { wouldCycle } from '../../lib/schedule';
import {
  Field,
  LINK_TYPES,
  PRIORITIES,
  STATUSES,
  Segment,
  WORK_TAG_COLORS,
  linkLabel,
  liveSprints,
  linkExists,
  statusLabel,
} from './common';

/** How many task options the link picker offers at once — a 500-task dataset
 *  must never mount 500 <option> nodes just to add one link. */
const LINK_PICK_LIMIT = 40;

/**
 * The fast path for editing a card. Deliberately a subset of /task/:id —
 * the full page still owns subtasks, comments, screenshots and the export.
 */
export default function QuickEdit({
  task,
  onClose,
}: {
  task: Task | null;
  onClose: () => void;
}) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();

  // Draft is keyed on the task id so opening a different card re-seeds it.
  const [seed, setSeed] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [assignee, setAssignee] = useState<string>('');
  const [due, setDue] = useState('');
  const [sprintId, setSprintId] = useState<string>('');
  const [tagDraft, setTagDraft] = useState('');
  const [linkType, setLinkType] = useState<TaskLinkType>('blocks');
  const [linkQuery, setLinkQuery] = useState('');
  const [linkTarget, setLinkTarget] = useState('');

  if (task && seed !== task.id) {
    setSeed(task.id);
    setTitle(task.title);
    setDescription(task.description);
    setPriority(task.priority);
    setStatus(task.status);
    setAssignee(task.assignee_id ?? '');
    setDue(task.due_date ?? '');
    setSprintId(task.sprint_id ?? '');
    setTagDraft('');
    setLinkQuery('');
    setLinkTarget('');
  }

  // Live row, so an edit made elsewhere (or by the other person) shows here.
  const live = useData((d) => d.tasks.find((t) => t.id === task?.id)) ?? null;

  const links = useMemo(
    () =>
      live
        ? ds.task_links
            .filter((l) => l.from_task_id === live.id || l.to_task_id === live.id)
            .map((l) => ({
              link: l,
              outgoing: l.from_task_id === live.id,
              otherId: l.from_task_id === live.id ? l.to_task_id : l.from_task_id,
            }))
        : [],
    [ds.task_links, live],
  );

  const candidates = useMemo(() => {
    if (!live) return [];
    const q = linkQuery.trim().toLowerCase();
    return ds.tasks
      .filter((t) => t.id !== live.id)
      .filter((t) => !q || t.id.toLowerCase().includes(q) || t.title.toLowerCase().includes(q))
      .slice(0, LINK_PICK_LIMIT);
  }, [ds.tasks, live, linkQuery]);

  if (!live) return null;

  const save = () => {
    const clean = title.trim() || live.title;
    const patch: Partial<Task> = {};
    if (clean !== live.title) patch.title = clean;
    if (description !== live.description) patch.description = description;
    if (priority !== live.priority) patch.priority = priority;
    if (status !== live.status) {
      patch.status = status;
      if (status === 'done') patch.progress_pct = 100;
    }
    if ((assignee || null) !== live.assignee_id) patch.assignee_id = assignee || null;
    if ((due || null) !== live.due_date) patch.due_date = due || null;
    if ((sprintId || null) !== live.sprint_id) patch.sprint_id = sprintId || null;
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    store.update('tasks', live.id, patch, store.asMe());
    // A handed-off task leaves this board entirely, so it has to announce
    // itself rather than just vanishing from one side and appearing on the other.
    if (patch.assignee_id !== undefined) {
      notifyAssignment(store, { ...live, ...patch }, patch.assignee_id);
    }
    toast(`${live.id} updated`);
    onClose();
  };

  const commitTag = () => {
    const name = tagDraft.trim();
    setTagDraft('');
    if (!name) return;
    if (!live.tags.includes(name)) {
      store.update(
        'tasks',
        live.id,
        { tags: [...live.tags, name] },
        store.asMe({ summary: `Tag added to ${live.id}: ${name}` }),
      );
    }
    // Free-form: a label nobody has used yet becomes a real tag row.
    if (!ds.tags.some((t) => t.name === name)) {
      const color = WORK_TAG_COLORS[ds.tags.length % WORK_TAG_COLORS.length];
      store.insert(
        'tags',
        { id: newId('tag'), name, color, created_by: store.meId, created_at: nowIso() },
        store.asMe({ summary: `Tag created: ${name}` }),
      );
    }
  };

  const removeTag = (name: string) =>
    store.update(
      'tasks',
      live.id,
      { tags: live.tags.filter((t) => t !== name) },
      store.asMe({ summary: `Tag removed from ${live.id}: ${name}` }),
    );

  const addLink = () => {
    if (!linkTarget || linkTarget === live.id) return;
    // Catches the reverse spelling too: "A relates to B" and "B relates to A"
    // are one fact, as are "A blocks B" and "B is blocked by A".
    if (linkExists(ds.task_links, live.id, linkTarget, linkType)) {
      toast('That relationship is already recorded');
      return;
    }
    // A loop makes the chain unschedulable, so it is refused here rather than
    // discovered later by the reflow.
    if (linkType === 'blocks' || linkType === 'blocked_by') {
      const [from, to] =
        linkType === 'blocks' ? [live.id, linkTarget] : [linkTarget, live.id];
      if (wouldCycle(ds.task_links, from, to)) {
        toast(`That would create a loop — ${to} already leads back to ${from}.`);
        return;
      }
    }
    store.insert(
      'task_links',
      {
        id: newId('tl'),
        from_task_id: live.id,
        to_task_id: linkTarget,
        type: linkType,
        created_by: store.meId,
        created_at: nowIso(),
      },
      store.asMe({ summary: `${live.id} ${linkLabel(linkType, true)} ${linkTarget}` }),
    );
    setLinkTarget('');
    toast('Link added');
  };

  const removeLink = (id: string, summary: string) => {
    store.remove('task_links', id, store.asMe({ summary: `Link removed — ${summary}` }));
    toast('Link removed');
  };

  const deleteTask = () => {
    if (!window.confirm(`Delete ${live.id} — "${live.title}"? It moves to Trash and can be restored from Admin → Data.`))
      return;
    store.remove('tasks', live.id, store.asMe({ summary: `Task deleted — ${live.title}` }));
    toast(`${live.id} deleted`);
    onClose();
  };

  return (
    <SideSheet
      open
      onClose={onClose}
      title={`Quick edit · ${live.id}`}
      subtitle="The fast path — subtasks, comments, screenshots and the export live on the full task page."
      footer={
        <>
          <Link className="btn" to={`/task/${live.id}`} onClick={onClose}>
            Open full task →
          </Link>
          <button className="btn danger" type="button" onClick={deleteTask}>
            Delete
          </button>
          <div className="spacer" />
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn solid" type="button" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <Field label="Title">
        <input
          className="wk-in"
          value={title}
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <div style={{ height: 11 }} />
      <Field label="Description">
        <textarea
          className="wk-in"
          value={description}
          placeholder="Context, and why it matters"
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div style={{ height: 11 }} />
      <div className="wk-ctl">
        <Field label="Priority">
          <Segment value={priority} onChange={setPriority} options={PRIORITIES} label="Priority" />
        </Field>
        <Field label="Status">
          <select
            className="wk-in"
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
          >
            {STATUSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Assignee">
          <select className="wk-in" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Unassigned</option>
            {store.members.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Due date">
          <input className="wk-in" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <Field label="Sprint">
          <select className="wk-in" value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
            <option value="">Backlog (no sprint)</option>
            {liveSprints(ds).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            {ds.sprints
              .filter((s) => s.is_archived)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (archived)
                </option>
              ))}
          </select>
        </Field>
      </div>

      {/* labels — free-form, never a fixed list */}
      <span className="wk-lbl">Labels</span>
      <div className="wk-meta" style={{ marginBottom: 10 }}>
        {live.tags.map((name) => (
          <TagChip key={name} name={name} onRemove={() => removeTag(name)} />
        ))}
        {live.tags.length === 0 && <span className="tip" style={{ margin: 0 }}>None yet.</span>}
      </div>
      <div className="wk-inline">
        <input
          className="wk-in"
          value={tagDraft}
          placeholder="Add a label and press Enter"
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitTag();
            }
          }}
        />
        <button className="btn sm" type="button" onClick={commitTag}>
          Add
        </button>
      </div>

      {/* links */}
      <span className="wk-lbl" style={{ marginTop: 16 }}>
        Links
      </span>
      <div style={{ marginBottom: 10 }}>
        {links.length === 0 && (
          <p className="tip" style={{ margin: 0 }}>
            Nothing linked yet.
          </p>
        )}
        {links.map(({ link, outgoing, otherId }) => {
          const other = ds.tasks.find((t) => t.id === otherId);
          const phrase = `${live.id} ${linkLabel(link.type, outgoing)} ${otherId}`;
          return (
            <motion.div
              key={link.id}
              className="wk-link"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: micro }}
            >
              <span className="wk-linkrel">{linkLabel(link.type, outgoing)}</span>
              <Link to={`/task/${otherId}`} onClick={onClose}>
                <span className="mono">{otherId}</span> · {other?.title ?? 'unknown task'}
              </Link>
              <button
                type="button"
                className="wk-linkx"
                aria-label={`Remove link: ${phrase}`}
                onClick={() => removeLink(link.id, phrase)}
              >
                <X size={16} strokeWidth={2} />
              </button>
            </motion.div>
          );
        })}
      </div>
      <div className="wk-ctl">
        <Field label="Relationship">
          <select
            className="wk-in"
            value={linkType}
            onChange={(e) => setLinkType(e.target.value as TaskLinkType)}
          >
            {LINK_TYPES.map((l) => (
              <option key={l.key} value={l.key}>
                {live.id} {l.label} …
              </option>
            ))}
          </select>
        </Field>
        <Field label="Find a task">
          <input
            className="wk-in"
            value={linkQuery}
            placeholder="Filter by id or title"
            onChange={(e) => setLinkQuery(e.target.value)}
          />
        </Field>
      </div>
      <div className="wk-inline">
        <select
          className="wk-in"
          value={linkTarget}
          aria-label="Link target task"
          onChange={(e) => setLinkTarget(e.target.value)}
        >
          <option value="">Pick a task…</option>
          {candidates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id} · {t.title}
            </option>
          ))}
        </select>
        <button className="btn sm" type="button" disabled={!linkTarget} onClick={addLink}>
          Link
        </button>
      </div>

      <p className="tip" style={{ marginTop: 14 }}>
        Currently {statusLabel(live.status)}.
      </p>
    </SideSheet>
  );
}
