import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase, type TableName } from './supabase';
import {
  broadcastClinicSyncEvent,
  getActiveClinicUser,
  initGlobalCloudSync,
  type SyncBroadcastPayload,
} from './cloudSyncEngine';
import { CLINIC_SEED_MAP } from './seedClinicData';
import {
  archiveDeletedRecord,
  loadTableMirrorFromVaultWithStatus,
  saveTableMirrorToVault,
} from './dataVault';
import {
  ACTIVE_TENANT_ID,
  getActiveBranchId,
} from '@/services/authentication/authService';
import {
  clearScopedCacheEntry,
  isDemoSeedAllowed,
  readScopedNonSensitiveCache,
  writeScopedNonSensitiveCache,
} from '@/services/supabase/scopedCache';
import { subscribeToTableRealtime } from '@/services/realtime/realtimeHub';

export type TableDataStatus =
  | 'loading'
  | 'ready'
  | 'partial'
  | 'empty'
  | 'timeout'
  | 'error'
  | 'offline'
  | 'locked_offline'
  | 'unauthorized'
  | 'migration_required';

export interface RealtimeTableOptions {
  limit?: number;
  offset?: number;
  /** Paginate through all server pages until rows.length < pageSize (true end-of-data detection) */
  fetchAllPages?: boolean;
  /** Maximum pages fetched when fetchAllPages=true before marking status='partial' & truncated=true */
  maxPages?: number;
}

export interface TableRequestError {
  message?: string;
  code?: string;
  status?: number;
}

export interface TableFetchExecutionResult<T> {
  rows: T[] | null;
  error: TableRequestError | null;
  timedOut: boolean;
  cancelled: boolean;
  truncated: boolean;
  attempts: number;
}

export interface PageFetcherParams {
  from: number;
  to: number;
  signal: AbortSignal;
}

export interface ExecuteTableFetchConfig<T> {
  parentSignal: AbortSignal;
  fetchPage: (
    params: PageFetcherParams
  ) => Promise<{ rows: T[] | null; error: TableRequestError | null }>;
  pageSize?: number;
  offset?: number;
  fetchAllPages?: boolean;
  maxPages?: number;
  maxRetries?: number;
  timeoutMs?: number;
  baseBackoffMs?: number;
  delayFn?: (ms: number, signal: AbortSignal) => Promise<void>;
  randomFn?: () => number;
}

const REQUEST_TIMEOUT_MS = 6500;
const MAX_RETRY_ATTEMPTS = 2;
const BASE_BACKOFF_MS = 350;
const DEFAULT_QUERY_LIMIT = 500;
const DEFAULT_MAX_PAGES = 20;

function isUnauthorizedResponse(err: TableRequestError | null): boolean {
  if (!err) return false;
  if (err.status === 401 || err.status === 403) return true;
  const code = String(err.code || '').toUpperCase();
  const msg = String(err.message || '').toLowerCase();
  return (
    code === '42501' ||
    code === 'PGRST301' ||
    msg.includes('permission denied') ||
    msg.includes('unauthorized') ||
    msg.includes('jwt')
  );
}

/**
 * FIX 02 & V11: Detect missing required schema columns or unmigrated tables
 * (PostgreSQL 42703 / 42P01, PostgREST PGRST204 / PGRST205).
 * We NEVER strip `tenant_id` / `branch_id` or fall back to unscoped queries.
 */
export function isSchemaMigrationRequiredError(err: TableRequestError | null): boolean {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  const msg = String(err.message || '').toLowerCase();
  return (
    code === '42703' ||
    code === '42P01' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    (msg.includes('column') && msg.includes('does not exist')) ||
    (msg.includes('relation') && msg.includes('does not exist')) ||
    msg.includes('could not find the table')
  );
}

/**
 * Pure monotonic request guard (FIX 01, FIX 09 & V5 P0-02):
 * Rejects stale/late/parent-cancelled responses from a superseded request or previous user/branch scope.
 * IMPORTANT: Network timeouts abort ONLY the per-attempt controller — never the parent controller —
 * so timeouts are NEVER misclassified as `aborted` here.
 */
export function shouldAcceptTableResponse(params: {
  requestSeq: number;
  currentSeq: number;
  requestScopeKey: string;
  activeScopeKey: string;
  aborted: boolean;
  mounted: boolean;
}): boolean {
  if (!params.mounted || params.aborted) return false;
  if (params.requestSeq !== params.currentSeq) return false;
  if (params.requestScopeKey !== params.activeScopeKey) return false;
  return true;
}

function defaultAbortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * V5 P0-02 Async State Machine Executor (exported for deterministic fake-timer & unit testing):
 * - Separates parent cancellation (unmount / scope switch / newer generation) from per-attempt timeout.
 * - Creates an independent per-attempt `AbortController` bounded by `timeoutMs`.
 * - A per-attempt timeout aborts ONLY `attemptController`, NEVER `parentSignal`, allowing bounded
 *   retries with jittered exponential backoff and guaranteed transition to `timeout` (never stuck loading).
 */
export async function executeRealtimeTableFetch<T>(
  config: ExecuteTableFetchConfig<T>
): Promise<TableFetchExecutionResult<T>> {
  const {
    parentSignal,
    fetchPage,
    pageSize = DEFAULT_QUERY_LIMIT,
    offset = 0,
    fetchAllPages = false,
    maxPages = DEFAULT_MAX_PAGES,
    maxRetries = MAX_RETRY_ATTEMPTS,
    timeoutMs = REQUEST_TIMEOUT_MS,
    baseBackoffMs = BASE_BACKOFF_MS,
    delayFn = defaultAbortableDelay,
    randomFn = Math.random,
  } = config;

  const effectivePageSize = pageSize > 0 ? pageSize : DEFAULT_QUERY_LIMIT;
  let totalAttempts = 0;

  const runSinglePageWithRetry = async (
    fromIdx: number,
    toIdx: number
  ): Promise<{
    rows: T[] | null;
    error: TableRequestError | null;
    timedOut: boolean;
    cancelled: boolean;
  }> => {
    let attempt = 0;
    let lastErr: TableRequestError | null = null;
    let lastAttemptTimedOut = false;

    while (attempt <= maxRetries) {
      if (parentSignal.aborted) {
        return { rows: null, error: null, timedOut: false, cancelled: true };
      }

      totalAttempts += 1;
      const attemptController = new AbortController();
      let attemptTimedOut = false;

      const onParentAbort = () => {
        attemptController.abort();
      };
      parentSignal.addEventListener('abort', onParentAbort, { once: true });

      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<'__MINA_ATTEMPT_TIMEOUT__'>((resolve) => {
        timeoutHandle = setTimeout(() => {
          attemptTimedOut = true;
          attemptController.abort();
          resolve('__MINA_ATTEMPT_TIMEOUT__');
        }, timeoutMs);
      });

      try {
        const result = await Promise.race([
          fetchPage({ from: fromIdx, to: toIdx, signal: attemptController.signal }),
          timeoutPromise,
        ]);

        if (parentSignal.aborted) {
          return { rows: null, error: null, timedOut: false, cancelled: true };
        }

        if (result === '__MINA_ATTEMPT_TIMEOUT__' || attemptTimedOut) {
          lastAttemptTimedOut = true;
          lastErr = {
            code: 'REQUEST_TIMEOUT',
            message: 'پاسخ سرور کلینیک در زمان مجاز دریافت نشد.',
          };
        } else if (!result.error && Array.isArray(result.rows)) {
          return { rows: result.rows, error: null, timedOut: false, cancelled: false };
        } else {
          lastAttemptTimedOut = false;
          lastErr = result.error ?? { message: 'خطای دریافت اطلاعات از سرور' };
          if (isSchemaMigrationRequiredError(lastErr) || isUnauthorizedResponse(lastErr)) {
            return { rows: null, error: lastErr, timedOut: false, cancelled: false };
          }
        }
      } catch (err: unknown) {
        if (parentSignal.aborted) {
          return { rows: null, error: null, timedOut: false, cancelled: true };
        }
        if (attemptTimedOut) {
          lastAttemptTimedOut = true;
          lastErr = {
            code: 'REQUEST_TIMEOUT',
            message: 'پاسخ سرور کلینیک در زمان مجاز دریافت نشد.',
          };
        } else {
          lastAttemptTimedOut = false;
          lastErr = {
            message: err instanceof Error ? err.message : 'خطای ارتباط با سرور',
          };
        }
      } finally {
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        parentSignal.removeEventListener('abort', onParentAbort);
      }

      attempt += 1;
      if (attempt <= maxRetries && !parentSignal.aborted) {
        const expDelay = baseBackoffMs * Math.pow(2, attempt - 1);
        const jitter = Math.round(expDelay * 0.25 * Math.max(0, Math.min(1, randomFn())));
        await delayFn(expDelay + jitter, parentSignal);
      }
    }

    if (parentSignal.aborted) {
      return { rows: null, error: null, timedOut: false, cancelled: true };
    }

    return {
      rows: null,
      error: lastErr,
      timedOut: lastAttemptTimedOut,
      cancelled: false,
    };
  };

  if (fetchAllPages) {
    const accumulated: T[] = [];
    let page = 0;
    const boundedMaxPages = Math.max(1, maxPages);

    while (page < boundedMaxPages) {
      if (parentSignal.aborted) {
        return {
          rows: null,
          error: null,
          timedOut: false,
          cancelled: true,
          truncated: false,
          attempts: totalAttempts,
        };
      }
      const fromIdx = offset + page * effectivePageSize;
      const toIdx = fromIdx + effectivePageSize - 1;
      const res = await runSinglePageWithRetry(fromIdx, toIdx);
      if (res.cancelled) {
        return {
          rows: null,
          error: null,
          timedOut: false,
          cancelled: true,
          truncated: false,
          attempts: totalAttempts,
        };
      }
      if (res.error || !res.rows) {
        return {
          rows: null,
          error: res.error,
          timedOut: res.timedOut,
          cancelled: false,
          truncated: false,
          attempts: totalAttempts,
        };
      }
      accumulated.push(...res.rows);
      if (res.rows.length < effectivePageSize) {
        return {
          rows: accumulated,
          error: null,
          timedOut: false,
          cancelled: false,
          truncated: false,
          attempts: totalAttempts,
        };
      }
      page += 1;
      if (page >= boundedMaxPages) {
        return {
          rows: accumulated,
          error: null,
          timedOut: false,
          cancelled: false,
          truncated: true,
          attempts: totalAttempts,
        };
      }
    }
  }

  const singleRes = await runSinglePageWithRetry(offset, offset + effectivePageSize - 1);
  if (singleRes.cancelled) {
    return {
      rows: null,
      error: null,
      timedOut: false,
      cancelled: true,
      truncated: false,
      attempts: totalAttempts,
    };
  }
  const truncated =
    Array.isArray(singleRes.rows) && singleRes.rows.length >= effectivePageSize;
  return {
    rows: singleRes.rows,
    error: singleRes.error,
    timedOut: singleRes.timedOut,
    cancelled: false,
    truncated,
    attempts: totalAttempts,
  };
}

