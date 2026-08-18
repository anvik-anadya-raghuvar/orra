import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import './wiki.css';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { entrance } from '../../ui/motion';
import type { Page } from '../../types';
import { blockText, makeBlock } from './WikiBlocks';
import WikiPage from './WikiPage';

interface TreeNode {
  page: Page;
  children: TreeNode[];
}

/** Pure: nest a flat page list by parent_page_id, ordered by position. */
export function buildTree(pages: Page[]): TreeNode[] {
  const byParent = new Map<string | null, Page[]>();
  for (const p of pages) {
    const k = p.parent_page_id;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(p);
  }
  const known = new Set(pages.map((p) => p.id));
  const build = (parent: string | null): TreeNode[] =>
    (byParent.get(parent) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title))
      .map((page) => ({ page, children: build(page.id) }));
  // Pages whose parent was archived or deleted would otherwise vanish — they
  // surface at the root instead of being silently unreachable.
  const orphans = pages.filter((p) => p.parent_page_id && !known.has(p.parent_page_id));
  return [...build(null), ...orphans.map((page) => ({ page, children: build(page.id) }))];
}

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export default function WikiTab() {
  const store = useStore();
  const allPages = useData((ds) => ds.pages);
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const narrow = useIsNarrow();

  const visible = useMemo(
    () => allPages.filter((p) => showArchived || !p.is_archived),
    [allPages, showArchived],
  );

  /* ── search: keep matches and every ancestor that leads to one ────────── */
  const matchIds = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const byId = new Map(allPages.map((p) => [p.id, p]));
    const hit = new Set<string>();
    for (const p of visible) {
      const hay = [p.title, ...p.blocks.map(blockText), ...p.tags].join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
      hit.add(p.id);
      let parent = p.parent_page_id;
      while (parent && !hit.has(parent)) {
        hit.add(parent);
        parent = byId.get(parent)?.parent_page_id ?? null;
      }
    }
    return hit;
  }, [query, visible, allPages]);

  const pool = matchIds ? visible.filter((p) => matchIds.has(p.id)) : visible;
  const tree = useMemo(() => buildTree(pool), [pool]);

  // Pick something sensible whenever the current selection stops existing.
  const selectedPage = visible.find((p) => p.id === selected) ?? null;
  useEffect(() => {
    if (selectedPage) return;
    const first = buildTree(visible)[0];
    if (first) setSelected(first.page.id);
  }, [selectedPage, visible]);

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const newTopLevel = () => {
    const roots = allPages.filter((p) => !p.parent_page_id);
    const p: Page = {
      id: newId('pg'),
      title: 'Untitled',
      icon: '📄',
      parent_page_id: null,
      blocks: [makeBlock('paragraph')],
      tags: [],
      linked_task_ids: [],
      is_archived: false,
      position: roots.length + 1,
      created_by: store.meId,
      created_at: nowIso(),
      last_edited_by: store.meId,
      last_edited_at: nowIso(),
    };
    store.insert('pages', p, store.asMe({ summary: `Page created — ${p.title}` }));
    setSelected(p.id);
    setTreeOpen(false);
  };

  const addChild = (parentId: string) => {
    const kids = allPages.filter((p) => p.parent_page_id === parentId);
    const p: Page = {
      id: newId('pg'),
      title: 'Untitled',
      icon: '📄',
      parent_page_id: parentId,
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
    setCollapsed((s) => {
      const n = new Set(s);
      n.delete(parentId);
      return n;
    });
    setSelected(p.id);
    setTreeOpen(false);
  };

  const treePanel = (
    <div className="wk-tree" role="tree" aria-label="Wiki pages">
      {tree.length === 0 ? (
        <p className="tip">No pages match.</p>
      ) : (
        tree.map((n) => (
          <TreeRow
            key={n.page.id}
            node={n}
            depth={0}
            selected={selected}
            collapsed={query ? new Set<string>() : collapsed}
            onToggle={toggle}
            onSelect={(id) => {
              setSelected(id);
              setTreeOpen(false);
            }}
            onAddChild={addChild}
          />
        ))
      )}
    </div>
  );

  return (
    <div className="wk-wrap">
      <div className="filters">
        <input
          className="srch"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search pages and their contents…"
          aria-label="Search wiki"
        />
        <button type="button" className="btn sm solid" onClick={newTopLevel}>
          + Page
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={showArchived}
          onClick={() => setShowArchived((v) => !v)}
        >
          Archived
        </button>
      </div>

      {narrow && (
        <button
          type="button"
          className="btn wk-treetoggle"
          aria-expanded={treeOpen}
          onClick={() => setTreeOpen((v) => !v)}
        >
          {treeOpen ? 'Hide pages' : `Pages${selectedPage ? ` · ${selectedPage.icon} ${selectedPage.title}` : ''}`}
        </button>
      )}

      <div className="wk-panes">
        {(!narrow || treeOpen) && (
          <motion.aside
            className="wk-aside"
            initial={narrow ? { opacity: 0, y: -6 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={entrance}
          >
            {treePanel}
          </motion.aside>
        )}
        <div className="wk-main">
          {selectedPage ? (
            <WikiPage
              key={selectedPage.id}
              pageId={selectedPage.id}
              onSelect={setSelected}
              onDeleted={() => setSelected(null)}
            />
          ) : (
            <p className="tip">No pages yet — create one with “+ Page”.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  selected,
  collapsed,
  onToggle,
  onSelect,
  onAddChild,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onAddChild: (id: string) => void;
}) {
  const { page, children } = node;
  const isOpen = !collapsed.has(page.id);
  const hasKids = children.length > 0;
  return (
    <div className="wk-treenode" role="none">
      <div
        className={`wk-treerow ${selected === page.id ? 'sel' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        <button
          type="button"
          className="wk-twist"
          aria-label={hasKids ? (isOpen ? `Collapse ${page.title}` : `Expand ${page.title}`) : 'No sub-pages'}
          aria-expanded={hasKids ? isOpen : undefined}
          disabled={!hasKids}
          onClick={() => onToggle(page.id)}
        >
          {hasKids ? (isOpen ? '▾' : '▸') : '·'}
        </button>
        <button
          type="button"
          className="wk-treelabel"
          role="treeitem"
          aria-selected={selected === page.id}
          onClick={() => onSelect(page.id)}
        >
          <span aria-hidden>{page.icon}</span>
          <span className="wk-treetitle">{page.title || 'Untitled'}</span>
          {page.is_archived && <span className="wk-arch">arch</span>}
        </button>
        <button
          type="button"
          className="wk-twist"
          aria-label={`Add sub-page under ${page.title}`}
          onClick={() => onAddChild(page.id)}
        >
          +
        </button>
      </div>
      {hasKids && isOpen && (
        <div role="group">
          {children.map((c) => (
            <TreeRow
              key={c.page.id}
              node={c}
              depth={depth + 1}
              selected={selected}
              collapsed={collapsed}
              onToggle={onToggle}
              onSelect={onSelect}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}
