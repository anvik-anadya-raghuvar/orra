/**
 * Sending something to the other person, and reading what came back.
 *
 * One helper per kind so the Us composer and the Home widget cannot drift into
 * sending subtly different rows.
 */
import { newId, type AppStore } from '../data/store';
import type { Dataset, Message, UserId } from '../types';
import { uploadMoment } from './moments';

/** How far back the Home widget looks for something the other one sent. */
export const RECENT_DAYS = 7;

function baseMessage(store: AppStore): Omit<Message, 'kind' | 'body'> {
  return {
    id: newId('m'),
    sender_id: store.meId,
    reply_to_id: null,
    task_ref_id: null,
    attachment_url: null,
    song_ref: null,
    promoted_to_type: null,
    promoted_to_id: null,
    created_at: new Date().toISOString(),
  };
}

/** Send a photo. `dataUrl` is already compressed by lib/photo.ts. */
export async function sendPhoto(
  store: AppStore,
  dataUrl: string,
  caption: string,
): Promise<void> {
  const base = baseMessage(store);
  // Upload first: a message pointing at a photo that failed to store would
  // render as a permanently broken frame.
  const attachment = await uploadMoment(dataUrl, store.meId, base.id);
  store.insert(
    'messages',
    { ...base, kind: 'photo', body: caption.trim(), attachment_url: attachment },
    store.asMe({ summary: `Photo sent to ${store.other.name}` }),
  );
}

export function sendSong(
  store: AppStore,
  song: { title: string; artist: string; url: string },
  note: string,
): void {
  store.insert(
    'messages',
    { ...baseMessage(store), kind: 'song', body: note.trim(), song_ref: song },
    store.asMe({ summary: `Song suggested to ${store.other.name}` }),
  );
}

/** Reply to a moment, from wherever it was seen. */
export function replyToMoment(store: AppStore, momentId: string, body: string): void {
  const text = body.trim();
  if (!text) return;
  store.insert(
    'messages',
    { ...baseMessage(store), kind: 'chat', body: text, reply_to_id: momentId },
    store.asMe({ summary: 'Replied to a moment' }),
  );
}

const withinDays = (iso: string, days: number, now: Date): boolean =>
  now.getTime() - new Date(iso).getTime() <= days * 86_400_000;

/** The newest thing of one kind the other person sent me lately. */
export function latestFromOther(
  ds: Dataset,
  meId: UserId,
  kind: 'photo' | 'song',
  now: Date = new Date(),
  days: number = RECENT_DAYS,
): Message | null {
  return (
    ds.messages
      .filter((m) => m.kind === kind && m.sender_id !== meId && withinDays(m.created_at, days, now))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}

/** Everything said in answer to one moment, oldest first. */
export function repliesTo(ds: Dataset, momentId: string): Message[] {
  return ds.messages
    .filter((m) => m.reply_to_id === momentId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
