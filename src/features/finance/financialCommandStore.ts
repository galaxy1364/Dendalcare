import { getBackendNamespaceKey, SUPABASE_PROJECT_REF } from '@/lib/supabaseCore';
import {
  getActiveBranchId,
  getActiveTenantId,
  getRuntimeAuthStatus,
  getRuntimeServerVerifiedRole,
  type AuthStatus,
} from '@/services/authentication/authService';
import { resolveStrictMembershipRole } from '@/services/permissions/accessControl';
import type {
  FinanceActorContext,
  QueuedFinanceCommandDraft,
  StoredFinanceIdempotencyRecord,
} from './financialCommandTypes';

export const inFlightCommandLocks = new Set<string>();
const memoryIdempotencyCache = new Map<string, StoredFinanceIdempotencyRecord>();
let memoryOfflineFinanceDrafts: QueuedFinanceCommandDraft[] = [];

export function getIdempotencyStorageKey(projectRef = SUPABASE_PROJECT_REF): string {
  return getBackendNamespaceKey('minadental_v16_fin_idempotency_v1', projectRef);
}

export function getOfflineDraftStorageKey(projectRef = SUPABASE_PROJECT_REF): string {
  return getBackendNamespaceKey('minadental_v16_fin_offline_drafts_v1', projectRef);
}

export function resolveFinanceActor(ctx?: FinanceActorContext): {
  role: string;
  actorId: string;
  tenantId: string;
  branchId: string;
  sessionStatus: AuthStatus;
} {
  const sessionStatus = ctx?.sessionStatus ?? getRuntimeAuthStatus();
  const serverVerifiedRole = ctx?.serverVerifiedRole ?? getRuntimeServerVerifiedRole();
  let localRole = ctx?.localRole ?? null;
  let userId = ctx?.userId ?? null;

  if (!localRole && typeof window !== 'undefined') {
    try {
      const activeId = window.localStorage.getItem('minadental_active_user_id_v4');
      const rawUsers = window.localStorage.getItem('minadental_clinic_users_v4');
      if (rawUsers) {
        const users = JSON.parse(rawUsers);
        if (Array.isArray(users) && users.length > 0) {
          const matched = (activeId && users.find((u: any) => u.id === activeId)) || users[0];
          localRole = matched?.role || null;
          if (!userId) userId = matched?.id || null;
        }
      }
    } catch {
      // ignore storage error
    }
  }

  const effectiveRole = resolveStrictMembershipRole({
    serverVerifiedRole,
    localRole,
    sessionStatus,
  });

  return {
    role: effectiveRole,
    actorId: userId || `role:${effectiveRole}`,
    tenantId: ctx?.tenantId || getActiveTenantId(),
    branchId: ctx?.branchId || getActiveBranchId(),
    sessionStatus,
  };
}

export function hashPayloadDeterministic(payload: unknown): string {
  const str = JSON.stringify(payload);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619);
    h2 = Math.imul(h2 ^ ch, 2246822507);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

export function readIdempotencyRecord(scopedKey: string): StoredFinanceIdempotencyRecord | null {
  const mem = memoryIdempotencyCache.get(scopedKey);
  if (mem) return mem;
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getIdempotencyStorageKey());
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, StoredFinanceIdempotencyRecord>;
    return map[scopedKey] || null;
  } catch {
    return null;
  }
}

export function writeIdempotencyRecord(scopedKey: string, rec: StoredFinanceIdempotencyRecord): void {
  memoryIdempotencyCache.set(scopedKey, rec);
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    const storageKey = getIdempotencyStorageKey();
    const raw = window.localStorage.getItem(storageKey);
    const map = raw ? (JSON.parse(raw) as Record<string, StoredFinanceIdempotencyRecord>) : {};
    map[scopedKey] = rec;
    window.localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // ignore storage quota errors
  }
}

export function getQueuedFinanceDrafts(): QueuedFinanceCommandDraft[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return [...memoryOfflineFinanceDrafts];
  }
  try {
    const raw = window.localStorage.getItem(getOfflineDraftStorageKey());
    if (!raw) return [...memoryOfflineFinanceDrafts];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [...memoryOfflineFinanceDrafts];
  }
}

export function saveQueuedFinanceDrafts(drafts: QueuedFinanceCommandDraft[]): void {
  memoryOfflineFinanceDrafts = [...drafts];
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  try {
    window.localStorage.setItem(getOfflineDraftStorageKey(), JSON.stringify(drafts));
  } catch {
    // ignore
  }
}

export function resetFinanceCommandRuntimeForTest(): void {
  inFlightCommandLocks.clear();
  memoryIdempotencyCache.clear();
  memoryOfflineFinanceDrafts = [];
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    window.localStorage.removeItem(getIdempotencyStorageKey());
    window.localStorage.removeItem(getOfflineDraftStorageKey());
  }
}

export function isFinanceNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg = String((err as any)?.message || err || '').toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('timeout')
  );
}
