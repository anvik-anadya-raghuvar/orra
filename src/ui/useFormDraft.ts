/**
 * The React half of src/lib/draft.ts — see that file for why drafts exist.
 *
 * One hook, three jobs: restore what was typed last time the moment a composer
 * opens, keep writing it as it changes, and get out of the way the instant the
 * draft becomes a real row.
 *
 * The load-bearing idea is "different from how it opened", not "not empty".
 * Composers open pre-filled — a New task starts on today's date, a normal
 * priority and you as the assignee; a Quick edit starts on the row as it
 * currently stands. Judging a draft by whether any field is non-blank calls
 * every one of those a draft, so an untouched sheet would save itself and then
 * offer, next time, to restore what you never typed. So the hook snapshots the
 * form the first time it sees a key — before restoring anything — and treats
 * that snapshot as the zero. A draft exists exactly when the form has moved
 * away from it, and stops existing the moment it moves back.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DRAFT_PREFIX, parseDraft, pickKnown, serialiseDraft } from '../lib/draft';

/** Debounce on the write. Long enough that typing a sentence is one write,
 *  short enough that closing the sheet mid-thought has already saved it. */
const WRITE_DELAY = 350;

export function useFormDraft<T extends Record<string, unknown>>(
  /** Stable per composer, and per row for an edit form — `work:quickedit:T-12`.
   *  Null while the composer is closed, which is what stops a shut sheet
   *  writing. */
  key: string | null,
  values: T,
  apply: (draft: Partial<T>) => void,
): { restored: boolean; clear: () => void } {
  const [restored, setRestored] = useState(false);
  /** The key whose draft has already been read, so a re-render never re-applies
   *  it over something typed since. */
  const seeded = useRef<string | null>(null);
  /** The form as it opened, serialised — the zero this draft is measured from. */
  const pristine = useRef<string | null>(null);
  /**
   * Set once the draft has become a real row, and cleared only when the
   * composer opens again.
   *
   * Submitting resets the fields, which is itself a change, and the debounced
   * write from just before the submit is still in flight — so without this the
   * composer would write a fresh draft on its way out and offer to restore it
   * next time. Checked inside the timeout rather than when scheduling it, so
   * an already-pending write is caught too.
   */
  const done = useRef(false);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const valuesRef = useRef(values);
  valuesRef.current = values;

  useEffect(() => {
    if (!key) {
      seeded.current = null;
      pristine.current = null;
      done.current = false;
      setRestored(false);
      return;
    }
    if (seeded.current === key) return;
    seeded.current = key;
    done.current = false;
    // Taken before the restore below, so it is genuinely the untouched form.
    pristine.current = JSON.stringify(valuesRef.current);
    setRestored(false);

    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(DRAFT_PREFIX + key);
    } catch {
      /* private mode, quota, a disabled store — a draft is a convenience */
      return;
    }
    const saved = parseDraft<Record<string, unknown>>(raw, Date.now());
    if (!saved) return;
    const known = pickKnown(saved, valuesRef.current);
    if (!Object.keys(known).length) return;
    // A stored draft that turns out to match the untouched form says nothing.
    // Restoring it would be a no-op with a notice attached.
    if (JSON.stringify({ ...valuesRef.current, ...known }) === pristine.current) return;
    applyRef.current(known);
    setRestored(true);
  }, [key]);

  /* Serialised rather than the object, because `values` is a fresh literal on
     every render — depending on it directly would reschedule the timer on
     every keystroke of every OTHER field in the sheet too. */
  const json = JSON.stringify(values);
  useEffect(() => {
    if (!key || seeded.current !== key) return;
    const t = window.setTimeout(() => {
      if (done.current) return;
      try {
        // Back to how it opened — whether by Start blank, by undoing the edit
        // by hand, or by the composer resetting after a successful save. There
        // is nothing unsaved left, so there is no draft.
        const body = json === pristine.current ? null : serialiseDraft(JSON.parse(json), new Date().toISOString());
        if (body) window.localStorage.setItem(DRAFT_PREFIX + key, body);
        else window.localStorage.removeItem(DRAFT_PREFIX + key);
      } catch {
        /* out of quota — the form still works, it just will not survive */
      }
    }, WRITE_DELAY);
    return () => window.clearTimeout(t);
  }, [key, json]);

  /**
   * The draft became a real row (or was deliberately abandoned).
   *
   * Deletes the stored copy and stops this composer writing another until it
   * is opened again — see `done` above for why that second half matters.
   */
  const clear = useCallback(() => {
    setRestored(false);
    done.current = true;
    if (!key) return;
    try {
      window.localStorage.removeItem(DRAFT_PREFIX + key);
    } catch {
      /* nothing to do — there is no draft to lose at this point */
    }
  }, [key]);

  return { restored, clear };
}
