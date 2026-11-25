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

const REQUEST_TIMEOUT_MS = 6500;
const MAX_RETRY_ATTEMPTS = 2;
const DEFAULT_QUERY_LIMIT = 500;
const DEFAULT_MAX_PAGES = 20;

function isUnauthorizedResponse(err: { code?: string; status?: number; message?: string } | null): boolean {
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
 * FIX 02: Detect missing required schema columns (PostgreSQL 42703 / PostgREST PGRST204).
 * We NEVER strip `tenant_id` / `branch_id` or fall back to unscoped queries.
 */
export function isSchemaMigrationRequiredError(
  err: { code?: string; status?: number; message?: string } | null
): boolean {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  const msg = String(err.message || '').toLowerCase();
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    (msg.includes('column') && msg.includes('does not exist'))
  );
}

/**
 * Pure monotonic request guard (FIX 01 & FIX 09):
 * Rejects stale/late/aborted responses from a superseded request or previous user/branch scope.
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

/**
 * Pure server-reconciliation helper (exported for unit testing).
 * - Empty `[]` clears state & cache.
 * - Truncated dataset (`truncated === true`) surfaces explicit `'partial'` status.
 * - `42703` / schema mismatch returns explicit `'migration_required'` and clears local cache.
 * - `401/403/42501` returns explicit `'unauthorized'` and clears local cache.
 */
