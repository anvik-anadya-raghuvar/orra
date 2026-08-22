/**
 * One place to look for anything.
 *
 * Every room grew its own search box, and three rooms never got one at all —
 * the Work board, the busiest surface in the portal, could only be narrowed
 * by chips, so finding a task by name meant reading columns. This is the
 * search that spans all of them.
 *
 * Deliberately a linear substring scan rather than an index. There are two
 * people and a few hundred rows; scanning the whole dataset on every
 * keystroke costs well under a millisecond, and an inverted index would be
 * a cache to invalidate in exchange for nothing anyone could feel.
 *
 * Pure — no store, no router, no DOM — so it can be tested properly and so
 * the palette component stays about keyboard handling.
 */
import type { Dataset, UserId } from '../types';
import { stripInlineImageMarkers } from '../ui/inlineImages';

export type SearchKind =
  | 'task'
  | 'note'
  | 'page'
  | 'person'
  | 'decision'
  | 'document'
  | 'money';

export interface SearchItem {
  kind: SearchKind;
  id: string;
  title: string;
  /** The dim second line: a first line of body, a role, an amount. */
  sub: string;
  /** Sorted descending within a kind when scores tie — newest first. */
  recency: string;
}

export const KIND_LABEL: Record<SearchKind, string> = {
  task: 'Tasks',
  note: 'Scribbles',
  page: 'Wiki',
  person: 'People',
  decision: 'Decisions',
  document: 'Documents',
  money: 'Money',
};

/** First meaningful line of a body, with inline-image markers stripped so a
 *  `{{anvik-image:…}}` never shows up as a result's subtitle. */
export function firstLine(text: string | null | undefined, max = 90): string {
  const line = stripInlineImageMarkers(text ?? '')
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean);
  if (!line) return '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Everything searchable, flattened. Rebuilt per keystroke — see the note
 *  above about why that is fine. */
export function buildSearchItems(ds: Dataset, meId: UserId): SearchItem[] {
  const items: SearchItem[] = [];

  for (const task of ds.tasks) {
    items.push({
      kind: 'task',
      id: task.id,
      title: task.title,
      sub: `${task.id} · ${task.status.replace('_', ' ')}${task.due_date ? ` · due ${task.due_date}` : ''}`,
      recency: task.updated_at ?? task.created_at,
    });
  }

  // Personal rooms stay personal: a scribble or page owned by the other
  // person is not mine to surface here (principle 1 — separation is focus).
  // Shared rows carry a null owner and belong to both.
  const mine = <T extends { owner_id?: UserId | null }>(row: T) =>
    !row.owner_id || row.owner_id === meId;

  for (const note of ds.notes) {
    if (!mine(note)) continue;
    items.push({
      kind: 'note',
      id: note.id,
      title: note.title || 'Untitled',
      sub: firstLine(note.body) || note.type,
      recency: note.created_at,
    });
  }

  for (const page of ds.pages) {
    if (page.is_archived || !mine(page)) continue;
    items.push({
      kind: 'page',
      id: page.id,
      title: page.title,
      sub: firstLine(page.blocks.map((block) => block.text ?? '').filter(Boolean).join('\n')),
      recency: page.last_edited_at ?? page.created_at,
    });
  }

  for (const person of ds.people) {
    items.push({
      kind: 'person',
      id: person.id,
      title: person.name,
      sub: [person.role, person.next_action].filter(Boolean).join(' · '),
      recency: person.last_contact_date ?? person.created_at,
    });
  }

  for (const decision of ds.decisions) {
    items.push({
      kind: 'decision',
      id: decision.id,
      title: decision.question,
      sub: decision.status === 'ruled' ? firstLine(decision.ruling_note) || 'Ruled' : 'Open',
      recency: decision.ruled_at ?? decision.opened_at,
    });
  }

  for (const doc of ds.documents) {
    items.push({
      kind: 'document',
      id: doc.id,
      title: doc.title,
      sub: doc.expiry_date ? `expires ${doc.expiry_date}` : doc.deadline_note || 'Document',
      recency: doc.expiry_date ?? '',
    });
  }

  for (const entry of ds.ledger) {
    items.push({
      kind: 'money',
      id: entry.id,
      title: `${entry.party} — ${entry.category}`,
      sub: `${entry.direction === 'in' ? '+' : '−'}${entry.amount} · ${entry.date}`,
      recency: entry.date,
    });
  }

  return items;
}

/**
 * Rank: a title that starts with the query beats one that merely contains
 * it, which beats a match only in the subtitle. Ties break on recency, so
 * the thing you touched this morning outranks the one from March.
 */
function score(item: SearchItem, needle: string): number {
  const title = item.title.toLowerCase();
  if (title.startsWith(needle)) return 3;
  if (title.includes(needle)) return 2;
  if (item.sub.toLowerCase().includes(needle)) return 1;
  return 0;
}

export function searchItems(items: SearchItem[], query: string, limit = 24): SearchItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits: { item: SearchItem; rank: number }[] = [];
  for (const item of items) {
    const rank = score(item, needle);
    if (rank > 0) hits.push({ item, rank });
  }
  hits.sort((a, b) => b.rank - a.rank || b.item.recency.localeCompare(a.item.recency));
  return hits.slice(0, limit).map((hit) => hit.item);
}

/** Where Enter takes you. Kinds without a page of their own land in the room
 *  that holds them, which is still far closer than the person was. */
export function routeFor(item: SearchItem): string {
  switch (item.kind) {
    case 'task': return `/task/${item.id}`;
    case 'note': return '/knowledge';
    case 'page': return '/knowledge';
    case 'person': return '/people';
    case 'decision': return '/work';
    case 'document': return '/knowledge';
    case 'money': return '/money';
    default: return '/';
  }
}
