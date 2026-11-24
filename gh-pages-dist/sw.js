const CACHE_NAME = 'minadental-pwa-v59.0-b59';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './favicon.svg',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

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

// Resilient install: never fail SW installation if a single asset is temporarily unreachable
self.addEventListener('install', (event) => {
  broadcastLog('Installing ServiceWorker cache v59...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        ASSETS_TO_CACHE.map((url) =>
          fetch(url, { credentials: 'include' })
            .then((res) => {
              if (res && res.ok) {
                return cache.put(url, res);
              }
            })
            .catch(() => {})
        )
      )
    )
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
    broadcastLog('BackgroundSync triggered for offline queue', 'info');
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'TRIGGER_OFFLINE_SYNC' });
        });
      })
    );
  }
});

// Same-origin network-first strategy with clean navigation offline fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  // Do not intercept cross-origin requests (e.g. Supabase API) or large APK binary downloads
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('.apk') || url.pathname.endsWith('.mobileconfig')) return;

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache).catch(() => {});
          });
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('./');
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        })
      )
  );
});
