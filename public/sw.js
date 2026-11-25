// MinaDental Unified Service Worker (V6 Boot Hotfix)
// Single source of truth: stamped with deterministic content-derived BUILD_ID during Vite build.
const BUILD_ID = '__MINA_BUILD_ID_VALUE__';
const RESOLVED_BUILD_ID = BUILD_ID.startsWith('__') ? 'dev-local' : BUILD_ID;
const CACHE_PREFIX = 'minadental-shell-';
const CACHE_NAME = CACHE_PREFIX + RESOLVED_BUILD_ID;
const NAVIGATION_TIMEOUT_MS = 4500;

const CRITICAL_PRECACHE_ASSETS = /*__MINA_CRITICAL_ASSETS__*/ [
  './',
  './index.html',
];

const PRECACHE_ASSETS = /*__MINA_PRECACHE_ASSETS__*/ [
  './',
  './index.html',
  './manifest.json',
  './favicon.svg',
  './logo.png',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
];

const NEVER_CACHE_PATH_PATTERNS = [
  '/rest/v1/',
  '/auth/v1/',
  '/realtime/v1/',
  '/storage/v1/',
  '/functions/v1/',
  '/api/',
  '/assets/aistudio/',
];

const BYPASS_EXTENSIONS = ['.apk', '.mobileconfig', '.idsig', '.ipa'];

function isMinadentalCacheKey(key) {
  return typeof key === 'string' && key.startsWith('minadental-');
}

function isSensitiveOrApiPath(pathname) {
  const lower = pathname.toLowerCase();
  if (BYPASS_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  return NEVER_CACHE_PATH_PATTERNS.some((pattern) => lower.includes(pattern));
}

function isValidMimeForPath(pathname, contentType, requestMode) {
  const ct = (contentType || '').toLowerCase();
  const lower = pathname.toLowerCase();

  if (requestMode === 'navigate' || lower.endsWith('.html') || lower.endsWith('/')) {
    return ct.includes('text/html');
  }
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) {
    return ct.includes('javascript') && !ct.includes('text/html');
  }
  if (lower.endsWith('.css')) {
    return ct.includes('text/css') && !ct.includes('text/html');
  }
  if (lower.endsWith('.json') || lower.endsWith('.webmanifest')) {
    return ct.includes('json') && !ct.includes('text/html');
  }
  if (lower.endsWith('.svg')) {
    return ct.includes('image/svg') && !ct.includes('text/html');
  }
  if (lower.endsWith('.png') || lower.endsWith('.webp') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.ico')) {
    return ct.includes('image/') && !ct.includes('text/html');
  }
  if (lower.endsWith('.woff2') || lower.endsWith('.woff') || lower.endsWith('.ttf')) {
    return !ct.includes('text/html');
  }
  return !ct.includes('text/html');
}

function isCacheableResponse(request, response, pathname) {
  if (!response || !response.ok || response.status !== 200) return false;
  if (response.type !== 'basic') return false;

  const cacheControl = (response.headers.get('cache-control') || '').toLowerCase();
  if (cacheControl.includes('no-store') || cacheControl.includes('private')) {
    return false;
  }

  const contentType = response.headers.get('content-type') || '';
  return isValidMimeForPath(pathname, contentType, request.mode);
}

function fetchWithTimeout(request, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(request, Object.assign({}, options, { signal: controller.signal })).finally(() => {
    clearTimeout(timer);
  });
}

function createOfflineHtmlResponse() {
  const html =
    '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1.0">' +
    '<title>مینادنتال — آفلاین</title></head>' +
    '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#F4F7F9;color:#14283B;font-family:Vazirmatn,Tahoma,sans-serif;text-align:center;padding:24px;">' +
    '<div style="max-width:360px;background:#fff;border:1px solid #D8E2EA;border-radius:20px;padding:24px;">' +
    '<h2 style="margin:0 0 8px;font-size:17px;">اتصال اینترنت برقرار نیست</h2>' +
    '<p style="margin:0 0 16px;font-size:13px;color:#526779;line-height:1.7;">صفحه درخواستی در حافظه آفلاین موجود نیست. لطفاً اتصال شبکه را بررسی کرده و دوباره تلاش کنید.</p>' +
    '<button onclick="location.reload()" style="background:#087C76;color:#fff;border:none;border-radius:12px;padding:12px 20px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;">تلاش مجدد</button>' +
    '</div></body></html>';

  return new Response(html, {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function notifyClients(payload) {
  return self.clients
    .matchAll({ includeUncontrolled: true, type: 'window' })
    .then((clients) => {
      clients.forEach((client) => {
        try {
          client.postMessage(payload);
        } catch {
          // ignore closed client
        }
      });
    })
    .catch(() => {});
}

async function fetchAndCacheAsset(cache, assetUrl, isCritical) {
  const req = new Request(assetUrl, { cache: 'no-store' });
  const res = await fetch(req);
  const parsed = new URL(req.url);
  const mode = assetUrl === './' || assetUrl.endsWith('.html') ? 'navigate' : 'cors';
  const ct = res && res.headers ? res.headers.get('content-type') || '' : '';
  const valid =
    Boolean(res) &&
    res.ok &&
    res.status === 200 &&
    res.type === 'basic' &&
    isValidMimeForPath(parsed.pathname, ct, mode);

  if (!valid) {
    if (isCritical) {
      throw new Error(`Critical precache asset invalid (${res ? res.status : 'NO_RES'}): ${assetUrl}`);
    }
    return;
  }
  await cache.put(assetUrl, res);
}

// Install: atomically validate critical entry shell/JS/CSS assets so a broken release never activates.
// Optional icons/secondary files remain best-effort.
// CRITICAL (V5/V6): Do NOT call self.skipWaiting() unconditionally in install.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        const criticalSet = new Set(CRITICAL_PRECACHE_ASSETS);
        await Promise.all(
          CRITICAL_PRECACHE_ASSETS.map((assetUrl) => fetchAndCacheAsset(cache, assetUrl, true))
        );
        const optionalAssets = PRECACHE_ASSETS.filter((assetUrl) => !criticalSet.has(assetUrl));
        await Promise.allSettled(
          optionalAssets.map((assetUrl) => fetchAndCacheAsset(cache, assetUrl, false))
        );
      })
      .then(() => {
        if (self.registration && self.registration.active) {
          return notifyClients({ type: 'SW_UPDATE_READY', buildId: RESOLVED_BUILD_ID });
        }
        return undefined;
      })
  );
});

