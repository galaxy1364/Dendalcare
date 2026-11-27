import { supabase } from './supabase';
import type { TableName } from './supabase';
import { collectCompleteClinicSnapshot } from './dataVault';
import {
  ACTIVE_TENANT_ID,
  generateSaltHex,
  getActiveBranchId,
  hashSecretSync,
  hashSecretWithSalt,
  verifySaltedSecret,
} from '@/services/authentication/authService';
import { purgeClinicalLocalStorageCaches } from '@/services/supabase/scopedCache';

export type ClinicUserRole = 'manager' | 'dentist' | 'secretary' | 'assistant';

export type ClinicUserAccount = {
  id: string;
  username?: string;
  fullName: string;
  name?: string;
  role: ClinicUserRole;
  roleLabel: string;
  email: string;
  phone: string;
  /** Salted SHA-256 or deterministic hash — never plaintext PIN/password */
  pinHash?: string;
  pinSalt?: string;
  branchId?: string;
  tenantId?: string;
  avatarColor: string;
  canPublishUpdate?: boolean;
  permissions: {
    canEditPricesAfterSave: boolean;
    canDeleteCriticalRecords: boolean;
    canPublishOtaUpdate: boolean;
    canManageBackups: boolean;
    canManageStaffAndShares: boolean;
  };
};

const MANAGER_SEED_SALT = 'mina_mgr_v1';
const DENTIST_SEED_SALT = 'mina_doc_v1';
const SECRETARY_SEED_SALT = 'mina_sec_v1';
const ASSISTANT_SEED_SALT = 'mina_ast_v1';

export const DEFAULT_CLINIC_USERS: ClinicUserAccount[] = [
  {
    id: 'usr_manager_mehdi',
    username: 'dr.mehdi.amiri',
    fullName: 'دکتر مهدی امیری',
    name: 'دکتر مهدی امیری',
    role: 'manager',
    roleLabel: 'مدیر، پزشک و صاحب مطب (دسترسی ۱۰۰٪)',
    email: 'mehdi.amiri19851364@gmail.com',
    phone: '09120000000',
    pinSalt: MANAGER_SEED_SALT,
    pinHash: hashSecretSync('1234', MANAGER_SEED_SALT),
    branchId: 'main',
    tenantId: ACTIVE_TENANT_ID,
    avatarColor: '#087C76',
    canPublishUpdate: true,
    permissions: {
      canEditPricesAfterSave: true,
      canDeleteCriticalRecords: true,
      canPublishOtaUpdate: true,
      canManageBackups: true,
      canManageStaffAndShares: true,
    },
  },
  {
    id: 'usr_dentist_main',
    fullName: 'پزشک معالج کلینیک',
    name: 'پزشک معالج کلینیک',
    role: 'dentist',
    roleLabel: 'دندانپزشک',
    email: 'doctor@minadental.ir',
    phone: '09121111111',
    pinSalt: DENTIST_SEED_SALT,
    pinHash: hashSecretSync('1111', DENTIST_SEED_SALT),
    branchId: 'main',
    tenantId: ACTIVE_TENANT_ID,
    avatarColor: '#0E7490',
    canPublishUpdate: false,
    permissions: {
      canEditPricesAfterSave: false,
      canDeleteCriticalRecords: false,
      canPublishOtaUpdate: false,
      canManageBackups: false,
      canManageStaffAndShares: false,
    },
  },
  {
    id: 'usr_secretary_main',
    fullName: 'منشی و پذیرش مطب',
    name: 'منشی و پذیرش مطب',
    role: 'secretary',
    roleLabel: 'منشی (ثبت پرونده و نوبت)',
    email: 'secretary@minadental.ir',
    phone: '09122222222',
    pinSalt: SECRETARY_SEED_SALT,
    pinHash: hashSecretSync('2222', SECRETARY_SEED_SALT),
    branchId: 'main',
    tenantId: ACTIVE_TENANT_ID,
    avatarColor: '#B02364',
    canPublishUpdate: false,
    permissions: {
      canEditPricesAfterSave: false,
      canDeleteCriticalRecords: false,
      canPublishOtaUpdate: false,
      canManageBackups: false,
      canManageStaffAndShares: false,
    },
  },
  {
    id: 'usr_assistant_main',
    fullName: 'دستیار دندانپزشک',
    name: 'دستیار دندانپزشک',
    role: 'assistant',
    roleLabel: 'دستیار بالینی و انبار',
    email: 'assistant@minadental.ir',
    phone: '09123333333',
    pinSalt: ASSISTANT_SEED_SALT,
    pinHash: hashSecretSync('3333', ASSISTANT_SEED_SALT),
    branchId: 'main',
    tenantId: ACTIVE_TENANT_ID,
    avatarColor: '#176B52',
    canPublishUpdate: false,
    permissions: {
      canEditPricesAfterSave: false,
      canDeleteCriticalRecords: false,
      canPublishOtaUpdate: false,
      canManageBackups: false,
      canManageStaffAndShares: false,
    },
  },
];

