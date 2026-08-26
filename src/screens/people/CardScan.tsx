/**
 * The business-card scanner.
 *
 * Photograph the front, photograph the back, and the fields fill themselves —
 * that is the whole promise, and the reason the scan starts on its own the
 * moment an image lands rather than waiting behind a button nobody should have
 * to find.
 *
 * What it will *not* do is write anything into the profile without being told
 * to. OCR is confidently wrong on a regular basis: it reads a 5 as an S, it
 * decides a tagline is a job title, it misses the second phone number
 * entirely. So every field it thinks it found is shown as a suggestion with a
 * tick beside it, already ticked where the profile field is empty and
 * deliberately *un*ticked where accepting it would overwrite something a
 * person typed. Nothing lands until 'Fill these in' is pressed. It is the same
 * instinct as the app never silently moving a date: a computed change is a
 * proposal, and a person confirms it.
 *
 * The photographs are kept whether they are scanned or not. That is the part
 * that keeps its value: in eight months the extracted phone number will look
 * wrong, and the answer is to look at the card.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { RotateCcw, ScanLine, Trash2 } from 'lucide-react';
import { newId, nowIso } from '../../data/store';
import { ImageDrop, type DroppedImage } from '../../ui/imagedrop';
import { ProgressBar, useToast } from '../../ui/bits';
import { micro, staggerItem, staggerParent } from '../../ui/motion';
import {
  mergeCardFields,
  parseCardText,
  type CardFields,
  type ScannedLink,
} from '../../lib/cardScan';
import { ocrSupported, readCardImage, releaseOcr, type OcrProgress } from '../../lib/ocr';
import { prettyBytes } from '../../lib/imageCompress';
import { guessLinkLabel } from '../../lib/socialLinks';
import { MAX_PERSON_CARDS, type PersonCard, type SocialLink } from '../../types';

const SIDES: { side: 'front' | 'back'; label: string }[] = [
  { side: 'front', label: 'Front' },
  { side: 'back', label: 'Back' },
];

/** One suggested field, as the review list sees it. */
interface Suggestion {
  key: 'name' | 'role' | 'company' | 'email' | 'phone';
  label: string;
  value: string;
  /** What the profile says now, when that is not empty — shown so accepting a
   *  suggestion is never a surprise. */
  replaces: string;
}

/** Everything one scan produced, decided once and then only edited. */
interface Review {
  suggestions: Suggestion[];
  links: ScannedLink[];
  /** Second and third emails and phone numbers — real information the single
   *  fields have no room for. */
  extras: string[];
  /** The engine's own confidence, 0-100, over the better of the two sides. */
  confidence: number;
}

/** The fields the scanner is willing to fill, plus what it could not fit into
 *  one. `extraNotes` is the leftovers — a second phone number, a third email —
 *  as lines to append to the scribble rather than silently dropped. */
export interface CardApply {
  name?: string;
  role?: string;
  company?: string;
  email?: string;
  phone?: string;
  links: SocialLink[];
  extraNotes: string;
}

export interface CurrentFields {
  name: string;
  role: string;
  company: string;
  email: string;
  phone: string;
}

