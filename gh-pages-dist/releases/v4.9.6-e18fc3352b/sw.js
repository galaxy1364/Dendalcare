// MinaDental Unified Service Worker (V8 Verified Release Assurance)
// Single source of truth: stamped with deterministic content-derived BUILD_ID during Vite build.
const BUILD_ID = "v4.9.6-e18fc3352b";
const RESOLVED_BUILD_ID = BUILD_ID.startsWith('__') ? 'dev-local' : BUILD_ID;
const CACHE_PREFIX = 'minadental-shell-';
const CACHE_NAME = CACHE_PREFIX + RESOLVED_BUILD_ID;
const NAVIGATION_TIMEOUT_MS = 4500;
const CLIENT_LEASE_TTL_MS = 10 * 60 * 1000;

const CRITICAL_PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./assets/index-B2hHeHW1.js",
  "./assets/index-GiHbXGuz.css"
];

const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./assets/index-B2hHeHW1.js",
  "./assets/index-GiHbXGuz.css",
  "./manifest.json",
  "./favicon.svg",
  "./logo.png",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
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

// Client-aware release leases: tabId -> { buildId, lastSeenAt }
const activeClientLeases = new Map();

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
  // Reuse verified candidate bytes already written by UpdateCoordinator if valid in CACHE_NAME
  const preStaged = await cache.match(assetUrl);
  if (preStaged && preStaged.ok && preStaged.status === 200) {
    const parsedExisting = new URL(assetUrl, self.location.href);
    const modeExisting = assetUrl === './' || assetUrl.endsWith('.html') ? 'navigate' : 'cors';
    const ctExisting = preStaged.headers.get('content-type') || '';
    if (isValidMimeForPath(parsedExisting.pathname, ctExisting, modeExisting)) {
      return;
    }
  }

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

async function verifyOwnStagedInventory() {
  const cache = await caches.open(CACHE_NAME);
  const missing = [];
  for (const assetUrl of CRITICAL_PRECACHE_ASSETS) {
    const matched = await cache.match(assetUrl);
    if (!matched || matched.status !== 200) {
      missing.push(assetUrl);
      continue;
    }
    const parsed = new URL(assetUrl, self.location.href);
    const mode = assetUrl === './' || assetUrl.endsWith('.html') ? 'navigate' : 'cors';
    const ct = matched.headers.get('content-type') || '';
    if (!isValidMimeForPath(parsed.pathname, ct, mode)) {
      missing.push(assetUrl);
    }
  }
  return {
    ok: missing.length === 0,
    buildId: RESOLVED_BUILD_ID,
    cacheName: CACHE_NAME,
    verifiedCount: CRITICAL_PRECACHE_ASSETS.length - missing.length,
    totalCritical: CRITICAL_PRECACHE_ASSETS.length,
    missing,
  };
}

// Install: atomically validate critical entry shell/JS/CSS assets so a broken release never activates.
// CRITICAL (V5/V6/V8): NEVER call self.skipWaiting() unconditionally in install.
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

// Activate: keep current & retained caches intact; pruning is strictly client-aware via PRUNE_OBSOLETE_CACHES.
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

async function pruneObsoleteMinadentalCaches(keepBuildIds) {
  const now = Date.now();
  const protectedCaches = new Set([CACHE_NAME]);

  if (Array.isArray(keepBuildIds)) {
    keepBuildIds.forEach((id) => {
      if (typeof id === 'string' && id.trim()) {
        protectedCaches.add(CACHE_PREFIX + id.trim());
      }
    });
  } else if (typeof keepBuildIds === 'string' && keepBuildIds.trim()) {
    protectedCaches.add(CACHE_PREFIX + keepBuildIds.trim());
  }

  // Retain every build currently leased by an open client window (within TTL)
  const openWindows = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).catch(() => []);
  const openIds = new Set(openWindows.map((c) => c.id));
  for (const [leaseKey, lease] of activeClientLeases.entries()) {
    if (now - lease.lastSeenAt > CLIENT_LEASE_TTL_MS && !openIds.has(leaseKey)) {
      activeClientLeases.delete(leaseKey);
      continue;
    }
    if (lease && typeof lease.buildId === 'string' && lease.buildId) {
      protectedCaches.add(CACHE_PREFIX + lease.buildId);
    }
  }

  const keys = await caches.keys();
  await Promise.all(
    keys.map((key) => {
      if (isMinadentalCacheKey(key) && !protectedCaches.has(key)) {
        return caches.delete(key);
      }
      return Promise.resolve(false);
    })
  );
}

// V8 Authenticated MessageChannel & Controlled Activation Protocol
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  // Origin check when source is a WindowClient
  if (event.source && event.source.url) {
    try {
      if (new URL(event.source.url).origin !== self.location.origin) return;
    } catch {
      return;
    }
  }

  if (data.type === 'SKIP_WAITING') {
    // V8: Strictly require explicit targetReleaseId matching this exact worker (zero legacy FORCE_UPDATE bypass!)
    if (!data.targetReleaseId || typeof data.targetReleaseId !== 'string') {
      return;
    }
    if (RESOLVED_BUILD_ID !== 'dev-local' && data.targetReleaseId !== RESOLVED_BUILD_ID) {
      return;
    }
    self.skipWaiting();
  } else if (data.type === 'CLIENT_RELEASE_LEASE') {
    const leaseKey = (event.source && event.source.id) || data.tabId || 'unknown';
    if (typeof data.buildId === 'string' && data.buildId.trim()) {
      activeClientLeases.set(leaseKey, {
        buildId: data.buildId.trim(),
        lastSeenAt: Date.now(),
      });
    }
  } else if (data.type === 'PRUNE_OBSOLETE_CACHES') {
    const retain = [
      data.activeBuildId,
      data.lastKnownGoodBuildId,
      ...(Array.isArray(data.keepBuildIds) ? data.keepBuildIds : []),
    ].filter(Boolean);
    event.waitUntil(pruneObsoleteMinadentalCaches(retain));
  } else if (data.type === 'VERIFY_CACHE_INVENTORY' && event.ports && event.ports[0]) {
    event.waitUntil(
      verifyOwnStagedInventory()
        .then((res) => event.ports[0].postMessage(res))
        .catch(() =>
          event.ports[0].postMessage({
            ok: false,
            buildId: RESOLVED_BUILD_ID,
            cacheName: CACHE_NAME,
            verifiedCount: 0,
            totalCritical: CRITICAL_PRECACHE_ASSETS.length,
            missing: CRITICAL_PRECACHE_ASSETS,
          })
        )
    );
  } else if (data.type === 'GET_BUILD_ID' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({
      buildId: RESOLVED_BUILD_ID,
      cacheName: CACHE_NAME,
      origin: self.location.origin,
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
      // V7/V8: NEVER cache navigation HTML belonging to a DIFFERENT release into this worker's cache
      if (!responseBuildId || RESOLVED_BUILD_ID === 'dev-local' || responseBuildId === RESOLVED_BUILD_ID) {
        const clone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', clone)).catch(() => {});
      }
    }
    return networkResponse;
  } catch {
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
    url.pathname.endsWith('android-release-pointer.json') ||
    url.pathname.endsWith('ios-release-pointer.json') ||
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
