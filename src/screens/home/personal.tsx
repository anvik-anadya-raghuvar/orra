import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Music, Image as ImageIcon, Sparkles, Radar, Wallet, LayoutGrid } from 'lucide-react';
import { useData, useStore } from '../../data/store';
import { CountUp, Modal, ProgressBar, TagChip, useToast } from '../../ui/bits';
import { lift, spring, staggerItem, staggerList } from '../../ui/motion';
import { daysUntil, fmtDay, inr, todayIso } from '../../lib/dates';
import { rankTasks } from '../../lib/ranking';
import type { Personalization } from '../../types';

/* ── the six independent per-user toggles ──────────────────────────────── */
export const PERSONAL_KEYS: {
  key: keyof Personalization;
  label: string;
  hint: string;
  Icon: typeof Music;
}[] = [
  { key: 'song', label: 'Song of the day', hint: 'Whatever the other one picked this morning', Icon: Music },
  { key: 'photo', label: 'Photo of the day', hint: 'One frame from the day, with a caption', Icon: ImageIcon },
  { key: 'worth_knowing', label: 'Worth knowing', hint: 'Three things from the AI pulse — not a feed', Icon: Sparkles },
  { key: 'life_radar', label: 'Life radar', hint: 'Life admin still open, and the dates that are fixed', Icon: Radar },
  { key: 'projects_strip', label: 'Projects strip', hint: 'Open counts per project, snapshot on tap', Icon: LayoutGrid },
  { key: 'money_on_home', label: 'Money on Home', hint: 'A small in-and-out summary, no drill-down', Icon: Wallet },
];

/* Static, deliberately three — mirrors AI_PULSE in the prototype. */
const AI_PULSE = [
  { t: 'Open-weights model matches frontier on code benchmarks', s: 'Official release notes' },
  { t: 'EU AI Act — first GPAI obligations take effect', s: 'Commission notice' },
  { t: 'New long-context eval suite published', s: 'Lab blog' },
];

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
        never a permission.
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

