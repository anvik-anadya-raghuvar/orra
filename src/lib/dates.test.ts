import { describe, expect, it } from 'vitest';
import { localDay, todayIso } from './dates';

describe('todayIso follows the reader, not Greenwich', () => {
  it('returns the local calendar date just after midnight', () => {
    // 19 Aug 01:00 in Rome is still 18 Aug in UTC. The old implementation used
    // toISOString(), so the day plan, intentions and schedule were written to
    // yesterday for the first hours of every morning — indistinguishable from
    // the app losing the day's work.
    const justAfterMidnightLocal = new Date(2026, 7, 19, 1, 0, 0);
    expect(todayIso(justAfterMidnightLocal)).toBe('2026-08-19');
  });

  it('returns the local calendar date just before midnight', () => {
    const lateEveningLocal = new Date(2026, 7, 19, 23, 30, 0);
    expect(todayIso(lateEveningLocal)).toBe('2026-08-19');
  });

  it('pads single-digit months and days', () => {
    expect(todayIso(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
  });
});

describe('localDay reads a timestamp in the local calendar', () => {
  it('keeps an early-morning timestamp on the day it was actually sent', () => {
    // 04:00 in Delhi is 22:30 UTC the previous day. Slicing the ISO string —
    // which is what the Us thread, Momentum and the notes activity strip all
    // did — put it on yesterday for every reader east of Greenwich.
    const earlyMorningLocal = new Date(2026, 7, 20, 4, 0, 0);
    expect(localDay(earlyMorningLocal.toISOString())).toBe('2026-08-20');
  });

  it('agrees with todayIso for the same instant', () => {
    const now = new Date(2026, 7, 20, 4, 0, 0);
    expect(localDay(now.toISOString())).toBe(todayIso(now));
  });

  it('keeps a late-evening timestamp on its own day', () => {
    const lateLocal = new Date(2026, 7, 20, 23, 45, 0);
    expect(localDay(lateLocal.toISOString())).toBe('2026-08-20');
  });
});
