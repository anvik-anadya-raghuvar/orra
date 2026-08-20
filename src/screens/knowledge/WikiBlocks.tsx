import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { newId } from '../../data/store';
import { imageFilesFrom, looksLikeUnusableImage } from '../../ui/imagedrop';
import type { BlockType, Page, PageBlock, Profile } from '../../types';
import {
  applyInlineFormat,
  insertInlineToken,
  isSafeExternalUrl,
  pageBreadcrumbs,
  parseSimpleTable,
  serializeSimpleTable,
} from './wikiEditor';
import { RichText } from './wikiMentions';
import { MicButton } from '../../ui/dictation';

export const BLOCK_MENU: { type: BlockType; label: string; hint: string; group: string }[] = [
  { type: 'paragraph', label: 'Text', hint: 'Plain paragraph', group: 'Basic' },
  { type: 'heading', label: 'Heading', hint: 'H1, H2, or H3', group: 'Basic' },
  { type: 'list', label: 'Bulleted list', hint: 'One item per line', group: 'Basic' },
  { type: 'numbered', label: 'Numbered list', hint: 'Automatically numbered', group: 'Basic' },
  { type: 'todo', label: 'To-do', hint: 'Persistent checkboxes', group: 'Basic' },
  { type: 'toggle', label: 'Toggle', hint: 'Collapsible nested content', group: 'Basic' },
  { type: 'quote', label: 'Quote', hint: 'Pulled-out line', group: 'Basic' },
  { type: 'callout', label: 'Callout', hint: 'Tinted aside', group: 'Basic' },
  { type: 'divider', label: 'Divider', hint: 'Horizontal rule', group: 'Basic' },
  { type: 'table', label: 'Simple table', hint: 'Rows and columns, not a database', group: 'Basic' },
  { type: 'code', label: 'Code', hint: 'Multiline code block', group: 'Advanced' },
  { type: 'equation', label: 'Equation', hint: 'Mathematical expression', group: 'Advanced' },
  { type: 'button', label: 'Button', hint: 'A labelled external action', group: 'Advanced' },
  { type: 'toc', label: 'Table of contents', hint: 'Links to page headings', group: 'Advanced' },
  { type: 'breadcrumb', label: 'Breadcrumb', hint: 'This page’s location', group: 'Advanced' },
  { type: 'page_link', label: 'Link to page', hint: 'A wiki page block', group: 'Links' },
  { type: 'bookmark', label: 'Web bookmark', hint: 'A rich external link', group: 'Links' },
  { type: 'image', label: 'Image', hint: 'Paste, upload, or URL', group: 'Media' },
  { type: 'file', label: 'File', hint: 'Downloadable file link', group: 'Media' },
  { type: 'pdf', label: 'PDF', hint: 'Embedded PDF', group: 'Media' },
  { type: 'video', label: 'Video', hint: 'Playable video URL', group: 'Media' },
  { type: 'audio', label: 'Audio', hint: 'Playable audio URL', group: 'Media' },
  { type: 'embed', label: 'Embed', hint: 'External web content', group: 'Media' },
];

const TEXTY: BlockType[] = ['paragraph', 'heading', 'quote', 'callout', 'code', 'equation', 'toggle'];
const LISTY: BlockType[] = ['list', 'numbered', 'todo'];
const URL_TYPES: BlockType[] = ['bookmark', 'file', 'pdf', 'video', 'audio', 'embed'];

export const isTexty = (type: BlockType) => TEXTY.includes(type);
export const isListy = (type: BlockType) => LISTY.includes(type);

export function makeBlock(type: BlockType = 'paragraph'): PageBlock {
  const block: PageBlock = { id: newId('b'), type, indent: 0, width: 'full' };
  if (isTexty(type)) block.text = '';
  if (type === 'heading') block.level = 2;
  if (type === 'code') block.lang = 'ts';
  if (type === 'callout') block.icon = '💡';
  if (type === 'toggle') block.collapsed = false;
  if (isListy(type)) block.items = [{ text: '', ...(type === 'todo' ? { done: false } : {}) }];
  if (type === 'image') Object.assign(block, { src: '', alt: '', caption: '', align: 'center', display_width: 100, mask: 'rounded', fit: 'contain' });
  if (type === 'table') block.rows = [['', ''], ['', '']];
  if (URL_TYPES.includes(type)) Object.assign(block, { title: '', url: '' });
  if (type === 'page_link') block.page_id = '';
  if (type === 'button') Object.assign(block, { text: 'Button', url: '' });
  return block;
}

