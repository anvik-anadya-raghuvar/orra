/**
 * Queries — the questions that want an answer rather than a ruling.
 *
 * The lighter half of the pair Work now carries. A decision is a fork that
 * holds up the tasks linked to it until someone rules; a query is "what did
 * the accountant say about the GST date" — it blocks nothing, it wants a
 * sentence back, and once it has been read it stops mattering.
 *
 * Every query is pinged into the Us thread the moment it is asked, because an
 * informal question with no home is the thing that gets lost. That ping is a
 * `messages` row like every other notice, so the bell and unread counts carry
 * it without a second notification system.
 *
 * Deliberately no project picker. A query is a question between two people,
 * not project work — and requiring one would put back the auto-chosen default
 * that was just taken out of every other form.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import type { Query } from '../../types';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { Avatar, Modal, useToast } from '../../ui/bits';
import { DictateField } from '../../ui/dictation';
import { staggerItem, staggerParent } from '../../ui/motion';
import { daysSinceTs, fmtDateTime } from '../../lib/dates';
import { notifyQuery } from '../../lib/handoff';
import { FormattedText } from '../../ui/richText';
import { Field } from './common';

/** A question nobody has answered in this long is going stale. */
const STALE_DAYS = 3;

export default function QueriesTab({
  newOpen,
  setNewOpen,
}: {
  newOpen: boolean;
  setNewOpen: (v: boolean) => void;
}) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [answering, setAnswering] = useState<Query | null>(null);
  const [answer, setAnswer] = useState('');

  const { open, settled } = useMemo(() => {
    const byNewest = (a: Query, b: Query) => b.created_at.localeCompare(a.created_at);
    return {
      open: ds.queries.filter((q) => q.status === 'open').sort(byNewest),
      settled: ds.queries.filter((q) => q.status !== 'open').sort(byNewest),
    };
  }, [ds.queries]);

  const submitAnswer = () => {
    if (!answering) return;
    const text = answer.trim();
    if (!text) {
      toast('Write an answer, or close it instead');
      return;
    }
    store.update(
      'queries',
      answering.id,
      { status: 'answered', answer: text, answered_by: store.meId, answered_at: nowIso() },
      store.asMe({ summary: `Query answered — ${answering.question}` }),
    );
    toast('Answered');
    setAnswering(null);
    setAnswer('');
  };

  /* Closing without an answer is a real ending, not a failure state: some
     questions stop mattering before anyone gets to them, and forcing an
     answer to clear one is how a list becomes something you avoid. */
  const close = (q: Query) =>
    store.update(
      'queries',
      q.id,
      { status: 'closed', closed_at: nowIso() },
      store.asMe({ summary: `Query closed — ${q.question}` }),
    );

  const reopen = (q: Query) =>
    store.update(
      'queries',
      q.id,
      { status: 'open', closed_at: null, answered_at: null, answered_by: null },
      store.asMe({ summary: `Query reopened — ${q.question}` }),
    );

  const remove = (q: Query) => {
    if (!window.confirm(`Delete "${q.question}"? It moves to Trash and can be restored from Admin → Data.`))
      return;
    store.remove('queries', q.id, store.asMe({ summary: `Query deleted — ${q.question}` }));
    toast('Query deleted');
  };

  const card = (q: Query) => {
    const days = Math.max(0, daysSinceTs(q.created_at));
    const stale = q.status === 'open' && days > STALE_DAYS;
    const task = q.task_id ? ds.tasks.find((t) => t.id === q.task_id) : undefined;
    const asker = ds.profiles.find((p) => p.id === q.asked_by);
    return (
      <motion.div
        key={q.id}
        variants={staggerItem}
        className={`wk-dec wk-query${stale ? ' stale' : ''}${q.status !== 'open' ? ' ruled' : ''}`}
        whileHover={q.status === 'open' ? { y: -3, boxShadow: 'var(--sh2)' } : undefined}
      >
        <h4>{q.question}</h4>
        {q.detail && <FormattedText text={q.detail} className="wk-query-detail" />}
        {q.answer && (
          <div className="wk-query-answer">
            <span className="eyebrow">Answer</span>
            <FormattedText text={q.answer} />
          </div>
        )}
        {task && (
          <Link className="lk" to={`/task/${task.id}`}>
            {task.id} · {task.title}
          </Link>
        )}
        <div className="wk-decfoot">
          <span className="mono" style={{ fontSize: 10.5, color: 'var(--mute)' }}>
            {asker?.name ?? 'Someone'} asked · {fmtDateTime(q.created_at)}
          </span>
          {q.status === 'open' ? (
            <span className={`pill ${stale ? 'over' : 'q'}`}>{days}d waiting</span>
          ) : (
            <span className="pill ok">{q.status}</span>
          )}
          <span className="wk-query-of">
            <span className="mono" style={{ fontSize: 10.5, color: 'var(--mute)' }}>for</span>
            <Avatar userId={q.asked_of} size={22} />
          </span>
          <div className="spacer" />
          <button className="btn sm danger" type="button" style={{ minHeight: 44 }} onClick={() => remove(q)}>
            Delete
          </button>
          {q.status === 'open' ? (
            <>
              <button className="btn sm" type="button" style={{ minHeight: 44 }} onClick={() => close(q)}>
                Close it
              </button>
              <button
                className="btn sm solid"
                type="button"
                style={{ minHeight: 44 }}
                onClick={() => {
                  setAnswering(q);
                  setAnswer(q.answer);
                }}
              >
                Answer
              </button>
            </>
          ) : (
            <button className="btn sm" type="button" style={{ minHeight: 44 }} onClick={() => reopen(q)}>
              Reopen
            </button>
          )}
        </div>
      </motion.div>
    );
  };

  return (
    <div>
      <div className="wk-sechead" style={{ marginTop: 0 }}>
        Waiting · {open.length}
      </div>
      <motion.div {...staggerParent()}>{open.map(card)}</motion.div>
      {open.length === 0 && <p className="wk-empty">Nothing unanswered. Ask something.</p>}

      <div className="wk-sechead">Answered and closed · {settled.length}</div>
      <motion.div {...staggerParent()}>{settled.map(card)}</motion.div>
      {settled.length === 0 && <p className="wk-empty">Nothing settled yet.</p>}

      <NewQueryModal open={newOpen} onClose={() => setNewOpen(false)} />

      <Modal open={!!answering} onClose={() => setAnswering(null)} title="Answer it">
        <p style={{ fontSize: 14, color: 'var(--slate)', margin: '0 0 12px' }}>{answering?.question}</p>
        <Field label="Answer">
          <DictateField label="Dictate this answer">
            <textarea
              className="wk-in"
              value={answer}
              autoFocus
              placeholder="A sentence is usually enough"
              onChange={(e) => setAnswer(e.target.value)}
            />
          </DictateField>
        </Field>
        <div style={{ height: 12 }} />
        <div className="wk-acts">
          <button className="btn" type="button" onClick={() => setAnswering(null)}>
            Cancel
          </button>
          <button className="btn solid" type="button" onClick={submitAnswer}>
            Send the answer
          </button>
        </div>
      </Modal>
    </div>
  );
}

function NewQueryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [question, setQuestion] = useState('');
  const [detail, setDetail] = useState('');
  /* Defaults to the other person, because a question you are asking yourself
     is the rarer case and the commoner one should need no clicks. */
  const other = useData((_, s) => s.other);
  const [askedOf, setAskedOf] = useState(other.id);
  const [taskId, setTaskId] = useState('');

  const submit = () => {
    const q = question.trim();
    if (!q) {
      toast('Write the question first');
      return;
    }
    store.insert(
      'queries',
      {
        id: newId('qry'),
        question: q,
        detail: detail.trim(),
        asked_by: store.meId,
        asked_of: askedOf,
        status: 'open',
        answer: '',
        answered_by: null,
        task_id: taskId || null,
        created_at: nowIso(),
        answered_at: null,
        closed_at: null,
      },
      store.asMe({ summary: `Query asked — ${q}` }),
    );
    // The ping is the feature, not a nicety: an informal question that lives
    // only on a tab nobody has open is a question nobody answers.
    notifyQuery(store, q, askedOf, taskId || null);
    toast('Asked — it is in the thread too');
    setQuestion('');
    setDetail('');
    setTaskId('');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Ask a query">
      <Field label="Question">
        <input
          className="wk-in"
          value={question}
          autoFocus
          placeholder="What do you need to know?"
          onChange={(e) => setQuestion(e.target.value)}
        />
      </Field>
      <div style={{ height: 11 }} />
      <Field label="Context · optional">
        <DictateField label="Dictate the context">
          <textarea
            className="wk-in"
            value={detail}
            placeholder="Anything that makes it answerable. @ tags work here."
            onChange={(e) => setDetail(e.target.value)}
          />
        </DictateField>
      </Field>
      <div style={{ height: 11 }} />
      <Field label="Asking">
        <select className="wk-in" value={askedOf} onChange={(e) => setAskedOf(e.target.value)}>
          {store.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
      </Field>
      <div style={{ height: 11 }} />
      <Field label="About a task · optional">
        <select className="wk-in" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
          <option value="">— nothing in particular —</option>
          {ds.tasks
            .filter((t) => t.status !== 'done')
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} · {t.title}
              </option>
            ))}
        </select>
      </Field>
      <div style={{ height: 14 }} />
      <div className="wk-acts">
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn solid" type="button" onClick={submit}>
          Ask it
        </button>
      </div>
    </Modal>
  );
}
