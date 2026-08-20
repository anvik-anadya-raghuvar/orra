/**
 * Life next actions and goals.
 *
 * Next actions are still the Work board's personal-project rows: one row,
 * many views. Goals are directions, not a second task database. Each goal says
 * why it matters and what can move next; project/course links only supply
 * progress when that relationship is genuinely useful.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Plus } from 'lucide-react';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { useToast } from '../../ui/bits';
import { ProjectCombo } from '../../ui/pickers';
import { rise, staggerItem, staggerParent } from '../../ui/motion';
import { Ring, VIZ } from '../../ui/viz';
import { daysUntil, fmtDay, todayIso } from '../../lib/dates';
import { myTasks, ownRows } from '../../lib/workspace';
import { goalProgress, goalsFor, nextGoalPosition, progressLabel } from '../../lib/goals';
import type { PersonalGoal, Task } from '../../types';
import { DeleteBtn } from '../../ui/bits';
import { InlineText } from './widgets';
import { DictateField } from '../../ui/dictation';

const NOW_LIMIT = 3;
const GOAL_LABEL_COLORS = ['indigo', 'violet', 'teal', 'amber', 'rose', 'slate'] as const;

function BufferedField({
  value,
  onSave,
  label,
  placeholder,
  maxLength,
  multiline = false,
}: {
  value: string;
  onSave: (value: string) => void;
  label: string;
  placeholder?: string;
  maxLength: number;
  multiline?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next !== value) onSave(next);
  };

  return multiline ? (
    <DictateField label={`Dictate ${label.toLowerCase()}`}>
      <textarea
        className="pin"
        rows={multiline ? 3 : 1}
        maxLength={maxLength}
        value={draft}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
      />
    </DictateField>
  ) : (
    <DictateField label={`Dictate ${label.toLowerCase()}`}>
      <input
        className="pin"
        maxLength={maxLength}
        value={draft}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        }}
      />
    </DictateField>
  );
}

/* ── Next actions — the board's own rows, filtered ────────────────────── */
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
    toast(`${t.id} done — it also closed in Work.`);
  };

  return (
    <div className="pbig">
      <div className="phead">
        <h3>Next actions</h3>
        <Link className="btn sm" to="/work">
          Open Work
        </Link>
      </div>
      <p className="tip" style={{ marginTop: 0 }}>
        Personal-project tasks from Work. Tick one here and the same row closes there.
      </p>
      <motion.div {...staggerParent()}>
        {rows.map((t) => (
          <motion.div className="prow" key={t.id} variants={staggerItem}>
            <button
              className="bxbtn"
              type="button"
              aria-label={`Complete ${t.title}`}
              onClick={() => close(t)}
            >
              <span className="bx" aria-hidden />
            </button>
            <Link to={`/task/${t.id}`} className="ptitle" style={{ flex: 1 }}>
              {t.title}
            </Link>
            {t.due_date && <span className="mono sub">{fmtDay(t.due_date)}</span>}
          </motion.div>
        ))}
        {rows.length === 0 && <p className="tip">Nothing personal needs doing right now.</p>}
      </motion.div>
    </div>
  );
}

