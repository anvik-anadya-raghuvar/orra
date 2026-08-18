import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useData, useStore, newId, nowIso } from '../../data/store';
import { Modal, useToast } from '../../ui/bits';
import { staggerList, staggerItem, entrance } from '../../ui/motion';
import { todayIso, fmtDay } from '../../lib/dates';
import { warmth } from '../../lib/warmth';
import type { Person, RelationshipType } from '../../types';
import './style.css';

const TYPE_FILTERS: { key: RelationshipType | 'all'; label: string }[] = [
  { key: 'all', label: 'Everyone' },
  { key: 'customer', label: 'Customers' },
  { key: 'vendor', label: 'Vendors' },
  { key: 'investor', label: 'Investors' },
  { key: 'university', label: 'University' },
  { key: 'personal', label: 'Personal' },
];

const REL_COLOR: Record<RelationshipType, string> = {
  customer: 'teal',
  vendor: 'stamp',
  investor: 'indigo',
  university: 'sky',
  personal: 'violet',
};

/** Matches prototype's av a/b/c grouping. */
function avClass(type: RelationshipType): 'a' | 'b' | 'c' {
  if (type === 'university' || type === 'personal') return 'b';
  if (type === 'vendor') return 'c';
  return 'a';
}

function initials(name: string): string {
  return (name.trim().slice(0, 2) || '—').toUpperCase();
}

export default function People() {
  const people = useData((ds) => ds.people);
  const projects = useData((ds) => ds.projects);
  const [typeFilter, setTypeFilter] = useState<RelationshipType | 'all'>('all');
  const [driftOnly, setDriftOnly] = useState(false);
  const [openProfileId, setOpenProfileId] = useState<string | 'new' | null>(null);
  const [touchPersonId, setTouchPersonId] = useState<string | null>(null);

  const today = todayIso();

  const drifting = useMemo(
    () =>
      people
        .map((p) => ({ p, w: warmth(p, today) }))
        .filter((x) => x.w.drifting)
        .sort((a, b) => (b.w.daysSince ?? Infinity) - (a.w.daysSince ?? Infinity)),
    [people, today],
  );

  const list = useMemo(() => {
    return people.filter((p) => {
      if (typeFilter !== 'all' && p.relationship_type !== typeFilter) return false;
      if (driftOnly && !warmth(p, today).drifting) return false;
      return true;
    });
  }, [people, typeFilter, driftOnly, today]);

  const projectName = (id: string | null) => (id ? projects.find((pr) => pr.id === id)?.name ?? id : null);
  const projectColor = (id: string | null) => (id ? projects.find((pr) => pr.id === id)?.color ?? 'var(--slate)' : 'var(--slate)');

  return (
    <div className="frame">
      <div className="top">
        <div className="disp">People</div>
        <div className="spacer" />
        <button className="btn sm solid" onClick={() => setOpenProfileId('new')}>
          + Person
        </button>
      </div>
      <div className="wrap">
        {drifting.length > 0 && (
          <div className="drift-banner">
            <div className="db-body">
              <div className="eyebrow">Drifting</div>
              <div className="db-text">
                {drifting.length} relationship{drifting.length === 1 ? '' : 's'} drifting — worst:{' '}
                {drifting.map((x) => x.p.name).join(', ')} — past their cadence. One touch each keeps the door
                open.
              </div>
            </div>
            <button className="btn sm" onClick={() => setDriftOnly(true)}>
              Show
            </button>
          </div>
        )}

        <div className="filters">
          {TYPE_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              className="chip"
              aria-pressed={!driftOnly && typeFilter === key}
              onClick={() => {
                setTypeFilter(key);
                setDriftOnly(false);
              }}
            >
              {label}
            </button>
          ))}
          <button className="chip" aria-pressed={driftOnly} onClick={() => setDriftOnly((d) => !d)}>
            Drifting
          </button>
        </div>

        {list.length === 0 ? (
          <p className="tip">Nobody here yet.</p>
        ) : (
          <motion.div className="pgrid" variants={staggerList} initial="initial" animate="animate">
            {list.map((p) => (
              <PersonCard
                key={p.id}
                person={p}
                today={today}
                projectName={projectName(p.project_id)}
                projectColor={projectColor(p.project_id)}
                onOpenProfile={() => setOpenProfileId(p.id)}
                onLogTouch={() => setTouchPersonId(p.id)}
              />
            ))}
          </motion.div>
        )}

        <p className="tip">
          The bar is warmth — it drains with silence and refills when you log a touch. Anyone fully drained raises
          a task by rule.
        </p>
      </div>

      {openProfileId && (
        <ProfileModal personId={openProfileId === 'new' ? null : openProfileId} onClose={() => setOpenProfileId(null)} />
      )}
      {touchPersonId && <LogTouchModal personId={touchPersonId} onClose={() => setTouchPersonId(null)} />}
    </div>
  );
}

