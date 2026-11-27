const CACHE_NAME = 'vibra-offline-shell-v3';
const SHELL_ASSETS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(SHELL_ASSETS);
      })
      .catch(function () {})
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches
        .keys()
        .then(function (keys) {
          return Promise.all(
            keys
              .filter(function (k) {
                return k !== CACHE_NAME;
              })
              .map(function (k) {
                return caches.delete(k);
              })
          );
        })
        .catch(function () {}),
      self.registration && self.registration.getNotifications
        ? self.registration
            .getNotifications({ tag: 'vibra-now-playing' })
            .then(function (list) {
              list.forEach(function (n) {
                n.close();
              });
            })
            .catch(function () {})
        : Promise.resolve(),
    ])
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (!request || request.method !== 'GET') return;

  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept /api/ or /jio-f220b.js requests
  if (url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/jio-f220b.js') === 0) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches
              .open(CACHE_NAME)
              .then(function (cache) {
                cache.put('/', copy);
              })
              .catch(function () {});
          }
          return res;
        })
        .catch(function () {
          return caches.match('/').then(function (cached) {
            return cached || Response.error();
          });
        })
    );
    return;
  }

  var isAsset =
    url.pathname.indexOf('/assets/') === 0 ||
    /\.(js|css|svg|png|ico|webmanifest|woff2?)$/i.test(url.pathname);

  if (isAsset) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(request).then(function (cached) {
          var networkPromise = fetch(request)
            .then(function (res) {
              if (res && res.ok) {
                cache.put(request, res.clone());
              }
              return res;
            })
            .catch(function () {
              return cached;
            });
          return cached || networkPromise;
        });
      })
    );
  }
});

