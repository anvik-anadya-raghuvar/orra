import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useData, useStore, newId, nowIso } from '../../data/store';
import { InfoTip, useToast } from '../../ui/bits';
import { staggerItem, staggerParent } from '../../ui/motion';
import { todayIso } from '../../lib/dates';
import { warmth, type Warmth } from '../../lib/warmth';
import type { Dataset, Person, RelationshipType } from '../../types';
import { BarRows, HeatStrip, MiniBars, Ring } from '../../ui/viz';
import { buildTimeline, nudgeMessage, weeklyActivity } from './timeline';
import { LogTouchModal } from './TouchModal';
import ProfileModal from './ProfileModal';
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
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const ds = useData((d) => d);
  const people = ds.people;
  const projects = ds.projects;
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

  const glanceRows = useMemo(
    () =>
      people
        .map((p) => ({ p, w: warmth(p, today) }))
        .filter((x) => x.w.daysSince !== null)
        .sort((a, b) => (b.w.daysSince as number) - (a.w.daysSince as number))
        .slice(0, 8)
        .map((x) => ({ label: x.p.name, value: x.w.daysSince as number, color: `var(--${x.w.color})` })),
    [people, today],
  );

  const composition = useMemo(() => {
    const counts: Record<RelationshipType, number> = {
      customer: 0,
      vendor: 0,
      investor: 0,
      university: 0,
      personal: 0,
    };
    for (const p of people) counts[p.relationship_type]++;
    return (Object.keys(counts) as RelationshipType[])
      .filter((t) => counts[t] > 0)
      .map((t) => ({ label: t, value: counts[t], color: `var(--${REL_COLOR[t]})` }));
  }, [people]);

  const list = useMemo(() => {
    return people.filter((p) => {
      if (typeFilter !== 'all' && p.relationship_type !== typeFilter) return false;
      if (driftOnly && !warmth(p, today).drifting) return false;
      return true;
    });
  }, [people, typeFilter, driftOnly, today]);

  const projectName = (id: string | null) => (id ? projects.find((pr) => pr.id === id)?.name ?? id : null);
  const projectColor = (id: string | null) => (id ? projects.find((pr) => pr.id === id)?.color ?? 'var(--slate)' : 'var(--slate)');

  const onNudge = (person: Person, w: Warmth) => {
    store.insert(
      'messages',
      {
        id: newId('msg'),
        sender_id: store.meId,
        body: nudgeMessage(person, w),
        task_ref_id: null,
        attachment_url: null,
        song_ref: null,
        promoted_to_type: null,
        promoted_to_id: null,
        created_at: nowIso(),
      },
      store.asMe({ summary: `Nudge drafted — ${person.name}` }),
    );
    toast(`Nudge drafted for ${person.name}`);
    navigate('/us');
  };

  return (
    <div className="frame">
      <div className="top">
        <div className="disp feature-label">
          People
          <InfoTip label="People" text="A relationship tracker: cadence, last touch, next action and the work or messages connected to each person." />
        </div>
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
            <button
              className="btn sm"
              onClick={() => {
                setDriftOnly(true);
                setTypeFilter('all');
              }}
            >
              Show
            </button>
          </div>
        )}

        {people.length > 0 && (
          <div className="glance-grid">
            <div className="glance-card">
              <div className="eyebrow">Relationships at a glance</div>
              <p className="glance-sub">Days since last touch — worst first.</p>
              {glanceRows.length ? (
                <BarRows rows={glanceRows} format={(n) => `${n}d`} />
              ) : (
                <p className="tip">Log a first touch to start tracking.</p>
              )}
            </div>
            <div className="glance-card">
              <div className="eyebrow">Relationship mix</div>
              <p className="glance-sub">Who fills the book right now.</p>
              <MiniBars items={composition} />
            </div>
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
          <button
            className="chip"
            aria-pressed={driftOnly}
            onClick={() =>
              setDriftOnly((d) => {
                const next = !d;
                if (next) setTypeFilter('all');
                return next;
              })
            }
          >
            Drifting
          </button>
        </div>

        {list.length === 0 ? (
          <p className="tip">Nobody here yet.</p>
        ) : (
          <motion.div className="pgrid" {...staggerParent()}>
            {list.map((p) => (
              <PersonCard
                key={p.id}
                person={p}
                today={today}
                ds={ds}
                projectName={projectName(p.project_id)}
                projectColor={projectColor(p.project_id)}
                onOpenProfile={() => setOpenProfileId(p.id)}
                onLogTouch={() => setTouchPersonId(p.id)}
                onNudge={onNudge}
              />
            ))}
          </motion.div>
        )}

      </div>

      {openProfileId && (
        <ProfileModal
          personId={openProfileId === 'new' ? null : openProfileId}
          onClose={() => setOpenProfileId(null)}
          onLogTouch={(id) => setTouchPersonId(id)}
        />
      )}
      {touchPersonId && <LogTouchModal personId={touchPersonId} onClose={() => setTouchPersonId(null)} />}
    </div>
  );
}

function PersonCard({
  person,
  today,
  ds,
  projectName,
  projectColor,
  onOpenProfile,
  onLogTouch,
  onNudge,
}: {
  person: Person;
  today: string;
  ds: Dataset;
  projectName: string | null;
  projectColor: string;
  onOpenProfile: () => void;
  onLogTouch: () => void;
  onNudge: (person: Person, w: Warmth) => void;
}) {
  const w = warmth(person, today);
  const relColor = REL_COLOR[person.relationship_type];

  const heat = useMemo(() => weeklyActivity(buildTimeline(person, ds), today, 12), [person, ds, today]);

  return (
    <motion.div variants={staggerItem} className="pcard">
      <div className="pcard-headrow">
        <button className="pcard-head" onClick={onOpenProfile}>
          <span className={`av ${avClass(person.relationship_type)}`}>{initials(person.name)}</span>
          <span>
            <span className="pcard-name">{person.name}</span>
            <span className="pcard-sub">
              {person.role} · {person.time_zone}
            </span>
          </span>
        </button>
        <Ring
          pct={w.level * 100}
          size={40}
          color={`var(--${w.color})`}
          label={w.daysSince === null ? 'Never contacted' : `Warmth ${Math.round(w.level * 100)}%`}
        />
      </div>

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

      <div className="pcard-heat">
        <HeatStrip cells={heat} format={(n) => `${n} trace${n === 1 ? '' : 's'}`} />
      </div>

      <div className="pcard-foot">
        <span className="mono" style={{ fontSize: 10, color: 'var(--mute)' }}>
          {w.daysSince === null ? 'never contacted' : `last touch ${w.daysSince}d ago · every ${person.cadence_days}d`}
        </span>
        <span className="spacer" />
        {w.drifting && (
          <button className="btn sm" onClick={() => onNudge(person, w)}>
            Draft a nudge
          </button>
        )}
        <button className="btn sm pcard-touch" onClick={onLogTouch}>
          Log touch
        </button>
      </div>
    </motion.div>
  );
}