/* ── Goal creation ────────────────────────────────────────────────────── */
function GoalComposer({
  goals,
  nowCount,
  onClose,
}: {
  goals: PersonalGoal[];
  nowCount: number;
  onClose: () => void;
}) {
  const store = useStore();
  const meId = useData((_, s) => s.meId);
  const tags = useData((ds) => ds.tags);
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [why, setWhy] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [area, setArea] = useState('');
  const [target, setTarget] = useState('');
  const [focusState, setFocusState] = useState<'now' | 'later'>(nowCount >= NOW_LIMIT ? 'later' : 'now');

  const add = () => {
    const goalTitle = title.trim();
    if (!goalTitle) return;
    if (focusState === 'now' && nowCount >= NOW_LIMIT) {
      toast(`Now already has ${NOW_LIMIT} goals. Move one to Later first.`);
      return;
    }
    store.insert(
      'personal_goals',
      {
        id: newId('goal'),
        user_id: meId,
        title: goalTitle,
        area: area.trim(),
        why: why.trim(),
        next_action: nextAction.trim(),
        focus_state: focusState,
        reviewed_at: nowIso(),
        notes: '',
        target_date: target || null,
        linked_project_id: null,
        linked_course_id: null,
        milestones: [],
        status: 'open',
        position: nextGoalPosition(goals),
        created_at: nowIso(),
      },
      store.asMe({ summary: `Goal added to ${focusState === 'now' ? 'Now' : 'Later'} — ${goalTitle}` }),
    );
    const areaLabel = area.trim();
    if (areaLabel && !tags.some((tag) => tag.name.toLowerCase() === areaLabel.toLowerCase())) {
      store.insert(
        'tags',
        {
          id: newId('tag'),
          name: areaLabel,
          color: GOAL_LABEL_COLORS[tags.length % GOAL_LABEL_COLORS.length],
          created_by: store.meId,
          created_at: nowIso(),
        },
        store.asMe({ summary: `Label created — ${areaLabel}` }),
      );
    }
    toast(focusState === 'now' ? 'Goal is in Now.' : 'Goal saved for Later.');
    onClose();
  };

  return (
    <motion.div className="goal-composer" variants={rise} initial="initial" animate="animate" exit="exit">
      <div className="goal-composer-head">
        <div>
          <span className="eyebrow">New direction</span>
          <h3>What would make the next 90 days meaningfully better?</h3>
        </div>
      </div>
      <label>
        <span>Goal</span>
        <input
          className="pin"
          value={title}
          autoFocus
          maxLength={200}
          placeholder="What do you want to be true?"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        <span>Why now?</span>
        <DictateField label="Dictate why this matters">
          <textarea
            className="pin"
            value={why}
            maxLength={1000}
            rows={2}
            placeholder="Why does this deserve attention in this season?"
            onChange={(e) => setWhy(e.target.value)}
          />
        </DictateField>
      </label>
      <label>
        <span>First next action</span>
        <input
          className="pin"
          value={nextAction}
          maxLength={500}
          placeholder="One concrete thing you can do next"
          onChange={(e) => setNextAction(e.target.value)}
        />
      </label>
      <div className="goal-composer-row">
        <label>
          <span>Area / label <small>optional</small></span>
          <input
            className="pin"
            value={area}
            maxLength={100}
            list="life-label-options"
            placeholder="Health, home, learning…"
            onChange={(e) => setArea(e.target.value)}
          />
          <datalist id="life-label-options">
            {tags.map((tag) => <option key={tag.id} value={tag.name} />)}
          </datalist>
        </label>
        <label>
          <span>Target <small>optional</small></span>
          <input className="pin" type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
      </div>
      <fieldset className="goal-focus-choice">
        <legend>Where should it sit?</legend>
        <button
          type="button"
          aria-pressed={focusState === 'now'}
          disabled={nowCount >= NOW_LIMIT}
          onClick={() => setFocusState('now')}
        >
          <b>Now</b>
          <span>{nowCount}/{NOW_LIMIT} active priorities</span>
        </button>
        <button
          type="button"
          aria-pressed={focusState === 'later'}
          onClick={() => setFocusState('later')}
        >
          <b>Later</b>
          <span>Important, not demanding attention yet</span>
        </button>
      </fieldset>
      <div className="goal-composer-actions">
        <button className="btn solid" type="button" disabled={!title.trim()} onClick={add}>
          Create goal
        </button>
      </div>
    </motion.div>
  );
}