/** Convert a block while retaining its text, outline level, and layout width. */
export function convertBlock(block: PageBlock, type: BlockType): PageBlock {
  const carried = blockText(block);
  const next = makeBlock(type);
  next.id = block.id;
  next.indent = block.indent ?? 0;
  next.width = block.width ?? 'full';
  if (isTexty(type)) next.text = carried.startsWith('/') ? '' : carried;
  if (isListy(type)) {
    const lines = carried.split('\n');
    next.items = (lines.length ? lines : ['']).map((text, index) => ({
      text,
      ...(type === 'todo' ? { done: block.items?.[index]?.done ?? false } : {}),
    }));
  }
  return next;
}

export function blockText(block: PageBlock): string {
  if (isListy(block.type)) return (block.items ?? []).map((item) => item.text).join('\n');
  if (block.type === 'table') return serializeSimpleTable(block.rows);
  if (block.type === 'image') return [block.alt, block.caption].filter(Boolean).join(' ');
  if (block.type === 'page_link') return block.title ?? '';
  if (URL_TYPES.includes(block.type)) return [block.title, block.url].filter(Boolean).join(' ');
  return block.text ?? '';
}

function embedUrl(value = ''): string {
  if (!isSafeExternalUrl(value)) return '';
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${url.pathname.slice(1)}`;
    if (url.hostname.includes('youtube.com') && url.searchParams.get('v')) {
      return `https://www.youtube-nocookie.com/embed/${url.searchParams.get('v')}`;
    }
  } catch {}
  return value;
}

