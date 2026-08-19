import React, { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { motion, MotionGlobalConfig } from 'framer-motion';
import {
  Home as HomeIcon,
  KanbanSquare,
  Heart,
  BookOpen,
  Users,
  User,
  Wallet,
  Shield,
  Menu,
} from 'lucide-react';
import { StoreProvider, useData, useStore, useSyncError } from './data/store';
import { ToastProvider, Avatar, Skeleton, Modal, SideSheet } from './ui/bits';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Gate } from './ui/gate';
import { getSupabase } from './lib/supabaseClient';
import { NotificationBell, NotificationProvider } from './ui/notifications';
import BlockOverlay from './ui/BlockOverlay';
import PointerLight from './ui/PointerLight';
import ClipWatch from './ui/ClipWatch';
import { useAutoSync } from './lib/useAutoSync';
import { activeBlockFor } from './lib/blocks';
import { pageRise } from './ui/motion';
import { clockIn, TZ_IN, TZ_IT } from './lib/dates';

const Home = lazy(() => import('./screens/home'));
const Work = lazy(() => import('./screens/work'));
const TaskDetail = lazy(() => import('./screens/task'));
const Us = lazy(() => import('./screens/us'));
const Knowledge = lazy(() => import('./screens/knowledge'));
const People = lazy(() => import('./screens/people'));
const Personal = lazy(() => import('./screens/personal'));
const Money = lazy(() => import('./screens/money'));
const Admin = lazy(() => import('./screens/admin'));

const NAV = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/work', label: 'Work', icon: KanbanSquare },
  { to: '/us', label: 'Us', icon: Heart },
  { to: '/knowledge', label: 'Notebook', icon: BookOpen },
  { to: '/people', label: 'People', icon: Users },
  { to: '/personal', label: 'Personal', icon: User },
  { to: '/money', label: 'Money', icon: Wallet },
  { to: '/admin', label: 'Settings', icon: Shield },
];

/** The four rooms used every day; every other room lives behind one More tab. */
const MOBILE_NAV = ['/', '/work', '/us', '/personal'].map(
  (to) => NAV.find((n) => n.to === to)!,
);
const MOBILE_MORE = NAV.filter((item) => !MOBILE_NAV.some((primary) => primary.to === item.to));

function useTheme() {
  const [theme, setTheme] = useState(
    () => document.documentElement.getAttribute('data-theme') ?? 'light',
  );
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('anvik:theme', JSON.stringify(theme));
    } catch {}
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

function AccountMenu() {
  const store = useStore();
  const me = useData((_, s) => s.me);
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) {
      setMsg('New password needs at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setMsg('New passwords do not match.');
      return;
    }
    if (store.adapter.kind === 'supabase') {
      const sb = await getSupabase();
      const { error } = await sb.auth.updateUser({ password: next });
      if (error) {
        setMsg(error.message);
        return;
      }
    } else {
      if ((me.password ?? '') !== current) {
        setMsg('Current password is wrong.');
        return;
      }
      // silent: the password must never appear in the audit trail
      store.update('profiles', me.id, { password: next }, { ...store.asMe(), silent: true });
    }
    setPwOpen(false);
    setCurrent('');
    setNext('');
    setConfirm('');
  };

  const signOut = async () => {
    try {
      localStorage.removeItem('anvik:signedin');
    } catch {}
    if (store.adapter.kind === 'supabase') {
      // Revoke the real session too, not just the UI flag.
      const sb = await getSupabase();
      await sb.auth.signOut().catch(() => {});
    }
    window.location.href = '/';
  };

  return (
    <div style={{ position: 'relative' }}>
      <button
        className="chip"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
      >
        <Avatar userId={me.id} /> {me.name}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            background: 'var(--surf)',
            border: '1px solid var(--line)',
            borderRadius: 12,
            boxShadow: 'var(--sh2)',
            padding: 8,
            zIndex: 55,
            minWidth: 220,
          }}
        >
          <div style={{ padding: '6px 10px', fontSize: 12, color: 'var(--mute)' }} className="mono">
            {me.email}
          </div>
          <button
            role="menuitem"
            className="btn sm"
            style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, boxShadow: 'none', minHeight: 44 }}
            onClick={() => {
              setOpen(false);
              setPwOpen(true);
            }}
          >
            Change password
          </button>
          <button
            role="menuitem"
            className="btn sm"
            style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, boxShadow: 'none', minHeight: 44, color: 'var(--rose)' }}
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      )}
      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title="Change password">
        <form onSubmit={changePassword} style={{ display: 'grid', gap: 10 }}>
          {store.adapter.kind !== 'supabase' && (
            <input
              className="srch"
              type="password"
              placeholder="Current password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
              style={{ flex: 'none' }}
            />
          )}
          <input
            className="srch"
            type="password"
            placeholder="New password (min 8 chars)"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            style={{ flex: 'none' }}
          />
          <input
            className="srch"
            type="password"
            placeholder="Repeat new password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            style={{ flex: 'none' }}
          />
          {msg && (
            <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--rose)' }}>
              {msg}
            </p>
          )}
          <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setPwOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn solid">
              Update password
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function Header() {
  const { theme, toggle } = useTheme();
  const [clock, setClock] = useState(() => `IST ${clockIn(TZ_IN)} · CET ${clockIn(TZ_IT)}`);
  useEffect(() => {
    // Every 10s rather than 30: a clock that visibly lags is worse than none.
    const t = setInterval(() => setClock(`IST ${clockIn(TZ_IN)} · CET ${clockIn(TZ_IT)}`), 10_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="bar" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
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
      <span className="disp" style={{ fontSize: 17 }}>
        Anvik Ops
      </span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--mute)' }}>{clock}</span>
      <RunningBlockBadge />
      <div className="spacer" />
      <NotificationBell />
      <AccountMenu />
      <button className="chip" onClick={toggle} aria-label="Toggle theme">
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
    </div>
  );
}

function Nav() {
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const moreActive = MOBILE_MORE.some((item) => location.pathname === item.to);
  return (
    <>
      <nav className="nav-pills" aria-label="Primary">
        {NAV.map(({ to, label }) => (
          <NavLink key={to} to={to} end={to === '/'}>
            {label}
          </NavLink>
        ))}
      </nav>
      <nav className="tabbar" aria-label="Primary">
        {MOBILE_NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}>
            <Icon size={18} strokeWidth={1.8} />
            {label}
          </NavLink>
        ))}
        <button
          type="button"
          className={moreActive ? 'active' : undefined}
          aria-label="More rooms"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
        >
          <Menu size={18} strokeWidth={1.8} />
          More
        </button>
      </nav>
      <SideSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="More rooms"
        subtitle="Everything stays reachable without squeezing eight destinations into a phone bar."
      >
        <nav className="mobile-more" aria-label="More rooms">
          {MOBILE_MORE.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} onClick={() => setMoreOpen(false)}>
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </SideSheet>
    </>
  );
}