/* ── Personal layer cards ──────────────────────────────────────────────── */
export function PersonalLayer() {
  const ds = useData((d) => d);
  const store = useStore();
  const me = useData((_, s) => s.me);
  const toast = useToast();
  const p = me.personalization;
  const today = todayIso();

  const daily = useMemo(
    () => [...ds.shared_daily].sort((a, b) => b.date.localeCompare(a.date))[0],
    [ds.shared_daily],
  );
  const [caption, setCaption] = useState('');

  const lifeOpen = ds.life_admin.filter((l) => l.user_id === me.id && !l.completed);
  const upcoming = [...ds.fixed_dates]
    .map((f) => ({ ...f, d: daysUntil(f.date, today) }))
    .filter((f) => f.d >= 0)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);

  const money = ds.ledger.reduce(
    (a, l) => (l.direction === 'in' ? { ...a, in: a.in + l.amount } : { ...a, out: a.out + l.amount }),
    { in: 0, out: 0 },
  );
  const unsettled = ds.ledger.filter((l) => l.status !== 'paid').length;

  const cards: React.ReactNode[] = [];

  if (p.song) {
    cards.push(
      <motion.div className="pcard2" key="song" variants={staggerItem} {...lift}>
        <div className="eyebrow">
          {daily ? `Picked by ${ds.profiles.find((x) => x.id === daily.picked_by)?.name ?? 'us'}` : 'Between us'}
        </div>
        <h4>Song of the day</h4>
        <div className="songart">
          {daily ? `${daily.song_title} · ${daily.song_artist}` : 'Nothing picked yet'}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
          {daily?.song_url && (
            <a className="btn sm" href={daily.song_url} target="_blank" rel="noreferrer">
              Play
            </a>
          )}
          <Link className="btn sm" to="/us">
            Suggest one
          </Link>
        </div>
      </motion.div>,
    );
  }

  if (p.photo) {
    cards.push(
      <motion.div className="pcard2" key="photo" variants={staggerItem} {...lift}>
        <div className="eyebrow">Between us</div>
        <h4>Photo of the day</h4>
        <div className="photobox">
          {daily?.photo_url ? (
            <img src={daily.photo_url} alt={daily.photo_caption ?? 'Photo of the day'} loading="lazy" />
          ) : (
            'A coffee, a screenshot, a ridiculous moment — anything.'
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--slate)', marginTop: 6, minHeight: 18 }}>
          {daily?.photo_caption}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <input
            className="srch"
            value={caption}
            placeholder="Paste a caption…"
            aria-label="Photo caption"
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !caption.trim() || !daily) return;
              store.update(
                'shared_daily',
                daily.id,
                { photo_caption: caption.trim() },
                store.asMe({ summary: 'Photo caption updated' }),
              );
              setCaption('');
              toast('Caption saved');
            }}
          />
          <button
            className="btn sm"
            disabled={!caption.trim() || !daily}
            onClick={() => {
              if (!caption.trim() || !daily) return;
              store.update(
                'shared_daily',
                daily.id,
                { photo_caption: caption.trim() },
                store.asMe({ summary: 'Photo caption updated' }),
              );
              setCaption('');
              toast('Caption saved');
            }}
          >
            Save
          </button>
        </div>
      </motion.div>,
    );
  }

  if (p.worth_knowing) {
    cards.push(
      <motion.div className="pcard2" key="ai" variants={staggerItem} {...lift}>
        <div className="eyebrow">AI pulse · three, not a feed</div>
        <h4>Worth knowing</h4>
        {AI_PULSE.map((x) => (
          <div className="aiitem" key={x.t}>
            <b style={{ fontWeight: 500 }}>{x.t}</b>
            <span>{x.s}</span>
          </div>
        ))}
      </motion.div>,
    );
  }

  if (p.life_radar) {
    cards.push(
      <motion.div className="pcard2" key="life" variants={staggerItem} {...lift}>
        <div className="eyebrow">Life radar</div>
        <h4>Small things future-you will thank you for</h4>
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
        <div className="eyebrow" style={{ marginTop: 12 }}>Fixed dates</div>
        {upcoming.map((f) => (
          <div className="mini-row" key={f.id}>
            <span>{f.label}</span>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--mute)' }}>
              {fmtDay(f.date)} · {f.d}d
            </span>
          </div>
        ))}
      </motion.div>,
    );
  }

  if (p.money_on_home) {
    cards.push(
      <motion.div className="pcard2" key="money" variants={staggerItem} {...lift}>
        <div className="eyebrow">Money · the short version</div>
        <h4>In and out</h4>
        <div className="mini-row">
          <span>Received</span>
          <span className="mono" style={{ color: 'var(--teal)' }}>
            <CountUp value={money.in} format={(n) => inr(n)} />
          </span>
        </div>
        <div className="mini-row">
          <span>Spent</span>
          <span className="mono">
            <CountUp value={money.out} format={(n) => inr(n)} />
          </span>
        </div>
        <div className="mini-row">
          <span>Unsettled entries</span>
          <span className="mono" style={{ color: unsettled ? 'var(--stamp)' : 'var(--mute)' }}>
            <CountUp value={unsettled} />
          </span>
        </div>
        <Link className="btn sm" to="/money" style={{ marginTop: 10, display: 'inline-block' }}>
          Open Money
        </Link>
      </motion.div>,
    );
  }

  if (!cards.length) return null;

  return (
    <motion.div className="pgrid" variants={staggerList} initial="initial" animate="animate">
      {cards}
    </motion.div>
  );
}

