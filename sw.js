const CACHE_NAME = 'minadental-pwa-v55.0-b55';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './favicon.svg',
  './manifest.json',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
];

// Helper to broadcast log messages to client windows
function broadcastLog(message, type = 'info') {
  const logEntry = {
    timestamp: new Date().toLocaleTimeString('fa-IR'),
    message: `[SW ${CACHE_NAME}] ${message}`,
    type,
  };
  self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type: 'SW_CONSOLE_LOG', log: logEntry });
    });
  });
}

self.addEventListener('install', (event) => {
  broadcastLog('Installing new ServiceWorker cache...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  broadcastLog('ServiceWorker activated & claiming clients...');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            broadcastLog(`Clearing obsolete cache: ${key}`, 'warn');
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data && (event.data.type === 'SKIP_WAITING' || event.data.type === 'FORCE_UPDATE')) {
    broadcastLog('Received FORCE_UPDATE/SKIP_WAITING message', 'info');
    self.skipWaiting();
  }
});

// BackgroundSync listener for offline queue sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-dental-offline-queue') {
    broadcastLog('BackgroundSync triggered for offline queue: sync-dental-offline-queue', 'info');
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'TRIGGER_OFFLINE_SYNC' });
        });
      })
    );
  }
});

// Network-first strategy: always serve latest build when available, fallback to cache when offline
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(event.request).then((cachedResponse) => {
          return cachedResponse || caches.match('./index.html');
        })
      )
  );
});
