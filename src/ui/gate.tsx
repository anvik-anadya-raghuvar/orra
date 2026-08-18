import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useData, useStore } from '../data/store';
import { checkCredentials } from '../lib/auth';
import { getSupabase, isRecoveryUrl } from '../lib/supabaseClient';
import { entrance } from './motion';

/**
 * Sign-in gate — email + password for the member accounts.
 * Mock mode: checked against the local profile credentials.
 * Supabase mode: signInWithPassword, plus a real reset-password flow.
 */
export function Gate({ onEnter }: { onEnter: () => void }) {
  const store = useStore();
  const profiles = useData((ds) => ds.profiles);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'signin' | 'forgot' | 'recover'>('signin');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const isSupabase = store.adapter.kind === 'supabase';

  // Landing back from a reset email → show the "set a new password" form.
  useEffect(() => {
    if (!isSupabase || !isRecoveryUrl()) return;
    setMode('recover');
    void getSupabase().then((sb) =>
      sb.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') setMode('recover');
      }),
    );
  }, [isSupabase]);

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      setError('Enter your email address first.');
      return;
    }
    setBusy(true);
    try {
      if (!isSupabase) {
        setError('Password reset needs the Supabase backend. In local mode, use the account menu.');
        return;
      }
      const sb = await getSupabase();
      const { error: err } = await sb.auth.resetPasswordForEmail(normalized, {
        redirectTo: `${window.location.origin}/`,
      });
      if (err) {
        setError(err.message);
        return;
      }
      // Deliberately not confirming whether the address exists.
      setNotice(
        `If ${normalized} is a member account, a reset link is on its way. The link opens right back here.`,
      );
      setMode('signin');
    } finally {
      setBusy(false);
    }
  };

  const applyNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (newPassword.length < 8) {
      setError('New password needs at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const sb = await getSupabase();
      const { error: err } = await sb.auth.updateUser({ password: newPassword });
      if (err) {
        setError(err.message);
        return;
      }
      // Clear the recovery fragment so a refresh doesn't re-enter this mode.
      window.history.replaceState({}, '', window.location.pathname);
      try {
        localStorage.setItem('anvik:signedin', '1');
      } catch {}
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const normalized = email.trim().toLowerCase();
      if (isSupabase) {
        const sb = await getSupabase();
        const { error: err } = await sb.auth.signInWithPassword({ email: normalized, password });
        if (err) {
          setError(err.message);
          return;
        }
        // The store booted with the anonymous (empty) dataset. Reload so the
        // adapter refetches everything as the authenticated member.
        try {
          localStorage.setItem('anvik:signedin', '1');
        } catch {}
        window.location.reload();
        return;
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
            {mode === 'recover' ? (
              <form onSubmit={applyNewPassword} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 340 }}>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--slate)' }}>
                  Set a new password for your account.
                </p>
                <label className="eyebrow" htmlFor="gate-new">New password</label>
                <input
                  id="gate-new"
                  className="srch"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  style={{ flex: 'none' }}
                />
                <label className="eyebrow" htmlFor="gate-new2">Repeat</label>
                <input
                  id="gate-new2"
                  className="srch"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
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
                  {busy ? 'Saving…' : 'Set password and sign in'}
                </button>
              </form>
            ) : mode === 'forgot' ? (
              <form onSubmit={sendReset} style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 340 }}>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--slate)' }}>
                  We'll email a link that brings you straight back here to set a new password.
                </p>
                <label className="eyebrow" htmlFor="gate-fmail">Email</label>
                <input
                  id="gate-fmail"
                  className="srch"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@anvik"
                  required
                  style={{ flex: 'none' }}
                />
                {error && (
                  <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--rose)' }}>
                    {error}
                  </p>
                )}
                <button type="submit" className="btn solid" disabled={busy} style={{ padding: '13px 22px', fontSize: 14.5 }}>
                  {busy ? 'Sending…' : 'Send reset link'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setMode('signin');
                    setError(null);
                  }}
                  style={{ background: 'none', boxShadow: 'none', border: 0, color: 'var(--indigo)' }}
                >
                  Back to sign in
                </button>
              </form>
            ) : (
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
                {notice && (
                  <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--teal)' }}>
                    {notice}
                  </p>
                )}
                <button type="submit" className="btn solid" disabled={busy} style={{ padding: '13px 22px', fontSize: 14.5 }}>
                  {busy ? 'Signing in…' : 'Sign in'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot');
                    setError(null);
                    setNotice(null);
                  }}
                  style={{
                    background: 'none',
                    border: 0,
                    color: 'var(--indigo)',
                    fontSize: 13,
                    textAlign: 'left',
                    padding: '4px 0',
                    minHeight: 44,
                  }}
                >
                  Forgot password?
                </button>
              </form>
            )}
            <p style={{ fontSize: 13, color: 'var(--mute)', borderLeft: '2px solid var(--stamp)', paddingLeft: 12, margin: 0 }}>
              Member accounts only. Change your password any time from the account menu.
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
