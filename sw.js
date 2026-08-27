/* ---------------------------------------------------------
   sw.js — make the second visit cost almost nothing.

   GitHub Pages serves everything with `cache-control: max-age=600` and
   there is no way to ask it for anything else. Ten minutes after a visit,
   every one of the fifty-odd files this page is made of has to be
   revalidated: fifty round trips, on a phone, to be told fifty times that
   nothing has changed. For a site two people open most mornings that is
   the difference between "instant" and "a couple of seconds of nothing".

   A service worker is the only place the caching rule can actually be
   changed, so this is where it lives.

   The safety argument, because this site cares more about being right
   than about being fast:

   · Everything except the page itself is requested at a URL containing a
     hash of its own contents — scripts/version.mjs puts them there. A
     hashed URL cannot go stale, because a changed file is a different
     URL that no cache has ever seen. So those are answered from the
     cache without asking, and that is not a judgement call, it is
     arithmetic.

   · index.html is the one file with no hash in its URL, so it is the one
     file that is always fetched from the network first. It carries the
     hashes of everything else, which means a deploy is picked up in full
     on the first load after it. The cached copy is a fallback for being
     offline, not a shortcut.

   · The forecast and the address lookup are never cached. One is about
     right now and the other is something the reader just typed.

   · Nothing here can make an event that has finished appear to be on.
     Expiry is applied when the records are built, against today's date,
     not when they are fetched — so a cached file a week old still draws
     the same page a fresh one would.
   --------------------------------------------------------- */

const ASSETS = 'paris-assets-v1';
/* v2: v1 could only ever hold opaque entries written by an earlier
   build of this file, and those cannot be checked for validity. The
   activate handler deletes any cache not named here, so bumping the
   name is how they are thrown away. */
const PHOTOS = 'paris-photos-v2';
const PAGES  = 'paris-pages-v1';

/* Roughly two deploys' worth of hashed files, and enough photographs to
   cover the views somebody actually opens. Both are trimmed oldest-first,
   which for hashed URLs means the previous deploy goes before this one. */
const MAX_ASSETS = 140;
const MAX_PHOTOS = 160;

const PHOTO_HOST = 'upload.wikimedia.org';

/* Anything that is about this moment rather than about the site. */
const NEVER = [/api\.open-meteo\.com/, /nominatim/i, /geocod/i];

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = new Set([ASSETS, PHOTOS, PAGES]);
    for (const name of await caches.keys()) if (!keep.has(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

/* Hashed URL: the contents cannot change under this address, so serve
   what we have and only go to the network on a miss. */
async function immutable(req, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.status === 200) {
    await cache.put(req, res.clone());
    trim(cacheName, max);
  }
  return res;
}

/* ---------- photographs, and why they need their own path ----------

   A photograph is immutable in the same way — the width is in the URL —
   but it is cross-origin, and that changes what a service worker can
   know about it. An `<img>` issues a `no-cors` request, whose response
   comes back opaque: `type: 'opaque'`, `status: 0`, and `ok: false`.

   This used to share `immutable`, guarded by

       res.ok && (res.status === 200 || res.type === 'opaque')

   and the `&& res.ok` made the opaque branch unreachable, so no
   photograph was ever cached at all. The bug was invisible because
   Commons sends long cache headers and the browser's own HTTP cache
   covered the repeat visit.

   The fix is deliberately not "also accept opaque". An opaque 404 is
   indistinguishable from an opaque 200, so caching them would trade a
   silent miss for a broken picture pinned on somebody's device until the
   cache is evicted. Instead the status is made readable: the one host
   photographs come from sends `access-control-allow-origin: *`, so
   asking again with CORS returns a real response with a real status, and
   the guard can be the honest one. Credentials are omitted because a
   credentialed request is refused by a wildcard ACAO.

   If CORS is ever refused, the element's own request is used and the
   picture still appears — it simply is not cached. Failing soft here
   costs a round trip; failing hard would cost the photograph. */
async function photo(req, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
    if (res.status === 200) {
      await cache.put(req, res.clone());
      trim(cacheName, max);
    }
    return res;
  } catch (e) {
    return fetch(req);
  }
}

/* The page itself, and any unhashed data file: ask the network, fall back
   to what we have if there is no network to ask. */
async function fresh(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (NEVER.some(re => re.test(url.href))) return;

  if (url.hostname === PHOTO_HOST) {
    e.respondWith(photo(req, PHOTOS, MAX_PHOTOS));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html')) {
    e.respondWith(fresh(req, PAGES));
    return;
  }

  /* ?v=<hash> is the promise that this URL means one specific file
     forever. Without it we have no such promise, so we ask. */
  if (url.searchParams.has('v')) {
    e.respondWith(immutable(req, ASSETS, MAX_ASSETS));
    return;
  }

  e.respondWith(fresh(req, ASSETS));
});
