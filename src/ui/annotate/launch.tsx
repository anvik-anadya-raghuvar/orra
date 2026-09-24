/**
 * The doorway to the Annotator — and the only part of it in the main bundle.
 *
 * pdf.js, pdf-lib and mammoth together are several hundred KB gzipped; the
 * main bundle's budget is 300 KB for everything. So the Annotator itself is
 * a React.lazy chunk that is fetched the first time someone presses
 * Annotate, and everything heavy inside it is a further dynamic import that
 * only loads for the file type actually opened. This file is the button, the
 * Suspense skeleton, and a boundary for "the chunk would not load" (offline,
 * or a deploy replaced it mid-session) — nothing else.
 */
import { Component, Suspense, lazy, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PenLine, X } from 'lucide-react';
import { useData } from '../../data/store';
import { annotateKind } from '../../lib/annotate/kinds';
import type { Attachment } from '../../types';

const Annotator = lazy(() => import('./Annotator'));

export interface AnnotateTarget {
  attachment: Attachment;
  /** The bytes, when they are already in hand (a file just picked) — saves a download. */
  blob?: Blob | null;
}

/** Full-screen skeleton while the Annotator chunk arrives — never a spinner. */
function AnnotatorSkeleton({ onClose, label }: { onClose: () => void; label: string }) {
  return createPortal(
    <div className="anno-fallback" role="dialog" aria-modal="true" aria-label={`Opening ${label}`}>
      <div className="anno-fallback-panel">
        <div className="anno-fallback-bar">
          <span className="skel" style={{ height: 18, width: '40%' }} />
          <button type="button" className="btn sm icon" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <div className="anno-fallback-page skel" />
      </div>
    </div>,
    document.body,
  );
}

class ChunkBoundary extends Component<{ onClose: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return createPortal(
      <div className="anno-fallback" role="alertdialog" aria-modal="true" aria-label="Annotator unavailable">
        <div className="anno-fallback-panel anno-fallback-msg">
          <p>The drawing tools could not be loaded — you may be offline, or the app was just updated. Reload the page and try again.</p>
          <button type="button" className="btn sm" onClick={this.props.onClose}>
            Close
          </button>
        </div>
      </div>,
      document.body,
    );
  }
}

/** Renders the Annotator for `target`, or nothing. */
export function AnnotatorHost({ target, onClose }: { target: AnnotateTarget | null; onClose: () => void }) {
  if (!target) return null;
  return (
    <ChunkBoundary onClose={onClose}>
      <Suspense fallback={<AnnotatorSkeleton onClose={onClose} label={target.attachment.filename} />}>
        <Annotator key={target.attachment.id} attachment={target.attachment} blob={target.blob} onClose={onClose} />
      </Suspense>
    </ChunkBoundary>
  );
}

/** Warm the chunk on intent (hover, focus, touch-start), so the tap that
 *  follows opens instantly on a slow connection. Safe to call repeatedly. */
export function preloadAnnotator() {
  void import('./Annotator');
}

/**
 * An Annotate button for a Documents row: opens the newest drawable file
 * attached to that document. Renders nothing when there is none, so the row
 * only offers what it can do.
 */
export function DocAnnotateButton({ docId }: { docId: string }) {
  const [target, setTarget] = useState<AnnotateTarget | null>(null);
  const file = useData((ds) =>
    ds.attachments
      .filter(
        (a) =>
          a.entity_type === 'document' &&
          a.entity_id === docId &&
          annotateKind(a.filename, a.mime) !== null,
      )
      // The original rather than a flattened copy, newest first.
      .sort(
        (a, b) =>
          Number(/\.annotated\.pdf$/i.test(a.filename)) - Number(/\.annotated\.pdf$/i.test(b.filename)) ||
          b.created_at.localeCompare(a.created_at),
      )[0],
  );
  if (!file) return null;
  return (
    <>
      <button
        type="button"
        className="btn sm"
        onPointerEnter={preloadAnnotator}
        onFocus={preloadAnnotator}
        onClick={() => setTarget({ attachment: file })}
        title={`Draw on ${file.filename}`}
      >
        <PenLine size={14} strokeWidth={2} aria-hidden /> Annotate
      </button>
      <AnnotatorHost target={target} onClose={() => setTarget(null)} />
    </>
  );
}
