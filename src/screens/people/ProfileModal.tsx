import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Pencil, ArrowUpRight } from 'lucide-react';
import { useData, useStore, newId, nowIso } from '../../data/store';
import { SideSheet, useToast } from '../../ui/bits';
import { ProjectCombo } from '../../ui/pickers';
import { fmtDay, todayIso } from '../../lib/dates';
import { warmth } from '../../lib/warmth';
import { guessLinkLabel, normalizeUrl } from '../../lib/socialLinks';
import type { RelationshipType } from '../../types';
import { buildTimeline, nudgeMessage, TYPE_META } from './timeline';

import { EditInteractionModal } from './TouchModal';
import { inputStyle } from './style';
import { DictateField } from '../../ui/dictation';
import { Attachments } from '../../ui/attachments';
import CardScan, { type CardApply } from './CardScan';
import SocialLinks from './SocialLinks';
import { ImageDrop, processImages, useImagePaste, type DroppedImage } from '../../ui/imagedrop';
import { InlineImageEditor } from '../../ui/InlineImageEditor';
import {
  appendMissingInlineImages,
  insertInlineImages,
  removeInlineImage,
} from '../../ui/inlineImages';
import {
  MAX_PERSON_NOTE_IMAGES,
  type AttachedImage,
  type PersonCard,
  type SocialLink,
} from '../../types';

const WARMTH_PILL: Record<'teal' | 'stamp' | 'rose', string> = { teal: 'ok', stamp: 'due', rose: 'over' };

/** Links as they should be stored: the empty row somebody added and never
 *  filled in is dropped rather than saved, and a link with an address but no
 *  label gets one from its host. */
function cleanLinks(links: SocialLink[]): SocialLink[] {
  return links
    .map((l) => ({ ...l, url: normalizeUrl(l.url), label: l.label.trim() }))
    .filter((l) => l.url)
    .map((l) => ({ ...l, label: l.label || guessLinkLabel(l.url) }));
}

