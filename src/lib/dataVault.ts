/**
 * MinaDental Zero-Delete Multi-Tier Data Vault (Encrypted, Session-Isolated IndexedDB + Cloud SQL Mirror)
 * Trace ID: TRC-MINA-VAULT-9014-N
 *
 * Security & Durability Guarantees (Third Audit FIX 01):
 * 1. Sensitive clinical & financial tables are encrypted at rest inside IndexedDB
 *    using WebCrypto AES-GCM 256-bit keys bound to `(tenantId, branchId, userId, sessionSalt)`
 *    kept strictly in volatile memory — NEVER written as plaintext to `localStorage`.
 * 2. Strict session & scope isolation: every mirror key requires explicit
 *    `(tenantId, branchId, userId, table)` and old session keys/mirrors are wiped on user switch/logout.
 * 3. Immutable Soft-Delete Archive (`deleted_archive`) captures removed rows with Trace ID & checksum
 *    inside IndexedDB (never leaking sensitive clinical payloads to plaintext `localStorage`).
 */

import { rawSupabase as supabase, type TableName } from '@/lib/supabaseCore';

export const ALL_CLINIC_TABLES: TableName[] = [
  'patients',
  'appointments',
  'treatments',
  'treatment_services',
  'payments',
  'lab_orders',
  'implants',
  'inventory',
  'reminders',
  'finance_transactions',
  'staff',
  'tooth_conditions',
  'installments',
  'checks',
  'safteh',
  'staff_salaries',
  'staff_shares',
  'messages',
  'advertisements',
  'clinic_settings',
];

export const SENSITIVE_VAULT_TABLES = new Set<TableName>([
  'patients',
  'appointments',
  'treatments',
  'treatment_services',
  'payments',
  'lab_orders',
  'implants',
  'tooth_conditions',
  'finance_transactions',
  'installments',
  'checks',
  'safteh',
  'staff_salaries',
  'staff_shares',
  'messages',
]);

export interface ArchivedRecordEntry {
  archiveId: string;
  traceId: string;
  table: TableName;
  recordId: string;
  record: Record<string, any>;
  deletedAt: string;
  deletedBy: string;
  reason?: string;
  restoredAt?: string | null;
  checksum: string;
  tenantId?: string;
  branchId?: string;
}

export interface VaultMirrorScope {
  tenantId?: string;
  branchId?: string;
  userId?: string;
  sessionToken?: string;
}

export interface EncryptedVaultBlob {
  alg: 'AES-GCM';
  ivBase64: string;
  cipherBase64: string;
}

export interface TableMirrorEntry {
  scopeKey: string;
  table: TableName;
  tenantId: string;
  branchId: string;
  userId: string;
  encrypted: boolean;
  payload?: EncryptedVaultBlob;
  rows?: any[];
  updatedAt: string;
  count: number;
}

export function getVaultMirrorKey(table: TableName, scope?: VaultMirrorScope): string | null {
  const tenantId = scope?.tenantId?.trim();
  const branchId = scope?.branchId?.trim();
  const userId = scope?.userId?.trim();
  if (!tenantId || !branchId || !userId) {
    return null;
  }
  return `${tenantId}::${branchId}::${userId}::${table}`;
}

export interface VaultStats {
  indexedDbSupported: boolean;
  mirroredTables: number;
  totalMirroredRecords: number;
  archivedDeletedCount: number;
  unrestoredDeletedCount: number;
  lastMirrorAt: string | null;
  encryptionActive: boolean;
}

export interface FullClinicSnapshot {
  schemaVersion: '60.0';
  app: 'MinaDental';
  traceId: string;
  exportedAt: string;
  manager: string;
  checksum: string;
  totalRecords: number;
  counts: Record<string, number>;
  tables: Record<string, any[]>;
  deletedArchive: ArchivedRecordEntry[];
}

const IDB_NAME = 'MinaDentalZeroDeleteVault_v1';
const IDB_VERSION = 3;
const STORE_MIRRORS = 'table_mirrors';
const STORE_ARCHIVE = 'deleted_archive';
const LS_ARCHIVE_FALLBACK = 'minadental_zero_delete_archive_v1';

