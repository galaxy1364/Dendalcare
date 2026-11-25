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
  | 'unauthorized';

const REQUEST_TIMEOUT_MS = 6500;
const MAX_RETRY_ATTEMPTS = 2;

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
 * Pure server-reconciliation helper (exported for Phase 02 & Phase 10 unit testing).
 * Ensures an empty array `[]` from the server clears state & cache rather than preserving stale rows.
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
  if (isUnauthorizedResponse(error)) {
    return { rows: [], status: 'unauthorized', clearCache: true, isStale: false };
  }
  if (isOffline) {
    return { rows: null, status: 'offline', clearCache: false, isStale: true };
  }
  return { rows: null, status: 'error', clearCache: false, isStale: true };
}

/**
 * Phase 02 & Phase 09 hardened realtime table hook:
 * - Zero production seed data fallback
 * - Empty `[]` server response clears state and local mirrors
 * - Scoped caching by tenantId, branchId, userId, table, filter (never stores sensitive PII in localStorage)
 * - Deduplicated single Realtime channel per table via realtimeHub
 * - AbortController + retry backoff instead of fixed timeout Promise.race
 * - Explicit loading / ready / empty / error / offline / unauthorized + isStale states
 */
export function useRealtimeTable<T extends { id: string }>(
  table: TableName,
  select?: string,
  filter?: { column: string; value: string | null } | null
) {
  const activeUser = getActiveClinicUser();
  const branchId = getActiveBranchId();
  const scope = {
    tenantId: activeUser.tenantId || ACTIVE_TENANT_ID,
    branchId,
    userId: activeUser.id,
    table,
    filter,
  };

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

  const persistLocalMirror = useCallback(
    (rows: T[]) => {
      if (rows.length === 0) {
        clearScopedCacheEntry(scope);
      } else {
        writeScopedNonSensitiveCache(scope, rows);
      }
      if (!filter?.value) {
        saveTableMirrorToVault(table, rows).catch(() => {});
      }
    },
    [table, scope.tenantId, scope.branchId, scope.userId, filter?.column, filter?.value]
  );

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const offlineNow = typeof navigator !== 'undefined' && navigator.onLine === false;
    setLoading(true);
    setStatus((prev) => (prev === 'ready' ? 'ready' : offlineNow ? 'offline' : 'loading'));

    // Hydrate from IndexedDB Vault as fallback ONLY when offline
    if (offlineNow && !filter?.value) {
      try {
        const vaultRows = await loadTableMirrorFromVault<T>(table);
        if (mountedRef.current && !controller.signal.aborted) {
          setData(vaultRows);
          setStatus(vaultRows.length > 0 ? 'offline' : 'empty');
          setIsStale(vaultRows.length > 0);
          setLoading(false);
        }
      } catch {
        if (mountedRef.current) {
          setStatus('offline');
          setLoading(false);
        }
      }
      return;
    }

    let attempt = 0;
    let lastError: { message?: string; code?: string; status?: number } | null = null;
    let resolvedRows: T[] | null = null;

    while (attempt <= MAX_RETRY_ATTEMPTS && !controller.signal.aborted) {
      const timeoutHandle = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        let query = supabase.from(table).select(select ?? '*');
        if (filter && filter.value !== null && filter.value !== undefined) {
          query = query.eq(filter.column, filter.value);
        }
        if (typeof (query as any).abortSignal === 'function') {
          query = (query as any).abortSignal(controller.signal);
        }
        const { data: rows, error: err, status: httpStatus } = await query.order('created_at', {
          ascending: false,
        });
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
        if (isUnauthorizedResponse(lastError)) break;
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

    if (!mountedRef.current) return;

    const reconciled = reconcileServerRows<T>({
      serverRows: resolvedRows,
      error: lastError,
      isOffline: typeof navigator !== 'undefined' && navigator.onLine === false,
    });

    if (reconciled.rows !== null) {
      setData(reconciled.rows);
      setError(reconciled.status === 'unauthorized' ? lastError?.message || 'دسترسی غیرمجاز' : null);
      setStatus(reconciled.status);
      setIsStale(reconciled.isStale);
      if (reconciled.clearCache) {
        clearScopedCacheEntry(scope);
        if (!filter?.value) {
          saveTableMirrorToVault(table, []).catch(() => {});
        }
      } else {
        persistLocalMirror(reconciled.rows);
      }
    } else {
      // Server temporarily unreachable — recover local mirror ONLY for resilience and mark stale
      if (!filter?.value) {
        try {
          const vaultRows = await loadTableMirrorFromVault<T>(table);
          if (mountedRef.current && vaultRows.length > 0) {
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

    if (mountedRef.current) {
      setLoading(false);
    }
  }, [table, select, filter?.column, filter?.value, persistLocalMirror]);

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
      void fetchData();
    };

    window.addEventListener('minadental-sync-event', handleSyncEvent);
    window.addEventListener('minadental-user-changed', handleScopeSwitch);
    window.addEventListener('minadental-branch-changed', handleScopeSwitch);

    const unsubscribeRealtime = subscribeToTableRealtime<T>(table, {
      filter,
      onInsert: (newRow) => {
        setData((prev) => {
          if (prev.some((item) => item.id === newRow.id)) return prev;
          const updated = [newRow, ...prev];
          persistLocalMirror(updated);
          setStatus('ready');
          setIsStale(false);
          return updated;
        });
      },
      onUpdate: (updatedRow) => {
        setData((prev) => {
          const updated = prev.map((item) => (item.id === updatedRow.id ? updatedRow : item));
          persistLocalMirror(updated);
          return updated;
        });
      },
      onDelete: (oldRow) => {
        setData((prev) => {
          const fullRecord = prev.find((item) => item.id === oldRow.id) ?? (oldRow as Record<string, unknown>);
          const actor = getActiveClinicUser().fullName;
          archiveDeletedRecord(table, fullRecord, actor, 'بایگانی خودکار ضدحذف هنگام حذف از جدول').catch(() => {});
          const updated = prev.filter((item) => item.id !== oldRow.id);
          persistLocalMirror(updated);
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
  }, [table, select, filter?.column, filter?.value, fetchData, persistLocalMirror]);

  return { data, loading, status, isStale, error, refresh: refreshAndBroadcast };
}
