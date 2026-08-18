import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Music, Image as ImageIcon, Sparkles, Radar, Wallet, LayoutGrid } from 'lucide-react';
import { useData, useStore } from '../../data/store';
import { CountUp, Modal, useToast } from '../../ui/bits';
import { spring } from '../../ui/motion';
import { daysUntil, fmtDay, inr, todayIso } from '../../lib/dates';
import { Donut, MiniBars, VIZ } from '../../ui/viz';
import type { Personalization } from '../../types';

/* ── the six independent per-user toggles ──────────────────────────────── */
export const PERSONAL_KEYS: {
  key: keyof Personalization;
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

/* Static, deliberately three — mirrors AI_PULSE in the prototype. */
const AI_PULSE = [
  { t: 'Open-weights model matches frontier on code benchmarks', s: 'Official release notes' },
  { t: 'EU AI Act — first GPAI obligations take effect', s: 'Commission notice' },
  { t: 'New long-context eval suite published', s: 'Lab blog' },
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

  const set = (key: keyof Personalization, value: boolean) => {
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
        const on = me.personalization[key];
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

  const daily = useMemo(
    () => [...ds.shared_daily].sort((a, b) => b.date.localeCompare(a.date))[0],
    [ds.shared_daily],
  );

  const save = () => {
    if (!caption.trim() || !daily) return;
    store.update(
      'shared_daily',
      daily.id,
      { photo_caption: caption.trim() },
      store.asMe({ summary: 'Photo caption updated' }),
    );
    setCaption('');
    toast('Caption saved');
  };

  if (daily?.photo_url) {
    return (
      <div className="photofill">
        <img src={daily.photo_url} alt={daily.photo_caption ?? 'Photo of the day'} loading="lazy" />
        <div className="photocap">
          <span className="eyebrow">Between us · today</span>
          <b>{daily.photo_caption || 'No caption yet'}</b>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Between us</span>
      </div>
      <div className="photoempty">
        <ImageIcon size={26} strokeWidth={1.4} aria-hidden />
        <b>No frame yet today</b>
        <span>A coffee, a screenshot, a ridiculous moment — anything.</span>
      </div>
      <div className="rowgap">
        <input
          className="srch"
          value={caption}
          placeholder="Caption today's frame…"
          aria-label="Photo caption"
          onChange={(e) => setCaption(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <Link className="btn sm" to="/us">
          Upload
        </Link>
      </div>
    </>
  );
}

/* ── Song of the day ───────────────────────────────────────────────────── */
export function SongTile() {
  const ds = useData((d) => d);
  const daily = useMemo(
    () => [...ds.shared_daily].sort((a, b) => b.date.localeCompare(a.date))[0],
    [ds.shared_daily],
  );
  const who = daily ? ds.profiles.find((x) => x.id === daily.picked_by)?.name ?? 'us' : null;

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">{who ? `Picked by ${who}` : 'Between us'}</span>
      </div>
      <div className="songart">
        <span>{daily ? daily.song_title : 'Nothing picked yet'}</span>
        <em>{daily ? daily.song_artist : 'Pick the first one'}</em>
      </div>
      <div className="rowgap">
        {daily?.song_url && (
          <a className="btn sm" href={daily.song_url} target="_blank" rel="noreferrer">
            Play
          </a>
        )}
        <Link className="btn sm" to="/us">
          Suggest
        </Link>
      </div>
    </>
  );
}

/* ── Worth knowing ─────────────────────────────────────────────────────── */
export function WorthTile() {
  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">AI pulse · three, not a feed</span>
      </div>
      <div className="bt-scroll">
        {AI_PULSE.map((x) => (
          <div className="aiitem" key={x.t}>
            <b>{x.t}</b>
            <span>{x.s}</span>
          </div>
        ))}
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
        <Link className="lk" to="/money">
          Open
        </Link>
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
  const items = ds.projects.map((pj) => ({
    label: pj.name,
    value: ds.tasks.filter((t) => t.project_id === pj.id && t.status !== 'done').length,
  }));

  return (
    <>
      <div className="bt-hd">
        <span className="eyebrow">Open per project</span>
        <span className="spacer" />
        <Link className="lk" to="/work">
          Board
        </Link>
      </div>
      <div className="bt-scroll">
        {items.length ? <MiniBars items={items} /> : <p className="tip">No projects yet.</p>}
      </div>
    </>
  );
}