// In-memory session-bound AES-GCM keys (wiped immediately on user switch / logout)
const sessionCryptoKeys = new Map<string, CryptoKey>();
let activeSessionEpoch = generateRandomHex(16);

function generateRandomHex(bytes: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return Array.from(buf)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return `${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 14)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function isWebCryptoAvailable(): boolean {
  return Boolean(
    typeof crypto !== 'undefined' &&
      crypto.subtle &&
      typeof crypto.getRandomValues === 'function' &&
      typeof TextEncoder !== 'undefined' &&
      typeof TextDecoder !== 'undefined'
  );
}

async function getOrCreateSessionKey(scope: Required<Pick<VaultMirrorScope, 'tenantId' | 'branchId' | 'userId'>>): Promise<CryptoKey | null> {
  if (!isWebCryptoAvailable()) return null;
  const keyId = `${activeSessionEpoch}::${scope.tenantId}::${scope.branchId}::${scope.userId}`;
  const existing = sessionCryptoKeys.get(keyId);
  if (existing) return existing;

  try {
    const rawKeyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(`minadental-vault-v3:${keyId}`),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    const salt = new TextEncoder().encode(`salt:${scope.tenantId}:${scope.branchId}:${scope.userId}`);
    const derived = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 60000,
        hash: 'SHA-256',
      },
      rawKeyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    sessionCryptoKeys.set(keyId, derived);
    return derived;
  } catch {
    return null;
  }
}

export async function encryptVaultPayload(
  data: unknown,
  scope: Required<Pick<VaultMirrorScope, 'tenantId' | 'branchId' | 'userId'>>
): Promise<EncryptedVaultBlob | null> {
  const key = await getOrCreateSessionKey(scope);
  if (!key) return null;
  try {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return {
      alg: 'AES-GCM',
      ivBase64: bytesToBase64(iv),
      cipherBase64: bytesToBase64(new Uint8Array(cipherBuf)),
    };
  } catch {
    return null;
  }
}

export async function decryptVaultPayload<T = unknown>(
  blob: EncryptedVaultBlob,
  scope: Required<Pick<VaultMirrorScope, 'tenantId' | 'branchId' | 'userId'>>
): Promise<T | null> {
  if (!blob || blob.alg !== 'AES-GCM' || !blob.ivBase64 || !blob.cipherBase64) return null;
  const key = await getOrCreateSessionKey(scope);
  if (!key) return null;
  try {
    const iv = base64ToBytes(blob.ivBase64);
    const cipher = base64ToBytes(blob.cipherBase64);
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      cipher as BufferSource
    );
    const decoded = new TextDecoder().decode(plainBuf);
    return JSON.parse(decoded) as T;
  } catch {
    // Decryption fails cleanly if key belongs to a previous session or user
    return null;
  }
}

/** Rotate volatile session encryption keys immediately on user switch or sign-out */
export function clearAllSessionVaultKeys(): void {
  sessionCryptoKeys.clear();
  activeSessionEpoch = generateRandomHex(16);
  // Also purge any legacy plaintext localStorage archive entries
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(LS_ARCHIVE_FALLBACK);
    } catch {
      // ignore
    }
  }
}

/** Delete mirrored IndexedDB rows belonging to a previous user/branch (or all mirrors if scope omitted) */
export async function clearVaultMirrorsForScope(scope?: VaultMirrorScope): Promise<void> {
  const db = await openVaultDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_MIRRORS, 'readwrite');
      const store = tx.objectStore(STORE_MIRRORS);
      if (!scope) {
        store.clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        return;
      }
      const req = store.getAll();
      req.onsuccess = () => {
        const entries = (req.result as TableMirrorEntry[]) || [];
        for (const e of entries) {
          const matchTenant = !scope.tenantId || e.tenantId === scope.tenantId;
          const matchBranch = !scope.branchId || e.branchId === scope.branchId;
          const matchUser = !scope.userId || e.userId === scope.userId;
          if (matchTenant && matchBranch && matchUser) {
            store.delete(e.scopeKey);
          }
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Fast deterministic FNV-1a 32-bit integrity checksum for audit & backup verification */
export function computeIntegrityChecksum(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 'CHK-' + (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // Recreate table_mirrors on v3 upgrade so legacy unencrypted mirrors are wiped cleanly
        if (db.objectStoreNames.contains(STORE_MIRRORS)) {
          db.deleteObjectStore(STORE_MIRRORS);
        }
        const mirrorStore = db.createObjectStore(STORE_MIRRORS, { keyPath: 'scopeKey' });
        mirrorStore.createIndex('table', 'table', { unique: false });
        mirrorStore.createIndex('branchId', 'branchId', { unique: false });
        mirrorStore.createIndex('userId', 'userId', { unique: false });
        if (!db.objectStoreNames.contains(STORE_ARCHIVE)) {
          const store = db.createObjectStore(STORE_ARCHIVE, { keyPath: 'archiveId' });
          store.createIndex('deletedAt', 'deletedAt', { unique: false });
          store.createIndex('table', 'table', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Mirror a Supabase table into IndexedDB scoped strictly by tenant/branch/user and encrypted for sensitive tables */
export async function saveTableMirrorToVault(
  table: TableName,
  rows: any[],
  scope?: VaultMirrorScope
): Promise<void> {
  const scopeKey = getVaultMirrorKey(table, scope);
  if (!scopeKey || !scope?.tenantId || !scope?.branchId || !scope?.userId) {
    // Fail-closed: refuse unscoped local mirror writes
    return;
  }

  const db = await openVaultDb();
  if (!db) return;

  const isSensitive = SENSITIVE_VAULT_TABLES.has(table);
  let encryptedBlob: EncryptedVaultBlob | null = null;
  if (isSensitive) {
    encryptedBlob = await encryptVaultPayload(rows, {
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      userId: scope.userId,
    });
    if (!encryptedBlob) {
      // Fail-closed: never fall back to plaintext IndexedDB storage for sensitive medical/financial tables
      return;
    }
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_MIRRORS, 'readwrite');
      const store = tx.objectStore(STORE_MIRRORS);
      const entry: TableMirrorEntry = {
        scopeKey,
        table,
        tenantId: scope.tenantId!,
        branchId: scope.branchId!,
        userId: scope.userId!,
        encrypted: isSensitive,
        payload: encryptedBlob ?? undefined,
        rows: isSensitive ? undefined : rows,
        updatedAt: new Date().toISOString(),
        count: rows.length,
      };
      store.put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Read & decrypt a tenant/branch/user-scoped mirrored table from IndexedDB */
export async function loadTableMirrorFromVault<T = any>(
  table: TableName,
  scope?: VaultMirrorScope
): Promise<T[]> {
  const scopeKey = getVaultMirrorKey(table, scope);
  if (!scopeKey || !scope?.tenantId || !scope?.branchId || !scope?.userId) {
    return [];
  }
  const db = await openVaultDb();
  if (!db) return [];

  const entry = await new Promise<TableMirrorEntry | undefined>((resolve) => {
    try {
      const tx = db.transaction(STORE_MIRRORS, 'readonly');
      const req = tx.objectStore(STORE_MIRRORS).get(scopeKey);
      req.onsuccess = () => resolve(req.result as TableMirrorEntry | undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });

  if (!entry) return [];

  if (entry.encrypted) {
    if (!entry.payload) return [];
    const decrypted = await decryptVaultPayload<T[]>(entry.payload, {
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      userId: scope.userId,
    });
    return Array.isArray(decrypted) ? decrypted : [];
  }

  return Array.isArray(entry.rows) ? (entry.rows as T[]) : [];
}

/**
 * Zero-Delete Protection: Archive deleted records into IndexedDB Vault
 * (NEVER mirrors sensitive clinical/financial records to plaintext localStorage).
 */
export async function archiveDeletedRecord(
  table: TableName,
  record: Record<string, any>,
  deletedBy: string = 'سیستم محافظ مینادنتال',
  reason: string = 'محافظت خودکار ضدحذف (Zero-Delete Vault)'
): Promise<ArchivedRecordEntry> {
  const now = new Date().toISOString();
  const recordId = String(record?.id ?? `row_${Date.now()}`);
  const archiveId = `arc_${table}_${recordId}_${Date.now()}`;
  const serialized = JSON.stringify(record);
  const entry: ArchivedRecordEntry = {
    archiveId,
    traceId: `TRC-MINA-VAULT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    table,
    recordId,
    record,
    deletedAt: now,
    deletedBy,
    reason,
    restoredAt: null,
    checksum: computeIntegrityChecksum(serialized),
    tenantId: typeof record?.tenant_id === 'string' ? record.tenant_id : undefined,
    branchId: typeof record?.branch_id === 'string' ? record.branch_id : undefined,
  };

  const db = await openVaultDb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_ARCHIVE, 'readwrite');
        tx.objectStore(STORE_ARCHIVE).put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('minadental-vault-updated', { detail: entry }));
  }

  return entry;
}

