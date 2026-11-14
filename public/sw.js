self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      self.registration
        .getNotifications({ tag: 'vibra-now-playing' })
        .then((list) => list.forEach((n) => n.close()))
        .catch(() => {}),
    ])
  );
});
