/**
 * What platform a URL belongs to, and what to call it.
 *
 * One source of truth for two callers that would otherwise each grow their own
 * half-list: the card parser labelling links it read off a photograph, and the
 * profile sheet labelling a link somebody pasted in by hand. Both want the
 * same answer to the same question.
 *
 * The list is a convenience, never a constraint. A link to a platform nobody
 * here has heard of is stored exactly like any other and simply reads
 * 'Website' — the same reason tags are free-form. Nothing is ever rejected for
 * failing to match.
 */

/** The icon to draw, resolved to an actual component by the UI. Kept as a
 *  string so this module stays free of React and can be unit-tested. */
export type LinkIcon =
  | 'linkedin' | 'twitter' | 'instagram' | 'facebook' | 'github'
  | 'youtube' | 'whatsapp' | 'telegram' | 'globe';

interface Platform {
  host: RegExp;
  label: string;
  icon: LinkIcon;
}

const PLATFORMS: Platform[] = [
  { host: /(^|\.)linkedin\.com$/i, label: 'LinkedIn', icon: 'linkedin' },
  { host: /(^|\.)(twitter\.com|x\.com)$/i, label: 'X', icon: 'twitter' },
  { host: /(^|\.)instagram\.com$/i, label: 'Instagram', icon: 'instagram' },
  { host: /(^|\.)(facebook\.com|fb\.com)$/i, label: 'Facebook', icon: 'facebook' },
  { host: /(^|\.)github\.com$/i, label: 'GitHub', icon: 'github' },
  { host: /(^|\.)(wa\.me|whatsapp\.com)$/i, label: 'WhatsApp', icon: 'whatsapp' },
  { host: /(^|\.)(t\.me|telegram\.(me|org))$/i, label: 'Telegram', icon: 'telegram' },
  { host: /(^|\.)(youtube\.com|youtu\.be)$/i, label: 'YouTube', icon: 'youtube' },
  { host: /(^|\.)behance\.net$/i, label: 'Behance', icon: 'globe' },
  { host: /(^|\.)dribbble\.com$/i, label: 'Dribbble', icon: 'globe' },
  { host: /(^|\.)medium\.com$/i, label: 'Medium', icon: 'globe' },
  { host: /(^|\.)threads\.net$/i, label: 'Threads', icon: 'globe' },
];

/** The host of a URL that may have no scheme, lower-cased, without the www.
 *  Returns '' for anything that is not URL-shaped. */
export function linkHost(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The platform a URL belongs to, or null when it is just a website. */
function match(url: string): Platform | null {
  const host = linkHost(url);
  if (!host) return null;
  return PLATFORMS.find((p) => p.host.test(host)) ?? null;
}

/** 'LinkedIn' for a LinkedIn URL; 'Website' for anything else. */
export function guessLinkLabel(url: string): string {
  return match(url)?.label ?? 'Website';
}

export function linkIcon(url: string): LinkIcon {
  return match(url)?.icon ?? 'globe';
}

/**
 * A URL as it should be stored: whitespace gone, and a scheme added when the
 * card printed the bare host, because 'anvik.club' in an href is a relative
 * path to a file that does not exist. https rather than http — a site that
 * only speaks http will redirect, and a site that speaks both should not be
 * visited over the insecure one on our say-so.
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Shorter, for display: the host plus the first path segment, which is what
 *  makes a LinkedIn URL recognisable without showing 80 characters of it. */
export function prettyUrl(url: string): string {
  const host = linkHost(url);
  if (!host) return url;
  const path = normalizeUrl(url).replace(/^https?:\/\/[^/]+/i, '').replace(/\/$/, '');
  const first = path.split('/').filter(Boolean)[0];
  return first ? `${host}/${first}` : host;
}
