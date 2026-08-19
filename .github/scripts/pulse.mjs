/**
 * Pulls AI/LLM headlines from public RSS/Atom feeds and upserts the newest few
 * into public.pulse_items.
 *
 * No dependencies on purpose — Node 20's fetch plus a deliberately small regex
 * parser. These feeds are simple and well-formed; adding an XML library to a
 * cron that reads four URLs is not worth the supply chain.
 *
 * Deterministic ids (hash of the link) mean re-running never duplicates a row.
 */

import { createHash } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, '');
// This job is trusted server-side automation. The old public anon key forced
// the database to accept spoofable `origin = auto` writes from anyone.
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Official/primary sources — release notes and regulators, not aggregators. */
// Each URL verified to return 200 (post-redirect) at time of writing. A feed
// that dies is logged and skipped, never fatal — one dead source must not cost
// you the whole tile.
//
// Anthropic publishes no RSS feed of its own (every candidate path 404s), so
// it comes via a Google News query instead. Aggregated, not official — the
// tile shows the real publisher per item so the difference stays visible.
const FEEDS = [
  { url: 'https://openai.com/news/rss.xml', source: 'OpenAI' },
  { url: 'https://deepmind.google/blog/rss.xml', source: 'Google DeepMind' },
  { url: 'https://huggingface.co/blog/feed.xml', source: 'Hugging Face' },
  { url: 'https://blog.google/innovation-and-ai/technology/ai/rss/', source: 'Google AI' },
  { url: 'https://simonwillison.net/atom/everything/', source: 'Simon Willison' },
  {
    url: 'https://news.google.com/rss/search?q=Anthropic+Claude&hl=en-US&gl=US&ceid=US:en',
    source: 'Anthropic',
    viaGoogleNews: true,
  },
  {
    url: 'https://news.google.com/rss/search?q=%22large+language+model%22+OR+LLM+release&hl=en-US&gl=US&ceid=US:en',
    source: 'LLM releases',
    viaGoogleNews: true,
  },
];

// Podcasts, on the same free cron. Weekly-ish shows, so one item each is
// plenty — the portal surfaces whichever is newest as "this week's".
const PODCAST_FEEDS = [
  { url: 'https://lexfridman.com/feed/podcast/', source: 'Lex Fridman', kind: 'podcast' },
  { url: 'https://feeds.transistor.fm/acquired', source: 'Acquired', kind: 'podcast' },
  { url: 'https://thetwentyminutevc.libsyn.com/rss', source: '20VC', kind: 'podcast' },
  { url: 'https://api.substack.com/feed/podcast/69345.rss', source: 'Dwarkesh', kind: 'podcast' },
];

const KEEP = 12; // news rows retained; the tile shows three
const KEEP_PODCASTS = 8;

const strip = (s) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const pick = (block, ...tags) => {
  for (const tag of tags) {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (m) return strip(m[1]);
    // Atom <link href="..."/>
    const self = block.match(new RegExp(`<${tag}[^>]*href=["']([^"']+)["']`, 'i'));
    if (self) return self[1];
  }
  return '';
};

async function readFeed({ url, source, viaGoogleNews, kind = 'news' }) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'anvik-ops-pulse/1.0' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      console.warn(`${source}: HTTP ${res.status}`);
      return [];
    }
    const xml = await res.text();
    const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) ?? [];
    return blocks.slice(0, 5).flatMap((b) => {
      let title = pick(b, 'title');
      const link = pick(b, 'link', 'id');
      const date = pick(b, 'pubDate', 'published', 'updated');
      if (!title || !link) return [];
      // Google News appends " - Publisher" to every headline. Split it off so
      // the real publisher shows as the source instead of the query name.
      let label = source;
      if (viaGoogleNews) {
        const cut = title.lastIndexOf(' - ');
        if (cut > 20) {
          label = `${source} · ${title.slice(cut + 3)}`;
          title = title.slice(0, cut);
        }
      }
      const when = date ? new Date(date) : new Date();
      return [
        {
          id: 'pulse-' + createHash('sha1').update(link).digest('hex').slice(0, 16),
          title: title.slice(0, 300),
          source: label,
          url: link,
          published_at: (isNaN(when) ? new Date() : when).toISOString(),
          origin: 'auto',
          kind,
        },
      ];
    });
  } catch (err) {
    console.warn(`${source}: ${err.message}`);
    return [];
  }
}

const rest = (path, method, body, extraHeaders = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

const [news, podcasts] = await Promise.all([
  Promise.all(FEEDS.map(readFeed)).then((r) => r.flat()),
  Promise.all(PODCAST_FEEDS.map(readFeed)).then((r) => r.flat()),
]);

if (!news.length && !podcasts.length) {
  // Never wipe good rows just because every feed happened to fail.
  console.log('No items fetched — leaving existing rows untouched.');
  process.exit(0);
}

const newest = (a, b) => b.published_at.localeCompare(a.published_at);
news.sort(newest);
podcasts.sort(newest);
// Capped per kind, so a chatty news week cannot crowd out every podcast.
const items = [...news.slice(0, KEEP), ...podcasts.slice(0, KEEP_PODCASTS)];

if (process.env.DRY_RUN) {
  for (const i of items) console.log(`[${i.kind}] [${i.source}] ${i.title}`);
  console.log(`
${news.length} news, ${podcasts.length} podcast items fetched.`);
  process.exit(0);
}
const res = await rest('pulse_items', 'POST', items, {
  prefer: 'resolution=merge-duplicates',
});
if (!res.ok) {
  console.error(`Upsert failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`Upserted ${items.length} pulse items:`);
for (const i of items.slice(0, 5)) console.log(` · ${i.source}: ${i.title}`);