const USERS_STORAGE_KEY = 'minadental_clinic_users_v4';
const ACTIVE_USER_STORAGE_KEY = 'minadental_active_user_id_v4';
const BACKUP_CONFIG_STORAGE_KEY = 'minadental_auto_backup_config_v4';
// Vite embeds the same authoritative identity used by the release manifest.
// Keep literal fallbacks only for non-Vite tooling; never override a CI identity.
export const CURRENT_APP_VERSION = typeof __MINA_EMBEDDED_SEMVER__ === 'string'
  ? __MINA_EMBEDDED_SEMVER__ : '4.18.0';
export const CURRENT_APP_BUILD = typeof __MINA_EMBEDDED_SEQUENCE__ === 'number'
  ? __MINA_EMBEDDED_SEQUENCE__ : 230;

export type UserRole = ClinicUserRole;
export const ROLE_LABELS: Record<UserRole, string> = {
  manager: 'مدیر، پزشک و صاحب مطب (دسترسی ۱۰۰٪)',
  dentist: 'دندانپزشک معالج',
  secretary: 'منشی و پذیرش',
  assistant: 'دستیار دندانپزشک',
};

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  manager: ['دسترسی کامل مدیریت', 'تغییر مبالغ مالی، چک و اقساط', 'حذف و بایگانی رکوردها', 'انتشار آپدیت سراسری', 'بک‌آپ و بازیابی ابری', 'مدیریت حقوق و سهم پرسنل'],
  dentist: ['ثبت و ویرایش طرح درمان', 'چارت پالمر', 'پرونده ایمپلنت', 'سفارش لابراتوار', 'مشاهده کارکرد ماهانه'],
  secretary: ['ثبت پرونده بیمار', 'نوبت‌دهی و تقویم', 'ثبت اولیه پرداخت‌ها', 'ارسال پیامک و پیگیری'],
  assistant: ['مدیریت موجودی انبار', 'استعلام اقلام و هشدار کمبود', 'دستیاری جراحی و مراحل درمان'],
};

export function canUserEditFinancials(role: string | null | undefined): boolean {
  return role === 'manager';
}

export type AutoBackupConfig = {
  enabled: boolean;
  mode: 'realtime' | 'scheduled' | 'both';
  scheduledTime: string;
  scheduledDate: string;
  autoCloudSupabase: boolean;
  autoLocalBrowser: boolean;
  lastCloudBackupAt: string | null;
  lastLocalBackupAt: string | null;
};

/**
 * Strips any legacy plaintext `pinOrPass` field before normalizing or persisting accounts.
 * If a legacy account still carries `pinOrPass`, migrates it immediately to salted hash.
 */
export function sanitizeUserAccount(u: Record<string, any>): ClinicUserAccount {
  const fullName = u?.fullName || u?.name || 'کاربر کلینیک';
  const role: ClinicUserRole = u?.role || 'secretary';
  const fallbackUsername =
    role === 'manager'
      ? 'dr.mehdi.amiri'
      : u?.email
      ? String(u.email).split('@')[0]
      : `${role}_${String(u?.id || 'user').slice(-4)}`;

  let pinSalt = typeof u?.pinSalt === 'string' && u.pinSalt ? u.pinSalt : undefined;
  let pinHash = typeof u?.pinHash === 'string' && u.pinHash ? u.pinHash : undefined;

  if (!pinHash && typeof u?.pinOrPass === 'string' && u.pinOrPass) {
    pinSalt = pinSalt || generateSaltHex(8);
    pinHash = hashSecretSync(u.pinOrPass, pinSalt);
  }

  return {
    id: u?.id || `usr_${Date.now()}`,
    username: u?.username || fallbackUsername,
    fullName,
    name: fullName,
    role,
    roleLabel: u?.roleLabel || ROLE_LABELS[role] || 'کاربر',
    email: u?.email || '',
    phone: u?.phone || '',
    pinHash,
    pinSalt,
    branchId: u?.branchId || getActiveBranchId(),
    tenantId: u?.tenantId || ACTIVE_TENANT_ID,
    avatarColor: u?.avatarColor || '#087C76',
    canPublishUpdate: u?.canPublishUpdate ?? role === 'manager',
    permissions: u?.permissions || {
      canEditPricesAfterSave: role === 'manager',
      canDeleteCriticalRecords: role === 'manager',
      canPublishOtaUpdate: role === 'manager',
      canManageBackups: role === 'manager',
      canManageStaffAndShares: role === 'manager',
    },
  };
}

