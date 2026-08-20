import { describe, expect, it } from 'vitest';
import type { Dataset, Profile, Task } from '../types';
import {
  commitMoment,
  daypartOf,
  emptyMemory,
  hourIn,
  isQuietHours,
  pickMoment,
  pickOnDemand,
  pruneMemory,
  type CompanionContext,
  type CompanionMemory,
} from './companion';

const ME = 'u-anadya';
const OTHER = 'u-raghuvar';

const profile = (id: string, name: string, tz: string): Profile => ({
  id,
  email: `${name.toLowerCase()}@anvik.dev`,
  name,
  avatar_url: null,
  time_zone: tz,
  status_text: null,
  status_expires_at: null,
  personalization: {} as Profile['personalization'],
});

const me = profile(ME, 'Anadya', 'Asia/Kolkata');
const other = profile(OTHER, 'Raghuvar', 'Europe/Rome');

const task = (p: Partial<Task>): Task =>
  ({
    id: 'T-1',
    title: 'A task',
    status: 'todo',
    assignee_id: ME,
    created_by: ME,
    due_date: null,
    ...p,
  }) as Task;

const dataset = (p: Partial<Dataset> = {}): Dataset =>
  ({ tasks: [], active_blocks: [], ...p }) as unknown as Dataset;

// 11:00 in Kolkata on 2026-08-20 — a plain working morning, outside quiet hours.
const MORNING = new Date('2026-08-20T05:30:00.000Z');
// 20:00 in Kolkata — evening, still awake.
const EVENING = new Date('2026-08-20T14:30:00.000Z');
// 23:30 in Kolkata — quiet hours.
const NIGHT = new Date('2026-08-20T18:00:00.000Z');

const ctx = (p: Partial<CompanionContext> = {}): CompanionContext => ({
  now: MORNING,
  me,
  other,
  route: '/',
  dense: false,
  otherOnline: null,
  events: [],
  memory: emptyMemory(),
  chattiness: 'normal',
  ...p,
});

describe('clock plumbing', () => {
  it('reads the hour in the given timezone', () => {
    expect(hourIn('Asia/Kolkata', MORNING)).toBe(11);
    expect(hourIn('Europe/Rome', MORNING)).toBe(7);
  });

  it('splits the day into parts', () => {
    expect(daypartOf(9)).toBe('morning');
    expect(daypartOf(14)).toBe('afternoon');
    expect(daypartOf(19)).toBe('evening');
  });

  it('knows quiet hours in MY timezone, not the other person’s', () => {
    expect(isQuietHours(ctx({ now: NIGHT }))).toBe(true);
    expect(isQuietHours(ctx({ now: MORNING }))).toBe(false);
  });
});

describe('greetings', () => {
  it('greets first thing, once per day-part', () => {
    const first = pickMoment(dataset(), ctx());
    expect(first?.kind).toBe('greeting');
    expect(first?.id).toBe('greeting:2026-08-20:morning');

    const after = commitMoment(emptyMemory(), first!, MORNING);
    // gap satisfied artificially: jump past the ambient gap, same day-part
    const later = new Date(MORNING.getTime() + 25 * 60_000);
    const second = pickMoment(dataset(), ctx({ now: later, memory: after }));
    expect(second?.kind).not.toBe('greeting');
  });

  it('greets again in a new day-part', () => {
    let memory = commitMoment(
      emptyMemory(),
      pickMoment(dataset(), ctx())!,
      MORNING,
    );
    memory = { ...memory, lastAmbientAt: 0 }; // silence long since elapsed
    const evening = pickMoment(dataset(), ctx({ now: EVENING, memory }));
    expect(evening?.id).toBe('greeting:2026-08-20:evening');
  });

  it('is stable across reloads — same day, same line', () => {
    const a = pickMoment(dataset(), ctx());
    const b = pickMoment(dataset(), ctx());
    expect(a?.text).toBe(b?.text);
  });
});

