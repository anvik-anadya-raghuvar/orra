import { describe, expect, it } from 'vitest';
import type { Dataset, Message } from '../types';
import { latestFromOther, repliesTo } from './sends';

const ME = 'u-anadya';
const THEM = 'u-raghuvar';
const NOW = new Date('2026-08-19T09:00:00.000Z');

const msg = (p: Partial<Message>): Message =>
  ({
    id: 'm-1',
    sender_id: THEM,
    kind: 'chat',
    body: '',
    reply_to_id: null,
    task_ref_id: null,
    attachment_url: null,
    song_ref: null,
    promoted_to_type: null,
    promoted_to_id: null,
    created_at: '2026-08-19T08:00:00.000Z',
    ...p,
  }) as Message;

const dsOf = (messages: Message[]) => ({ messages }) as unknown as Dataset;

describe('what the other one sent lately', () => {
  it('finds the newest photo they sent', () => {
    const ds = dsOf([
      msg({ id: 'old', kind: 'photo', created_at: '2026-08-17T08:00:00.000Z' }),
      msg({ id: 'new', kind: 'photo', created_at: '2026-08-19T07:00:00.000Z' }),
    ]);
    expect(latestFromOther(ds, ME, 'photo', NOW)?.id).toBe('new');
  });

  it('ignores my own sends — this widget is what arrived, not what I sent', () => {
    const ds = dsOf([msg({ id: 'mine', kind: 'photo', sender_id: ME })]);
    expect(latestFromOther(ds, ME, 'photo', NOW)).toBeNull();
  });

  it('does not confuse a song with a photo', () => {
    const ds = dsOf([msg({ id: 's', kind: 'song' })]);
    expect(latestFromOther(ds, ME, 'photo', NOW)).toBeNull();
    expect(latestFromOther(ds, ME, 'song', NOW)?.id).toBe('s');
  });

  it('forgets anything older than the window', () => {
    // a photo from three weeks ago is not "what they shared lately"
    const ds = dsOf([msg({ id: 'stale', kind: 'photo', created_at: '2026-07-20T08:00:00.000Z' })]);
    expect(latestFromOther(ds, ME, 'photo', NOW)).toBeNull();
  });

  it('keeps one from exactly inside the window', () => {
    const ds = dsOf([msg({ id: 'edge', kind: 'photo', created_at: '2026-08-13T09:00:00.000Z' })]);
    expect(latestFromOther(ds, ME, 'photo', NOW)?.id).toBe('edge');
  });

  it('returns nothing when the thread is only chat', () => {
    const ds = dsOf([msg({ id: 'c', kind: 'chat' })]);
    expect(latestFromOther(ds, ME, 'photo', NOW)).toBeNull();
  });
});

describe('replies to a moment', () => {
  it('collects both sides, oldest first', () => {
    const ds = dsOf([
      msg({ id: 'moment', kind: 'photo' }),
      msg({ id: 'r2', reply_to_id: 'moment', sender_id: ME, created_at: '2026-08-19T08:30:00.000Z' }),
      msg({ id: 'r1', reply_to_id: 'moment', sender_id: THEM, created_at: '2026-08-19T08:10:00.000Z' }),
      msg({ id: 'elsewhere', reply_to_id: 'other-moment' }),
    ]);
    expect(repliesTo(ds, 'moment').map((m) => m.id)).toEqual(['r1', 'r2']);
  });

  it('is empty when nobody has replied', () => {
    expect(repliesTo(dsOf([msg({ id: 'moment', kind: 'photo' })]), 'moment')).toEqual([]);
  });
});
