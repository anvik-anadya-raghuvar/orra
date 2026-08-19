import React, { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { newId } from '../../data/store';
import type { DroppedImage } from '../../ui/imagedrop';
import { PIN_LABELS } from '../../types';

export interface DraftShot extends DroppedImage {
  id: string;
  created_at: string;
}

export interface DraftPin {
  id: string;
  screenshot_id: string;
  x_pct: number;
  y_pct: number;
  note: string;
  label: string;
  created_at: string;
}

interface OpenPin {
  screenshot_id: string;
  x_pct: number;
  y_pct: number;
  note: string;
  label: string;
}

const clamp = (value: number) => Math.min(100, Math.max(0, Math.round(value * 10) / 10));
const ordered = <T extends { created_at: string; id: string }>(a: T, b: T) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/**
 * The evidence workspace inside New task. Nothing is persisted until the task
 * is created, but the interaction is the real one: paste an image, click the
 * exact region, describe the change, then move to any screenshot. Pin numbers
 * follow creation order across the whole draft.
 */
export default function DraftEvidenceEditor({
  shots,
  pins,
  nextTimestamp,
  onPinsChange,
  onRemoveShot,
  onDraftStateChange,
}: {
  shots: DraftShot[];
  pins: DraftPin[];
  nextTimestamp: () => string;
  onPinsChange: (pins: DraftPin[]) => void;
  onRemoveShot: (shotId: string) => void;
  onDraftStateChange?: (open: boolean) => void;
}) {
  const [openPin, setOpenPin] = useState<OpenPin | null>(null);
  const numbered = [...pins].sort(ordered);
  const numberOf = (id: string) => numbered.findIndex((pin) => pin.id === id) + 1;

  useEffect(() => onDraftStateChange?.(!!openPin), [openPin, onDraftStateChange]);

  const begin = (e: React.MouseEvent<HTMLDivElement>, screenshotId: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    setOpenPin({
      screenshot_id: screenshotId,
      x_pct: clamp(((e.clientX - rect.left) / rect.width) * 100),
      y_pct: clamp(((e.clientY - rect.top) / rect.height) * 100),
      note: '',
      label: '',
    });
  };

  const addPin = () => {
    if (!openPin?.note.trim()) return;
    onPinsChange([
      ...pins,
      {
        ...openPin,
        id: newId('pin'),
        note: openPin.note.trim(),
        created_at: nextTimestamp(),
      },
    ]);
    setOpenPin(null);
  };

  if (!shots.length) return null;

  return (
    <div className="wk-draft-evidence">
      <div className="wk-draft-intro">
        <b>Pin the change while it is still obvious.</b>
        <span>
          Click any screenshot, write what should change, and add the pin. The sequence runs across
          every image — returning to screenshot 1 later still creates the next number.
        </span>
      </div>

      {shots.map((shot, shotIndex) => {
        const shotPins = pins.filter((pin) => pin.screenshot_id === shot.id).sort(ordered);
        const drafting = openPin?.screenshot_id === shot.id;
        return (
          <section className="wk-draft-shot" key={shot.id} aria-label={`Screenshot ${shotIndex + 1}`}>
            <header>
              <div>
                <b>Screenshot {shotIndex + 1}</b>
                <span>{shot.filename}</span>
              </div>
              <button
                type="button"
                className="iconbtn danger"
                aria-label={`Remove screenshot ${shotIndex + 1} and its ${shotPins.length} pins`}
                onClick={() => {
                  if (drafting) setOpenPin(null);
                  onRemoveShot(shot.id);
                }}
              >
                <Trash2 size={15} strokeWidth={1.8} />
              </button>
            </header>

            <div
              className="wk-draft-surface"
              style={{ aspectRatio: `${shot.width} / ${shot.height}` }}
              role="group"
              aria-label={`Pin surface for screenshot ${shotIndex + 1}`}
              onClick={(event) => begin(event, shot.id)}
            >
              <img src={shot.data_url} alt={shot.filename} draggable={false} />
              {shotPins.map((pin) => (
                <button
                  type="button"
                  className="wk-draft-pin"
                  key={pin.id}
                  style={{ left: `${pin.x_pct}%`, top: `${pin.y_pct}%` }}
                  aria-label={`Pin ${numberOf(pin.id)}: ${pin.note}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  {numberOf(pin.id)}
                </button>
              ))}
              {drafting && openPin && (
                <span
                  className="wk-draft-pin pending"
                  style={{ left: `${openPin.x_pct}%`, top: `${openPin.y_pct}%` }}
                  aria-hidden
                >
                  {pins.length + 1}
                </span>
              )}
            </div>

            {drafting && openPin && (
              <div className="wk-draft-form">
                <label>
                  <span>Pin {pins.length + 1} · requested change</span>
                  <textarea
                    autoFocus
                    value={openPin.note}
                    placeholder="What is wrong here, and what should it become?"
                    onChange={(event) => setOpenPin({ ...openPin, note: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) addPin();
                      if (event.key === 'Escape') setOpenPin(null);
                    }}
                  />
                </label>
                <div className="wk-draft-labels" aria-label="Type of change">
                  {PIN_LABELS.map((label) => (
                    <button
                      className="chip"
                      type="button"
                      key={label}
                      aria-pressed={openPin.label === label}
                      onClick={() =>
                        setOpenPin({ ...openPin, label: openPin.label === label ? '' : label })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="wk-draft-actions">
                  <button
                    className="btn sm solid"
                    type="button"
                    disabled={!openPin.note.trim()}
                    onClick={addPin}
                  >
                    Add pin {pins.length + 1}
                  </button>
                  <button className="btn sm" type="button" onClick={() => setOpenPin(null)}>
                    Cancel
                  </button>
                  <span>Ctrl/⌘ + Enter to add</span>
                </div>
              </div>
            )}

            {shotPins.length > 0 && (
              <ol className="wk-draft-pinlist">
                {shotPins.map((pin) => (
                  <li key={pin.id}>
                    <span>{numberOf(pin.id)}</span>
                    <p>
                      {pin.label && <b>{pin.label}</b>}
                      {pin.note}
                    </p>
                    <button
                      className="iconbtn danger"
                      type="button"
                      aria-label={`Remove pin ${numberOf(pin.id)}`}
                      onClick={() => onPinsChange(pins.filter((item) => item.id !== pin.id))}
                    >
                      <Trash2 size={14} strokeWidth={1.8} />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        );
      })}
    </div>
  );
}
