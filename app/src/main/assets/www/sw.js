// MinaDental Unified Service Worker (V10 Resilient Foundation)
// Single source of truth: stamped with deterministic content-derived BUILD_ID during Vite build.
// NOTE: Structural HTML checks below prevent cache poisoning & raw-TSX contamination;
// they are NOT a substitute for cryptographic ECDSA manifest signature verification.
const BUILD_ID = "v4.18.0-aeafc5a1b2";
const RESOLVED_BUILD_ID = BUILD_ID.startsWith('__') ? 'dev-local' : BUILD_ID;
const RELEASE_SEQ_RAW = "230";
const RESOLVED_RELEASE_SEQ = /^\d+$/.test(RELEASE_SEQ_RAW) ? Number(RELEASE_SEQ_RAW) : 0;
const CACHE_PREFIX = 'minadental-shell-';
const CACHE_NAME = CACHE_PREFIX + RESOLVED_BUILD_ID;
const NAVIGATION_TIMEOUT_MS = 4500;
const ASSET_TIMEOUT_MS = 10000;
const CLIENT_LEASE_TTL_MS = 10 * 60 * 1000;
const VALID_BUILD_ID_RE = /^v\d+\.\d+\.\d+-[0-9a-f]{10}$/;

const CRITICAL_PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./assets/index-CylyFnfc.js",
  "./assets/index-BEpPobBr.css"
];

const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./assets/index-CylyFnfc.js",
  "./assets/index-BEpPobBr.css",
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
  '/clinical-records/',
];

const SENSITIVE_QUERY_KEYS = ['access_token', 'refresh_token', 'apikey', 'api_key', 'token'];

const BYPASS_EXTENSIONS = ['.apk', '.mobileconfig', '.idsig', '.ipa'];

// Client-aware release leases: tabId -> { buildId, lastSeenAt }
const activeClientLeases = new Map();

function isMinadentalCacheKey(key) {
  return typeof key === 'string' && key.startsWith('minadental-');
}

