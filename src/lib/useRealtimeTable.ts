import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from './supabase';
import type { TableName } from './supabase';
import { broadcastClinicSyncEvent, initGlobalCloudSync, type SyncBroadcastPayload } from './cloudSyncEngine';

/**
 * High-performance realtime table hook with incremental delta updates,
 * cross-user Supabase Broadcast sync, cross-tab Storage sync, and offline cache.
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
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(data.length === 0);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      let query = supabase.from(table).select(select ?? '*');
      if (filter && filter.value !== null && filter.value !== undefined) {
        query = query.eq(filter.column, filter.value);
      }
      const { data: rows, error: err } = await query.order('created_at', { ascending: false });
      if (err) {
        setError(err.message);
      } else {
        const result = (rows as unknown as T[]) ?? [];
        setData(result);
        setError(null);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(result.slice(0, 500)));
        } catch {
          // ignore quota error
        }
      }
    } catch (e: any) {
      setError(e?.message || 'خطای اتصال به سرور');
    } finally {
      setLoading(false);
    }
  }, [table, select, filter?.column, filter?.value, cacheKey]);

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
          try {
            localStorage.setItem(cacheKey, JSON.stringify(updated.slice(0, 500)));
          } catch {}
          return updated;
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table }, (payload) => {
        const updatedRow = payload.new as T;
        if (!updatedRow?.id) return;
        setData((prev) => {
          const updated = prev.map((item) => (item.id === updatedRow.id ? updatedRow : item));
          try {
            localStorage.setItem(cacheKey, JSON.stringify(updated.slice(0, 500)));
          } catch {}
          return updated;
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table }, (payload) => {
        const oldRow = payload.old as { id?: string };
        if (!oldRow?.id) return;
        setData((prev) => {
          const updated = prev.filter((item) => item.id !== oldRow.id);
          try {
            localStorage.setItem(cacheKey, JSON.stringify(updated.slice(0, 500)));
          } catch {}
          return updated;
        });
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      window.removeEventListener('minadental-sync-event', handleSyncEvent);
      window.removeEventListener('storage', handleStorageEvent);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [table, select, filter?.column, filter?.value, fetchData, cacheKey]);

  return { data, loading, error, refresh: refreshAndBroadcast };
}
