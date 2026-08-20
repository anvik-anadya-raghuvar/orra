import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { newId } from '../../data/store';
import { imageFilesFrom, looksLikeUnusableImage } from '../../ui/imagedrop';
import type { BlockType, PageBlock } from '../../types';
import { RichText } from './wikiMentions';

/* ── block vocabulary ─────────────────────────────────────────────────── */

export const BLOCK_MENU: { type: BlockType; label: string; hint: string }[] = [
  { type: 'paragraph', label: 'Text', hint: 'Plain paragraph' },
  { type: 'heading', label: 'Heading', hint: 'Section title' },
  { type: 'list', label: 'Bulleted list', hint: 'One item per line' },
  { type: 'todo', label: 'To-do', hint: 'Checkboxes that persist' },
  { type: 'code', label: 'Code', hint: 'Monospace block' },
  { type: 'callout', label: 'Callout', hint: 'Tinted aside' },
  { type: 'quote', label: 'Quote', hint: 'Pulled-out line' },
  { type: 'image', label: 'Image', hint: 'By URL' },
  { type: 'divider', label: 'Divider', hint: 'Horizontal rule' },
];

const TEXTY: BlockType[] = ['paragraph', 'heading', 'quote', 'callout', 'code'];
const LISTY: BlockType[] = ['list', 'todo'];

export const isTexty = (t: BlockType) => TEXTY.includes(t);
export const isListy = (t: BlockType) => LISTY.includes(t);

export function makeBlock(type: BlockType = 'paragraph'): PageBlock {
  const b: PageBlock = { id: newId('b'), type };
  if (isTexty(type)) b.text = '';
  if (type === 'heading') b.level = 2;
  if (type === 'code') b.lang = 'ts';
  if (type === 'callout') b.icon = '💡';
  if (isListy(type)) b.items = [{ text: '', ...(type === 'todo' ? { done: false } : {}) }];
  if (type === 'image') {
    b.src = '';
    b.alt = '';
  }
  return b;
}

/** Convert a block in place, carrying whatever content survives the change. */
export function convertBlock(b: PageBlock, type: BlockType): PageBlock {
  const carried = isTexty(b.type) ? b.text ?? '' : isListy(b.type) ? (b.items ?? []).map((i) => i.text).join('\n') : '';
  const next = makeBlock(type);
  next.id = b.id;
  if (isTexty(type)) next.text = carried;
  if (isListy(type)) {
    const lines = carried.split('\n');
    next.items = (lines.length ? lines : ['']).map((text) => ({
      text,
      ...(type === 'todo' ? { done: false } : {}),
    }));
  }
  return next;
}

/** Text used for search and for the list/todo textarea. */
export function blockText(b: PageBlock): string {
  if (isListy(b.type)) return (b.items ?? []).map((i) => i.text).join('\n');
  if (b.type === 'image') return b.alt ?? '';
  return b.text ?? '';
}

/* ── read view ────────────────────────────────────────────────────────── */

