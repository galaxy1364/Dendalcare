/**
 * Scoped Cache & Zero-PII LocalStorage Policy (Phase 02 — Security & Sync)
 * - Cache keys always include tenantId, branchId, userId, table, and filter.
 * - Sensitive medical and financial tables are NEVER written in plaintext to localStorage.
 * - Production builds NEVER fall back to demo/seed data.
 */

import { SUPABASE_PROJECT_REF } from '@/lib/supabaseCore';

export interface CacheScope {
  projectRef?: string;
  tenantId: string;
  branchId: string;
  userId: string;
  table: string;
  filter?: { column: string; value: string | null } | null;
}

export const SENSITIVE_CLINICAL_TABLES = new Set<string>([
  'patients',
  'appointments',
  'treatments',
  'treatment_services',
  'payments',
  'finance_transactions',
  'installments',
  'checks',
  'safteh',
  'implants',
  'lab_orders',
  'reminders',
  'staff',
  'staff_salaries',
  'staff_shares',
  'messages',
  'tooth_conditions',
]);

const CACHE_PREFIX = 'md_scoped_v1';

export function getScopedCacheKey(scope: CacheScope): string {
  const projectRef = (scope.projectRef || SUPABASE_PROJECT_REF).trim();
  const filterKey =
    scope.filter && scope.filter.value
      ? `${scope.filter.column}:${scope.filter.value}`
      : 'all';
  return `${CACHE_PREFIX}__p_${projectRef}__t_${scope.tenantId || 'default'}__b_${scope.branchId || 'main'}__u_${scope.userId || 'anon'}__tbl_${scope.table}__f_${filterKey}`;
}

export function isSensitiveTable(table: string): boolean {
  return SENSITIVE_CLINICAL_TABLES.has(table);
}

/**
 * Seed data is strictly prohibited in production builds.
 * In local dev/test, it requires explicit opt-in via VITE_ENABLE_DEMO_SEED === 'true'.
 */
export function isDemoSeedAllowed(): boolean {
  try {
    const metaEnv = (import.meta as unknown as { env?: Record<string, unknown> })?.env;
    if (metaEnv?.PROD === true || metaEnv?.MODE === 'production') {
      return false;
    }
    return metaEnv?.VITE_ENABLE_DEMO_SEED === 'true';
  } catch {
    return false;
  }
}

export function readScopedNonSensitiveCache<T>(scope: CacheScope): T[] | null {
  if (typeof window === 'undefined' || isSensitiveTable(scope.table)) {
    return null;
  }
  try {
    const key = getScopedCacheKey(scope);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : null;
  } catch {
    return null;
  }
}

export function writeScopedNonSensitiveCache<T>(scope: CacheScope, rows: T[]): void {
  if (typeof window === 'undefined' || isSensitiveTable(scope.table)) {
    return;
  }
  try {
    const key = getScopedCacheKey(scope);
    window.localStorage.setItem(key, JSON.stringify(rows.slice(0, 200)));
  } catch {
    // ignore storage quota
  }
}

export function clearScopedCacheEntry(scope: CacheScope): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(getScopedCacheKey(scope));
  } catch {
    // ignore
  }
}

/**
 * Purges legacy unscoped `dental_cache_*` keys and any scoped cache entries on user/branch switch or logout.
 */
export function purgeClinicalLocalStorageCaches(opts?: { userId?: string; branchId?: string }): void {
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k) continue;
      if (k.startsWith('dental_cache_')) {
        keysToRemove.push(k);
      } else if (k.startsWith(`${CACHE_PREFIX}__p_${SUPABASE_PROJECT_REF}__`)) {
        if (!opts || (opts.userId && k.includes(`__u_${opts.userId}__`)) || (opts.branchId && k.includes(`__b_${opts.branchId}__`))) {
          keysToRemove.push(k);
        }
      } else if (k === 'minadental_latest_auto_backup_v4') {
        // Legacy unencrypted full clinical snapshot in localStorage must not persist
        keysToRemove.push(k);
      }
    }
    for (const k of keysToRemove) {
      window.localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}
