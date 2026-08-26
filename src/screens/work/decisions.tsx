import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { Decision } from '../../types';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { Avatar, Modal, SideSheet, useToast } from '../../ui/bits';
import { Attachments } from '../../ui/attachments';
import { ProjectCombo } from '../../ui/pickers';
import { staggerItem, staggerParent } from '../../ui/motion';
import { daysSinceTs, fmtDateTime } from '../../lib/dates';
import { notifyDecisionOwner } from '../../lib/handoff';
import { BarRows, VIZ } from '../../ui/viz';
import { Field, projColor, projName } from './common';

/** A decision open longer than this many days is stale and turns urgent. */
const STALE_DAYS = 7;

export default function DecisionsTab({
  newOpen,
  setNewOpen,
}: {
  newOpen: boolean;
  setNewOpen: (v: boolean) => void;
}) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [ruling, setRuling] = useState<Decision | null>(null);
  const [note, setNote] = useState('');
  const [linking, setLinking] = useState<Decision | null>(null);

  const { open, ruled } = useMemo(() => {
    const o = ds.decisions
      .filter((d) => d.status === 'open')
      .sort((a, b) => a.opened_at.localeCompare(b.opened_at));
    const r = ds.decisions
      .filter((d) => d.status === 'ruled')
      .sort((a, b) => (b.ruled_at ?? '').localeCompare(a.ruled_at ?? ''));
    return { open: o, ruled: r };
  }, [ds.decisions]);

  /** worst-first so an ancient decision is impossible to miss. */
  const ageRows = useMemo(
    () =>
      open
        .map((d) => {
          const days = Math.max(0, daysSinceTs(d.opened_at));
          return { label: d.question, value: days, color: days > STALE_DAYS ? 'var(--rose)' : VIZ.seq };
        })
        .sort((a, b) => b.value - a.value),
    [open],
  );

  const rule = () => {
    if (!ruling) return;
    store.update(
      'decisions',
      ruling.id,
      { status: 'ruled', ruled_at: nowIso(), ruling_note: note.trim() },
      store.asMe(),
    );
    toast('Ruled · trail updated');
    setRuling(null);
    setNote('');
  };

  const remove = (d: Decision) => {
    if (!window.confirm(`Delete "${d.question}"? It moves to Trash and can be restored from Admin → Data.`))
      return;
    store.remove('decisions', d.id, store.asMe({ summary: `Decision deleted — ${d.question}` }));
    toast('Decision deleted');
  };

  return (
    <div>
      {ageRows.length > 0 && (
        <div className="wk-ovpanel" style={{ marginBottom: 14 }}>
          <span className="eyebrow" style={{ display: 'block', marginBottom: 10 }}>
            Days open · worst first
          </span>
          <BarRows rows={ageRows} format={(n) => `${n}d`} />
        </div>
      )}

      <div className="wk-sechead" style={{ marginTop: 0 }}>
        Open · {open.length}
      </div>
      <motion.div {...staggerParent()}>
        {open.map((d) => {
          const days = Math.max(0, daysSinceTs(d.opened_at));
          const stale = days > STALE_DAYS;
          return (
            <motion.div
              key={d.id}
              variants={staggerItem}
              className={`wk-dec${stale ? ' stale' : ''}`}
              style={{ borderLeftColor: projColor(ds, d.project_id) }}
              whileHover={{ y: -3, boxShadow: 'var(--sh2)' }}
            >
              <h4>{d.question}</h4>
              <p>{d.recommendation}</p>
              <DecisionTaskLinks decision={d} onManage={() => setLinking(d)} />
              <div className="wk-decfoot">
                <span
                  className="tagc"
                  style={{ background: 'var(--surf3)', color: projColor(ds, d.project_id) }}
                >
                  {projName(ds, d.project_id)}
                </span>
                <span className={`pill ${stale ? 'over' : 'q'}`}>{days}d open</span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--mute)' }}>
                  opened {fmtDateTime(d.opened_at)}
                </span>
                <OwnerPicker decision={d} />
                <div className="spacer" />
                <button
                  className="btn sm danger"
                  type="button"
                  style={{ minHeight: 44 }}
                  onClick={() => remove(d)}
                >
                  Delete
                </button>
                <button
                  className="btn sm"
                  type="button"
                  style={{ minHeight: 44 }}
                  onClick={() => {
                    setRuling(d);
                    setNote(d.recommendation);
                  }}
                >
                  Rule on it
                </button>
              </div>
            </motion.div>
          );
        })}
      </motion.div>
      {open.length === 0 && <p className="wk-empty">Nothing waiting on a ruling.</p>}

      <div className="wk-sechead">Ruled · {ruled.length}</div>
      <motion.div {...staggerParent()}>
        {ruled.map((d) => (
          <motion.div
            key={d.id}
            variants={staggerItem}
            className="wk-dec ruled"
            style={{ borderLeftColor: projColor(ds, d.project_id) }}
          >
            <h4 style={{ fontSize: 14 }}>{d.question}</h4>
            <p>{d.ruling_note || d.recommendation}</p>
            <DecisionTaskLinks decision={d} onManage={() => setLinking(d)} />
            <div className="wk-decfoot">
              <span
                className="tagc"
                style={{ background: 'var(--surf3)', color: projColor(ds, d.project_id) }}
              >
                {projName(ds, d.project_id)}
              </span>
              <span className="pill ok">ruled</span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--mute)' }}>
                {d.ruled_at ? fmtDateTime(d.ruled_at) : '—'}
              </span>
              <Avatar userId={d.owner_id} size={22} />
              <div className="spacer" />
              <button
                className="btn sm danger"
                type="button"
                style={{ minHeight: 44 }}
                onClick={() => remove(d)}
              >
                Delete
              </button>
            </div>
          </motion.div>
        ))}
      </motion.div>
      {ruled.length === 0 && <p className="wk-empty">No rulings yet.</p>}

      <NewDecisionModal open={newOpen} onClose={() => setNewOpen(false)} />
      <DecisionTasksSheet decision={linking} onClose={() => setLinking(null)} />

      <Modal open={!!ruling} onClose={() => setRuling(null)} title="Rule on it">
        <p style={{ fontSize: 14, color: 'var(--slate)', margin: '0 0 12px' }}>{ruling?.question}</p>
        <Field label="Ruling note">
          <textarea
            className="wk-in"
            value={note}
            autoFocus
            placeholder="What was decided, and the condition to revisit it"
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <div style={{ height: 12 }} />
        <div className="wk-acts">
          <button className="btn" type="button" onClick={() => setRuling(null)}>
            Cancel
          </button>
          <button className="btn solid" type="button" onClick={rule}>
            Record ruling
          </button>
        </div>
      </Modal>
    </div>
  );
}

function NewDecisionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [question, setQuestion] = useState('');
  const [projectId, setProjectId] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [owner, setOwner] = useState(store.meId);
  const [taskIds, setTaskIds] = useState<string[]>([]);

  const submit = () => {
    const q = question.trim() || 'Untitled decision';
    /* decisions.project_id is NOT NULL — see the same guard in board.tsx. */
    if (!projectId) {
      toast('Choose or type a project for this decision');
      return;
    }
    const id = newId('dec');
    store.insert(
      'decisions',
      {
        id,
        question: q,
        project_id: projectId,
        recommendation: recommendation.trim(),
        owner_id: owner,
        status: 'open',
        opened_at: nowIso(),
        ruled_at: null,
        ruling_note: '',
        task_ids: taskIds,
      },
      store.asMe({ summary: `Decision opened — ${q}` }),
    );
    toast('Decision opened');
    setQuestion('');
    setRecommendation('');
    setTaskIds([]);
    onClose();
  };

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title="New decision"
      subtitle="Shared with both of you — options now, the ruling whenever it lands."
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn solid" type="button" onClick={submit}>
            Open decision
          </button>
        </>
      }
    >
      <Field label="Question">
        <input
          className="wk-in"
          value={question}
          autoFocus
          placeholder="What has to be decided"
          onChange={(e) => setQuestion(e.target.value)}
        />
      </Field>
      <div style={{ height: 11 }} />
      <Field label="Recommendation">
        <textarea
          className="wk-in"
          value={recommendation}
          placeholder="The portal's suggestion — you still rule"
          onChange={(e) => setRecommendation(e.target.value)}
        />
      </Field>
      <div style={{ height: 11 }} />
      <div className="wk-ctl">
        <Field label="Project">
          <ProjectCombo className="wk-in" value={projectId} onChange={setProjectId} />
        </Field>
        <Field label="Owner">
          <select className="wk-in" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {store.members.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div style={{ height: 14 }} />
      <Field label="Linked tasks · optional">
        <div className="wk-decision-tasks">
          {ds.tasks
            .filter((task) => task.status !== 'done')
            .slice(0, 40)
            .map((task) => (
              <label key={task.id}>
                <input
                  type="checkbox"
                  checked={taskIds.includes(task.id)}
                  onChange={() =>
                    setTaskIds((ids) =>
                      ids.includes(task.id) ? ids.filter((id) => id !== task.id) : [...ids, task.id],
                    )
                  }
                />
                <span><b className="mono">{task.id}</b> {task.title}</span>
              </label>
            ))}
        </div>
      </Field>
    </SideSheet>
  );
}

