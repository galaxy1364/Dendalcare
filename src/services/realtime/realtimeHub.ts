import { supabase, type TableName } from '@/lib/supabase';

export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

export interface RealtimeScopeGuard {
  tenantId: string;
  branchId: string;
}

export interface RealtimeTableListener<T = Record<string, unknown>> {
  id: string;
  scope?: RealtimeScopeGuard;
  filter?: { column: string; value: string | null } | null;
  onInsert?: (row: T) => void;
  onUpdate?: (row: T) => void;
  onDelete?: (oldRow: { id?: string }) => void;
}

interface SharedChannelEntry {
  channel: ReturnType<typeof supabase.channel>;
  listeners: Map<string, RealtimeTableListener<any>>;
}

const activeChannels = new Map<string, SharedChannelEntry>();
let listenerCounter = 0;

function matchesRealtimeScope(
  row: Record<string, unknown> | null | undefined,
  scope?: RealtimeScopeGuard
): boolean {
  if (!scope) return true;
  if (!row) return false;
  const rowTenant = typeof row.tenant_id === 'string' ? row.tenant_id.trim() : '';
  const rowBranch = typeof row.branch_id === 'string' ? row.branch_id.trim() : '';
  return Boolean(
    scope.tenantId &&
      scope.branchId &&
      rowTenant === scope.tenantId &&
      rowBranch === scope.branchId
  );
}

/**
 * Deduplicated, Scope-Guarded Realtime Subscription Hub (V4 P0 Security)
 * - Maintains at most ONE Supabase realtime channel per table across mounted screens.
 * - Filters every incoming INSERT/UPDATE payload strictly against active `(tenantId, branchId)`.
 * - Exposes `disconnectAllRealtimeChannels()` to tear down all subscriptions on user/branch switch or logout.
 */
export function subscribeToTableRealtime<T extends { id: string }>(
  table: TableName,
  callbacks: Omit<RealtimeTableListener<T>, 'id'>
): () => void {
  listenerCounter += 1;
  const listenerId = `${table}_${listenerCounter}`;
  const listener: RealtimeTableListener<T> = { id: listenerId, ...callbacks };

  let entry = activeChannels.get(table);
  if (!entry) {
    const channel = supabase
      .channel(`shared-rt-${table}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table }, (payload) => {
        const newRow = payload.new as T & Record<string, unknown>;
        if (!newRow?.id) return;
        const current = activeChannels.get(table);
        if (!current) return;
        current.listeners.forEach((lst) => {
          if (!matchesRealtimeScope(newRow, lst.scope)) return;
          if (lst.filter && lst.filter.value !== null && lst.filter.value !== undefined) {
            if (newRow[lst.filter.column] !== lst.filter.value) return;
          }
          lst.onInsert?.(newRow);
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table }, (payload) => {
        const updatedRow = payload.new as T & Record<string, unknown>;
        if (!updatedRow?.id) return;
        const current = activeChannels.get(table);
        if (!current) return;
        current.listeners.forEach((lst) => {
          if (!matchesRealtimeScope(updatedRow, lst.scope)) return;
          if (lst.filter && lst.filter.value !== null && lst.filter.value !== undefined) {
            if (updatedRow[lst.filter.column] !== lst.filter.value) return;
          }
          lst.onUpdate?.(updatedRow);
        });
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table }, (payload) => {
        const oldRow = payload.old as { id?: string };
        if (!oldRow?.id) return;
        const current = activeChannels.get(table);
        if (!current) return;
        current.listeners.forEach((lst) => {
          lst.onDelete?.(oldRow);
        });
      })
      .subscribe();

    entry = { channel, listeners: new Map() };
    activeChannels.set(table, entry);
  }

  entry.listeners.set(listenerId, listener);

  return () => {
    const current = activeChannels.get(table);
    if (!current) return;
    current.listeners.delete(listenerId);
    if (current.listeners.size === 0) {
      try {
        supabase.removeChannel(current.channel);
      } catch {
        // ignore channel cleanup failures
      }
      activeChannels.delete(table);
    }
  };
}

/** Immediately tear down all realtime channels on user switch, branch switch, or sign-out */
export function disconnectAllRealtimeChannels(): void {
  for (const [, entry] of activeChannels.entries()) {
    entry.listeners.clear();
    try {
      supabase.removeChannel(entry.channel);
    } catch {
      // ignore cleanup failures
    }
  }
  activeChannels.clear();
}

export function getActiveRealtimeChannelCount(): number {
  return activeChannels.size;
}
