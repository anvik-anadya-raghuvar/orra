import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useData, useStore } from '../data/store';
import { checkCredentials } from '../lib/auth';
import { getSupabase, isRecoveryUrl } from '../lib/supabaseClient';
import { entrance } from './motion';
import './gate.css';

/**
 * Sign-in gate — email + password for the member accounts.
 * Mock mode: checked against the local profile credentials.
 * Supabase mode: signInWithPassword, plus a real reset-password flow.
 *
 * Visually it is the N:OW cold open: black, one word in signal red, and the
 * form. The app's whole theme waits on the other side of the door.
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

  /* The ember that follows the pointer. PointerLight only exists inside the
     signed-in shell, so the gate carries its own — same discipline: one write
     per frame, no React state, and it does not run without a fine pointer or
     under reduced motion. */
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || still) return;
    let frame = 0;
    let next: { x: number; y: number } | null = null;
    const paint = () => {
      frame = 0;
      if (!next) return;
      el.style.setProperty('--gx', `${next.x}px`);
      el.style.setProperty('--gy', `${next.y}px`);
    };
    const onMove = (e: PointerEvent) => {
      next = { x: e.clientX, y: e.clientY };
      if (!frame) frame = requestAnimationFrame(paint);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

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
        // Mock workspaces use separate localStorage datasets. Reload after the
        // identity is saved so the selected account gets its own adapter key.
        try {
          localStorage.setItem('anvik:signedin', '1');
        } catch {}
        window.location.reload();
        return;
      }
      try {
        localStorage.setItem('anvik:signedin', '1');
      } catch {}
      onEnter();
    } finally {
      setBusy(false);
    }
  };

  const rise = (delay: number) => ({
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0, transition: { ...entrance, delay } },
  });

  return (
    <div className="gate" ref={rootRef}>
      <div className="gate-void" aria-hidden />
      <div className="gate-stage">
        <div className="gate-hero">
          <motion.div className="gate-brand" {...rise(0)}>
            <i aria-hidden>A</i> ANVIK&nbsp;OPS
          </motion.div>
          <div className="now-mark" aria-hidden>
            <span className="now-size">N:OW</span>
            <motion.span
              className="now-slice now-s1"
              initial={{ opacity: 0, x: -26 }}
              animate={{ opacity: 1, x: 0, transition: { ...entrance, delay: 0.06 } }}
            >
              N:OW
            </motion.span>
            <motion.span
              className="now-slice now-s2"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: '-0.045em', transition: { ...entrance, delay: 0.14 } }}
            >
              N:OW
            </motion.span>
            <motion.span
              className="now-slice now-s3"
              initial={{ opacity: 0, x: -18 }}
              animate={{ opacity: 1, x: '0.055em', transition: { ...entrance, delay: 0.22 } }}
            >
              N:OW
            </motion.span>
          </div>
          <motion.h1 className="gate-h1" {...rise(0.26)}>
            The day is already running.
          </motion.h1>
          <motion.p className="gate-sub" {...rise(0.3)}>
            Two people, eight rooms, one quiet place. Sign in and pick it up where you left it.
          </motion.p>
        </div>

        <motion.div
          className="gate-panel"
          initial={{ opacity: 0, y: 22, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { ...entrance, delay: 0.18 } }}
        >
          {mode === 'recover' ? (
            <form onSubmit={applyNewPassword}>
              <p className="gate-lead">Set a new password for your account.</p>
              <label className="glab" htmlFor="gate-new">
                New password
              </label>
              <input
                id="gate-new"
                className="gin"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 8 characters"
                required
              />
              <label className="glab" htmlFor="gate-new2">
                Repeat
              </label>
              <input
                id="gate-new2"
                className="gin"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
              {error && (
                <p role="alert" className="gerr">
                  {error}
                </p>
              )}
              <button type="submit" className="gbtn" disabled={busy}>
                {busy ? 'Saving…' : 'Set password and sign in'}
              </button>
            </form>
          ) : mode === 'forgot' ? (
            <form onSubmit={sendReset}>
              <p className="gate-lead">
                We&apos;ll email a link that brings you straight back here to set a new password.
              </p>
              <label className="glab" htmlFor="gate-fmail">
                Email
              </label>
              <input
                id="gate-fmail"
                className="gin"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@anvik"
                required
              />
              {error && (
                <p role="alert" className="gerr">
                  {error}
                </p>
              )}
              <button type="submit" className="gbtn" disabled={busy}>
                {busy ? 'Sending…' : 'Send reset link'}
              </button>
              <button
                type="button"
                className="glink"
                onClick={() => {
                  setMode('signin');
                  setError(null);
                }}
              >
                Back to sign in
              </button>
            </form>
          ) : (
            <form onSubmit={signIn}>
              <label className="glab" htmlFor="gate-email">
                Email
              </label>
              <input
                id="gate-email"
                className="gin"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@anvik"
                required
              />
              <label className="glab" htmlFor="gate-pw">
                Password
              </label>
              <input
                id="gate-pw"
                className="gin"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
              {error && (
                <p role="alert" className="gerr">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="gnote">
                  {notice}
                </p>
              )}
              <button type="submit" className="gbtn" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
              <button
                type="button"
                className="glink"
                onClick={() => {
                  setMode('forgot');
                  setError(null);
                  setNotice(null);
                }}
              >
                Forgot password?
              </button>
            </form>
          )}
          <p className="gate-foot">
            Member accounts only. Change your password any time from the account menu.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
