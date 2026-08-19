/**
 * Getting an image into the app, by every route a person actually uses.
 *
 * The file picker was the only path here before, which meant a screenshot had
 * to be saved to disk before it could be attached — and the whole point of the
 * export is that you grab a screen, pin what is wrong on it, and hand the
 * result to a coding agent. Saving to disk first is three steps too many.
 *
 * So there are three routes, and they all end at the same compressor:
 *
 *  - **Paste.** Ctrl/Cmd+V anywhere inside the drop zone's panel. Windows'
 *    Snipping Tool, macOS's ⌘⇧4, and every browser's "copy image" put a file
 *    on the clipboard; `useImagePaste` reads it off `ClipboardEvent.items`.
 *  - **Drag and drop.** Straight out of a folder or another browser tab.
 *  - **Click.** The file picker, still, because it is the only route that
 *    works with a keyboard alone and on a phone's photo library.
 *
 * Compression is unchanged and still happens entirely in the browser
 * (src/lib/imageCompress.ts) — capped at 1600px and 300 KB before anything is
 * stored, so a pasted 4K screenshot never becomes a multi-megabyte row.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ImagePlus } from 'lucide-react';
import { compressImage, jpegName, prettyBytes, type CompressedImage } from '../lib/imageCompress';
import { micro } from './motion';
import './imagedrop.css';

/** What a caller gets back: the compressed image plus the name to store it as. */
export interface DroppedImage extends CompressedImage {
  filename: string;
}

/** Turn a `data:image/...;base64,...` URL into a File, or null if it is not one. */
function fileFromDataUrl(src: string): File | null {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(src);
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], `pasted.${m[1].split('/')[1]}`, { type: m[1] });
  } catch {
    return null;
  }
}

/** Pull image files out of a clipboard or drag payload, in order. */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  // `items` carries pasted bitmaps that have no entry in `files` on some
  // engines, so it is the primary source; `files` is the drag-and-drop one.
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue;
    const f = item.getAsFile();
    if (f && f.type.startsWith('image/')) out.push(f);
  }
  if (!out.length) {
    for (const f of Array.from(data.files ?? [])) {
      if (f.type.startsWith('image/')) out.push(f);
    }
  }
  // Last resort: an image copied out of a web page, a document, or a capture
  // tool often arrives as an HTML fragment rather than a file — `<img src="
  // data:image/png;base64,…">` and nothing in `files` or `items`. Reading it
  // here is the difference between that paste working and doing nothing at
  // all, which is exactly how it used to fail: silently.
  if (!out.length) {
    const html = data.getData?.('text/html') ?? '';
    if (html.includes('<img')) {
      for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
        const f = fileFromDataUrl(m[1]);
        if (f) out.push(f);
      }
    }
  }
  return out;
}

/**
 * True when a paste carried something picture-shaped that we could not turn
 * into a file — a remote `<img>` the page will not let us read, or a format
 * the browser did not decode. Callers use it to say so out loud instead of
 * leaving the user pressing Ctrl+V at a screen that never reacts.
 */
export function looksLikeUnusableImage(data: DataTransfer | null): boolean {
  if (!data) return false;
  const html = data.getData?.('text/html') ?? '';
  const uri = data.getData?.('text/uri-list') ?? '';
  return html.includes('<img') || /\.(png|jpe?g|gif|webp)(\?|$)/i.test(uri);
}

/**
 * Compress a batch and hand each one back in turn. Sequential on purpose: two
 * canvases encoding a 4K screenshot at once janks the frame, and the order
 * images were dropped in is the order they should appear.
 */
export async function processImages(
  files: File[],
  onImage: (img: DroppedImage) => void,
): Promise<void> {
  for (const file of files) {
    const img = await compressImage(file);
    onImage({ ...img, filename: jpegName(file.name || 'pasted') });
  }
}

/**
 * Listen for a paste anywhere inside `ref`, or on the document while `ref` is
 * mounted. The document half is what makes "screenshot, switch back, Ctrl+V"
 * work without having to click the drop zone first.
 *
 * A paste is claimed only when the clipboard actually carries an image, which
 * is what keeps this from fighting the text fields around it: pasting text
 * into the title or the body yields no image files, so the handler returns
 * before it ever calls preventDefault and the field gets its paste as normal.
 * The converse also holds — an image on the clipboard is attached even if the
 * caret happens to be in a textarea, where pasting it would otherwise do
 * nothing at all.
 */
