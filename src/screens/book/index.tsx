/**
 * /book/:slug — the page a stranger opens to book time with one of you.
 *
 * Works with nobody signed in: it never touches the store, the router or the
 * shared Supabase client, only the public `book` function. Mount it OUTSIDE
 * the sign-in gate (see the lead's wiring note in BookingSettings).
 *
 * Flow: length → day → time → your details → done. Times are shown in the
 * GUEST's zone, with the host's zone named, because the guest is the one who
 * has to turn up. When a slot is taken between loading and submitting, the
 * server says so (409), the slots reload, and the guest picks again — nothing
 * is ever moved to a "nearby" time on their behalf.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CAPS, formatTime, groupByGuestDay, validateGuest, type Slot } from '../../lib/booking';
import { micro, pageRise, staggerParent, staggerItem } from '../../ui/motion';
import { BookError, fetchPage, submitBooking, type BookedReply, type PublicPage } from './api';
import './book.css';

type Step = 'pick' | 'form' | 'done';

const guestZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const slugFromPath = () => {
  if (typeof window === 'undefined') return '';
  const m = window.location.pathname.match(/\/book\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]).toLowerCase() : '';
};

const dayLabel = (isoDate: string) => {
  const d = new Date(`${isoDate}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' }).format(d),
    day: new Intl.DateTimeFormat(undefined, { day: 'numeric', timeZone: 'UTC' }).format(d),
    month: new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(d),
    long: new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d),
  };
};

const longWhen = (iso: string, zone: string) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

const lengthLabel = (min: number) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`);

const zoneName = (zone: string) => zone.replace(/_/g, ' ');

export default function BookPage({ slug: slugProp }: { slug?: string }) {
  const slug = (slugProp ?? slugFromPath()).toLowerCase();
  const reduced = useReducedMotion();
  const zone = useMemo(guestZone, []);

  const [page, setPage] = useState<PublicPage | null>(null);
  const [loadError, setLoadError] = useState<BookError | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const [duration, setDuration] = useState<number | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [step, setStep] = useState<Step>('pick');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [booked, setBooked] = useState<BookedReply | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const p = await fetchPage(slug);
      setPage(p);
      setDuration((d) => (d && p.durations.includes(d) ? d : p.durations[0] ?? null));
    } catch (err) {
      setLoadError(err instanceof BookError ? err : new BookError('server', 'Something went wrong.'));
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (!slug) {
      setLoading(false);
      setLoadError(new BookError('not_found', 'This booking link is incomplete.'));
      return;
    }
    void load();
  }, [slug, load]);

  useEffect(() => {
    if (page) document.title = `${page.title} · ${page.host}`;
  }, [page]);

  const days = useMemo(() => {
    if (!page || duration == null) return [];
    return groupByGuestDay(page.slots[String(duration)] ?? [], zone);
  }, [page, duration, zone]);

  // Keep the chosen day valid when the length or the slot list changes.
  useEffect(() => {
    if (!days.length) return setDay(null);
    if (!day || !days.some((d) => d.date === day)) setDay(days[0].date);
  }, [days, day]);

  const daySlots = days.find((d) => d.date === day)?.slots ?? [];

  const choose = (s: Slot) => {
    setSlot(s);
    setFormError(null);
    setStep('form');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slot || duration == null || sending) return;
    const v = validateGuest({ name, email, note });
    if (!v.ok) return setFormError(v.error);
    setSending(true);
    setFormError(null);
    try {
      const reply = await submitBooking({ slug, start: slot.start, duration, ...v.value });
      setBooked(reply);
      setStep('done');
    } catch (err) {
      const be = err instanceof BookError ? err : new BookError('server', 'Something went wrong.');
      if (be.code === 'slot_taken') {
        // Never pick a replacement for them — reload and let them choose.
        setSlot(null);
        setStep('pick');
        setNotice(be.message);
        await load();
      } else {
        setFormError(be.message);
      }
    } finally {
      setSending(false);
    }
  };

  const tap = reduced ? {} : { whileTap: { scale: 0.97 } };
  const stepMotion = reduced
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 0, transition: { duration: 0 } } }
    : { variants: pageRise, initial: 'initial', animate: 'animate', exit: 'exit' };

  /* ── states ─────────────────────────────────────────────────────── */

  if (loading && !page) {
    return (
      <main className="bk-shell" aria-busy="true" aria-label="Loading booking page">
        <div className="bk-card">
          <div className="skel" style={{ height: 14, width: 90 }} />
          <div className="skel" style={{ height: 30, width: '70%', marginTop: 12 }} />
          <div className="bk-row" style={{ marginTop: 22 }}>
            {[0, 1, 2].map((i) => <div key={i} className="skel" style={{ height: 44, width: 84 }} />)}
          </div>
          <div className="bk-row" style={{ marginTop: 16 }}>
            {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel" style={{ height: 64, width: 60 }} />)}
          </div>
          <div className="bk-slots" style={{ marginTop: 16 }}>
            {Array.from({ length: 8 }, (_, i) => <div key={i} className="skel" style={{ height: 44 }} />)}
          </div>
        </div>
      </main>
    );
  }

  if (loadError || !page) {
    const err = loadError ?? new BookError('server', 'Something went wrong.');
    return (
      <main className="bk-shell">
        <div className="bk-card bk-center">
          <p className="eyebrow">ORRA</p>
          <h1 className="bk-title">{err.code === 'not_found' ? 'This page is not open' : 'Could not load times'}</h1>
          <p className="bk-sub">{err.message}</p>
          {err.code !== 'not_found' && err.code !== 'unconfigured' && (
            <motion.button type="button" className="btn solid bk-btn" onClick={() => void load()} {...tap}>
              Try again
            </motion.button>
          )}
        </div>
      </main>
    );
  }

  const sameZone = zone === page.timeZone;

  return (
    <main className="bk-shell">
      <div className="bk-card">
        <header className="bk-head">
          <p className="eyebrow">Book with {page.host}</p>
          <h1 className="bk-title">{page.title}</h1>
          <p className="bk-zone">
            Times in your zone, <strong>{zoneName(zone)}</strong>
            {!sameZone && <> · {page.host} is in {zoneName(page.timeZone)}</>}
          </p>
        </header>

        <AnimatePresence mode="wait" initial={false}>
          {step === 'pick' && (
            <motion.section key="pick" {...stepMotion} aria-label="Choose a time">
              <AnimatePresence>
                {notice && (
                  <motion.p
                    className="bk-notice"
                    role="alert"
                    initial={reduced ? false : { opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0, transition: micro }}
                    exit={{ opacity: 0, transition: micro }}
                  >
                    {notice}
                    <button type="button" className="bk-x" aria-label="Dismiss" onClick={() => setNotice(null)}>
                      ×
                    </button>
                  </motion.p>
                )}
              </AnimatePresence>

              {page.durations.length > 1 && (
                <div className="bk-block">
                  <h2 className="bk-h2">How long?</h2>
                  <div className="bk-row" role="radiogroup" aria-label="Meeting length">
                    {page.durations.map((d) => (
                      <motion.button
                        key={d}
                        type="button"
                        role="radio"
                        aria-checked={d === duration}
                        className="bk-chip"
                        onClick={() => setDuration(d)}
                        {...tap}
                      >
                        {lengthLabel(d)}
                      </motion.button>
                    ))}
                  </div>
                </div>
              )}

              {days.length === 0 ? (
                <div className="bk-empty">
                  <p>No open times in the next few weeks.</p>
                  <p className="bk-sub">Try again later — {page.host} may free some up.</p>
                  <motion.button type="button" className="btn bk-btn" onClick={() => void load()} {...tap}>
                    Check again
                  </motion.button>
                </div>
              ) : (
                <div className="bk-pick">
                  <div className="bk-block">
                    <h2 className="bk-h2">Day</h2>
                    <div className="bk-days" role="radiogroup" aria-label="Day">
                      {days.map((d) => {
                        const l = dayLabel(d.date);
                        return (
                          <motion.button
                            key={d.date}
                            type="button"
                            role="radio"
                            aria-checked={d.date === day}
                            aria-label={`${l.long}, ${d.slots.length} times`}
                            className="bk-day"
                            onClick={() => setDay(d.date)}
                            {...tap}
                          >
                            <span className="bk-day-wd">{l.weekday}</span>
                            <span className="bk-day-n">{l.day}</span>
                            <span className="bk-day-m">{l.month}</span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="bk-block">
                    <h2 className="bk-h2">{day ? dayLabel(day).long : 'Time'}</h2>
                    <motion.ul key={`${duration}-${day}`} className="bk-slots" {...(reduced ? {} : staggerParent())}>
                      {daySlots.map((s) => (
                        <motion.li key={s.start} variants={reduced ? undefined : staggerItem}>
                          <motion.button type="button" className="bk-slot" onClick={() => choose(s)} {...tap}>
                            {formatTime(s.start, zone)}
                          </motion.button>
                        </motion.li>
                      ))}
                    </motion.ul>
                  </div>
                </div>
              )}
            </motion.section>
          )}

          {step === 'form' && slot && duration != null && (
            <motion.section key="form" {...stepMotion} aria-label="Your details">
              <div className="bk-picked">
                <div>
                  <p className="bk-picked-when">{longWhen(slot.start, zone)}</p>
                  <p className="bk-sub">
                    {lengthLabel(duration)}
                    {!sameZone && <> · {formatTime(slot.start, page.timeZone)} for {page.host}</>}
                  </p>
                </div>
                <motion.button type="button" className="btn bk-btn" onClick={() => setStep('pick')} {...tap}>
                  Change
                </motion.button>
              </div>

              <form className="bk-form" onSubmit={submit} noValidate>
                <label>
                  Your name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={CAPS.name}
                    autoComplete="name"
                    required
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    maxLength={CAPS.email}
                    autoComplete="email"
                    required
                  />
                </label>
                <label>
                  What is it about? <span className="bk-opt">optional</span>
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={CAPS.note} rows={4} />
                  <span className="bk-count" aria-live="polite">
                    {note.length}/{CAPS.note}
                  </span>
                </label>
                <AnimatePresence>
                  {formError && (
                    <motion.p
                      className="bk-error"
                      role="alert"
                      initial={reduced ? false : { opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0, transition: micro }}
                      exit={{ opacity: 0, transition: micro }}
                    >
                      {formError}
                    </motion.p>
                  )}
                </AnimatePresence>
                <motion.button type="submit" className="btn solid bk-btn bk-submit" disabled={sending} aria-busy={sending} {...tap}>
                  {sending ? 'Sending…' : 'Request this time'}
                </motion.button>
                <p className="bk-fine">
                  Your name, email and note go only to {page.host}. The time is held as a request until they confirm it.
                </p>
              </form>
            </motion.section>
          )}

          {step === 'done' && booked && (
            <motion.section key="done" {...stepMotion} className="bk-center" aria-live="polite">
              <motion.div
                className="bk-tick"
                aria-hidden
                initial={reduced ? false : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 30 }}
              >
                ✓
              </motion.div>
              <h2 className="bk-title">Request sent</h2>
              <p className="bk-picked-when">{longWhen(booked.start, zone)}</p>
              <p className="bk-sub">
                {booked.host} has it on their calendar and will confirm with you at <strong>{email.trim()}</strong>.
                Until then it is a request, not a confirmed meeting.
              </p>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
      <p className="bk-foot">Scheduling by ORRA</p>
    </main>
  );
}
