import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import type { Decision } from '../../types';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { Avatar, Modal, useToast } from '../../ui/bits';
import { staggerItem, staggerList, staggerParent } from '../../ui/motion';
import { daysSinceTs, fmtDateTime } from '../../lib/dates';
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
      <p style={{ fontSize: 14, color: 'var(--slate)', maxWidth: '66ch', margin: '0 0 14px' }}>
        Anything touching money, scoring, brand, hiring or a new venture lands here with a
        recommendation. You rule; the portal never decides. Open past {STALE_DAYS} days turns red —
        that is the whole mechanism against quiet indecision.
      </p>

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
  const [projectId, setProjectId] = useState(ds.projects[0]?.id ?? '');
  const [recommendation, setRecommendation] = useState('');
  const [owner, setOwner] = useState(store.meId);

  const submit = () => {
    const q = question.trim() || 'Untitled decision';
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
      },
      store.asMe({ summary: `Decision opened — ${q}` }),
    );
    toast('Decision opened');
    setQuestion('');
    setRecommendation('');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="New decision">
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
          <select className="wk-in" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {ds.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Owner">
          <select className="wk-in" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {ds.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="wk-acts">
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn solid" type="button" onClick={submit}>
          Open decision
        </button>
      </div>
    </Modal>
  );
}
