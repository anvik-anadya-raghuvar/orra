import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, Reorder, useDragControls } from 'framer-motion';
import { newId, nowIso, useData, useStore } from '../../data/store';
import { Avatar, TagChip, useToast } from '../../ui/bits';
import { entrance } from '../../ui/motion';
import { fmtDateTime } from '../../lib/dates';
import { processImages, useImagePaste } from '../../ui/imagedrop';
import type { Page, PageBlock, PageRevision, PageSnapshot } from '../../types';
import { BlockRow, blockText, isListy, isTexty, makeBlock } from './WikiBlocks';
import { Attachments } from '../../ui/attachments';
import {
  duplicateBlocks,
  isBlockHidden,
  isVerificationCurrent,
  pageBacklinks,
  pageBreadcrumbs,
  withIndent,
} from './wikiEditor';
import { insertImagesAtBlockCaret } from './wikiImageInsert';
import { RichText } from '../../ui/richText';
import { useWikiPresence } from './wikiPresence';
import { DictateField } from '../../ui/dictation';

type SaveState = 'idle' | 'saving' | 'saved';

interface Draft extends PageSnapshot {
  cover_url: string | null;
  full_width: boolean;
}

function draftFrom(page: Page | undefined): Draft {
  return {
    title: page?.title ?? '',
    icon: page?.icon ?? '📄',
    blocks: page?.blocks ?? [],
    tags: page?.tags ?? [],
    cover_url: page?.cover_url ?? null,
    full_width: page?.full_width ?? false,
  };
}

