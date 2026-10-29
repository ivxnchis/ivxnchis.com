/* ivxnchis.com Worker. Static files in public/ are served straight from
   assets; only /api/* reaches this script (see run_worker_first). */

const LETTERBOXD_RSS = 'https://letterboxd.com/ivxnchis/rss/';
const CACHE_SECONDS = 30 * 60;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/last-watched') return lastWatched(request, ctx);
    if (url.pathname === '/api/now-playing') return nowPlaying(request, env, ctx);
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

/* ---------------- Now playing (Spotify) ----------------
   Needs three Worker secrets, set once with scripts/spotify-auth.mjs:
   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN.
   Answers with what's playing now, or else the last track played. */
const NOW_PLAYING_SECONDS = 30;

async function nowPlaying(request, env, ctx) {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET || !env.SPOTIFY_REFRESH_TOKEN) {
    return json({ error: 'not configured' }, 503, 300);
  }
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/now-playing', request.url));
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let track = null;
  try {
    const token = await spotifyToken(env, request, ctx);
    const auth = { headers: { Authorization: 'Bearer ' + token } };

    // 204 means nothing is playing; podcasts come back without a track
    const now = await fetch('https://api.spotify.com/v1/me/player/currently-playing', auth);
    if (now.status === 200) {
      const d = await now.json();
      if (d.is_playing && d.item && d.currently_playing_type === 'track') track = describeTrack(d.item, true, null);
    }
    if (!track) {
      const recent = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=1', auth);
      if (recent.ok) {
        const item = ((await recent.json()).items || [])[0];
        if (item) track = describeTrack(item.track, false, item.played_at);
      }
    }
  } catch (e) { /* fall through to 502 */ }

  if (!track) return json({ error: 'unavailable' }, 502, 60);
  const response = json(track, 200, NOW_PLAYING_SECONDS);
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

// Access tokens last an hour; keep one in the cache instead of asking every time.
async function spotifyToken(env, request, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/_spotify-token', request.url));
  const hit = await cache.match(cacheKey);
  if (hit) return hit.text();

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(env.SPOTIFY_CLIENT_ID + ':' + env.SPOTIFY_CLIENT_SECRET)
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.SPOTIFY_REFRESH_TOKEN })
  });
  if (!res.ok) throw new Error('token ' + res.status);
  const d = await res.json();
  const ttl = Math.max(60, (d.expires_in || 3600) - 300);
  // the cache is only reachable from this Worker; no route serves this key
  ctx.waitUntil(cache.put(cacheKey, new Response(d.access_token, { headers: { 'Cache-Control': 'max-age=' + ttl } })));
  return d.access_token;
}

function describeTrack(t, playing, playedAt) {
  // album art comes largest first; 300px is plenty for a 56px tile
  const images = (t.album && t.album.images) || [];
  const art = images.find((i) => i.width && i.width <= 300) || images[images.length - 1];
  return {
    playing,
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    album: t.album ? t.album.name : '',
    art: art ? art.url : '',
    url: t.external_urls ? t.external_urls.spotify : '',
    playedAt
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
