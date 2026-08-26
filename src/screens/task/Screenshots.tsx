import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Eye, MapPin, RotateCcw, Trash2 } from 'lucide-react';
import { newId, useDataset, useStore } from '../../data/store';
import { useToast } from '../../ui/bits';
import { entrance, spring } from '../../ui/motion';
import { pinNumber } from '../../lib/exportTask';
import { prettyBytes } from '../../lib/imageCompress';
import { ImageDrop, processImages, useImagePaste, type DroppedImage } from '../../ui/imagedrop';
import { InlineImageEditor } from '../../ui/InlineImageEditor';
import { ImageViewer, useImageViewer } from '../../ui/ImageViewer';
import {
  appendMissingInlineImages,
  insertInlineImages,
  removeInlineImage,
} from '../../ui/inlineImages';
import { PIN_LABELS } from '../../types';
import type { ScreenshotAttachment, Task } from '../../types';

/** Same deterministic ordering the export engine uses. */
const byCreated = <T extends { created_at: string; id: string }>(a: T, b: T) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

const clampPct = (v: number) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));

/** Placeholder that mimics the prototype's browser chrome + mono data grid,
 *  so an attachment with no stored image still gives the pins a surface. */
function GridPlaceholder({ shot }: { shot: ScreenshotAttachment }) {
  const rows = [
    ['CS/2317/20…', '14-03-2021', 'Pending'],
    ['CS/0881/19…', '02-11-2019', 'Disposed'],
    ['OS/114/18—', '09-06-2018', 'Pending'],
    ['CS/1902/17…', '27-01-2017', 'Disposed'],
    ['OS/0450/16—', '05-08-2016', 'Pending'],
  ];
  return (
    <div className="gm" aria-hidden>
      <div className="hd">
        <span>Case number</span>
        <span>Filed date</span>
        <span>Status</span>
      </div>
      {rows.map((r) => (
        <div className="row" key={r[0]}>
          <span>{r[0]}</span>
          <span>{r[1]}</span>
          <span>{r[2]}</span>
        </div>
      ))}
      <div className="nodata">no image data stored · {shot.storage_path}</div>
    </div>
  );
}

interface Draft {
  /** Optional category — 'bug', 'copy', … — carried into the export. */
  label?: string;
  shotId: string;
  x: number;
  y: number;
  note: string;
}

/**
 * The screenshot annotation section — code-change tasks only.
 * Coordinates are stored as percentages to one decimal, so a pin dropped at
 * 1440px lands on the same element at 380px; the surface keeps the attachment's
 * aspect ratio so the mapping holds and nothing shifts while the image loads.
 */
