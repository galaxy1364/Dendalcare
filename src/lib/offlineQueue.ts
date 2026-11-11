import { supabase } from '@/lib/supabase';

export interface OfflineMutationItem {
  id: string;
  table: string;
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: any;
  timestamp: number;
  status: 'pending' | 'syncing' | 'failed';
  retryCount: number;
  error?: string;
}

const STORAGE_KEY = 'minadental_offline_queue_v1';

export function getOfflineQueue(): OfflineMutationItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error('Failed to read offline queue:', err);
    return [];
  }
}

export function saveOfflineQueue(queue: OfflineMutationItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (err) {
    console.error('Failed to write offline queue:', err);
  }
}

export function enqueueOfflineMutation(
  table: string,
  type: 'INSERT' | 'UPDATE' | 'DELETE',
  payload: any
): OfflineMutationItem {
  const queue = getOfflineQueue();
  const newItem: OfflineMutationItem = {
    id: `off_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    table,
    type,
    payload,
    timestamp: Date.now(),
    status: 'pending',
    retryCount: 0,
  };
  queue.push(newItem);
  saveOfflineQueue(queue);

  // Register BackgroundSync if supported by Service Worker
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then((reg: any) => {
        return reg.sync.register('sync-dental-offline-queue');
      })
      .catch((err) => {
        console.warn('BackgroundSync registration failed or omitted:', err);
      });
  }

  return newItem;
}

export function clearOfflineQueue(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

export async function processOfflineQueue(): Promise<{
  processed: number;
  failed: number;
  errors: string[];
}> {
  const queue = getOfflineQueue();
  if (queue.length === 0) {
    return { processed: 0, failed: 0, errors: [] };
  }

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];
  const remainingQueue: OfflineMutationItem[] = [];

  for (const item of queue) {
    try {
      let res;
      if (item.type === 'INSERT') {
        res = await supabase.from(item.table).insert(item.payload);
      } else if (item.type === 'UPDATE') {
        res = await supabase.from(item.table).update(item.payload).eq('id', item.payload.id);
      } else if (item.type === 'DELETE') {
        res = await supabase.from(item.table).delete().eq('id', item.payload.id);
      }

      if (res?.error) {
        throw res.error;
      }

      processed++;
    } catch (err: any) {
      failed++;
      const errMsg = err?.message || String(err);
      errors.push(`${item.table}:${item.type} - ${errMsg}`);

      if (item.retryCount < 3) {
        remainingQueue.push({
          ...item,
          retryCount: item.retryCount + 1,
          status: 'failed',
          error: errMsg,
        });
      }
    }
  }

  saveOfflineQueue(remainingQueue);
  return { processed, failed, errors };
}

// Auto-listen to window 'online' event to process queue automatically
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[OfflineQueue] Device came online, auto-flushing offline queue...');
    processOfflineQueue().catch(console.error);
  });
}