export async function createCredentialHashPair(plainSecret: string): Promise<{
  pinHash: string;
  pinSalt: string;
}> {
  const pinSalt = generateSaltHex(12);
  const pinHash = await hashSecretWithSalt(plainSecret, pinSalt);
  return { pinHash, pinSalt };
}

export async function verifyUserCredential(
  user: ClinicUserAccount,
  candidateSecret: string
): Promise<boolean> {
  return verifySaltedSecret(candidateSecret, user.pinHash, user.pinSalt);
}

export function loadClinicUsers(): ClinicUserAccount[] {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (!raw) return DEFAULT_CLINIC_USERS.map((u) => sanitizeUserAccount(u));
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const sanitized = parsed.map(sanitizeUserAccount);
      // Migrate away any legacy plaintext pinOrPass if detected
      if (parsed.some((p: Record<string, unknown>) => 'pinOrPass' in p)) {
        localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(sanitized));
      }
      return sanitized;
    }
  } catch {
    // ignore
  }
  return DEFAULT_CLINIC_USERS.map((u) => sanitizeUserAccount(u));
}

export function saveClinicUsers(users: ClinicUserAccount[]): void {
  const sanitized = users.map((u) => sanitizeUserAccount(u));
  try {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // ignore
  }
  // Never sync pinHash / pinSalt / credentials to public clinic_settings metadata
  const publicDirectory = sanitized.map(({ pinHash: _h, pinSalt: _s, ...pub }) => pub);
  try {
    void Promise.resolve(
      supabase.from('clinic_settings').upsert(
        {
          key: 'clinic_users_directory_v4',
          value: JSON.stringify(publicDirectory),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      )
    ).catch(() => {});
  } catch {
    // non-fatal when offline
  }
}

export function getActiveClinicUser(): ClinicUserAccount {
  const users = loadClinicUsers();
  try {
    const activeId = localStorage.getItem(ACTIVE_USER_STORAGE_KEY);
    if (activeId) {
      const found = users.find((u) => u.id === activeId);
      if (found) return sanitizeUserAccount(found);
    }
  } catch {
    // ignore
  }
  return sanitizeUserAccount(users[0] ?? DEFAULT_CLINIC_USERS[0]);
}

export function setActiveClinicUserId(id: string): ClinicUserAccount {
  const users = loadClinicUsers();
  const prevId = typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_USER_STORAGE_KEY) : null;
  const found = sanitizeUserAccount(users.find((u) => u.id === id) ?? users[0] ?? DEFAULT_CLINIC_USERS[0]);
  try {
    if (prevId && prevId !== found.id) {
      purgeClinicalLocalStorageCaches({ userId: prevId });
    }
    localStorage.setItem(ACTIVE_USER_STORAGE_KEY, found.id);
    window.dispatchEvent(new CustomEvent('minadental-user-changed', { detail: found }));
  } catch {
    // ignore
  }
  return found;
}