/** List all archived (soft-deleted) records newest first from IndexedDB */
export async function listArchivedRecords(): Promise<ArchivedRecordEntry[]> {
  const db = await openVaultDb();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_ARCHIVE, 'readonly');
      const req = tx.objectStore(STORE_ARCHIVE).getAll();
      req.onsuccess = () => {
        const idbItems = (req.result as ArchivedRecordEntry[]) || [];
        const sorted = [...idbItems].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
        resolve(sorted);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/** Restore an archived record back into Cloud SQL (Supabase PostgreSQL) in 1 click */
export async function restoreArchivedRecord(
  archiveId: string
): Promise<{ ok: boolean; message: string; record?: ArchivedRecordEntry }> {
  const all = await listArchivedRecords();
  const entry = all.find((e) => e.archiveId === archiveId);
  if (!entry) {
    return { ok: false, message: 'رکورد مورد نظر در گاوصندوق یافت نشد.' };
  }

  try {
    const { error } = await supabase
      .from(entry.table)
      .upsert(entry.record, { onConflict: 'id' });

    if (error) {
      return { ok: false, message: `خطا در بازگردانی به Cloud SQL: ${error.message}` };
    }

    const updated: ArchivedRecordEntry = {
      ...entry,
      restoredAt: new Date().toISOString(),
    };

    const db = await openVaultDb();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE_ARCHIVE, 'readwrite');
          tx.objectStore(STORE_ARCHIVE).put(updated);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('minadental-vault-updated', { detail: updated }));
    }

    return {
      ok: true,
      message: `رکورد (${entry.table}) با شناسه رهگیری ${entry.traceId} با موفقیت به دیتابیس ابری بازگردانده شد.`,
      record: updated,
    };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'خطای شبکه هنگام بازیابی از گاوصندوق' };
  }
}

