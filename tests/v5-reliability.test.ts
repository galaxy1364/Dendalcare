import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
      name: 'V5-09 [P0-03]: Service Worker enforces Build ID cache, minadental-* isolation, no abrupt skipWaiting in install, awaited fallback, and HTML-for-JS guard',
      fn: () => {
        const swSrc = fs.readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8');
        assert.ok(swSrc.includes("const BUILD_ID = '__MINA_BUILD_ID__'"), 'SW must use build-injected BUILD_ID');
        assert.ok(!swSrc.includes('v64.0-b64'), 'Hardcoded v64 cache version must be removed');
        assert.ok(swSrc.includes("key.startsWith('minadental-')"), 'SW activate must only delete minadental-* caches');

        const installBlock = swSrc.slice(
          swSrc.indexOf("addEventListener('install'"),
          swSrc.indexOf("addEventListener('activate'")
        );
        assert.ok(
          !installBlock.includes('skipWaiting()'),
          'install handler MUST NOT call self.skipWaiting() abruptly'
        );
        assert.ok(swSrc.includes("data.type === 'SKIP_WAITING'"), 'SW must support controlled SKIP_WAITING message');
        assert.ok(
          !swSrc.includes("caches.match('./index.html') || caches.match('./')"),
          'Broken Promise-truthy fallback chain must be eliminated'
        );
        assert.ok(
          swSrc.includes('const indexMatch = await cache.match') &&
            swSrc.includes('const rootMatch = await cache.match') &&
            swSrc.includes('createOfflineHtmlResponse()'),
          'Navigation fallback must sequentially await cache matches and guarantee a valid Response'
        );
        assert.ok(
          swSrc.includes("ct.includes('javascript') && !ct.includes('text/html')"),
          'SW must reject text/html responses for JS requests'
        );
        assert.ok(
          swSrc.includes('/rest/v1/') && swSrc.includes('/auth/v1/') && swSrc.includes("cacheControl.includes('no-store')"),
          'SW must never cache API/auth/no-store responses'
        );
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
