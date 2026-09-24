/**
 * Your booking page — the settings card.
 *
 * Creates and edits the signed-in person's booking_pages row through the
 * store, shows the public link and the ICS busy-feed URL, and lists upcoming
 * requests with Confirm / Decline.
 *
 * Wiring (for whoever mounts it): drop <BookingSettings /> into a Personal
 * card; it needs the store and ToastProvider, nothing else. The public page
 * it links to is src/screens/book (route /book/:slug, outside the gate).
 *
 * Bookings are written only by the `book` edge function, so the table has no
 * INSERT grant for signed-in users — which also rules out the adapter's
 * upsert. Status changes therefore go straight to Supabase as an UPDATE,
 * then land in the store with applyRemote and an audit note. The calendar
 * block is changed through the store as usual.
 *
 * Nothing here moves a date. Decline and cancel remove the block only after
 * an explicit second tap that says so.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { newId, nowIso, useData, useStore } from '../../data/store';
import type { Booking, BookingPage } from '../../types';
import { getSupabase, supabaseConfigured } from '../../lib/supabaseClient';
import { CAPS, DEFAULT_RULES, SLUG_RE, isValidTimeZone } from '../../lib/booking';
import { useToast } from '../../ui/bits';
import { micro, staggerItem, staggerParent } from '../../ui/motion';
import '../book/book.css';

const LENGTHS = [15, 20, 30, 45, 60, 90];
const DAYS: [number, string][] = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
];
const BUFFERS = [0, 5, 10, 15, 30];
const NOTICES: [number, string][] = [
  [0, 'None'],
  [60, '1 hour'],
  [120, '2 hours'],
  [240, '4 hours'],
  [720, '12 hours'],
  [1440, '1 day'],
  [2880, '2 days'],
];
const HORIZONS = [7, 14, 21, 30, 60];

const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const toClock = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fromClock = (v: string) => {
  const [h, m] = v.split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
};

/** 256 random bits, hex. The feed URL is a bearer secret. */
function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const suggestSlug = (name: string) => {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return base.length >= 3 ? base : `meet-${base || 'orra'}`.slice(0, 40);
};

const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type Draft = Pick<
  BookingPage,
  'slug' | 'title' | 'durations' | 'work_start_min' | 'work_end_min' | 'work_days' | 'buffer_min' | 'min_notice_min' | 'horizon_days'
>;

const draftOf = (p: BookingPage): Draft => ({
  slug: p.slug,
  title: p.title,
  durations: [...p.durations],
  work_start_min: p.work_start_min,
  work_end_min: p.work_end_min,
  work_days: [...p.work_days],
  buffer_min: p.buffer_min,
  min_notice_min: p.min_notice_min,
  horizon_days: p.horizon_days,
});

function validateDraft(d: Draft, others: BookingPage[]): string | null {
  if (!SLUG_RE.test(d.slug)) return 'The link name needs 3–40 lowercase letters, numbers or dashes.';
  if (others.some((p) => p.slug === d.slug)) return 'That link name is already taken.';
  if (!d.title.trim() || d.title.trim().length > CAPS.title) return `The title needs 1–${CAPS.title} characters.`;
  if (!d.durations.length) return 'Offer at least one meeting length.';
  if (!(d.work_end_min > d.work_start_min)) return 'Hours must end after they start.';
  if (d.work_end_min - d.work_start_min < Math.min(...d.durations)) return 'Your hours are shorter than your shortest meeting.';
  return null;
}