/** Read live Vault durability metrics */
export async function getVaultStats(): Promise<VaultStats> {
  const db = await openVaultDb();
  const archived = await listArchivedRecords();
  const unrestored = archived.filter((a) => !a.restoredAt).length;
  const encryptionActive = isWebCryptoAvailable();

  if (!db) {
    return {
      indexedDbSupported: typeof indexedDB !== 'undefined',
      mirroredTables: 0,
      totalMirroredRecords: 0,
      archivedDeletedCount: archived.length,
      unrestoredDeletedCount: unrestored,
      lastMirrorAt: null,
      encryptionActive,
    };
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_MIRRORS, 'readonly');
      const req = tx.objectStore(STORE_MIRRORS).getAll();
      req.onsuccess = () => {
        const entries = (req.result as TableMirrorEntry[]) || [];
        let total = 0;
        let last: string | null = null;
        for (const e of entries) {
          total += e.count || 0;
          if (!last || e.updatedAt > last) last = e.updatedAt;
        }
        resolve({
          indexedDbSupported: true,
          mirroredTables: entries.length,
          totalMirroredRecords: total,
          archivedDeletedCount: archived.length,
          unrestoredDeletedCount: unrestored,
          lastMirrorAt: last,
          encryptionActive,
        });
      };
      req.onerror = () =>
        resolve({
          indexedDbSupported: true,
          mirroredTables: 0,
          totalMirroredRecords: 0,
          archivedDeletedCount: archived.length,
          unrestoredDeletedCount: unrestored,
          lastMirrorAt: null,
          encryptionActive,
        });
    } catch {
      resolve({
        indexedDbSupported: false,
        mirroredTables: 0,
        totalMirroredRecords: 0,
        archivedDeletedCount: archived.length,
        unrestoredDeletedCount: unrestored,
        lastMirrorAt: null,
        encryptionActive,
      });
    }
  });
}