export function useImagePaste(
  ref: React.RefObject<HTMLElement>,
  onFiles: (files: File[]) => void,
  enabled = true,
  /** Told when a paste looked like an image but yielded nothing usable. */
  onUnusable?: (message: string) => void,
) {
  const cb = useRef(onFiles);
  cb.current = onFiles;
  const bad = useRef(onUnusable);
  bad.current = onUnusable;

  useEffect(() => {
    if (!enabled) return;
    const onPaste = (e: ClipboardEvent) => {
      if (!ref.current) return;
      const files = imageFilesFrom(e.clipboardData);
      if (!files.length) {
        // Picture-shaped but unreadable: say so rather than ignoring it.
        if (looksLikeUnusableImage(e.clipboardData)) {
          bad.current?.(
            'That image came from a web page rather than the clipboard as a file. Save it, or use a screenshot tool, then paste again.',
          );
        }
        return; // otherwise a text paste — leave it to whatever has focus
      }
      e.preventDefault();
      cb.current(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [ref, enabled]);
}

/**
 * The visible target. Renders as a dashed well that lights up while something
 * is dragged over it; the whole thing is a button, so it is one tab stop and
 * one Enter away from the file picker.
 */
export function ImageDrop({
  onImage,
  onError,
  busy,
  setBusy,
  label = 'Add an image',
  hint = 'Paste, drop, or click — compressed in the browser',
  multiple = true,
  className,
  compact,
}: {
  onImage: (img: DroppedImage) => void;
  onError?: (message: string) => void;
  busy?: boolean;
  setBusy?: (b: boolean) => void;
  label?: string;
  hint?: string;
  multiple?: boolean;
  className?: string;
  /** A single row rather than a well — for a panel that is already dense. */
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [working, setWorking] = useState(false);
  const running = busy ?? working;

  const handle = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
      const batch = multiple ? files : files.slice(0, 1);
      setBusy ? setBusy(true) : setWorking(true);
      try {
        await processImages(batch, onImage);
      } catch (err) {
        onError?.((err as Error).message || 'That image could not be attached');
      } finally {
        setBusy ? setBusy(false) : setWorking(false);
      }
    },
    [multiple, onImage, onError, setBusy],
  );

  return (
    <div
      className={`imgdrop${compact ? ' compact' : ''}${over ? ' over' : ''}${
        running ? ' busy' : ''
      }${className ? ` ${className}` : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        // Only clear when the pointer has genuinely left the well, not when it
        // crosses onto a child element.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void handle(imageFilesFrom(e.dataTransfer));
      }}
    >
      <input
        ref={inputRef}
        type="file"
        aria-label={label}
        accept="image/*"
        multiple={multiple}
        disabled={running}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void handle(files);
        }}
      />
      <motion.button
        type="button"
        className="imgdrop-hit"
        disabled={running}
        onClick={() => inputRef.current?.click()}
        whileTap={{ scale: 0.985, transition: micro }}
      >
        <ImagePlus size={compact ? 15 : 19} strokeWidth={1.8} aria-hidden />
        <span className="imgdrop-txt">
          <b>{running ? 'Compressing…' : label}</b>
          {!compact && <small>{hint}</small>}
        </span>
      </motion.button>
    </div>
  );
}

/**
 * A row of attached images with a remove control on each. Kept here rather
 * than in each caller because "what is already attached" looks the same
 * whether it is hanging off a note, a decision, or a task.
 */
export function ImageStrip({
  images,
  onRemove,
  onOpen,
}: {
  images: { id: string; data_url?: string; filename: string; bytes?: number }[];
  onRemove?: (id: string) => void;
  onOpen?: (id: string) => void;
}) {
  if (!images.length) return null;
  return (
    <ul className="imgstrip">
      {images.map((im) => (
        <li key={im.id}>
          {im.data_url ? (
            <button
              type="button"
              className="imgstrip-shot"
              onClick={() => onOpen?.(im.id)}
              aria-label={`Open ${im.filename}`}
              disabled={!onOpen}
            >
              <img src={im.data_url} alt={im.filename} loading="lazy" />
            </button>
          ) : (
            <span className="imgstrip-shot none">no image data</span>
          )}
          <span className="imgstrip-meta">
            <b title={im.filename}>{im.filename}</b>
            {im.bytes ? <small>{prettyBytes(im.bytes)}</small> : null}
          </span>
          {onRemove && (
            <button
              type="button"
              className="imgstrip-x"
              onClick={() => onRemove(im.id)}
              aria-label={`Remove ${im.filename}`}
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
