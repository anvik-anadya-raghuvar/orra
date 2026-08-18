import { describe, expect, it } from 'vitest';
import { seedDataset } from '../data/seed';
import { checkCredentials } from './auth';

describe('member sign-in (mock mode)', () => {
  const profiles = seedDataset().profiles;

  it('accepts both member accounts with their temp passwords', () => {
    const a = checkCredentials(profiles, 'anvik.anadya@gmail.com', 'Anadya@2026');
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.profile.name).toBe('Anadya');
    const r = checkCredentials(profiles, 'RAGHUVAR.ANVIK@GMAIL.COM ', 'Raghuvar@2026');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.profile.name).toBe('Raghuvar');
  });

  it('rejects a wrong password', () => {
    const res = checkCredentials(profiles, 'anvik.anadya@gmail.com', 'nope');
    expect(res).toEqual({ ok: false, reason: 'wrong_password' });
  });

  it('rejects a non-member address', () => {
    const res = checkCredentials(profiles, 'stranger@gmail.com', 'Anadya@2026');
    expect(res).toEqual({ ok: false, reason: 'unknown_email' });
  });

  it('fails closed when the build carries no local credentials', () => {
    // production builds strip the dev passwords — nobody gets in via mock mode
    const stripped = profiles.map((p) => ({ ...p, password: undefined }));
    expect(checkCredentials(stripped, 'anvik.anadya@gmail.com', '')).toEqual({
      ok: false,
      reason: 'no_local_credentials',
    });
    expect(checkCredentials(stripped, 'anvik.anadya@gmail.com', 'Anadya@2026').ok).toBe(false);
  });

  it('a changed password takes effect and the old one stops working', () => {
    const updated = profiles.map((p) =>
      p.email === 'anvik.anadya@gmail.com' ? { ...p, password: 'NewSecret@99' } : p,
    );
    expect(checkCredentials(updated, 'anvik.anadya@gmail.com', 'Anadya@2026').ok).toBe(false);
    expect(checkCredentials(updated, 'anvik.anadya@gmail.com', 'NewSecret@99').ok).toBe(true);
  });
});
