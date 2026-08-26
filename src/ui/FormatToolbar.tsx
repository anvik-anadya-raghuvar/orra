/**
 * The formatting bar for any plain-text surface — wiki blocks, notes, task
 * descriptions. One component so "how do I make this bold" has the same
 * answer everywhere in the app, per the same rule that put Attachments in
 * one place instead of three.
 *
 * Every action goes through `createTextFormatting`, which uses
 * `document.execCommand` under the hood specifically so Ctrl+Z keeps
 * working after you click a button here — see textFormatting.ts.
 */
import type { MouseEvent, ReactNode, RefObject } from 'react';
import { Bold, Italic, Underline, Strikethrough, Code2, Link2, List, ListChecks } from 'lucide-react';
import { FORMAT_COLORS, FORMAT_SIZES, isSafeExternalUrl } from '../lib/textFormat';
import { applyFormatShortcut, createTextFormatting } from './textFormatting';
import { MentionPicker } from './MentionPicker';
import './formatToolbar.css';

export { applyFormatShortcut };

export function FormatToolbar({
  textarea,
  value,
  onValue,
  extra,
}: {
  textarea: RefObject<HTMLTextAreaElement>;
  value: string;
  onValue: (value: string, selectionStart: number, selectionEnd: number) => void;
  extra?: ReactNode;
}) {
  const formatting = createTextFormatting(textarea, value, onValue);
  // mousedown would blur the textarea before the click's onClick fires,
  // which loses the selection a format button is meant to act on.
  const keepFocus = (event: MouseEvent) => event.preventDefault();
  return (
    <div className="fmt-bar" role="toolbar" aria-label="Text formatting">
      <button type="button" aria-label="Bold" title="Bold (Ctrl+B)" onMouseDown={keepFocus} onClick={() => formatting.apply('**')}>
        <Bold size={14} strokeWidth={2} aria-hidden />
      </button>
      <button type="button" aria-label="Italic" title="Italic (Ctrl+I)" onMouseDown={keepFocus} onClick={() => formatting.apply('_')}>
        <Italic size={14} strokeWidth={2} aria-hidden />
      </button>
      <button type="button" aria-label="Underline" title="Underline (Ctrl+U)" onMouseDown={keepFocus} onClick={() => formatting.apply('__')}>
        <Underline size={14} strokeWidth={2} aria-hidden />
      </button>
      <button type="button" aria-label="Strikethrough" title="Strikethrough" onMouseDown={keepFocus} onClick={() => formatting.apply('~~')}>
        <Strikethrough size={14} strokeWidth={2} aria-hidden />
      </button>
      <button type="button" aria-label="Inline code" title="Code" onMouseDown={keepFocus} onClick={() => formatting.apply('`')}>
        <Code2 size={14} strokeWidth={2} aria-hidden />
      </button>
      <button type="button" aria-label="Bulleted list" title="Bullets" onMouseDown={keepFocus} onClick={() => formatting.bullet()}>
        <List size={14} strokeWidth={2} aria-hidden />
      </button>
      <button type="button" aria-label="Checklist" title="Checklist '- [ ]'" onMouseDown={keepFocus} onClick={() => formatting.checkbox()}>
        <ListChecks size={14} strokeWidth={2} aria-hidden />
      </button>
      {/* Tagging lives in the toolbar rather than beside one composer, so it
          is available in every surface that already has formatting — the task
          brief, wiki blocks, notes, the inline-image editor — instead of only
          the two threads it started in. */}
      <MentionPicker textarea={textarea} value={value} onValue={onValue} />
      <button
        type="button"
        aria-label="Add link"
        title="Link"
        onMouseDown={keepFocus}
        onClick={() => {
          const url = window.prompt('Link URL (https:// or mailto:)');
          if (url && isSafeExternalUrl(url)) formatting.apply('[', `](${url})`, 'link');
        }}
      >
        <Link2 size={14} strokeWidth={2} aria-hidden />
      </button>
      <select
        aria-label="Text color"
        title="Color"
        defaultValue=""
        onChange={(event) => {
          const key = event.target.value;
          if (key) formatting.apply(`{{color:${key}|`, '}}', 'text');
          event.target.value = '';
        }}
      >
        <option value="" disabled>Color</option>
        {FORMAT_COLORS.map((color) => (
          <option key={color.key} value={color.key}>{color.label}</option>
        ))}
      </select>
      <select
        aria-label="Text size"
        title="Size"
        defaultValue=""
        onChange={(event) => {
          const key = event.target.value;
          if (key) formatting.apply(`{{size:${key}|`, '}}', 'text');
          event.target.value = '';
        }}
      >
        <option value="" disabled>Size</option>
        {FORMAT_SIZES.map((size) => (
          <option key={size.key} value={size.key}>{size.label}</option>
        ))}
      </select>
      {extra}
    </div>
  );
}