function PersonCard({
  person,
  today,
  projectName,
  projectColor,
  onOpenProfile,
  onLogTouch,
}: {
  person: Person;
  today: string;
  projectName: string | null;
  projectColor: string;
  onOpenProfile: () => void;
  onLogTouch: () => void;
}) {
  const w = warmth(person, today);
  const relColor = REL_COLOR[person.relationship_type];

  return (
    <motion.div variants={staggerItem} className="pcard">
      <button className="pcard-head" onClick={onOpenProfile}>
        <span className={`av ${avClass(person.relationship_type)}`}>{initials(person.name)}</span>
        <span>
          <span className="pcard-name">{person.name}</span>
          <span className="pcard-sub">
            {person.role} · {person.time_zone}
          </span>
        </span>
      </button>

      <div className="pcard-chips">
        <span
          className="tagc"
          style={{ background: `var(--${relColor}-s, var(--surf3))`, color: `var(--${relColor}, var(--slate))` }}
        >
          {person.relationship_type}
        </span>
        {projectName && (
          <span className="tagc" style={{ background: 'var(--surf3)', color: projectColor }}>
            {projectName}
          </span>
        )}
      </div>

      <p className="pcard-next">Next: {person.next_action || '—'}</p>

      <div className="warm">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${w.level * 100}%` }}
          transition={entrance}
          style={{ height: '100%', background: `var(--${w.color})`, borderRadius: 4 }}
        />
      </div>

      <div className="pcard-foot">
        <span className="mono" style={{ fontSize: 10, color: 'var(--mute)' }}>
          {w.daysSince === null ? 'never contacted' : `last touch ${w.daysSince}d ago · every ${person.cadence_days}d`}
        </span>
        <span className="spacer" />
        <button className="btn sm pcard-touch" onClick={onLogTouch}>
          Log touch
        </button>
      </div>
    </motion.div>
  );
}

function LogTouchModal({ personId, onClose }: { personId: string; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const person = useData((ds) => ds.people.find((p) => p.id === personId));
  const [summary, setSummary] = useState('');

  if (!person) return null;

  const log = () => {
    const s = summary.trim() || 'Touch logged from the portal';
    store.update('people', person.id, { last_contact_date: todayIso() }, store.asMe());
    store.insert(
      'people_interactions',
      { id: newId('pi'), person_id: person.id, occurred_on: todayIso(), summary: s, logged_by: store.me.id },
      store.asMe({ summary: `Touch logged — ${person.name}` }),
    );
    toast(`${person.name} is warm again`);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Log touch — ${person.name}`}>
      <input
        type="text"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), log())}
        placeholder="One-line summary — e.g. Call, sent pricing"
        style={inputStyle}
        autoFocus
      />
      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn solid" onClick={log}>
          Log touch
        </button>
      </div>
    </Modal>
  );
}

function ProfileModal({ personId, onClose }: { personId: string | null; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const projects = useData((ds) => ds.projects);
  const existing = useData((ds) => ds.people.find((p) => p.id === personId)) ?? null;
  const history = useData((ds) =>
    ds.people_interactions
      .filter((h) => h.person_id === personId)
      .slice()
      .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on)),
  );

  const [name, setName] = useState(existing?.name ?? '');
  const [role, setRole] = useState(existing?.role ?? '');
  const [relationshipType, setRelationshipType] = useState<RelationshipType>(existing?.relationship_type ?? 'customer');
  const [projectId, setProjectId] = useState(existing?.project_id ?? '');
  const [timeZone, setTimeZone] = useState(existing?.time_zone ?? '');
  const [cadenceDays, setCadenceDays] = useState(existing?.cadence_days ?? 14);
  const [nextAction, setNextAction] = useState(existing?.next_action ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');

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

  return (
    <Modal open onClose={onClose} title={existing ? existing.name : 'New person'}>
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
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ ...inputStyle, marginBottom: 0 }}>
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
          <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>
            History
          </label>
          {history.length === 0 ? (
            <p className="tip" style={{ margin: '6px 0' }}>
              Nothing logged yet.
            </p>
          ) : (
            history.map((h) => (
              <p className="hist" key={h.id}>
                <span className="mono">{fmtDay(h.occurred_on)}</span> — {h.summary}
              </p>
            ))
          )}
        </>
      )}

      <div className="mrowbtns" style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 14 }}>
        {existing && (
          <button className="btn sm" onClick={remove} style={{ color: 'var(--rose)', marginRight: 'auto' }}>
            Delete
          </button>
        )}
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
