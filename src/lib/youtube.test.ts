import { describe, expect, it } from 'vitest';
import { pickVideo, searchUrl } from './youtube';

describe('YouTube search', () => {
  it('asks for exactly one video and encodes the query', () => {
    const u = searchUrl("Don't Stop Me Now Queen");
    expect(u).toContain('type=video');
    expect(u).toContain('maxResults=1');
    // encodeURIComponent leaves the apostrophe alone; spaces become %20.
    expect(u).toContain("q=Don't%20Stop%20Me%20Now%20Queen");
  });

  it('maps the first result and decodes escaped titles', () => {
    const v = pickVideo({
      items: [
        {
          id: { videoId: 'HgzGwKwLmgM' },
          snippet: {
            title: 'Queen &#39;Don&#39;t Stop Me Now&#39; &amp; more',
            channelTitle: 'Queen Official',
            thumbnails: { high: { url: 'https://i.ytimg.com/vi/HgzGwKwLmgM/hqdefault.jpg' } },
          },
        },
      ],
    });
    expect(v).toEqual({
      id: 'HgzGwKwLmgM',
      url: 'https://www.youtube.com/watch?v=HgzGwKwLmgM',
      title: "Queen 'Don't Stop Me Now' & more",
      channel: 'Queen Official',
      thumb: 'https://i.ytimg.com/vi/HgzGwKwLmgM/hqdefault.jpg',
    });
  });

  it('skips non-video results rather than returning a broken pick', () => {
    expect(pickVideo({ items: [{ id: {} }, { id: { videoId: 'abc12345678' } }] })?.id).toBe(
      'abc12345678',
    );
    expect(pickVideo({ items: [] })).toBeNull();
    expect(pickVideo({})).toBeNull();
  });
});
