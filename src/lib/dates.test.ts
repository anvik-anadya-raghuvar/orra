import { describe, expect, it } from 'vitest';
import { todayIso } from './dates';

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
