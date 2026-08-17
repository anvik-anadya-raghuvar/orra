import React, { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
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
import { ToastProvider, Avatar, Skeleton } from './ui/bits';
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

function Header() {
  const { theme, toggle } = useTheme();
  const store = useStore();
  const me = useData((_, s) => s.me);
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
      <button
        className="chip"
        onClick={() => store.setMe(store.other.id)}
        title="Switch signed-in user (mock auth)"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
      >
        <Avatar userId={me.id} /> {me.name}
      </button>
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

export default function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <BrowserRouter>
          <div className="shell">
            <Header />
            <Nav />
            <AnimatedRoutes />
          </div>
        </BrowserRouter>
      </ToastProvider>
    </StoreProvider>
  );
}