describe('silence gates', () => {
  it('says nothing while my own block runs', () => {
    const ds = dataset({
      active_blocks: [{ user_id: ME } as Dataset['active_blocks'][number]],
    });
    expect(pickMoment(ds, ctx())).toBeNull();
  });

  it('says nothing while snoozed', () => {
    const memory: CompanionMemory = { ...emptyMemory(), snoozedUntil: MORNING.getTime() + 1 };
    expect(pickMoment(dataset(), ctx({ memory }))).toBeNull();
  });

  it('holds ambient chatter at night', () => {
    expect(pickMoment(dataset(), ctx({ now: NIGHT }))).toBeNull();
  });

  it('lets an event through at night', () => {
    const m = pickMoment(
      dataset(),
      ctx({ now: NIGHT, events: [{ type: 'join' }] }),
    );
    expect(m?.kind).toBe('presence-join');
  });

  it('holds ambient chatter in dense rooms but lets events through', () => {
    expect(pickMoment(dataset(), ctx({ dense: true }))).toBeNull();
    const m = pickMoment(dataset(), ctx({ dense: true, events: [{ type: 'join' }] }));
    expect(m?.kind).toBe('presence-join');
  });

  it('enforces the global ambient gap', () => {
    const memory: CompanionMemory = {
      ...emptyMemory(),
      lastAmbientAt: MORNING.getTime() - 60_000, // one minute ago
    };
    expect(pickMoment(dataset(), ctx({ memory }))).toBeNull();
  });

  it('enforces the daily cap', () => {
    const dayStart = new Date(MORNING.getFullYear(), MORNING.getMonth(), MORNING.getDate());
    const shown: Record<string, number> = {};
    for (let i = 0; i < 6; i++) shown[`tip:cap-filler-${i}`] = dayStart.getTime() + i;
    const memory: CompanionMemory = { shown, lastAmbientAt: 0 };
    expect(pickMoment(dataset(), ctx({ memory }))).toBeNull();
  });
});

describe('events outrank everything and debounce themselves', () => {
  it('a song beats a join beats the greeting', () => {
    const m = pickMoment(
      dataset(),
      ctx({
        events: [
          { type: 'join' },
          { type: 'song', messageId: 'm-1', title: 'Clair de Lune', url: null },
        ],
      }),
    );
    expect(m?.kind).toBe('song-received');
    expect(m?.text).toContain('Clair de Lune');
  });

  it('the same song never announces twice', () => {
    const song = { type: 'song', messageId: 'm-1', title: 'x', url: null } as const;
    const first = pickMoment(dataset(), ctx({ events: [song] }))!;
    const memory = commitMoment(emptyMemory(), first, MORNING);
    const again = pickMoment(dataset(), ctx({ events: [song], memory }));
    expect(again?.kind).not.toBe('song-received');
  });

  it('a flapping connection is one arrival, not three', () => {
    const first = pickMoment(dataset(), ctx({ events: [{ type: 'join' }] }))!;
    const memory = commitMoment(emptyMemory(), first, MORNING);
    const soon = new Date(MORNING.getTime() + 5 * 60_000);
    const again = pickMoment(dataset(), ctx({ now: soon, events: [{ type: 'join' }], memory }));
    expect(again?.kind).not.toBe('presence-join');
  });
});

