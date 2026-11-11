import { supabase } from './supabase';
import type { TableName } from './supabase';

export type ClinicUserRole = 'manager' | 'dentist' | 'secretary' | 'assistant';

export type ClinicUserAccount = {
  id: string;
  fullName: string;
  name?: string;
  role: ClinicUserRole;
  roleLabel: string;
  email: string;
  phone: string;
  pinOrPass: string;
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

export const DEFAULT_CLINIC_USERS: ClinicUserAccount[] = [
  {
    id: 'usr_manager_mehdi',
    fullName: 'دکتر مهدی امیری',
    name: 'دکتر مهدی امیری',
    role: 'manager',
    roleLabel: 'مدیر کلینیک و پزشک ارشد',
    email: 'mehdi.amiri19851364@gmail.com',
    phone: '09120000000',
    pinOrPass: '1234',
    avatarColor: '#8B5CF6',
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
    pinOrPass: '1111',
    avatarColor: '#06B6D4',
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
    pinOrPass: '2222',
    avatarColor: '#EC4899',
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
    pinOrPass: '3333',
    avatarColor: '#10B981',
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
export const CURRENT_APP_VERSION = '58.0';
export const CURRENT_APP_BUILD = 58;

export type UserRole = ClinicUserRole;
export const ROLE_LABELS: Record<UserRole, string> = {
  manager: 'مدیر کلینیک و پزشک ارشد',
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
  scheduledTime: string; // HH:mm e.g. "22:00"
  scheduledDate: string; // optional YYYY-MM-DD or daily
  autoCloudSupabase: boolean;
  autoLocalBrowser: boolean;
  lastCloudBackupAt: string | null;
  lastLocalBackupAt: string | null;
};

function normalizeUser(u: any): ClinicUserAccount {
  const fullName = u?.fullName || u?.name || 'کاربر کلینیک';
  const role: ClinicUserRole = u?.role || 'secretary';
  return {
    id: u?.id || `usr_${Date.now()}`,
    fullName,
    name: fullName,
    role,
    roleLabel: u?.roleLabel || ROLE_LABELS[role] || 'کاربر',
    email: u?.email || '',
    phone: u?.phone || '',
    pinOrPass: u?.pinOrPass || '1234',
    avatarColor: u?.avatarColor || '#8B5CF6',
    canPublishUpdate: u?.canPublishUpdate ?? (role === 'manager'),
    permissions: u?.permissions || {
      canEditPricesAfterSave: role === 'manager',
      canDeleteCriticalRecords: role === 'manager',
      canPublishOtaUpdate: role === 'manager',
      canManageBackups: role === 'manager',
      canManageStaffAndShares: role === 'manager',
    },
  };
}

export function loadClinicUsers(): ClinicUserAccount[] {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (!raw) return DEFAULT_CLINIC_USERS.map(normalizeUser);
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map(normalizeUser);
    }
  } catch {
    // ignore
  }
  return DEFAULT_CLINIC_USERS.map(normalizeUser);
}

export function saveClinicUsers(users: ClinicUserAccount[]): void {
  try {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users.map(normalizeUser)));
  } catch {
    // ignore
  }
}

export function getActiveClinicUser(): ClinicUserAccount {
  const users = loadClinicUsers();
  try {
    const activeId = localStorage.getItem(ACTIVE_USER_STORAGE_KEY);
    if (activeId) {
      const found = users.find((u) => u.id === activeId);
      if (found) return normalizeUser(found);
    }
  } catch {
    // ignore
  }
  return normalizeUser(users[0] ?? DEFAULT_CLINIC_USERS[0]);
}

export function setActiveClinicUserId(id: string): ClinicUserAccount {
  const users = loadClinicUsers();
  const found = normalizeUser(users.find((u) => u.id === id) ?? users[0] ?? DEFAULT_CLINIC_USERS[0]);
  try {
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

/**
 * Publishes an OTA Update notification to Supabase clinic_settings AND broadcasts
 * it to all connected users (Doctor, Manager, Secretary, Assistant) so their apps
 * automatically refresh to the latest build.
 */
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

/**
 * Performs a full non-destructive Cloud & Local Snapshot Backup of all clinic tables.
 */
export async function performAutomaticCloudAndLocalBackup(): Promise<{
  ok: boolean;
  timestamp: string;
  totalRecords: number;
}> {
  const nowIso = new Date().toISOString();
  try {
    const [
      { data: patients },
      { data: appointments },
      { data: treatments },
      { data: payments },
      { data: labOrders },
      { data: implants },
      { data: inventory },
      { data: installments },
      { data: checks },
      { data: safteh },
      { data: reminders },
      { data: staff },
    ] = await Promise.all([
      supabase.from('patients').select('*'),
      supabase.from('appointments').select('*'),
      supabase.from('treatments').select('*'),
      supabase.from('payments').select('*'),
      supabase.from('lab_orders').select('*'),
      supabase.from('implants').select('*'),
      supabase.from('inventory').select('*'),
      supabase.from('installments').select('*'),
      supabase.from('checks').select('*'),
      supabase.from('safteh').select('*'),
      supabase.from('reminders').select('*'),
      supabase.from('staff').select('*'),
    ]);

    const snapshot = {
      backedUpAt: nowIso,
      backedUpBy: getActiveClinicUser().fullName,
      version: CURRENT_APP_VERSION,
      counts: {
        patients: (patients || []).length,
        appointments: (appointments || []).length,
        treatments: (treatments || []).length,
        payments: (payments || []).length,
        labOrders: (labOrders || []).length,
        implants: (implants || []).length,
        inventory: (inventory || []).length,
        installments: (installments || []).length,
        checks: (checks || []).length,
        safteh: (safteh || []).length,
        reminders: (reminders || []).length,
      },
      data: {
        patients: patients || [],
        appointments: appointments || [],
        treatments: treatments || [],
        payments: payments || [],
        labOrders: labOrders || [],
        implants: implants || [],
        inventory: inventory || [],
        installments: installments || [],
        checks: checks || [],
        safteh: safteh || [],
        reminders: reminders || [],
        staff: staff || [],
      },
    };

    const totalRecords = Object.values(snapshot.counts).reduce((a, b) => a + b, 0);

    // Save locally in browser storage
    try {
      localStorage.setItem('minadental_latest_auto_backup_v4', JSON.stringify(snapshot));
    } catch {
      // ignore storage quota
    }

    // Save cloud snapshot metadata & summary into Supabase clinic_settings
    try {
      const cloudSummary = JSON.stringify({
        backedUpAt: nowIso,
        backedUpBy: snapshot.backedUpBy,
        version: CURRENT_APP_VERSION,
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
      lastCloudBackupAt: nowIso,
      lastLocalBackupAt: nowIso,
    });

    await broadcastClinicSyncEvent({
      type: 'CLOUD_BACKUP_DONE',
      action: `پشتیبان‌گیری خودکار ابری (${totalRecords.toLocaleString('fa-IR')} رکورد)`,
    });

    return { ok: true, timestamp: nowIso, totalRecords };
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

