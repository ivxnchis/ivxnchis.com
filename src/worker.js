/* ivxnchis.com Worker. Static files in public/ are served straight from
   assets; only /api/* reaches this script (see run_worker_first). */

const LETTERBOXD_RSS = 'https://letterboxd.com/ivxnchis/rss/';
const CACHE_SECONDS = 30 * 60;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/last-watched') return lastWatched(request, ctx);
    return env.ASSETS.fetch(request);
  }
};

/* ---------------- Last watched film (Letterboxd diary) ----------------
   The RSS feed has no CORS headers, so the page can't read it directly.
   This reads it, keeps the newest diary entry, and caches the answer. */
async function lastWatched(request, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/last-watched', request.url));
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let film = null;
  try {
    const res = await fetch(LETTERBOXD_RSS, { headers: { 'User-Agent': 'ivxnchis.com' } });
    if (res.ok) film = parseLatestFilm(await res.text());
  } catch (e) { /* fall through to 502 */ }

  if (!film) return json({ error: 'unavailable' }, 502, 60);
  const response = json(film, 200, CACHE_SECONDS);
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

function parseLatestFilm(xml) {
  // Lists also show up in the feed; diary entries are the items with a film title.
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const item = items.find((it) => it.includes('<letterboxd:filmTitle>'));
  if (!item) return null;

  const tag = (name) => {
    const m = item.match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>'));
    return m ? decode(m[1].trim()) : '';
  };
  const body = tag('description').replace(/^<!\[CDATA\[|\]\]>$/g, '');
  const poster = (body.match(/<img src="([^"]+)"/) || [])[1] || '';
  const review = body
    .replace(/<p><img[^>]*><\/p>/, '')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const rating = parseFloat(tag('letterboxd:memberRating'));

  return {
    title: tag('letterboxd:filmTitle'),
    year: tag('letterboxd:filmYear'),
    rating: isNaN(rating) ? null : rating,
    liked: tag('letterboxd:memberLike') === 'Yes',
    rewatch: tag('letterboxd:rewatch') === 'Yes',
    watched: tag('letterboxd:watchedDate'),
    review: decode(review),
    // the feed links a 600×900 poster; the widget only needs a small one
    poster: poster.replace(/-0-600-0-900-crop/, '-0-150-0-225-crop'),
    url: tag('link')
  };
}

function decode(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, '&');
}

function json(data, status, maxAge) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=' + maxAge
    }
  });
}