describe('ambient priorities', () => {
  const greeted = (at: Date = MORNING) => {
    // greeting already shown, ambient gap long since elapsed
    const g = pickMoment(dataset(), ctx({ now: at }))!;
    return { ...commitMoment(emptyMemory(), g, new Date(at.getTime() - 3_600_000)), lastAmbientAt: 0 };
  };

  it('due today outranks tips', () => {
    const ds = dataset({ tasks: [task({ due_date: '2026-08-20' })] });
    const m = pickMoment(ds, ctx({ memory: greeted() }));
    expect(m?.kind).toBe('tasks-due');
    expect(m?.action?.to).toBe('/work');
  });

  it('overdue counts as due', () => {
    const ds = dataset({ tasks: [task({ due_date: '2026-08-18' })] });
    expect(pickMoment(ds, ctx({ memory: greeted() }))?.kind).toBe('tasks-due');
  });

  it('done tasks are not due', () => {
    const ds = dataset({ tasks: [task({ due_date: '2026-08-20', status: 'done' })] });
    expect(pickMoment(ds, ctx({ memory: greeted() }))?.kind).not.toBe('tasks-due');
  });

  it('an unacknowledged handoff surfaces the inbox', () => {
    const ds = dataset({
      tasks: [task({ created_by: OTHER, assignee_id: ME, acknowledged_at: null })],
    });
    const m = pickMoment(ds, ctx({ memory: greeted() }));
    expect(m?.kind).toBe('inbox-handoff');
    expect(m?.text).toContain('Raghuvar');
  });

  it('falls through to a tip, and tips rotate least-recently-shown', () => {
    const first = pickMoment(dataset(), ctx({ memory: greeted() }))!;
    expect(first.kind).toBe('tip');
    let memory = commitMoment(greeted(), first, new Date(MORNING.getTime() - 7 * 3_600_000));
    memory = { ...memory, lastAmbientAt: 0 };
    const second = pickMoment(dataset(), ctx({ memory }));
    expect(second?.kind).toBe('tip');
    expect(second?.id).not.toBe(first.id);
  });

  it('respects the one-tip-per-slot rule', () => {
    const first = pickMoment(dataset(), ctx({ memory: greeted() }))!;
    expect(first.kind).toBe('tip');
    let memory = commitMoment(greeted(), first, MORNING);
    memory = { ...memory, lastAmbientAt: 0 };
    const soon = new Date(MORNING.getTime() + 30 * 60_000);
    const next = pickMoment(dataset(), ctx({ now: soon, memory }));
    // tips are cooling; the quote is the only ambient line left
    expect(next?.kind).toBe('quote');
  });

  it('route-targets tips — Home tips stay off other pages', () => {
    const m = pickMoment(dataset(), ctx({ memory: greeted(), route: '/knowledge' }));
    expect(m?.kind).toBe('tip');
    expect(['home-drag', 'home-customise', 'tile-peek', 'capacity-plan']).not.toContain(
      m?.id.replace('tip:', ''),
    );
  });
});

describe('the tap cycle ignores cooldowns', () => {
  it('answers status even when snoozed silence would hold ambient', () => {
    const m = pickOnDemand(dataset(), ctx(), 0);
    expect(m.kind).toBe('status-check');
  });

  it('status reports the other person’s running block first', () => {
    const ds = dataset({
      active_blocks: [
        { user_id: OTHER, scope: 'founder', focus_task_id: null } as Dataset['active_blocks'][number],
      ],
    });
    const m = pickOnDemand(ds, ctx(), 0);
    expect(m.text).toContain('Founder block');
  });

  it('status falls back to their wall clock', () => {
    const m = pickOnDemand(dataset(), ctx(), 0);
    expect(m.text).toContain('Rome');
  });

  it('cycles to a tip and then the quote', () => {
    expect(pickOnDemand(dataset(), ctx(), 1).kind).toBe('tip');
    expect(pickOnDemand(dataset(), ctx(), 2).kind).toBe('quote');
  });

  it('on-demand shows never charge the ambient gap', () => {
    const m = pickOnDemand(dataset(), ctx(), 1);
    const memory = commitMoment(emptyMemory(), m, MORNING, { onDemand: true });
    expect(memory.lastAmbientAt).toBe(0);
    expect(memory.shown[m.id]).toBe(MORNING.getTime());
  });
});

describe('memory hygiene', () => {
  it('prunes entries past the 30-day horizon and keeps the rest', () => {
    const old = MORNING.getTime() - 31 * 86_400_000;
    const fresh = MORNING.getTime() - 86_400_000;
    const pruned = pruneMemory(
      { shown: { 'tip:old': old, 'tip:fresh': fresh }, lastAmbientAt: fresh },
      MORNING,
    );
    expect(pruned.shown['tip:old']).toBeUndefined();
    expect(pruned.shown['tip:fresh']).toBe(fresh);
  });
});
