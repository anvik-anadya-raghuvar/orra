/**
 * Putting something on the calendar — a block, a reminder, or a countdown.
 *
 * One composer for all three because they are one gesture ("something happens
 * on a date") and because the calendar had no way to add anything at all: the
 * month view was read-only, and blocks arrived only as a side effect of the
 * focus timer.
 *
 * A block can be WITH the other person. Tagging them puts it on their calendar
 * immediately, marked unconfirmed until they accept, and pings them — the
 * shape asked for: they should see it straight away, and both of you should
 * see that it is not agreed yet.
 *
 * A reminder is a block with no duration worth speaking of, so it is the same
 * row with `kind: 'reminder'` rather than a second table (0050). A countdown
 * is a `fixed_dates` row, which is already exactly a label and a date.
 */
import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { newId, nowIso, useData, useStore } from '../data/store';
import { Modal, useToast } from './bits';
import { DictateField } from './dictation';
import { todayIso } from '../lib/dates';
import { clockToMinutes, minutesToClock } from '../lib/calendar';
import { notifyCalendarInvite } from '../lib/handoff';
import './calendarComposer.css';

type Mode = 'block' | 'reminder' | 'countdown';

const MODES: { key: Mode; label: string; blurb: string }[] = [
  { key: 'block', label: 'Time block', blurb: 'Hold time — on your own, or with the other person.' },
  { key: 'reminder', label: 'Reminder', blurb: 'A nudge at a time. Pings your phone if push is on.' },
  { key: 'countdown', label: 'Countdown', blurb: 'A date to count down to. Pin it to Home.' },
];

const LEADS = [
  { min: null as number | null, label: 'No reminder' },
  { min: 0, label: 'At the time' },
  { min: 10, label: '10 min before' },
  { min: 30, label: '30 min before' },
  { min: 60, label: '1 hour before' },
  { min: 1440, label: '1 day before' },
];