/**
 * Pure server-reconciliation helper (exported for unit testing).
 * - Empty `[]` clears state & cache.
 * - Truncated dataset (`truncated === true`) surfaces explicit `'partial'` status.
 * - `42703` / schema mismatch returns explicit `'migration_required'` and clears local cache.
 * - `401/403/42501` returns explicit `'unauthorized'` and clears local cache.
 * - Timeout returns explicit `'timeout'` (never frozen in `'loading'`).
 */
export function reconcileServerRows<T>(params: {
  serverRows: T[] | null | undefined;
  error: TableRequestError | null;
  isOffline: boolean;
  truncated?: boolean;
  timedOut?: boolean;
}): {
  rows: T[] | null;
  status: TableDataStatus;
  clearCache: boolean;
  isStale: boolean;
} {
  const { serverRows, error, isOffline, truncated, timedOut } = params;
  if (!error && Array.isArray(serverRows)) {
    if (serverRows.length === 0) {
      return { rows: [], status: 'empty', clearCache: true, isStale: false };
    }
    if (truncated) {
      return { rows: serverRows, status: 'partial', clearCache: false, isStale: false };
    }
    return { rows: serverRows, status: 'ready', clearCache: false, isStale: false };
  }
  if (isSchemaMigrationRequiredError(error)) {
    return { rows: [], status: 'migration_required', clearCache: true, isStale: false };
  }
  if (isUnauthorizedResponse(error)) {
    return { rows: [], status: 'unauthorized', clearCache: true, isStale: false };
  }
  if (isOffline) {
    return { rows: null, status: 'offline', clearCache: false, isStale: true };
  }
  if (timedOut || error?.code === 'REQUEST_TIMEOUT') {
    return { rows: null, status: 'timeout', clearCache: false, isStale: true };
  }
  return { rows: null, status: 'error', clearCache: false, isStale: true };
}

function resolveCurrentScope(table: TableName, filter?: { column: string; value: string | null } | null) {
  const activeUser = getActiveClinicUser();
  const branchId = getActiveBranchId();
  const tenantId = activeUser.tenantId || ACTIVE_TENANT_ID;
  const userId = activeUser.id;
  return {
    tenantId,
    branchId,
    userId,
    table,
    filter,
    scopeKey: `${tenantId}::${branchId}::${userId}`,
  };
}

