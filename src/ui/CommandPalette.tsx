/**
 * Find anything, from anywhere.
 *
 * Ctrl/Cmd+K, or the header's search button on a phone. It searches every
 * room at once (see lib/search.ts), offers the handful of actions worth
 * reaching without navigating first, and — when nothing matches what you
 * typed — offers to keep it as a scribble. That last one matters more than
 * it looks: quick capture used to exist only on Home, so a thought you had
 * while looking at the Money room had nowhere to go.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CornerDownLeft, Plus, Search } from 'lucide-react';
import { newId, nowIso, useData, useStore } from '../data/store';
import { setJump } from '../lib/jump';
import {
  KIND_LABEL,
  buildSearchItems,
  routeFor,
  searchItems,
  type SearchItem,
  type SearchKind,
} from '../lib/search';
import { useToast } from './bits';
import { entrance, micro } from './motion';
import './commandPalette.css';

interface Action {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

/** Rooms worth jumping to by name. Mirrors the nav, minus wherever you are. */
const ROOMS: { to: string; label: string }[] = [
  { to: '/', label: 'Home' },
  { to: '/work', label: 'Work' },
  { to: '/us', label: 'Us' },
  { to: '/knowledge', label: 'Notebook' },
  { to: '/people', label: 'People' },
  { to: '/personal', label: 'Personal' },
  { to: '/money', label: 'Money' },
  { to: '/admin', label: 'Settings' },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const navigate = useNavigate();
  const store = useStore();
  const toast = useToast();
  const reduced = useReducedMotion();
  const ds = useData((data) => data);
  const input = useRef<HTMLInputElement | null>(null);

  // Ctrl/Cmd+K from anywhere. preventDefault matters: the same chord focuses
  // the address bar in Chrome and Edge otherwise.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((was) => !was);
      }
    };
    window.addEventListener('keydown', onKey);
    const onOpenRequest = () => setOpen(true);
    window.addEventListener('orra:open-palette', onOpenRequest);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('orra:open-palette', onOpenRequest);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    // Focus after paint, or the on-screen keyboard does not come up on iOS.
    const id = window.setTimeout(() => input.current?.focus(), 10);
    return () => window.clearTimeout(id);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const go = useCallback(
    (to: string, jump?: Parameters<typeof setJump>[0]) => {
      if (jump) setJump(jump);
      navigate(to);
      close();
    },
    [close, navigate],
  );

  /** Free text with no match becomes a scribble — capture from any room. */
  const capture = useCallback(() => {
    const text = query.trim();
    if (!text) return;
    const projectId = ds.projects[0]?.id;
    if (!projectId) {
      toast('Create a project first — a scribble has to live somewhere.');
      return;
    }
    store.insert(
      'notes',
      {
        id: newId('n'),
        title: text.length > 60 ? `${text.slice(0, 59)}…` : text,
        body: text,
        type: 'plain',
        project_id: projectId,
        task_id: null,
        tags: [],
        is_pinned: false,
        transcript: null,
        checklist: null,
        images: [],
        sketch: null,
        source_ref: null,
        created_by: store.meId,
        owner_id: store.meId,
        created_at: nowIso(),
      },
      store.asMe({ summary: `Captured — ${text.slice(0, 60)}` }),
    );
    const landed = ds.projects.find((p) => p.id === projectId)?.name ?? 'your first project';
    toast(`Kept as a scribble in ${landed}`);
    close();
  }, [close, ds.projects, query, store, toast]);

  const actions = useMemo<Action[]>(() => {
    const list: Action[] = [
      {
        id: 'new-task',
        label: 'New task',
        hint: 'Work board',
        run: () => go('/work'),
      },
      {
        id: 'new-scribble',
        label: 'New scribble',
        hint: 'Notebook',
        run: () => go('/knowledge', { knowledgeTab: 'notes' }),
      },
      ...ROOMS.map((room) => ({
        id: `go-${room.to}`,
        label: `Go to ${room.label}`,
        hint: room.to,
        run: () => go(room.to),
      })),
    ];
    const needle = query.trim().toLowerCase();
    if (!needle) return list.slice(0, 2);
    return list.filter((action) => action.label.toLowerCase().includes(needle)).slice(0, 4);
  }, [go, query]);

  const results = useMemo(() => {
    if (!open) return [];
    return searchItems(buildSearchItems(ds, store.meId), query);
  }, [ds, open, query, store.meId]);

  const grouped = useMemo(() => {
    const byKind = new Map<SearchKind, SearchItem[]>();
    results.forEach((item) => {
      const bucket = byKind.get(item.kind) ?? [];
      bucket.push(item);
      byKind.set(item.kind, bucket);
    });
    return [...byKind.entries()];
  }, [results]);

  const canCapture = Boolean(query.trim()) && results.length === 0;

  /** One flat list of everything Enter could land on, so the cursor can walk
   *  actions and results without caring which section it is in. */
  const rows = useMemo(() => {
    const list: { key: string; run: () => void }[] = actions.map((action) => ({
      key: action.id,
      run: action.run,
    }));
    grouped.forEach(([, items]) =>
      items.forEach((item) =>
        list.push({
          key: `${item.kind}:${item.id}`,
          run: () => {
            if (item.kind === 'page') go('/knowledge', { knowledgeTab: 'wiki', pageId: item.id });
            else if (item.kind === 'note') go('/knowledge', { knowledgeTab: 'notes', query: item.title });
            else if (item.kind === 'document') go('/knowledge', { knowledgeTab: 'docs', query: item.title });
            else go(routeFor(item));
          },
        }),
      ),
    );
    if (canCapture) list.push({ key: 'capture', run: capture });
    return list;
  }, [actions, canCapture, capture, go, grouped]);

  useEffect(() => {
    if (cursor >= rows.length) setCursor(rows.length ? rows.length - 1 : 0);
  }, [cursor, rows.length]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((at) => {
        if (!rows.length) return 0;
        const next = at + (event.key === 'ArrowDown' ? 1 : -1);
        return next < 0 ? rows.length - 1 : next >= rows.length ? 0 : next;
      });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      rows[cursor]?.run();
    }
  };

  let index = -1;
  const rowProps = (key: string) => {
    index += 1;
    const at = index;
    return {
      key,
      className: `cp-row${cursor === at ? ' on' : ''}`,
      role: 'option' as const,
      'aria-selected': cursor === at,
      onMouseEnter: () => setCursor(at),
      onClick: () => rows[at]?.run(),
    };
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="cp-mask"
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1, transition: reduced ? { duration: 0 } : micro }}
        exit={{ opacity: 0, transition: micro }}
        onClick={close}
      >
        <motion.div
          className="cp-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Search everything"
          initial={reduced ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0, transition: reduced ? { duration: 0 } : entrance }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, transition: micro }}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          <div className="cp-search">
            <Search size={16} strokeWidth={2} aria-hidden />
            <input
              ref={input}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
              }}
              placeholder="Search tasks, scribbles, pages, people, money…"
              aria-label="Search everything"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" className="cp-close" onClick={close} aria-label="Close search">
              Esc
            </button>
          </div>

          <div className="cp-results" role="listbox" aria-label="Results">
            {actions.length > 0 && (
              <div className="cp-section">
                <p className="eyebrow">Actions</p>
                {actions.map((action) => (
                  <button type="button" {...rowProps(action.id)}>
                    <Plus size={14} strokeWidth={2} aria-hidden />
                    <span className="cp-title">{action.label}</span>
                    <span className="cp-sub mono">{action.hint}</span>
                  </button>
                ))}
              </div>
            )}

            {grouped.map(([kind, items]) => (
              <div className="cp-section" key={kind}>
                <p className="eyebrow">{KIND_LABEL[kind]}</p>
                {items.map((item) => (
                  <button type="button" {...rowProps(`${item.kind}:${item.id}`)}>
                    <span className={`cp-dot k-${item.kind}`} aria-hidden />
                    <span className="cp-title">{item.title}</span>
                    {item.sub && <span className="cp-sub">{item.sub}</span>}
                  </button>
                ))}
              </div>
            ))}

            {canCapture && (
              <div className="cp-section">
                <p className="eyebrow">Nothing matched</p>
                <button type="button" {...rowProps('capture')}>
                  <CornerDownLeft size={14} strokeWidth={2} aria-hidden />
                  <span className="cp-title">Keep “{query.trim()}” as a scribble</span>
                </button>
              </div>
            )}

            {!query.trim() && (
              <p className="tip cp-hint">
                Type to search everything. <b>↑ ↓</b> to move, <b>Enter</b> to open, <b>Esc</b> to close.
              </p>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}

/** The header button — the way in on a phone, where there is no Ctrl+K. */
export function CommandPaletteButton() {
  return (
    <button
      className="chip cp-open"
      aria-label="Search everything"
      title="Search everything (Ctrl+K)"
      onClick={() => window.dispatchEvent(new Event('orra:open-palette'))}
    >
      <Search size={15} strokeWidth={2} aria-hidden />
    </button>
  );
}