export default function Screenshots({
  task,
  description,
  onDescriptionChange,
  onDescriptionCommit,
}: {
  task: Task;
  description: string;
  onDescriptionChange: (value: string) => void;
  onDescriptionCommit: (value: string) => void;
}) {
  const store = useStore();
  const ds = useDataset();
  const toast = useToast();
  const sectionRef = useRef<HTMLElement>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which screenshot is armed for pin placement. Null = clicking views. */
  const [pinning, setPinning] = useState<string | null>(null);
  const viewer = useImageViewer();

  const shots = ds.screenshot_attachments.filter((s) => s.task_id === task.id).sort(byCreated);
  const placedDescription = appendMissingInlineImages(description, shots.map((shot) => shot.id));
  const descriptionRef = useRef(placedDescription);
  descriptionRef.current = placedDescription;
  const caretRef = useRef(placedDescription.length);

  const pinsFor = (shotId: string) =>
    ds.annotation_pins.filter((p) => p.screenshot_id === shotId).sort(byCreated);

  const startDraft = (e: React.MouseEvent<HTMLDivElement>, shot: ScreenshotAttachment) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    setDraft({
      shotId: shot.id,
      x: clampPct(((e.clientX - rect.left) / rect.width) * 100),
      y: clampPct(((e.clientY - rect.top) / rect.height) * 100),
      note: '',
      label: '',
    });
  };

  const commitDraft = (shot: ScreenshotAttachment) => {
    if (!draft) return;
    const note = draft.note.trim();
    if (!note) {
      toast('A pin needs a note — that note is what the agent reads');
      return;
    }
    const row = store.insert(
      'annotation_pins',
      {
        id: newId('pin'),
        screenshot_id: shot.id,
        x_pct: clampPct(draft.x),
        y_pct: clampPct(draft.y),
        note,
        label: draft.label ?? '',
        author_id: store.me.id,
        is_resolved: false,
        created_at: new Date().toISOString(),
      },
      store.asMe({ summary: `Pin added on ${shot.filename}` }),
    );
    setDraft(null);
    // Placing a pin disarms the mode: leaving it armed turns the next
    // click meant to look at the image into another pin.
    setPinning(null);
    setSelected(row.id);
  };

  /** One place every route ends: picker, drag-drop, and paste all land here. */
  const attach = (img: DroppedImage, id: string) => {
    store.insert(
      'screenshot_attachments',
      {
        id,
        task_id: task.id,
        storage_path: `screenshots/${task.id}/${img.filename}`,
        filename: img.filename,
        mime: 'image/jpeg',
        width: img.width,
        height: img.height,
        uploaded_by: store.me.id,
        created_at: new Date().toISOString(),
        data_url: img.data_url,
      },
      store.asMe({ summary: `Screenshot ${img.filename} attached` }),
    );
    toast(`${img.filename} inserted · ${prettyBytes(img.bytes)} at q${img.quality}`);
  };

  const changeDescription = (value: string) => {
    descriptionRef.current = value;
    onDescriptionChange(value);
  };

  const insertImage = (img: DroppedImage, offset = caretRef.current) => {
    const id = newId('shot');
    const inserted = insertInlineImages(descriptionRef.current, offset, [id]);
    caretRef.current = inserted.caret;
    changeDescription(inserted.value);
    // Place first, persist second: the screenshot cannot briefly appear as a
    // legacy unplaced image at the end while React processes the two updates.
    attach(img, id);
    onDescriptionCommit(inserted.value);
  };

  const insertFiles = (files: File[], offset = caretRef.current) => {
    setBusy(true);
    let nextOffset = offset;
    void processImages(files, (image) => {
      insertImage(image, nextOffset);
      nextOffset = caretRef.current;
    })
      .catch((err: Error) => toast(err.message || 'That image could not be pasted'))
      .finally(() => setBusy(false));
  };

  const removeShot = (shot: ScreenshotAttachment) => {
    const pins = ds.annotation_pins.filter((pin) => pin.screenshot_id === shot.id);
    if (pins.length && !window.confirm(`Remove ${shot.filename} and its ${pins.length} pin${pins.length === 1 ? '' : 's'}?`)) {
      return;
    }
    pins.forEach((pin) => store.remove('annotation_pins', pin.id, store.asMe({ silent: true })));
    store.remove(
      'screenshot_attachments',
      shot.id,
      store.asMe({ summary: `Screenshot ${shot.filename} removed from ${task.id}` }),
    );
    const next = removeInlineImage(descriptionRef.current, shot.id);
    changeDescription(next);
    onDescriptionCommit(next);
  };

  // Ctrl/Cmd+V anywhere on the task page: take a screenshot, switch back, paste.
  useImagePaste(sectionRef, (files) => insertFiles(files));

  return (
    <section className="task-inline-brief" aria-label="Task brief" ref={sectionRef}>
      <div
        className="eyebrow"
        style={{ marginBottom: 8, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <span>Brief · paste images exactly where they belong</span>
      </div>

      <InlineImageEditor
        value={placedDescription}
        imageIds={shots.map((shot) => shot.id)}
        onChange={changeDescription}
        onTextBlur={() => onDescriptionCommit(descriptionRef.current)}
        onPasteFiles={insertFiles}
        onCaretChange={(offset) => { caretRef.current = offset; }}
        onUnusableImage={toast}
        placeholder="What needs to happen, and why…"
        ariaLabel="Task description"
        className="task-brief-editor"
        renderImage={(id) => {
        const shot = shots.find((item) => item.id === id);
        if (!shot) return <p className="none">Compressing image…</p>;
        const pins = pinsFor(shot.id);
        const isDrafting = draft?.shotId === shot.id;
        return (
          <motion.div
            key={shot.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={entrance}
            style={{ marginBottom: 18 }}
          >
            <div className="shot">
              <div className="shotbar">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
                <em>
                  {shot.filename} · {shot.width}×{shot.height}
                </em>
                <button
                  type="button"
                  className="iconbtn danger shot-remove"
                  aria-label={`Remove ${shot.filename}`}
                  onClick={() => removeShot(shot)}
                >
                  <Trash2 size={15} strokeWidth={1.8} />
                </button>
              </div>
              {/* Clicking used to go straight into placing a pin, which meant
                  there was no way to simply look at your own screenshot. View
                  is the default now; pinning is a mode you turn on, because
                  precise placement still needs a click on the exact spot. */}
              <div
                className={`shotsurf${pinning === shot.id ? ' pinning' : ''}`}
                style={{ aspectRatio: `${shot.width} / ${shot.height}` }}
                onClick={(e) => {
                  if (pinning === shot.id) startDraft(e, shot);
                  else viewer.open({ src: shot.data_url ?? '', filename: shot.filename, width: shot.width, height: shot.height });
                }}
                role="group"
                aria-label={
                  pinning === shot.id
                    ? `${shot.filename}. Click the exact spot to place a pin.`
                    : `${shot.filename}. Click to view it full size.`
                }
              >
                {shot.data_url ? (
                  <img
                    className="shotimg"
                    src={shot.data_url}
                    alt={shot.filename}
                    loading="lazy"
                    decoding="async"
                    width={shot.width}
                    height={shot.height}
                    draggable={false}
                  />
                ) : (
                  <GridPlaceholder shot={shot} />
                )}

                {pins.map((p) => {
                  const n = pinNumber(ds, p.id);
                  const sel = selected === p.id;
                  return (
                    <motion.button
                      key={p.id}
                      className={`pin${sel ? ' sel' : ''}${p.is_resolved ? ' res' : ''}`}
                      style={{ left: `${p.x_pct}%`, top: `${p.y_pct}%`, x: '-50%', y: '-50%' }}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: sel ? 1.28 : 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={spring}
                      aria-pressed={sel}
                      aria-label={`Pin ${n}${p.label ? `, ${p.label}` : ''}: ${p.note}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(sel ? null : p.id);
                      }}
                    >
                      {n}
                    </motion.button>
                  );
                })}

                <AnimatePresence>
                  {isDrafting && draft && (
                    <motion.span
                      className="ghost"
                      style={{ left: `${draft.x}%`, top: `${draft.y}%`, x: '-50%', y: '-50%' }}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={spring}
                      aria-hidden
                    >
                      +
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <AnimatePresence>
              {isDrafting && draft && (
                <motion.div
                  className="pindraft"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={entrance}
                >
                  <div className="eyebrow" style={{ color: 'var(--indigo)' }}>
                    New pin on {shot.filename}
                  </div>
                  <input
                    autoFocus
                    value={draft.note}
                    placeholder="What is wrong here, and what should it become?"
                    aria-label="Pin note"
                    onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitDraft(shot);
                      }
                      if (e.key === 'Escape') { setDraft(null); setPinning(null); }
                    }}
                  />
                  {/* Categorising the pin is what lets the exported TASK.md
                      say "[bug]" or "[copy]" instead of leaving a coding agent
                      to infer the kind of change from prose. */}
                  <div className="pinlabels">
                    {PIN_LABELS.map((l) => (
                      <button
                        key={l}
                        type="button"
                        className="chip"
                        aria-pressed={draft.label === l}
                        onClick={() => setDraft({ ...draft, label: draft.label === l ? '' : l })}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                  <div className="coords">
                    <label>
                      x %
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        max={100}
                        value={draft.x}
                        onChange={(e) => setDraft({ ...draft, x: clampPct(Number(e.target.value)) })}
                      />
                    </label>
                    <label>
                      y %
                      <input
                        type="number"
                        step={0.1}
                        min={0}
                        max={100}
                        value={draft.y}
                        onChange={(e) => setDraft({ ...draft, y: clampPct(Number(e.target.value)) })}
                      />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn solid sm" onClick={() => commitDraft(shot)}>
                      Add pin
                    </button>
                    <button className="btn sm" onClick={() => { setDraft(null); setPinning(null); }}>
                      Cancel
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!isDrafting && (
              <div className="shotacts">
                <button
                  className="btn sm"
                  type="button"
                  onClick={() =>
                    viewer.open({ src: shot.data_url ?? '', filename: shot.filename, width: shot.width, height: shot.height })
                  }
                >
                  <Eye size={14} strokeWidth={1.9} aria-hidden /> View · save · copy
                </button>
                <button
                  className="btn sm"
                  type="button"
                  aria-pressed={pinning === shot.id}
                  onClick={() => setPinning(pinning === shot.id ? null : shot.id)}
                >
                  <MapPin size={14} strokeWidth={1.9} aria-hidden />
                  {pinning === shot.id ? 'Click the spot…' : 'Place a pin'}
                </button>
                <button
                  className="btn sm"
                  type="button"
                  onClick={() => setDraft({ shotId: shot.id, x: 50, y: 50, note: '' })}
                >
                  + Pin at centre
                </button>
              </div>
            )}

            <AnimatePresence initial={false}>
              {pins.map((p) => {
                const n = pinNumber(ds, p.id);
                const sel = selected === p.id;
                const author = ds.profiles.find((u) => u.id === p.author_id);
                return (
                  <motion.div
                    key={p.id}
                    className={`pinrow${sel ? ' sel' : ''}`}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0, marginTop: 0, transition: { duration: 0.16 } }}
                    transition={spring}
                  >
                    <span className={`pinno${p.is_resolved ? ' res' : ''}`} aria-hidden>
                      {n}
                    </span>
                    <button
                      className="pinbody"
                      aria-pressed={sel}
                      onClick={() => setSelected(sel ? null : p.id)}
                    >
                      <p className={p.is_resolved ? 'resolved' : undefined}>
                        {p.label && <span className="pinlabel">{p.label}</span>}
                        {p.note}
                      </p>
                      <span className="co">
                        x {p.x_pct.toFixed(1)}% · y {p.y_pct.toFixed(1)}% — {author?.name ?? '—'}
                        {p.is_resolved ? ' · resolved' : ''}
                      </span>
                    </button>
                    <span className="pinacts">
                      <button
                        className="iconbtn"
                        aria-label={p.is_resolved ? `Reopen pin ${n}` : `Resolve pin ${n}`}
                        title={p.is_resolved ? 'Reopen' : 'Resolve'}
                        onClick={() =>
                          store.update(
                            'annotation_pins',
                            p.id,
                            { is_resolved: !p.is_resolved },
                            store.asMe(),
                          )
                        }
                      >
                        {p.is_resolved ? (
                          <RotateCcw size={15} strokeWidth={1.8} />
                        ) : (
                          <Check size={16} strokeWidth={2} />
                        )}
                      </button>
                      <button
                        className="iconbtn danger"
                        aria-label={`Delete pin ${n}`}
                        title="Delete"
                        onClick={() => {
                          if (selected === p.id) setSelected(null);
                          store.remove(
                            'annotation_pins',
                            p.id,
                            store.asMe({ summary: `Pin removed from ${shot.filename}` }),
                          );
                        }}
                      >
                        <Trash2 size={15} strokeWidth={1.8} />
                      </button>
                    </span>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {!pins.length && (
              <p className="none" style={{ marginTop: 9 }}>
                No pins yet — tap anywhere on the surface above.
              </p>
            )}
          </motion.div>
        );
        }}
      />

      <ImageDrop
        onImage={(image) => insertImage(image)}
        onError={(m) => toast(m)}
        busy={busy}
        setBusy={setBusy}
        compact
        label={shots.length ? 'Insert another image here' : 'Insert an image here'}
        hint="Paste with Ctrl+V, drop a file, or click to browse"
      />
      <p className="none" style={{ marginTop: 6 }}>
        Images are compressed in the browser, then kept inline. Tap an image to place a numbered pin.
      </p>
      <ImageViewer image={viewer.image} onClose={viewer.close} />
    </section>
  );
}
