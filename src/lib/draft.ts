/**
 * Unsent work, kept.
 *
 * Every row in this portal saves the moment it exists — `store.insert` and
 * `store.update` write straight through to Postgres, there is no Save button
 * standing between a change and the database. The gap was everything *before*
 * a row exists: a half-written task, a note you were three paragraphs into, a
 * ledger entry with the amount typed but not the date. That lived only in
 * React state, so closing the sheet — including by clicking outside it, which
 * every overlay now does — or reloading the tab threw it away silently.
 *
 * So composers keep a draft on disk while you type. It is deliberately
 * localStorage and not a table: a draft is not shared, not audited, and not
 * something the other person should ever see a half-finished version of. It
 * belongs to this browser until it becomes a real row, at which point the
 * draft is cleared and the row takes over.
 *
 * The pure functions live here so the rules — what is worth keeping, when a
 * draft goes stale, what a corrupt entry does — are testable without a DOM.
 */

export const DRAFT_PREFIX = 'anvik:draft:';

/** How long an untouched draft is worth restoring. Past this it is far more
 *  likely to be a forgotten false start than something you still want. */
export const DRAFT_TTL_DAYS = 14;

export interface StoredDraft<T> {
  /** ISO timestamp of the last keystroke. */
  at: string;
  values: T;
}

/**
 * Is this draft worth showing someone?
 *
 * An empty one is not: opening a composer, typing nothing and closing it must
 * not leave a "restored your draft" notice behind the next time. Blank
 * strings, empty arrays and nulls all count as nothing; a `false` or a `0`
 * that someone deliberately set does not, so switches and amounts survive.
 */
export function hasContent(values: unknown): boolean {
  if (values == null) return false;
  if (typeof values === 'string') return values.trim().length > 0;
  if (Array.isArray(values)) return values.some(hasContent);
  if (typeof values === 'object') return Object.values(values as object).some(hasContent);
  if (typeof values === 'number') return Number.isFinite(values) && values !== 0;
  return Boolean(values);
}

/** Serialise a draft for storage. Returns null when there is nothing to keep,
 *  which is the caller's cue to delete rather than write. */
export function serialiseDraft<T>(values: T, at: string): string | null {
  if (!hasContent(values)) return null;
  return JSON.stringify({ at, values } satisfies StoredDraft<T>);
}

/**
 * Parse a stored draft, or null.
 *
 * Null for every failure mode there is — absent, unparseable, the wrong shape,
 * stale, or empty — because a composer has exactly one sane response to all of
 * them: start blank. A draft is a convenience, and a convenience that throws
 * would be worse than not having it.
 */
export function parseDraft<T>(raw: string | null, now: number = Date.now()): T | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const draft = parsed as Partial<StoredDraft<T>>;
  if (typeof draft.at !== 'string' || draft.values === undefined) return null;
  const at = Date.parse(draft.at);
  if (!Number.isFinite(at)) return null;
  if (now - at > DRAFT_TTL_DAYS * 86_400_000) return null;
  if (!hasContent(draft.values)) return null;
  return draft.values as T;
}

/** Only the keys the composer still knows about, so a draft written before a
 *  field was renamed cannot push a stale key back into React state. */
export function pickKnown<T extends Record<string, unknown>>(draft: unknown, shape: T): Partial<T> {
  if (!draft || typeof draft !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    const value = (draft as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}