function isSensitiveOrApiPath(pathname, search = '') {
  const lower = String(pathname || '').toLowerCase();
  if (BYPASS_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  if (NEVER_CACHE_PATH_PATTERNS.some((pattern) => lower.includes(pattern))) return true;
  if (search) {
    const lowerSearch = String(search).toLowerCase();
    if (SENSITIVE_QUERY_KEYS.some((k) => lowerSearch.includes(k + '='))) return true;
  }
  return false;
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

/**
 * V10 P0 Structural Navigation HTML Validator:
 * Prevents raw TSX, dev-local, captive portals, error pages, or mismatched-build HTML
 * from poisoning the healthy release cache or replacing a verified cached shell.
 * NOTE: Structural integrity check ONLY — cryptographic authenticity is enforced via ECDSA manifest signing.
 */
function validateNavigationHtml(htmlText, expectedBuildId = RESOLVED_BUILD_ID) {
  if (typeof htmlText !== 'string' || htmlText.length < 120) {
    return { valid: false, reason: 'EMPTY_OR_TRUNCATED_HTML', responseBuildId: null };
  }

  // Never accept raw uncompiled TypeScript/TSX entry scripts in cached shell HTML
  if (/<script\b[^>]+src=["'][^"']*\.tsx(?:[?#][^"']*)?["']/i.test(htmlText) || htmlText.includes('src/main.tsx')) {
    return { valid: false, reason: 'RAW_TSX_ENTRY_HTML', responseBuildId: null };
  }

  // Never accept unstamped template placeholders (constructed dynamically so Vite build stamper only stamps BUILD_ID)
  const unstampedBuildToken = '__' + 'MINA_BUILD_ID_VALUE__';
  const unstampedDigestToken = '__' + 'MINA_CONTENT_DIGEST_VALUE__';
  if (htmlText.includes(unstampedBuildToken) || htmlText.includes(unstampedDigestToken)) {
    return { valid: false, reason: 'UNSTAMPED_TEMPLATE_HTML', responseBuildId: null };
  }

  const metaMatch = htmlText.match(/<meta\s+name=["']minadental-build-id["']\s+content=["']([^"']+)["']/i);
  const responseBuildId = metaMatch ? metaMatch[1].trim() : null;
  const seqMatch = htmlText.match(/<meta\s+name=["']minadental-release-seq["']\s+content=["'](\d+)["']/i);
  const responseReleaseSeq = seqMatch ? Number(seqMatch[1]) : 0;
  if (!responseBuildId) {
    return { valid: false, reason: 'MISSING_BUILD_ID_META', responseBuildId: null, responseReleaseSeq };
  }

  const isProdWorker = expectedBuildId !== 'dev-local';
  if (isProdWorker) {
    if (responseBuildId === 'dev-local' || !VALID_BUILD_ID_RE.test(responseBuildId)) {
      return { valid: false, reason: 'INVALID_OR_DEV_BUILD_ID', responseBuildId, responseReleaseSeq };
    }
    if (responseBuildId !== expectedBuildId) {
      return { valid: false, reason: 'BUILD_ID_MISMATCH', responseBuildId, responseReleaseSeq };
    }
    // Require a compiled JS module bundle reference under assets/
    const hasCompiledModuleEntry = /<script\b[^>]*type=["']module["'][^>]*src=["'][^"']*assets\/[^"']+\.(?:m?js)(?:[?#][^"']*)?["']/i.test(htmlText) ||
      /<script\b[^>]*src=["'][^"']*assets\/[^"']+\.(?:m?js)(?:[?#][^"']*)?["'][^>]*type=["']module["']/i.test(htmlText);
    if (!hasCompiledModuleEntry) {
      return { valid: false, reason: 'MISSING_COMPILED_ENTRY_SCRIPT', responseBuildId, responseReleaseSeq };
    }
  }

  return { valid: true, reason: 'OK', responseBuildId, responseReleaseSeq };
}

function isCacheableResponse(request, response, pathname) {
  if (!response || !response.ok || response.status !== 200) return false;
  if (response.type && response.type !== 'basic' && response.type !== 'default') return false;

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

async function safeCachePut(cache, key, response) {
  try {
    await cache.put(key, response.clone());
    if (typeof key === 'string') {
      const absUrl = new URL(key, self.location.href).toString();
      await cache.put(absUrl, response.clone());
    } else if (key instanceof Request) {
      try {
        const parsed = new URL(key.url);
        const relKey = './' + parsed.pathname.split('/').pop();
        await cache.put(relKey, response.clone());
      } catch {}
    }
    return true;
  } catch {
    return false;
  }
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
  const isHtmlAsset = assetUrl === './' || assetUrl.endsWith('.html');

  // Reuse verified candidate bytes already written by UpdateCoordinator if valid in CACHE_NAME
  const preStaged =
    (await cache.match(assetUrl)) ||
    (assetUrl === './' ? await cache.match('./index.html') : undefined);
  if (preStaged && preStaged.ok && preStaged.status === 200) {
    const parsedExisting = new URL(assetUrl, self.location.href);
    const modeExisting = isHtmlAsset ? 'navigate' : 'cors';
    const ctExisting = preStaged.headers.get('content-type') || '';
    if (isValidMimeForPath(parsedExisting.pathname, ctExisting, modeExisting)) {
      if (!isHtmlAsset) return;
      const existingHtml = await preStaged.clone().text().catch(() => '');
      if (validateNavigationHtml(existingHtml).valid) {
        if (assetUrl === './' && !(await cache.match('./'))) {
          await safeCachePut(cache, './', preStaged.clone());
        }
        return;
      }
      await cache.delete(assetUrl).catch(() => {});
    }
  }

  const req = new Request(assetUrl, { cache: 'no-store' });
  const res = await fetchWithTimeout(req, {}, ASSET_TIMEOUT_MS);
  const parsed = new URL(req.url);
  const mode = isHtmlAsset ? 'navigate' : 'cors';
  const ct = res && res.headers ? res.headers.get('content-type') || '' : '';
  const typeValid = !res?.type || res.type === 'basic' || res.type === 'default';
  let valid =
    Boolean(res) &&
    res.ok &&
    res.status === 200 &&
    typeValid &&
    isValidMimeForPath(parsed.pathname, ct, mode);

  if (valid && isHtmlAsset) {
    const htmlProbe = await res.clone().text().catch(() => '');
    const check = validateNavigationHtml(htmlProbe);
    if (!check.valid) {
      valid = false;
    }
  }

  if (!valid) {
    if (isCritical) {
      throw new Error(`Critical precache asset invalid (${res ? res.status : 'NO_RES'}): ${assetUrl}`);
    }
    return;
  }
  const written = await safeCachePut(cache, assetUrl, res);
  if (!written && isCritical) {
    throw new Error(`Critical precache cache write failed (possible storage quota): ${assetUrl}`);
  }
}

async function verifyOwnStagedInventory() {
  const cache = await caches.open(CACHE_NAME);
  const missing = [];
  for (const assetUrl of CRITICAL_PRECACHE_ASSETS) {
    const matched =
      (await cache.match(assetUrl)) ||
      (assetUrl === './' ? await cache.match('./index.html') : undefined);
    if (!matched || matched.status !== 200) {
      missing.push(assetUrl);
      continue;
    }
    const parsed = new URL(assetUrl, self.location.href);
    const isHtml = assetUrl === './' || assetUrl.endsWith('.html');
    const mode = isHtml ? 'navigate' : 'cors';
    const ct = matched.headers.get('content-type') || '';
    if (!isValidMimeForPath(parsed.pathname, ct, mode)) {
      missing.push(assetUrl);
      continue;
    }
    if (isHtml) {
      const htmlText = await matched.clone().text().catch(() => '');
      if (!validateNavigationHtml(htmlText).valid) {
        missing.push(assetUrl);
      }
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
// CRITICAL (V5/V6/V8/V10): NEVER call self.skipWaiting() unconditionally in install.
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

let pendingAuthorizedReloadClientId = null;

// Activate: keep current & retained caches intact; pruning is strictly client-aware via PRUNE_OBSOLETE_CACHES.
// Legacy #166 safety net: if the exact client that authorized SKIP_WAITING still holds its old WindowClient ID
// 900ms after claim (because legacy location.replace on #/settings was a same-document no-op), navigate it once.
self.addEventListener('activate', (event) => {
  const authorizedClientId = pendingAuthorizedReloadClientId;
  pendingAuthorizedReloadClientId = null;
  event.waitUntil(
    self.clients.claim().then(async () => {
      if (!authorizedClientId || typeof self.clients.get !== 'function') return;
      await new Promise((resolve) => setTimeout(resolve, 900));
      const staleClient = await self.clients.get(authorizedClientId).catch(() => undefined);
      if (!staleClient || typeof staleClient.navigate !== 'function' || !staleClient.url) return;
      try {
        const navUrl = new URL(staleClient.url);
        if (navUrl.origin !== self.location.origin) return;
        navUrl.searchParams.set('_sw_reload', RESOLVED_BUILD_ID);
        await staleClient.navigate(navUrl.toString()).catch(() => undefined);
      } catch {
        // Best-effort legacy client recovery; never fail SW activation.
      }
    })
  );
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

// V8/V10 Authenticated MessageChannel & Controlled Activation Protocol
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
    // Strictly require explicit targetReleaseId matching this exact worker (zero legacy FORCE_UPDATE bypass!)
    if (!data.targetReleaseId || typeof data.targetReleaseId !== 'string') {
      return;
    }
    if (RESOLVED_BUILD_ID !== 'dev-local' && data.targetReleaseId !== RESOLVED_BUILD_ID) {
      return;
    }
    if (event.source && typeof event.source.id === 'string' && event.source.id) {
      pendingAuthorizedReloadClientId = event.source.id;
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

async function isVerifiedHtmlResponse(cache, key, hit) {
  if (!hit || hit.status !== 200) return false;
  const ct = hit.headers.get('content-type') || '';
  if (!ct.toLowerCase().includes('text/html')) {
    await cache.delete(key).catch(() => {});
    return false;
  }
  const body = await hit.clone().text().catch(() => '');
  if (validateNavigationHtml(body).valid) {
    return true;
  }
  await cache.delete(key).catch(() => {});
  return false;
}

async function getVerifiedCachedShell(cache, request) {
  const candidates = [request, './index.html', './'];
  for (const key of candidates) {
    let hit = await cache.match(key);
    if (!hit && typeof key !== 'string' && key && typeof key.url === 'string' && key.url.includes('?')) {
      hit = await cache.match(key, { ignoreSearch: true });
    }
    if (await isVerifiedHtmlResponse(cache, key, hit)) {
      return hit;
    }
  }
  return null;
}

async function handleManifestRequest(request, url) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetchWithTimeout(
      request,
      { cache: 'no-cache' },
      NAVIGATION_TIMEOUT_MS
    );
    if (isCacheableResponse(request, networkResponse, url.pathname)) {
      await safeCachePut(cache, './manifest.json', networkResponse.clone());
      return networkResponse;
    }
  } catch {
    // Offline fallback below
  }

  const cached =
    (await cache.match('./manifest.json')) ||
    (await cache.match(request, { ignoreSearch: true }));
  if (cached) {
    const ct = cached.headers.get('content-type') || '';
    if (isValidMimeForPath(url.pathname, ct, request.mode)) {
      return cached;
    }
    await cache.delete('./manifest.json').catch(() => {});
  }
  return new Response('Manifest unavailable offline', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

async function handleNavigationRequest(request, url) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetchWithTimeout(
      request,
      { cache: 'no-store' },
      NAVIGATION_TIMEOUT_MS
    );

    if (isCacheableResponse(request, networkResponse, url.pathname)) {
      const htmlProbe = await networkResponse.clone().text().catch(() => '');
      const validation = validateNavigationHtml(htmlProbe, RESOLVED_BUILD_ID);

      if (validation.valid) {
        const clone = networkResponse.clone();
        await safeCachePut(cache, './index.html', clone);
        return networkResponse;
      }

      // V10/GE-0008 P0: Never cache structurally invalid HTML (raw TSX, dev-local, captive portal, mismatched build).
      // Only pass through mismatched HTML if it is STRICTLY NEWER than this worker's releaseSequence.
      // If a stale CDN (e.g. GitHub Pages 10-min Fastly cache) returns an OLDER index.html after we just
      // activated a newer release, reject the stale network HTML and serve THIS worker's verified cached shell!
      if (
        validation.reason === 'BUILD_ID_MISMATCH' &&
        validation.responseBuildId &&
        VALID_BUILD_ID_RE.test(validation.responseBuildId)
      ) {
        const isStrictlyNewerRelease =
          RESOLVED_RELEASE_SEQ === 0 ||
          (validation.responseReleaseSeq > 0 && validation.responseReleaseSeq > RESOLVED_RELEASE_SEQ);
        if (isStrictlyNewerRelease) {
          const newerCheck = validateNavigationHtml(htmlProbe, validation.responseBuildId);
          if (newerCheck.valid) {
            return networkResponse;
          }
        }
      }

      // Broken/poisoned OR stale-CDN older HTML: fall back to THIS worker's verified cached shell!
      const verifiedFallback = await getVerifiedCachedShell(cache, request);
      if (verifiedFallback) return verifiedFallback;
      return createOfflineHtmlResponse();
    }

    // Non-200 (404/503) or non-HTML navigation response: prefer verified cached shell!
    const cachedShell = await getVerifiedCachedShell(cache, request);
    if (cachedShell) return cachedShell;
    return networkResponse;
  } catch {
    const cachedShell = await getVerifiedCachedShell(cache, request);
    if (cachedShell) return cachedShell;
    return createOfflineHtmlResponse();
  }
}

async function handleStaticAssetRequest(request, url) {
  const cache = await caches.open(CACHE_NAME);
  let cached = await cache.match(request);
  if (!cached) {
    const relKey = './' + url.pathname.split('/').pop();
    cached = await cache.match(relKey);
  }
  if (!cached) {
    cached = await cache.match(url.pathname);
  }
  if (cached) {
    const ct = cached.headers.get('content-type') || '';
    if (isValidMimeForPath(url.pathname, ct, request.mode)) {
      return cached;
    }
    await cache.delete(request).catch(() => {});
  }

  try {
    const networkResponse = await fetchWithTimeout(request, {}, ASSET_TIMEOUT_MS);
    if (isCacheableResponse(request, networkResponse, url.pathname)) {
      const clone = networkResponse.clone();
      await safeCachePut(cache, request, clone);
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
  if (isSensitiveOrApiPath(url.pathname, url.search)) return;

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

  // P0-02 OTA Fix: Never serve stale active CACHE_NAME bytes for no-store/reload checks
  // or immutable versioned /releases/<releaseId>/... assets.
  if (
    request.cache === 'no-store' ||
    request.cache === 'reload' ||
    url.pathname.includes('/releases/')
  ) {
    event.respondWith(
      fetchWithTimeout(request, { cache: 'no-store' }, ASSET_TIMEOUT_MS).catch(
        () =>
          new Response('Versioned asset unavailable offline', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          })
      )
    );
    return;
  }

  // PWA manifest: network-first with verified cache fallback so mobile Chrome/Safari always
  // read the freshest scope, start_url, and icons while preserving offline installability.
  if (url.pathname.endsWith('/manifest.json') || url.pathname === '/manifest.json') {
    event.respondWith(handleManifestRequest(request, url));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request, url));
    return;
  }

  event.respondWith(handleStaticAssetRequest(request, url));
});