export function BlockView({
  block,
  blocks,
  pages,
  currentPage,
  onSelectPage,
  onToggleTodo,
  onToggleCollapse,
}: {
  block: PageBlock;
  blocks: PageBlock[];
  pages: Page[];
  currentPage: Page;
  onSelectPage: (id: string) => void;
  onToggleTodo?: (index: number) => void;
  onToggleCollapse?: () => void;
}) {
  const rich = (text = '') => <RichText text={text} onSelectPage={onSelectPage} />;
  switch (block.type) {
    case 'heading': {
      const level = Math.min(3, Math.max(1, block.level ?? 2));
      const Tag = (['h2', 'h3', 'h4'] as const)[level - 1];
      return <Tag id={`wk-heading-${block.id}`} className={`wk-h wk-h${level}`}>{rich(block.text)}</Tag>;
    }
    case 'paragraph': return <p className="wk-p">{rich(block.text)}</p>;
    case 'quote': return <blockquote className="wk-blockquote">{rich(block.text)}</blockquote>;
    case 'callout': return <div className="wk-callout"><span className="wk-callout-icon" aria-hidden>{block.icon || '💡'}</span><div>{rich(block.text)}</div></div>;
    case 'code': return <div className="wk-code">{block.lang && <span className="wk-lang">{block.lang}</span>}<pre><code>{block.text}</code></pre></div>;
    case 'equation': return <div className="wk-equation" aria-label={`Equation: ${block.text ?? ''}`}>{block.text || 'E = mc²'}</div>;
    case 'list': return <ul className="wk-list">{(block.items ?? []).map((item, index) => <li key={index}>{rich(item.text)}</li>)}</ul>;
    case 'numbered': return <ol className="wk-list wk-numbered">{(block.items ?? []).map((item, index) => <li key={index}>{rich(item.text)}</li>)}</ol>;
    case 'todo': return <div className="wk-todos">{(block.items ?? []).map((item, index) => <div className="wk-todo" key={index}><button type="button" className={`wk-check ${item.done ? 'on' : ''}`} role="checkbox" aria-checked={!!item.done} aria-label={item.text || `Item ${index + 1}`} onClick={(event) => { event.stopPropagation(); onToggleTodo?.(index); }}>{item.done ? '✓' : ''}</button><span className={item.done ? 'done' : ''}>{rich(item.text)}</span></div>)}</div>;
    case 'toggle': return <div className="wk-toggle"><button type="button" className="wk-toggle-button" aria-expanded={!block.collapsed} onClick={(event) => { event.stopPropagation(); onToggleCollapse?.(); }}><span aria-hidden>{block.collapsed ? '▸' : '▾'}</span>{rich(block.text || 'Toggle')}</button></div>;
    case 'image': {
      const image = block.src ? <img className={`wk-img mask-${block.mask ?? 'rounded'} fit-${block.fit ?? 'contain'}`} src={block.src} alt={block.alt ?? ''} loading="lazy" decoding="async" /> : <span className="wk-media-missing">Image — paste, upload, or add a URL</span>;
      return <figure className={`wk-image-view align-${block.align ?? 'center'}`} style={{ width: `${block.display_width ?? 100}%` }}>{block.link_url && isSafeExternalUrl(block.link_url) ? <a href={block.link_url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{image}</a> : image}{block.caption && <figcaption>{rich(block.caption)}</figcaption>}</figure>;
    }
    case 'table': return <div className="wk-table-wrap"><table className="wk-simple-table"><tbody>{(block.rows ?? []).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{rich(cell)}</td>)}</tr>)}</tbody></table></div>;
    case 'page_link': {
      const linked = pages.find((page) => page.id === block.page_id);
      return <button type="button" className="wk-page-link" disabled={!linked} onClick={(event) => { event.stopPropagation(); if (linked) onSelectPage(linked.id); }}><span>{linked?.icon ?? '↗'}</span>{linked?.title ?? 'Choose a page'}</button>;
    }
    case 'bookmark': return isSafeExternalUrl(block.url) ? <a className="wk-bookmark" href={block.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}><strong>{block.title || block.url}</strong><span>{block.url}</span></a> : <span className="wk-media-missing">Add a bookmark URL</span>;
    case 'file': return isSafeExternalUrl(block.url) ? <a className="wk-file" href={block.url} target="_blank" rel="noreferrer" download onClick={(event) => event.stopPropagation()}>↓ {block.title || 'Download file'}</a> : <span className="wk-media-missing">Add a file URL</span>;
    case 'pdf': return embedUrl(block.url) ? <iframe className="wk-embed wk-pdf" title={block.title || 'PDF'} src={embedUrl(block.url)} loading="lazy" /> : <span className="wk-media-missing">Add a PDF URL</span>;
    case 'video': return isSafeExternalUrl(block.url) ? <video className="wk-media-player" controls preload="metadata" src={block.url} /> : <span className="wk-media-missing">Add a video URL</span>;
    case 'audio': return isSafeExternalUrl(block.url) ? <audio className="wk-audio-player" controls preload="metadata" src={block.url} /> : <span className="wk-media-missing">Add an audio URL</span>;
    case 'embed': return embedUrl(block.url) ? <iframe className="wk-embed" title={block.title || 'Embedded content'} src={embedUrl(block.url)} loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" /> : <span className="wk-media-missing">Add an embed URL</span>;
    case 'button': return isSafeExternalUrl(block.url) ? <a className="btn solid wk-action-button" href={block.url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>{block.text || 'Button'}</a> : <span className="wk-media-missing">Add a button label and URL</span>;
    case 'toc': {
      const headings = blocks.filter((candidate) => candidate.type === 'heading' && candidate.text);
      return <nav className="wk-toc" aria-label="Table of contents">{headings.length ? headings.map((heading) => <a key={heading.id} href={`#wk-heading-${heading.id}`} className={`depth-${heading.level ?? 2}`} onClick={(event) => event.stopPropagation()}>{heading.text}</a>) : <span className="tip">Add headings to build this table of contents.</span>}</nav>;
    }
    case 'breadcrumb': return <nav className="wk-breadcrumb-block" aria-label="Breadcrumb">{pageBreadcrumbs(currentPage, pages).map((candidate, index, trail) => <React.Fragment key={candidate.id}><button type="button" onClick={(event) => { event.stopPropagation(); onSelectPage(candidate.id); }}>{candidate.icon} {candidate.title}</button>{index < trail.length - 1 && <span>/</span>}</React.Fragment>)}</nav>;
    case 'divider': return <hr className="wk-divider" />;
    default: return null;
  }
}

const AutoTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function AutoTextarea(props, ref) {
    const inner = useRef<HTMLTextAreaElement | null>(null);
    useLayoutEffect(() => {
      const element = inner.current;
      if (!element) return;
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
    }, [props.value]);
    return <textarea {...props} rows={1} ref={(element) => { inner.current = element; if (typeof ref === 'function') ref(element); else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = element; }} />;
  },
);