export default function CardScan({
  cards,
  onCardsChange,
  current,
  onApply,
}: {
  cards: PersonCard[];
  onCardsChange: (cards: PersonCard[]) => void;
  /** What the form holds right now, so a suggestion can say what it replaces. */
  current: CurrentFields;
  onApply: (apply: CardApply) => void;
}) {
  const toast = useToast();
  const [busySide, setBusySide] = useState<'front' | 'back' | null>(null);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  /**
   * The review, frozen at the moment of the scan.
   *
   * Not derived from the parsed fields on every render, which is the version
   * that was here first and was wrong: a suggestion is only listed when it
   * differs from what the profile holds, so typing into a suggestion until it
   * matched made the row you were editing disappear out from under the caret.
   * The list is decided once; editing changes a value inside it, never its
   * membership.
   */
  const [review, setReview] = useState<Review | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [keepExtras, setKeepExtras] = useState(true);
  /** Cards, live. The scan is async and finishes against the list as it was
   *  when it started otherwise — add a back while the front is still being
   *  read and the front's text would overwrite it. */
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  /** Read once, when a scan finishes, to decide which boxes start ticked and
   *  what each suggestion says it replaces. A ref rather than a dependency:
   *  re-running the OCR because somebody typed a letter into the name field
   *  would be absurd. */
  const currentRef = useRef(current);
  currentRef.current = current;

  // The engine holds tens of megabytes of wasm heap and model once it starts.
  // Handing that back when the sheet closes matters more on a phone than the
  // few seconds a later scan spends starting it again.
  useEffect(() => () => void releaseOcr(), []);

  const supported = ocrSupported();

  /** Read whichever cards have images and merge the two sides into one answer. */
  const scan = useCallback(
    async (list: PersonCard[]) => {
      if (!supported) return;
      const front = list.find((c) => c.side === 'front');
      const back = list.find((c) => c.side === 'back');
      const targets = [front, back].filter((c): c is PersonCard => Boolean(c));
      if (!targets.length) return;

      setProgress({ status: 'Starting the reader', progress: 0 });
      try {
        const read: { id: string; side: 'front' | 'back'; text: string; fields: CardFields; confidence: number }[] = [];
        for (const card of targets) {
          const result = await readCardImage(card.data_url, setProgress);
          read.push({
            id: card.id,
            side: card.side,
            text: result.text,
            fields: parseCardText(result.text, result.lines),
            confidence: result.confidence,
          });
        }

        // The engine's own output goes back onto each card, beside the picture
        // it came from. It costs nothing, it makes a re-parse possible without
        // the engine, and it is what a search across people can read. Written
        // against `cardsRef` rather than the list this scan started with: a
        // second side added while the first was being read must survive.
        onCardsChange(
          cardsRef.current.map((c) => {
            const hit = read.find((r) => r.id === c.id);
            return hit ? { ...c, scanned_text: hit.text } : c;
          }),
        );

        const frontFields = read.find((r) => r.side === 'front')?.fields;
        const backFields = read.find((r) => r.side === 'back')?.fields;
        const merged =
          frontFields && backFields
            ? mergeCardFields(frontFields, backFields)
            : frontFields ?? backFields ?? null;

        if (!merged || isEmpty(merged)) {
          setReview(null);
          toast('Nothing readable on that image — the fields are yours to type');
          return;
        }
        const next: Review = {
          suggestions: buildSuggestions(merged, currentRef.current),
          links: merged.links,
          extras: extraLines(merged),
          confidence: Math.max(...read.map((r) => r.confidence)),
        };
        setReview(next);
        setPicked(defaultPicks(next));
      } catch (err) {
        toast((err as Error).message || 'The card could not be read');
        setReview(null);
      } finally {
        setProgress(null);
      }
    },
    [supported, onCardsChange, toast],
  );

  const clearReview = () => {
    setReview(null);
    setPicked({});
  };

  const addImage = (side: 'front' | 'back', img: DroppedImage) => {
    const card: PersonCard = {
      id: newId('card'),
      side,
      filename: img.filename,
      mime: 'image/jpeg',
      width: img.width,
      height: img.height,
      bytes: img.bytes,
      data_url: img.data_url,
      scanned_text: '',
      created_at: nowIso(),
    };
    // One image per side: photographing the front again replaces the front
    // rather than stacking two of them.
    const next = [...cardsRef.current.filter((c) => c.side !== side), card];
    if (next.length > MAX_PERSON_CARDS) {
      toast(`A person keeps at most ${MAX_PERSON_CARDS} card images`);
      return;
    }
    cardsRef.current = next;
    onCardsChange(next);
    void scan(next);
  };

  const removeCard = (id: string) => {
    const next = cardsRef.current.filter((c) => c.id !== id);
    cardsRef.current = next;
    onCardsChange(next);
    if (!next.length) clearReview();
  };

  const chosen = (review?.suggestions ?? []).filter((s) => picked[s.key] && s.value.trim());
  const chosenLinks = (review?.links ?? []).filter((l) => picked[`link:${l.url}`]);
  const keptExtras = keepExtras && (review?.extras.length ?? 0) > 0;
  const applyCount = chosen.length + chosenLinks.length + (keptExtras ? 1 : 0);

  const apply = () => {
    if (!review) return;
    const out: CardApply = { links: [], extraNotes: '' };
    for (const s of chosen) out[s.key] = s.value.trim();
    out.links = chosenLinks.map((l) => ({
      id: newId('sl'),
      label: l.label || guessLinkLabel(l.url),
      url: l.url,
    }));
    if (keptExtras) out.extraNotes = review.extras.join('\n');
    onApply(out);
    clearReview();
    toast(
      applyCount === 1 ? 'One field filled from the card' : `${applyCount} fields filled from the card`,
    );
  };

  return (
    <section className="cardscan">
      <div className="cs-head">
        <span className="eyebrow">Business card</span>
        {cards.length > 0 && supported && !progress && (
          <button type="button" className="btn sm" onClick={() => void scan(cards)}>
            <RotateCcw size={13} aria-hidden /> Read again
          </button>
        )}
      </div>
      <p className="tip cs-tip">
        {supported
          ? 'Photograph both sides. The card is kept, and what it says is offered as suggestions — nothing fills a field until you say so.'
          : 'This browser cannot run the card reader, so the images are kept but not read.'}
      </p>

      <div className="cs-slots">
        {SIDES.map(({ side, label }) => {
          const card = cards.find((c) => c.side === side);
          return (
            <div className="cs-slot" key={side}>
              <span className="cs-slot-label">{label}</span>
              {card ? (
                <figure className="cs-thumb">
                  <img
                    src={card.data_url}
                    alt={`${label} of the business card`}
                    loading="lazy"
                    decoding="async"
                    width={card.width}
                    height={card.height}
                  />
                  <figcaption>
                    <span className="mono">{prettyBytes(card.bytes)}</span>
                    <button
                      type="button"
                      className="cs-remove"
                      onClick={() => removeCard(card.id)}
                      aria-label={`Remove the ${label.toLowerCase()} of the card`}
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </figcaption>
                </figure>
              ) : (
                <ImageDrop
                  onImage={(img) => addImage(side, img)}
                  onError={toast}
                  busy={busySide === side}
                  setBusy={(b) => setBusySide(b ? side : null)}
                  multiple={false}
                  label={`Add the ${label.toLowerCase()}`}
                  hint="Photograph, paste, or choose a file"
                />
              )}
            </div>
          );
        })}
      </div>

      {progress && (
        <div className="cs-progress" role="status" aria-live="polite">
          <div className="cs-progress-row">
            <ScanLine size={14} aria-hidden />
            <span>{progress.status}…</span>
          </div>
          <ProgressBar pct={Math.round(progress.progress * 100)} />
        </div>
      )}

      {review && !progress && (
        <motion.div className="cs-review" {...staggerParent()}>
          {review.confidence < 55 && (
            <p className="cs-warn">
              The reading was poor — check every line against the photograph before accepting it.
            </p>
          )}

          {review.suggestions.length === 0 && review.links.length === 0 && review.extras.length === 0 ? (
            <p className="tip" style={{ margin: '4px 0' }}>
              Nothing new on the card that the profile does not already say.
            </p>
          ) : (
            <>
              {review.suggestions.map((s) => (
                <motion.label className="cs-row" key={s.key} variants={staggerItem}>
                  <input
                    type="checkbox"
                    checked={Boolean(picked[s.key])}
                    onChange={(e) => setPicked((p) => ({ ...p, [s.key]: e.target.checked }))}
                  />
                  <span className="cs-row-body">
                    <span className="cs-row-label">{s.label}</span>
                    <input
                      type="text"
                      className="cs-row-input"
                      value={s.value}
                      aria-label={`${s.label} read from the card`}
                      onChange={(e) =>
                        setReview((r) =>
                          r
                            ? {
                                ...r,
                                suggestions: r.suggestions.map((row) =>
                                  row.key === s.key ? { ...row, value: e.target.value } : row,
                                ),
                              }
                            : r,
                        )
                      }
                    />
                    {s.replaces && (
                      <span className="cs-row-warn">replaces “{s.replaces}”</span>
                    )}
                  </span>
                </motion.label>
              ))}

              {review.links.map((l) => (
                <motion.label className="cs-row" key={l.url} variants={staggerItem}>
                  <input
                    type="checkbox"
                    checked={Boolean(picked[`link:${l.url}`])}
                    onChange={(e) =>
                      setPicked((p) => ({ ...p, [`link:${l.url}`]: e.target.checked }))
                    }
                  />
                  <span className="cs-row-body">
                    <span className="cs-row-label">{l.label}</span>
                    <span className="cs-row-static mono">{l.url}</span>
                  </span>
                </motion.label>
              ))}

              {review.extras.length > 0 && (
                <motion.label className="cs-row" variants={staggerItem}>
                  <input
                    type="checkbox"
                    checked={keepExtras}
                    onChange={(e) => setKeepExtras(e.target.checked)}
                  />
                  <span className="cs-row-body">
                    <span className="cs-row-label">Also on the card</span>
                    <span className="cs-row-static">{review.extras.join(' · ')}</span>
                    <span className="cs-row-warn">added to the notes below</span>
                  </span>
                </motion.label>
              )}

              <div className="cs-actions">
                <button type="button" className="btn sm" onClick={clearReview}>
                  Discard
                </button>
                <motion.button
                  type="button"
                  className="btn sm solid"
                  disabled={applyCount === 0}
                  onClick={apply}
                  whileTap={{ scale: 0.985, transition: micro }}
                >
                  {applyCount === 0
                    ? 'Nothing selected'
                    : `Fill ${applyCount} ${applyCount === 1 ? 'field' : 'fields'} in`}
                </motion.button>
              </div>
            </>
          )}
        </motion.div>
      )}
    </section>
  );
}