/**
 * Hardened realtime table hook (V4 + V5 P0-02 Async State Machine):
 * - Separate parent cancellation (unmount / scope switch / newer generation) vs per-attempt timeout
 * - Guaranteed `finally` loading termination for the active generation & scope (zero infinite spinners)
 * - Stale responses never mutate React state or local cache/vault
 * - Explicit `'timeout'`, `'offline'`, `'locked_offline'`, `'empty'`, `'partial'`, `'unauthorized'`, `'migration_required'` states
 */
export function useRealtimeTable<T extends { id: string }>(
  table: TableName,
  select?: string,
  filter?: { column: string; value: string | null } | null,
  options?: RealtimeTableOptions
) {
  const [scopeVersion, setScopeVersion] = useState(0);
  const scope = resolveCurrentScope(table, filter);
  const queryLimit = options?.limit ?? DEFAULT_QUERY_LIMIT;
  const queryOffset = options?.offset ?? 0;
  const fetchAllPages = Boolean(options?.fetchAllPages);
  const maxPages = Math.max(1, options?.maxPages ?? DEFAULT_MAX_PAGES);

  const [data, setData] = useState<T[]>(() => {
    const cached = readScopedNonSensitiveCache<T>(scope);
    if (cached) return cached;
    if (isDemoSeedAllowed()) {
      const seed = CLINIC_SEED_MAP[table] as unknown as T[] | undefined;
      if (Array.isArray(seed) && seed.length > 0) return seed;
    }
    return [];
  });

  const [status, setStatus] = useState<TableDataStatus>('loading');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState<boolean>(false);
  const [truncated, setTruncated] = useState<boolean>(false);
  const [lockedOfflineCount, setLockedOfflineCount] = useState<number>(0);

  const parentAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const requestSeqRef = useRef(0);
  const activeScopeKeyRef = useRef(scope.scopeKey);
  activeScopeKeyRef.current = scope.scopeKey;

  const persistLocalMirror = useCallback(
    (rows: T[], currentScope = resolveCurrentScope(table, filter)) => {
      if (rows.length === 0) {
        clearScopedCacheEntry(currentScope);
      } else {
        writeScopedNonSensitiveCache(currentScope, rows);
      }
      if (!filter?.value) {
        saveTableMirrorToVault(table, rows, {
          tenantId: currentScope.tenantId,
          branchId: currentScope.branchId,
          userId: currentScope.userId,
        }).catch(() => {});
      }
    },
    [table, filter?.column, filter?.value]
  );

  const fetchData = useCallback(async () => {
    // Cancel any previous in-flight generation
    parentAbortRef.current?.abort();
    const parentController = new AbortController();
    parentAbortRef.current = parentController;

    const currentScope = resolveCurrentScope(table, filter);
    const requestScopeKey = currentScope.scopeKey;
    activeScopeKeyRef.current = requestScopeKey;
    const reqSeq = ++requestSeqRef.current;

    const isActiveGeneration = () =>
      shouldAcceptTableResponse({
        requestSeq: reqSeq,
        currentSeq: requestSeqRef.current,
        requestScopeKey,
        activeScopeKey: activeScopeKeyRef.current,
        aborted: parentController.signal.aborted,
        mounted: mountedRef.current,
      });

    // Fail-closed: refuse unscoped queries if tenantId or branchId is missing
    if (!currentScope.tenantId?.trim() || !currentScope.branchId?.trim()) {
      setData([]);
      setStatus('unauthorized');
      setError('شناسه کلینیک یا شعبه فعال نامعتبر است.');
      setTruncated(false);
      setLockedOfflineCount(0);
      setLoading(false);
      return;
    }

    const vaultScope = {
      tenantId: currentScope.tenantId,
      branchId: currentScope.branchId,
      userId: currentScope.userId,
    };

    const offlineNow = typeof navigator !== 'undefined' && navigator.onLine === false;
    setLoading(true);
    setStatus((prev) => (prev === 'ready' ? 'ready' : offlineNow ? 'offline' : 'loading'));

    try {
      // Hydrate from encrypted scoped IndexedDB Vault ONLY when offline
      if (offlineNow && !filter?.value) {
        try {
          const vaultRes = await loadTableMirrorFromVaultWithStatus<T>(table, vaultScope);
          if (!isActiveGeneration()) return;

          if (vaultRes.status === 'locked_after_reload') {
            setData([]);
            setLockedOfflineCount(vaultRes.lockedRecordCount);
            setStatus('locked_offline');
            setError(
              `حافظه رمزنگاری‌شده آفلاین پس از بارگذاری مجدد قفل شده است (${vaultRes.lockedRecordCount.toLocaleString('fa-IR')} رکورد). برای بازگشایی به اینترنت متصل شوید.`
            );
            setIsStale(true);
            setTruncated(false);
            return;
          }
          setLockedOfflineCount(0);
          setData(vaultRes.rows);
          setStatus(vaultRes.rows.length > 0 ? 'offline' : 'empty');
          setIsStale(vaultRes.rows.length > 0);
          setTruncated(false);
          return;
        } catch {
          if (isActiveGeneration()) {
            setStatus('offline');
          }
          return;
        }
      }

      const activeSelect = select ?? '*';
      const pageSize = queryLimit > 0 ? queryLimit : DEFAULT_QUERY_LIMIT;

      const execRes = await executeRealtimeTableFetch<T>({
        parentSignal: parentController.signal,
        pageSize,
        offset: queryOffset,
        fetchAllPages,
        maxPages,
        maxRetries: MAX_RETRY_ATTEMPTS,
        timeoutMs: REQUEST_TIMEOUT_MS,
        baseBackoffMs: BASE_BACKOFF_MS,
        fetchPage: async ({ from, to, signal }) => {
          let query = supabase
            .from(table)
            .select(activeSelect)
            .eq('tenant_id', currentScope.tenantId)
            .eq('branch_id', currentScope.branchId);

          if (filter && filter.value !== null && filter.value !== undefined) {
            query = query.eq(filter.column, filter.value);
          }
          if (typeof (query as any).abortSignal === 'function') {
            query = (query as any).abortSignal(signal);
          }
          let ordered = query.order('created_at', { ascending: false });
          if (typeof (ordered as any).range === 'function') {
            ordered = (ordered as any).range(from, to);
          } else if (typeof (ordered as any).limit === 'function') {
            ordered = (ordered as any).limit(to - from + 1);
          }
          const { data: rows, error: err, status: httpStatus } = await ordered;
          if (!err && Array.isArray(rows)) {
            return { rows: rows as unknown as T[], error: null };
          }
          return {
            rows: null,
            error: {
              message: err?.message,
              code: err?.code,
              status: httpStatus,
            },
          };
        },
      });

      if (execRes.cancelled || !isActiveGeneration()) {
        return;
      }

      const reconciled = reconcileServerRows<T>({
        serverRows: execRes.rows,
        error: execRes.error,
        isOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
        truncated: execRes.truncated,
        timedOut: execRes.timedOut,
      });

      if (reconciled.rows !== null) {
        setLockedOfflineCount(0);
        setTruncated(execRes.truncated);
        setData(reconciled.rows);
        setError(
          reconciled.status === 'migration_required'
            ? `ساختار جدول ${table} با نسخه امنیتی همخوانی ندارد. اجرای Migration الزامی است.`
            : reconciled.status === 'unauthorized'
            ? execRes.error?.message || 'دسترسی غیرمجاز'
            : reconciled.status === 'partial'
            ? `بخشی از رکوردهای جدول ${table} دریافت شد (بیش از سقف صفحه‌بندی).`
            : null
        );
        setStatus(reconciled.status);
        setIsStale(reconciled.isStale);
        if (reconciled.clearCache) {
          clearScopedCacheEntry(currentScope);
          if (!filter?.value) {
            saveTableMirrorToVault(table, [], vaultScope).catch(() => {});
          }
        } else {
          persistLocalMirror(reconciled.rows, currentScope);
        }
      } else {
        if (!filter?.value) {
          try {
            const vaultRes = await loadTableMirrorFromVaultWithStatus<T>(table, vaultScope);
            if (!isActiveGeneration()) return;

            if (vaultRes.status === 'locked_after_reload') {
              setData([]);
              setLockedOfflineCount(vaultRes.lockedRecordCount);
              setError(
                `حافظه رمزنگاری‌شده آفلاین پس از بارگذاری مجدد قفل شده است (${vaultRes.lockedRecordCount.toLocaleString('fa-IR')} رکورد).`
              );
              setStatus('locked_offline');
              setIsStale(true);
              setTruncated(false);
              return;
            }
            if (vaultRes.rows.length > 0) {
              setData(vaultRes.rows);
            }
          } catch {
            // ignore vault read errors
          }
        }

        if (!isActiveGeneration()) return;
        setError(
          reconciled.status === 'timeout'
            ? 'زمان انتظار برای پاسخ سرور به پایان رسید. لطفاً دوباره تلاش کنید.'
            : execRes.error?.message || 'خطای اتصال به سرور'
        );
        setStatus(reconciled.status);
        setIsStale(true);
      }
    } finally {
      // Guaranteed termination of `loading` ONLY for the still-active generation & scope
      if (
        mountedRef.current &&
        reqSeq === requestSeqRef.current &&
        requestScopeKey === activeScopeKeyRef.current
      ) {
        setLoading(false);
      }
    }
  }, [
    table,
    select,
    filter?.column,
    filter?.value,
    queryLimit,
    queryOffset,
    fetchAllPages,
    maxPages,
    persistLocalMirror,
  ]);

  const refreshAndBroadcast = useCallback(async () => {
    await fetchData();
    await broadcastClinicSyncEvent({
      type: 'TABLE_MUTATION',
      table,
      action: `به‌روزرسانی جدول ${table}`,
    });
  }, [fetchData, table]);

  useEffect(() => {
    mountedRef.current = true;
    initGlobalCloudSync();
    void fetchData();

    const handleSyncEvent = (ev: Event) => {
      const customEv = ev as CustomEvent<SyncBroadcastPayload>;
      if (customEv.detail?.type === 'TABLE_MUTATION' && customEv.detail.table === table) {
        void fetchData();
      }
    };

    const handleScopeSwitch = () => {
      parentAbortRef.current?.abort();
      requestSeqRef.current += 1;
      const nextScope = resolveCurrentScope(table, filter);
      activeScopeKeyRef.current = nextScope.scopeKey;
      setData([]);
      setError(null);
      setIsStale(false);
      setTruncated(false);
      setLockedOfflineCount(0);
      setStatus('loading');
      setLoading(true);
      setScopeVersion((v) => v + 1);
    };

    window.addEventListener('minadental-sync-event', handleSyncEvent);
    window.addEventListener('minadental-user-changed', handleScopeSwitch);
    window.addEventListener('minadental-branch-changed', handleScopeSwitch);

    const activeScope = resolveCurrentScope(table, filter);
    const unsubscribeRealtime = subscribeToTableRealtime<T>(table, {
      filter,
      scope: {
        tenantId: activeScope.tenantId,
        branchId: activeScope.branchId,
      },
      onInsert: (newRow) => {
        const currentScope = resolveCurrentScope(table, filter);
        if (currentScope.scopeKey !== activeScopeKeyRef.current) return;
        setData((prev) => {
          if (prev.some((item) => item.id === newRow.id)) return prev;
          const updated = [newRow, ...prev];
          persistLocalMirror(updated, currentScope);
          setStatus('ready');
          setIsStale(false);
          return updated;
        });
      },
      onUpdate: (updatedRow) => {
        const currentScope = resolveCurrentScope(table, filter);
        if (currentScope.scopeKey !== activeScopeKeyRef.current) return;
        setData((prev) => {
          const updated = prev.map((item) => (item.id === updatedRow.id ? updatedRow : item));
          persistLocalMirror(updated, currentScope);
          return updated;
        });
      },
      onDelete: (oldRow) => {
        const currentScope = resolveCurrentScope(table, filter);
        if (currentScope.scopeKey !== activeScopeKeyRef.current) return;
        setData((prev) => {
          const fullRecord = prev.find((item) => item.id === oldRow.id) ?? (oldRow as Record<string, unknown>);
          const actor = getActiveClinicUser().fullName;
          archiveDeletedRecord(table, fullRecord, actor, 'بایگانی خودکار ضدحذف هنگام حذف از جدول').catch(() => {});
          const updated = prev.filter((item) => item.id !== oldRow.id);
          persistLocalMirror(updated, currentScope);
          setStatus(updated.length === 0 ? 'empty' : 'ready');
          return updated;
        });
      },
    });

    return () => {
      mountedRef.current = false;
      parentAbortRef.current?.abort();
      window.removeEventListener('minadental-sync-event', handleSyncEvent);
      window.removeEventListener('minadental-user-changed', handleScopeSwitch);
      window.removeEventListener('minadental-branch-changed', handleScopeSwitch);
      unsubscribeRealtime();
    };
  }, [table, select, filter?.column, filter?.value, scopeVersion, fetchData, persistLocalMirror]);

  return {
    data,
    loading,
    status,
    isStale,
    truncated,
    lockedOfflineCount,
    error,
    refresh: refreshAndBroadcast,
  };
}
