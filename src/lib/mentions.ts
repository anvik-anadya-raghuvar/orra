/**
 * Tagging the other person in something you wrote.
 *
 * The token is the one the wiki has always used — `[[person:id|Name]]` —
 * parsed by `parseRichText` and rendered as an @chip. Nothing new is stored:
 * a mention is text inside the body it was written in, so it survives an
 * edit, moves with a quote, and needs no join table.
 *
 * The name is carried alongside the id so the raw text still reads as a
 * sentence in an export or a database row, and so a chip renders before
 * profiles have loaded. The id is what anything behavioural keys off — a
 * renamed person keeps their mentions.
 */

/** Global, so `mentionedIds` can walk every token in a body. */
const PERSON_TOKEN = /\[\[person:([^|\]]+)\|([^\]]+)\]\]/g;

/** The token to drop into a body to tag someone. */
export function mentionToken(id: string, name: string): string {
  return `[[person:${id}|${name}]]`;
}

/**
 * Every person id tagged in `text`, de-duplicated, first mention first.
 *
 * De-duplicated because tagging someone three times in one update is
 * emphasis, not three notifications.
 */
export function mentionedIds(text: string): string[] {
  const seen = new Set<string>();
  for (const match of (text ?? '').matchAll(PERSON_TOKEN)) seen.add(match[1]);
  return [...seen];
}

/** True when `text` tags anyone other than `meId`. Tagging yourself is a note
 *  to self, and notifying you about your own writing is noise. */
export function mentionsSomeoneElse(text: string, meId: string): boolean {
  return mentionedIds(text).some((id) => id !== meId);
}

/**
 * The body of a mention notice, with the quoted update trimmed to a line.
 *
 * The tokens are flattened back to `@Name` first: the notice is read in a
 * chat bubble that has no reason to render a chip, and raw `[[person:…]]`
 * in a notification is the kind of thing that makes an app feel unfinished.
 */
export function mentionExcerpt(text: string, limit = 90): string {
  const flat = (text ?? '').replace(PERSON_TOKEN, (_, __, name) => `@${name}`).replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}