export function BlockView({
  block,
  onToggleTodo,
}: {
  block: PageBlock;
  onToggleTodo?: (index: number) => void;
}) {
  switch (block.type) {
    case 'heading': {
      const lvl = Math.min(3, Math.max(1, block.level ?? 2));
      const Tag = (['h2', 'h3', 'h4'] as const)[lvl - 1];
      return <Tag className={`wk-h wk-h${lvl}`}>{block.text}</Tag>;
    }
    case 'paragraph':
      return (
        <p className="wk-p">
          <RichText text={block.text ?? ''} />
        </p>
      );
    case 'quote':
      return (
        <blockquote className="wk-quote">
          <RichText text={block.text ?? ''} />
        </blockquote>
      );
    case 'callout':
      return (
        <div className="wk-callout">
          <span className="wk-callout-icon" aria-hidden>
            {block.icon || '💡'}
          </span>
          <div>
            <RichText text={block.text ?? ''} />
          </div>
        </div>
      );
    case 'code':
      return (
        <div className="wk-code">
          {block.lang && <span className="wk-lang">{block.lang}</span>}
          <pre>
            <code>{block.text}</code>
          </pre>
        </div>
      );
    case 'list':
      return (
        <ul className="wk-list">
          {(block.items ?? []).map((it, i) => (
            <li key={i}>
              <RichText text={it.text} />
            </li>
          ))}
        </ul>
      );
    case 'todo':
      return (
        <div className="wk-todos">
          {(block.items ?? []).map((it, i) => (
            <div className="wk-todo" key={i}>
              <button
                type="button"
                className={`wk-check ${it.done ? 'on' : ''}`}
                role="checkbox"
                aria-checked={!!it.done}
                aria-label={it.text || `Item ${i + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleTodo?.(i);
                }}
              >
                {it.done ? '✓' : ''}
              </button>
              <span className={it.done ? 'done' : ''}>
                <RichText text={it.text} />
              </span>
            </div>
          ))}
        </div>
      );
    case 'image':
      return block.src ? (
        <img className="wk-img" src={block.src} alt={block.alt ?? ''} loading="lazy" decoding="async" />
      ) : (
        <p className="tip">Image block — add a URL to show it.</p>
      );
    case 'divider':
      return <hr className="wk-divider" />;
    default:
      return null;
  }
}

/* ── auto-growing textarea ────────────────────────────────────────────── */

const AutoTextarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function AutoTextarea(props, ref) {
    const inner = useRef<HTMLTextAreaElement | null>(null);
    useLayoutEffect(() => {
      const el = inner.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }, [props.value]);
    return (
      <textarea
        {...props}
        rows={1}
        ref={(el) => {
          inner.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
        }}
      />
    );
  },
);

/* ── editable row ─────────────────────────────────────────────────────── */

export interface BlockRowProps {
  block: PageBlock;
  index: number;
  count: number;
  active: boolean;
  autoFocus: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onChange: (next: PageBlock) => void;
  onEnter: () => void;
  onRemoveEmpty: () => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onPasteImages: (files: File[], selectionStart: number, selectionEnd: number) => void;
  onPasteError: (message: string) => void;
  focusAtStart?: boolean;
}

export function BlockRow({
  block,
  index,
  count,
  active,
  autoFocus,
  onActivate,
  onDeactivate,
  onChange,
  onEnter,
  onRemoveEmpty,
  onMove,
  onDelete,
  onPasteImages,
  onPasteError,
  focusAtStart = false,
}: BlockRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const value = blockText(block);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ta.current;
    if (!el) return;
    el.focus();
    const position = focusAtStart ? 0 : el.value.length;
    el.setSelectionRange(position, position);
  }, [autoFocus, block.type, focusAtStart]);

  const setText = (v: string) => {
    if (isListy(block.type)) {
      const lines = v.split('\n');
      const prev = block.items ?? [];
      onChange({
        ...block,
        items: lines.map((text, i) => ({
          text,
          ...(block.type === 'todo' ? { done: prev[i]?.done ?? false } : {}),
        })),
      });
    } else {
      onChange({ ...block, text: v });
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    // "/" typed into an empty block opens the block-type picker.
    if (v === '/' && value === '') {
      setMenuOpen(true);
      setText('');
      return;
    }
    setText(v);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (e.key === 'Escape') {
      if (menuOpen) {
        setMenuOpen(false);
        return;
      }
      onDeactivate();
      el.blur();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (isListy(block.type)) {
        // Enter on an empty last line leaves the list and starts a new block.
        const before = el.value.slice(0, el.selectionStart);
        const line = before.slice(before.lastIndexOf('\n') + 1);
        if (line === '' && el.selectionStart === el.value.length) {
          e.preventDefault();
          setText(el.value.replace(/\n?$/, ''));
          onEnter();
        }
        return; // otherwise a newline is a new list item
      }
      if (block.type === 'code') return; // code blocks keep real newlines
      e.preventDefault();
      onEnter();
      return;
    }
    if (e.key === 'Backspace' && el.value === '' && el.selectionStart === 0) {
      e.preventDefault();
      onRemoveEmpty();
    }
  };

  const placeholder =
    block.type === 'code'
      ? 'Code…'
      : block.type === 'heading'
        ? 'Heading'
        : isListy(block.type)
          ? 'One item per line'
          : "Write, or press / for block types";

  return (
    <div
      className={`wk-block ${active ? 'active' : ''}`}
      data-type={block.type}
      onBlur={(e) => {
        // Leaving the block entirely returns it to the rendered view, so task
        // mentions and formatting come back the moment you move on.
        if (menuOpen) return;
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        if (active) onDeactivate();
      }}
    >
      <div className="wk-block-tools">
        <button
          type="button"
          className="wk-tool"
          aria-label="Add block below"
          onClick={onEnter}
        >
          +
        </button>
        <button
          type="button"
          className="wk-tool wk-handle"
          aria-label="Block actions"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((m) => !m)}
        >
          ⋮⋮
        </button>
      </div>

      <div className="wk-block-body">
        {block.type === 'divider' ? (
          <button type="button" className="wk-divider-btn" aria-label="Divider block" onClick={onActivate}>
            <hr className="wk-divider" />
          </button>
        ) : block.type === 'image' ? (
          <figure className={`wk-image-block${active ? ' active' : ''}`}>
            {block.src ? (
              <button
                type="button"
                className="wk-image-surface"
                aria-label={block.alt ? `Image: ${block.alt}` : 'Image block'}
                onClick={onActivate}
              >
                <img className="wk-img" src={block.src} alt={block.alt ?? ''} loading="lazy" decoding="async" />
              </button>
            ) : (
              <button type="button" className="wk-image-empty" onClick={onActivate}>
                <b>Image</b>
                <span>Paste an image here, or embed one by URL.</span>
              </button>
            )}
            {active && !block.src?.startsWith('data:image/') && (
              <input
                className="wk-input"
                value={block.src ?? ''}
                placeholder="Image URL"
                onChange={(e) => onChange({ ...block, src: e.target.value })}
              />
            )}
            {active ? (
              <input
                className="wk-image-caption-input"
                value={block.alt ?? ''}
                aria-label="Image caption"
                placeholder="Add a caption"
                onChange={(e) => onChange({ ...block, alt: e.target.value })}
              />
            ) : block.alt ? (
              <figcaption>{block.alt}</figcaption>
            ) : null}
          </figure>
        ) : active ? (
          <>
            {block.type === 'heading' && (
              <select
                className="wk-mini"
                aria-label="Heading level"
                value={block.level ?? 2}
                onChange={(e) => onChange({ ...block, level: Number(e.target.value) })}
              >
                <option value={1}>H1</option>
                <option value={2}>H2</option>
                <option value={3}>H3</option>
              </select>
            )}
            {block.type === 'code' && (
              <input
                className="wk-mini"
                aria-label="Language"
                value={block.lang ?? ''}
                placeholder="lang"
                onChange={(e) => onChange({ ...block, lang: e.target.value })}
              />
            )}
            {block.type === 'callout' && (
              <input
                className="wk-mini"
                aria-label="Callout icon"
                value={block.icon ?? ''}
                placeholder="💡"
                onChange={(e) => onChange({ ...block, icon: e.target.value })}
              />
            )}
            <AutoTextarea
              ref={ta}
              className={`wk-ta wk-ta-${block.type}`}
              value={value}
              placeholder={placeholder}
              aria-label={`${block.type} block`}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onPaste={(event) => {
                const files = imageFilesFrom(event.clipboardData);
                if (!files.length) {
                  if (looksLikeUnusableImage(event.clipboardData)) {
                    onPasteError(
                      'That image came from a web page rather than the clipboard as a file. Save it, or use a screenshot tool, then paste again.',
                    );
                  }
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                onPasteImages(files, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
              }}
            />
          </>
        ) : (
          <div
            className="wk-readview"
            role="button"
            tabIndex={0}
            onClick={onActivate}
            onFocus={onActivate}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onActivate();
              }
            }}
          >
            {value ? (
              <BlockView
                block={block}
                onToggleTodo={(i) =>
                  onChange({
                    ...block,
                    items: (block.items ?? []).map((it, idx) => (idx === i ? { ...it, done: !it.done } : it)),
                  })
                }
              />
            ) : (
              <span className="wk-empty">{placeholder}</span>
            )}
          </div>
        )}

        {menuOpen && (
          <div className="wk-slash" role="menu" aria-label="Block type">
            <div className="wk-block-actions">
              <button type="button" role="menuitem" disabled={index === 0} onClick={() => { onMove(-1); setMenuOpen(false); }}>
                <strong>Move up</strong>
              </button>
              <button type="button" role="menuitem" disabled={index === count - 1} onClick={() => { onMove(1); setMenuOpen(false); }}>
                <strong>Move down</strong>
              </button>
              <button type="button" role="menuitem" className="danger" onClick={onDelete}>
                <strong>Delete</strong>
              </button>
            </div>
            {BLOCK_MENU.map((m) => (
              <button
                key={m.type}
                type="button"
                role="menuitem"
                className={block.type === m.type ? 'on' : ''}
                onClick={() => {
                  onChange(convertBlock(block, m.type));
                  setMenuOpen(false);
                  onActivate();
                }}
              >
                <strong>{m.label}</strong>
                <span>{m.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
