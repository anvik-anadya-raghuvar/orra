import type { Profile } from '../types';

export type CredentialResult =
  | { ok: true; profile: Profile }
  | { ok: false; reason: 'unknown_email' | 'wrong_password' | 'no_local_credentials' };

/**
 * Pure mock-mode credential check — unit-tested in auth.test.ts.
 *
 * Fails closed: production builds strip the seeded dev passwords, so a profile
 * with no password can never be signed into. Mock mode is a local development
 * convenience, never a production authentication path.
 */
export function checkCredentials(
  profiles: Profile[],
  email: string,
  password: string,
): CredentialResult {
  const normalized = email.trim().toLowerCase();
  const profile = profiles.find((p) => p.email.toLowerCase() === normalized);
  if (!profile) return { ok: false, reason: 'unknown_email' };
  if (!profile.password) return { ok: false, reason: 'no_local_credentials' };
  if (profile.password !== password) return { ok: false, reason: 'wrong_password' };
  return { ok: true, profile };
}
