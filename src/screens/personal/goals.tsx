/**
 * Personal tasks and personal goals.
 *
 * Personal tasks are not a second list: they are the same task rows as the
 * Work board, filtered to personal projects (principle 10). Ticking one here
 * closes it there, and the board is one tap away with the filter already
 * applied.
 *
 * Goals cover the rest of a personal life — the things that are not
 * coursework and not a startup ticket. Their progress is derived, never typed.
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { newId, useData, useStore } from '../../data/store';
import { useToast } from '../../ui/bits';
import { staggerItem, staggerParent } from '../../ui/motion';
import { Ring, VIZ } from '../../ui/viz';
import { daysUntil, fmtDay, todayIso } from '../../lib/dates';
import { myTasks } from '../../lib/workspace';
import { goalProgress, goalsFor, nextGoalPosition, progressLabel } from '../../lib/goals';
import type { PersonalGoal, Task } from '../../types';
import { DeleteBtn, InlineText } from './widgets';

/* ── Personal tasks — the board's own rows, filtered ───────────────────── */
export function PersonalTasks() {
  const ds = useData((d) => d);
  const store = useStore();
  const meId = useData((_, s) => s.meId);
  const toast = useToast();

  const personalProjects = useMemo(
    () => new Set(ds.projects.filter((p) => p.is_personal).map((p) => p.id)),
    [ds.projects],
  );
  const rows = useMemo(
    () =>
      myTasks(ds.tasks, meId)
        .filter((t) => personalProjects.has(t.project_id) && t.status !== 'done')
        .sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999')),
    [ds.tasks, meId, personalProjects],
  );

  const close = (t: Task) => {
    store.update(
      'tasks',
      t.id,
      { status: 'done', progress_pct: 100 },
      store.asMe({ summary: `${t.id} closed from Personal` }),
    );
    toast(`${t.id} done — it moved in your to-dos too.`);
  };

  return (
    <div className="pbig">
      <div className="phead">
        <h3>Personal tasks</h3>
        <Link className="btn sm" to="/work">
          Open to dos
        </Link>
      </div>
      <p className="tip" style={{ marginTop: 0 }}>
        The same tasks as your to-dos, just the personal ones. Tick one here and it closes there.
      </p>
      <motion.div {...staggerParent()}>
        {rows.map((t) => (
          <motion.div className="prow" key={t.id} variants={staggerItem}>
            <button
              className="bxbtn"
              type="button"
              aria-label={`Complete ${t.title}`}
              onClick={() => close(t)}
            />
            <Link to={`/task/${t.id}`} className="ptitle" style={{ flex: 1 }}>
              {t.title}
            </Link>
            {t.due_date && <span className="mono sub">{fmtDay(t.due_date)}</span>}
          </motion.div>
        ))}
        {rows.length === 0 && <p className="tip">Nothing personal open.</p>}
      </motion.div>
    </div>
  );
}

