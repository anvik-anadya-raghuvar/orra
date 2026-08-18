import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useData, useStore } from '../data/store';
import { checkCredentials } from '../lib/auth';
import { entrance } from './motion';

/**
 * Sign-in gate — email + password for the two member accounts.
 * Mock mode: checked against the local profile credentials (temp passwords
 * Anadya@2026 / Raghuvar@2026, changeable from the account menu).
 * Supabase mode: signInWithPassword against Supabase email auth.
 */
export function Gate({ onEnter }: { onEnter: () => void }) {
  const store = useStore();
  const profiles = useData((ds) => ds.profiles);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const normalized = email.trim().toLowerCase();
      if (store.adapter.kind === 'supabase') {
        const { createClient } = await import('@supabase/supabase-js');
        const sb = createClient(
          import.meta.env.VITE_SUPABASE_URL!,
          import.meta.env.VITE_SUPABASE_ANON_KEY!,
        );
        const { error: err } = await sb.auth.signInWithPassword({ email: normalized, password });
        if (err) {
          setError(err.message);
          return;
        }
      } else {
        const res = checkCredentials(profiles, normalized, password);
        if (!res.ok) {
          setError(
            res.reason === 'unknown_email'
              ? 'This address is not on the Anvik Ops member list.'
              : res.reason === 'no_local_credentials'
                ? 'This build has no local credentials. Connect Supabase (VITE_SUPABASE_URL) to sign in.'
                : 'Wrong password for this account.',
          );
          return;
        }
        store.setMe(res.profile.id);
      }
      try {
        localStorage.setItem('anvik:signedin', '1');
      } catch {}
      onEnter();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20 }}>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1, transition: entrance }}
        style={{
          background: 'var(--surf)',
          border: '1px solid var(--line)',
          borderRadius: 24,
          boxShadow: 'var(--sh2)',
          maxWidth: 920,
          width: '100%',
          overflow: 'hidden',
        }}
      >
        <div className="gate-grid">
          <div style={{ padding: '46px 42px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 17 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div
                style={{
                  width: 33,
                  height: 33,
                  borderRadius: 11,
                  display: 'grid',
                  placeItems: 'center',
                  color: '#fff',
                  fontFamily: '"Space Grotesk"',
                  fontWeight: 700,
                  background: 'linear-gradient(145deg,var(--violet),var(--indigo))',
                  boxShadow: '0 6px 16px var(--glow)',
                  transform: 'rotate(-4deg)',
                }}
              >
                A
              </div>
              <span className="disp" style={{ fontSize: 17 }}>Anvik Ops</span>
            </div>
            <h1 style={{ fontSize: 35, lineHeight: 1.08 }}>
              Everything, in{' '}
              <em
                style={{
                  fontStyle: 'normal',
                  background: 'linear-gradient(100deg,var(--violet),var(--indigo))',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  color: 'transparent',
                }}
              >
                one quiet place
              </em>
              .
            </h1>
            <form onSubmit={signIn} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 340 }}>
              <label className="eyebrow" htmlFor="gate-email">Email</label>
              <input
                id="gate-email"
                className="srch"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@anvik"
                required
                style={{ flex: 'none' }}
              />
              <label className="eyebrow" htmlFor="gate-pw">Password</label>
              <input
                id="gate-pw"
                className="srch"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={{ flex: 'none' }}
              />
              {error && (
                <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--rose)' }}>
                  {error}
                </p>
              )}
              <button type="submit" className="btn solid" disabled={busy} style={{ padding: '13px 22px', fontSize: 14.5 }}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <p style={{ fontSize: 13, color: 'var(--mute)', borderLeft: '2px solid var(--stamp)', paddingLeft: 12, margin: 0 }}>
              Two member accounts only. Temp passwords were shared privately — change yours from
              the account menu after signing in.
            </p>
          </div>
          <div
            style={{
              padding: '38px 32px',
              background: 'linear-gradient(165deg,#1A1E33,#0D1120)',
              color: '#EAEEF6',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 14,
            }}
          >
            <div className="eyebrow" style={{ color: '#8A93AB' }}>Running on</div>
            {[
              ['₹0', 'per month, forever'],
              ['2', 'people · Anadya and Raghuvar'],
              ['IST ⇄ CET', 'built for the gap'],
            ].map(([b, s]) => (
              <div key={s} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                <b style={{ fontFamily: '"Space Grotesk"', fontSize: 26, fontWeight: 500 }}>{b}</b>
                <span style={{ color: '#99A2B7', fontSize: 13 }}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
