/**
 * Song of the day — YouTube only.
 *
 * One service, so "Play" always behaves the same way and a pick is never a
 * dead link for whoever doesn't have the other app. A pasted YouTube URL is
 * kept as-is; anything else is turned into a YouTube search for the title and
 * artist, so a pick is never unplayable just because no link was handy.
 */

const YT_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'];

export function isYouTubeUrl(url: string): boolean {
  if (!url) return false;
  try {
    return YT_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Extract the 11-char video id from any YouTube URL shape, or null. */
export function youTubeId(url: string): string | null {
  if (!isYouTubeUrl(url)) return null;
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    const v = u.searchParams.get('v');
    if (v) return v;
    // /embed/ID and /shorts/ID
    const m = u.pathname.match(/\/(embed|shorts|v)\/([\w-]{6,})/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

export function youTubeSearch(title: string, artist: string): string {
  const q = [title, artist].filter(Boolean).join(' ');
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

/** The link "Play" should open: the real URL if it's YouTube, else a search. */
export function playUrl(song: { song_title: string; song_artist: string; song_url: string }): string {
  return isYouTubeUrl(song.song_url)
    ? song.song_url
    : youTubeSearch(song.song_title, song.song_artist);
}

/** Thumbnail for a YouTube pick, so the tile can show the actual video art. */
export function youTubeThumb(url: string): string | null {
  const id = youTubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}
