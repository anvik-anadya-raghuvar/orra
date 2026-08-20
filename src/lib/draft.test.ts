import { describe, expect, it } from 'vitest';
import {
  DRAFT_TTL_DAYS,
  hasContent,
  parseDraft,
  pickKnown,
  serialiseDraft,
} from './draft';

const NOW = Date.parse('2026-08-21T04:00:00.000Z');
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe('hasContent', () => {
  it('treats a blank composer as nothing to keep', () => {
    expect(hasContent({ title: '', description: '   ', tags: [], due: null })).toBe(false);
  });
  it('keeps a deliberate false or zero', () => {
    expect(hasContent({ billable: false })).toBe(false);
    expect(hasContent({ title: 'x', billable: false })).toBe(true);
  });
  it('keeps one typed character', () => {
    expect(hasContent({ title: 'a', description: '' })).toBe(true);
  });
  it('looks inside arrays', () => {
    expect(hasContent({ shots: [{ filename: '' }] })).toBe(false);
    expect(hasContent({ shots: [{ filename: 'a.png' }] })).toBe(true);
  });
});

describe('serialiseDraft', () => {
  it('refuses to store an empty draft', () => {
    expect(serialiseDraft({ title: '' }, ago(0))).toBeNull();
  });
  it('round-trips a real one', () => {
    const raw = serialiseDraft({ title: 'Ship it', n: 3 }, ago(0));
    expect(parseDraft(raw, NOW)).toEqual({ title: 'Ship it', n: 3 });
  });
});

describe('parseDraft', () => {
  it('is null for every failure rather than throwing', () => {
    expect(parseDraft(null, NOW)).toBeNull();
    expect(parseDraft('not json', NOW)).toBeNull();
    expect(parseDraft('42', NOW)).toBeNull();
    expect(parseDraft('{"values":{"a":1}}', NOW)).toBeNull();
    expect(parseDraft('{"at":"nonsense","values":{"a":1}}', NOW)).toBeNull();
  });
  it('drops a draft older than the window', () => {
    const stale = JSON.stringify({ at: ago(DRAFT_TTL_DAYS + 1), values: { title: 'old' } });
    expect(parseDraft(stale, NOW)).toBeNull();
    const fresh = JSON.stringify({ at: ago(DRAFT_TTL_DAYS - 1), values: { title: 'old' } });
    expect(parseDraft(fresh, NOW)).toEqual({ title: 'old' });
  });
});

describe('pickKnown', () => {
  it('ignores keys the composer no longer has', () => {
    expect(pickKnown({ title: 'a', removed: 'x' }, { title: '', due: '' })).toEqual({ title: 'a' });
  });
  it('leaves untouched fields absent rather than blanking them', () => {
    expect(pickKnown({ title: 'a' }, { title: '', due: '' })).toEqual({ title: 'a' });
  });
  it('survives junk', () => {
    expect(pickKnown(null, { title: '' })).toEqual({});
    expect(pickKnown('nope', { title: '' })).toEqual({});
  });
});
