import { describe, expect, it } from 'vitest';
import { QUOTES, quoteForDate } from './quotes';

describe('quote of the day', () => {
  it('gives the same day the same quote, so you can mention it to each other', () => {
    expect(quoteForDate('2026-08-19')).toEqual(quoteForDate('2026-08-19'));
  });

  it('changes from one day to the next', () => {
    const week = ['19', '20', '21', '22', '23'].map((d) => quoteForDate(`2026-08-${d}`).text);
    expect(new Set(week).size).toBeGreaterThan(1);
  });

  it('spreads across the bank rather than favouring a few', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 120; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      seen.add(quoteForDate(d).text);
    }
    // 120 days should touch most of a 40-line bank
    expect(seen.size).toBeGreaterThan(QUOTES.length / 2);
  });

  it('always returns a real, attributed line', () => {
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10);
      const q = quoteForDate(d);
      expect(q.text.length).toBeGreaterThan(10);
      expect(q.who.length).toBeGreaterThan(2);
    }
  });

  it('has no duplicate lines in the bank', () => {
    expect(new Set(QUOTES.map((q) => q.text)).size).toBe(QUOTES.length);
  });
});
