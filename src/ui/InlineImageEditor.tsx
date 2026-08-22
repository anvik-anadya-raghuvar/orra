import React, { useLayoutEffect, useRef } from 'react';
import { imageFilesFrom, looksLikeUnusableImage } from './imagedrop';
import {
  appendMissingInlineImages,
  replaceInlineTextPart,
  splitInlineImages,
} from './inlineImages';
import { MicButton, useDictation } from './dictation';
import { FormatToolbar, applyFormatShortcut } from './FormatToolbar';
import { createTextFormatting } from './textFormatting';
import './inlineImages.css';

const GrowingTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }
>(function GrowingTextarea({ value, ...props }, ref) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(52, el.scrollHeight)}px`;
  }, [value]);
  return (
    <textarea
      rows={1}
      value={value}
      {...props}
      ref={(element) => {
        inner.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = element;
      }}
    />
  );
});

export function InlineImageEditor({
  value,
  imageIds,
  onChange,
  onPasteFiles,
  onCaretChange,
  onTextBlur,
  onUnusableImage,
  renderImage,
  placeholder = 'Write here…',
  ariaLabel = 'Document body',
  className = '',
}: {
  value: string;
  imageIds: string[];
  onChange: (value: string) => void;
  onPasteFiles: (files: File[], offset: number) => void;
  onCaretChange?: (offset: number) => void;
  onTextBlur?: () => void;
  onUnusableImage?: (message: string) => void;
  renderImage: (id: string) => React.ReactNode;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const normalized = appendMissingInlineImages(value, imageIds);
  const parts = splitInlineImages(normalized);
  const textParts = parts.filter((part) => part.kind === 'text');
  const { supported: canDictate } = useDictation();

  return (
    <div className={`inline-image-editor ${canDictate ? 'has-mic ' : ''}${className}`.trim()}>
      {/* This editor is a stack of textareas with images between them, so a mic
          cannot sit inside one field the way DictateField puts it. It goes in
          the editor's own footer strip instead, and dictates into whichever
          part has the cursor — or the first one, before you have clicked. */}
      {canDictate && <MicButton className="editor-mic" label={`Dictate — ${ariaLabel.toLowerCase()}`} />}
      {parts.map((part, index) => {
        if (part.kind === 'image') {
          return (
            <div className="inline-image-slot" key={`${part.id}-${part.start}`}>
              {renderImage(part.id)}
            </div>
          );
        }
        const reportCaret = (el: HTMLTextAreaElement) =>
          onCaretChange?.(part.start + (el.selectionStart ?? el.value.length));
        const partRef = React.createRef<HTMLTextAreaElement>();
        const setPartText = (text: string) => onChange(replaceInlineTextPart(normalized, part, text));
        return (
          <React.Fragment key={`text-${index}`}>
            <FormatToolbar textarea={partRef} value={part.text} onValue={(text) => setPartText(text)} />
            <GrowingTextarea
              ref={partRef}
              className="inline-image-text"
              value={part.text}
              aria-label={textParts.length === 1 ? ariaLabel : `${ariaLabel}, section ${textParts.indexOf(part) + 1}`}
              placeholder={parts.length === 1 ? placeholder : 'Continue writing…'}
              onChange={(event) => setPartText(event.target.value)}
              onFocus={(event) => reportCaret(event.currentTarget)}
              onClick={(event) => reportCaret(event.currentTarget)}
              onKeyUp={(event) => reportCaret(event.currentTarget)}
              onSelect={(event) => reportCaret(event.currentTarget)}
              onKeyDown={(event) => applyFormatShortcut(event, createTextFormatting(partRef, part.text, (text) => setPartText(text)))}
              onBlur={onTextBlur}
              onPaste={(event) => {
                const files = imageFilesFrom(event.clipboardData);
                if (!files.length) {
                  if (looksLikeUnusableImage(event.clipboardData)) {
                    onUnusableImage?.(
                      'That image came from a web page rather than the clipboard as a file. Save it, or use a screenshot tool, then paste again.',
                    );
                  }
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                onPasteFiles(files, part.start + event.currentTarget.selectionStart);
              }}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function InlineImageContent({
  value,
  imageIds,
  renderImage,
  renderText,
  className = '',
}: {
  value: string;
  imageIds: string[];
  renderImage: (id: string) => React.ReactNode;
  renderText: (text: string, index: number) => React.ReactNode;
  className?: string;
}) {
  const parts = splitInlineImages(appendMissingInlineImages(value, imageIds));
  return (
    <div className={`inline-image-content ${className}`.trim()}>
      {parts.map((part, index) =>
        part.kind === 'image' ? (
          <div className="inline-image-slot" key={`${part.id}-${part.start}`}>
            {renderImage(part.id)}
          </div>
        ) : (
          <React.Fragment key={`text-${index}`}>
            {part.text ? renderText(part.text, index) : null}
          </React.Fragment>
        ),
      )}
    </div>
  );
}
