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
  loadTableMirrorFromVault,
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
  | 'empty'
  | 'error'
  | 'offline'
  | 'unauthorized'
  | 'migration_required';

export interface RealtimeTableOptions {
  limit?: number;
  offset?: number;
}

const REQUEST_TIMEOUT_MS = 6500;
const MAX_RETRY_ATTEMPTS = 2;
const DEFAULT_QUERY_LIMIT = 500;

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
 * - `42703` / schema mismatch returns explicit `migration_required` and clears local cache.
 * - `401/403/42501` returns explicit `unauthorized` and clears local cache.
 */
export function reconcileServerRows<T>(params: {
  serverRows: T[] | null | undefined;
  error: { message?: string; code?: string; status?: number } | null;
  isOffline: boolean;
}): {
  rows: T[] | null;
  status: TableDataStatus;
  clearCache: boolean;
  isStale: boolean;
} {
  const { serverRows, error, isOffline } = params;
  if (!error && Array.isArray(serverRows)) {
    if (serverRows.length === 0) {
      return { rows: [], status: 'empty', clearCache: true, isStale: false };
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
 * Hardened realtime table hook (Third Audit FIX 01, FIX 02, FIX 09):
 * - Zero `42703` column-stripping fallback: surfaces `migration_required` explicitly
 * - Immediate abort + state wipe on user/branch switch
 * - Monotonic `requestSeqRef` + `activeScopeKeyRef` prevent stale previous-user data entering state
 * - Supports explicit pagination (`limit`, `offset`) for scalability on large datasets
 * - Uses encrypted, session-isolated IndexedDB Vault for offline resilience
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
    // Cancel any previous in-flight request and advance monotonic sequence
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const currentScope = resolveCurrentScope(table, filter);
    const requestScopeKey = currentScope.scopeKey;
    activeScopeKeyRef.current = requestScopeKey;
    const reqSeq = ++requestSeqRef.current;

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
        const vaultRows = await loadTableMirrorFromVault<T>(table, vaultScope);
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
          setData(vaultRows);
          setStatus(vaultRows.length > 0 ? 'offline' : 'empty');
          setIsStale(vaultRows.length > 0);
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

    let attempt = 0;
    const activeSelect = select ?? '*';
    let lastError: { message?: string; code?: string; status?: number } | null = null;
    let resolvedRows: T[] | null = null;

    while (attempt <= MAX_RETRY_ATTEMPTS && !controller.signal.aborted) {
      const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        let query = supabase.from(table).select(activeSelect);
        if (filter && filter.value !== null && filter.value !== undefined) {
          query = query.eq(filter.column, filter.value);
        }
        if (typeof (query as any).abortSignal === 'function') {
          query = (query as any).abortSignal(controller.signal);
        }
        let ordered = query.order('created_at', { ascending: false });
        if (typeof (ordered as any).range === 'function' && queryLimit > 0) {
          ordered = (ordered as any).range(queryOffset, queryOffset + queryLimit - 1);
        } else if (typeof (ordered as any).limit === 'function' && queryLimit > 0) {
          ordered = (ordered as any).limit(queryLimit);
        }
        const { data: rows, error: err, status: httpStatus } = await ordered;
        clearTimeout(timeoutHandle);

        if (!err && Array.isArray(rows)) {
          resolvedRows = rows as unknown as T[];
          lastError = null;
          break;
        }
        lastError = {
          message: err?.message,
          code: err?.code,
          status: httpStatus,
        };
        // FIX 02: Never strip tenant_id/branch_id on 42703; fail explicitly with migration_required
        if (isSchemaMigrationRequiredError(lastError) || isUnauthorizedResponse(lastError)) {
          break;
        }
      } catch (e: unknown) {
        clearTimeout(timeoutHandle);
        if (controller.signal.aborted) break;
        const msg = e instanceof Error ? e.message : 'خطای ارتباط با سرور';
        lastError = { message: msg };
      }

      attempt += 1;
      if (attempt <= MAX_RETRY_ATTEMPTS && !controller.signal.aborted) {
        await new Promise((r) => setTimeout(r, 350 * attempt));
      }
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
    });

    if (reconciled.rows !== null) {
      setData(reconciled.rows);
      setError(
        reconciled.status === 'migration_required'
          ? `ساختار جدول ${table} با نسخه امنیتی همخوانی ندارد. اجرای Migration الزامی است.`
          : reconciled.status === 'unauthorized'
          ? lastError?.message || 'دسترسی غیرمجاز'
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
          const vaultRows = await loadTableMirrorFromVault<T>(table, vaultScope);
          if (
            shouldAcceptTableResponse({
              requestSeq: reqSeq,
              currentSeq: requestSeqRef.current,
              requestScopeKey,
              activeScopeKey: activeScopeKeyRef.current,
              aborted: controller.signal.aborted,
              mounted: mountedRef.current,
            }) &&
            vaultRows.length > 0
          ) {
            setData(vaultRows);
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
  }, [table, select, filter?.column, filter?.value, queryLimit, queryOffset, persistLocalMirror]);

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

    // FIX 01: On user or branch switch, IMMEDIATELY abort in-flight requests and wipe prior user's UI state
    const handleScopeSwitch = () => {
      abortRef.current?.abort();
      requestSeqRef.current += 1;
      const nextScope = resolveCurrentScope(table, filter);
      activeScopeKeyRef.current = nextScope.scopeKey;
      setData([]);
      setError(null);
      setIsStale(false);
      setStatus('loading');
      setLoading(true);
      setScopeVersion((v) => v + 1);
    };

    window.addEventListener('minadental-sync-event', handleSyncEvent);
    window.addEventListener('minadental-user-changed', handleScopeSwitch);
    window.addEventListener('minadental-branch-changed', handleScopeSwitch);

    const unsubscribeRealtime = subscribeToTableRealtime<T>(table, {
      filter,
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

  return { data, loading, status, isStale, error, refresh: refreshAndBroadcast };
}