/* ── One goal ─────────────────────────────────────────────────────────── */
function GoalRow({ goal, canPromote }: { goal: PersonalGoal; canPromote: boolean }) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [milestone, setMilestone] = useState('');
  const p = goalProgress(ds, goal);
  const days = goal.target_date ? daysUntil(goal.target_date, todayIso()) : null;
  const courses = ownRows(ds.courses, goal.user_id);

  const patch = (value: Partial<PersonalGoal>, summary: string) =>
    store.update('personal_goals', goal.id, value, store.asMe({ summary }));

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

  const moveFocus = () => {
    const next = (goal.focus_state ?? 'now') === 'now' ? 'later' : 'now';
    if (next === 'now' && !canPromote) {
      toast(`Now is full. Keep no more than ${NOW_LIMIT} active priorities.`);
      return;
    }
    patch({ focus_state: next, reviewed_at: nowIso() }, `Goal moved to ${next === 'now' ? 'Now' : 'Later'} — ${goal.title}`);
  };

  return (
    <motion.article className={`pgoal goal-card${open ? ' open' : ''}`} layout variants={staggerItem}>
      <div className="pgoal-hd">
        <Ring pct={p.pct} size={40} color={VIZ.cat[1]} label={`${p.pct}% — ${progressLabel(p)}`} />
        <span className="pgoal-ttl">
          <InlineText
            value={goal.title}
            label="goal title"
            onSave={(title) => patch({ title }, `Goal renamed — ${title}`)}
          />
          <small className="sub">
            {goal.area && `${goal.area} · `}{progressLabel(p)}
            {days !== null && ` · ${days < 0 ? `${-days}d overdue` : `${days}d left`}`}
          </small>
        </span>
        <button
          type="button"
          className="goal-open"
          aria-expanded={open}
          aria-label={`${open ? 'Close' : 'Open'} ${goal.title}`}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown size={18} strokeWidth={1.8} aria-hidden />
        </button>
      </div>

      {goal.next_action && !open && (
        <p className="goal-next-preview"><span>Next</span>{goal.next_action}</p>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="pgoal-body" variants={rise} initial="initial" animate="animate" exit="exit">
            <div className="goal-fields">
              <label>
                <span>Why now?</span>
                <BufferedField
                  value={goal.why ?? ''}
                  label="Why now"
                  placeholder="Why does this matter in this season?"
                  maxLength={1000}
                  multiline
                  onSave={(why) => patch({ why }, `Goal reason updated — ${goal.title}`)}
                />
              </label>
              <label>
                <span>Next action</span>
                <BufferedField
                  value={goal.next_action ?? ''}
                  label="Next action"
                  placeholder="One concrete thing you can do next"
                  maxLength={500}
                  onSave={(next_action) => patch({ next_action }, `Goal next action updated — ${goal.title}`)}
                />
              </label>
              <div className="goal-field-row">
                <label>
                  <span>Area</span>
                  <BufferedField
                    value={goal.area ?? ''}
                    label="Goal area"
                    placeholder="Optional"
                    maxLength={100}
                    onSave={(area) => patch({ area }, `Goal area updated — ${goal.title}`)}
                  />
                </label>
                <label>
                  <span>Target</span>
                  <input
                    className="pin sm"
                    type="date"
                    value={goal.target_date ?? ''}
                    onChange={(e) => patch({ target_date: e.target.value || null }, `Goal date updated — ${goal.title}`)}
                  />
                </label>
              </div>
            </div>

            <div className="goal-milestones">
              <span className="eyebrow">Milestones</span>
              {goal.milestones.map((m, i) => (
                <div className="prow" key={`${m.text}-${i}`}>
                  <button
                    className="bxbtn"
                    type="button"
                    aria-pressed={m.done}
                    aria-label={`${m.done ? 'Reopen' : 'Complete'} ${m.text}`}
                    onClick={() => toggleMilestone(i)}
                  >
                    <span className={`bx${m.done ? ' on' : ''}`} aria-hidden />
                  </button>
                  <span className={m.done ? 'ptitle done grow' : 'ptitle grow'}>{m.text}</span>
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
                  placeholder="Add a milestone"
                  aria-label="New milestone"
                  onChange={(e) => setMilestone(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    addMilestone();
                  }}
                />
                <button className="btn sm" type="button" onClick={addMilestone}>Add</button>
              </div>
            </div>

            <details className="goal-links">
              <summary>Optional progress link and notes</summary>
              <div className="goal-field-row">
                <label>
                  <span>Project</span>
                  {/* Linking a project clears any course link — a goal
                      measures progress against one or the other, never both. */}
                  <ProjectCombo
                    className="pin sm"
                    allowNone="No project"
                    value={goal.linked_project_id ?? ''}
                    onChange={(id) => patch({ linked_project_id: id || null, linked_course_id: null }, `Goal project link updated — ${goal.title}`)}
                  />
                </label>
                <label>
                  <span>Course</span>
                  <select
                    className="pin sm"
                    value={goal.linked_course_id ?? ''}
                    onChange={(e) => patch({ linked_course_id: e.target.value || null, linked_project_id: null }, `Goal course link updated — ${goal.title}`)}
                  >
                    <option value="">No course</option>
                    {courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
                  </select>
                </label>
              </div>
              <label>
                <span>Notes</span>
                <BufferedField
                  value={goal.notes}
                  label="Goal notes"
                  maxLength={2000}
                  multiline
                  onSave={(notes) => patch({ notes }, `Goal notes updated — ${goal.title}`)}
                />
              </label>
            </details>

            <div className="goal-actions">
              {goal.status === 'open' && (
                <button className="btn sm" type="button" onClick={moveFocus}>
                  Move to {(goal.focus_state ?? 'now') === 'now' ? 'Later' : 'Now'}
                </button>
              )}
              <button
                className="btn sm"
                type="button"
                onClick={() => {
                  patch({ reviewed_at: nowIso() }, `Goal reviewed — ${goal.title}`);
                  toast('Review recorded.');
                }}
              >
                Reviewed today
              </button>
              <div className="spacer" />
              <button
                className="btn sm"
                type="button"
                onClick={() => {
                  const done = goal.status !== 'done';
                  patch({ status: done ? 'done' : 'open', reviewed_at: nowIso() }, `Goal ${done ? 'reached' : 'reopened'} — ${goal.title}`);
                  toast(done ? 'Goal reached.' : 'Goal reopened.');
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
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function GoalSection({
  title,
  hint,
  goals,
  canPromote,
  empty,
}: {
  title: string;
  hint: string;
  goals: PersonalGoal[];
  canPromote: boolean;
  empty: string;
}) {
  return (
    <section className="goal-section">
      <div className="goal-section-head">
        <div>
          <h3>{title}</h3>
          <p>{hint}</p>
        </div>
        <span className="mono">{goals.length}</span>
      </div>
      <motion.div className="goal-list" {...staggerParent()}>
        {goals.map((goal) => <GoalRow key={goal.id} goal={goal} canPromote={canPromote} />)}
        {goals.length === 0 && <p className="goal-empty">{empty}</p>}
      </motion.div>
    </section>
  );
}

export function PersonalGoals({ openComposerToken = 0 }: { openComposerToken?: number }) {
  const ds = useData((d) => d);
  const meId = useData((_, s) => s.meId);
  const [creating, setCreating] = useState(false);
  const goals = useMemo(() => goalsFor(ds, meId), [ds.personal_goals, meId]);
  const now = goals.filter((goal) => goal.status === 'open' && (goal.focus_state ?? 'now') === 'now');
  const later = goals.filter((goal) => goal.status === 'open' && goal.focus_state === 'later');
  const completed = goals.filter((goal) => goal.status === 'done');

  // The Life Today CTA names a creation action, so arriving here from it must
  // open the composer rather than making the person hunt for a second button.
  useEffect(() => {
    if (openComposerToken) setCreating(true);
  }, [openComposerToken]);

  return (
    <div className="pbig goals-workspace">
      <div className="phead goals-head">
        <div>
          <h3>Goals</h3>
          <p>Keep at most three in Now. Everything else can wait without being forgotten.</p>
        </div>
        <button className="btn solid" type="button" onClick={() => setCreating((value) => !value)}>
          <Plus size={15} strokeWidth={2} aria-hidden />
          {creating ? 'Close' : 'New goal'}
        </button>
      </div>

      <AnimatePresence>
        {creating && (
          <GoalComposer goals={goals} nowCount={now.length} onClose={() => setCreating(false)} />
        )}
      </AnimatePresence>

      <div className="goal-sections">
        <GoalSection
          title="Now"
          hint="The few directions that deserve attention in this season."
          goals={now}
          canPromote={now.length < NOW_LIMIT}
          empty="Nothing is demanding your attention yet. Create one direction, not a life backlog."
        />
        <GoalSection
          title="Later"
          hint="Important ideas that are intentionally not active."
          goals={later}
          canPromote={now.length < NOW_LIMIT}
          empty="No goals are waiting in Later."
        />
        {completed.length > 0 && (
          <GoalSection
            title="Completed"
            hint="Directions you have already carried through."
            goals={completed}
            canPromote={now.length < NOW_LIMIT}
            empty=""
          />
        )}
      </div>
    </div>
  );
}