// Activate: keep current cache intact; obsolete minadental-shell-* caches are pruned
// safely ONLY when no open client depends on them (or on explicit PRUNE_OBSOLETE_CACHES after boot verify).
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

async function pruneObsoleteMinadentalCaches(keepBuildId) {
  const keepCacheName = CACHE_PREFIX + (keepBuildId || RESOLVED_BUILD_ID);
  const keys = await caches.keys();
  await Promise.all(
    keys.map((key) => {
      if (isMinadentalCacheKey(key) && key !== CACHE_NAME && key !== keepCacheName) {
        return caches.delete(key);
      }
      return Promise.resolve(false);
    })
  );
}

// Controlled update activation & post-boot cache cleanup via UpdateCoordinator messages
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;
  if (data.type === 'SKIP_WAITING' || data.type === 'FORCE_UPDATE') {
    if (data.targetReleaseId && data.targetReleaseId !== RESOLVED_BUILD_ID && RESOLVED_BUILD_ID !== 'dev-local') {
      return;
    }
    self.skipWaiting();
  } else if (data.type === 'PRUNE_OBSOLETE_CACHES') {
    event.waitUntil(pruneObsoleteMinadentalCaches(data.activeBuildId));
  } else if (data.type === 'GET_BUILD_ID' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({
      buildId: RESOLVED_BUILD_ID,
      cacheName: CACHE_NAME,
      criticalAssets: CRITICAL_PRECACHE_ASSETS,
    });
  }
});

// BackgroundSync listener for offline queue sync
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-dental-offline-queue') {
    event.waitUntil(notifyClients({ type: 'TRIGGER_OFFLINE_SYNC' }));
  }
});

async function handleNavigationRequest(request, url) {
  try {
    const networkResponse = await fetchWithTimeout(
      request,
      { cache: 'no-store' },
      NAVIGATION_TIMEOUT_MS
    );
    if (isCacheableResponse(request, networkResponse, url.pathname)) {
      const htmlProbe = await networkResponse.clone().text().catch(() => '');
      const metaMatch = htmlProbe.match(/<meta\s+name="minadental-build-id"\s+content="([^"]+)"/i);
      const responseBuildId = metaMatch ? metaMatch[1] : null;
      // V7: NEVER cache a navigation HTML belonging to a DIFFERENT release into this worker's cache
      if (!responseBuildId || RESOLVED_BUILD_ID === 'dev-local' || responseBuildId === RESOLVED_BUILD_ID) {
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone)).catch(() => {});
      }
    }
    return networkResponse;
  } catch {
    // Sequential awaited fallback (fixes broken Promise-truthy || chain)
    const cache = await caches.open(CACHE_NAME);
    const exactMatch = await cache.match(request);
    if (exactMatch) return exactMatch;
    const indexMatch = await cache.match('./index.html');
    if (indexMatch) return indexMatch;
    const rootMatch = await cache.match('./');
    if (rootMatch) return rootMatch;
    return createOfflineHtmlResponse();
  }
}

async function handleStaticAssetRequest(request, url) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    const ct = cached.headers.get('content-type') || '';
    if (isValidMimeForPath(url.pathname, ct, request.mode)) {
      return cached;
    }
    // Evict poisoned cache entry (e.g. HTML cached under .js/.css)
    await cache.delete(request).catch(() => {});
  }

  try {
    const networkResponse = await fetch(request);
    if (isCacheableResponse(request, networkResponse, url.pathname)) {
      const clone = networkResponse.clone();
      cache.put(request, clone).catch(() => {});
    }
    return networkResponse;
  } catch {
    return new Response('Asset unavailable offline', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.headers && request.headers.has('authorization')) return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isSensitiveOrApiPath(url.pathname)) return;

  // Never cache mutable release pointers or manifests
  if (
    url.pathname.endsWith('release-pointer.json') ||
    url.pathname.endsWith('release-manifest.json') ||
    url.pathname.endsWith('version.json') ||
    url.pathname.endsWith('build-manifest.json') ||
    url.pathname.endsWith('chunks.json')
  ) {
    event.respondWith(
      fetchWithTimeout(request, { cache: 'no-store' }, NAVIGATION_TIMEOUT_MS).catch(
        () =>
          new Response(JSON.stringify({ offline: true }), {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          })
      )
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request, url));
    return;
  }

  event.respondWith(handleStaticAssetRequest(request, url));
});
