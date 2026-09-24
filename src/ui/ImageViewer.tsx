/**
 * Looking at an image, and getting it out.
 *
 * Every image in this app was stored and then effectively locked in. A task
 * screenshot could only be clicked to place a pin — there was no way to just
 * SEE it at full size, and no way at all to save or copy one, anywhere. So a
 * screenshot you pasted into a task could not be sent to the accountant
 * without going back to wherever it originally came from.
 *
 * One viewer for all of them, so "how do I get this picture out" has the same
 * answer whether it is on a task, a scribble, or a business card.
 *
 * Copy is best-effort by design. Browsers accept PNG on the clipboard and
 * little else, and everything here is a compressed JPEG, so a JPEG is redrawn
 * through a canvas first. Where the Clipboard API is missing or blocked —
 * Firefox without the flag, any insecure origin — the button says so and
 * Download still works, rather than the whole viewer pretending it failed.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Copy, Download, X } from 'lucide-react';
import { dataUrlToBytes, downloadName, mimeFromDataUrl, needsPngForClipboard } from '../lib/imageFile';
import { PIN_LABELS } from '../types';
import { useToast } from './bits';
import { useEscapeLayer } from './escapeStack';
import './imageViewer.css';

export interface ViewableImage {
  src: string;
  filename: string;
  width?: number;
  height?: number;
  /** The screenshot row this is, so a caller can hand back its live pins. */
  id?: string;
}

/** A pin already on the image, as the viewer draws it. */
export interface ViewerPin {
  id: string;
  number: number;
  x_pct: number;
  y_pct: number;
  note: string;
  label?: string;
  resolved?: boolean;
}

export interface NewViewerPin {
  x_pct: number;
  y_pct: number;
  note: string;
  label: string;
}

const clampPct = (v: number) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));
const spring = { type: 'spring', stiffness: 400, damping: 30 } as const;

