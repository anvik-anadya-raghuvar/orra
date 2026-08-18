import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, RotateCcw, Trash2, Upload } from 'lucide-react';
import { newId, useDataset, useStore } from '../../data/store';
import { useToast } from '../../ui/bits';
import { entrance, spring } from '../../ui/motion';
import { pinNumber } from '../../lib/exportTask';
import { compressImage, jpegName, prettyBytes } from './imageCompress';
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
export default function Screenshots({ task }: { task: Task }) {
  const store = useStore();
  const ds = useDataset();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const shots = ds.screenshot_attachments.filter((s) => s.task_id === task.id).sort(byCreated);

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
    setSelected(row.id);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const img = await compressImage(file);
      const filename = jpegName(file.name);
      store.insert(
        'screenshot_attachments',
        {
          id: newId('shot'),
          task_id: task.id,
          storage_path: `screenshots/${task.id}/${filename}`,
          filename,
          mime: 'image/jpeg',
          width: img.width,
          height: img.height,
          uploaded_by: store.me.id,
          created_at: new Date().toISOString(),
          data_url: img.data_url,
        },
        store.asMe({ summary: `Screenshot ${filename} attached` }),
      );
      toast(`${filename} attached · ${prettyBytes(img.bytes)} at q${img.quality}`);
    } catch (err) {
      toast((err as Error).message || 'That image could not be attached');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Screenshot evidence">
      <div
        className="eyebrow"
        style={{ marginBottom: 8, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <span>Evidence · tap the surface to drop a pin</span>
      </div>

      {shots.length === 0 && (
        <div className="empty">
          <p className="none" style={{ marginBottom: 10 }}>
            No screenshot attached yet. Pins are what make the export worth reading.
          </p>
        </div>
      )}

      {shots.map((shot) => {
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
              </div>
              <div
                className="shotsurf"
                style={{ aspectRatio: `${shot.width} / ${shot.height}` }}
                onClick={(e) => startDraft(e, shot)}
                role="group"
                aria-label={`Annotation surface for ${shot.filename}. Click to place a pin.`}
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
                      if (e.key === 'Escape') setDraft(null);
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
                    <button className="btn sm" onClick={() => setDraft(null)}>
                      Cancel
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!isDrafting && (
              <button
                className="btn sm"
                style={{ marginTop: 4 }}
                onClick={() => setDraft({ shotId: shot.id, x: 50, y: 50, note: '' })}
              >
                + Pin at centre
              </button>
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
      })}

      <label className="uploader">
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} disabled={busy} />
        <span className="btn sm" role="button" tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}
        >
          <Upload size={14} strokeWidth={1.8} />
          {busy ? 'Compressing…' : 'Attach a screenshot'}
        </span>
      </label>
      <p className="none" style={{ marginTop: 6 }}>
        Compressed in the browser — capped at 1600px wide and 300 KB.
      </p>
    </section>
  );
}