export default function BookingSettings() {
  const store = useStore();
  const toast = useToast();
  const reduced = useReducedMotion();
  const meId = useData((_, s) => s.meId);
  const pages = useData((ds) => ds.booking_pages);
  const allBookings = useData((ds) => ds.bookings);
  const page = pages.find((p) => p.user_id === meId) ?? null;
  const tap = reduced ? {} : { whileTap: { scale: 0.97 } };

  const [draft, setDraft] = useState<Draft | null>(page ? draftOf(page) : null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [armed, setArmed] = useState<string | null>(null); // booking id, or 'rotate'
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Re-seed the draft when the page arrives or changes underneath us.
  useEffect(() => {
    if (page) setDraft(draftOf(page));
  }, [page?.id, page?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const zone = page?.time_zone && isValidTimeZone(page.time_zone) ? page.time_zone : store.me.time_zone;
  const here = browserZone();

  /* ── bookings: pull fresh, since guests write them while you are away ── */
  const refresh = useCallback(async () => {
    if (!supabaseConfigured()) return;
    setRefreshing(true);
    try {
      const sb = await getSupabase();
      const { data, error: err } = await sb.from('bookings').select('*').order('start_at');
      if (err) throw err;
      const rows = (data ?? []) as Booking[];
      store.applyRemote({ bookings: rows });
      // Their calendar blocks were written server-side too; bring any the
      // store has not seen, so Confirm/Decline can change them.
      const known = new Set(store.ds.day_events.map((e) => e.id));
      const missing = rows.map((b) => b.day_event_id).filter((id): id is string => !!id && !known.has(id));
      if (missing.length) {
        const { data: evs } = await sb.from('day_events').select('*').in('id', missing);
        if (evs?.length) store.applyRemote({ day_events: [...store.ds.day_events, ...(evs as typeof store.ds.day_events)] });
      }
    } catch {
      toast('Could not check for new bookings');
    } finally {
      setRefreshing(false);
    }
  }, [store, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upcoming = useMemo(() => {
    const now = Date.now();
    return allBookings
      .filter((b) => b.host_id === meId && (b.status === 'pending' || b.status === 'confirmed') && Date.parse(b.end_at) > now)
      .sort((a, b) => a.start_at.localeCompare(b.start_at));
  }, [allBookings, meId]);

  /* ── page create / save ─────────────────────────────────────────── */

  const create = async () => {
    setCreating(true);
    setError(null);
    const taken = new Set(pages.map((p) => p.slug));
    let slug = suggestSlug(store.me.name);
    for (let i = 2; taken.has(slug); i++) slug = `${suggestSlug(store.me.name).slice(0, 36)}-${i}`;
    const row: BookingPage = {
      id: newId('bp'),
      user_id: meId,
      slug,
      title: 'Book a call',
      is_active: false,
      ...DEFAULT_RULES,
      time_zone: here,
      ics_token: randomToken(),
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    try {
      await store.insertConfirmed('booking_pages', row, store.asMe({ summary: 'Booking page created' }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const dirty = !!page && !!draft && JSON.stringify(draftOf(page)) !== JSON.stringify(draft);

  const save = () => {
    if (!page || !draft) return;
    const problem = validateDraft(draft, pages.filter((p) => p.id !== page.id));
    if (problem) return setError(problem);
    setError(null);
    store.update(
      'booking_pages',
      page.id,
      { ...draft, title: draft.title.trim(), durations: [...draft.durations].sort((a, b) => a - b), work_days: [...draft.work_days].sort() },
      store.asMe(),
    );
    toast('Booking page saved');
  };

  const setActive = (on: boolean) => {
    if (!page) return;
    if (on && dirty) return setError('Save your changes before opening the page.');
    store.update('booking_pages', page.id, { is_active: on }, store.asMe());
    toast(on ? 'Your booking page is open' : 'Your booking page is closed');
  };

  const applyHereZone = () => page && store.update('booking_pages', page.id, { time_zone: here }, store.asMe());

  const rotate = () => {
    if (!page) return;
    store.update('booking_pages', page.id, { ics_token: randomToken() }, store.asMe({ summary: 'Busy feed link replaced' }));
    setArmed(null);
    toast('New feed link made — the old one has stopped working');
  };

  /* ── booking decisions ──────────────────────────────────────────── */

  const setStatus = async (b: Booking, status: Booking['status']): Promise<boolean> => {
    if (supabaseConfigured()) {
      const sb = await getSupabase();
      const { error: err } = await sb.from('bookings').update({ status }).eq('id', b.id);
      if (err) {
        toast(`Could not update the booking — ${err.message}`);
        return false;
      }
      store.applyRemote({ bookings: store.ds.bookings.map((x) => (x.id === b.id ? { ...x, status } : x)) });
      store.note('booking', `Booking ${status}: ${b.guest_name}, ${when(b.start_at)}`, store.asMe());
    } else {
      store.update('bookings', b.id, { status }, store.asMe({ summary: `Booking ${status}` }));
    }
    return true;
  };

  const confirmBooking = async (b: Booking) => {
    setBusyId(b.id);
    if (await setStatus(b, 'confirmed')) {
      if (b.day_event_id && store.ds.day_events.some((e) => e.id === b.day_event_id)) {
        store.update('day_events', b.day_event_id, { confirmed_at: nowIso() }, store.asMe({ silent: true }));
      }
      toast(`Confirmed — let ${b.guest_name} know`);
    }
    setBusyId(null);
  };

  const releaseBooking = async (b: Booking) => {
    setBusyId(b.id);
    setArmed(null);
    const status = b.status === 'confirmed' ? 'cancelled' : 'declined';
    if (await setStatus(b, status)) {
      if (b.day_event_id && store.ds.day_events.some((e) => e.id === b.day_event_id)) {
        const { error: err } = await store.removeManyConfirmed('day_events', [b.day_event_id], store.asMe({ summary: `Booking ${status}` }));
        if (err) toast(`Booking ${status}, but the calendar block stayed — ${err}`);
      }
      toast(status === 'declined' ? 'Declined and removed from your calendar' : 'Cancelled and removed from your calendar');
    }
    setBusyId(null);
  };

  /* ── render ─────────────────────────────────────────────────────── */

  if (!page || !draft) {
    return (
      <section className="bks" aria-label="Booking page">
        <div>
          <p className="eyebrow">Booking page</p>
          <h3 style={{ margin: '4px 0 6px', fontSize: 17 }}>Let people book time with you</h3>
          <p className="bks-hint">
            A public link where someone outside ORRA picks a free slot. It reads your calendar, never shows what is on it,
            and every request waits for your yes.
          </p>
        </div>
        {error && <p className="bk-error" role="alert">{error}</p>}
        <div className="bks-actions">
          <motion.button type="button" className="btn solid" onClick={() => void create()} disabled={creating} {...tap}>
            {creating ? 'Setting up…' : 'Set up my booking page'}
          </motion.button>
        </div>
      </section>
    );
  }

  const base = typeof window !== 'undefined' ? window.location.origin : '';
  const publicUrl = `${base}/book/${page.slug}`;
  const supaUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
  const icsUrl = supaUrl ? `${supaUrl}/functions/v1/ics?token=${page.ics_token}` : null;
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const toggleIn = (list: number[], v: number) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <section className="bks" aria-label="Booking page">
      <div className="bks-head">
        <div>
          <p className="eyebrow">Booking page</p>
          <h3 style={{ margin: '4px 0 0', fontSize: 17 }}>{page.is_active ? 'Open for bookings' : 'Closed'}</h3>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={page.is_active}
          aria-label="Accept bookings"
          className="bks-switch"
          onClick={() => setActive(!page.is_active)}
        >
          <span className="bks-track" aria-hidden>
            <motion.span className="bks-knob" layout transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 30 }} />
          </span>
        </button>
      </div>

      {/* ── links ── */}
      <div className="bks-link">
        <span className="eyebrow">Public link</span>
        <code>{publicUrl}</code>
        <div className="bks-actions">
          <motion.button
            type="button"
            className="btn sm"
            onClick={async () => toast((await copy(publicUrl)) ? 'Link copied' : 'Copy failed — select the link instead')}
            {...tap}
          >
            Copy link
          </motion.button>
          {!page.is_active && <p className="bks-hint" style={{ alignSelf: 'center' }}>Switch on to let people use it.</p>}
        </div>
      </div>

      {icsUrl && (
        <div className="bks-link">
          <span className="eyebrow">Busy feed for Google Calendar</span>
          <code>{icsUrl}</code>
          <p className="bks-hint">
            Google Calendar → Other calendars → <strong>From URL</strong> → paste this. Google then sees your ORRA blocks as
            busy, even with ORRA closed. It shows only "Busy (ORRA)", never titles. Treat the link like a password; Google
            refreshes it every few hours.
          </p>
          <div className="bks-actions">
            <motion.button
              type="button"
              className="btn sm"
              onClick={async () => toast((await copy(icsUrl)) ? 'Feed link copied' : 'Copy failed — select the link instead')}
              {...tap}
            >
              Copy feed link
            </motion.button>
            {armed === 'rotate' ? (
              <>
                <motion.button type="button" className="btn sm danger" onClick={rotate} {...tap}>
                  Yes, replace it
                </motion.button>
                <motion.button type="button" className="btn sm" onClick={() => setArmed(null)} {...tap}>
                  Keep
                </motion.button>
              </>
            ) : (
              <motion.button type="button" className="btn sm" onClick={() => setArmed('rotate')} {...tap}>
                Replace link…
              </motion.button>
            )}
          </div>
        </div>
      )}

      {/* ── rules ── */}
      <div className="bks-form">
        <div className="bks-pair">
          <label>
            Title guests see
            <input value={draft.title} maxLength={CAPS.title} onChange={(e) => set({ title: e.target.value })} />
          </label>
          <label>
            Link name
            <input
              value={draft.slug}
              maxLength={40}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
            />
          </label>
        </div>

        <div>
          <p className="bk-h2">Meeting lengths</p>
          <div className="bk-row" role="group" aria-label="Meeting lengths">
            {LENGTHS.map((m) => (
              <motion.button
                key={m}
                type="button"
                className="bk-chip"
                role="checkbox"
                aria-checked={draft.durations.includes(m)}
                onClick={() => set({ durations: toggleIn(draft.durations, m) })}
                {...tap}
              >
                {m} min
              </motion.button>
            ))}
          </div>
        </div>

        <div>
          <p className="bk-h2">Days</p>
          <div className="bk-row" role="group" aria-label="Days">
            {DAYS.map(([n, l]) => (
              <motion.button
                key={n}
                type="button"
                className="bk-chip"
                role="checkbox"
                aria-checked={draft.work_days.includes(n)}
                onClick={() => set({ work_days: toggleIn(draft.work_days, n) })}
                {...tap}
              >
                {l}
              </motion.button>
            ))}
          </div>
        </div>

        <div className="bks-pair">
          <label>
            From
            <input
              type="time"
              step={900}
              value={toClock(draft.work_start_min)}
              onChange={(e) => {
                const v = fromClock(e.target.value);
                if (Number.isFinite(v)) set({ work_start_min: v });
              }}
            />
          </label>
          <label>
            Until
            <input
              type="time"
              step={900}
              value={toClock(draft.work_end_min === 1440 ? 1439 : draft.work_end_min)}
              onChange={(e) => {
                const v = fromClock(e.target.value);
                if (Number.isFinite(v)) set({ work_end_min: v === 1439 ? 1440 : v });
              }}
            />
          </label>
        </div>

        <div className="bks-pair">
          <label>
            Gap around meetings
            <select value={draft.buffer_min} onChange={(e) => set({ buffer_min: Number(e.target.value) })}>
              {BUFFERS.map((b) => (
                <option key={b} value={b}>
                  {b ? `${b} min` : 'None'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Minimum notice
            <select value={draft.min_notice_min} onChange={(e) => set({ min_notice_min: Number(e.target.value) })}>
              {NOTICES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            How far ahead
            <select value={draft.horizon_days} onChange={(e) => set({ horizon_days: Number(e.target.value) })}>
              {HORIZONS.map((h) => (
                <option key={h} value={h}>
                  {h} days
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="bks-hint">
          Hours are in <strong>{zone.replace(/_/g, ' ')}</strong>.
        </p>
        {zone !== here && (
          <div className="bks-actions">
            <p className="bks-warn">This device is in {here.replace(/_/g, ' ')}. Your calendar blocks are saved in the zone you made them in.</p>
            <motion.button type="button" className="btn sm" onClick={applyHereZone} {...tap}>
              Use {here.replace(/_/g, ' ')}
            </motion.button>
          </div>
        )}

        <AnimatePresence>
          {error && (
            <motion.p
              className="bk-error"
              role="alert"
              initial={reduced ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0, transition: micro }}
              exit={{ opacity: 0, transition: micro }}
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <div className="bks-actions">
          <motion.button type="button" className="btn solid" disabled={!dirty} onClick={save} {...tap}>
            Save
          </motion.button>
          {dirty && (
            <motion.button type="button" className="btn" onClick={() => { setDraft(draftOf(page)); setError(null); }} {...tap}>
              Discard changes
            </motion.button>
          )}
        </div>
      </div>

      {/* ── requests ── */}
      <div>
        <div className="bks-head" style={{ alignItems: 'center' }}>
          <p className="bk-h2" style={{ margin: 0 }}>
            Upcoming requests {upcoming.length > 0 && `(${upcoming.length})`}
          </p>
          {supabaseConfigured() && (
            <motion.button type="button" className="btn sm" style={{ minHeight: 44 }} onClick={() => void refresh()} disabled={refreshing} {...tap}>
              {refreshing ? 'Checking…' : 'Check for new'}
            </motion.button>
          )}
        </div>
        {upcoming.length === 0 ? (
          <p className="bks-hint" style={{ marginTop: 8 }}>
            Nothing booked yet.
          </p>
        ) : (
          <motion.ul className="bks-list" style={{ marginTop: 10 }} {...(reduced ? {} : staggerParent())}>
            {upcoming.map((b) => {
              const mins = Math.round((Date.parse(b.end_at) - Date.parse(b.start_at)) / 60_000);
              return (
                <motion.li key={b.id} className="bks-item" variants={reduced ? undefined : staggerItem} layout={!reduced}>
                  <div className="bks-item-top">
                    <strong>{b.guest_name}</strong>
                    <span className={`pill ${b.status === 'confirmed' ? 'ok' : 'soon'}`}>{b.status}</span>
                  </div>
                  <span>
                    {when(b.start_at)} · {mins} min
                  </span>
                  <a href={`mailto:${b.guest_email}`}>{b.guest_email}</a>
                  {b.note && <p className="bks-item-note">{b.note}</p>}
                  {armed === b.id ? (
                    <div className="bks-actions" role="group" aria-label="Confirm removal">
                      <p className="bks-warn" style={{ flexBasis: '100%' }}>
                        {b.status === 'confirmed' ? 'Cancel' : 'Decline'} and remove the block from your calendar? ORRA does
                        not email {b.guest_name} — tell them yourself.
                      </p>
                      <motion.button type="button" className="btn sm danger" disabled={busyId === b.id} onClick={() => void releaseBooking(b)} {...tap}>
                        Yes, {b.status === 'confirmed' ? 'cancel it' : 'decline'}
                      </motion.button>
                      <motion.button type="button" className="btn sm" onClick={() => setArmed(null)} {...tap}>
                        Keep it
                      </motion.button>
                    </div>
                  ) : (
                    <div className="bks-actions">
                      {b.status === 'pending' && (
                        <motion.button type="button" className="btn sm solid" disabled={busyId === b.id} onClick={() => void confirmBooking(b)} {...tap}>
                          Confirm
                        </motion.button>
                      )}
                      <motion.button type="button" className="btn sm" disabled={busyId === b.id} onClick={() => setArmed(b.id)} {...tap}>
                        {b.status === 'confirmed' ? 'Cancel…' : 'Decline…'}
                      </motion.button>
                    </div>
                  )}
                </motion.li>
              );
            })}
          </motion.ul>
        )}
        <p className="bks-hint" style={{ marginTop: 10 }}>
          ORRA does not email guests. Reply from your own inbox when you confirm or decline.
        </p>
      </div>
    </section>
  );
}
