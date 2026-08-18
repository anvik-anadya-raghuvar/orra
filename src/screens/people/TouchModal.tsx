import React, { useState } from 'react';
import { useData, useStore, newId } from '../../data/store';
import { Modal, useToast } from '../../ui/bits';
import { todayIso } from '../../lib/dates';
import type { PersonInteraction } from '../../types';
import { CHANNELS, channelLabel, recomputeLastContact, type Channel } from './timeline';
import { inputStyle } from './style';

/** Log a brand-new touch: channel + backdatable date + summary. */
export function LogTouchModal({ personId, onClose }: { personId: string; onClose: () => void }) {
  const store = useStore();
  const toast = useToast();
  const person = useData((ds) => ds.people.find((p) => p.id === personId));
  const interactions = useData((ds) => ds.people_interactions);
  const [channel, setChannel] = useState<Channel>('message');
  const [date, setDate] = useState(todayIso());
  const [summary, setSummary] = useState('');

  if (!person) return null;

  const log = () => {
    const body = summary.trim() || 'Touch logged from the portal';
    const s = `${channelLabel(channel)} — ${body}`;
    const row: PersonInteraction = {
      id: newId('pi'),
      person_id: person.id,
      occurred_on: date || todayIso(),
      summary: s,
      logged_by: store.me.id,
    };
    store.insert('people_interactions', row, store.asMe({ summary: `Touch logged — ${person.name}` }));
    const last = recomputeLastContact([...interactions, row], person.id);
    store.update('people', person.id, { last_contact_date: last }, store.asMe({ silent: true }));
    toast(`${person.name} is warm again`);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Log touch — ${person.name}`}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 11 }}>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
            Channel
          </label>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
            style={{ ...inputStyle, marginBottom: 0 }}
          >
            {CHANNELS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
            Date
          </label>
          <input
            type="date"
            value={date}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value)}
            style={{ ...inputStyle, marginBottom: 0 }}
          />
        </div>
      </div>
      <input
        type="text"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), log())}
        placeholder="One-line summary — e.g. sent pricing"
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

/** Edit or delete an already-logged interaction. */
export function EditInteractionModal({
  personId,
  interactionId,
  onClose,
}: {
  personId: string;
  interactionId: string;
  onClose: () => void;
}) {
  const store = useStore();
  const toast = useToast();
  const person = useData((ds) => ds.people.find((p) => p.id === personId));
  const interactions = useData((ds) => ds.people_interactions);
  const existing = interactions.find((h) => h.id === interactionId);
  const [date, setDate] = useState(existing?.occurred_on ?? todayIso());
  const [summary, setSummary] = useState(existing?.summary ?? '');

  if (!person || !existing) return null;

  const save = () => {
    const patch = { occurred_on: date || existing.occurred_on, summary: summary.trim() || existing.summary };
    store.update('people_interactions', existing.id, patch, store.asMe({ summary: `Touch edited — ${person.name}` }));
    const after = interactions.map((h) => (h.id === existing.id ? { ...h, ...patch } : h));
    const last = recomputeLastContact(after, person.id);
    store.update('people', person.id, { last_contact_date: last }, store.asMe({ silent: true }));
    toast('Touch updated');
    onClose();
  };

  const remove = () => {
    if (!window.confirm('Delete this logged touch? This cannot be undone.')) return;
    store.remove('people_interactions', existing.id, store.asMe({ summary: `Touch removed — ${person.name}` }));
    const after = interactions.filter((h) => h.id !== existing.id);
    const last = recomputeLastContact(after, person.id);
    store.update('people', person.id, { last_contact_date: last }, store.asMe({ silent: true }));
    toast('Touch removed');
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={`Edit touch — ${person.name}`}>
      <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
        Date
      </label>
      <input
        type="date"
        value={date}
        max={todayIso()}
        onChange={(e) => setDate(e.target.value)}
        style={inputStyle}
      />
      <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
        Summary
      </label>
      <input
        type="text"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), save())}
        style={inputStyle}
        autoFocus
      />
      <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={remove} style={{ color: 'var(--rose)', marginRight: 'auto' }}>
          Delete
        </button>
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
