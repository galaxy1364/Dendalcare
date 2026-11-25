import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.cwd();
const SW_PATH = path.resolve(ROOT, 'public/sw.js');

const TEST_BUILD_A = 'v4.9.6-1111111111';
const TEST_BUILD_B = 'v4.9.7-2222222222';
const TEST_ORIGIN = 'https://galaxy1364.github.io';
const TEST_BASE = `${TEST_ORIGIN}/Dendalcare/`;

function makeValidHtml(buildId) {
  return (
    `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="UTF-8">` +
    `<meta name="minadental-build-id" content="${buildId}" />` +
    `<title>مینادنتال</title>` +
    `<script type="module" crossorigin src="./assets/index-abc12345.js"></script>` +
    `</head><body><div id="root"></div></body></html>`
  );
}

function makeRawTsxHtml() {
  return (
    `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="UTF-8">` +
    `<meta name="minadental-build-id" content="dev-local" />` +
    `<title>مینادنتال</title></head><body><div id="root"></div>` +
    `<script type="module" src="./src/main.tsx"></script></body></html>`
  );
}

function makeCaptivePortalHtml() {
  return (
    `<!doctype html><html><head><title>Wi-Fi Login Portal</title></head>` +
    `<body><h1>Please sign in to hotspot network to continue browsing</h1></body></html>`
  );
}