/** Redraw through a canvas to get PNG bytes the clipboard will take. */
function toPngBlob(src: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * With `onAddPin`, the viewer is also where you pin. Opening a screenshot by
 * accident used to be a dead end — close it, find Place a pin, click again.
 * Now a click on the picture drops a pin right there, Enter saves it, and the
 * next click starts the next one. Escape backs out one step at a time: the
 * open pin first, then the viewer — never the page or sheet behind it.
 */
export function ImageViewer({
  image,
  onClose,
  pins,
  onAddPin,
  nextPinNumber,
}: {
  image: ViewableImage | null;
  onClose: () => void;
  pins?: ViewerPin[];
  onAddPin?: (pin: NewViewerPin) => void;
  nextPinNumber?: number;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<NewViewerPin | null>(null);

  useEffect(() => {
    if (!image) return undefined;
    /* The page behind must not scroll while this is open — on a phone the
       overlay is the whole screen and scrolling it moves the wrong thing. */
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [image]);

  // A different image (or none) never inherits a half-written pin.
  useEffect(() => setDraft(null), [image?.src]);

  useEscapeLayer(!!image, onClose);
  useEscapeLayer(!!image && !!draft, () => setDraft(null));

  const startPin = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!onAddPin) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Clicking elsewhere while a note is half-written moves the pin, keeps the words.
    setDraft({
      x_pct: clampPct(((event.clientX - rect.left) / rect.width) * 100),
      y_pct: clampPct(((event.clientY - rect.top) / rect.height) * 100),
      note: draft?.note ?? '',
      label: draft?.label ?? '',
    });
  };

  const savePin = () => {
    if (!draft || !onAddPin) return;
    const note = draft.note.trim();
    if (!note) {
      toast('A pin needs a note — that note is what the agent reads');
      return;
    }
    onAddPin({ ...draft, note });
    setDraft(null);
  };

  const download = useCallback(() => {
    if (!image) return;
    const decoded = dataUrlToBytes(image.src);
    /* A remote src (a signed URL for a shared photo) is not a data URL, so
       there is nothing to decode — hand the href straight to the anchor and
       let the browser fetch it. */
    const href = decoded
      ? URL.createObjectURL(new Blob([decoded.bytes as unknown as BlobPart], { type: decoded.mime }))
      : image.src;
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = downloadName(image.filename, decoded?.mime ?? mimeFromDataUrl(image.src));
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    if (decoded) URL.revokeObjectURL(href);
  }, [image]);

  const copy = useCallback(async () => {
    if (!image) return;
    setBusy(true);
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        toast('This browser will not let a page write images to the clipboard — use Download.');
        return;
      }
      const mime = mimeFromDataUrl(image.src);
      let blob: Blob | null = null;
      if (needsPngForClipboard(mime)) {
        blob = await toPngBlob(image.src);
      } else {
        const decoded = dataUrlToBytes(image.src);
        blob = decoded ? new Blob([decoded.bytes as unknown as BlobPart], { type: decoded.mime }) : null;
      }
      if (!blob) {
        toast('Could not read that image to copy it — use Download.');
        return;
      }
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast('Image copied — paste it anywhere');
    } catch {
      toast('The clipboard refused that — use Download.');
    } finally {
      setBusy(false);
    }
  }, [image, toast]);

  return (
    <AnimatePresence>
      {image && (
        <motion.div
          className="imgview"
          role="dialog"
          aria-modal="true"
          aria-label={`Viewing ${image.filename}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => (draft ? setDraft(null) : onClose())}
        >
          <div className="imgview-bar" onClick={(event) => event.stopPropagation()}>
            <span className="imgview-name">
              {image.filename}
              {image.width && image.height ? ` · ${image.width}×${image.height}` : ''}
            </span>
            <div className="spacer" />
            <button type="button" className="btn sm" onClick={download}>
              <Download size={14} strokeWidth={1.9} aria-hidden /> Download
            </button>
            <button type="button" className="btn sm" disabled={busy} onClick={() => void copy()}>
              <Copy size={14} strokeWidth={1.9} aria-hidden /> {busy ? 'Copying…' : 'Copy'}
            </button>
            <button type="button" className="btn sm" aria-label="Close image viewer" onClick={onClose}>
              <X size={15} strokeWidth={2} aria-hidden />
            </button>
          </div>
          <motion.div
            className={`imgview-stage${onAddPin ? ' pinnable' : ''}`}
            initial={{ scale: 0.97, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={spring}
            onClick={startPin}
            role={onAddPin ? 'group' : undefined}
            aria-label={onAddPin ? `${image.filename}. Click the exact spot to place a pin.` : undefined}
          >
            <img className="imgview-img" src={image.src} alt={image.filename} draggable={false} />
            {pins?.map((pin) => (
              <span
                key={pin.id}
                className={`imgview-pin${pin.resolved ? ' res' : ''}`}
                style={{ left: `${pin.x_pct}%`, top: `${pin.y_pct}%` }}
                title={`${pin.label ? `[${pin.label}] ` : ''}${pin.note}`}
                role="img"
                aria-label={`Pin ${pin.number}${pin.label ? `, ${pin.label}` : ''}: ${pin.note}`}
              >
                {pin.number}
              </span>
            ))}
            <AnimatePresence>
              {draft && (
                <motion.span
                  key="draft"
                  className="imgview-pin pending"
                  style={{ left: `${draft.x_pct}%`, top: `${draft.y_pct}%`, x: '-50%', y: '-50%' }}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={spring}
                  aria-hidden
                >
                  {nextPinNumber ?? '+'}
                </motion.span>
              )}
            </AnimatePresence>
          </motion.div>
          <AnimatePresence initial={false}>
            {draft && (
              <motion.div
                key="pinform"
                className="imgview-pinform"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                onClick={(event) => event.stopPropagation()}
              >
                <textarea
                  autoFocus
                  rows={2}
                  value={draft.note}
                  placeholder={`Pin ${nextPinNumber ?? ''} — what is wrong here, and what should it become?`}
                  aria-label="Pin note"
                  onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      savePin();
                    }
                  }}
                />
                <div className="imgview-pinrow">
                  {PIN_LABELS.map((label) => (
                    <button
                      key={label}
                      type="button"
                      className="chip"
                      aria-pressed={draft.label === label}
                      onClick={() => setDraft({ ...draft, label: draft.label === label ? '' : label })}
                    >
                      {label}
                    </button>
                  ))}
                  <div className="spacer" />
                  <button type="button" className="btn sm" onClick={() => setDraft(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn sm solid" disabled={!draft.note.trim()} onClick={savePin}>
                    Add pin
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <p className="imgview-hint">
            {onAddPin
              ? draft
                ? 'Enter saves the pin · Shift+Enter for a new line · Esc cancels it'
                : 'Click the spot to pin it · Esc goes back'
              : 'Click outside, or press Esc, to close.'}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Local state for one screen's viewer, so a caller is three lines not ten. */
export function useImageViewer() {
  const [image, setImage] = useState<ViewableImage | null>(null);
  return {
    image,
    open: (next: ViewableImage) => setImage(next),
    close: () => setImage(null),
  };
}
