import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Music, Image as ImageIcon, Sparkles, Radar, Wallet, LayoutGrid } from 'lucide-react';
import { newId, nowIso, today, useData, useStore } from '../../data/store';
import { CountUp, Modal, useToast } from '../../ui/bits';
import { spring } from '../../ui/motion';
import { daysUntil, fmtDay, inr, todayIso } from '../../lib/dates';
import { Donut, MiniBars, VIZ } from '../../ui/viz';
import { isYouTubeUrl, playUrl, youTubeThumb } from '../../lib/song';
import { ChevronRight } from 'lucide-react';
import { ResetArrangement } from './tilechrome';
import type { Personalization, Project, SharedDaily } from '../../types';

/* ── One consistent "open full page" affordance, shared with index.tsx.
   Always in the tile header, always a real link — keyboard reachable,
   ≥44px hit area on touch via style.css. ────────────────────────────────── */
export function TileOpen({ to, label }: { to: string; label: string }) {
  return (
    <Link className="bt-openlink" to={to} aria-label={`Open ${label}`} title={`Open ${label}`}>
      <ChevronRight size={16} strokeWidth={2.2} aria-hidden />
    </Link>
  );
}

/* ── the six independent per-user toggles ──────────────────────────────── */
export type WidgetKey = Exclude<keyof Personalization, 'home_layout'>;

export const PERSONAL_KEYS: {
  key: WidgetKey;
  label: string;
  hint: string;
  Icon: typeof Music;
}[] = [
  { key: 'song', label: 'Song of the day', hint: 'Whatever the other one picked this morning', Icon: Music },
  { key: 'photo', label: 'Photo of the day', hint: 'One frame from the day, filling its own tile', Icon: ImageIcon },
  { key: 'worth_knowing', label: 'Worth knowing', hint: 'Three things from the AI pulse — not a feed', Icon: Sparkles },
  { key: 'life_radar', label: 'Life radar', hint: 'Life admin still open, and the dates that are fixed', Icon: Radar },
  { key: 'projects_strip', label: 'Projects', hint: 'Open counts per project, as small multiples', Icon: LayoutGrid },
  { key: 'money_on_home', label: 'Money on Home', hint: 'In and out as one mark, no table', Icon: Wallet },
];

