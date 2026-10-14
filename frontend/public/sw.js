/*
 * Service worker for the installed app.
 *
 * What it is for: Chrome only offers "Install app" to a site with one, and it
 * lets the installed app open instantly and say something sensible when the
 * phone has no signal, rather than showing the browser's dinosaur.
 *
 * What it deliberately does not do: cache anything from /api. Requests,
 * comments and statuses must always be live -- a resident shown yesterday's
 * status of their request, with no sign that it is stale, is worse than one
 * shown an error. API calls go straight to the network, untouched.
 *
 * Bump VERSION to force every installed copy to drop its cache.
 */
const VERSION = 'v1';
const CACHE = `tsv-shell-${VERSION}`;
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Other origins (the API on a separate host, Google Fonts) and the API on
  // this one are left entirely to the browser.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api')) return;

  // Pages: always try the network first so a deploy shows up on the next
  // launch; fall back to the cached shell only when offline. React Router
  // takes it from there, and the API calls it makes will report the outage.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          if (response.ok) caches.open(CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Build output under /static/ has a content hash in every filename, so a
  // cached copy can never be stale: serve it from the cache when present.
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })),
    );
    return;
  }

  // Anything else (icons, manifest): network, falling back to the cache.
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