/* ── Personal goals ────────────────────────────────────────────────────── */
function GoalRow({ goal }: { goal: PersonalGoal }) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [milestone, setMilestone] = useState('');
  const p = goalProgress(ds, goal);
  const days = goal.target_date ? daysUntil(goal.target_date, todayIso()) : null;

  const patch = (v: Partial<PersonalGoal>, summary: string) =>
    store.update('personal_goals', goal.id, v, store.asMe({ summary }));

  const toggleMilestone = (i: number) =>
    patch(
      { milestones: goal.milestones.map((m, k) => (k === i ? { ...m, done: !m.done } : m)) },
      `Milestone ${goal.milestones[i].done ? 'reopened' : 'met'} — ${goal.title}`,
    );

  const addMilestone = () => {
    const text = milestone.trim();
    if (!text) return;
    patch({ milestones: [...goal.milestones, { text, done: false }] }, `Milestone added — ${text}`);
    setMilestone('');
  };

  return (
    <motion.div className="pgoal" variants={staggerItem}>
      <div className="pgoal-hd">
        <Ring pct={p.pct} size={34} color={VIZ.cat[1]} label={`${p.pct}% — ${progressLabel(p)}`} />
        <span className="pgoal-ttl">
          <InlineText
            value={goal.title}
            label="goal title"
            onSave={(title) => patch({ title }, `Goal renamed — ${title}`)}
          />
          <small className="sub">
            {progressLabel(p)}
            {days !== null && ` · ${days < 0 ? `${-days}d overdue` : `${days}d left`}`}
          </small>
        </span>
        <button
          type="button"
          className="btn sm"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Close' : 'Open'}
        </button>
      </div>

      {open && (
        <div className="pgoal-body">
          {p.basis === 'project' && (
            <p className="tip" style={{ marginTop: 0 }}>
              Progress follows the linked project — close its tasks and this fills itself in.
            </p>
          )}
          {p.basis === 'course' && (
            <p className="tip" style={{ marginTop: 0 }}>
              Progress follows the linked course.
            </p>
          )}
          {goal.milestones.map((m, i) => (
            <div className="prow" key={`${m.text}-${i}`}>
              <button
                className="bxbtn"
                type="button"
                aria-pressed={m.done}
                aria-label={`${m.done ? 'Reopen' : 'Complete'} ${m.text}`}
                onClick={() => toggleMilestone(i)}
                data-done={m.done ? '' : undefined}
              />
              <span className={m.done ? 'ptitle done' : 'ptitle'}>{m.text}</span>
              <DeleteBtn
                label={m.text}
                onConfirm={() =>
                  patch(
                    { milestones: goal.milestones.filter((_, k) => k !== i) },
                    `Milestone removed — ${m.text}`,
                  )
                }
              />
            </div>
          ))}
          <div className="pform">
            <input
              className="addin"
              value={milestone}
              placeholder="+ Add a milestone"
              aria-label="New milestone"
              onChange={(e) => setMilestone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                addMilestone();
              }}
            />
            <button className="btn sm" type="button" onClick={addMilestone}>
              Add
            </button>
          </div>
          <div className="pform">
            <label className="sub" htmlFor={`goal-date-${goal.id}`}>
              Target
            </label>
            <input
              id={`goal-date-${goal.id}`}
              className="pin sm"
              type="date"
              value={goal.target_date ?? ''}
              onChange={(e) => patch({ target_date: e.target.value || null }, 'Goal date set')}
            />
            <div className="spacer" />
            <button
              className="btn sm"
              type="button"
              onClick={() => {
                patch(
                  { status: goal.status === 'done' ? 'open' : 'done' },
                  `Goal ${goal.status === 'done' ? 'reopened' : 'reached'} — ${goal.title}`,
                );
                toast(goal.status === 'done' ? 'Reopened' : 'Goal reached.');
              }}
            >
              {goal.status === 'done' ? 'Reopen' : 'Mark reached'}
            </button>
            <DeleteBtn
              label={goal.title}
              onConfirm={() => {
                store.remove('personal_goals', goal.id, store.asMe({ summary: `Goal removed — ${goal.title}` }));
                toast('Goal removed');
              }}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}

export function PersonalGoals() {
  const ds = useData((d) => d);
  const store = useStore();
  const meId = useData((_, s) => s.meId);
  const toast = useToast();
  const [title, setTitle] = useState('');
  const goals = useMemo(() => goalsFor(ds, meId), [ds.personal_goals, meId]);

  const add = () => {
    const t = title.trim();
    if (!t) return;
    store.insert(
      'personal_goals',
      {
        id: newId('goal'),
        user_id: meId,
        title: t,
        notes: '',
        target_date: null,
        linked_project_id: null,
        linked_course_id: null,
        milestones: [],
        status: 'open',
        position: nextGoalPosition(goals),
        created_at: new Date().toISOString(),
      },
      store.asMe({ summary: `Goal added — ${t}` }),
    );
    setTitle('');
    toast('Goal added');
  };

  return (
    <div className="pbig">
      <div className="phead">
        <h3>Goals</h3>
        <span className="mono sub">{goals.filter((g) => g.status === 'open').length} open</span>
      </div>
      <p className="tip" style={{ marginTop: 0 }}>
        Yours, not the company&apos;s. Link one to a project or a course and its progress fills
        itself in; otherwise tick the milestones.
      </p>
      <motion.div {...staggerParent()}>
        {goals.map((g) => (
          <GoalRow key={g.id} goal={g} />
        ))}
        {goals.length === 0 && <p className="tip">Nothing set yet.</p>}
      </motion.div>
      <div className="pform">
        <input
          className="addin"
          value={title}
          placeholder="+ A goal for yourself"
          aria-label="New goal"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            add();
          }}
        />
        <button className="btn sm solid" type="button" onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}
