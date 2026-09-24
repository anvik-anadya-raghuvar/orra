/**
 * A user-typed link, made fit for an href — or refused.
 *
 * Several rooms take a URL typed by hand (a document's Drive link, a podcast,
 * a mood-board pin, a person's profile links) and render it as `<a href>`.
 * Typed as-is, `anvik.club` is a relative path to nothing and
 * `javascript:…` is a script. This composes the two existing helpers —
 * normalizeUrl adds the missing scheme, isSafeExternalUrl allows only
 * http(s) and mailto — so every caller refuses the same things.
 *
 * Pure, so it is tested rather than trusted.
 */
import { normalizeUrl } from './socialLinks';
import { isSafeExternalUrl } from './textFormat';

/** A scheme the user actually typed (`mailto:`, `javascript:`), as opposed to
 *  a host with a port (`example.com:8080`), which normalizeUrl should prefix. */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/** The href to render, or null when there is nothing safe to link to. */
export function safeHref(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : normalizeUrl(trimmed);
  return isSafeExternalUrl(candidate) ? candidate : null;
}
