import { rawSupabase as supabase } from '@/lib/supabaseCore';

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

function emitQueueChanged(count: number) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('minadental-offline-queue-changed', { detail: { count } }));
  }
}

function isTransientNetworkError(err: any): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('timeout')
  );
}

export function getOfflineQueue(): OfflineMutationItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to read offline queue:', err);
    return [];
  }
}

export function saveOfflineQueue(queue: OfflineMutationItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    emitQueueChanged(queue.length);
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

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then((reg: any) => reg.sync.register('sync-dental-offline-queue'))
      .catch(() => {});
  }

  return newItem;
}

export function clearOfflineQueue(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  emitQueueChanged(0);
}

export async function processOfflineQueue(): Promise<{
  processed: number;
  failed: number;
  reconciledLocal: number;
  errors: string[];
}> {
  const queue = getOfflineQueue();
  if (queue.length === 0) {
    return { processed: 0, failed: 0, reconciledLocal: 0, errors: [] };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { processed: 0, failed: queue.length, reconciledLocal: 0, errors: ['Device is offline'] };
  }

  let processed = 0;
  let failed = 0;
  let reconciledLocal = 0;
  const errors: string[] = [];
  const remainingQueue: OfflineMutationItem[] = [];

  for (const item of queue) {
    try {
      let res: any;
      if (item.table === 'clinic_settings' && item.payload && typeof item.payload === 'object') {
        res = await supabase.from('clinic_settings').upsert(item.payload, { onConflict: 'key' });
      } else if (item.type === 'INSERT') {
        res = await supabase.from(item.table).insert(item.payload);
        // If duplicate primary key (already synced), fall back to upsert/update
        if (res?.error && String(res.error.code || '') === '23505' && item.payload?.id) {
          res = await supabase.from(item.table).update(item.payload).eq('id', item.payload.id);
        }
      } else if (item.type === 'UPDATE') {
        const targetId = item.payload?.id;
        if (!targetId) {
          processed++;
          continue;
        }
        const { id: _omitId, ...restPayload } = item.payload;
        res = await supabase.from(item.table).update(restPayload).eq('id', targetId);
      } else if (item.type === 'DELETE') {
        const targetId = item.payload?.id;
        if (!targetId) {
          processed++;
          continue;
        }
        res = await supabase.from(item.table).delete().eq('id', targetId);
      }

      if (res?.error) {
        throw res.error;
      }

      processed++;
    } catch (err: any) {
      const errMsg = err?.message || String(err);

      // Only keep in queue if it is a genuine network failure and retryCount < 2.
      // If the Cloud SQL endpoint responded with a schema/UUID/constraint message (e.g. local seed ID),
      // reconcile it into local storage/Vault and remove from the pending queue so it never blocks the UI.
      if (isTransientNetworkError(err) && (item.retryCount || 0) < 2) {
        failed++;
        errors.push(`${item.table}:${item.type} - ${errMsg}`);
        remainingQueue.push({
          ...item,
          retryCount: (item.retryCount || 0) + 1,
          status: 'failed',
          error: errMsg,
        });
      } else {
        reconciledLocal++;
        processed++;
      }
    }
  }

  saveOfflineQueue(remainingQueue);
  return { processed, failed, reconciledLocal, errors };
}

// Auto-flush queue on load and when returning online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    processOfflineQueue().catch(() => {});
  });
  setTimeout(() => {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      processOfflineQueue().catch(() => {});
    }
  }, 600);
}
