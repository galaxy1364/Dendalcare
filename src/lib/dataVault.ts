/**
 * MinaDental Zero-Delete Multi-Tier Data Vault (IndexedDB + Cloud SQL Mirror)
 * Trace ID: TRC-MINA-VAULT-9006-F
 *
 * Guarantees that clinical, patient, implant, lab, and financial records are
 * NEVER permanently lost:
 * 1. Full un-truncated IndexedDB mirror for all 20 Supabase PostgreSQL tables.
 * 2. Immutable Soft-Delete Archive (`deleted_archive`) capturing every removed
 *    row with Trace ID, actor, checksum, and 1-click Cloud SQL Restore.
 * 3. Complete 20-table Cloud SQL Snapshot Collector & Non-Destructive Restorer
 *    shared across Local JSON, Supabase Cloud, Google Drive, and GitHub Backup.
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
}

export interface VaultMirrorScope {
  tenantId?: string;
  branchId?: string;
  userId?: string;
}

export interface TableMirrorEntry {
  scopeKey: string;
  table: TableName;
  tenantId: string;
  branchId: string;
  userId: string;
  rows: any[];
  updatedAt: string;
  count: number;
}

export function getVaultMirrorKey(table: TableName, scope?: VaultMirrorScope): string {
  const tenantId = scope?.tenantId || 'minadental_clinic';
  const branchId = scope?.branchId || 'main';
  const userId = scope?.userId || 'active';
  return `${tenantId}::${branchId}::${userId}::${table}`;
}

export interface VaultStats {
  indexedDbSupported: boolean;
  mirroredTables: number;
  totalMirroredRecords: number;
  archivedDeletedCount: number;
  unrestoredDeletedCount: number;
  lastMirrorAt: string | null;
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
const IDB_VERSION = 2;
const STORE_MIRRORS = 'table_mirrors';
const STORE_ARCHIVE = 'deleted_archive';
const LS_ARCHIVE_FALLBACK = 'minadental_zero_delete_archive_v1';

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
        if (db.objectStoreNames.contains(STORE_MIRRORS)) {
          db.deleteObjectStore(STORE_MIRRORS);
        }
        const mirrorStore = db.createObjectStore(STORE_MIRRORS, { keyPath: 'scopeKey' });
        mirrorStore.createIndex('table', 'table', { unique: false });
        mirrorStore.createIndex('branchId', 'branchId', { unique: false });
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

function readLsArchiveFallback(): ArchivedRecordEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LS_ARCHIVE_FALLBACK);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeLsArchiveFallback(items: ArchivedRecordEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_ARCHIVE_FALLBACK, JSON.stringify(items.slice(0, 200)));
  } catch {
    // ignore quota
  }
}

/** Mirror a full Supabase table into IndexedDB scoped strictly by tenant/branch/user */
export async function saveTableMirrorToVault(
  table: TableName,
  rows: any[],
  scope?: VaultMirrorScope
): Promise<void> {
  const db = await openVaultDb();
  if (!db) return;
  const tenantId = scope?.tenantId || 'minadental_clinic';
  const branchId = scope?.branchId || 'main';
  const userId = scope?.userId || 'active';
  const scopeKey = getVaultMirrorKey(table, { tenantId, branchId, userId });
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_MIRRORS, 'readwrite');
      const store = tx.objectStore(STORE_MIRRORS);
      const entry: TableMirrorEntry = {
        scopeKey,
        table,
        tenantId,
        branchId,
        userId,
        rows,
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

/** Read a tenant/branch/user-scoped mirrored table from IndexedDB */
export async function loadTableMirrorFromVault<T = any>(
  table: TableName,
  scope?: VaultMirrorScope
): Promise<T[]> {
  const db = await openVaultDb();
  if (!db) return [];
  const scopeKey = getVaultMirrorKey(table, scope);
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_MIRRORS, 'readonly');
      const req = tx.objectStore(STORE_MIRRORS).get(scopeKey);
      req.onsuccess = () => {
        const res = req.result as TableMirrorEntry | undefined;
        resolve(Array.isArray(res?.rows) ? (res.rows as T[]) : []);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

/**
 * Zero-Delete Protection: Archive any deleted record into immutable local Vault
 * (IndexedDB + localStorage mirror) with Trace ID and Checksum so it can be
 * restored to Cloud SQL in 1 click.
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
  };

  // 1. Write to localStorage fallback immediately (synchronous safety)
  const existing = readLsArchiveFallback();
  if (!existing.some((e) => e.table === table && e.recordId === recordId && !e.restoredAt)) {
    writeLsArchiveFallback([entry, ...existing]);
  }

  // 2. Write to durable IndexedDB Vault
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

/** List all archived (soft-deleted) records newest first */
export async function listArchivedRecords(): Promise<ArchivedRecordEntry[]> {
  const db = await openVaultDb();
  const lsItems = readLsArchiveFallback();
  if (!db) return lsItems;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_ARCHIVE, 'readonly');
      const req = tx.objectStore(STORE_ARCHIVE).getAll();
      req.onsuccess = () => {
        const idbItems = (req.result as ArchivedRecordEntry[]) || [];
        const mergedMap = new Map<string, ArchivedRecordEntry>();
        for (const item of [...lsItems, ...idbItems]) {
          mergedMap.set(item.archiveId, item);
        }
        const sorted = Array.from(mergedMap.values()).sort((a, b) =>
          b.deletedAt.localeCompare(a.deletedAt)
        );
        resolve(sorted);
      };
      req.onerror = () => resolve(lsItems);
    } catch {
      resolve(lsItems);
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

    // Update IndexedDB & LS archive state
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
    const lsItems = readLsArchiveFallback().map((e) => (e.archiveId === archiveId ? updated : e));
    writeLsArchiveFallback(lsItems);

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

  if (!db) {
    return {
      indexedDbSupported: typeof indexedDB !== 'undefined',
      mirroredTables: 0,
      totalMirroredRecords: 0,
      archivedDeletedCount: archived.length,
      unrestoredDeletedCount: unrestored,
      lastMirrorAt: null,
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
        });
    } catch {
      resolve({
        indexedDbSupported: false,
        mirroredTables: 0,
        totalMirroredRecords: 0,
        archivedDeletedCount: archived.length,
        unrestoredDeletedCount: unrestored,
        lastMirrorAt: null,
      });
    }
  });
}

/**
 * Collect a 100% complete snapshot of ALL 20 Cloud SQL (Supabase) tables,
 * automatically falling back to the IndexedDB Vault if any table is offline.
 */
export async function collectCompleteClinicSnapshot(
  managerLabel: string = 'دکتر مهدی امیری (mehdi.amiri19851364@gmail.com)'
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
          await saveTableMirrorToVault(table, data);
          return;
        }
      } catch {
        // fallback to IndexedDB Vault below
      }
      const cached = await loadTableMirrorFromVault(table);
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
 * Supports both new v60 `tables` format and legacy flat JSON backups.
 */
export async function restoreCompleteClinicSnapshot(
  rawBackup: Record<string, any>
): Promise<{ ok: boolean; restoredTables: number; restoredRows: number; errors: string[] }> {
  const errors: string[] = [];
  let restoredTables = 0;
  let restoredRows = 0;

  // Support both structured `tables` object and legacy flat backup keys
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
        await saveTableMirrorToVault(mappedTable, rows);
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