/* ── the small decisions, kept out of the component ────────────────────── */

function isEmpty(f: CardFields): boolean {
  return !f.name && !f.role && !f.company && !f.emails.length && !f.phones.length && !f.links.length;
}

/** Only fields the card actually offered, and only where they say something
 *  different from what the profile already holds. */
function buildSuggestions(f: CardFields, current: CurrentFields): Suggestion[] {
  const rows: { key: Suggestion['key']; label: string; value: string }[] = [
    { key: 'name', label: 'Name', value: f.name },
    { key: 'role', label: 'Role', value: f.role },
    { key: 'company', label: 'Company', value: f.company },
    { key: 'email', label: 'Email', value: f.emails[0] ?? '' },
    { key: 'phone', label: 'Phone', value: f.phones[0] ?? '' },
  ];
  return rows
    .filter((r) => r.value && r.value.trim() !== current[r.key].trim())
    .map((r) => ({ ...r, replaces: current[r.key].trim() }));
}

/**
 * Which boxes start ticked. Empty field: ticked, because filling a blank is
 * the entire point. Field with something already in it: left untouched,
 * because a machine guess should never quietly beat a person's typing — you
 * can still tick it, and it says what it would replace before you do.
 *
 * Links start ticked outright: there is no existing link a new one can
 * silently overwrite, so there is nothing to protect.
 */
function defaultPicks(review: Review): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const s of review.suggestions) out[s.key] = !s.replaces;
  for (const l of review.links) out[`link:${l.url}`] = true;
  return out;
}

/** Second and third emails and phone numbers. One of each fits the profile;
 *  the rest are real information and go to the notes rather than nowhere. */
function extraLines(f: CardFields): string[] {
  return [...f.emails.slice(1), ...f.phones.slice(1)];
}