export function loadAutoBackupConfig(): AutoBackupConfig {
  try {
    const raw = localStorage.getItem(BACKUP_CONFIG_STORAGE_KEY);
    if (raw) return { ...getDefaultBackupConfig(), ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return getDefaultBackupConfig();
}

function getDefaultBackupConfig(): AutoBackupConfig {
  return {
    enabled: true,
    mode: 'both',
    scheduledTime: '21:30',
    scheduledDate: '',
    autoCloudSupabase: true,
    autoLocalBrowser: true,
    lastCloudBackupAt: null,
    lastLocalBackupAt: null,
  };
}

export function saveAutoBackupConfig(cfg: AutoBackupConfig): void {
  try {
    localStorage.setItem(BACKUP_CONFIG_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore
  }
}

export type SyncBroadcastPayload = {
  type: 'TABLE_MUTATION' | 'OTA_UPDATE_PUSH' | 'CLOUD_BACKUP_DONE';
  table?: TableName;
  action?: string;
  actorName: string;
  actorRole: string;
  version?: string;
  releaseNotes?: string;
  timestamp: string;
};

let globalChannel: ReturnType<typeof supabase.channel> | null = null;
let localBus: BroadcastChannel | null = null;

function ensureSyncChannels() {
  if (typeof window === 'undefined') return;
  if (!localBus && 'BroadcastChannel' in window) {
    try {
      localBus = new BroadcastChannel('minadental_realtime_bus_v4');
      localBus.onmessage = (ev) => {
        if (ev.data) {
          window.dispatchEvent(new CustomEvent('minadental-sync-event', { detail: ev.data }));
        }
      };
    } catch {
      // ignore
    }
  }

  if (!globalChannel) {
    try {
      const currentUser = getActiveClinicUser();
      globalChannel = supabase.channel('minadental_global_sync_v4', {
        config: {
          broadcast: { self: false },
          presence: { key: currentUser.id },
        },
      });

      globalChannel
        .on('broadcast', { event: 'clinic_sync' }, ({ payload }) => {
          if (payload) {
            window.dispatchEvent(new CustomEvent('minadental-sync-event', { detail: payload }));
          }
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED' && globalChannel) {
            const u = getActiveClinicUser();
            await globalChannel.track({
              userId: u.id,
              fullName: u.fullName,
              roleLabel: u.roleLabel,
              avatarColor: u.avatarColor,
              onlineAt: new Date().toISOString(),
            });
          }
        });
    } catch {
      // ignore
    }
  }
}

export function initGlobalCloudSync(): void {
  ensureSyncChannels();
}

export async function broadcastClinicSyncEvent(
  payload: Omit<SyncBroadcastPayload, 'actorName' | 'actorRole' | 'timestamp'>
): Promise<void> {
  ensureSyncChannels();
  const user = getActiveClinicUser();
  const fullPayload: SyncBroadcastPayload = {
    ...payload,
    actorName: user.fullName,
    actorRole: user.roleLabel,
    timestamp: new Date().toISOString(),
  };

  try {
    localBus?.postMessage(fullPayload);
  } catch {
    // ignore
  }

  try {
    if (globalChannel) {
      await globalChannel.send({
        type: 'broadcast',
        event: 'clinic_sync',
        payload: fullPayload,
      });
    }
  } catch {
    // ignore
  }
}

export async function publishOtaUpdateToAllUsers(
  version: string,
  releaseNotes: string
): Promise<{ ok: boolean; message: string }> {
  const user = getActiveClinicUser();
  if (!user.permissions.canPublishOtaUpdate) {
    return {
      ok: false,
      message: 'فقط مدیر کلینیک (دکتر مهدی امیری) مجاز به انتشار آپدیت سراسری است.',
    };
  }

  const meta = JSON.stringify({
    version,
    releaseNotes,
    publishedBy: user.fullName,
    publishedAt: new Date().toISOString(),
  });

  try {
    const { data: existing } = await supabase
      .from('clinic_settings')
      .select('id')
      .eq('key', 'ota_live_release')
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from('clinic_settings')
        .update({ value: meta, category: 'system_ota' })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('clinic_settings')
        .insert({ key: 'ota_live_release', value: meta, category: 'system_ota' });
    }
  } catch {
    // continue with realtime broadcast even if table write fails
  }

  await broadcastClinicSyncEvent({
    type: 'OTA_UPDATE_PUSH',
    version,
    releaseNotes,
  });

  return {
    ok: true,
    message: `نسخه ${version} با موفقیت در فضای ابری منتشر شد و سیگنال آپدیت خودکار برای تمام کاربران فعال ارسال گردید.`,
  };
}

export async function performAutomaticCloudAndLocalBackup(): Promise<{
  ok: boolean;
  timestamp: string;
  totalRecords: number;
  checksum?: string;
  traceId?: string;
}> {
  const nowIso = new Date().toISOString();
  try {
    const activeUser = getActiveClinicUser();
    const snapshot = await collectCompleteClinicSnapshot(
      `${activeUser.fullName} (${activeUser.email || 'mehdi.amiri19851364@gmail.com'})`
    );

    const totalRecords = snapshot.totalRecords;

    // Store ONLY non-PII backup summary metadata in localStorage (full backup stays in IndexedDB Vault / Cloud)
    const nonPiiSummary = {
      exportedAt: snapshot.exportedAt,
      totalRecords,
      checksum: snapshot.checksum,
      traceId: snapshot.traceId,
      counts: snapshot.counts,
      version: CURRENT_APP_VERSION,
      build: CURRENT_APP_BUILD,
    };
    try {
      localStorage.removeItem('minadental_latest_auto_backup_v4');
      localStorage.setItem('minadental_latest_backup_summary_v5', JSON.stringify(nonPiiSummary));
    } catch {
      // ignore localStorage quota
    }

    try {
      const cloudSummary = JSON.stringify({
        backedUpAt: snapshot.exportedAt,
        backedUpBy: activeUser.fullName,
        version: CURRENT_APP_VERSION,
        build: CURRENT_APP_BUILD,
        traceId: snapshot.traceId,
        checksum: snapshot.checksum,
        counts: snapshot.counts,
        totalRecords,
      });
      const { data: existing } = await supabase
        .from('clinic_settings')
        .select('id')
        .eq('key', 'cloud_latest_backup_meta')
        .maybeSingle();

      if (existing?.id) {
        await supabase
          .from('clinic_settings')
          .update({ value: cloudSummary, category: 'backup' })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('clinic_settings')
          .insert({ key: 'cloud_latest_backup_meta', value: cloudSummary, category: 'backup' });
      }
    } catch {
      // ignore
    }

    const cfg = loadAutoBackupConfig();
    saveAutoBackupConfig({
      ...cfg,
      lastCloudBackupAt: snapshot.exportedAt,
      lastLocalBackupAt: snapshot.exportedAt,
    });

    await broadcastClinicSyncEvent({
      type: 'CLOUD_BACKUP_DONE',
      action: `پشتیبان‌گیری ۲۰ جدول در ابر SQL و Vault (${totalRecords.toLocaleString('fa-IR')} رکورد • ${snapshot.checksum})`,
    });

    return {
      ok: true,
      timestamp: snapshot.exportedAt,
      totalRecords,
      checksum: snapshot.checksum,
      traceId: snapshot.traceId,
    };
  } catch {
    return { ok: false, timestamp: nowIso, totalRecords: 0 };
  }
}

// ==================== COMPATIBILITY ALIASES ====================
export const loadActiveUser = getActiveClinicUser;
export const saveActiveUser = (u: ClinicUserAccount) => setActiveClinicUserId(u.id);

export function loadBackupSchedule() {
  const cfg = loadAutoBackupConfig();
  return {
    enabled: cfg.enabled,
    dailyTime: cfg.scheduledTime,
    autoCloudSync: cfg.autoCloudSupabase,
    lastBackupAt: cfg.lastCloudBackupAt,
  };
}

export function saveBackupSchedule(sched: { enabled: boolean; dailyTime: string; autoCloudSync: boolean }) {
  const current = loadAutoBackupConfig();
  saveAutoBackupConfig({
    ...current,
    enabled: sched.enabled,
    scheduledTime: sched.dailyTime,
    autoCloudSupabase: sched.autoCloudSync,
  });
}

export function initCloudSyncChannel(callbacks: {
  onSyncEvent?: (payload: any) => void;
  onOtaUpdate?: (ota: { version: string; releaseNotes: string; publishedBy: string }) => void;
  onPresenceChange?: (onlineUsers: any[]) => void;
}) {
  initGlobalCloudSync();

  const handleSync = (ev: Event) => {
    const custom = ev as CustomEvent;
    if (custom.detail) {
      callbacks.onSyncEvent?.(custom.detail);
      if (custom.detail.type === 'OTA_UPDATE_PUSH') {
        callbacks.onOtaUpdate?.({
          version: custom.detail.version || CURRENT_APP_VERSION,
          releaseNotes: custom.detail.releaseNotes || 'بروزرسانی جدید در دسترس است',
          publishedBy: custom.detail.actorName || 'مدیر کلینیک',
        });
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('minadental-sync-event', handleSync);
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('minadental-sync-event', handleSync);
    }
  };
}