function SimpleTableEditor({ block, onChange }: { block: PageBlock; onChange: (block: PageBlock) => void }) {
  const rows = block.rows?.length ? block.rows : [['', ''], ['', '']];
  const setCell = (rowIndex: number, cellIndex: number, value: string) => {
    const next = rows.map((row) => [...row]);
    next[rowIndex][cellIndex] = value;
    onChange({ ...block, rows: next });
  };
  return <div className="wk-table-editor"><div className="wk-table-wrap"><table className="wk-simple-table"><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><input value={cell} aria-label={`Row ${rowIndex + 1}, column ${cellIndex + 1}`} onChange={(event) => setCell(rowIndex, cellIndex, event.target.value)} /></td>)}</tr>)}</tbody></table></div><div className="wk-table-actions"><button type="button" className="btn sm" onClick={() => onChange({ ...block, rows: [...rows, Array(rows[0]?.length || 2).fill('')] })}>+ Row</button><button type="button" className="btn sm" onClick={() => onChange({ ...block, rows: rows.map((row) => [...row, '']) })}>+ Column</button>{rows.length > 1 && <button type="button" className="btn sm" onClick={() => onChange({ ...block, rows: rows.slice(0, -1) })}>− Row</button>}{(rows[0]?.length ?? 0) > 2 && <button type="button" className="btn sm" onClick={() => onChange({ ...block, rows: rows.map((row) => row.slice(0, -1)) })}>− Column</button>}</div></div>;
}

function RichToolbar({
  textarea,
  value,
  pages,
  profiles,
  onValue,
  onComment,
}: {
  textarea: React.RefObject<HTMLTextAreaElement>;
  value: string;
  pages: Page[];
  profiles: Profile[];
  onValue: (value: string, selectionStart: number, selectionEnd: number) => void;
  onComment: (anchor: string) => void;
}) {
  const remembered = useRef({ start: value.length, end: value.length });
  const remember = () => {
    const element = textarea.current;
    if (element) remembered.current = { start: element.selectionStart, end: element.selectionEnd };
  };
  const apply = (before: string, after = before, placeholder = 'text') => {
    remember();
    const result = applyInlineFormat(value, remembered.current.start, remembered.current.end, before, after, placeholder);
    onValue(result.value, result.selectionStart, result.selectionEnd);
  };
  const insert = (token: string) => {
    const result = insertInlineToken(value, remembered.current.start, remembered.current.end, token);
    onValue(result.value, result.selectionStart, result.selectionEnd);
  };
  const keepFocus = (event: React.MouseEvent) => { remember(); event.preventDefault(); };
  return <div className="wk-richbar" role="toolbar" aria-label="Text formatting">
    <button type="button" aria-label="Bold" onMouseDown={keepFocus} onClick={() => apply('**')}><b>B</b></button>
    <button type="button" aria-label="Italic" onMouseDown={keepFocus} onClick={() => apply('_')}><i>I</i></button>
    <button type="button" aria-label="Underline" onMouseDown={keepFocus} onClick={() => apply('__')}><u>U</u></button>
    <button type="button" aria-label="Strikethrough" onMouseDown={keepFocus} onClick={() => apply('~~')}><s>S</s></button>
    <button type="button" aria-label="Inline code" onMouseDown={keepFocus} onClick={() => apply('`')}><code>&lt;/&gt;</code></button>
    <button type="button" aria-label="Add link" onMouseDown={keepFocus} onClick={() => { const url = window.prompt('Link URL (https:// or mailto:)'); if (url && isSafeExternalUrl(url)) apply('[', `](${url})`, 'link'); }}>↗</button>
    <select aria-label="Mention page" defaultValue="" onMouseDown={remember} onChange={(event) => { const page = pages.find((candidate) => candidate.id === event.target.value); if (page) insert(`[[page:${page.id}|${page.title}]]`); event.target.value = ''; }}><option value="">Page @</option>{pages.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}</select>
    <select aria-label="Mention person" defaultValue="" onMouseDown={remember} onChange={(event) => { const profile = profiles.find((candidate) => candidate.id === event.target.value); if (profile) insert(`[[person:${profile.id}|${profile.name}]]`); event.target.value = ''; }}><option value="">Person @</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select>
    <input type="date" aria-label="Mention date" onMouseDown={remember} onChange={(event) => { if (event.target.value) insert(`[[date:${event.target.value}]]`); event.target.value = ''; }} />
    <button type="button" aria-label="Comment on selection" onMouseDown={keepFocus} onClick={() => onComment(value.slice(remembered.current.start, remembered.current.end))}>💬</button>
    {/* Dictation belongs on the formatting bar rather than inside the block:
        a block is edited in place with no chrome of its own, and the toolbar is
        already where you reach for anything you do TO the text. */}
    <MicButton targetRef={textarea} label="Dictate this block" />
  </div>;
}