function snapshotFrom(page: Page): PageSnapshot {
  return {
    title: page.title,
    icon: page.icon,
    blocks: page.blocks,
    tags: page.tags,
    cover_url: page.cover_url ?? null,
    full_width: page.full_width ?? false,
  };
}

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
  const page = useData((dataset) => dataset.pages.find((candidate) => candidate.id === pageId));
  const pages = useData((dataset) => dataset.pages);
  const profiles = useData((dataset) => dataset.profiles);
  const revisions = useData((dataset) => dataset.page_revisions.filter((revision) => revision.page_id === pageId));
  const pageComments = useData((dataset) => dataset.page_comments.filter((comment) => comment.page_id === pageId));
  const presence = useWikiPresence(pageId);

  const [draft, setDraft] = useState<Draft>(() => draftFrom(page));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [focusAtStartId, setFocusAtStartId] = useState<string | null>(null);
  const [forceMenuId, setForceMenuId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [commentTarget, setCommentTarget] = useState<{ blockId: string; anchor: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [save, setSave] = useState<SaveState>('idle');
  const undoStack = useRef<PageBlock[][]>([]);
  const redoStack = useRef<PageBlock[][]>([]);
  const [, setUndoVersion] = useState(0);

  const pending = useRef<Partial<Page> | null>(null);
  const targetId = useRef(pageId);
  const timer = useRef<number>();

  const recordRevision = useCallback((source: Page) => {
    const snapshot = snapshotFrom(source);
    const latest = store.ds.page_revisions
      .filter((revision) => revision.page_id === source.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (latest && JSON.stringify(latest.snapshot) === JSON.stringify(snapshot)) return;
    const revision: PageRevision = {
      id: newId('pr'),
      page_id: source.id,
      author_id: store.meId,
      snapshot,
      created_at: nowIso(),
    };
    store.insert('page_revisions', revision, store.asMe({ silent: true }));
  }, [store]);

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    const id = targetId.current;
    pending.current = null;
    if (!patch || !id) return;
    const current = store.ds.pages.find((candidate) => candidate.id === id);
    if (current) recordRevision(current);
    store.update('pages', id, { ...patch, last_edited_by: store.meId, last_edited_at: nowIso() }, store.asMe({ summary: 'Page edited' }));
    setSave('saved');
  }, [recordRevision, store]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  const queue = useCallback((patch: Partial<Page>) => {
    pending.current = { ...(pending.current ?? {}), ...patch };
    setSave('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => flushRef.current(), 600);
  }, []);

  useEffect(() => {
    setDraft(draftFrom(page));
    setActiveId(null);
    setSelectedIds(new Set());
    undoStack.current = [];
    redoStack.current = [];
    setUndoVersion((version) => version + 1);
    targetId.current = pageId;
    return () => flushRef.current();
    // Only a page switch should replace an in-progress local draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  useEffect(() => {
    const beforeUnload = () => flushRef.current();
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  if (!page) return <p className="tip">This page no longer exists. Pick another from the tree.</p>;

  const blocks = draft.blocks;
  const pushUndo = (previous: PageBlock[]) => {
    const current = undoStack.current[undoStack.current.length - 1];
    if (!current || JSON.stringify(current) !== JSON.stringify(previous)) undoStack.current = [...undoStack.current.slice(-99), previous];
    redoStack.current = [];
    setUndoVersion((version) => version + 1);
  };
  const setBlocks = (next: PageBlock[], remember = true) => {
    if (JSON.stringify(next) === JSON.stringify(blocks)) return;
    if (remember) pushUndo(blocks);
    setDraft((current) => ({ ...current, blocks: next }));
    queue({ blocks: next });
  };
  const patchDraft = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    queue(patch as Partial<Page>);
  };

  const undo = () => {
    const previous = undoStack.current[undoStack.current.length - 1];
    if (!previous) return;
    undoStack.current = undoStack.current.slice(0, -1);
    redoStack.current = [...redoStack.current.slice(-99), blocks];
    setDraft((current) => ({ ...current, blocks: previous }));
    queue({ blocks: previous });
    setUndoVersion((version) => version + 1);
  };
  const redo = () => {
    const next = redoStack.current[redoStack.current.length - 1];
    if (!next) return;
    redoStack.current = redoStack.current.slice(0, -1);
    undoStack.current = [...undoStack.current.slice(-99), blocks];
    setDraft((current) => ({ ...current, blocks: next }));
    queue({ blocks: next });
    setUndoVersion((version) => version + 1);
  };

  const replaceBlock = (index: number, next: PageBlock) => setBlocks(blocks.map((block, candidate) => candidate === index ? next : block));

  const insertAfter = (index: number, selectionStart?: number, selectionEnd?: number, openMenu = false) => {
    const current = blocks[index];
    const nextBlock = makeBlock('paragraph');
    nextBlock.indent = current?.type === 'toggle' && typeof selectionStart === 'number'
      ? Math.min(6, (current.indent ?? 0) + 1)
      : current?.indent ?? 0;
    nextBlock.width = current?.width ?? 'full';
    const next = [...blocks];
    if (current && typeof selectionStart === 'number' && (isTexty(current.type) || isListy(current.type))) {
      const value = blockText(current);
      const start = Math.max(0, Math.min(selectionStart, value.length));
      const end = Math.max(start, Math.min(selectionEnd ?? start, value.length));
      const before = value.slice(0, start);
      const after = value.slice(end);
      if (current.type === 'paragraph') next[index] = { ...current, text: before };
      else if (isListy(current.type)) {
        const clean = before.replace(/\n$/, '');
        next[index] = { ...current, items: clean ? clean.split('\n').map((text, itemIndex) => ({ text, ...(current.type === 'todo' ? { done: current.items?.[itemIndex]?.done ?? false } : {}) })) : [] };
      }
      else next[index] = { ...current, text: before };
      nextBlock.text = after;
    }
    next.splice(index + 1, 0, nextBlock);
    setBlocks(next);
    setActiveId(nextBlock.id);
    setFocusId(nextBlock.id);
    setFocusAtStartId(nextBlock.id);
    setForceMenuId(openMenu ? nextBlock.id : null);
  };

  const removeAt = (index: number, focusPrevious = true) => {
    const next = blocks.filter((_, candidate) => candidate !== index);
    if (!next.length) next.push(makeBlock('paragraph'));
    setBlocks(next);
    const previous = next[Math.max(0, index - 1)];
    if (focusPrevious && previous) {
      setActiveId(previous.id);
      setFocusId(previous.id);
      setFocusAtStartId(null);
    } else setActiveId(null);
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    setBlocks(next);
  };

  const duplicateOne = (id: string) => setBlocks(duplicateBlocks(blocks, new Set([id]), () => newId('b')));
  const toggleSelected = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const changeSelectedIndent = (direction: -1 | 1) => setBlocks(blocks.map((block) => selectedIds.has(block.id) ? withIndent(block, direction) : block));
  const deleteSelected = () => {
    const next = blocks.filter((block) => !selectedIds.has(block.id));
    setBlocks(next.length ? next : [makeBlock('paragraph')]);
    setSelectedIds(new Set());
  };
  const duplicateSelected = () => {
    setBlocks(duplicateBlocks(blocks, selectedIds, () => newId('b')));
    setSelectedIds(new Set());
  };

  const pasteIntoBlock = (blockId: string, files: File[], selectionStart: number, selectionEnd: number) => {
    const pasted: PageBlock[] = [];
    void processImages(files, (image) => pasted.push({ ...makeBlock('image'), src: image.data_url, alt: image.filename }))
      .then(() => {
        setDraft((current) => {
          const at = current.blocks.findIndex((block) => block.id === blockId);
          if (at < 0) return current;
          const source = current.blocks[at];
          pasted.forEach((image) => { image.indent = source.indent ?? 0; image.width = source.width ?? 'full'; });
          const insertion = insertImagesAtBlockCaret(source, pasted, selectionStart, selectionEnd);
          const next = [...current.blocks];
          next.splice(at, 1, ...insertion.blocks);
          pushUndo(current.blocks);
          queue({ blocks: next });
          setActiveId(insertion.focusId);
          setFocusId(insertion.focusId);
          setFocusAtStartId(insertion.focusAtStart ? insertion.focusId : null);
          return { ...current, blocks: next };
        });
        toast(`${pasted.length === 1 ? 'Image' : `${pasted.length} images`} pasted at the cursor`);
      })
      .catch((error: Error) => toast(error.message || 'That image could not be pasted'));
  };

  const replaceImage = (blockId: string, files: File[]) => {
    void processImages(files.slice(0, 1), (image) => {
      setDraft((current) => {
        const next = current.blocks.map((block) => block.id === blockId ? { ...block, src: image.data_url, alt: block.alt || image.filename } : block);
        pushUndo(current.blocks);
        queue({ blocks: next });
        return { ...current, blocks: next };
      });
    }).catch((error: Error) => toast(error.message || 'That image could not be used'));
  };

  const pageRef = useRef<HTMLDivElement>(null);
  useImagePaste(pageRef, (files) => {
    const pasted: PageBlock[] = [];
    void processImages(files, (image) => pasted.push({ ...makeBlock('image'), src: image.data_url, alt: image.filename }))
      .then(() => {
        const active = blocks.find((block) => block.id === activeId);
        const paragraph = makeBlock('paragraph');
        paragraph.indent = active?.indent ?? 0;
        setDraft((current) => {
          const at = activeId ? current.blocks.findIndex((block) => block.id === activeId) : -1;
          const next = [...current.blocks];
          next.splice(at >= 0 ? at + 1 : next.length, 0, ...pasted, paragraph);
          pushUndo(current.blocks);
          queue({ blocks: next });
          return { ...current, blocks: next };
        });
        setActiveId(paragraph.id);
        setFocusId(paragraph.id);
        setFocusAtStartId(paragraph.id);
        toast(`${pasted.length === 1 ? 'Image' : `${pasted.length} images`} pasted into the page`);
      })
      .catch((error: Error) => toast(error.message || 'That image could not be pasted'));
  });

  const siblings = pages.filter((candidate) => candidate.parent_page_id === page.parent_page_id && !candidate.is_archived).sort((a, b) => a.position - b.position);
  const movePage = (direction: -1 | 1) => {
    const index = siblings.findIndex((candidate) => candidate.id === page.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= siblings.length) return;
    const ordered = [...siblings];
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    ordered.forEach((candidate, order) => { if (candidate.position !== order + 1) store.update('pages', candidate.id, { position: order + 1 }, store.asMe()); });
    toast('Page moved');
  };

  const addSubPage = () => {
    const children = pages.filter((candidate) => candidate.parent_page_id === page.id);
    const next: Page = {
      id: newId('pg'), title: 'Untitled', icon: '📄', parent_page_id: page.id,
      blocks: [makeBlock('paragraph')], tags: [], linked_task_ids: [], is_archived: false,
      position: children.length + 1, created_by: store.meId, owner_id: store.meId,
      created_at: nowIso(), last_edited_by: store.meId, last_edited_at: nowIso(),
      cover_url: null, full_width: false, verified_at: null, verification_expires_at: null,
    };
    store.insert('pages', next, store.asMe({ summary: `Page created — ${next.title}` }));
    onSelect(next.id);
  };

  const toggleArchive = () => {
    if (!page.is_archived && !window.confirm(`Archive "${page.title}"? It stays in the trail and can be restored.`)) return;
    store.update('pages', page.id, { is_archived: !page.is_archived }, store.asMe());
    toast(page.is_archived ? 'Page restored' : 'Page archived');
  };

  const deletePage = () => {
    const descendants: string[] = [];
    const walk = (id: string) => { descendants.push(id); pages.filter((candidate) => candidate.parent_page_id === id).forEach((child) => walk(child.id)); };
    walk(page.id);
    const extra = descendants.length - 1;
    if (!window.confirm(`Delete "${page.title}"${extra ? ` and ${extra} sub-page${extra === 1 ? '' : 's'}` : ''}? This cannot be undone.`)) return;
    window.clearTimeout(timer.current);
    pending.current = null;
    descendants.reverse().forEach((id) => {
      store.ds.page_revisions.filter((revision) => revision.page_id === id).forEach((revision) => store.remove('page_revisions', revision.id, store.asMe({ silent: true })));
      store.ds.page_comments.filter((comment) => comment.page_id === id).forEach((comment) => store.remove('page_comments', comment.id, store.asMe({ silent: true })));
      store.remove('pages', id, store.asMe({ summary: `Page deleted — ${id}` }));
    });
    toast('Page deleted');
    onDeleted();
  };

  const restoreRevision = (revision: PageRevision) => {
    const current = store.ds.pages.find((candidate) => candidate.id === page.id);
    if (current) recordRevision(current);
    const patch = { ...revision.snapshot, last_edited_by: store.meId, last_edited_at: nowIso() };
    store.update('pages', page.id, patch, store.asMe({ summary: `Page restored from ${fmtDateTime(revision.created_at)}` }));
    setDraft({ ...draftFrom({ ...page, ...revision.snapshot }), cover_url: revision.snapshot.cover_url ?? null, full_width: revision.snapshot.full_width ?? false });
    setHistoryOpen(false);
    toast('Revision restored');
  };

  const headings = blocks.filter((block) => block.type === 'heading' && block.text);
  const crumbs = pageBreadcrumbs(page, pages);
  const backlinks = pageBacklinks(page.id, pages).filter((candidate) => candidate.id !== page.id);
  const lastEditor = profiles.find((profile) => profile.id === page.last_edited_by);
  const verified = isVerificationCurrent(page);
  const expired = !!page.verified_at && !verified;
  const commentCounts = new Map<string, number>();
  pageComments.forEach((comment) => { if (comment.block_id) commentCounts.set(comment.block_id, (commentCounts.get(comment.block_id) ?? 0) + 1); });

  return <div className={`wk-page${draft.full_width ? ' full-width' : ''}`} ref={pageRef}>
    {draft.cover_url && <div className="wk-cover" style={{ backgroundImage: `url("${draft.cover_url.replace(/"/g, '%22')}")` }} role="img" aria-label={`${draft.title || 'Page'} cover`} />}
    <nav className="wk-page-breadcrumb" aria-label="Page breadcrumb">{crumbs.map((candidate, index) => <span key={candidate.id}><button type="button" onClick={() => onSelect(candidate.id)}>{candidate.icon} {candidate.title}</button>{index < crumbs.length - 1 && ' / '}</span>)}</nav>
    <div className="wk-pagehead"><input className="wk-icon-input" value={draft.icon} aria-label="Page icon" maxLength={4} onChange={(event) => patchDraft({ icon: event.target.value })} /><DictateField label="Dictate the page title" className="grow"><input className="wk-title-input" value={draft.title} aria-label="Page title" placeholder="Untitled" onChange={(event) => patchDraft({ title: event.target.value })} /></DictateField><span className={`wk-save wk-save-${save}`} role="status" aria-live="polite">{save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved' : ''}</span></div>
    <div className="wk-pagemeta"><span>Edited by {lastEditor?.name ?? '—'} · {fmtDateTime(page.last_edited_at)}</span>{verified && <span className="wk-verified">✓ Verified{page.verification_expires_at ? ` until ${new Date(page.verification_expires_at).toLocaleDateString()}` : ''}</span>}{expired && <span className="wk-expired">Verification expired — owner should review</span>}{page.is_archived && <span className="pinflag">archived</span>}<span className="wk-presence" aria-label={`${presence.length} people on this page`}>{presence.map((profile) => profile && <span key={profile.id} title={`${profile.name} is here`}><Avatar userId={profile.id} /></span>)}</span></div>

    <PageTags tags={draft.tags} onChange={(tags) => patchDraft({ tags })} />

    <div className="wk-pageactions"><button type="button" className="btn sm" onClick={addSubPage}>+ Sub-page</button><button type="button" className="btn sm" onClick={undo} disabled={!undoStack.current.length} aria-label="Undo block edit">↶ Undo</button><button type="button" className="btn sm" onClick={redo} disabled={!redoStack.current.length} aria-label="Redo block edit">↷ Redo</button><button type="button" className="btn sm" onClick={() => setHistoryOpen((open) => !open)} aria-expanded={historyOpen}>History · {revisions.length}</button><button type="button" className="btn sm" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>Page settings</button><button type="button" className="btn sm" onClick={() => movePage(-1)} aria-label="Move page up">↑</button><button type="button" className="btn sm" onClick={() => movePage(1)} aria-label="Move page down">↓</button><button type="button" className="btn sm" onClick={toggleArchive}>{page.is_archived ? 'Restore' : 'Archive'}</button><button type="button" className="btn sm danger-text" onClick={deletePage}>Delete</button></div>

    <AnimatePresence>{settingsOpen && <motion.section className="wk-settings-panel" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={entrance}><label>Cover image URL<input className="wk-input" value={draft.cover_url ?? ''} placeholder="https://…" onChange={(event) => patchDraft({ cover_url: event.target.value || null })} /></label><label className="wk-check-label"><input type="checkbox" checked={draft.full_width} onChange={(event) => patchDraft({ full_width: event.target.checked })} /> Full-width page</label><PageGovernance page={page} /></motion.section>}</AnimatePresence>
    <AnimatePresence>{historyOpen && <PageHistory revisions={revisions} profiles={profiles} onRestore={restoreRevision} />}</AnimatePresence>

    <LinkedTasks page={page} />
    {backlinks.length > 0 && <section className="wk-backlinks"><span className="eyebrow">Backlinks</span><div>{backlinks.map((candidate) => <button type="button" key={candidate.id} onClick={() => onSelect(candidate.id)}>{candidate.icon} {candidate.title}</button>)}</div></section>}

    {selectedIds.size > 0 && <motion.div className="wk-selectionbar" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}><strong>{selectedIds.size} blocks</strong><button type="button" onClick={() => changeSelectedIndent(-1)}>Outdent</button><button type="button" onClick={() => changeSelectedIndent(1)}>Indent</button><button type="button" onClick={duplicateSelected}>Duplicate</button><button type="button" onClick={deleteSelected}>Delete</button><button type="button" onClick={() => setSelectedIds(new Set())}>Clear</button></motion.div>}

    <Reorder.Group axis="y" values={blocks} onReorder={(next) => setBlocks(next)} className="wk-blocks" as="div">
      {blocks.map((block, index) => <WikiBlockItem key={block.id} block={block} blocks={blocks} pages={pages} profiles={profiles} currentPage={page} index={index} count={blocks.length} hidden={isBlockHidden(blocks, index)} active={activeId === block.id} selected={selectedIds.has(block.id)} autoFocus={focusId === block.id} focusAtStart={focusAtStartId === block.id} forceMenu={forceMenuId === block.id} commentCount={commentCounts.get(block.id) ?? 0} onActivate={(additive) => { if (additive) { toggleSelected(block.id); return; } setSelectedIds(new Set()); setActiveId(block.id); setFocusId(block.id); setFocusAtStartId(null); }} onDeactivate={() => { setActiveId((current) => current === block.id ? null : current); setFocusId((current) => current === block.id ? null : current); }} onChange={(next) => replaceBlock(index, next)} onEnter={(start, end, openMenu) => insertAfter(index, start, end, openMenu)} onRemoveEmpty={() => removeAt(index)} onMove={(direction) => moveBlock(index, direction)} onIndent={(direction) => replaceBlock(index, withIndent(block, direction))} onDelete={() => removeAt(index, false)} onDuplicate={() => duplicateOne(block.id)} onToggleSelected={() => toggleSelected(block.id)} onComment={(anchor = '') => { setCommentTarget({ blockId: block.id, anchor }); window.requestAnimationFrame(() => document.getElementById('wiki-comments')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }} onMenuClosed={() => setForceMenuId(null)} onSelectPage={onSelect} onPasteImages={(files, start, end) => pasteIntoBlock(block.id, files, start, end)} onReplaceImage={(files) => replaceImage(block.id, files)} onPasteError={toast} />)}
    </Reorder.Group>

    <button type="button" className="wk-addblock" onClick={() => insertAfter(blocks.length - 1, undefined, undefined, true)}>+ Add a block</button>
    {headings.length >= 2 && <nav className="wk-floating-toc" aria-label="Page contents">{headings.map((heading) => <a key={heading.id} href={`#wk-heading-${heading.id}`}>{heading.text}</a>)}</nav>}
    {/* Blocks hold what the page says; this holds what it is built on — the
        contract, the spec, the export someone sent. Attaching one writes the
        row immediately, like every other change on this page. */}
    <section className="wk-files" aria-label="Files on this page">
      <Attachments entityType="page" entityId={page.id} hint="Source documents this page is written from." />
    </section>
    <PageComments pageId={page.id} target={commentTarget} onClearTarget={() => setCommentTarget(null)} />
  </div>;
}

function WikiBlockItem(props: Omit<React.ComponentProps<typeof BlockRow>, 'onDragStart'>) {
  const controls = useDragControls();
  const block = props.block;
  return <Reorder.Item as="div" value={block} dragListener={false} dragControls={controls} layout className={`wk-block-item${props.hidden ? ' hidden' : ''}`} data-width={block.width ?? 'full'} style={{ '--wk-indent': Math.max(0, Math.min(6, block.indent ?? 0)) } as React.CSSProperties}><BlockRow {...props} onDragStart={(event) => controls.start(event)} /></Reorder.Item>;
}

function PageTags({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => { const value = draft.trim(); if (!value || tags.includes(value)) return; onChange([...tags, value]); setDraft(''); };
  return <div className="wk-tags">{tags.map((tag) => <TagChip key={tag} name={tag} onRemove={() => onChange(tags.filter((candidate) => candidate !== tag))} />)}<input className="wk-input wk-taginput" value={draft} placeholder="+ tag" aria-label="Add tag" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} /></div>;
}

function PageGovernance({ page }: { page: Page }) {
  const store = useStore();
  const members = store.members;
  const verify = (days: number | null) => {
    const now = new Date();
    const expires = days == null ? null : new Date(now.getTime() + days * 86_400_000).toISOString();
    store.update('pages', page.id, { verified_at: now.toISOString(), verification_expires_at: expires }, store.asMe({ summary: 'Page verified' }));
  };
  return <div className="wk-governance"><label>Page owner<select value={page.owner_id ?? page.created_by} onChange={(event) => store.update('pages', page.id, { owner_id: event.target.value }, store.asMe({ summary: 'Page owner changed' }))}>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><div><span>Verification</span><button type="button" className="btn sm" onClick={() => verify(30)}>30 days</button><button type="button" className="btn sm" onClick={() => verify(90)}>90 days</button><button type="button" className="btn sm" onClick={() => verify(null)}>Indefinite</button>{page.verified_at && <button type="button" className="btn sm" onClick={() => store.update('pages', page.id, { verified_at: null, verification_expires_at: null }, store.asMe({ summary: 'Page verification removed' }))}>Remove</button>}</div></div>;
}

function PageHistory({ revisions, profiles, onRestore }: { revisions: PageRevision[]; profiles: ReturnType<typeof useStore>['ds']['profiles']; onRestore: (revision: PageRevision) => void }) {
  const ordered = [...revisions].sort((a, b) => b.created_at.localeCompare(a.created_at));
  return <motion.section className="wk-history" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={entrance}><span className="eyebrow">Page history</span>{ordered.length === 0 ? <p className="tip">The first revision appears after the next saved edit.</p> : ordered.slice(0, 50).map((revision) => <div className="wk-history-row" key={revision.id}><div><strong>{revision.snapshot.title || 'Untitled'}</strong><span>{profiles.find((profile) => profile.id === revision.author_id)?.name ?? 'Someone'} · {fmtDateTime(revision.created_at)}</span></div><button type="button" className="btn sm" onClick={() => onRestore(revision)}>Restore</button></div>)}</motion.section>;
}

function LinkedTasks({ page }: { page: Page }) {
  const store = useStore();
  const tasks = useData((dataset) => dataset.tasks);
  const [picking, setPicking] = useState('');
  const linked = page.linked_task_ids.map((id) => tasks.find((task) => task.id === id) ?? { id, title: 'Unknown task' });
  const addTask = (id: string) => { if (!id || page.linked_task_ids.includes(id)) return; store.update('pages', page.id, { linked_task_ids: [...page.linked_task_ids, id] }, store.asMe()); setPicking(''); };
  return <div className="wk-linked"><span className="eyebrow">Linked tasks</span><div className="wk-linkedrow">{linked.length === 0 && <span className="tip">None yet.</span>}{linked.map((task) => <span className="wk-taskchip" key={task.id}><Link className="lk" to={`/task/${task.id}`}>{task.id} — {task.title}</Link><button type="button" aria-label={`Unlink ${task.id}`} onClick={() => store.update('pages', page.id, { linked_task_ids: page.linked_task_ids.filter((id) => id !== task.id) }, store.asMe())}>×</button></span>)}<select className="wk-input wk-taskpick" value={picking} aria-label="Link a task" onChange={(event) => addTask(event.target.value)}><option value="">+ link a task…</option>{tasks.filter((task) => !page.linked_task_ids.includes(task.id)).map((task) => <option key={task.id} value={task.id}>{task.id} — {task.title}</option>)}</select></div></div>;
}

function PageComments({ pageId, target, onClearTarget }: { pageId: string; target: { blockId: string; anchor: string } | null; onClearTarget: () => void }) {
  const store = useStore();
  const toast = useToast();
  const comments = useData((dataset) => dataset.page_comments.filter((comment) => comment.page_id === pageId).sort((a, b) => a.created_at.localeCompare(b.created_at)));
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const roots = comments.filter((comment) => !comment.parent_comment_id && (showResolved || !comment.resolved_at));
  const post = () => {
    const value = body.trim();
    if (!value) return;
    store.insert('page_comments', { id: newId('pc'), page_id: pageId, author_id: store.meId, body: value, block_id: target?.blockId ?? null, anchor_text: target?.anchor || null, parent_comment_id: null, resolved_at: null, resolved_by: null, reaction_user_ids: [], created_at: nowIso() }, store.asMe({ summary: target ? 'Inline comment on page' : 'Comment on page' }));
    setBody(''); onClearTarget(); toast('Comment posted');
  };
  const postReply = (rootId: string) => {
    const value = reply.trim();
    if (!value) return;
    store.insert('page_comments', { id: newId('pc'), page_id: pageId, author_id: store.meId, body: value, parent_comment_id: rootId, block_id: null, anchor_text: null, resolved_at: null, resolved_by: null, reaction_user_ids: [], created_at: nowIso() }, store.asMe({ summary: 'Reply on page comment' }));
    setReply(''); setReplyTo(null);
  };
  const removeThread = (id: string) => {
    comments.filter((comment) => comment.parent_comment_id === id).forEach((comment) => store.remove('page_comments', comment.id, store.asMe({ silent: true })));
    store.remove('page_comments', id, store.asMe({ summary: 'Page comment deleted' }));
  };
  const mention = (id: string, setter: (value: string) => void, current: string) => {
    const profile = store.ds.profiles.find((candidate) => candidate.id === id);
    if (profile) setter(`${current}${current && !current.endsWith(' ') ? ' ' : ''}[[person:${profile.id}|${profile.name}]] `);
  };
  return <section className="wk-comments" id="wiki-comments"><div className="wk-comments-head"><span className="eyebrow">Comments</span><button type="button" className="chip" aria-pressed={showResolved} onClick={() => setShowResolved((show) => !show)}>Resolved</button></div>{roots.length === 0 && <p className="tip">No {showResolved ? '' : 'open '}comments on this page.</p>}{roots.map((comment) => {
    const replies = comments.filter((candidate) => candidate.parent_comment_id === comment.id);
    const reacted = comment.reaction_user_ids?.includes(store.meId) ?? false;
    return <article className={`wk-comment-thread${comment.resolved_at ? ' resolved' : ''}`} key={comment.id}>{comment.anchor_text && <blockquote>“{comment.anchor_text}”</blockquote>}{comment.block_id && !comment.anchor_text && <span className="wk-inline-label">Inline comment</span>}<div className="wk-comment"><Avatar userId={comment.author_id} /><div><div className="wk-comment-meta">{store.ds.profiles.find((profile) => profile.id === comment.author_id)?.name ?? 'Someone'} · {fmtDateTime(comment.created_at)}</div><div className="wk-comment-body"><RichText text={comment.body} /></div></div></div>{replies.map((candidate) => <div className="wk-comment wk-reply" key={candidate.id}><Avatar userId={candidate.author_id} /><div><div className="wk-comment-meta">{store.ds.profiles.find((profile) => profile.id === candidate.author_id)?.name ?? 'Someone'} · {fmtDateTime(candidate.created_at)}</div><div className="wk-comment-body"><RichText text={candidate.body} /></div></div></div>)}<div className="wk-comment-actions"><button type="button" onClick={() => { setReplyTo(comment.id); setReply(''); }}>Reply</button><button type="button" aria-pressed={reacted} onClick={() => store.update('page_comments', comment.id, { reaction_user_ids: reacted ? (comment.reaction_user_ids ?? []).filter((id) => id !== store.meId) : [...(comment.reaction_user_ids ?? []), store.meId] }, store.asMe({ silent: true }))}>♥ {(comment.reaction_user_ids ?? []).length || ''}</button><button type="button" onClick={() => store.update('page_comments', comment.id, { resolved_at: comment.resolved_at ? null : nowIso(), resolved_by: comment.resolved_at ? null : store.meId }, store.asMe({ summary: comment.resolved_at ? 'Comment reopened' : 'Comment resolved' }))}>{comment.resolved_at ? 'Reopen' : 'Resolve'}</button><button type="button" onClick={() => { const edited = window.prompt('Edit comment', comment.body); if (edited?.trim()) store.update('page_comments', comment.id, { body: edited.trim() }, store.asMe({ summary: 'Comment edited' })); }}>Edit</button><button type="button" className="danger-text" onClick={() => { if (window.confirm('Delete this comment thread?')) removeThread(comment.id); }}>Delete</button></div>{replyTo === comment.id && <div className="wk-composer wk-reply-composer"><DictateField label="Dictate this reply"><textarea className="wk-input" value={reply} placeholder="Reply…" aria-label="Reply to comment" onChange={(event) => setReply(event.target.value)} /></DictateField><select aria-label="Mention person in reply" defaultValue="" onChange={(event) => { mention(event.target.value, setReply, reply); event.target.value = ''; }}><option value="">@ person</option>{store.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><button type="button" className="btn sm solid" onClick={() => postReply(comment.id)} disabled={!reply.trim()}>Reply</button><button type="button" className="btn sm" onClick={() => setReplyTo(null)}>Cancel</button></div>}</article>;
  })}<div className="wk-composer">{target && <div className="wk-comment-target"><span>{target.anchor ? `Commenting on “${target.anchor}”` : 'Commenting on this block'}</span><button type="button" onClick={onClearTarget}>×</button></div>}<DictateField label="Dictate this comment"><textarea className="wk-input" value={body} placeholder={target ? 'Add an inline comment…' : 'Add a page comment…'} aria-label="Add a comment" onChange={(event) => setBody(event.target.value)} /></DictateField><select aria-label="Mention person in comment" defaultValue="" onChange={(event) => { mention(event.target.value, setBody, body); event.target.value = ''; }}><option value="">@ person</option>{store.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select><button type="button" className="btn sm solid" onClick={post} disabled={!body.trim()}>Post</button></div></section>;
}