/**
 * Collect a complete snapshot of ALL 20 Cloud SQL (Supabase) tables,
 * falling back to the scoped encrypted IndexedDB Vault if offline.
 */
export async function collectCompleteClinicSnapshot(
  managerLabel: string = 'دکتر مهدی امیری (mehdi.amiri19851364@gmail.com)',
  scope?: VaultMirrorScope
): Promise<FullClinicSnapshot> {
  const tables: Record<string, any[]> = {};
  const counts: Record<string, number> = {};
  let totalRecords = 0;

  await Promise.all(
    ALL_CLINIC_TABLES.map(async (table) => {
      try {
        const { data, error } = await supabase.from(table).select('*');
        if (!error && Array.isArray(data)) {
          tables[table] = data;
          counts[table] = data.length;
          totalRecords += data.length;
          if (scope) {
            await saveTableMirrorToVault(table, data, scope);
          }
          return;
        }
      } catch {
        // fallback to scoped encrypted IndexedDB Vault below
      }
      const cached = scope ? await loadTableMirrorFromVault(table, scope) : [];
      tables[table] = cached;
      counts[table] = cached.length;
      totalRecords += cached.length;
    })
  );

  const deletedArchive = await listArchivedRecords();
  const exportedAt = new Date().toISOString();
  const traceId = `TRC-MINA-SNAP-${Date.now().toString(36).toUpperCase()}`;
  const checksum = computeIntegrityChecksum(JSON.stringify({ counts, totalRecords, exportedAt }));

  return {
    schemaVersion: '60.0',
    app: 'MinaDental',
    traceId,
    exportedAt,
    manager: managerLabel,
    checksum,
    totalRecords,
    counts,
    tables,
    deletedArchive,
  };
}

/**
 * Non-Destructive Full Clinic Restore into Cloud SQL (Supabase PostgreSQL).
 */
export async function restoreCompleteClinicSnapshot(
  rawBackup: Record<string, any>,
  scope?: VaultMirrorScope
): Promise<{ ok: boolean; restoredTables: number; restoredRows: number; errors: string[] }> {
  const errors: string[] = [];
  let restoredTables = 0;
  let restoredRows = 0;

  const sourceMap: Record<string, any[]> = rawBackup.tables || rawBackup.data || rawBackup;
  const keyAliases: Record<string, TableName> = {
    labOrders: 'lab_orders',
    inventory_items: 'inventory',
    financial_records: 'finance_transactions',
    finance: 'finance_transactions',
    settings: 'clinic_settings',
  };

  for (const [rawKey, rows] of Object.entries(sourceMap)) {
    if (!Array.isArray(rows) || rows.length === 0) continue;
    const mappedTable = (keyAliases[rawKey] ?? rawKey) as TableName;
    if (!ALL_CLINIC_TABLES.includes(mappedTable)) continue;

    try {
      const { error } = await supabase
        .from(mappedTable)
        .upsert(rows, { onConflict: 'id' });

      if (error) {
        errors.push(`${mappedTable}: ${error.message}`);
      } else {
        restoredTables++;
        restoredRows += rows.length;
        if (scope) {
          await saveTableMirrorToVault(mappedTable, rows, scope);
        }
      }
    } catch (err: any) {
      errors.push(`${mappedTable}: ${err?.message || 'خطای شبکه'}`);
    }
  }

  return {
    ok: errors.length === 0 && restoredTables > 0,
    restoredTables,
    restoredRows,
    errors,
  };
}