/** Compact money label so a number can live inside a donut without wrapping. */
const shortInr = (n: number) => {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(1)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(1)}L`;
  if (a >= 1e3) return `${sign}₹${Math.round(a / 1e3)}k`;
  return `${sign}₹${a}`;
};

/* ── Customise popover — writes profiles.personalization for THIS user ─── */
export function CustomiseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = useStore();
  const me = useData((_, s) => s.me);
  const toast = useToast();

  const set = (key: WidgetKey, value: boolean) => {
    store.update(
      'profiles',
      me.id,
      { personalization: { ...me.personalization, [key]: value } },
      store.asMe({ summary: `Home layer — ${key} ${value ? 'on' : 'off'}` }),
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Customise your Home">
      <p className="tip" style={{ margin: '-6px 0 8px' }}>
        Yours only. {store.other.name}'s Home is untouched by anything here — this is a preference,
        never a permission. Hiding a tile re-flows the grid; it never leaves a hole.
      </p>
      {PERSONAL_KEYS.map(({ key, label, hint, Icon }) => {
        const on = Boolean(me.personalization[key]);
        return (
          <div className="swrow" key={key}>
            <Icon size={17} strokeWidth={1.7} color="var(--slate)" aria-hidden />
            <span className="txt">
              {label}
              <small>{hint}</small>
            </span>
            <button
              className="sw"
              role="switch"
              aria-checked={on}
              aria-label={label}
              onClick={() => {
                set(key, !on);
                toast(`${label} ${!on ? 'added to' : 'removed from'} your Home`);
              }}
            >
              <motion.span className="knob" layout transition={spring} />
            </button>
          </div>
        );
      })}
      <ResetArrangement />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn solid" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}

/* ── Photo of the day — the image IS the tile ──────────────────────────── */
export function PhotoTile() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const daily = useMemo(
    () => [...ds.shared_daily].sort((a, b) => b.date.localeCompare(a.date))[0],
    [ds.shared_daily],
  );
  const todaysRow = daily?.date === today() ? daily : null;

  /** Today's row, created on demand — the tile must work on a fresh day. */
  const rowForToday = (): SharedDaily => {
    if (todaysRow) return todaysRow;
    const row: SharedDaily = {
      id: newId('sd'),
      date: today(),
      song_title: '',
      song_artist: '',
      song_url: '',
      picked_by: store.meId,
      photo_url: null,
      photo_caption: null,
    };
    store.insert('shared_daily', row, store.asMe({ summary: 'Started today’s shared frame' }));
    return row;
  };

  const saveCaption = () => {
    const text = caption.trim();
    if (!text) return;
    const row = rowForToday();
    store.update(
      'shared_daily',
      row.id,
      { photo_caption: text },
      store.asMe({ summary: 'Photo caption updated' }),
    );
    setCaption('');
    toast('Caption saved');
  };

  // Uploads right here. Sending someone to another screen to press a second
  // upload button is the bug, not the feature.
  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-picked after an error
    if (!file) return;
    setBusy(true);
    try {
      const { compressPhoto } = await import('../../lib/photo');
      const dataUrl = await compressPhoto(file);
      const row = rowForToday();
      store.update(
        'shared_daily',
        row.id,
        { photo_url: dataUrl, ...(caption.trim() ? { photo_caption: caption.trim() } : {}) },
        store.asMe({ summary: 'Photo of the day set' }),
      );
      setCaption('');
      toast('Photo saved');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That image could not be used');
    } finally {
      setBusy(false);
    }
  };

  const picker = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      hidden
      onChange={onPick}
      aria-label="Choose a photo"
    />
  );

  if (todaysRow?.photo_url) {
    return (
      <div className="photofill">
        {picker}
        <img src={todaysRow.photo_url} alt={todaysRow.photo_caption ?? 'Photo of the day'} loading="lazy" />
        <div className="photocap">
          <span className="eyebrow">Photo of the day</span>
          <b>{todaysRow.photo_caption || 'No caption yet'}</b>
        </div>
        <div className="photoacts">
          <Link className="btn sm" to="/us" aria-label="Open Us">
            Open Us
          </Link>
          <button
            type="button"
            className="btn sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? 'Compressing…' : 'Replace'}
          </button>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              store.update(
                'shared_daily',
                todaysRow.id,
                { photo_url: null, photo_caption: null },
                store.asMe({ summary: 'Photo of the day cleared' }),
              );
              toast('Photo removed');
            }}
          >
            Remove
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {picker}
      <div className="bt-hd">
        <span className="eyebrow">Photo of the day</span>
        <div className="spacer" />
        <TileOpen to="/us" label="Us" />
      </div>
      <button
        type="button"
        className="photoempty photoempty-btn"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        <ImageIcon size={26} strokeWidth={1.4} aria-hidden />
        <b>{busy ? 'Compressing…' : 'No frame yet today'}</b>
        <span>A coffee, a screenshot, a ridiculous moment — tap to add one.</span>
      </button>
      <div className="rowgap">
        <input
          className="srch"
          value={caption}
          placeholder="Caption today's frame…"
          aria-label="Photo caption"
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveCaption()}
        />
        <button
          type="button"
          className="btn sm"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          Upload
        </button>
      </div>
    </>
  );
}

/* ── Song of the day — suggest right here, no trip to Us required ──────── */
export function SongTile() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const daily = useMemo(
    () => [...ds.shared_daily].sort((a, b) => b.date.localeCompare(a.date))[0],
    [ds.shared_daily],
  );
  const todaysRow = daily?.date === today() ? daily : null;
  const who = daily ? ds.profiles.find((x) => x.id === daily.picked_by)?.name ?? 'us' : null;
  const thumb = daily ? youTubeThumb(daily.song_url) : null;

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [url, setUrl] = useState('');

  const openEditor = () => {
    setTitle(todaysRow?.song_title ?? '');
    setArtist(todaysRow?.song_artist ?? '');
    setUrl(todaysRow?.song_url ?? '');
    setEditing(true);
  };

  const save = () => {
    const t = title.trim();
    if (!t) return;
    if (todaysRow) {
      store.update(
        'shared_daily',
        todaysRow.id,
        { song_title: t, song_artist: artist.trim(), song_url: url.trim(), picked_by: store.meId },
        store.asMe({ summary: 'Song of the day updated' }),
      );
    } else {
      store.insert(
        'shared_daily',
        {
          id: newId('sd'),
          date: today(),
          song_title: t,
          song_artist: artist.trim(),
          song_url: url.trim(),
          picked_by: store.meId,
          photo_url: null,
          photo_caption: null,
        },
        store.asMe({ summary: 'Song of the day picked' }),
      );
    }
    setEditing(false);
    toast('Song saved');
  };

  if (editing) {
    return (
      <>
        <div className="bt-hd">
          <span className="eyebrow">Suggest a song</span>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          <input
            className="srch"
            value={title}
            placeholder="Title"
            aria-label="Song title"
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <input
            className="srch"
            value={artist}
            placeholder="Artist"
            aria-label="Song artist"
            onChange={(e) => setArtist(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <input
            className="srch"
            value={url}
            placeholder="YouTube link (optional)"
            aria-label="YouTube link"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          {/* Not a hard rejection: without a link, Play falls back to a
              YouTube search for the title and artist, so a pick is never
              unplayable just because no link was to hand. */}
          <span className="tip" style={{ margin: 0 }}>
            {url.trim() && !isYouTubeUrl(url)
              ? 'Not a YouTube link — Play will search YouTube for the title instead.'
              : 'YouTube only, so Play always works for both of you.'}
          </span>
        </div>
        <div className="rowgap" style={{ marginTop: 8 }}>
          <button className="btn sm" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button className="btn sm solid" onClick={save} disabled={!title.trim()}>
            Save
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">{who ? `Picked by ${who}` : 'Between us'}</span>
        <div className="spacer" />
        <TileOpen to="/us" label="Us" />
      </div>
      <div className="songart" style={thumb ? { backgroundImage: `url(${thumb})` } : undefined}>
        <span>{daily ? daily.song_title : 'Nothing picked yet'}</span>
        <em>{daily ? daily.song_artist : 'Pick the first one'}</em>
      </div>
      <div className="rowgap">
        {daily?.song_title && (
          <a className="btn sm" href={playUrl(daily)} target="_blank" rel="noreferrer">
            Play on YouTube
          </a>
        )}
        <button type="button" className="btn sm" onClick={openEditor}>
          {todaysRow?.song_title ? 'Change' : 'Suggest'}
        </button>
      </div>
    </>
  );
}

/* ── Worth knowing — real LLM/AI headlines, filled by the pulse cron ───── */
export function WorthTile() {
  const ds = useData((d) => d);
  const store = useStore();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');

  // Pinned first, then newest. Three, deliberately — this is a briefing, not a feed.
  const items = useMemo(
    () =>
      [...ds.pulse_items]
        .sort(
          (a, b) =>
            Number(b.is_pinned) - Number(a.is_pinned) ||
            b.published_at.localeCompare(a.published_at),
        )
        .slice(0, 3),
    [ds.pulse_items],
  );

  const add = () => {
    const t = title.trim();
    if (!t) return;
    store.insert(
      'pulse_items',
      {
        id: newId('pulse'),
        title: t,
        source: 'Pinned by ' + store.me.name,
        url: url.trim(),
        published_at: nowIso(),
        origin: 'manual',
        is_pinned: true,
        created_at: nowIso(),
      },
      store.asMe({ summary: 'Pinned something worth knowing' }),
    );
    setTitle('');
    setUrl('');
    setAdding(false);
    toast('Pinned to Worth knowing');
  };

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">AI pulse · three, not a feed</span>
        <div className="spacer" />
        <TileOpen to="/knowledge" label="Knowledge" />
        <button type="button" className="btn sm" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancel' : 'Pin one'}
        </button>
      </div>
      {adding && (
        <div className="colgap" style={{ marginBottom: 8 }}>
          <input
            className="srch"
            value={title}
            autoFocus
            placeholder="What's worth knowing?"
            aria-label="Headline"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <input
            className="srch"
            value={url}
            placeholder="Link (optional)"
            aria-label="Link"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="btn sm solid" onClick={add} disabled={!title.trim()}>
            Pin it
          </button>
        </div>
      )}
      <div className="bt-scroll">
        {items.length === 0 ? (
          <p className="tip" style={{ margin: 0 }}>
            Nothing yet — the pulse fetches twice a day, or pin something yourself.
          </p>
        ) : (
          items.map((x) =>
            x.url ? (
              <a className="aiitem" key={x.id} href={x.url} target="_blank" rel="noreferrer">
                <b>{x.title}</b>
                <span>{x.source}</span>
              </a>
            ) : (
              <div className="aiitem" key={x.id}>
                <b>{x.title}</b>
                <span>{x.source}</span>
              </div>
            ),
          )
        )}
      </div>
    </>
  );
}

/* ── Life radar ────────────────────────────────────────────────────────── */
export function LifeTile() {
  const ds = useData((d) => d);
  const store = useStore();
  const me = useData((_, s) => s.me);
  const toast = useToast();
  const today = todayIso();

  const lifeOpen = ds.life_admin.filter((l) => l.user_id === me.id && !l.completed);
  const upcoming = [...ds.fixed_dates]
    .map((f) => ({ ...f, d: daysUntil(f.date, today) }))
    .filter((f) => f.d >= 0)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Life radar</span>
        <span className="spacer" />
        <span className="mono bt-num">
          <CountUp value={lifeOpen.length} /> open
        </span>
        <TileOpen to="/personal" label="Personal" />
      </div>
      <div className="bt-scroll">
        {lifeOpen.length === 0 && <p className="tip" style={{ marginTop: 0 }}>Life admin is clear.</p>}
        {lifeOpen.map((l) => (
          <button
            className="check"
            key={l.id}
            onClick={() => {
              store.update('life_admin', l.id, { completed: true }, store.asMe({ summary: 'Life admin ticked' }));
              toast('Ticked off');
            }}
          >
            <span className="bx" aria-hidden />
            <span>{l.item}</span>
          </button>
        ))}
        {upcoming.map((f) => (
          <div className="mini-row" key={f.id}>
            <span>{f.label}</span>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--mute)' }}>
              {fmtDay(f.date)} · {f.d}d
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ── Money — one mark, one headline number, no table ───────────────────── */
export function MoneyTile() {
  const ledger = useData((ds) => ds.ledger);
  const money = ledger.reduce(
    (a, l) => (l.direction === 'in' ? { ...a, in: a.in + l.amount } : { ...a, out: a.out + l.amount }),
    { in: 0, out: 0 },
  );
  const net = money.in - money.out;

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Money</span>
        <span className="spacer" />
        <TileOpen to="/money" label="Money" />
      </div>
      <div className="donutrow">
        <Donut
          size={82}
          slices={[
            { label: 'In', value: money.in, color: VIZ.in },
            { label: 'Out', value: money.out, color: VIZ.out },
          ]}
          centerValue={shortInr(net)}
          centerLabel="net"
        />
        <div className="viz-legend" style={{ marginTop: 0, flexDirection: 'column', gap: 6 }}>
          <span>
            <i style={{ background: VIZ.in }} />+ <CountUp value={money.in} format={(n) => inr(n)} />
          </span>
          <span>
            <i style={{ background: VIZ.out }} />− <CountUp value={money.out} format={(n) => inr(n)} />
          </span>
        </div>
      </div>
    </>
  );
}

/* ── Projects — small multiples, never four colours in one chart ───────── */
export function ProjectsTile() {
  const ds = useData((d) => d);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const items = ds.projects.map((pj) => ({
    id: pj.id,
    label: pj.name,
    value: ds.tasks.filter((t) => t.project_id === pj.id && t.status !== 'done').length,
  }));
  const max = Math.max(...items.map((i) => i.value), 1);
  const snapshot = snapshotId ? ds.projects.find((p) => p.id === snapshotId) ?? null : null;

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Open per project</span>
        <span className="spacer" />
        <TileOpen to="/work" label="Work" />
      </div>
      <div className="bt-scroll">
        {items.length ? (
          <div className="viz-minis">
            {items.map((it) => (
              <button
                type="button"
                key={it.id}
                className="viz-mini pj-row"
                onClick={() => setSnapshotId(it.id)}
                aria-label={`Snapshot for ${it.label}`}
                style={{ border: 'none', background: 'none', padding: 0, textAlign: 'left', font: 'inherit', cursor: 'pointer', width: '100%' }}
              >
                <span className="viz-minilabel">{it.label}</span>
                <span className="viz-minitrack">
                  <i style={{ display: 'block', height: '100%', borderRadius: 4, background: 'var(--viz-seq)', width: `${(it.value / max) * 100}%` }} />
                </span>
                <b className="mono">{it.value}</b>
              </button>
            ))}
          </div>
        ) : (
          <p className="tip">No projects yet.</p>
        )}
      </div>
      <ProjectSnapshotModal project={snapshot} onClose={() => setSnapshotId(null)} />
    </>
  );
}

/** On-demand project snapshot — the whole reason to click a bar instead of
 * leaving Home is to see the shape of a project without losing your place. */
function ProjectSnapshotModal({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const ds = useData((d) => d);
  const open = !!project;
  const openTasks = project ? ds.tasks.filter((t) => t.project_id === project.id && t.status !== 'done') : [];
  const doneTasks = project ? ds.tasks.filter((t) => t.project_id === project.id && t.status === 'done') : [];
  const openDecisions = project ? ds.decisions.filter((d) => d.project_id === project.id && d.status === 'open') : [];
  const net = project
    ? ds.ledger
        .filter((l) => l.project_id === project.id)
        .reduce((a, l) => a + (l.direction === 'in' ? l.amount : -l.amount), 0)
    : 0;

  return (
    <Modal open={open} onClose={onClose} title={project?.name}>
      {project && (
        <>
          {project.description && <p className="tip" style={{ margin: '-6px 0 12px' }}>{project.description}</p>}
          <div className="donutrow" style={{ marginBottom: 4 }}>
            <MiniBars
              items={[
                { label: 'Open tasks', value: openTasks.length, color: 'var(--viz-1)' },
                { label: 'Done', value: doneTasks.length, color: 'var(--viz-2)' },
                { label: 'Decisions open', value: openDecisions.length, color: 'var(--viz-3)' },
              ]}
            />
          </div>
          <div className="rowgap tight" style={{ marginBottom: 12 }}>
            <span className="mono bt-num" title="Money in minus out, this project">
              {net < 0 ? '−' : ''}
              {inr(Math.abs(net))} net
            </span>
          </div>
          {openTasks.length > 0 && (
            <>
              <span className="eyebrow">Open, most recent first</span>
              <div className="bt-scroll" style={{ maxHeight: 180, marginTop: 6 }}>
                {[...openTasks]
                  .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
                  .slice(0, 6)
                  .map((t) => (
                    <Link className="planrow" key={t.id} to={`/task/${t.id}`}>
                      <span className={`echip e-${t.effort}`}>{t.effort}</span>
                      <span className="planttl">{t.title}</span>
                      <span className="mono planmin">{t.progress_pct}%</span>
                    </Link>
                  ))}
              </div>
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn solid" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
