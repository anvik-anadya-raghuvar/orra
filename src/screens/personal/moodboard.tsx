/**
 * The mood board — a free page, and the only one in the portal.
 *
 * Everything else here has a shape: a task has a status, a goal has progress,
 * a ledger row has a direction. This has none. Pin the screenshot of the first
 * paying invoice, a quote, a song someone sent, a photo from Rome, a link.
 * No columns, no due dates, no completion.
 *
 * Yours alone: `mood_items` carries owner RLS, so the other person's board is
 * not merely hidden, it is unreadable.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Image as ImageIcon, Link2, Quote, StickyNote, Music } from 'lucide-react';
import { newId, useData, useStore } from '../../data/store';
import { Modal, useToast } from '../../ui/bits';
import { entrance, staggerItem, staggerParent } from '../../ui/motion';
import { momentSrc, uploadMoment } from '../../lib/moments';
import type { MoodItem } from '../../types';
import { DeleteBtn } from './widgets';

const KINDS: { key: MoodItem['kind']; label: string; Icon: typeof Quote }[] = [
  { key: 'note', label: 'Note', Icon: StickyNote },
  { key: 'quote', label: 'Quote', Icon: Quote },
  { key: 'link', label: 'Link', Icon: Link2 },
  { key: 'image', label: 'Image', Icon: ImageIcon },
  { key: 'song', label: 'Song', Icon: Music },
];

function PinnedImage({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    momentSrc(path).then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [path]);
  if (!src) return <div className="mb-img mb-img-missing">Image unavailable</div>;
  return <img className="mb-img" src={src} alt="" loading="lazy" />;
}

function Card({ item }: { item: MoodItem }) {
  const store = useStore();
  const toast = useToast();
  return (
    <motion.div
      className={`mb-card mb-${item.kind}`}
      variants={staggerItem}
      whileHover={{ y: -3 }}
    >
      {item.kind === 'image' && item.storage_path && <PinnedImage path={item.storage_path} />}
      {item.kind === 'quote' && <blockquote className="mb-quote">{item.body}</blockquote>}
      {item.kind === 'note' && <p className="mb-note">{item.body}</p>}
      {item.kind === 'song' && (
        <div className="mb-song">
          <Music size={15} strokeWidth={1.8} aria-hidden />
          <b>{item.title}</b>
          {item.body && <span className="sub">{item.body}</span>}
        </div>
      )}
      {item.kind === 'link' && item.url && (
        <a className="mb-link" href={item.url} target="_blank" rel="noreferrer">
          <Link2 size={14} strokeWidth={1.8} aria-hidden />
          {item.title || item.url}
        </a>
      )}
      {item.title && item.kind !== 'link' && item.kind !== 'song' && (
        <span className="mb-title">{item.title}</span>
      )}
      <div className="mb-acts">
        <DeleteBtn
          label={item.title || item.body || 'this pin'}
          onConfirm={() => {
            store.remove('mood_items', item.id, store.asMe({ summary: 'Unpinned from the board' }));
            toast('Unpinned');
          }}
        />
      </div>
    </motion.div>
  );
}

export default function MoodBoard() {
  const ds = useData((d) => d);
  const store = useStore();
  const meId = useData((_, s) => s.meId);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<MoodItem['kind']>('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const items = useMemo(
    () =>
      ds.mood_items
        .filter((m) => m.user_id === meId)
        .sort((a, b) => b.pinned_at.localeCompare(a.pinned_at)),
    [ds.mood_items, meId],
  );

  const insert = (patch: Partial<MoodItem>) => {
    store.insert(
      'mood_items',
      {
        id: newId('mood'),
        user_id: meId,
        kind,
        title: title.trim(),
        body: body.trim(),
        url: url.trim() || null,
        storage_path: null,
        color: '',
        position: items.length + 1,
        pinned_at: new Date().toISOString(),
        ...patch,
      } as MoodItem,
      store.asMe({ summary: 'Pinned to the board' }),
    );
    setTitle('');
    setBody('');
    setUrl('');
    setOpen(false);
    toast('Pinned');
  };

  const pickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const { compressPhoto } = await import('../../lib/photo');
      const id = newId('mood');
      const path = await uploadMoment(await compressPhoto(file), meId, id);
      insert({ id, kind: 'image', storage_path: path });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That image could not be pinned');
    } finally {
      setBusy(false);
    }
  };

  const canSave =
    kind === 'link' ? Boolean(url.trim()) : Boolean(body.trim() || title.trim());

  return (
    <div className="mb-wrap">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} aria-label="Choose an image" />
      <div className="phead">
        <h3>Mood board</h3>
        <span className="mono sub">{items.length} pinned</span>
        <div className="spacer" />
        <button type="button" className="btn sm solid" onClick={() => setOpen(true)}>
          Pin something
        </button>
      </div>
      <p className="tip" style={{ marginTop: 0 }}>
        Yours alone — {store.other.name} has their own and cannot see this one. Nothing here has a
        status or a deadline.
      </p>

      {items.length === 0 ? (
        <motion.p className="tip" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: entrance }}>
          Empty. Pin a quote, a photo, a link — whatever you want in front of you.
        </motion.p>
      ) : (
        <motion.div className="mb-grid" {...staggerParent()}>
          {items.map((m) => (
            <Card key={m.id} item={m} />
          ))}
        </motion.div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Pin something">
        <div className="mb-kinds">
          {KINDS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              className="chip"
              aria-pressed={kind === key}
              onClick={() => (key === 'image' ? fileRef.current?.click() : setKind(key))}
              disabled={busy && key === 'image'}
            >
              <Icon size={13} strokeWidth={1.8} aria-hidden /> {label}
            </button>
          ))}
        </div>
        {kind !== 'image' && (
          <>
            <div style={{ height: 10 }} />
            {(kind === 'link' || kind === 'song' || kind === 'note') && (
              <input
                className="pin"
                value={title}
                autoFocus
                placeholder={kind === 'song' ? 'Song title' : 'Title (optional)'}
                aria-label="Title"
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
            {kind === 'link' && (
              <>
                <div style={{ height: 8 }} />
                <input
                  className="pin"
                  value={url}
                  placeholder="https://…"
                  aria-label="Link"
                  onChange={(e) => setUrl(e.target.value)}
                />
              </>
            )}
            {kind !== 'link' && (
              <>
                <div style={{ height: 8 }} />
                <textarea
                  className="pin"
                  rows={3}
                  value={body}
                  placeholder={kind === 'quote' ? 'The quote…' : 'Anything…'}
                  aria-label="Body"
                  onChange={(e) => setBody(e.target.value)}
                />
              </>
            )}
            <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="btn solid" type="button" onClick={() => insert({})} disabled={!canSave}>
                Pin it
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
