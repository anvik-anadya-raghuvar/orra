import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Pencil, ArrowUpRight } from 'lucide-react';
import { useData, useStore, newId, nowIso } from '../../data/store';
import { SideSheet, useToast } from '../../ui/bits';
import { fmtDay, todayIso } from '../../lib/dates';
import { warmth } from '../../lib/warmth';
import type { RelationshipType } from '../../types';
import { buildTimeline, nudgeMessage, TYPE_META } from './timeline';

const WARMTH_PILL: Record<'teal' | 'stamp' | 'rose', string> = { teal: 'ok', stamp: 'due', rose: 'over' };
import { EditInteractionModal } from './TouchModal';
import { inputStyle } from './style';

export default function ProfileModal({
  personId,
  onClose,
  onLogTouch,
}: {
  personId: string | null;
  onClose: () => void;
  onLogTouch: (personId: string) => void;
}) {
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const projects = useData((ds) => ds.projects);
  const ds = useData((d) => d);
  const existing = useData((ds) => ds.people.find((p) => p.id === personId)) ?? null;
  const today = todayIso();

  const [name, setName] = useState(existing?.name ?? '');
  const [role, setRole] = useState(existing?.role ?? '');
  const [relationshipType, setRelationshipType] = useState<RelationshipType>(existing?.relationship_type ?? 'customer');
  const [projectId, setProjectId] = useState(existing?.project_id ?? '');
  const [timeZone, setTimeZone] = useState(existing?.time_zone ?? '');
  const [cadenceDays, setCadenceDays] = useState(existing?.cadence_days ?? 14);
  const [nextAction, setNextAction] = useState(existing?.next_action ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [editingInteraction, setEditingInteraction] = useState<string | null>(null);

  const timeline = useMemo(() => (existing ? buildTimeline(existing, ds) : []), [existing, ds]);
  const w = existing ? warmth(existing, today) : null;

  const save = () => {
    const n = name.trim() || 'Unnamed';
    if (existing) {
      store.update(
        'people',
        existing.id,
        {
          name: n,
          role,
          relationship_type: relationshipType,
          project_id: projectId || null,
          time_zone: timeZone,
          cadence_days: cadenceDays,
          next_action: nextAction,
          notes,
        },
        store.asMe(),
      );
      toast('Saved');
    } else {
      store.insert(
        'people',
        {
          id: newId('p'),
          name: n,
          role,
          relationship_type: relationshipType,
          project_id: projectId || null,
          time_zone: timeZone,
          cadence_days: cadenceDays,
          last_contact_date: null,
          next_action: nextAction || 'First touch — introduce',
          notes,
          created_at: nowIso(),
        },
        store.asMe({ summary: `Person added — ${n}` }),
      );
      toast(`${n} added`);
    }
    onClose();
  };

  const remove = () => {
    if (!existing) return;
    if (!window.confirm(`Delete ${existing.name}? This cannot be undone.`)) return;
    store.remove('people', existing.id, store.asMe({ summary: `Person removed — ${existing.name}` }));
    toast('Person removed');
    onClose();
  };

  const draftNudge = () => {
    if (!existing || !w) return;
    const line = nudgeMessage(existing, w);
    store.insert(
      'messages',
      {
        id: newId('msg'),
        sender_id: store.meId,
        body: line,
        task_ref_id: null,
        attachment_url: null,
        song_ref: null,
        promoted_to_type: null,
        promoted_to_id: null,
        created_at: nowIso(),
      },
      store.asMe({ summary: `Nudge drafted — ${existing.name}` }),
    );
    toast(`Nudge drafted for ${existing.name}`);
    onClose();
    navigate('/us');
  };

  return (
    <SideSheet
      open
      onClose={onClose}
      title={existing ? existing.name : 'New person'}
      subtitle={existing ? undefined : 'Shared — both of you see this person.'}
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
      {existing && w && (
        <div className="pm-warmrow">
          <span className={`pill ${WARMTH_PILL[w.color]}`}>
            {w.daysSince === null ? 'never contacted' : `${w.daysSince}d since last touch`}
          </span>
          {w.drifting && (
            <button className="btn sm" onClick={draftNudge}>
              Draft a nudge
            </button>
          )}
        </div>
      )}

      <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
        Name
      </label>
      <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={inputStyle} />

      <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
        Role
      </label>
      <input
        type="text"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        placeholder="Role — e.g. Vendor · packaging"
        style={inputStyle}
      />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 11 }}>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
            Type
          </label>
          <select
            aria-label="Relationship type"
            value={relationshipType}
            onChange={(e) => setRelationshipType(e.target.value as RelationshipType)}
            style={{ ...inputStyle, marginBottom: 0 }}
          >
            {(['customer', 'vendor', 'investor', 'university', 'personal'] as RelationshipType[]).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
            Project
          </label>
          <select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ ...inputStyle, marginBottom: 0 }}>
            <option value="">— none —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 11 }}>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
            Time zone
          </label>
          <input
            type="text"
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            placeholder="Asia/Kolkata"
            style={{ ...inputStyle, marginBottom: 0 }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
            Cadence (days)
          </label>
          <input
            aria-label="Cadence in days"
            type="number"
            min={1}
            value={cadenceDays}
            onChange={(e) => setCadenceDays(Math.max(1, Number(e.target.value) || 1))}
            style={{ ...inputStyle, marginBottom: 0 }}
          />
        </div>
      </div>

      <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
        Next action
      </label>
      <input
        type="text"
        value={nextAction}
        onChange={(e) => setNextAction(e.target.value)}
        placeholder="What happens next"
        style={inputStyle}
      />

      <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
        Notes
      </label>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes"
        style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }}
      />

      {existing && (
        <>
          <div className="tl-head">
            <label className="eyebrow">Contact timeline</label>
            <button className="btn sm" onClick={() => onLogTouch(existing.id)}>
              + Log touch
            </button>
          </div>
          {timeline.length === 0 ? (
            <p className="tip" style={{ margin: '6px 0' }}>
              Nothing logged yet — no touches, notes, tasks, ledger rows, or mail mention {existing.name}.
            </p>
          ) : (
            <div className="timeline">
              {timeline.map((e) => {
                const meta = TYPE_META[e.type];
                return (
                  <div className="tl-entry" key={e.id}>
                    <span
                      className="tl-chip"
                      style={{ background: `var(--${meta.color}-s)`, color: `var(--${meta.color})` }}
                    >
                      {meta.label}
                    </span>
                    <div className="tl-body">
                      <span className="mono tl-date">{fmtDay(e.date.slice(0, 10))}</span>
                      {e.href ? (
                        e.external ? (
                          <a className="lk tl-summary" href={e.href} target="_blank" rel="noreferrer">
                            {e.summary} <ArrowUpRight size={12} style={{ verticalAlign: -1 }} />
                          </a>
                        ) : (
                          <Link className="lk tl-summary" to={e.href} onClick={onClose}>
                            {e.summary}
                          </Link>
                        )
                      ) : (
                        <span className="tl-summary">{e.summary}</span>
                      )}
                      {e.meta && <span className="tl-meta">{e.meta}</span>}
                    </div>
                    {e.interactionId && (
                      <div className="tl-actions">
                        <button
                          type="button"
                          className="tl-iconbtn"
                          aria-label="Edit this touch"
                          onClick={() => setEditingInteraction(e.interactionId!)}
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}


      {existing && editingInteraction && (
        <EditInteractionModal
          personId={existing.id}
          interactionId={editingInteraction}
          onClose={() => setEditingInteraction(null)}
        />
      )}
    </SideSheet>
  );
}
