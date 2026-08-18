/**
 * YouTube Data API v3 — resolving a song pick to the actual video.
 *
 * Without a key, picking a song stores whatever URL you pasted and "Play"
 * falls back to a YouTube *search page* (see `song.ts`). With a key, typing
 * just a title and artist is enough: the video id is resolved once, at save
 * time, and stored on the row — so the tile gets real artwork and Play opens
 * the track itself.
 *
 * Two deliberate choices:
 *
 *  - **Resolve once, on save.** `search.list` costs 100 of the 10,000 free
 *    daily quota units, so a lookup per render would burn the day's budget in
 *    a hundred paints. One pick a day costs 100.
 *  - **This key is public.** It ships in the bundle like every VITE_ value, so
 *    it must be restricted in Cloud Console to the two site referrers and to
 *    the YouTube Data API alone. Unlike the OAuth client id, an unrestricted
 *    API key is genuinely abusable — someone else spends your quota.
 */

const API_KEY = import.meta.env.VITE_YOUTUBE_API_KEY as string | undefined;

export const youtubeConfigured = () => Boolean(API_KEY);

export interface YouTubeVideo {
  id: string;
  url: string;
  title: string;
  channel: string;
  thumb: string;
}

interface SearchResponse {
  items?: {
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      channelTitle?: string;
      thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
    };
  }[];
}

/** Pure mapping of a search response to the first usable video, or null. */
export function pickVideo(json: SearchResponse): YouTubeVideo | null {
  const item = (json.items ?? []).find((i) => i.id?.videoId);
  const id = item?.id?.videoId;
  if (!id) return null;
  const s = item!.snippet ?? {};
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    // Titles come back HTML-escaped ("Don&#39;t") — decode before display.
    title: decodeEntities(s.title ?? ''),
    channel: decodeEntities(s.channelTitle ?? ''),
    thumb: s.thumbnails?.high?.url ?? s.thumbnails?.medium?.url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export function searchUrl(query: string): string {
  return `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&q=${encodeURIComponent(
    query,
  )}&key=${API_KEY ?? ''}`;
}

/**
 * Find the video for a title/artist pair. Resolves null rather than throwing
 * when there's no key, no match, or the API is unhappy — a song pick must
 * never fail to save because YouTube was down.
 */
export async function resolveSong(title: string, artist: string): Promise<YouTubeVideo | null> {
  if (!API_KEY) return null;
  const q = [title, artist].filter(Boolean).join(' ').trim();
  if (!q) return null;
  try {
    const res = await fetch(searchUrl(q));
    if (!res.ok) return null;
    return pickVideo((await res.json()) as SearchResponse);
  } catch {
    return null;
  }
}