function DecisionTaskLinks({ decision, onManage }: { decision: Decision; onManage: () => void }) {
  const ds = useData((d) => d);
  const tasks = (decision.task_ids ?? [])
    .map((id) => ds.tasks.find((task) => task.id === id))
    .filter(Boolean);
  /* Surfaced on the card, not just inside the sheet: a decision with the
     contract attached to it should say so where the decision is read. */
  const files = ds.attachments.filter(
    (a) => a.entity_type === 'decision' && a.entity_id === decision.id,
  ).length;
  return (
    <div className="wk-decision-links">
      {tasks.map((task) => task && (
        <Link key={task.id} to={`/task/${task.id}`} className="tagc">
          <span className="mono">{task.id}</span> · {task.title}
        </Link>
      ))}
      <button type="button" className="btn sm" onClick={onManage}>
        {tasks.length || files ? 'Tasks and files' : 'Link tasks or files'}
        {files ? ` · ${files}` : ''}
      </button>
    </div>
  );
}

function DecisionTasksSheet({ decision, onClose }: { decision: Decision | null; onClose: () => void }) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [query, setQuery] = useState('');
  if (!decision) return null;
  const live = ds.decisions.find((item) => item.id === decision.id) ?? decision;
  const ids = live.task_ids ?? [];
  const q = query.trim().toLowerCase();
  const tasks = ds.tasks
    .filter((task) => !q || task.id.toLowerCase().includes(q) || task.title.toLowerCase().includes(q))
    .slice(0, 60);
  const toggle = (taskId: string) => {
    const next = ids.includes(taskId) ? ids.filter((id) => id !== taskId) : [...ids, taskId];
    store.update(
      'decisions',
      live.id,
      { task_ids: next },
      store.asMe({ summary: `${ids.includes(taskId) ? 'Unlinked' : 'Linked'} ${taskId} ${ids.includes(taskId) ? 'from' : 'to'} decision` }),
    );
    toast(ids.includes(taskId) ? 'Task unlinked' : 'Task linked');
  };
  return (
    <SideSheet
      open
      onClose={onClose}
      title="Tasks and files"
      subtitle={live.question}
      footer={<button type="button" className="btn solid" onClick={onClose}>Done</button>}
    >
      <input
        className="wk-in"
        value={query}
        autoFocus
        placeholder="Find by task ID or title"
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="wk-decision-tasks" style={{ marginTop: 10 }}>
        {tasks.map((task) => (
          <label key={task.id}>
            <input type="checkbox" checked={ids.includes(task.id)} onChange={() => toggle(task.id)} />
            <span><b className="mono">{task.id}</b> {task.title}</span>
          </label>
        ))}
      </div>
      {/* The evidence the ruling rests on — the quote, the contract, the
          comparison sheet — kept with the decision rather than in an inbox. */}
      <div style={{ marginTop: 14 }}>
        <Attachments
          entityType="decision"
          entityId={live.id}
          hint="The quote, the contract, the comparison this was decided on."
        />
      </div>
    </SideSheet>
  );
}

/**
 * Who owns this decision, changeable in place.
 *
 * Assigning a decision was previously a one-shot choice made in the create
 * sheet and never revisitable — which is backwards, because who should rule
 * on something is exactly what changes once you find out what it touches.
 * A ruled decision keeps a plain avatar instead: that is a record of who
 * ruled, not a field.
 *
 * The count of held-up tasks rides along in the notice, so "this is yours"
 * arrives with the reason it matters.
 */
function OwnerPicker({ decision }: { decision: Decision }) {
  const store = useStore();
  const toast = useToast();
  return (
    <label className="wk-dec-owner">
      <Avatar userId={decision.owner_id} size={22} />
      <select
        aria-label={`Who rules on "${decision.question}"`}
        value={decision.owner_id ?? ''}
        onChange={(event) => {
          const next = event.target.value;
          if (next === decision.owner_id) return;
          store.update(
            'decisions',
            decision.id,
            { owner_id: next },
            store.asMe({ summary: `Decision reassigned — ${decision.question}` }),
          );
          notifyDecisionOwner(store, decision.question, next, (decision.task_ids ?? []).length);
          const name = store.members.find((m) => m.id === next)?.name ?? 'them';
          toast(`${name} rules on this one now`);
        }}
      >
        {store.members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
    </label>
  );
}