/** A background save/delete that failed — visible until the next one succeeds, not a toast that vanishes in 2.6s. */
function SyncErrorBanner() {
  const err = useSyncError();
  if (!err) return null;
  return (
    <div
      role="alert"
      style={{
        background: 'var(--rose)',
        color: '#fff',
        borderRadius: 12,
        padding: '10px 14px',
        fontSize: 13,
        marginBottom: 12,
      }}
    >
      {err} — your change may not have saved. Check your connection and try again.
    </div>
  );
}

function ScreenFallback() {
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Skeleton h={120} />
      <Skeleton h={200} />
      <Skeleton h={160} />
    </div>
  );
}

function NotFound() {
  return (
    <section className="card" style={{ maxWidth: 680, margin: '40px auto', padding: 28 }}>
      <p className="eyebrow">Page not found</p>
      <h1 style={{ marginTop: 8 }}>This room does not exist.</h1>
      <p className="tip">The link may be old, or the address may have been typed incorrectly.</p>
      <NavLink className="btn solid" to="/">
        Back home
      </NavLink>
    </section>
  );
}

function AnimatedRoutes() {
  const location = useLocation();
  return (
    // The previous `mode="wait"` boundary could strand the old room when a
    // hidden/background tab throttled its exit animation: the URL changed but
    // the prior screen stayed mounted. Swap the route synchronously and animate
    // only the arriving page, so navigation can never depend on animation.
    <motion.div key={location.pathname} variants={pageRise} initial="initial" animate="animate">
      <Suspense fallback={<ScreenFallback />}>
        <Routes location={location}>
          <Route path="/" element={<Home />} />
          <Route path="/work" element={<Work />} />
          <Route path="/task/:id" element={<TaskDetail />} />
          <Route path="/us" element={<Us />} />
          <Route path="/knowledge" element={<Knowledge />} />
          <Route path="/people" element={<People />} />
          <Route path="/personal" element={<Personal />} />
          <Route path="/money" element={<Money />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </motion.div>
  );
}

/**
 * A block running elsewhere in the portal, shown in the header.
 *
 * The overlay covers the screen while a block runs, so this is mostly for the
 * moment after it is dismissed — but it is also the one honest "something is
 * happening right now" indicator the shell has.
 */
function RunningBlockBadge() {
  const ds = useData((d) => d);
  const meId = useData((_, s) => s.meId);
  const block = activeBlockFor(ds, meId);
  if (!block) return null;
  const running = !block.paused_at;
  return (
    <span className="hdr-live" title={running ? 'A block is running' : 'A block is paused'}>
      <span className={`live-dot${running ? '' : ' calm warn'}`} aria-hidden />
      <span className="mono">{running ? 'in a block' : 'paused'}</span>
    </span>
  );
}

/** Keeps the calendar current while the portal is open. Renders nothing. */
function AutoSync() {
  useAutoSync(useStore());
  return null;
}

function Gated() {
  const [signedIn, setSignedIn] = useState(() => {
    try {
      return localStorage.getItem('anvik:signedin') === '1';
    } catch {
      return false;
    }
  });
  if (!signedIn) return <Gate onEnter={() => setSignedIn(true)} />;
  return (
    <BrowserRouter>
      <NotificationProvider>
        <PointerLight />
        <ClipWatch />
        <div className="shell">
          <Header />
          <SyncErrorBanner />
          <Nav />
          <main id="main-content">
            <ErrorBoundary>
              <AnimatedRoutes />
            </ErrorBoundary>
          </main>
          {/* A running block covers the whole portal, so it is mounted here
              rather than inside a screen — navigating cannot escape it, and a
              reload restores it because the block lives in the database. */}
          <BlockOverlay />
          <AutoSync />
        </div>
      </NotificationProvider>
    </BrowserRouter>
  );
}

/**
 * Keep the skip-animations flag in step with visibility. The initial value is
 * set in main.tsx before the first render (see the note there); this only
 * handles the tab being hidden or restored later.
 */
function useSkipAnimationsWhenHidden() {
  useEffect(() => {
    const sync = () => {
      MotionGlobalConfig.skipAnimations = document.visibilityState !== 'visible';
    };
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
}

export default function App() {
  useSkipAnimationsWhenHidden();
  return (
    <ErrorBoundary>
      <StoreProvider>
        <ToastProvider>
          <Gated />
        </ToastProvider>
      </StoreProvider>
    </ErrorBoundary>
  );
}
