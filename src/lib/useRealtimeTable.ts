import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from './supabase';
import type { TableName } from './supabase';
import { broadcastClinicSyncEvent, getActiveClinicUser, initGlobalCloudSync, type SyncBroadcastPayload } from './cloudSyncEngine';
import { CLINIC_SEED_MAP } from './seedClinicData';
import { archiveDeletedRecord, loadTableMirrorFromVault, saveTableMirrorToVault } from './dataVault';

/**
 * High-performance realtime table hook with instant offline-first seed cache,
 * full un-truncated IndexedDB Vault mirror, automatic Zero-Delete archival,
 * non-blocking background synchronization, and cross-user broadcast.
 */
export function useRealtimeTable<T extends { id: string }>(
  table: TableName,
  select?: string,
  filter?: { column: string; value: string | null } | null
) {
  const cacheKey = `dental_cache_${table}${filter?.value ? `_${filter.column}_${filter.value}` : ''}`;

  const [data, setData] = useState<T[]>(() => {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
      // Instant fallback to seed clinic data so no module ever starts empty or blocks
      const seed = CLINIC_SEED_MAP[table] as unknown as T[];
      if (Array.isArray(seed) && seed.length > 0) {
        return seed;
      }
      return [];
    } catch {
      const seed = (CLINIC_SEED_MAP[table] || []) as unknown as T[];
      return seed;
    }
  });

  // Non-blocking loading state (never blocks the screen)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const persistLocalMirror = useCallback((rows: T[]) => {
    try {
      localStorage.setItem(cacheKey, JSON.stringify(rows.slice(0, 500)));
    } catch {
      // ignore localStorage 5MB quota; IndexedDB Vault stores full un-truncated mirror
    }
    if (!filter?.value) {
      saveTableMirrorToVault(table, rows).catch(() => {});
    }
  }, [cacheKey, filter?.value, table]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // Hydrate from full IndexedDB Vault first if unfiltered (recovers >500 rows & offline data)
      if (!filter?.value) {
        const vaultRows = await loadTableMirrorFromVault<T>(table);
        if (vaultRows.length > 0) {
          setData((prev) => (vaultRows.length >= prev.length ? vaultRows : prev));
        }
      }

      let query = supabase.from(table).select(select ?? '*');
      if (filter && filter.value !== null && filter.value !== undefined) {
        query = query.eq(filter.column, filter.value);
      }

      // Fast 1800ms network timeout protection to avoid hanging on slow/filtered connections
      const fetchPromise = query.order('created_at', { ascending: false });
      const timeoutPromise = new Promise<{ data: null; error: { message: string } }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: { message: 'TIMEOUT' } }), 1800)
      );

      const res = await Promise.race([fetchPromise, timeoutPromise]);
      const { data: rows, error: err } = res as any;

      if (!err && Array.isArray(rows) && rows.length > 0) {
        const result = rows as unknown as T[];
        setData(result);
        setError(null);
        persistLocalMirror(result);
      } else if (err && err.message !== 'TIMEOUT') {
        setError(err.message);
      }
    } catch (e: any) {
      setError(e?.message || 'خطای اتصال به سرور');
    } finally {
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
    initGlobalCloudSync();
    fetchData();

    const handleSyncEvent = (ev: Event) => {
      const customEv = ev as CustomEvent<SyncBroadcastPayload>;
      if (customEv.detail?.type === 'TABLE_MUTATION' && customEv.detail.table === table) {
        fetchData();
      }
    };

    const handleStorageEvent = (ev: StorageEvent) => {
      if (ev.key === cacheKey && ev.newValue) {
        try {
          setData(JSON.parse(ev.newValue));
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('minadental-sync-event', handleSyncEvent);
    window.addEventListener('storage', handleStorageEvent);

    try {
      const channel = supabase
        .channel(`realtime-${table}-${Math.random().toString(36).slice(2, 7)}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table }, (payload) => {
          const newRow = payload.new as T;
          if (!newRow?.id) return;
          if (filter && filter.value !== null && filter.value !== undefined) {
            if ((newRow as any)[filter.column] !== filter.value) return;
          }
          setData((prev) => {
            if (prev.some((item) => item.id === newRow.id)) return prev;
            const updated = [newRow, ...prev];
            persistLocalMirror(updated);
            return updated;
          });
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table }, (payload) => {
          const updatedRow = payload.new as T;
          if (!updatedRow?.id) return;
          setData((prev) => {
            const updated = prev.map((item) => (item.id === updatedRow.id ? updatedRow : item));
            persistLocalMirror(updated);
            return updated;
          });
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table }, (payload) => {
          const oldRow = payload.old as { id?: string };
          if (!oldRow?.id) return;
          setData((prev) => {
            // Zero-Delete Guardian: Archive the full record BEFORE removing it from live view
            const fullRecord = prev.find((item) => item.id === oldRow.id) ?? (oldRow as Record<string, any>);
            const actor = getActiveClinicUser().fullName;
            archiveDeletedRecord(table, fullRecord, actor, 'بایگانی خودکار ضدحذف هنگام حذف از جدول').catch(() => {});

            const updated = prev.filter((item) => item.id !== oldRow.id);
            persistLocalMirror(updated);
            return updated;
          });
        })
        .subscribe();

      channelRef.current = channel;
    } catch {
      // offline / realtime unavailable
    }

    return () => {
      window.removeEventListener('minadental-sync-event', handleSyncEvent);
      window.removeEventListener('storage', handleStorageEvent);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [table, select, filter?.column, filter?.value, fetchData, cacheKey, persistLocalMirror]);

  return { data, loading, error, refresh: refreshAndBroadcast };
}