export interface BlockRowProps {
  block: PageBlock;
  blocks: PageBlock[];
  pages: Page[];
  profiles: Profile[];
  currentPage: Page;
  index: number;
  count: number;
  active: boolean;
  selected: boolean;
  hidden: boolean;
  autoFocus: boolean;
  focusAtStart?: boolean;
  forceMenu?: boolean;
  commentCount?: number;
  onActivate: (additive?: boolean) => void;
  onDeactivate: () => void;
  onChange: (block: PageBlock) => void;
  onEnter: (selectionStart?: number, selectionEnd?: number, openMenu?: boolean) => void;
  onRemoveEmpty: () => void;
  onMove: (direction: -1 | 1) => void;
  onIndent: (direction: -1 | 1) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onToggleSelected: () => void;
  onComment: (anchor?: string) => void;
  onMenuClosed: () => void;
  onSelectPage: (id: string) => void;
  onDragStart: (event: React.PointerEvent) => void;
  onPasteImages: (files: File[], selectionStart: number, selectionEnd: number) => void;
  onReplaceImage: (files: File[]) => void;
  onPasteError: (message: string) => void;
}

export function BlockRow(props: BlockRowProps) {
  const { block, blocks, pages, profiles, currentPage, index, count, active, selected, hidden, autoFocus, focusAtStart = false, forceMenu = false, commentCount = 0, onActivate, onDeactivate, onChange, onEnter, onRemoveEmpty, onMove, onIndent, onDelete, onDuplicate, onToggleSelected, onComment, onMenuClosed, onSelectPage, onDragStart, onPasteImages, onReplaceImage, onPasteError } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const [fullScreen, setFullScreen] = useState(false);
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  const pendingSelection = useRef<{ start: number; end: number } | null>(null);
  const value = block.type === 'table' ? serializeSimpleTable(block.rows) : blockText(block);

  useEffect(() => { if (forceMenu) setMenuOpen(true); }, [forceMenu]);
  useLayoutEffect(() => {
    if (!autoFocus || !active) return;
    const element = textarea.current;
    if (!element) return;
    element.focus();
    const position = focusAtStart ? 0 : element.value.length;
    element.setSelectionRange(position, position);
  }, [autoFocus, active, block.type, focusAtStart]);
  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    const element = textarea.current;
    if (!selection || !element) return;
    pendingSelection.current = null;
    element.focus();
    element.setSelectionRange(selection.start, selection.end);
  }, [value]);

  const setText = (text: string) => {
    if (isListy(block.type)) {
      const previous = block.items ?? [];
      onChange({ ...block, items: text.split('\n').map((line, itemIndex) => ({ text: line, ...(block.type === 'todo' ? { done: previous[itemIndex]?.done ?? false } : {}) })) });
    } else if (block.type === 'table') onChange({ ...block, rows: parseSimpleTable(text) });
    else onChange({ ...block, text });
  };

  const setTextAndSelection = (text: string, selectionStart: number, selectionEnd: number) => {
    pendingSelection.current = { start: selectionStart, end: selectionEnd };
    setText(text);
  };

  const filteredMenu = useMemo(() => {
    const query = value.startsWith('/') ? value.slice(1).trim().toLowerCase() : '';
    return query ? BLOCK_MENU.filter((item) => `${item.label} ${item.hint} ${item.group}`.toLowerCase().includes(query)) : BLOCK_MENU;
  }, [value]);

  const chooseType = (type: BlockType) => {
    onChange(convertBlock(block, type));
    setMenuOpen(false);
    onMenuClosed();
    onActivate();
  };

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    const shortcuts: Record<string, { type: BlockType; level?: number }> = {
      '# ': { type: 'heading', level: 1 }, '## ': { type: 'heading', level: 2 }, '### ': { type: 'heading', level: 3 },
      '- ': { type: 'list' }, '* ': { type: 'list' }, '1. ': { type: 'numbered' }, '[] ': { type: 'todo' }, '> ': { type: 'toggle' }, '" ': { type: 'quote' }, '---': { type: 'divider' },
    };
    if (!value && shortcuts[next]) {
      const converted = convertBlock(block, shortcuts[next].type);
      if (shortcuts[next].level) converted.level = shortcuts[next].level;
      onChange(converted);
      return;
    }
    if (next.startsWith('/') && (value === '' || value.startsWith('/'))) {
      setMenuOpen(true);
      setMenuIndex(0);
    } else if (menuOpen && value.startsWith('/')) setMenuOpen(false);
    setText(next);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const element = event.currentTarget;
    if (menuOpen && value.startsWith('/')) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setMenuIndex((current) => Math.max(0, Math.min(filteredMenu.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1))));
        return;
      }
      if (event.key === 'Enter' && filteredMenu[menuIndex]) {
        event.preventDefault();
        chooseType(filteredMenu[menuIndex].type);
        return;
      }
    }
    if (event.key === 'Escape') {
      if (menuOpen) { setMenuOpen(false); onMenuClosed(); return; }
      onDeactivate();
      element.blur();
      return;
    }
    if (event.key === 'Tab' && block.type !== 'code') {
      event.preventDefault();
      onIndent(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      if (isListy(block.type)) {
        const before = element.value.slice(0, element.selectionStart);
        const line = before.slice(before.lastIndexOf('\n') + 1);
        if (line === '' && element.selectionStart === element.value.length) {
          event.preventDefault();
          setText(element.value.replace(/\n?$/, ''));
          onEnter(element.selectionStart, element.selectionEnd);
        }
        return;
      }
      if (block.type === 'code') return;
      event.preventDefault();
      onEnter(element.selectionStart, element.selectionEnd);
      return;
    }
    if (event.key === 'Backspace' && element.value === '' && element.selectionStart === 0) {
      event.preventDefault();
      onRemoveEmpty();
    }
  };

  const paste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFilesFrom(event.clipboardData);
    if (!files.length) {
      if (looksLikeUnusableImage(event.clipboardData)) onPasteError('That image came from a web page rather than the clipboard as a file. Save it, or use a screenshot tool, then paste again.');
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onPasteImages(files, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
  };

  const placeholder = block.type === 'code' ? 'Code…' : block.type === 'heading' ? 'Heading' : block.type === 'toggle' ? 'Toggle heading' : isListy(block.type) ? 'One item per line' : 'Write, or type / for blocks';
  const textEditor = <><RichToolbar textarea={textarea} value={value} pages={pages} profiles={profiles} onValue={setTextAndSelection} onComment={(anchor) => onComment(anchor)} /><AutoTextarea ref={textarea} className={`wk-ta wk-ta-${block.type}`} value={value} placeholder={placeholder} aria-label={`${block.type} block`} onChange={handleChange} onKeyDown={handleKeyDown} onPaste={paste} /></>;

  const activeEditor = block.type === 'table' ? <SimpleTableEditor block={block} onChange={onChange} />
    : block.type === 'page_link' ? <div className="wk-link-editor"><select className="wk-input" aria-label="Linked page" value={block.page_id ?? ''} onChange={(event) => onChange({ ...block, page_id: event.target.value })}><option value="">Choose a page…</option>{pages.filter((page) => page.id !== currentPage.id).map((page) => <option key={page.id} value={page.id}>{page.icon} {page.title}</option>)}</select><BlockView block={block} blocks={blocks} pages={pages} currentPage={currentPage} onSelectPage={onSelectPage} /></div>
    : URL_TYPES.includes(block.type) ? <div className="wk-link-editor"><input className="wk-input" value={block.title ?? ''} aria-label={`${block.type} title`} placeholder="Title" onChange={(event) => onChange({ ...block, title: event.target.value })} /><input className="wk-input" value={block.url ?? ''} aria-label={`${block.type} URL`} placeholder="https://…" onChange={(event) => onChange({ ...block, url: event.target.value })} /><BlockView block={block} blocks={blocks} pages={pages} currentPage={currentPage} onSelectPage={onSelectPage} /></div>
    : block.type === 'button' ? <div className="wk-link-editor"><input className="wk-input" value={block.text ?? ''} aria-label="Button label" placeholder="Button label" onChange={(event) => onChange({ ...block, text: event.target.value })} /><input className="wk-input" value={block.url ?? ''} aria-label="Button URL" placeholder="https://…" onChange={(event) => onChange({ ...block, url: event.target.value })} /><BlockView block={block} blocks={blocks} pages={pages} currentPage={currentPage} onSelectPage={onSelectPage} /></div>
    : block.type === 'toc' || block.type === 'breadcrumb' ? <BlockView block={block} blocks={blocks} pages={pages} currentPage={currentPage} onSelectPage={onSelectPage} />
    : textEditor;

  return <div className={`wk-block${active ? ' active' : ''}${selected ? ' selected' : ''}${hidden ? ' hidden' : ''}`} data-type={block.type}>
    <div className="wk-block-tools">
      <button type="button" className="wk-tool" aria-label="Add block below" onClick={() => onEnter(undefined, undefined, true)}>+</button>
      <button type="button" className="wk-tool wk-handle" aria-label="Block actions and drag handle" aria-expanded={menuOpen} onPointerDown={onDragStart} onClick={() => { setMenuOpen((open) => !open); if (menuOpen) onMenuClosed(); }}>⋮⋮</button>
      {commentCount > 0 && <button type="button" className="wk-comment-count" aria-label={`${commentCount} comments on block`} onClick={() => onComment()}>{commentCount}</button>}
    </div>
    <div className="wk-block-body" onBlur={(event) => { if (menuOpen || event.currentTarget.contains(event.relatedTarget as Node | null)) return; if (active) onDeactivate(); }}>
      {block.type === 'divider' ? <button type="button" className="wk-divider-btn" aria-label="Divider block" onClick={() => onActivate()}><hr className="wk-divider" /></button>
        : block.type === 'image' ? <figure className={`wk-image-block${active ? ' active' : ''}`}>
          <button type="button" className={`wk-image-surface align-${block.align ?? 'center'}`} style={{ width: `${block.display_width ?? 100}%` }} aria-label={block.alt ? `Image: ${block.alt}` : 'Image block'} onClick={() => onActivate()}>{block.src ? <img className={`wk-img mask-${block.mask ?? 'rounded'} fit-${block.fit ?? 'contain'}`} src={block.src} alt={block.alt ?? ''} loading="lazy" decoding="async" /> : <span className="wk-image-empty"><b>Image</b><span>Paste, upload, or embed by URL.</span></span>}</button>
          {block.caption && !active && <figcaption><RichText text={block.caption} onSelectPage={onSelectPage} /></figcaption>}
          {active && <div className="wk-media-controls"><input className="wk-input" value={block.src?.startsWith('data:image/') ? '' : block.src ?? ''} disabled={block.src?.startsWith('data:image/')} placeholder={block.src?.startsWith('data:image/') ? 'Pasted image' : 'Image URL'} aria-label="Image URL" onChange={(event) => onChange({ ...block, src: event.target.value })} /><label className="btn sm">Replace<input type="file" accept="image/*" hidden onChange={(event) => { const files = Array.from(event.target.files ?? []); if (files.length) onReplaceImage(files); event.target.value = ''; }} /></label>{block.src && <><button type="button" className="btn sm" onClick={() => setFullScreen(true)}>Full screen</button><a className="btn sm" href={block.src} download={block.alt || 'image.jpg'} onClick={(event) => event.stopPropagation()}>Download</a></>}<label>Width <input type="range" min="25" max="100" step="5" value={block.display_width ?? 100} onChange={(event) => onChange({ ...block, display_width: Number(event.target.value) })} /></label><select aria-label="Image alignment" value={block.align ?? 'center'} onChange={(event) => onChange({ ...block, align: event.target.value as PageBlock['align'] })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select><select aria-label="Image mask" value={block.mask ?? 'rounded'} onChange={(event) => onChange({ ...block, mask: event.target.value as PageBlock['mask'] })}><option value="none">Square</option><option value="rounded">Rounded</option><option value="circle">Circle</option></select><select aria-label="Image fit" value={block.fit ?? 'contain'} onChange={(event) => onChange({ ...block, fit: event.target.value as PageBlock['fit'] })}><option value="contain">Fit</option><option value="cover">Crop</option></select><input className="wk-input" value={block.link_url ?? ''} aria-label="Image link" placeholder="Link image to https://…" onChange={(event) => onChange({ ...block, link_url: event.target.value })} /><input className="wk-input" value={block.caption ?? ''} aria-label="Image caption" placeholder="Add a caption" onChange={(event) => onChange({ ...block, caption: event.target.value })} /><input className="wk-input" value={block.alt ?? ''} aria-label="Image alt text" placeholder="Alt text for accessibility" onChange={(event) => onChange({ ...block, alt: event.target.value })} /></div>}
        </figure>
        : active ? <>{block.type === 'heading' && <select className="wk-mini" aria-label="Heading level" value={block.level ?? 2} onChange={(event) => onChange({ ...block, level: Number(event.target.value) })}><option value={1}>H1</option><option value={2}>H2</option><option value={3}>H3</option></select>}{block.type === 'code' && <input className="wk-mini" aria-label="Language" value={block.lang ?? ''} placeholder="lang" onChange={(event) => onChange({ ...block, lang: event.target.value })} />}{block.type === 'callout' && <input className="wk-mini" aria-label="Callout icon" value={block.icon ?? ''} placeholder="💡" onChange={(event) => onChange({ ...block, icon: event.target.value })} />}{activeEditor}</>
        : <div className="wk-readview" role="button" tabIndex={0} onClick={(event) => onActivate(event.shiftKey)} onFocus={(event) => { if (event.target === event.currentTarget) onActivate(); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onActivate(); } }}>{value || ['toc', 'breadcrumb'].includes(block.type) ? <BlockView block={block} blocks={blocks} pages={pages} currentPage={currentPage} onSelectPage={onSelectPage} onToggleTodo={(itemIndex) => onChange({ ...block, items: (block.items ?? []).map((item, candidateIndex) => candidateIndex === itemIndex ? { ...item, done: !item.done } : item) })} onToggleCollapse={() => onChange({ ...block, collapsed: !block.collapsed })} /> : <span className="wk-empty">{placeholder}</span>}</div>}

      {menuOpen && <div className="wk-slash" role="menu" aria-label="Block actions and type">
        <div className="wk-block-actions"><button type="button" role="menuitem" disabled={index === 0} onClick={() => { onMove(-1); setMenuOpen(false); }}><strong>Move up</strong></button><button type="button" role="menuitem" disabled={index === count - 1} onClick={() => { onMove(1); setMenuOpen(false); }}><strong>Move down</strong></button><button type="button" role="menuitem" onClick={() => { onDuplicate(); setMenuOpen(false); }}><strong>Duplicate</strong></button><button type="button" role="menuitem" onClick={() => { onToggleSelected(); setMenuOpen(false); }}><strong>{selected ? 'Unselect' : 'Select'}</strong></button><button type="button" role="menuitem" onClick={() => { onComment(); setMenuOpen(false); }}><strong>Comment</strong></button><button type="button" role="menuitem" className="danger" onClick={onDelete}><strong>Delete</strong></button></div>
        <div className="wk-outline-actions"><button type="button" disabled={(block.indent ?? 0) <= 0} onClick={() => onIndent(-1)}>← Outdent</button><button type="button" disabled={(block.indent ?? 0) >= 6} onClick={() => onIndent(1)}>Indent →</button><label>Width <select value={block.width ?? 'full'} onChange={(event) => onChange({ ...block, width: event.target.value as PageBlock['width'] })}><option value="full">Full</option><option value="half">Half</option><option value="third">Third</option></select></label></div>
        {filteredMenu.map((item, itemIndex) => <button key={item.type} type="button" role="menuitem" className={`${block.type === item.type ? 'on' : ''}${menuIndex === itemIndex && value.startsWith('/') ? ' cursor' : ''}`} onClick={() => chooseType(item.type)}><strong>{item.label}</strong><span>{item.hint}</span></button>)}
      </div>}
    </div>
    <AnimatePresence>{fullScreen && block.src && <motion.div className="wk-lightbox" role="dialog" aria-modal="true" aria-label="Image preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setFullScreen(false)}><motion.img src={block.src} alt={block.alt ?? ''} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} /><button type="button" aria-label="Close image preview" onClick={() => setFullScreen(false)}>×</button></motion.div>}</AnimatePresence>
  </div>;
}
