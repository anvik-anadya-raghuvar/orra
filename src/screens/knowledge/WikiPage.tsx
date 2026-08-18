import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { Avatar, TagChip, useToast } from '../../ui/bits';
import { staggerItem, staggerParent } from '../../ui/motion';
import { fmtDateTime } from '../../lib/dates';
import type { Page, PageBlock } from '../../types';
import { BlockRow, makeBlock } from './WikiBlocks';

type SaveState = 'idle' | 'saving' | 'saved';

export default function WikiPage({
  pageId,
  onSelect,
  onDeleted,
}: {
  pageId: string;
  onSelect: (id: string) => void;
  onDeleted: () => void;
}) {
  const store = useStore();
  const toast = useToast();
  const page = useData((ds) => ds.pages.find((p) => p.id === pageId));
  const pages = useData((ds) => ds.pages);

  const [draft, setDraft] = useState<{ title: string; icon: string; blocks: PageBlock[] }>({
    title: page?.title ?? '',
    icon: page?.icon ?? '📄',
    blocks: page?.blocks ?? [],
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>('idle');

  /* ── debounced autosave ────────────────────────────────────────────────
     One store.update per pause, never per keystroke: the audit trail is
     append-only, so a keystroke-level write would bury real history. */
  const pending = useRef<Partial<Page> | null>(null);
  const targetId = useRef(pageId);
  const timer = useRef<number>();

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    const id = targetId.current;
    pending.current = null;
    if (!patch || !id) return;
    store.update(
      'pages',
      id,
      { ...patch, last_edited_by: store.meId, last_edited_at: nowIso() },
      store.asMe({ summary: 'Page edited' }),
    );
    setSave('saved');
  }, [store]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  const queue = useCallback((patch: Partial<Page>) => {
    pending.current = { ...(pending.current ?? {}), ...patch };
    setSave('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flushRef.current(), 600);
  }, []);

  // Switching pages (or unmounting) commits whatever is still pending for the
  // page being left — the cleanup runs before the next effect, so targetId is
  // still the old id at that moment.
  useEffect(() => {
    setDraft({ title: page?.title ?? '', icon: page?.icon ?? '📄', blocks: page?.blocks ?? [] });
    setActiveId(null);
    targetId.current = pageId;
    return () => {
      flushRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  // A reload mid-sentence should not lose the sentence.
  useEffect(() => {
    const h = () => flushRef.current();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  const setBlocks = (blocks: PageBlock[]) => {
    setDraft((d) => ({ ...d, blocks }));
    queue({ blocks });
  };

  if (!page) {
    return <p className="tip">This page no longer exists. Pick another from the tree.</p>;
  }

  /* ── block operations ─────────────────────────────────────────────────── */
  const blocks = draft.blocks;

  const replaceBlock = (i: number, next: PageBlock) =>
    setBlocks(blocks.map((b, idx) => (idx === i ? next : b)));

  const insertAfter = (i: number) => {
    const b = makeBlock('paragraph');
    const next = [...blocks];
    next.splice(i + 1, 0, b);
    setBlocks(next);
    setActiveId(b.id);
    setFocusId(b.id);
  };

  const removeAt = (i: number, focusPrev = true) => {
    const next = blocks.filter((_, idx) => idx !== i);
    setBlocks(next);
    const prev = next[Math.max(0, i - 1)];
    if (focusPrev && prev) {
      setActiveId(prev.id);
      setFocusId(prev.id);
    } else {
      setActiveId(null);
    }
  };

  const moveBlock = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    setBlocks(next);
  };

  /* ── page-level operations ────────────────────────────────────────────── */
  const siblings = pages
    .filter((p) => p.parent_page_id === page.parent_page_id && !p.is_archived)
    .sort((a, b) => a.position - b.position);

  const movePage = (dir: -1 | 1) => {
    const i = siblings.findIndex((p) => p.id === page.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= siblings.length) return;
    const ordered = [...siblings];
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    ordered.forEach((p, idx) => {
      if (p.position !== idx + 1) store.update('pages', p.id, { position: idx + 1 }, store.asMe());
    });
    toast('Page moved');
  };

  const addSubPage = () => {
    const kids = pages.filter((p) => p.parent_page_id === page.id);
    const p: Page = {
      id: newId('pg'),
      title: 'Untitled',
      icon: '📄',
      parent_page_id: page.id,
      blocks: [makeBlock('paragraph')],
      tags: [],
      linked_task_ids: [],
      is_archived: false,
      position: kids.length + 1,
      created_by: store.meId,
      created_at: nowIso(),
      last_edited_by: store.meId,
      last_edited_at: nowIso(),
    };
    store.insert('pages', p, store.asMe({ summary: `Page created — ${p.title}` }));
    onSelect(p.id);
  };

  const toggleArchive = () => {
    if (!page.is_archived && !window.confirm(`Archive "${page.title}"? It stays in the trail and can be restored.`)) return;
    store.update('pages', page.id, { is_archived: !page.is_archived }, store.asMe());
    toast(page.is_archived ? 'Page restored' : 'Page archived');
  };

  const deletePage = () => {
    const descendants: string[] = [];
    const walk = (id: string) => {
      descendants.push(id);
      pages.filter((p) => p.parent_page_id === id).forEach((c) => walk(c.id));
    };
    walk(page.id);
    const extra = descendants.length - 1;
    if (
      !window.confirm(
        `Delete "${page.title}"${extra > 0 ? ` and ${extra} sub-page${extra === 1 ? '' : 's'}` : ''}? This cannot be undone.`,
      )
    )
      return;
    // Drop the pending autosave: it would otherwise resurrect nothing but noise.
    window.clearTimeout(timer.current);
    pending.current = null;
    descendants.reverse().forEach((id) => {
      store.ds.page_comments
        .filter((c) => c.page_id === id)
        .forEach((c) => store.remove('page_comments', c.id, store.asMe({ silent: true })));
      store.remove('pages', id, store.asMe({ summary: `Page deleted — ${id}` }));
    });
    toast('Page deleted');
    onDeleted();
  };

  const lastEditor = store.ds.profiles.find((p) => p.id === page.last_edited_by);

  return (
    <div className="wk-page">
      <div className="wk-pagehead">
        <input
          className="wk-icon-input"
          value={draft.icon}
          aria-label="Page icon"
          maxLength={4}
          onChange={(e) => {
            setDraft((d) => ({ ...d, icon: e.target.value }));
            queue({ icon: e.target.value });
          }}
        />
        <input
          className="wk-title-input"
          value={draft.title}
          aria-label="Page title"
          placeholder="Untitled"
          onChange={(e) => {
            setDraft((d) => ({ ...d, title: e.target.value }));
            queue({ title: e.target.value });
          }}
        />
        <span className={`wk-save wk-save-${save}`} role="status" aria-live="polite">
          {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : ''}
        </span>
      </div>

      <div className="wk-pagemeta">
        <span>
          Edited by {lastEditor?.name ?? '—'} · {fmtDateTime(page.last_edited_at)}
        </span>
        {page.is_archived && <span className="pinflag">archived</span>}
      </div>

      <PageTags page={page} />

      <div className="wk-pageactions">
        <button type="button" className="btn sm" onClick={addSubPage}>
          + Sub-page
        </button>
        <button type="button" className="btn sm" onClick={() => movePage(-1)} aria-label="Move page up">
          ↑ Up
        </button>
        <button type="button" className="btn sm" onClick={() => movePage(1)} aria-label="Move page down">
          ↓ Down
        </button>
        <button type="button" className="btn sm" onClick={toggleArchive}>
          {page.is_archived ? 'Restore' : 'Archive'}
        </button>
        <button type="button" className="btn sm" style={{ color: 'var(--rose)' }} onClick={deletePage}>
          Delete
        </button>
      </div>

      <LinkedTasks page={page} />

      <motion.div className="wk-blocks" {...staggerParent()}>
        {blocks.map((b, i) => (
          <motion.div key={b.id} variants={staggerItem}>
            <BlockRow
              block={b}
              index={i}
              count={blocks.length}
              active={activeId === b.id}
              autoFocus={focusId === b.id}
              onActivate={() => {
                setActiveId(b.id);
                setFocusId(b.id);
              }}
              onDeactivate={() => {
                setActiveId((cur) => (cur === b.id ? null : cur));
                setFocusId((cur) => (cur === b.id ? null : cur));
              }}
              onChange={(next) => replaceBlock(i, next)}
              onEnter={() => insertAfter(i)}
              onRemoveEmpty={() => blocks.length > 1 && removeAt(i)}
              onMove={(dir) => moveBlock(i, dir)}
              onDelete={() => removeAt(i, false)}
            />
          </motion.div>
        ))}
      </motion.div>

      <button
        type="button"
        className="wk-addblock"
        onClick={() => insertAfter(blocks.length - 1)}
      >
        + Add a block
      </button>

      <PageComments pageId={page.id} />
    </div>
  );
}

/* ── tags ─────────────────────────────────────────────────────────────── */
function PageTags({ page }: { page: Page }) {
  const store = useStore();
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v || page.tags.includes(v)) return;
    store.update('pages', page.id, { tags: [...page.tags, v] }, store.asMe());
    setDraft('');
  };
  return (
    <div className="wk-tags">
      {page.tags.map((t) => (
        <TagChip
          key={t}
          name={t}
          onRemove={() =>
            store.update('pages', page.id, { tags: page.tags.filter((x) => x !== t) }, store.asMe())
          }
        />
      ))}
      <input
        className="wk-input wk-taginput"
        value={draft}
        placeholder="+ tag"
        aria-label="Add tag"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
      />
    </div>
  );
}

/* ── linked tasks ─────────────────────────────────────────────────────── */
function LinkedTasks({ page }: { page: Page }) {
  const store = useStore();
  const tasks = useData((ds) => ds.tasks);
  const [picking, setPicking] = useState('');

  const linked = page.linked_task_ids
    .map((id) => tasks.find((t) => t.id === id) ?? { id, title: 'Unknown task' })
    .filter(Boolean);

  const addTask = (id: string) => {
    if (!id || page.linked_task_ids.includes(id)) return;
    store.update('pages', page.id, { linked_task_ids: [...page.linked_task_ids, id] }, store.asMe());
    setPicking('');
  };

  return (
    <div className="wk-linked">
      <span className="eyebrow">Linked tasks</span>
      <div className="wk-linkedrow">
        {linked.length === 0 && <span className="tip" style={{ margin: 0 }}>None yet.</span>}
        {linked.map((t) => (
          <span className="wk-taskchip" key={t.id}>
            <Link className="lk" to={`/task/${t.id}`}>
              {t.id} — {t.title}
            </Link>
            <button
              type="button"
              aria-label={`Unlink ${t.id}`}
              onClick={() =>
                store.update(
                  'pages',
                  page.id,
                  { linked_task_ids: page.linked_task_ids.filter((x) => x !== t.id) },
                  store.asMe(),
                )
              }
            >
              ×
            </button>
          </span>
        ))}
        <select
          className="wk-input wk-taskpick"
          value={picking}
          aria-label="Link a task"
          onChange={(e) => addTask(e.target.value)}
        >
          <option value="">+ link a task…</option>
          {tasks
            .filter((t) => !page.linked_task_ids.includes(t.id))
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.id} — {t.title}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}

/* ── comments ─────────────────────────────────────────────────────────── */
function PageComments({ pageId }: { pageId: string }) {
  const store = useStore();
  const toast = useToast();
  const comments = useData((ds) =>
    ds.page_comments.filter((c) => c.page_id === pageId).sort((a, b) => a.created_at.localeCompare(b.created_at)),
  );
  const [body, setBody] = useState('');

  const post = () => {
    const v = body.trim();
    if (!v) return;
    store.insert(
      'page_comments',
      { id: newId('pc'), page_id: pageId, author_id: store.meId, body: v, created_at: nowIso() },
      store.asMe({ summary: 'Comment on page' }),
    );
    setBody('');
    toast('Comment posted');
  };

  return (
    <section className="wk-comments">
      <span className="eyebrow">Comments</span>
      {comments.length === 0 && <p className="tip">No comments on this page yet.</p>}
      {comments.map((c) => (
        <div className="wk-comment" key={c.id}>
          <Avatar userId={c.author_id} />
          <div>
            <div className="wk-comment-meta">
              {store.ds.profiles.find((p) => p.id === c.author_id)?.name ?? 'Someone'} · {fmtDateTime(c.created_at)}
            </div>
            <div className="wk-comment-body">{c.body}</div>
          </div>
        </div>
      ))}
      <div className="wk-composer">
        <textarea
          className="wk-input"
          value={body}
          placeholder="Add a comment…"
          aria-label="Add a comment"
          onChange={(e) => setBody(e.target.value)}
        />
        <button type="button" className="btn sm solid" onClick={post} disabled={!body.trim()}>
          Post
        </button>
      </div>
    </section>
  );
}
