import { describe, expect, it } from 'vitest';
import {
  blockedBy,
  canInvite,
  emptyInvites,
  IDLE_BEFORE_MS,
  INVITE_CAP,
  INVITE_GAP_MS,
  noteInvite,
  pickInvite,
  type InviteContext,
} from './companionInvite';
import { BANDS } from './companionMood';
import { GAME_IDS, GAMES, SOLO_IDS } from './companionGames';

const NOW = 1_800_000_000_000;
const TODAY = '2026-08-18';

/** A robot with every excuse removed: he may ask. */
const OPEN: InviteContext = {
  now: NOW,
  today: TODAY,
  chattiness: 'normal',
  band: 'happy',
  memory: emptyInvites(),
  playful: true,
  dense: false,
  quiet: false,
  busy: false,
  blocked: false,
  idleMs: IDLE_BEFORE_MS + 1,
  animate: true,
};

const at = (over: Partial<InviteContext>): InviteContext => ({ ...OPEN, ...over });

describe('the gate', () => {
  it('lets him ask when nothing at all is in the way', () => {
    expect(blockedBy(OPEN)).toBeNull();
    expect(canInvite(OPEN)).toBe(true);
  });

  it.each([
    ['calmed-down', { playful: false }],
    ['focus-block', { blocked: true }],
    ['quiet-hours', { quiet: true }],
    ['dense-room', { dense: true }],
    ['busy', { busy: true }],
    ['out-of-sorts', { band: 'sulking' as const }],
    ['too-soon-after-you', { idleMs: 0 }],
    ['chattiness', { chattiness: 'quiet' as const }],
  ])('never asks while %s', (reason, over) => {
    expect(blockedBy(at(over))).toBe(reason);
    expect(canInvite(at(over))).toBe(false);
    expect(pickInvite(at(over))).toBeNull();
  });

  it('never asks in either band where he is out of sorts', () => {
    for (const band of BANDS) {
      const allowed = canInvite(at({ band }));
      expect(allowed).toBe(band !== 'sulking' && band !== 'grumpy');
    }
  });

  /**
   * The single most important clause: a focus block outranks every other
   * reason he might have to be cheerful.
   */
  it('stays silent during a block even when everything else says go', () => {
    expect(
      canInvite(at({ blocked: true, band: 'delighted', chattiness: 'chatty', idleMs: 1e9 })),
    ).toBe(false);
  });
});

describe('the budget', () => {
  it('is spent by asking, and refuses once it runs out', () => {
    let memory = emptyInvites();
    const cap = INVITE_CAP.normal;
    for (let i = 0; i < cap; i++) {
      expect(canInvite(at({ memory }))).toBe(true);
      memory = noteInvite(memory, TODAY, NOW - INVITE_GAP_MS.normal * (cap - i));
    }
    expect(memory.count).toBe(cap);
    expect(blockedBy(at({ memory }))).toBe('daily-cap');
  });

  it('rolls over on a new day', () => {
    const spent = { day: TODAY, count: INVITE_CAP.normal, lastAt: 0 };
    expect(canInvite(at({ memory: spent, today: '2026-08-19' }))).toBe(true);
  });

  it('keeps a gap between offers', () => {
    const justAsked = { day: TODAY, count: 1, lastAt: NOW - 1_000 };
    expect(blockedBy(at({ memory: justAsked }))).toBe('too-soon-again');
    const longAgo = { day: TODAY, count: 1, lastAt: NOW - INVITE_GAP_MS.normal - 1 };
    expect(canInvite(at({ memory: longAgo }))).toBe(true);
  });

  it('gives a chatty robot a shorter gap and a bigger allowance', () => {
    expect(INVITE_GAP_MS.chatty).toBeLessThan(INVITE_GAP_MS.normal);
    expect(INVITE_CAP.chatty).toBeGreaterThan(INVITE_CAP.normal);
  });

  it('gives a quiet one none of either, ever', () => {
    expect(INVITE_CAP.quiet).toBe(0);
    expect(INVITE_GAP_MS.quiet).toBe(Number.POSITIVE_INFINITY);
    for (const band of BANDS) {
      expect(canInvite(at({ chattiness: 'quiet', band, memory: emptyInvites() }))).toBe(false);
    }
  });
});

describe('what he offers', () => {
  it('only offers something real', () => {
    const id = pickInvite(OPEN);
    expect(id).not.toBeNull();
    expect(GAME_IDS).toContain(id!);
  });

  it('never offers a game that needs the other person', () => {
    for (let i = 0; i < 40; i++) {
      const id = pickInvite(at({ now: NOW + i * 60_000 }));
      if (id) expect(GAMES[id].players).toBe(1);
    }
  });

  it('is deterministic within a minute, so two renders cannot disagree', () => {
    expect(pickInvite(at({ now: NOW }))).toBe(pickInvite(at({ now: NOW + 999 })));
  });

  it('moves on, rather than offering the same thing forever', () => {
    const seen = new Set(
      Array.from({ length: SOLO_IDS.length }, (_, i) => pickInvite(at({ now: NOW + i * 60_000 }))),
    );
    expect(seen.size).toBe(SOLO_IDS.length);
  });

  it('never offers one you switched off', () => {
    const disabled = Object.fromEntries(SOLO_IDS.slice(1).map((id) => [id, true]));
    for (let i = 0; i < 20; i++) {
      expect(pickInvite(at({ now: NOW + i * 60_000, disabled }))).toBe(SOLO_IDS[0]);
    }
  });

  it('offers nothing when you have switched them all off', () => {
    const disabled = Object.fromEntries(GAME_IDS.map((id) => [id, true]));
    expect(pickInvite(at({ disabled }))).toBeNull();
  });
});