/* ── Projects strip + on-demand snapshot ───────────────────────────────── */
export function ProjectsStrip() {
  const ds = useData((d) => d);
  const [snap, setSnap] = useState<string | null>(null);
  const today = todayIso();

  const rows = ds.projects.map((pj) => {
    const all = ds.tasks.filter((t) => t.project_id === pj.id);
    const open = all.filter((t) => t.status !== 'done');
    const urgent = open.filter((t) => t.priority === 'urgent').length;
    const dec = ds.decisions.filter((d) => d.project_id === pj.id && d.status === 'open').length;
    const pct = all.length ? Math.round(((all.length - open.length) / all.length) * 100) : 0;
    return { pj, openCount: open.length, urgent, dec, pct };
  });

  const project = snap ? ds.projects.find((p) => p.id === snap) : undefined;
  const snapOpen = snap ? ds.tasks.filter((t) => t.project_id === snap && t.status !== 'done') : [];
  const snapRanked = snap
    ? rankTasks(ds, today).filter((r) => r.task.project_id === snap).slice(0, 5)
    : [];
  const snapDecs = snap ? ds.decisions.filter((d) => d.project_id === snap && d.status === 'open') : [];
  const snapLedger = snap
    ? [...ds.ledger].filter((l) => l.project_id === snap).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3)
    : [];

  return (
    <>
      <div className="frame">
        <div className="top">
          <div className="disp" style={{ fontSize: 14 }}>Your projects</div>
          <div className="spacer" />
          <span className="eyebrow">a peek — tap for a snapshot</span>
        </div>
        <div className="wrap" style={{ padding: '14px 16px' }}>
          <motion.div
            className="filters"
            style={{ margin: 0 }}
            variants={staggerList}
            initial="initial"
            animate="animate"
          >
            {rows.map(({ pj, openCount, urgent, dec, pct }) => (
              <motion.button
                key={pj.id}
                className="chip pjchip"
                variants={staggerItem}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                style={{ borderLeft: `3px solid ${pj.color}` }}
                onClick={() => setSnap(pj.id)}
              >
                <span className="hd">
                  <b style={{ fontWeight: 600, color: 'var(--ink)' }}>{pj.name}</b>
                  <span>
                    <CountUp value={openCount} /> open
                  </span>
                  {urgent > 0 && <span style={{ color: 'var(--rose)' }}>{urgent} urgent</span>}
                  {dec > 0 && <span>{dec} to rule</span>}
                </span>
                <ProgressBar pct={pct} grad={`linear-gradient(90deg, ${pj.color}, var(--indigo))`} />
              </motion.button>
            ))}
          </motion.div>
        </div>
      </div>

      <Modal open={!!snap} onClose={() => setSnap(null)} title={project ? `${project.name} · snapshot` : ''}>
        {project && (
          <>
            <p className="tip" style={{ margin: '-6px 0 14px' }}>
              {snapOpen.length} open · {snapDecs.length} decision{snapDecs.length === 1 ? '' : 's'} waiting
            </p>
            <div className="eyebrow">Open here, in ranked order</div>
            {snapRanked.length === 0 && <p className="tip">Nothing open, or nothing ranked (personal work never enters the ranking).</p>}
            {snapRanked.map((r) => (
              <Link
                key={r.task.id}
                to={`/task/${r.task.id}`}
                onClick={() => setSnap(null)}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  padding: '9px 0',
                  borderBottom: '1px dashed var(--line)',
                  color: 'inherit',
                  textDecoration: 'none',
                  minHeight: 44,
                }}
              >
                <span style={{ flex: 1, minWidth: 160 }}>
                  <b style={{ fontWeight: 500 }}>{r.task.title}</b>
                  <span className="mono" style={{ display: 'block', fontSize: 10.5, color: 'var(--mute)' }}>
                    {r.task.id} · score {r.score}
                    {r.task.due_date ? ` · due ${fmtDay(r.task.due_date)}` : ''}
                  </span>
                </span>
                {r.task.tags.map((t) => (
                  <TagChip key={t} name={t} />
                ))}
              </Link>
            ))}
            {snapOpen.length > 0 && snapRanked.length === 0 && (
              <p className="tip">
                {snapOpen.map((t) => t.title).join(' · ')}
              </p>
            )}

            {snapDecs.length > 0 && (
              <>
                <div className="eyebrow" style={{ marginTop: 16 }}>Waiting on a ruling</div>
                {snapDecs.map((d) => (
                  <p key={d.id} style={{ fontSize: 13, margin: '7px 0' }}>
                    {d.question}
                  </p>
                ))}
              </>
            )}

            {snapLedger.length > 0 && (
              <>
                <div className="eyebrow" style={{ marginTop: 16 }}>Last money here</div>
                {snapLedger.map((l) => (
                  <div className="mini-row" key={l.id}>
                    <span>
                      {l.party} <span className={`pill ${l.status}`}>{l.status}</span>
                    </span>
                    <span className="mono" style={{ color: l.direction === 'in' ? 'var(--teal)' : 'inherit' }}>
                      {l.direction === 'in' ? '+' : '−'}
                      {inr(l.amount)}
                    </span>
                  </div>
                ))}
              </>
            )}

            <div style={{ display: 'flex', gap: 9, justifyContent: 'flex-end', marginTop: 16, flexWrap: 'wrap' }}>
              <Link className="btn sm" to="/work" onClick={() => setSnap(null)}>
                Open on the board
              </Link>
              <button className="btn solid" onClick={() => setSnap(null)}>
                Done
              </button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
