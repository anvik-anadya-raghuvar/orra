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
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Copy, Download, X } from 'lucide-react';
import { dataUrlToBytes, downloadName, mimeFromDataUrl, needsPngForClipboard } from '../lib/imageFile';
import { useToast } from './bits';
import './imageViewer.css';

export interface ViewableImage {
  src: string;
  filename: string;
  width?: number;
  height?: number;
}

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

export function ImageViewer({ image, onClose }: { image: ViewableImage | null; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!image) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    /* The page behind must not scroll while this is open — on a phone the
       overlay is the whole screen and scrolling it moves the wrong thing. */
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [image, onClose]);

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
          onClick={onClose}
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
          <motion.img
            className="imgview-img"
            src={image.src}
            alt={image.filename}
            initial={{ scale: 0.97, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            onClick={(event) => event.stopPropagation()}
          />
          <p className="imgview-hint">Click outside, or press Esc, to close.</p>
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
