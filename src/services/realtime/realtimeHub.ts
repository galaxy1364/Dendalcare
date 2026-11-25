import { supabase, type TableName } from '@/lib/supabase';

export type RealtimeEventType = 'INSERT' | 'UPDATE' | 'DELETE';

export interface RealtimeTableListener<T = Record<string, unknown>> {
  id: string;
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

/**
 * Deduplicated Realtime Subscription Hub (Phase 02 & Phase 09)
 * Maintains at most ONE Supabase realtime channel per table across all mounted screens/hooks.
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
        const newRow = payload.new as T;
        if (!newRow?.id) return;
        const current = activeChannels.get(table);
        if (!current) return;
        current.listeners.forEach((lst) => {
          if (lst.filter && lst.filter.value !== null && lst.filter.value !== undefined) {
            if ((newRow as Record<string, unknown>)[lst.filter.column] !== lst.filter.value) return;
          }
          lst.onInsert?.(newRow);
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table }, (payload) => {
        const updatedRow = payload.new as T;
        if (!updatedRow?.id) return;
        const current = activeChannels.get(table);
        if (!current) return;
        current.listeners.forEach((lst) => {
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

export function getActiveRealtimeChannelCount(): number {
  return activeChannels.size;
}
