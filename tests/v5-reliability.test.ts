import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  executeRealtimeTableFetch,
  reconcileServerRows,
  shouldAcceptTableResponse,
  type TableDataStatus,
} from '../src/lib/useRealtimeTable';
import {
  evaluateDashboardSourceStatuses,
  runSettledDashboardRefresh,
} from '../src/features/dashboard/dashboard.service';
import type { DashboardSourceKey } from '../src/features/dashboard/dashboard.types';
import {
  createBootstrapMachine,
  sanitizeLogMessage,
} from '../src/app/bootstrapState';
import { importWithRetry } from '../src/app/lazyWithRetry';
import { isChunkLoadError } from '../src/components/ErrorBoundary';

export interface V5TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const instantDelay = async () => {};

function allSourceStatuses(fill: TableDataStatus): Record<DashboardSourceKey, TableDataStatus> {
  return {
    patients: fill,
    appointments: fill,
    treatments: fill,
    lab_orders: fill,
    implants: fill,
    payments: fill,
    inventory: fill,
    reminders: fill,
    finance_transactions: fill,
    installments: fill,
    checks: fill,
    safteh: fill,
    clinic_settings: fill,
    staff: fill,
  };
}

export async function runAllV5ReliabilityTests(): Promise<V5TestResult[]> {
  const cases: Array<{ name: string; fn: () => Promise<void> | void }> = [
    {
      name: 'V5-01 [P0-02]: Hanging request times out per-attempt without aborting parentSignal and terminates with status=timeout (never stuck loading)',
      fn: async () => {
        const parentController = new AbortController();
        let attemptSignalsAborted = 0;

        const res = await executeRealtimeTableFetch<{ id: string }>({
          parentSignal: parentController.signal,
          maxRetries: 2,
          timeoutMs: 25,
          baseBackoffMs: 1,
          delayFn: instantDelay,
          randomFn: () => 0.5,
          fetchPage: ({ signal }) =>
            new Promise((_resolve) => {
              signal.addEventListener('abort', () => {
                attemptSignalsAborted += 1;
              });
            }),
        });

        assert.equal(parentController.signal.aborted, false, 'Parent signal must NOT be aborted by network timeout');
        assert.equal(res.cancelled, false);
        assert.equal(res.timedOut, true);
        assert.equal(res.attempts, 3, 'Must execute 1 initial attempt + 2 retries');
        assert.equal(attemptSignalsAborted, 3, 'Every timed-out attempt must abort its own per-attempt controller');

        const accepted = shouldAcceptTableResponse({
          requestSeq: 1,
          currentSeq: 1,
          requestScopeKey: 't1::b1::u1',
          activeScopeKey: 't1::b1::u1',
          aborted: parentController.signal.aborted,
          mounted: true,
        });
        assert.equal(accepted, true, 'Timed-out response must be accepted so loading terminates cleanly');

        const reconciled = reconcileServerRows({
          serverRows: res.rows,
          error: res.error,
          isOffline: false,
          timedOut: res.timedOut,
        });
        assert.equal(reconciled.status, 'timeout');
        assert.equal(reconciled.isStale, true);
      },
    },
    {
      name: 'V5-02 [P0-02]: Transient failure recovers on retry with bounded jittered exponential backoff',
      fn: async () => {
        const parentController = new AbortController();
        const observedDelays: number[] = [];
        let callCount = 0;

        const res = await executeRealtimeTableFetch<{ id: string }>({
          parentSignal: parentController.signal,
          maxRetries: 2,
          timeoutMs: 200,
          baseBackoffMs: 100,
          randomFn: () => 0.4,
          delayFn: async (ms) => {
            observedDelays.push(ms);
          },
          fetchPage: async () => {
            callCount += 1;
            if (callCount < 3) {
              return { rows: null, error: { message: 'Temporary 503', status: 503 } };
            }
            return { rows: [{ id: 'row-ok' }], error: null };
          },
        });

        assert.equal(res.cancelled, false);
        assert.equal(res.timedOut, false);
        assert.equal(res.error, null);
        assert.equal(res.rows?.length, 1);
        assert.equal(res.attempts, 3);
        // Attempt 1 delay: 100 + 100*0.25*0.4 = 110; Attempt 2 delay: 200 + 200*0.25*0.4 = 220
        assert.deepEqual(observedDelays, [110, 220]);
      },
    },
    {
      name: 'V5-03 [P0-02]: Retry exhaustion terminates cleanly with error status',
      fn: async () => {
        const parentController = new AbortController();
        const res = await executeRealtimeTableFetch<{ id: string }>({
          parentSignal: parentController.signal,
          maxRetries: 2,
          timeoutMs: 100,
          delayFn: instantDelay,
          fetchPage: async () => ({ rows: null, error: { message: '502 Bad Gateway', status: 502 } }),
        });

        assert.equal(res.attempts, 3);
        assert.equal(res.timedOut, false);
        assert.equal(res.cancelled, false);
        const reconciled = reconcileServerRows({
          serverRows: res.rows,
          error: res.error,
          isOffline: false,
          timedOut: res.timedOut,
        });
        assert.equal(reconciled.status, 'error');
      },
    },
    {
      name: 'V5-04 [P0-02]: Non-retryable 42703 migration_required & 403 unauthorized exit immediately on attempt 1',
      fn: async () => {
        const parentController = new AbortController();
        const migRes = await executeRealtimeTableFetch<{ id: string }>({
          parentSignal: parentController.signal,
          maxRetries: 3,
          delayFn: instantDelay,
          fetchPage: async () => ({ rows: null, error: { code: '42703', message: 'column tenant_id does not exist' } }),
        });
        assert.equal(migRes.attempts, 1, '42703 must not retry');
        assert.equal(
          reconcileServerRows({ serverRows: migRes.rows, error: migRes.error, isOffline: false }).status,
          'migration_required'
        );

        const authRes = await executeRealtimeTableFetch<{ id: string }>({
          parentSignal: parentController.signal,
          maxRetries: 3,
          delayFn: instantDelay,
          fetchPage: async () => ({ rows: null, error: { status: 403, code: '42501', message: 'permission denied' } }),
        });
        assert.equal(authRes.attempts, 1, '403/42501 must not retry');
        assert.equal(
          reconcileServerRows({ serverRows: authRes.rows, error: authRes.error, isOffline: false }).status,
          'unauthorized'
        );
      },
    },
    {
      name: 'V5-05 [P0-02]: Account/branch switch aborts parentSignal and rejects late stale response',
      fn: async () => {
        const parentController = new AbortController();
        const promise = executeRealtimeTableFetch<{ id: string }>({
          parentSignal: parentController.signal,
          maxRetries: 2,
          timeoutMs: 500,
          delayFn: instantDelay,
          fetchPage: ({ signal }) =>
            new Promise((resolve) => {
              signal.addEventListener('abort', () => {
                resolve({ rows: [{ id: 'stale-user-A' }], error: null });
              });
            }),
        });

        parentController.abort();
        const res = await promise;
        assert.equal(res.cancelled, true, 'Parent abort must mark fetch cancelled');
        assert.equal(res.rows, null, 'Cancelled request must never return stale rows');

        assert.equal(
          shouldAcceptTableResponse({
            requestSeq: 1,
            currentSeq: 2,
            requestScopeKey: 't1::b1::userA',
            activeScopeKey: 't1::b1::userB',
            aborted: false,
            mounted: true,
          }),
          false,
          'Superseded sequence & scope must be rejected'
        );
      },
    },
    {
      name: 'V5-06 [P0-02]: Pagination fetchAllPages detects true end-of-data vs ceiling truncation (partial) & empty',
      fn: async () => {
        const parentController = new AbortController();

        const fullRes = await executeRealtimeTableFetch<{ id: string }>({
          parentSignal: parentController.signal,
          fetchAllPages: true,
          pageSize: 2,
          maxPages: 5,
          fetchPage: async ({ from }) => {
            if (from === 0) return { rows: [{ id: '1' }, { id: '2' }], error: null };
            return { rows: [{ id: '3' }], error: null };
          },
        });
        assert.equal(fullRes.truncated, false);
        assert.equal(fullRes.rows?.length, 3);
        assert.equal(
          reconcileServerRows({ serverRows: fullRes.rows, error: null, isOffline: false, truncated: fullRes.truncated }).status,
          'ready'
        );

        const partialRes = await executeRealtimeTableFetch<{ id: string }>({
          parentSignal: parentController.signal,
          fetchAllPages: true,
          pageSize: 2,
          maxPages: 2,
          fetchPage: async ({ from }) => ({ rows: [{ id: `${from}` }, { id: `${from + 1}` }], error: null }),
        });
        assert.equal(partialRes.truncated, true);
        assert.equal(partialRes.rows?.length, 4);
        assert.equal(
          reconcileServerRows({ serverRows: partialRes.rows, error: null, isOffline: false, truncated: partialRes.truncated }).status,
          'partial'
        );

        const emptyRec = reconcileServerRows({ serverRows: [], error: null, isOffline: false });
        assert.equal(emptyRec.status, 'empty');
        assert.equal(emptyRec.clearCache, true);
      },
    },
    {
      name: 'V5-07 [P0-02]: React StrictMode double mount/unmount/remount cancels mount 1 cleanly and commits mount 2',
      fn: async () => {
        let reqSeq = 0;
        const mount1Controller = new AbortController();
        const seq1 = ++reqSeq;
        const mount1Promise = executeRealtimeTableFetch<{ id: string }>({
          parentSignal: mount1Controller.signal,
          timeoutMs: 200,
          fetchPage: ({ signal }) =>
            new Promise((resolve) => {
              signal.addEventListener('abort', () => resolve({ rows: [{ id: 'mount1' }], error: null }));
            }),
        });

        // StrictMode unmounts mount 1 and immediately mounts mount 2
        mount1Controller.abort();
        const mount2Controller = new AbortController();
        const seq2 = ++reqSeq;
        const mount2Res = await executeRealtimeTableFetch<{ id: string }>({
          parentSignal: mount2Controller.signal,
          timeoutMs: 200,
          fetchPage: async () => ({ rows: [{ id: 'mount2-live' }], error: null }),
        });
        const mount1Res = await mount1Promise;

        assert.equal(mount1Res.cancelled, true);
        assert.equal(
          shouldAcceptTableResponse({
            requestSeq: seq1,
            currentSeq: reqSeq,
            requestScopeKey: 't1::b1::u1',
            activeScopeKey: 't1::b1::u1',
            aborted: mount1Controller.signal.aborted,
            mounted: true,
          }),
          false
        );
        assert.equal(mount2Res.cancelled, false);
        assert.equal(mount2Res.rows?.[0]?.id, 'mount2-live');
        assert.equal(
          shouldAcceptTableResponse({
            requestSeq: seq2,
            currentSeq: reqSeq,
            requestScopeKey: 't1::b1::u1',
            activeScopeKey: 't1::b1::u1',
            aborted: mount2Controller.signal.aborted,
            mounted: true,
          }),
          true
        );
      },
    },
    {
      name: 'V5-08 [P0-02]: Dashboard evaluateDashboardSourceStatuses handles timeout & runSettledDashboardRefresh isolates partial failures',
      fn: async () => {
        const statuses = allSourceStatuses('ready');
        statuses.appointments = 'timeout';
        const agg = evaluateDashboardSourceStatuses(statuses, {
          isStale: true,
          isLoading: false,
          errorMessage: 'Timeout',
          serverSummaryValid: false,
        });
        assert.equal(agg.overall, 'timeout');
        assert.ok(agg.incompleteSources.includes('appointments'));

        const refreshRes = await runSettledDashboardRefresh([
          { key: 'rpc_summary', run: async () => 'ok' },
          { key: 'patients', run: async () => { throw new Error('network'); } },
          { key: 'appointments', run: async () => 'ok' },
        ]);
        assert.equal(refreshRes.ok, false);
        assert.equal(refreshRes.total, 3);
        assert.equal(refreshRes.succeeded, 2);
        assert.equal(refreshRes.failed, 1);
        assert.deepEqual(refreshRes.failedKeys, ['patients']);
      },
    },
    {
      name: 'V5-09 [P0-03]: Service Worker behavioral verification — cache fallback ordering, build identity, storage failures, offline recovery, corrupted HTML rejection & cross-release isolation',
      fn: async () => {
        const SW_PATH = path.resolve(process.cwd(), 'public/sw.js');
        const ORIGIN = 'https://galaxy1364.github.io';
        const BASE = `${ORIGIN}/Dendalcare/`;
        const BUILD_A = 'v4.9.6-aaaaaaaaaa';
        const BUILD_B = 'v4.9.7-bbbbbbbbbb';
        const BUILD_OLD = 'v4.0.0-0000000000';

        const makeHtml = (buildId: string, label = buildId) =>
          `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="UTF-8">` +
          `<meta name="minadental-build-id" content="${buildId}" />` +
          `<title>مینادنتال ${label}</title>` +
          `<script type="module" crossorigin src="./assets/index-12345678.js"></script>` +
          `</head><body><div id="root">${label}</div></body></html>`;

        const keyToStr = (k: unknown): string => {
          if (typeof k === 'string') return k;
          if (k && typeof (k as { url?: string }).url === 'string') return (k as { url: string }).url;
          return String(k);
        };

        const createSwRuntime = (opts: {
          buildId?: string | null;
          fetchImpl?: (req: Request | string, init?: RequestInit) => Promise<Response>;
          failQuotaOnPut?: boolean;
          failDelete?: boolean;
          initialCaches?: Record<string, Record<string, Response>>;
        } = {}) => {
          const raw = fs.readFileSync(SW_PATH, 'utf8');
          const stamped =
            opts.buildId === null
              ? raw
              : raw.replace("'__MINA_BUILD_ID_VALUE__'", JSON.stringify(opts.buildId ?? BUILD_A));

          const cacheStore = new Map<string, Map<string, Response>>();
          for (const [cacheName, entries] of Object.entries(opts.initialCaches || {})) {
            const bucket = new Map<string, Response>();
            for (const [k, v] of Object.entries(entries)) {
              bucket.set(k, v);
            }
            cacheStore.set(cacheName, bucket);
          }

          const matchCalls: Array<{ cacheName: string; key: string }> = [];
          const deleteCalls: Array<{ cacheName: string; key: string }> = [];
          const putCalls: Array<{ cacheName: string; key: string }> = [];

          const cachesApi = {
            async open(name: string) {
              if (!cacheStore.has(name)) cacheStore.set(name, new Map());
              const bucket = cacheStore.get(name)!;
              return {
                async match(key: unknown) {
                  const k = keyToStr(key);
                  matchCalls.push({ cacheName: name, key: k });
                  const hit = bucket.get(k);
                  return hit ? hit.clone() : undefined;
                },
                async put(key: unknown, response: Response) {
                  const k = keyToStr(key);
                  if (opts.failQuotaOnPut) {
                    const err = new Error('QuotaExceededError: storage full');
                    err.name = 'QuotaExceededError';
                    throw err;
                  }
                  putCalls.push({ cacheName: name, key: k });
                  bucket.set(k, response.clone());
                },
                async delete(key: unknown) {
                  const k = keyToStr(key);
                  deleteCalls.push({ cacheName: name, key: k });
                  if (opts.failDelete) {
                    throw new Error('Cache delete I/O failure');
                  }
                  return bucket.delete(k);
                },
              };
            },
            async keys() {
              return Array.from(cacheStore.keys());
            },
            async delete(name: string) {
              return cacheStore.delete(name);
            },
            async has(name: string) {
              return cacheStore.has(name);
            },
          };

          const listeners = new Map<string, Array<(ev: any) => void>>();
          let skipWaitingCount = 0;
          const postedMessages: unknown[] = [];

          const selfObj = {
            location: { origin: ORIGIN, href: `${BASE}sw.js`, pathname: '/Dendalcare/sw.js' },
            registration: { active: { state: 'activated' } },
            clients: {
              async claim() {},
              async matchAll() {
                return [{ id: 'tab-1', postMessage: (msg: unknown) => postedMessages.push(msg) }];
              },
            },
            skipWaiting() {
              skipWaitingCount += 1;
              return Promise.resolve();
            },
            addEventListener(type: string, fn: (ev: any) => void) {
              if (!listeners.has(type)) listeners.set(type, []);
              listeners.get(type)!.push(fn);
            },
          };

          const sandbox = {
            self: selfObj,
            caches: cachesApi,
            fetch: opts.fetchImpl || (async () => new Response('Not mocked', { status: 500 })),
            Request: class FakeRequest {
              url: string;
              method: string;
              mode: string;
              headers: Headers;
              constructor(url: string | URL, init: RequestInit = {}) {
                this.url = url instanceof URL ? url.toString() : new URL(String(url), BASE).toString();
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

          vm.runInNewContext(stamped, sandbox, { filename: 'public/sw.js' });

          const dispatchInstall = async () => {
            const waits: Promise<unknown>[] = [];
            for (const fn of listeners.get('install') || []) {
              fn({ waitUntil: (p: Promise<unknown>) => waits.push(Promise.resolve(p)) });
            }
            await Promise.all(waits);
          };

          const dispatchFetch = async (req: { url: string; method?: string; mode?: string; headers?: Headers }) => {
            let handled = false;
            let resPromise: Promise<Response> | null = null;
            const event = {
              request: {
                url: req.url,
                method: req.method || 'GET',
                mode: req.mode || 'navigate',
                headers: req.headers || new Headers(),
              },
              respondWith(p: Promise<Response> | Response) {
                handled = true;
                resPromise = Promise.resolve(p);
              },
            };
            for (const fn of listeners.get('fetch') || []) fn(event);
            if (!handled) return { handled: false, response: null as Response | null };
            return { handled: true, response: await resPromise! };
          };

          const dispatchMessage = async (data: unknown, { origin = ORIGIN, tabId = 'tab-1' } = {}) => {
            const replies: unknown[] = [];
            const waits: Promise<unknown>[] = [];
            const event = {
              data,
              source: { id: tabId, url: `${origin}/Dendalcare/` },
              ports: [{ postMessage: (m: unknown) => replies.push(m) }],
              waitUntil: (p: Promise<unknown>) => waits.push(Promise.resolve(p)),
            };
            for (const fn of listeners.get('message') || []) fn(event);
            await Promise.all(waits);
            return replies;
          };

          return {
            cacheStore,
            cachesApi,
            matchCalls,
            deleteCalls,
            putCalls,
            postedMessages,
            dispatchInstall,
            dispatchFetch,
            dispatchMessage,
            getSkipWaitingCount: () => skipWaitingCount,
          };
        };

        // 1. Build identity validation (production buildId vs unstamped dev-local) + non-abrupt install
        const devSw = createSwRuntime({ buildId: null });
        const devInfo = (await devSw.dispatchMessage({ type: 'GET_BUILD_ID' }))[0] as { buildId: string; cacheName: string };
        assert.equal(devInfo.buildId, 'dev-local');
        assert.equal(devInfo.cacheName, 'minadental-shell-dev-local');

        const prodSw = createSwRuntime({
          buildId: BUILD_A,
          fetchImpl: async (req) => {
            const u = typeof req === 'string' ? req : req.url;
            if (u.endsWith('/') || u.endsWith('.html')) {
              return new Response(makeHtml(BUILD_A), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
            }
            if (u.endsWith('.json')) {
              return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (u.endsWith('.svg')) {
              return new Response('<svg/>', { status: 200, headers: { 'Content-Type': 'image/svg+xml' } });
            }
            return new Response('ok', { status: 200, headers: { 'Content-Type': 'image/png' } });
          },
        });
        const prodInfo = (await prodSw.dispatchMessage({ type: 'GET_BUILD_ID' }))[0] as { buildId: string; cacheName: string };
        assert.equal(prodInfo.buildId, BUILD_A);
        assert.equal(prodInfo.cacheName, `minadental-shell-${BUILD_A}`);
        await prodSw.dispatchInstall();
        assert.equal(prodSw.getSkipWaitingCount(), 0, 'install MUST NOT call skipWaiting() abruptly');
        assert.ok(
          prodSw.postedMessages.some((m: any) => m?.type === 'SW_UPDATE_READY' && m?.buildId === BUILD_A),
          'install must emit SW_UPDATE_READY with exact buildId when active worker exists'
        );

        // 2. Cache fallback ordering: request -> ./index.html -> ./ -> 503 offline HTML
        const navUrl = `${BASE}patients`;
        const offlineFetch = async () => {
          throw new Error('Offline');
        };

        // 2a: Exact request cached -> stops at request
        const swReqHit = createSwRuntime({
          buildId: BUILD_A,
          fetchImpl: offlineFetch,
          initialCaches: {
            [`minadental-shell-${BUILD_A}`]: {
              [navUrl]: new Response(makeHtml(BUILD_A, 'REQ_SHELL'), { status: 200, headers: { 'Content-Type': 'text/html' } }),
              './index.html': new Response(makeHtml(BUILD_A, 'INDEX_SHELL'), { status: 200, headers: { 'Content-Type': 'text/html' } }),
            },
          },
        });
        const res2a = await swReqHit.dispatchFetch({ url: navUrl, mode: 'navigate' });
        assert.equal(res2a.response?.status, 200);
        assert.ok((await res2a.response!.text()).includes('REQ_SHELL'));
        assert.deepEqual(swReqHit.matchCalls.map((c) => c.key), [navUrl]);

        // 2b: Request miss -> falls back cleanly to ./index.html before ./
        const swIndexHit = createSwRuntime({
          buildId: BUILD_A,
          fetchImpl: offlineFetch,
          initialCaches: {
            [`minadental-shell-${BUILD_A}`]: {
              './index.html': new Response(makeHtml(BUILD_A, 'INDEX_SHELL'), { status: 200, headers: { 'Content-Type': 'text/html' } }),
              './': new Response(makeHtml(BUILD_A, 'ROOT_SHELL'), { status: 200, headers: { 'Content-Type': 'text/html' } }),
            },
          },
        });
        const res2b = await swIndexHit.dispatchFetch({ url: navUrl, mode: 'navigate' });
        assert.equal(res2b.response?.status, 200);
        assert.ok((await res2b.response!.text()).includes('INDEX_SHELL'));
        assert.deepEqual(swIndexHit.matchCalls.map((c) => c.key), [navUrl, './index.html']);

        // 2c: Request + ./index.html miss -> falls back cleanly to ./
        const swRootHit = createSwRuntime({
          buildId: BUILD_A,
          fetchImpl: offlineFetch,
          initialCaches: {
            [`minadental-shell-${BUILD_A}`]: {
              './': new Response(makeHtml(BUILD_A, 'ROOT_SHELL'), { status: 200, headers: { 'Content-Type': 'text/html' } }),
            },
          },
        });
        const res2c = await swRootHit.dispatchFetch({ url: navUrl, mode: 'navigate' });
        assert.equal(res2c.response?.status, 200);
        assert.ok((await res2c.response!.text()).includes('ROOT_SHELL'));
        assert.deepEqual(swRootHit.matchCalls.map((c) => c.key), [navUrl, './index.html', './']);

        // 2d: Empty cache offline recovery -> guaranteed 503 offline HTML Response (never undefined/crash)
        const swEmptyOffline = createSwRuntime({ buildId: BUILD_A, fetchImpl: offlineFetch });
        const res2d = await swEmptyOffline.dispatchFetch({ url: navUrl, mode: 'navigate' });
        assert.equal(res2d.response?.status, 503);
        assert.ok((res2d.response?.headers.get('content-type') || '').includes('text/html'));
        assert.ok((await res2d.response!.text()).includes('اتصال اینترنت برقرار نیست'));
        assert.deepEqual(swEmptyOffline.matchCalls.map((c) => c.key), [navUrl, './index.html', './']);

        // 3. Corrupted HTML rejection (network & cached) + self-healing purge + delete error isolation
        const rawTsxHtml = '<!doctype html><html><head><meta name="minadental-build-id" content="dev-local"></head><body><script type="module" src="./src/main.tsx"></script></body></html>';
        const swPoisonedCache = createSwRuntime({
          buildId: BUILD_A,
          failDelete: false,
          fetchImpl: async () => new Response(rawTsxHtml, { status: 200, headers: { 'Content-Type': 'text/html' } }),
          initialCaches: {
            [`minadental-shell-${BUILD_A}`]: {
              [navUrl]: new Response(rawTsxHtml, { status: 200, headers: { 'Content-Type': 'text/html' } }),
              './index.html': new Response(makeHtml(BUILD_B, 'WRONG_BUILD_IN_CACHE'), { status: 200, headers: { 'Content-Type': 'text/html' } }),
              './': new Response(makeHtml(BUILD_A, 'VERIFIED_ROOT'), { status: 200, headers: { 'Content-Type': 'text/html' } }),
            },
          },
        });
        const resCorrupt = await swPoisonedCache.dispatchFetch({ url: navUrl, mode: 'navigate' });
        assert.equal(resCorrupt.response?.status, 200);
        assert.ok((await resCorrupt.response!.text()).includes('VERIFIED_ROOT'), 'Must reject raw TSX network + corrupted cache entries and fall back to verified ./');
        assert.equal(swPoisonedCache.cacheStore.get(`minadental-shell-${BUILD_A}`)?.has(navUrl), false, 'Poisoned request entry must be deleted');
        assert.equal(swPoisonedCache.cacheStore.get(`minadental-shell-${BUILD_A}`)?.has('./index.html'), false, 'Cross-build poisoned ./index.html must be deleted');

        // Delete failure during cleanup must not break fallback to ./
        const swDeleteFail = createSwRuntime({
          buildId: BUILD_A,
          failDelete: true,
          fetchImpl: offlineFetch,
          initialCaches: {
            [`minadental-shell-${BUILD_A}`]: {
              './index.html': new Response('short corrupt html', { status: 200, headers: { 'Content-Type': 'text/html' } }),
              './': new Response(makeHtml(BUILD_A, 'RESILIENT_ROOT'), { status: 200, headers: { 'Content-Type': 'text/html' } }),
            },
          },
        });
        const resDelFail = await swDeleteFail.dispatchFetch({ url: navUrl, mode: 'navigate' });
        assert.equal(resDelFail.response?.status, 200);
        assert.ok((await resDelFail.response!.text()).includes('RESILIENT_ROOT'));

        // 4. Cache storage failures (QuotaExceededError)
        const swQuotaNav = createSwRuntime({
          buildId: BUILD_A,
          failQuotaOnPut: true,
          fetchImpl: async () => new Response(makeHtml(BUILD_A, 'LIVE_NET'), { status: 200, headers: { 'Content-Type': 'text/html' } }),
        });
        const resQuota = await swQuotaNav.dispatchFetch({ url: navUrl, mode: 'navigate' });
        assert.equal(resQuota.response?.status, 200, 'Navigation must succeed even when cache.put throws QuotaExceededError');
        assert.ok((await resQuota.response!.text()).includes('LIVE_NET'));

        const swQuotaInstall = createSwRuntime({
          buildId: BUILD_A,
          failQuotaOnPut: true,
          fetchImpl: async () => new Response(makeHtml(BUILD_A), { status: 200, headers: { 'Content-Type': 'text/html' } }),
        });
        await assert.rejects(() => swQuotaInstall.dispatchInstall(), /Critical precache cache write failed/);

        // 5. Security & offline asset guards (HTML-for-JS MIME, no-store, API/Auth bypass, offline JS 503)
        const swSecurity = createSwRuntime({
          buildId: BUILD_A,
          fetchImpl: async (req) => {
            const u = typeof req === 'string' ? req : req.url;
            if (u.endsWith('offline.js')) throw new Error('Network offline');
            if (u.endsWith('bad-mime.js')) return new Response('<html>404</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
            return new Response('console.log(1)', { status: 200, headers: { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store' } });
          },
        });
        await swSecurity.dispatchFetch({ url: `${BASE}assets/bad-mime.js`, mode: 'cors' });
        await swSecurity.dispatchFetch({ url: `${BASE}assets/no-store.js`, mode: 'cors' });
        assert.equal(swSecurity.putCalls.length, 0, 'HTML-for-JS and Cache-Control: no-store must NEVER be cached');
        const offlineJs = await swSecurity.dispatchFetch({ url: `${BASE}assets/offline.js`, mode: 'cors' });
        assert.equal(offlineJs.response?.status, 503);
        const apiSkip = await swSecurity.dispatchFetch({ url: `${ORIGIN}/rest/v1/patients`, mode: 'cors' });
        const authSkip = await swSecurity.dispatchFetch({ url: `${ORIGIN}/auth/v1/token`, mode: 'cors' });
        assert.equal(apiSkip.handled, false);
        assert.equal(authSkip.handled, false);

        // 6. Cross-release isolation: Worker A serves newer Build B navigation without poisoning Cache A; PRUNE isolates leases & 3P caches
        const swIsolation = createSwRuntime({
          buildId: BUILD_A,
          fetchImpl: async () => new Response(makeHtml(BUILD_B, 'RELEASE_B'), { status: 200, headers: { 'Content-Type': 'text/html' } }),
          initialCaches: {
            [`minadental-shell-${BUILD_A}`]: {
              './index.html': new Response(makeHtml(BUILD_A, 'RELEASE_A'), { status: 200, headers: { 'Content-Type': 'text/html' } }),
            },
            [`minadental-shell-${BUILD_B}`]: {},
            [`minadental-shell-${BUILD_OLD}`]: {},
            'external-app-cache-v1': {},
          },
        });
        const crossRes = await swIsolation.dispatchFetch({ url: BASE, mode: 'navigate' });
        assert.ok((await crossRes.response!.text()).includes('RELEASE_B'), 'Valid newer compiled release HTML passes through');
        const stillA = await swIsolation.cacheStore.get(`minadental-shell-${BUILD_A}`)?.get('./index.html')?.text();
        assert.ok(stillA?.includes('RELEASE_A'), 'Cache A must stay isolated from Release B');

        await swIsolation.dispatchMessage({ type: 'CLIENT_RELEASE_LEASE', buildId: BUILD_B }, { tabId: 'tab-b' });
        await swIsolation.dispatchMessage({
          type: 'PRUNE_OBSOLETE_CACHES',
          activeBuildId: BUILD_A,
          lastKnownGoodBuildId: BUILD_A,
        });
        assert.equal(await swIsolation.cachesApi.has(`minadental-shell-${BUILD_A}`), true);
        assert.equal(await swIsolation.cachesApi.has(`minadental-shell-${BUILD_B}`), true, 'Leased Release B cache preserved');
        assert.equal(await swIsolation.cachesApi.has(`minadental-shell-${BUILD_OLD}`), false, 'Obsolete minadental cache pruned');
        assert.equal(await swIsolation.cachesApi.has('external-app-cache-v1'), true, 'Third-party cache untouched');

        // SKIP_WAITING cross-release / cross-origin isolation
        await swIsolation.dispatchMessage({ type: 'SKIP_WAITING', targetReleaseId: BUILD_B });
        await swIsolation.dispatchMessage({ type: 'SKIP_WAITING', targetReleaseId: BUILD_A }, { origin: 'https://evil.example' });
        assert.equal(swIsolation.getSkipWaitingCount(), 0);
        await swIsolation.dispatchMessage({ type: 'SKIP_WAITING', targetReleaseId: BUILD_A });
        assert.equal(swIsolation.getSkipWaitingCount(), 1);
      },
    },
    {
      name: 'V5-10 [P0-04]: Bootstrap state machine, PII/JWT log sanitization, lazyWithRetry single-reload guard & ErrorBoundary resetKey',
      fn: async () => {
        const machine = createBootstrapMachine();
        assert.equal(machine.getSnapshot().stage, 'BOOTING');
        // Invalid skip BOOTING -> READY must be ignored
        machine.transition('READY');
        assert.equal(machine.getSnapshot().stage, 'BOOTING');
        // Valid chain: BOOTING -> SHELL_READY -> AUTH_RESOLVING -> READY
        machine.transition('SHELL_READY');
        assert.equal(machine.getSnapshot().stage, 'SHELL_READY');
        assert.ok(machine.getSnapshot().shellCommittedAt !== null);
        machine.transition('AUTH_RESOLVING');
        machine.transition('READY');
        assert.equal(machine.getSnapshot().stage, 'READY');

        // Sanitizer redacts JWT, Bearer token, email, and Iranian mobile phone
        const leaked = sanitizeLogMessage(
          'Auth failed Bearer abc.def.ghi eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk dr@clinic.ir 09123456789'
        );
        assert.ok(!leaked.includes('abc.def.ghi'));
        assert.ok(!leaked.includes('eyJhbGciOi'));
        assert.ok(!leaked.includes('dr@clinic.ir'));
        assert.ok(!leaked.includes('09123456789'));

        // lazyWithRetry: retries transient failure then succeeds
        let tries = 0;
        const okMod = await importWithRetry(
          async () => {
            tries += 1;
            if (tries < 2) throw new Error('Transient network blip');
            return { default: () => null };
          },
          'PatientsChunk',
          { maxRetries: 2, baseDelayMs: 1, delayFn: instantDelay, storage: null }
        );
        assert.ok(okMod.default);
        assert.equal(tries, 2);

        // lazyWithRetry: chunk mismatch reloads AT MOST ONCE per buildId+chunkName
        const memStore = new Map<string, string>();
        const mockStorage = {
          getItem: (k: string) => memStore.get(k) ?? null,
          setItem: (k: string, v: string) => {
            memStore.set(k, v);
          },
        };
        let reloads = 0;
        const chunkErr = new Error('Failed to fetch dynamically imported module: ./assets/Finance-OLD.js');
        assert.equal(isChunkLoadError(chunkErr), true);

        await assert.rejects(() =>
          importWithRetry(() => Promise.reject(chunkErr), 'Finance', {
            maxRetries: 1,
            baseDelayMs: 1,
            delayFn: instantDelay,
            storage: mockStorage,
            reloadFn: () => {
              reloads += 1;
            },
            buildId: 'v5-test-abc',
          })
        );
        assert.equal(reloads, 1, 'First chunk mismatch should trigger 1 controlled reload');

        // Second failure in same build must NOT trigger an infinite reload loop
        await assert.rejects(() =>
          importWithRetry(() => Promise.reject(chunkErr), 'Finance', {
            maxRetries: 1,
            baseDelayMs: 1,
            delayFn: instantDelay,
            storage: mockStorage,
            reloadFn: () => {
              reloads += 1;
            },
            buildId: 'v5-test-abc',
          })
        );
        assert.equal(reloads, 1, 'Second chunk mismatch must NOT loop reloads');

        // Confirm main.tsx does NOT set __minaAppMounted synchronously & AppRouter wires resetKey={activeRoute}
        const mainSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/main.tsx'), 'utf8');
        const routerSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/app/AppRouter.tsx'), 'utf8');
        assert.ok(!mainSrc.includes('__minaAppMounted = true'), 'main.tsx must NOT set __minaAppMounted synchronously');
        assert.ok(routerSrc.includes('resetKey={activeRoute}'), 'AppRouter ErrorBoundary must reset on route switch');
      },
    },
    {
      name: 'V6-01 [P0-Boot]: Dotted/hyphenated BUILD_ID stamping never corrupts inline JS, RootErrorBoundary wraps App, and SW validates critical assets atomically',
      fn: () => {
        const htmlSrc = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
        const mainSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/main.tsx'), 'utf8');
        const rootBoundarySrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/RootErrorBoundary.tsx'), 'utf8');
        const swSrc = fs.readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8');
        const viteSrc = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8');

        assert.ok(htmlSrc.includes('content="__MINA_BUILD_ID_VALUE__"'), 'index.html must use value-only placeholder in meta content');
        assert.ok(htmlSrc.includes('window.__minaBuildId = buildId;'), 'index.html must assign fixed window.__minaBuildId identifier');
        assert.ok(!htmlSrc.includes('window.__MINA_BUILD_ID__'), 'index.html must never use replaceable placeholder as JS property name');
        assert.ok(viteSrc.includes('content="__MINA_BUILD_ID_VALUE__"'), 'vite.config.ts must replace only targeted value placeholder');
        assert.ok(!viteSrc.includes("replaceAll('__MINA_BUILD_ID__'"), 'vite.config.ts must never blindly replaceAll __MINA_BUILD_ID__');

        assert.ok(mainSrc.includes('<RootErrorBoundary'), 'src/main.tsx must wrap <App /> in RootErrorBoundary');
        assert.ok(mainSrc.includes('unhandledrejection'), 'src/main.tsx must handle unhandled rejections with sanitization');
        assert.ok(!rootBoundarySrc.includes('indexedDB.deleteDatabase'), 'RootErrorBoundary recovery must never wipe IndexedDB');
        assert.ok(swSrc.includes('CRITICAL_PRECACHE_ASSETS'), 'SW must validate critical entry assets atomically during install');
        assert.ok(swSrc.includes('/assets/aistudio/'), 'SW must never cache dev-only /assets/aistudio/ paths');
      },
    },
    {
      name: 'V6-02 [P0-Runtime]: lazyWithRetry enforces per-attempt importTimeoutMs deadline so stalled dynamic imports never hang forever',
      fn: async () => {
        let attempts = 0;
        const start = Date.now();
        await assert.rejects(
          () =>
            importWithRetry(
              () => {
                attempts += 1;
                return new Promise(() => {
                  // Intentionally never settles (simulates stalled mobile network chunk fetch)
                });
              },
              'StalledModule',
              {
                maxRetries: 1,
                baseDelayMs: 5,
                importTimeoutMs: 30,
                delayFn: instantDelay,
                storage: null,
              }
            ),
          /Chunk load timeout \(30ms\): StalledModule/
        );
        const elapsed = Date.now() - start;
        assert.equal(attempts, 2, 'Must execute 1 initial attempt + 1 bounded retry');
        assert.ok(elapsed < 1000, `Hanging dynamic import must reject promptly, took ${elapsed}ms`);
      },
    },
  ];

  const results: V5TestResult[] = [];
  for (const c of cases) {
    try {
      await c.fn();
      results.push({ name: c.name, passed: true });
    } catch (err) {
      results.push({
        name: c.name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