export function CalendarComposer({ open, onClose, date }: { open: boolean; onClose: () => void; date?: string }) {
  const store = useStore();
  const other = useData((_, s) => s.other);
  const toast = useToast();

  const [mode, setMode] = useState<Mode>('block');
  const [label, setLabel] = useState('');
  const [when, setWhen] = useState(date ?? todayIso());
  const [start, setStart] = useState('10:00');
  const [end, setEnd] = useState('10:30');
  const [kind, setKind] = useState<'focus' | 'call' | 'meeting' | 'admin' | 'personal'>('focus');
  const [withThem, setWithThem] = useState(false);
  const [lead, setLead] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [shared, setShared] = useState(false);
  const [pinned, setPinned] = useState(true);

  const reset = () => {
    setLabel('');
    setNote('');
    setWithThem(false);
    setLead(null);
  };

  const submit = () => {
    const clean = label.trim();
    if (!clean) {
      toast('Give it a name first');
      return;
    }

    if (mode === 'countdown') {
      store.insert(
        'fixed_dates',
        {
          id: newId('fd'),
          label: clean,
          date: when,
          category: '',
          owner_id: shared ? null : store.meId,
          created_by: store.meId,
          pinned_home: pinned,
          note: note.trim() || null,
        },
        store.asMe({ summary: `Countdown added — ${clean}` }),
      );
      toast(pinned ? `${clean} — counting down on Home` : `${clean} added`);
      reset();
      onClose();
      return;
    }

    const startMin = clockToMinutes(start);
    if (startMin === null) {
      toast('That start time is not a valid HH:MM');
      return;
    }
    /* A reminder has no meaningful length. Giving it one would make it draw as
       a block on the day and imply time is held that is not. */
    const endMin = mode === 'reminder' ? startMin + 5 : clockToMinutes(end);
    if (endMin === null || endMin <= startMin) {
      toast('The end time has to be after the start');
      return;
    }

    const id = newId('ev');
    const invitee = mode === 'block' && withThem ? other.id : null;
    store.insert(
      'day_events',
      {
        id,
        user_id: store.meId,
        date: when,
        start_min: startMin,
        end_min: endMin,
        label: clean,
        kind: mode === 'reminder' ? 'reminder' : kind,
        task_id: null,
        invitee_id: invitee,
        confirmed_at: null,
        created_by: store.meId,
        remind_min_before: mode === 'reminder' ? (lead ?? 0) : lead,
        reminded_at: null,
        note: note.trim() || null,
      },
      store.asMe({ summary: `${mode === 'reminder' ? 'Reminder' : 'Time blocked'} — ${clean}` }),
    );
    if (invitee) {
      notifyCalendarInvite(store, clean, when, minutesToClock(startMin), invitee);
      toast(`${other.name} has it — unconfirmed until they accept`);
    } else {
      toast(mode === 'reminder' ? 'Reminder set' : 'Time blocked');
    }
    reset();
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add to the calendar">
      <div className="cc-modes" role="tablist" aria-label="What to add">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="tab"
            aria-selected={mode === m.key}
            onClick={() => setMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="tip">{MODES.find((m) => m.key === mode)!.blurb}</p>

      <label className="cc-field">
        <span>{mode === 'countdown' ? 'What are you counting down to?' : 'What is it?'}</span>
        <DictateField label="Dictate the name">
          <input
            className="cc-in"
            value={label}
            autoFocus
            maxLength={200}
            placeholder={
              mode === 'countdown' ? 'Flight to Milan' : mode === 'reminder' ? 'Call the consulate' : 'Write the pricing page'
            }
            onChange={(e) => setLabel(e.target.value)}
          />
        </DictateField>
      </label>

      <label className="cc-field">
        <span>Date</span>
        <input className="cc-in" type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
      </label>

      {mode !== 'countdown' && (
        <div className="cc-row">
          <label className="cc-field">
            <span>{mode === 'reminder' ? 'Time' : 'From'}</span>
            <input className="cc-in" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          {mode === 'block' && (
            <label className="cc-field">
              <span>To</span>
              <input className="cc-in" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          )}
        </div>
      )}

      {mode === 'block' && (
        <label className="cc-field">
          <span>Kind</span>
          <select className="cc-in" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="focus">Focus</option>
            <option value="call">Call</option>
            <option value="meeting">Meeting</option>
            <option value="admin">Admin</option>
            <option value="personal">Personal</option>
          </select>
        </label>
      )}

      {mode === 'block' && (
        <label className="cc-check">
          <input type="checkbox" checked={withThem} onChange={(e) => setWithThem(e.target.checked)} />
          <span>
            With {other.name} — it lands on their calendar straight away, marked unconfirmed until
            they accept, and pings them.
          </span>
        </label>
      )}

      {mode !== 'countdown' && (
        <label className="cc-field">
          <span>Remind me</span>
          <select
            className="cc-in"
            value={String(lead)}
            onChange={(e) => setLead(e.target.value === 'null' ? null : Number(e.target.value))}
          >
            {LEADS.map((l) => (
              <option key={String(l.min)} value={String(l.min)}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {mode === 'countdown' && (
        <>
          <label className="cc-check">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            <span>Both of you are counting down to this</span>
          </label>
          <label className="cc-check">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            <span>Show it on Home</span>
          </label>
        </>
      )}

      <label className="cc-field">
        <span>Note · optional</span>
        <DictateField label="Dictate the note">
          <textarea
            className="cc-in"
            value={note}
            maxLength={500}
            placeholder="Why it matters, or what to bring"
            onChange={(e) => setNote(e.target.value)}
          />
        </DictateField>
      </label>

      <div className="cc-acts">
        <button className="btn" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="btn solid" type="button" onClick={submit}>
          <CalendarPlus size={15} strokeWidth={1.9} aria-hidden /> Add it
        </button>
      </div>
    </Modal>
  );
}