export default function ProfileModal({
  personId,
  onClose,
  onLogTouch,
}: {
  personId: string | null;
  onClose: () => void;
  onLogTouch: (personId: string) => void;
}) {
  const store = useStore();
  const toast = useToast();
  const navigate = useNavigate();
  const ds = useData((d) => d);
  const existing = useData((ds) => ds.people.find((p) => p.id === personId)) ?? null;
  const today = todayIso();

  const [name, setName] = useState(existing?.name ?? '');
  const [role, setRole] = useState(existing?.role ?? '');
  const [relationshipType, setRelationshipType] = useState<RelationshipType>(existing?.relationship_type ?? 'customer');
  const [projectId, setProjectId] = useState(existing?.project_id ?? '');
  const [timeZone, setTimeZone] = useState(existing?.time_zone ?? '');
  const [cadenceDays, setCadenceDays] = useState(existing?.cadence_days ?? 14);
  const [nextAction, setNextAction] = useState(existing?.next_action ?? '');
  const [email, setEmail] = useState(existing?.email ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [company, setCompany] = useState(existing?.company ?? '');
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>(existing?.social_links ?? []);
  const [cards, setCards] = useState<PersonCard[]>(existing?.cards ?? []);
  const [editingInteraction, setEditingInteraction] = useState<string | null>(null);

  /* ── the notes field, which is a scribble ─────────────────────────────
     Same three parts a scribble in Knowledge has: the text carrying
     `{{anvik-image:ID}}` placement markers, the images those markers point
     at, and a caret offset so a pasted screenshot lands where you were
     typing rather than at the end. `appendMissingInlineImages` is what makes
     a person whose notes predate this render correctly — their images have
     no markers yet, so they are placed at the end and the next save persists
     that position. */
  const existingNoteImages = existing?.note_images ?? [];
  const [notes, setNotes] = useState(() =>
    appendMissingInlineImages(existing?.notes ?? '', existingNoteImages.map((i) => i.id)),
  );
  const [noteImages, setNoteImages] = useState<AttachedImage[]>(existingNoteImages);
  const [imgBusy, setImgBusy] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef(notes.length);
  const noteImagesRef = useRef(noteImages);
  noteImagesRef.current = noteImages;

  /** Paste, drop and the picker all arrive here. The cap matches the CHECK
   *  constraint in migration 0048, so the client refuses before the database
   *  has to. */
  const addNoteImage = (img: DroppedImage, offset = caretRef.current) => {
    if (noteImagesRef.current.length >= MAX_PERSON_NOTE_IMAGES) {
      toast(`These notes hold at most ${MAX_PERSON_NOTE_IMAGES} images`);
      return;
    }
    const image: AttachedImage = {
      id: newId('img'),
      filename: img.filename,
      mime: 'image/jpeg',
      width: img.width,
      height: img.height,
      bytes: img.bytes,
      data_url: img.data_url,
      created_at: nowIso(),
    };
    noteImagesRef.current = [...noteImagesRef.current, image];
    setNoteImages(noteImagesRef.current);
    setNotes((current) => {
      const inserted = insertInlineImages(current, offset, [image.id]);
      caretRef.current = inserted.caret;
      return inserted.value;
    });
  };

  const pasteNoteImages = (files: File[], offset = caretRef.current) => {
    setImgBusy(true);
    let nextOffset = offset;
    void processImages(files, (image) => {
      addNoteImage(image, nextOffset);
      nextOffset = caretRef.current;
    })
      .then(() => toast('Image pasted into the notes'))
      .catch((err: Error) => toast(err.message || 'That image could not be pasted'))
      .finally(() => setImgBusy(false));
  };

  // Ctrl/Cmd+V anywhere in the sheet. A text paste is left to whatever has
  // focus; only an image on the clipboard is claimed here.
  useImagePaste(sheetRef, (files) => pasteNoteImages(files), true, toast);

  /**
   * What the scanner found, once it has been reviewed and confirmed.
   *
   * Only the ticked fields arrive — the scanner has already decided nothing
   * on its own — so this writes them straight through. The leftovers it could
   * not fit into a single field (a second phone number, a third address) are
   * appended to the notes as text, which is exactly what the notes are for.
   */
  const applyCard = (a: CardApply) => {
    if (a.name !== undefined) setName(a.name);
    if (a.role !== undefined) setRole(a.role);
    if (a.company !== undefined) setCompany(a.company);
    if (a.email !== undefined) setEmail(a.email);
    if (a.phone !== undefined) setPhone(a.phone);
    if (a.links.length) {
      setSocialLinks((current) => {
        const have = new Set(current.map((l) => l.url.toLowerCase()));
        return [...current, ...a.links.filter((l) => !have.has(l.url.toLowerCase()))];
      });
    }
    if (a.extraNotes) {
      setNotes((current) => {
        const gap = current && !current.endsWith('\n') ? '\n' : '';
        return `${current}${gap}Also on the card: ${a.extraNotes.split('\n').join(' · ')}`;
      });
    }
  };

  const timeline = useMemo(() => (existing ? buildTimeline(existing, ds) : []), [existing, ds]);
  const w = existing ? warmth(existing, today) : null;

  const save = () => {
    const n = name.trim() || 'Unnamed';
    if (existing) {
      store.update(
        'people',
        existing.id,
        {
          name: n,
          role,
          relationship_type: relationshipType,
          project_id: projectId || null,
          time_zone: timeZone,
          cadence_days: cadenceDays,
          next_action: nextAction,
          notes,
          email: email.trim(),
          phone: phone.trim(),
          company: company.trim(),
          social_links: cleanLinks(socialLinks),
          cards,
          note_images: noteImages,
        },
        store.asMe(),
      );
      toast('Saved');
    } else {
      store.insert(
        'people',
        {
          id: newId('p'),
          name: n,
          role,
          relationship_type: relationshipType,
          project_id: projectId || null,
          time_zone: timeZone,
          cadence_days: cadenceDays,
          last_contact_date: null,
          next_action: nextAction || 'First touch — introduce',
          notes,
          email: email.trim(),
          phone: phone.trim(),
          company: company.trim(),
          social_links: cleanLinks(socialLinks),
          cards,
          note_images: noteImages,
          created_at: nowIso(),
        },
        store.asMe({ summary: `Person added — ${n}` }),
      );
      toast(`${n} added`);
    }
    onClose();
  };

  const remove = () => {
    if (!existing) return;
    if (!window.confirm(`Delete ${existing.name}? This cannot be undone.`)) return;
    store.remove('people', existing.id, store.asMe({ summary: `Person removed — ${existing.name}` }));
    toast('Person removed');
    onClose();
  };

  const draftNudge = () => {
    if (!existing || !w) return;
    const line = nudgeMessage(existing, w);
    store.insert(
      'messages',
      {
        id: newId('msg'),
        sender_id: store.meId,
        body: line,
        task_ref_id: null,
        attachment_url: null,
        song_ref: null,
        promoted_to_type: null,
        promoted_to_id: null,
        created_at: nowIso(),
      },
      store.asMe({ summary: `Nudge drafted — ${existing.name}` }),
    );
    toast(`Nudge drafted for ${existing.name}`);
    onClose();
    navigate('/us');
  };

  return (
    <SideSheet
      open
      onClose={onClose}
      title={existing ? existing.name : 'New person'}
      subtitle={existing ? undefined : 'Shared — both of you see this person.'}
      footer={
        <>
          {existing && (
            <button
              type="button"
              className="btn sm"
              onClick={remove}
              style={{ color: 'var(--rose)', marginRight: 'auto' }}
            >
              Delete
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn solid" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div ref={sheetRef}>
      {existing && w && (
        <div className="pm-warmrow">
          <span className={`pill ${WARMTH_PILL[w.color]}`}>
            {w.daysSince === null ? 'never contacted' : `${w.daysSince}d since last touch`}
          </span>
          {w.drifting && (
            <button className="btn sm" onClick={draftNudge}>
              Draft a nudge
            </button>
          )}
        </div>
      )}

      <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
        Name
      </label>
      <DictateField label="Dictate the name">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={inputStyle} />
      </DictateField>

      <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
        Role
      </label>
      <DictateField label="Dictate the role">
        <input
          type="text"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Role — e.g. Vendor · packaging"
          style={inputStyle}
        />
      </DictateField>

      <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
        Company
      </label>
      <DictateField label="Dictate the company">
        <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Company — e.g. Surat Textiles Pvt Ltd"
          style={inputStyle}
        />
      </DictateField>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 11 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
            Email
          </label>
          <input
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            style={{ ...inputStyle, marginBottom: 0 }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 150 }}>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
            Phone
          </label>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98765 43210"
            style={{ ...inputStyle, marginBottom: 0 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 11 }}>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
            Type
          </label>
          <select
            aria-label="Relationship type"
            value={relationshipType}
            onChange={(e) => setRelationshipType(e.target.value as RelationshipType)}
            style={{ ...inputStyle, marginBottom: 0 }}
          >
            {(['customer', 'vendor', 'investor', 'university', 'personal'] as RelationshipType[]).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
            Project
          </label>
          <ProjectCombo
            value={projectId}
            onChange={setProjectId}
            allowNone="— none —"
            inputStyle={{ ...inputStyle, marginBottom: 0 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 11 }}>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
            Time zone
          </label>
          <input
            type="text"
            value={timeZone}
            onChange={(e) => setTimeZone(e.target.value)}
            placeholder="Asia/Kolkata"
            style={{ ...inputStyle, marginBottom: 0 }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
            Cadence (days)
          </label>
          <input
            aria-label="Cadence in days"
            type="number"
            min={1}
            value={cadenceDays}
            onChange={(e) => setCadenceDays(Math.max(1, Number(e.target.value) || 1))}
            style={{ ...inputStyle, marginBottom: 0 }}
          />
        </div>
      </div>

      <CardScan
        cards={cards}
        onCardsChange={setCards}
        current={{ name, role, company, email, phone }}
        onApply={applyCard}
      />

      <SocialLinks links={socialLinks} onChange={setSocialLinks} />

      <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
        Next action
      </label>
      <DictateField label="Dictate the next action">
        <input
          type="text"
          value={nextAction}
          onChange={(e) => setNextAction(e.target.value)}
          placeholder="What happens next"
          style={inputStyle}
        />
      </DictateField>

      <label className="eyebrow" style={{ display: 'block', marginBottom: 4 }}>
        Notes
      </label>
      {/* A scribble, not a textarea: write anything, and paste a screenshot of
          the quote or the WhatsApp thread straight into the middle of it. The
          same editor the Knowledge room uses, so the two behave identically —
          this is not "going into scribbles", it is the notes field having
          learnt what a scribble already knew. */}
      <InlineImageEditor
        value={notes}
        imageIds={noteImages.map((image) => image.id)}
        onChange={setNotes}
        onPasteFiles={pasteNoteImages}
        onCaretChange={(offset) => {
          caretRef.current = offset;
        }}
        onUnusableImage={toast}
        placeholder="Anything worth remembering — paste screenshots straight in"
        ariaLabel="Notes about this person"
        className="note-inline-editor"
        renderImage={(id) => {
          const image = noteImages.find((item) => item.id === id);
          if (!image) return null;
          return (
            <figure className="note-inline-figure">
              <img
                src={image.data_url}
                alt={image.filename}
                loading="lazy"
                decoding="async"
                width={image.width}
                height={image.height}
              />
              <figcaption>
                <span>{image.filename}</span>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    noteImagesRef.current = noteImagesRef.current.filter((i) => i.id !== id);
                    setNoteImages(noteImagesRef.current);
                    setNotes((current) => removeInlineImage(current, id));
                  }}
                >
                  Remove
                </button>
              </figcaption>
            </figure>
          );
        }}
      />
      <ImageDrop
        onImage={(image) => addNoteImage(image)}
        onError={toast}
        busy={imgBusy}
        setBusy={setImgBusy}
        compact
        label={noteImages.length ? 'Insert another image here' : 'Insert an image here'}
        hint="Paste, drop, or choose a file"
      />
      <div style={{ height: 11 }} />

      {existing && (
        <>
          <div className="tl-head">
            <label className="eyebrow">Contact timeline</label>
            <button className="btn sm" onClick={() => onLogTouch(existing.id)}>
              + Log touch
            </button>
          </div>
          {timeline.length === 0 ? (
            <p className="tip" style={{ margin: '6px 0' }}>
              Nothing logged yet — no touches, notes, tasks, ledger rows, or mail mention {existing.name}.
            </p>
          ) : (
            <div className="timeline">
              {timeline.map((e) => {
                const meta = TYPE_META[e.type];
                return (
                  <div className="tl-entry" key={e.id}>
                    <span
                      className="tl-chip"
                      style={{ background: `var(--${meta.color}-s)`, color: `var(--${meta.color})` }}
                    >
                      {meta.label}
                    </span>
                    <div className="tl-body">
                      <span className="mono tl-date">{fmtDay(e.date.slice(0, 10))}</span>
                      {e.href ? (
                        e.external ? (
                          <a className="lk tl-summary" href={e.href} target="_blank" rel="noreferrer">
                            {e.summary} <ArrowUpRight size={12} style={{ verticalAlign: -1 }} />
                          </a>
                        ) : (
                          <Link className="lk tl-summary" to={e.href} onClick={onClose}>
                            {e.summary}
                          </Link>
                        )
                      ) : (
                        <span className="tl-summary">{e.summary}</span>
                      )}
                      {e.meta && <span className="tl-meta">{e.meta}</span>}
                    </div>
                    {e.interactionId && (
                      <div className="tl-actions">
                        <button
                          type="button"
                          className="tl-iconbtn"
                          aria-label="Edit this touch"
                          onClick={() => setEditingInteraction(e.interactionId!)}
                        >
                          <Pencil size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {existing && (
        <div style={{ marginTop: 14 }}>
          <Attachments
            entityType="person"
            entityId={existing.id}
            hint="A signed agreement, a passport scan, anything on file for this person."
          />
        </div>
      )}

      </div>

      {existing && editingInteraction && (
        <EditInteractionModal
          personId={existing.id}
          interactionId={editingInteraction}
          onClose={() => setEditingInteraction(null)}
        />
      )}
    </SideSheet>
  );
}