export function reconcileServerRows<T>(params: {
  serverRows: T[] | null | undefined;
  error: { message?: string; code?: string; status?: number } | null;
  isOffline: boolean;
  truncated?: boolean;
}): {
  rows: T[] | null;
  status: TableDataStatus;
  clearCache: boolean;
  isStale: boolean;
} {
  const { serverRows, error, isOffline, truncated } = params;
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
 * Hardened realtime table hook (V4 Engineering Release Gate):
 * - Fail-closed tenant_id + branch_id filtering on every query and realtime channel
 * - Zero `42703` column-stripping fallback: surfaces `migration_required` explicitly
 * - Multi-page fetch (`fetchAllPages`) with real end-of-data detection & explicit `'partial'` truncation state
 * - Explicit `'locked_offline'` state when encrypted IndexedDB cache cannot be decrypted after reload
 * - Immediate abort + state wipe on user/branch switch
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

  const abortRef = useRef<AbortController | null>(null);
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
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const currentScope = resolveCurrentScope(table, filter);
    const requestScopeKey = currentScope.scopeKey;
    activeScopeKeyRef.current = requestScopeKey;
    const reqSeq = ++requestSeqRef.current;

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

    // Hydrate from encrypted scoped IndexedDB Vault ONLY when offline
    if (offlineNow && !filter?.value) {
      try {
        const vaultRes = await loadTableMirrorFromVaultWithStatus<T>(table, vaultScope);
        if (
          shouldAcceptTableResponse({
            requestSeq: reqSeq,
            currentSeq: requestSeqRef.current,
            requestScopeKey,
            activeScopeKey: activeScopeKeyRef.current,
            aborted: controller.signal.aborted,
            mounted: mountedRef.current,
          })
        ) {
          if (vaultRes.status === 'locked_after_reload') {
            setData([]);
            setLockedOfflineCount(vaultRes.lockedRecordCount);
            setStatus('locked_offline');
            setError(
              `حافظه رمزنگاری‌شده آفلاین پس از بارگذاری مجدد قفل شده است (${vaultRes.lockedRecordCount.toLocaleString('fa-IR')} رکورد). برای بازگشایی به اینترنت متصل شوید.`
            );
            setIsStale(true);
            setTruncated(false);
            setLoading(false);
            return;
          }
          setLockedOfflineCount(0);
          setData(vaultRes.rows);
          setStatus(vaultRes.rows.length > 0 ? 'offline' : 'empty');
          setIsStale(vaultRes.rows.length > 0);
          setTruncated(false);
          setLoading(false);
        }
      } catch {
        if (mountedRef.current && reqSeq === requestSeqRef.current) {
          setStatus('offline');
          setLoading(false);
        }
      }
      return;
    }

    const activeSelect = select ?? '*';
    const pageSize = queryLimit > 0 ? queryLimit : DEFAULT_QUERY_LIMIT;
    let lastError: { message?: string; code?: string; status?: number } | null = null;
    let resolvedRows: T[] | null = null;
    let isTruncated = false;

    const fetchSinglePage = async (
      fromIdx: number,
      toIdx: number
    ): Promise<{ rows: T[] | null; error: { message?: string; code?: string; status?: number } | null }> => {
      let attempt = 0;
      let pageErr: { message?: string; code?: string; status?: number } | null = null;

      while (attempt <= MAX_RETRY_ATTEMPTS && !controller.signal.aborted) {
        const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          let query = supabase
            .from(table)
            .select(activeSelect)
            .eq('tenant_id', currentScope.tenantId)
            .eq('branch_id', currentScope.branchId);

          if (filter && filter.value !== null && filter.value !== undefined) {
            query = query.eq(filter.column, filter.value);
          }
          if (typeof (query as any).abortSignal === 'function') {
            query = (query as any).abortSignal(controller.signal);
          }
          let ordered = query.order('created_at', { ascending: false });
          if (typeof (ordered as any).range === 'function') {
            ordered = (ordered as any).range(fromIdx, toIdx);
          } else if (typeof (ordered as any).limit === 'function') {
            ordered = (ordered as any).limit(toIdx - fromIdx + 1);
          }
          const { data: rows, error: err, status: httpStatus } = await ordered;
          clearTimeout(timeoutHandle);

          if (!err && Array.isArray(rows)) {
            return { rows: rows as unknown as T[], error: null };
          }
          pageErr = {
            message: err?.message,
            code: err?.code,
            status: httpStatus,
          };
          if (isSchemaMigrationRequiredError(pageErr) || isUnauthorizedResponse(pageErr)) {
            return { rows: null, error: pageErr };
          }
        } catch (e: unknown) {
          clearTimeout(timeoutHandle);
          if (controller.signal.aborted) break;
          const msg = e instanceof Error ? e.message : 'خطای ارتباط با سرور';
          pageErr = { message: msg };
        }

        attempt += 1;
        if (attempt <= MAX_RETRY_ATTEMPTS && !controller.signal.aborted) {
          await new Promise((r) => setTimeout(r, 350 * attempt));
        }
      }

      return { rows: null, error: pageErr };
    };

    if (fetchAllPages) {
      const accumulated: T[] = [];
      let page = 0;
      while (page < maxPages && !controller.signal.aborted) {
        const fromIdx = queryOffset + page * pageSize;
        const toIdx = fromIdx + pageSize - 1;
        const res = await fetchSinglePage(fromIdx, toIdx);
        if (res.error || !res.rows) {
          lastError = res.error;
          resolvedRows = null;
          break;
        }
        accumulated.push(...res.rows);
        if (res.rows.length < pageSize) {
          // True end-of-data reached
          resolvedRows = accumulated;
          isTruncated = false;
          break;
        }
        page += 1;
        if (page >= maxPages) {
          // Hit ceiling while server still returned a full page — mark dataset partial/truncated
          resolvedRows = accumulated;
          isTruncated = true;
        }
      }
    } else {
      const res = await fetchSinglePage(queryOffset, queryOffset + pageSize - 1);
      lastError = res.error;
      resolvedRows = res.rows;
      // Single-page query that filled the exact page limit may be truncated
      isTruncated = Array.isArray(res.rows) && res.rows.length >= pageSize;
    }

    if (
      !shouldAcceptTableResponse({
        requestSeq: reqSeq,
        currentSeq: requestSeqRef.current,
        requestScopeKey,
        activeScopeKey: activeScopeKeyRef.current,
        aborted: controller.signal.aborted,
        mounted: mountedRef.current,
      })
    ) {
      return;
    }

    const reconciled = reconcileServerRows<T>({
      serverRows: resolvedRows,
      error: lastError,
      isOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
      truncated: isTruncated,
    });

    if (reconciled.rows !== null) {
      setLockedOfflineCount(0);
      setTruncated(isTruncated);
      setData(reconciled.rows);
      setError(
        reconciled.status === 'migration_required'
          ? `ساختار جدول ${table} با نسخه امنیتی همخوانی ندارد. اجرای Migration الزامی است.`
          : reconciled.status === 'unauthorized'
          ? lastError?.message || 'دسترسی غیرمجاز'
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
          if (
            shouldAcceptTableResponse({
              requestSeq: reqSeq,
              currentSeq: requestSeqRef.current,
              requestScopeKey,
              activeScopeKey: activeScopeKeyRef.current,
              aborted: controller.signal.aborted,
              mounted: mountedRef.current,
            })
          ) {
            if (vaultRes.status === 'locked_after_reload') {
              setData([]);
              setLockedOfflineCount(vaultRes.lockedRecordCount);
              setError(
                `حافظه رمزنگاری‌شده آفلاین پس از بارگذاری مجدد قفل شده است (${vaultRes.lockedRecordCount.toLocaleString('fa-IR')} رکورد).`
              );
              setStatus('locked_offline');
              setIsStale(true);
              setTruncated(false);
              setLoading(false);
              return;
            }
            if (vaultRes.rows.length > 0) {
              setData(vaultRes.rows);
            }
          }
        } catch {
          // ignore
        }
      }
      setError(lastError?.message || 'خطای اتصال به سرور');
      setStatus(reconciled.status);
      setIsStale(true);
    }

    if (mountedRef.current && reqSeq === requestSeqRef.current) {
      setLoading(false);
    }
  }, [table, select, filter?.column, filter?.value, queryLimit, queryOffset, fetchAllPages, maxPages, persistLocalMirror]);

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
      abortRef.current?.abort();
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
      abortRef.current?.abort();
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
