const CACHE_NAME = 'vibra-offline-shell-v2';
const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => {})
      .finally(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then((keys) =>
          Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
        .catch(() => {}),
      self.registration
        .getNotifications({ tag: 'vibra-now-playing' })
        .then((list) => list.forEach((n) => n.close()))
        .catch(() => {}),
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept /api/ requests (allows clean HTTP 206 byte-range audio streaming)
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests: network-first with cached app shell fallback for offline mode
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put('/', copy)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match('/');
          return cached || Response.error();
        })
    );
    return;
  }

  // Static app assets (/assets/*, JS, CSS, SVG, PNG, manifest): network-first in dev or cache-with-revalidate
  const isAsset =
    url.pathname.startsWith('/assets/') ||
    /\.(js|css|svg|png|ico|webmanifest|woff2?)$/i.test(url.pathname);

  if (isAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const networkPromise = fetch(request)
          .then((res) => {
            if (res && res.ok) {
              void cache.put(request, res.clone());
            }
            return res;
          })
          .catch(() => cached);
        return cached || networkPromise;
      })
    );
  }
});
