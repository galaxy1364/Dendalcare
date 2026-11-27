import {
  rawSupabase as supabase,
  SUPABASE_PROJECT_REF,
  getBackendNamespaceKey,
} from '@/lib/supabaseCore';
import { getRuntimeAuthStatus } from '@/services/authentication/authService';

export interface OfflineMutationItem {
  id: string;
  projectRef?: string;
  table: string;
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: any;
  timestamp: number;
  status: 'pending' | 'syncing' | 'failed';
  retryCount: number;
  error?: string;
}

export const LEGACY_OFFLINE_QUEUE_STORAGE_KEY = 'minadental_offline_queue_v1';
export function getOfflineQueueStorageKey(projectRef: string = SUPABASE_PROJECT_REF): string {
  return getBackendNamespaceKey(LEGACY_OFFLINE_QUEUE_STORAGE_KEY, projectRef);
}
export const OFFLINE_QUEUE_STORAGE_KEY = getOfflineQueueStorageKey(SUPABASE_PROJECT_REF);
const STORAGE_KEY = OFFLINE_QUEUE_STORAGE_KEY;

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

let memoryOfflineQueue: OfflineMutationItem[] = [];

export function getOfflineQueue(): OfflineMutationItem[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return [...memoryOfflineQueue];
  }
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
  memoryOfflineQueue = [...queue];
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
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
    projectRef: SUPABASE_PROJECT_REF,
    table,
    type,
    payload,
    timestamp: Date.now(),
    status: 'pending',
    retryCount: 0,
  };
  queue.push(newItem);
  saveOfflineQueue(queue);

  if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then((reg: any) => reg.sync.register('sync-dental-offline-queue'))
      .catch(() => {});
  }

  return newItem;
}

export function clearOfflineQueue(): void {
  memoryOfflineQueue = [];
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  emitQueueChanged(0);
}

export async function processOfflineQueue(client: any = supabase): Promise<{
  processed: number;
  failed: number;
  blocked: number;
  reconciledLocal: number;
  errors: string[];
}> {
  const queue = getOfflineQueue();
  if (queue.length === 0) {
    return { processed: 0, failed: 0, blocked: 0, reconciledLocal: 0, errors: [] };
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { processed: 0, failed: queue.length, blocked: 0, reconciledLocal: 0, errors: ['Device is offline'] };
  }

  // V14 Security Guard: NEVER replay queued offline mutations while session membership is unauthorized/revoked
  if (getRuntimeAuthStatus() === 'unauthorized') {
    return {
      processed: 0,
      failed: queue.length,
      blocked: queue.length,
      reconciledLocal: 0,
      errors: ['UNAUTHORIZED_SESSION_REPLAY_BLOCKED'],
    };
  }

  let processed = 0;
  let failed = 0;
  let blocked = 0;
  let reconciledLocal = 0;
  const errors: string[] = [];
  const remainingQueue: OfflineMutationItem[] = [];

  for (const item of queue) {
    // V11 Safety Guard: NEVER replay queued writes from a different Supabase backend project
    if (item.projectRef && item.projectRef !== SUPABASE_PROJECT_REF) {
      failed++;
      blocked++;
      errors.push(`${item.table}:${item.type} - CROSS_BACKEND_REPLAY_BLOCKED (${item.projectRef})`);
      remainingQueue.push({
        ...item,
        status: 'failed',
        error: `CROSS_BACKEND_REPLAY_BLOCKED: item belongs to ${item.projectRef}, active project is ${SUPABASE_PROJECT_REF}`,
      });
      continue;
    }

    // Historical installment progress writes may have lost their original CAS
    // predicate when queued. Do not guess the expected month or replay by ID.
    if (item.table === 'installments' && item.type === 'UPDATE' &&
        ['paid_months', 'paid_amount', 'next_due_date'].some(key =>
          Object.prototype.hasOwnProperty.call(item.payload ?? {}, key))) {
      failed++;
      blocked++;
      errors.push('installments:UPDATE - MINA_INSTALLMENT_RECONCILIATION_REQUIRED');
      remainingQueue.push({ ...item, status: 'failed', error: 'MINA_INSTALLMENT_RECONCILIATION_REQUIRED' });
      continue;
    }

    try {
      let res: any;
      if (item.table === 'clinic_settings' && item.payload && typeof item.payload === 'object') {
        res =
          item.payload.tenant_id && item.payload.branch_id
            ? await client.from('clinic_settings').upsert(item.payload, { onConflict: 'tenant_id,branch_id,key' })
            : await client.from('clinic_settings').upsert(item.payload, { onConflict: 'key' });
      } else if (item.type === 'INSERT') {
        res = await client.from(item.table).insert(item.payload);
        // If duplicate primary key (already synced), fall back to upsert/update
        if (res?.error && String(res.error.code || '') === '23505' && item.payload?.id) {
          res = await client.from(item.table).update(item.payload).eq('id', item.payload.id);
        }
      } else if (item.type === 'UPDATE') {
        const targetId = item.payload?.id;
        if (!targetId) {
          processed++;
          continue;
        }
        const { id: _omitId, ...restPayload } = item.payload;
        res = await client.from(item.table).update(restPayload).eq('id', targetId);
      } else if (item.type === 'DELETE') {
        const targetId = item.payload?.id;
        if (!targetId) {
          processed++;
          continue;
        }
        res = await client.from(item.table).delete().eq('id', targetId);
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
  return { processed, failed, blocked, reconciledLocal, errors };
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
