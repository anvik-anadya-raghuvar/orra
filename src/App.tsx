import React, { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, MotionGlobalConfig } from 'framer-motion';
import {
  Home as HomeIcon,
  KanbanSquare,
  Heart,
  BookOpen,
  Users,
  User,
  Wallet,
  Shield,
} from 'lucide-react';
import { StoreProvider, useData, useStore } from './data/store';
import { ToastProvider, Avatar, Skeleton, Modal } from './ui/bits';
import { Gate } from './ui/gate';
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
  { to: '/knowledge', label: 'Knowledge', icon: BookOpen },
  { to: '/people', label: 'People', icon: Users },
  { to: '/personal', label: 'Personal', icon: User },
  { to: '/money', label: 'Money', icon: Wallet },
  { to: '/admin', label: 'Admin', icon: Shield },
];

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
      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(
        import.meta.env.VITE_SUPABASE_URL!,
        import.meta.env.VITE_SUPABASE_ANON_KEY!,
      );
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
      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(
        import.meta.env.VITE_SUPABASE_URL!,
        import.meta.env.VITE_SUPABASE_ANON_KEY!,
      );
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
    const t = setInterval(
      () => setClock(`IST ${clockIn(TZ_IN)} · CET ${clockIn(TZ_IT)}`),
      30_000,
    );
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
      <div className="spacer" />
      <AccountMenu />
      <button className="chip" onClick={toggle} aria-label="Toggle theme">
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
    </div>
  );
}

function Nav() {
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
        {NAV.slice(0, 5)
          .concat(NAV.slice(6, 7))
          .map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <Icon size={18} strokeWidth={1.8} />
              {label}
            </NavLink>
          ))}
      </nav>
    </>
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

function AnimatedRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div key={location.pathname} variants={pageRise} initial="initial" animate="animate" exit="exit">
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
          </Routes>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
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
      <div className="shell">
        <Header />
        <Nav />
        <AnimatedRoutes />
      </div>
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
    <StoreProvider>
      <ToastProvider>
        <Gated />
      </ToastProvider>
    </StoreProvider>
  );
}