function createSwHarness({ buildId = TEST_BUILD_A, fetchImpl, failQuotaOnPut = false, initialCaches = {} } = {}) {
  const rawSw = fs
    .readFileSync(SW_PATH, 'utf8')
    .replace("'__MINA_BUILD_ID_VALUE__'", JSON.stringify(buildId));

  const cacheStore = new Map();
  for (const [name, entries] of Object.entries(initialCaches)) {
    const map = new Map();
    for (const [k, v] of Object.entries(entries)) {
      map.set(k, v);
    }
    cacheStore.set(name, map);
  }

  function normalizeCacheKey(reqOrStr) {
    if (typeof reqOrStr === 'string') return reqOrStr;
    if (reqOrStr && typeof reqOrStr.url === 'string') return reqOrStr.url;
    return String(reqOrStr);
  }

  const cachesApi = {
    async open(name) {
      if (!cacheStore.has(name)) cacheStore.set(name, new Map());
      const bucket = cacheStore.get(name);
      return {
        async match(key) {
          const k = normalizeCacheKey(key);
          const direct = bucket.get(k);
          if (direct) return direct.clone();
          if (k === `${TEST_BASE}` || k === `${TEST_BASE}index.html`) {
            const fallback = bucket.get('./index.html') || bucket.get('./');
            if (fallback) return fallback.clone();
          }
          return undefined;
        },
        async put(key, response) {
          if (failQuotaOnPut) {
            const err = new Error('Quota exceeded');
            err.name = 'QuotaExceededError';
            throw err;
          }
          bucket.set(normalizeCacheKey(key), response.clone());
        },
        async delete(key) {
          return bucket.delete(normalizeCacheKey(key));
        },
      };
    },
    async keys() {
      return Array.from(cacheStore.keys());
    },
    async delete(name) {
      return cacheStore.delete(name);
    },
    async has(name) {
      return cacheStore.has(name);
    },
  };

  const listeners = new Map();
  let skipWaitingCalled = 0;
  let claimed = 0;
  const postedMessages = [];

  const selfObj = {
    location: {
      origin: TEST_ORIGIN,
      href: `${TEST_BASE}sw.js`,
      pathname: '/Dendalcare/sw.js',
    },
    registration: { active: { state: 'activated' } },
    clients: {
      async claim() {
        claimed += 1;
      },
      async matchAll() {
        return [{ id: 'tab-1', postMessage: (msg) => postedMessages.push(msg) }];
      },
    },
    skipWaiting() {
      skipWaitingCalled += 1;
      return Promise.resolve();
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
  };

  const sandbox = {
    self: selfObj,
    caches: cachesApi,
    fetch: fetchImpl || (async () => new Response('Not mocked', { status: 500 })),
    Request: class FakeRequest {
      constructor(url, init = {}) {
        this.url = url instanceof URL ? url.toString() : new URL(String(url), TEST_BASE).toString();
        this.method = init.method || 'GET';
        this.mode = init.mode || 'cors';
        this.headers = new Headers(init.headers || {});
      }
    },
    Response,
    Headers,
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    Promise,
    Map,
    Set,
    Date,
    Array,
    Object,
    String,
    RegExp,
    Error,
  };

  vm.runInNewContext(rawSw, sandbox, { filename: 'public/sw.js' });

  async function dispatchFetch(req) {
    let responsePromise = null;
    let handled = false;
    const event = {
      request: req,
      respondWith(p) {
        handled = true;
        responsePromise = Promise.resolve(p);
      },
    };
    for (const fn of listeners.get('fetch') || []) {
      fn(event);
    }
    if (!handled) return { handled: false, response: null };
    return { handled: true, response: await responsePromise };
  }

  async function dispatchMessage(data, { origin = TEST_ORIGIN, withPort = false } = {}) {
    const portReplies = [];
    const waitPromises = [];
    const event = {
      data,
      source: { id: 'tab-1', url: `${origin}/Dendalcare/` },
      ports: withPort ? [{ postMessage: (m) => portReplies.push(m) }] : [],
      waitUntil(p) {
        waitPromises.push(Promise.resolve(p));
      },
    };
    for (const fn of listeners.get('message') || []) {
      fn(event);
    }
    await Promise.all(waitPromises);
    return portReplies;
  }

  return {
    cacheStore,
    cachesApi,
    dispatchFetch,
    dispatchMessage,
    getSkipWaitingCount: () => skipWaitingCalled,
    getClaimCount: () => claimed,
    postedMessages,
  };
}

describe('MinaDental V10 P0 — Service Worker Navigation Structural Validation & Cache Poisoning Immunity', () => {
  test('V10-SW-01: Valid build-matched compiled HTML is served and cached in active shell cache', async () => {
    const validHtml = makeValidHtml(TEST_BUILD_A);
    const sw = createSwHarness({
      buildId: TEST_BUILD_A,
      fetchImpl: async () =>
        new Response(validHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
    });

    const { handled, response } = await sw.dispatchFetch({
      url: TEST_BASE,
      method: 'GET',
      mode: 'navigate',
      headers: new Headers(),
    });

    assert.equal(handled, true);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), validHtml);
    const bucket = sw.cacheStore.get(`minadental-shell-${TEST_BUILD_A}`);
    assert.ok(bucket && bucket.has('./index.html'), 'Valid build HTML must be cached under ./index.html');
  });

  test('V10-SW-02: Raw TSX (src/main.tsx) or dev-local HTML is REJECTED from cache and falls back to healthy cached shell', async () => {
    const healthyHtml = makeValidHtml(TEST_BUILD_A);
    const sw = createSwHarness({
      buildId: TEST_BUILD_A,
      initialCaches: {
        [`minadental-shell-${TEST_BUILD_A}`]: {
          './index.html': new Response(healthyHtml, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
        },
      },
      fetchImpl: async () =>
        new Response(makeRawTsxHtml(), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
    });

    const { response } = await sw.dispatchFetch({
      url: TEST_BASE,
      method: 'GET',
      mode: 'navigate',
      headers: new Headers(),
    });

    const servedText = await response.text();
    assert.equal(response.status, 200);
    assert.equal(servedText, healthyHtml, 'SW must serve verified cached shell instead of raw TSX');
    const cachedHtml = await sw.cacheStore.get(`minadental-shell-${TEST_BUILD_A}`).get('./index.html').text();
    assert.equal(cachedHtml, healthyHtml, 'Healthy shell cache must NOT be poisoned by raw TSX');
  });

  test('V10-SW-03: Mismatched newer build HTML is served cleanly without poisoning current worker cache', async () => {
    const healthyA = makeValidHtml(TEST_BUILD_A);
    const newerB = makeValidHtml(TEST_BUILD_B);
    const sw = createSwHarness({
      buildId: TEST_BUILD_A,
      initialCaches: {
        [`minadental-shell-${TEST_BUILD_A}`]: {
          './index.html': new Response(healthyA, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
        },
      },
      fetchImpl: async () =>
        new Response(newerB, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
    });

    const { response } = await sw.dispatchFetch({
      url: TEST_BASE,
      method: 'GET',
      mode: 'navigate',
      headers: new Headers(),
    });

    assert.equal(await response.text(), newerB, 'Valid newer compiled HTML may pass through on navigation');
    const cachedHtml = await sw.cacheStore.get(`minadental-shell-${TEST_BUILD_A}`).get('./index.html').text();
    assert.equal(cachedHtml, healthyA, 'Worker A cache MUST retain build A and NEVER store build B HTML');
  });

  test('V10-SW-04: Captive portal HTML without minadental-build-id or compiled entry script NEVER poisons cache', async () => {
    const healthyA = makeValidHtml(TEST_BUILD_A);
    const sw = createSwHarness({
      buildId: TEST_BUILD_A,
      initialCaches: {
        [`minadental-shell-${TEST_BUILD_A}`]: {
          './index.html': new Response(healthyA, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
        },
      },
      fetchImpl: async () =>
        new Response(makeCaptivePortalHtml(), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
    });

    const { response } = await sw.dispatchFetch({
      url: TEST_BASE,
      method: 'GET',
      mode: 'navigate',
      headers: new Headers(),
    });

    assert.equal(await response.text(), healthyA, 'Captive portal HTML must fall back to verified cached shell');
  });

  test('V10-SW-05: HTTP 404/503 or offline navigation falls back to healthy cached shell (or 503 offline HTML if empty)', async () => {
    const healthyA = makeValidHtml(TEST_BUILD_A);
    const swWithCache = createSwHarness({
      buildId: TEST_BUILD_A,
      initialCaches: {
        [`minadental-shell-${TEST_BUILD_A}`]: {
          './index.html': new Response(healthyA, {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          }),
        },
      },
      fetchImpl: async () => new Response('Service Unavailable', { status: 503, headers: { 'Content-Type': 'text/html' } }),
    });

    const resWithCache = await swWithCache.dispatchFetch({
      url: TEST_BASE,
      method: 'GET',
      mode: 'navigate',
      headers: new Headers(),
    });
    assert.equal(resWithCache.response.status, 200);
    assert.equal(await resWithCache.response.text(), healthyA);

    const swEmpty = createSwHarness({
      buildId: TEST_BUILD_A,
      fetchImpl: async () => {
        throw new Error('Network offline');
      },
    });
    const resEmpty = await swEmpty.dispatchFetch({
      url: TEST_BASE,
      method: 'GET',
      mode: 'navigate',
      headers: new Headers(),
    });
    assert.equal(resEmpty.response.status, 503);
    assert.ok((await resEmpty.response.text()).includes('اتصال اینترنت برقرار نیست'));
  });

  test('V10-SW-06: HTML-for-JS MIME is never cached and QuotaExceededError on cache.put does not crash response', async () => {
    const swMime = createSwHarness({
      buildId: TEST_BUILD_A,
      fetchImpl: async () =>
        new Response('<html>404</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
    });

    const jsUrl = `${TEST_BASE}assets/chunk-123.js`;
    await swMime.dispatchFetch({
      url: jsUrl,
      method: 'GET',
      mode: 'cors',
      headers: new Headers(),
    });
    const bucket = swMime.cacheStore.get(`minadental-shell-${TEST_BUILD_A}`);
    assert.equal(bucket?.has(jsUrl) ?? false, false, 'HTML-for-JS MIME must NEVER be cached');

    const swQuota = createSwHarness({
      buildId: TEST_BUILD_A,
      failQuotaOnPut: true,
      fetchImpl: async () =>
        new Response(makeValidHtml(TEST_BUILD_A), {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        }),
    });

    const quotaRes = await swQuota.dispatchFetch({
      url: TEST_BASE,
      method: 'GET',
      mode: 'navigate',
      headers: new Headers(),
    });
    assert.equal(quotaRes.response.status, 200, 'QuotaExceededError during cache write must still return valid network response');
  });

  test('V10-SW-07: Sensitive API / Auth / token query URLs bypass SW cache; PRUNE preserves LKG, leased & third-party caches', async () => {
    const sw = createSwHarness({
      buildId: TEST_BUILD_B,
      initialCaches: {
        [`minadental-shell-${TEST_BUILD_B}`]: {},
        [`minadental-shell-${TEST_BUILD_A}`]: {},
        'minadental-shell-v4.0.0-0000000000': {},
        'other-app-cache-v1': {},
      },
    });

    const apiBypass = await sw.dispatchFetch({
      url: `${TEST_ORIGIN}/rest/v1/patients`,
      method: 'GET',
      mode: 'cors',
      headers: new Headers(),
    });
    assert.equal(apiBypass.handled, false, '/rest/v1/ must bypass Service Worker');

    const tokenBypass = await sw.dispatchFetch({
      url: `${TEST_BASE}export?access_token=secret123`,
      method: 'GET',
      mode: 'cors',
      headers: new Headers(),
    });
    assert.equal(tokenBypass.handled, false, 'Tokenized query URLs must bypass Service Worker');

    const authBypass = await sw.dispatchFetch({
      url: `${TEST_BASE}assets/private.js`,
      method: 'GET',
      mode: 'cors',
      headers: new Headers({ authorization: 'Bearer abc' }),
    });
    assert.equal(authBypass.handled, false, 'Authenticated requests must bypass Service Worker');

    await sw.dispatchMessage({
      type: 'PRUNE_OBSOLETE_CACHES',
      activeBuildId: TEST_BUILD_B,
      lastKnownGoodBuildId: TEST_BUILD_A,
    });

    assert.equal(await sw.cachesApi.has(`minadental-shell-${TEST_BUILD_B}`), true, 'Active cache kept');
    assert.equal(await sw.cachesApi.has(`minadental-shell-${TEST_BUILD_A}`), true, 'Last-known-good cache kept');
    assert.equal(await sw.cachesApi.has('minadental-shell-v4.0.0-0000000000'), false, 'Obsolete minadental cache pruned');
    assert.equal(await sw.cachesApi.has('other-app-cache-v1'), true, 'Unrelated third-party cache MUST be preserved');
  });

  test('V10-SW-08: SKIP_WAITING rejects missing/mismatched targetReleaseId and cross-origin messages', async () => {
    const sw = createSwHarness({ buildId: TEST_BUILD_B });

    await sw.dispatchMessage({ type: 'SKIP_WAITING' });
    assert.equal(sw.getSkipWaitingCount(), 0, 'Missing targetReleaseId must be ignored');

    await sw.dispatchMessage({ type: 'SKIP_WAITING', targetReleaseId: TEST_BUILD_A });
    assert.equal(sw.getSkipWaitingCount(), 0, 'Mismatched targetReleaseId must be ignored');

    await sw.dispatchMessage({ type: 'SKIP_WAITING', targetReleaseId: TEST_BUILD_B }, { origin: 'https://evil.example' });
    assert.equal(sw.getSkipWaitingCount(), 0, 'Cross-origin message must be rejected');

    await sw.dispatchMessage({ type: 'SKIP_WAITING', targetReleaseId: TEST_BUILD_B });
    assert.equal(sw.getSkipWaitingCount(), 1, 'Exact same-origin targetReleaseId triggers controlled skipWaiting');
  });
});
