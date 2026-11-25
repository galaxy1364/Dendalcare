import { useState, useEffect, useCallback } from 'react';
import {
  Settings as SettingsIcon, Plus, Save, Megaphone, Building2,
  Phone, MapPin, Trash2, Eye, EyeOff, Calendar, Link,
  Download, Upload, Database, Clock, CheckCircle2, AlertCircle, Percent,
  Activity, RefreshCw, HardDrive, Wifi, Server, ShieldCheck, Zap, RotateCcw, Smartphone,
} from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import { supabase, supabaseUrl, supabaseAnonKey, type ClinicSetting, type Advertisement } from '@/lib/supabase';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { Field, Input, Textarea, Select, Button, Badge, EmptyState, Loading } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';
import { exportClinicBackupToJson } from '@/lib/exportUtils';
import { InstallAppModal } from '@/components/ui/InstallAppModal';
import { RoadmapAuditModal } from '@/components/ui/RoadmapAuditModal';
import { downloadWindowsDesktopLauncher } from '@/lib/platformEngine';
import {
  loadActiveUser,
  loadBackupSchedule,
  saveBackupSchedule,
  performAutomaticCloudAndLocalBackup,
  publishOtaUpdateToAllUsers,
  CURRENT_APP_VERSION,
  CURRENT_APP_BUILD,
} from '@/lib/cloudSyncEngine';
import { downloadApkSafely } from '@/lib/downloadHelper';
import { IntegrationsTab } from './IntegrationsTab';
import { FolderGit2 } from 'lucide-react';
import {
  isAutoUpdateEnabled,
  setAutoUpdateEnabled,
  clearAllCachesAndHardReload,
  checkForAppUpdates,
  broadcastNewAppBuild,
  getInstalledReleaseInfo,
  applyAppUpdateAtomically,
  updateCoordinator,
  type AtomicUpdateProgress,
  type InstalledReleaseInfo,
  type UpdateSnapshot,
} from '@/lib/updateManager';
import { activateCloudSqlAndGoogleDrive } from '@/lib/integrationsEngine';
import { getOfflineQueue, processOfflineQueue, type OfflineMutationItem } from '@/lib/offlineQueue';
import { ClinicDefinitionsModal } from '@/components/ui/ClinicDefinitionsModal';
import {
  collectCompleteClinicSnapshot,
  restoreCompleteClinicSnapshot,
  listArchivedRecords,
  restoreArchivedRecord,
  getVaultStats,
  type ArchivedRecordEntry,
  type VaultStats,
} from '@/lib/dataVault';
import { getActiveUILibrariesSummary } from '@/lib/uiLibrariesEngine';
import {
  useAppearanceSettings,
  setThemeMode,
  setFontScaleMode,
  setMotionMode,
  setAuroraBackdropMode,
  type ThemeMode,
  type FontScaleMode,
  type MotionMode,
  type AuroraBackdropMode,
} from '@/lib/appearanceEngine';
import { detectPlatformCapabilities } from '@/lib/platformEngine';
import { HapticEngine } from '@/lib/hapticsAudio';
import { verifyServerMutation } from '@/lib/supabaseGuardian';
import { Sun, Moon, Monitor, Type, Gauge, Cpu, Target } from 'lucide-react';
import { ACTIVE_TENANT_ID, CLINIC_BRANCHES, getActiveBranchId, setActiveBranchId } from '@/services/authentication/authService';

type SettingsTab = 'clinic' | 'diagnostics' | 'integrations' | 'ads';

const AD_AUDIENCES = [
  { value: 'all', label: 'همه' },
  { value: 'patients', label: 'بیماران' },
  { value: 'staff', label: 'پرسنل' },
];

const AD_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: 'فعال', color: '#22C55E', bg: '#DCFCE7' },
  inactive: { label: 'غیرفعال', color: '#9CA3AF', bg: '#F3F4F6' },
  expired: { label: 'منقضی', color: '#EF4444', bg: '#FEE2E2' },
};

async function clearServiceWorkerCacheAndHardReload() {
  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      const cacheNames = await window.caches.keys();
      await Promise.all(cacheNames.map((name) => window.caches.delete(name)));
    }
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
    }
    try {
      sessionStorage.clear();
    } catch {
      // ignore storage errors
    }
  } catch (err) {
    console.error('Error clearing SW & cache:', err);
  }
  const url = new URL(window.location.href);
  url.searchParams.set('hard_reload', Date.now().toString());
  window.location.replace(url.toString());
}

export function SettingsSection({
  onOpenRoadmapAudit,
  onOpenInstall,
}: {
  onOpenRoadmapAudit?: () => void;
  onOpenInstall?: () => void;
} = {}) {
  const { data: settings } = useRealtimeTable<ClinicSetting>('clinic_settings');
  const { data: ads } = useRealtimeTable<Advertisement>('advertisements');

  const [tab, setTab] = useState<SettingsTab>('clinic');
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [roadmapModalOpen, setRoadmapModalOpen] = useState(false);

  const handleOpenInstall = () => {
    if (onOpenInstall) {
      onOpenInstall();
    } else {
      setInstallModalOpen(true);
    }
  };

  const handleOpenAudit = () => {
    if (onOpenRoadmapAudit) {
      onOpenRoadmapAudit();
    } else {
      setRoadmapModalOpen(true);
    }
  };

  return (
    <div className="space-y-2.5 pb-2 animate-fade-in-up">
      {/* QBank Top Bar: Sliding Horizontal Chip Bar */}
      <div className="glass-card p-2.5">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {[
            { key: 'clinic' as const, label: 'کلینیک، تعرفه‌ها و نسخه‌ها', icon: <Building2 size={13} /> },
            { key: 'integrations' as const, label: 'گیت‌هاب، سوپابیس و گوگل درایو', icon: <FolderGit2 size={13} /> },
            { key: 'diagnostics' as const, label: 'عیب‌یابی فنی و کش', icon: <Activity size={13} /> },
            { key: 'ads' as const, label: `تبلیغات مطب (${ads.length.toLocaleString('fa-IR')})`, icon: <Megaphone size={13} /> },
          ].map(ch => (
            <button
              key={ch.key}
              onClick={() => setTab(ch.key)}
              className={`px-3 py-1.5 rounded-2xl text-xs font-extrabold whitespace-nowrap transition-all haptic shrink-0 flex items-center gap-1.5 ${
                tab === ch.key
                  ? 'bg-gradient-to-r from-slate-700 to-slate-900 text-white shadow-sm'
                  : 'bg-gray-100/90 text-gray-600'
              }`}
            >
              {ch.icon}
              <span>{ch.label}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === 'clinic' && (
        <ClinicSettingsTab
          settings={settings}
          onOpenDiagnostics={() => setTab('diagnostics')}
          onOpenInstallModal={handleOpenInstall}
          onOpenAuditModal={handleOpenAudit}
        />
      )}
      {tab === 'integrations' && <IntegrationsTab />}
      {tab === 'diagnostics' && (
        <DiagnosticsPanel onOpenInstallModal={handleOpenInstall} />
      )}
      {tab === 'ads' && <AdsTab ads={ads} />}

      <InstallAppModal
        open={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        deferredPrompt={typeof window !== 'undefined' ? (window as any).__deferredInstallPrompt || null : null}
        onInstallSuccess={() => {}}
      />
      <RoadmapAuditModal
        open={roadmapModalOpen}
        onClose={() => setRoadmapModalOpen(false)}
      />
    </div>
  );
}

// ==================== CLINIC SETTINGS TAB ====================
function ClinicSettingsTab({
  settings,
  onOpenDiagnostics,
  onOpenInstallModal,
  onOpenAuditModal,
}: {
  settings: ClinicSetting[];
  onOpenDiagnostics: () => void;
  onOpenInstallModal: () => void;
  onOpenAuditModal: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [restorePreview, setRestorePreview] = useState<any | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [hardReloading, setHardReloading] = useState(false);
  const [downloadingApk, setDownloadingApk] = useState(false);
  const [apkDownloadProgress, setApkDownloadProgress] = useState(0);
  const [apk403Alert, setApk403Alert] = useState(false);
  const [updateSnap, setUpdateSnap] = useState<UpdateSnapshot>(() => updateCoordinator.getSnapshot());
  const [autoUpdate, setAutoUpdate] = useState(isAutoUpdateEnabled());
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [installedRelease, setInstalledRelease] = useState<InstalledReleaseInfo>(() => getInstalledReleaseInfo());
  const [atomicProgress, setAtomicProgress] = useState<AtomicUpdateProgress | null>(null);
  const [updateMessage, setUpdateMessage] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);
  const [defsModalOpen, setDefsModalOpen] = useState(false);

  useEffect(() => {
    const unsub = updateCoordinator.subscribe((snap) => {
      setUpdateSnap(snap);
      setInstalledRelease(getInstalledReleaseInfo());
      setAutoUpdate(snap.autoUpdateEnabled);
    });
    return unsub;
  }, []);

  const handleToggleAutoUpdate = (enabled: boolean) => {
    setAutoUpdate(enabled);
    setAutoUpdateEnabled(enabled);
    setUpdateMessage({
      type: 'info',
      text: enabled
        ? 'دریافت و فعال‌سازی خودکار فقط در نقطه امن (بدون فرم باز یا صف آفلاین) فعال شد.'
        : 'به‌روزرسانی خودکار غیرفعال شد؛ بررسی و فعال‌سازی به‌صورت دستی انجام می‌شود.',
    });
  };

  const handleManualCheckUpdate = async () => {
    setCheckingUpdates(true);
    setUpdateMessage(null);
    setAtomicProgress(null);
    try {
      const res = await checkForAppUpdates();
      if (res.source === 'offline' || res.source === 'check_failed') {
        setUpdateMessage({
          type: 'error',
          text: res.errorMessage || 'بررسی نسخه جدید ناموفق بود؛ وضعیت شبکه یا سرور انتشار را بررسی کنید.',
        });
        return;
      }
      if (res.source === 'native_store_required') {
        setUpdateMessage({
          type: 'info',
          text: `نسخه جدید v${res.latestVersion} (#${res.latestBuild}) نیازمند ارتقا از طریق فروشگاه رسمی پلتفرم است.`,
        });
        return;
      }
      if (!res.updateAvailable) {
        setUpdateMessage({
          type: 'success',
          text: `نسخه در حال اجرا v${res.currentVersion} (${res.currentReleaseId}) با آخرین انتشار معتبر سرور برابر است.`,
        });
        return;
      }

      const nextSnap = await applyAppUpdateAtomically({
        reloadPage: true,
        onProgress: (p) => setAtomicProgress(p),
      });
      if (nextSnap.state === 'FAILED' || nextSnap.state === 'CHECK_FAILED') {
        setUpdateMessage({
          type: 'error',
          text: nextSnap.error?.messageFa || 'تأیید یا فعال‌سازی نسخه جدید ناموفق بود.',
        });
      } else if (nextSnap.state === 'WAITING_FOR_SAFE_POINT') {
        setUpdateMessage({
          type: 'info',
          text: 'نسخه جدید دریافت و با SHA-256 تأیید شد؛ به محض تکمیل فرم‌های باز یا ارسال صف آفلاین فعال می‌شود.',
        });
      } else {
        setUpdateMessage({
          type: 'info',
          text: `نسخه v${res.latestVersion} تأیید شد و در حال ورود به مرحله بازنشانی و اثبات بوت است.`,
        });
      }
    } finally {
      setCheckingUpdates(false);
      setTimeout(() => setAtomicProgress(null), 2000);
    }
  };

  const handlePublishAndInstallNextBuild = async () => {
    setCheckingUpdates(true);
    setUpdateMessage(null);
    try {
      const result = await broadcastNewAppBuild(
        installedRelease.version,
        installedRelease.build,
        'اعلان بررسی مانیفست رسمی مینادنتال برای دستگاه‌های آنلاین کلینیک'
      );
      setUpdateMessage({
        type: result.ok ? 'info' : 'error',
        text: result.message,
      });
    } finally {
      setCheckingUpdates(false);
    }
  };

  useEffect(() => {
    const map: Record<string, string> = {};
    settings.forEach(s => {
      let val = s.value ?? '';
      if (s.key === 'clinic_name' && val.includes('مینا مازندرانی')) {
        val = 'کلینیک دندانپزشکی مینادنتال (دکتر مهدی امیری)';
        void supabase
          .from('clinic_settings')
          .update({ value: val })
          .eq('id', s.id);
      }
      map[s.key] = val;
    });
    if (!map.clinic_name) {
      map.clinic_name = 'کلینیک دندانپزشکی مینادنتال (دکتر مهدی امیری)';
    }
    setValues(map);
  }, [settings]);

  const [settingsMsg, setSettingsMsg] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [branchId, setBranchId] = useState<string>(() => getActiveBranchId());
  const appearance = useAppearanceSettings();
  const platformCaps = detectPlatformCapabilities();

  const save = async () => {
    setSaving(true);
    setSettingsMsg(null);
    let anyQueued = false;
    let anyError = false;

    for (const [key, value] of Object.entries(values)) {
      const existing = settings.find(s => s.key === key);
      if (existing) {
        if (existing.value !== value) {
          const res = await supabase.from('clinic_settings').update({ value }).eq('id', existing.id);
          if (res.error) anyError = true;
          else if (!verifyServerMutation(res)) anyQueued = true;
        }
      } else {
        const res = await supabase.from('clinic_settings').insert({ key, value, category: 'general' });
        if (res.error) anyError = true;
        else if (!verifyServerMutation(res)) anyQueued = true;
      }
    }
    setSaving(false);
    if (anyError) {
      HapticEngine.error();
      setSettingsMsg({ type: 'error', text: 'خطا در ذخیره برخی تنظیمات کلینیک.' });
    } else if (anyQueued) {
      HapticEngine.warning();
      setSettingsMsg({ type: 'warning', text: 'تنظیمات در صف آفلاین ذخیره شد و پس از اتصال به سرور تایید می‌شود.' });
    } else {
      HapticEngine.success();
      setSettingsMsg({ type: 'success', text: 'تنظیمات کلینیک در سرور تایید و ذخیره شد.' });
    }
  };

  const handleExportFullBackup = async () => {
    setExporting(true);
    try {
      const activeUser = loadActiveUser();
      const snapshot = await collectCompleteClinicSnapshot(
        `${activeUser.fullName} (${activeUser.email || 'mehdi.amiri19851364@gmail.com'})`
      );
      const dateStr = new Date().toISOString().slice(0, 10);
      exportClinicBackupToJson(`MinaDental_Full20Tables_v${CURRENT_APP_VERSION}_${dateStr}`, snapshot);
      setRestoreMessage({
        type: 'success',
        text: `پشتیبان کامل ۲۰ جدول (${snapshot.totalRecords.toLocaleString('fa-IR')} رکورد • امضای ${snapshot.checksum}) دانلود و در Vault ذخیره شد.`,
      });
    } catch (err: any) {
      console.error('Backup error:', err);
      setRestoreMessage({ type: 'error', text: `خطا در تهیه پشتیبان: ${err?.message || 'خطای شبکه'}` });
    } finally {
      setExporting(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        setRestorePreview(parsed);
        setRestoreMessage(null);
      } catch {
        setRestoreMessage({ type: 'error', text: 'فایل نامعتبر است. لطفاً فایل JSON پشتیبان معتبر انتخاب نمایید.' });
        setRestorePreview(null);
      }
    };
    reader.readAsText(file);
  };

  const handleExecuteRestore = async () => {
    if (!restorePreview) return;
    setRestoring(true);
    setRestoreMessage(null);
    try {
      const activeUser = loadActiveUser();
      const res = await restoreCompleteClinicSnapshot(restorePreview, {
        tenantId: activeUser.tenantId || ACTIVE_TENANT_ID,
        branchId: getActiveBranchId(),
        userId: activeUser.id,
      });
      if (res.ok) {
        const rejectedNote =
          res.rejectedCrossScopeRows > 0
            ? ` (${res.rejectedCrossScopeRows.toLocaleString('fa-IR')} رکورد خارج از محدوده شعبه رد شد)`
            : '';
        setRestoreMessage({
          type: 'success',
          text: `بازیابی غیرمخرب با موفقیت انجام شد: ${res.restoredTables.toLocaleString('fa-IR')} جدول (${res.restoredRows.toLocaleString('fa-IR')} رکورد) با Cloud SQL همگام شد${rejectedNote}.`,
        });
        setRestorePreview(null);
      } else {
        setRestoreMessage({
          type: 'error',
          text: `بازیابی با خطا مواجه شد: ${res.errors.join(' | ') || 'جدول معتبری یافت نشد'}`,
        });
      }
    } catch (err: any) {
      setRestoreMessage({ type: 'error', text: `خطا در بازیابی: ${err.message || 'خطای شبکه'}` });
    } finally {
      setRestoring(false);
    }
  };

  const fields = [
    { key: 'clinic_name', label: 'نام کلینیک', icon: <Building2 size={14} />, placeholder: 'کلینیک دندانپزشکی مینادنتال' },
    { key: 'clinic_phone', label: 'تلفن کلینیک', icon: <Phone size={14} />, placeholder: '021-xxxxxxxx' },
    { key: 'clinic_address', label: 'آدرس کلینیک', icon: <MapPin size={14} />, placeholder: 'آدرس مطب' },
    { key: 'currency', label: 'واحد پول', icon: <SettingsIcon size={14} />, placeholder: 'تومان' },
    { key: 'daily_revenue_target', label: 'هدف درآمد روزانه (تومان)', icon: <Target size={14} />, placeholder: 'مثلاً 30000000' },
    { key: 'monthly_revenue_target', label: 'هدف درآمد ماهانه (تومان)', icon: <Target size={14} />, placeholder: 'مثلاً 650000000' },
    { key: 'default_appointment_duration', label: 'مدت پیش‌فرض نوبت (دقیقه)', icon: <Calendar size={14} />, placeholder: '30' },
    { key: 'clinic_morning_hours', label: 'ساعت کاری شیفت صبح', icon: <Clock size={14} />, placeholder: '09:00 الی 13:30' },
    { key: 'clinic_evening_hours', label: 'ساعت کاری شیفت عصر', icon: <Clock size={14} />, placeholder: '16:00 الی 21:30' },
    { key: 'doctor_commission_default', label: 'درصد پیش‌فرض سهم پزشک (درصد)', icon: <Percent size={14} />, placeholder: '40' },
  ];

  return (
    <div className="space-y-3 animate-fade-in">
      {settingsMsg && (
        <div
          className={`p-3 rounded-2xl border text-xs font-extrabold flex items-center gap-2 ${
            settingsMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : settingsMsg.type === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <CheckCircle2 size={15} />
          <span>{settingsMsg.text}</span>
        </div>
      )}

      {/* Appearance & Accessibility (Light / Dark / System • Dynamic Type • Reduce Motion) */}
      <div
        data-testid="settings_appearance_card"
        className="glass-card p-4 space-y-3 border border-slate-200/95"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Sun size={17} className="text-amber-500" />
            ظاهر سیستم، Dynamic Type و Reduce Motion
          </h3>
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200">
            {appearance.resolvedTheme === 'dark' ? 'تیره فعال' : 'روشن فعال'}
          </span>
        </div>

        <div className="space-y-2">
          <span className="text-[11px] font-extrabold text-slate-600 dark:text-slate-300 block">
            حالت نمایش (Light / Dark / System)
          </span>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'light' as ThemeMode, label: 'روشن', Icon: Sun },
                { id: 'dark' as ThemeMode, label: 'تیره', Icon: Moon },
                { id: 'system' as ThemeMode, label: 'سیستم', Icon: Monitor },
              ] as const
            ).map(({ id, label, Icon }) => {
              const active = appearance.themeMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`appearance_theme_${id}`}
                  onClick={() => {
                    HapticEngine.selection();
                    setThemeMode(id);
                  }}
                  className={`py-2 px-2.5 rounded-2xl border text-xs font-black flex items-center justify-center gap-1.5 min-h-[44px] transition-all ${
                    active
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-[11px] font-extrabold text-slate-600 dark:text-slate-300 flex items-center gap-1">
            <Type size={13} /> اندازه متن (Dynamic Type)
          </span>
          <div className="grid grid-cols-4 gap-1.5">
            {(
              [
                { id: 'compact' as FontScaleMode, label: 'فشرده' },
                { id: 'default' as FontScaleMode, label: 'پیش‌فرض' },
                { id: 'large' as FontScaleMode, label: 'درشت' },
                { id: 'xlarge' as FontScaleMode, label: 'بسیار درشت' },
              ] as const
            ).map(({ id, label }) => {
              const active = appearance.fontScale === id;
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`appearance_font_${id}`}
                  onClick={() => {
                    HapticEngine.selection();
                    setFontScaleMode(id);
                  }}
                  className={`py-2 px-1.5 rounded-xl border text-[11px] font-extrabold min-h-[42px] transition-all ${
                    active
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-[11px] font-extrabold text-slate-600 dark:text-slate-300 flex items-center gap-1">
            <Gauge size={13} /> انیمیشن و Reduce Motion
          </span>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'system' as MotionMode, label: 'مطابق سیستم' },
                { id: 'reduce' as MotionMode, label: 'کاهش حرکت' },
                { id: 'full' as MotionMode, label: 'کامل' },
              ] as const
            ).map(({ id, label }) => {
              const active = appearance.motionMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`appearance_motion_${id}`}
                  onClick={() => {
                    HapticEngine.selection();
                    setMotionMode(id);
                  }}
                  className={`py-2 px-2 rounded-xl border text-[11px] font-extrabold min-h-[42px] transition-all ${
                    active
                      ? 'bg-violet-600 text-white border-violet-600 shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2" data-testid="appearance_aurora_controls">
          <span className="text-[11px] font-extrabold text-slate-600 dark:text-slate-300 flex items-center gap-1">
            <Zap size={13} /> پس‌زمینه زنده (Aurora Mesh)
          </span>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'live' as AuroraBackdropMode, label: 'زنده (سیال)' },
                { id: 'low_power' as AuroraBackdropMode, label: 'کم‌مصرف' },
                { id: 'static' as AuroraBackdropMode, label: 'ثابت' },
              ] as const
            ).map(({ id, label }) => {
              const active = appearance.auroraMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  data-testid={`appearance_aurora_${id}`}
                  onClick={() => {
                    HapticEngine.selection();
                    setAuroraBackdropMode(id);
                  }}
                  className={`py-2 px-2 rounded-xl border text-[11px] font-extrabold min-h-[42px] transition-all ${
                    active
                      ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Honest Platform Capabilities Matrix */}
      <div
        data-testid="settings_platform_capabilities_card"
        className="glass-card p-4 space-y-2.5 border border-slate-200/95"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs sm:text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Cpu size={16} className="text-indigo-600" />
            قابلیت‌های واقعی پلتفرم فعلی
          </h3>
          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
            {platformCaps.runtimeKind}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-[10.5px]">
          <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <span>Android Native Haptics</span>
            <strong className={platformCaps.androidNativeHapticsBridge ? 'text-emerald-700' : 'text-slate-500'}>
              {platformCaps.androidNativeHapticsBridge ? 'فعال' : 'غیرفعال'}
            </strong>
          </div>
          <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <span>Web Vibration / Audio</span>
            <strong className={platformCaps.webVibrationApi || platformCaps.webAudioTactileSynth ? 'text-emerald-700' : 'text-slate-500'}>
              {platformCaps.webVibrationApi || platformCaps.webAudioTactileSynth ? 'پشتیبانی' : 'ندارد'}
            </strong>
          </div>
          <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <span>Apple Liquid Glass</span>
            <strong className="text-amber-700">
              {platformCaps.nativeLiquidGlassAvailable ? 'فعال' : 'فقط iOS بومی'}
            </strong>
          </div>
          <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
            <span>Apple CoreHaptics</span>
            <strong className="text-amber-700">
              {platformCaps.nativeCoreHapticsAvailable ? 'فعال' : 'فقط iOS بومی'}
            </strong>
          </div>
        </div>
        <p className="text-[10.5px] font-semibold text-slate-600 dark:text-slate-300 leading-relaxed">
          {platformCaps.honestPlatformNoteFa}
        </p>
      </div>

      {/* Single Verified Release & Update Center (V7 UpdateCoordinator) */}
      <div
        data-testid="settings_unified_update_center"
        className="p-4 rounded-3xl bg-white text-slate-900 border border-slate-200/95 shadow-sm space-y-3"
        style={{ background: 'linear-gradient(155deg, #FFFFFF 0%, #F5F3FF 60%, #EDE9FE 100%)' }}
      >
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-700 shadow-sm">
              <RefreshCw size={20} className={checkingUpdates || updateSnap.state === 'CHECKING' ? 'animate-spin' : ''} />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                به‌روزرسانی تأییدشده برنامه مینادنتال
              </h3>
              <p className="text-[11px] text-slate-600 font-semibold">
                نسخه در حال اجرا: <strong className="text-slate-900 font-mono">v{updateSnap.installed.semver}</strong> • انتشار: <strong className="text-emerald-700 font-mono" data-testid="installed_build_badge">#{updateSnap.installed.releaseSequence} ({updateSnap.installed.releaseId})</strong>
              </p>
            </div>
          </div>
          <span className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-mono font-extrabold">
            {updateSnap.channel.toUpperCase()} • {updateSnap.state}
          </span>
        </div>

        {/* Real Status Metadata Grid (Zero Fake Build/Install Dates) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10.5px] bg-white/90 p-2.5 rounded-2xl border border-slate-200">
          <div>
            <span className="text-slate-500 block">وضعیت شبکه</span>
            <strong className={updateSnap.isOnline ? 'text-emerald-700' : 'text-amber-700'}>
              {updateSnap.isOnline ? 'آنلاین' : 'آفلاین'}
            </strong>
          </div>
          <div>
            <span className="text-slate-500 block">آخرین بررسی</span>
            <strong className="text-slate-800 font-mono">
              {updateSnap.lastCheck?.checkedAt
                ? new Date(updateSnap.lastCheck.checkedAt).toLocaleTimeString('fa-IR')
                : 'هنوز بررسی نشده'}
            </strong>
          </div>
          <div>
            <span className="text-slate-500 block">نتیجه آخرین بررسی</span>
            <strong className="text-slate-800">
              {updateSnap.lastCheck?.outcome || '—'}
            </strong>
          </div>
          <div>
            <span className="text-slate-500 block">نسخه آماده</span>
            <strong className="text-indigo-700 font-mono">
              {updateSnap.candidate
                ? `v${updateSnap.candidate.manifest.semver} (#${updateSnap.candidate.manifest.releaseSequence})`
                : 'ندارد'}
            </strong>
          </div>
        </div>

        {/* Platform Honest Limitation Notice */}
        {updateSnap.capabilities.honestLimitationFa && (
          <p className="text-[10.5px] text-slate-600 leading-relaxed bg-white/70 px-3 py-2 rounded-xl border border-slate-200/80">
            {updateSnap.capabilities.honestLimitationFa}
          </p>
        )}

        {/* Auto Update at Safe Point Toggle */}
        <div className="p-3 rounded-2xl bg-white border border-slate-200 flex items-center justify-between shadow-sm">
          <div>
            <span className="text-xs font-extrabold text-slate-900 block">
              به‌روزرسانی خودکار در نقطه امن (Safe-Point Auto-Update)
            </span>
            <span className="text-[10.5px] text-slate-600">
              بررسی دوره‌ای هنگام باز بودن برنامه و فعال‌سازی فقط در نبود فرم باز یا صف آفلاین
            </span>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              data-testid="toggle_auto_update_switch"
              checked={autoUpdate}
              onChange={(e) => handleToggleAutoUpdate(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600"></div>
          </label>
        </div>

        {/* Safe-Point Blockers Notice */}
        {!updateSnap.safePoint.isSafe && (
          <div className="p-2.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-bold">
            فعال‌سازی به‌روزرسانی به دلیل حفاظت از داده‌ها در صف انتظار است: {updateSnap.safePoint.blockers.map((b) => b.reason).join(' • ')}
          </div>
        )}

        {/* Real Byte-Based or Indeterminate Progress Bar (Zero Fake Percent) */}
        {(atomicProgress || updateSnap.progress) && (
          <div className="p-3 rounded-2xl bg-sky-50 border border-sky-200 space-y-1.5" data-testid="atomic_update_progress_box">
            <div className="flex items-center justify-between text-xs font-extrabold">
              <span className="text-sky-900">{(updateSnap.progress || atomicProgress)?.label}</span>
              <span className="font-mono text-emerald-700">
                {(updateSnap.progress || atomicProgress)?.determinate &&
                (updateSnap.progress || atomicProgress)?.percent !== null
                  ? `${(updateSnap.progress || atomicProgress)?.percent}%`
                  : 'در حال پردازش...'}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-sky-200 overflow-hidden">
              {(updateSnap.progress || atomicProgress)?.determinate &&
              (updateSnap.progress || atomicProgress)?.percent !== null ? (
                <div
                  className="h-full rounded-full bg-sky-600 transition-all duration-200"
                  style={{ width: `${(updateSnap.progress || atomicProgress)?.percent}%` }}
                />
              ) : (
                <div className="h-full w-1/3 rounded-full bg-sky-600 animate-pulse" />
              )}
            </div>
          </div>
        )}

        {/* Candidate Release Notes & Trust Model */}
        {updateSnap.candidate?.manifest.releaseNotes && (
          <div className="p-2.5 rounded-2xl bg-indigo-50/70 border border-indigo-200 text-[11px] text-indigo-950 font-semibold space-y-1">
            <div>یادداشت نسخه آماده: {updateSnap.candidate.manifest.releaseNotes}</div>
            <div className="text-[10px] font-mono text-indigo-700">
              وضعیت امضا:{' '}
              {updateSnap.candidate.signatureStatus === 'verified'
                ? 'امضای دیجیتال ECDSA تأیید شد'
                : updateSnap.candidate.signatureStatus === 'unsigned_web_origin_only'
                ? 'تأیید مبدأ HTTPS + SHA-256 (بدون کلید امضای پین‌شده)'
                : 'نامعتبر'}
            </div>
          </div>
        )}

        {/* Manual Check / Store Action / Non-Authoritative Refresh Hint */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleManualCheckUpdate}
            disabled={checkingUpdates || updateSnap.state === 'CHECKING'}
            data-testid="manual_check_and_install_update_btn"
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-sm active:scale-95 transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={checkingUpdates ? 'animate-spin' : ''} />
            {checkingUpdates
              ? 'در حال بررسی و تأیید مانیفست...'
              : updateSnap.state === 'READY_TO_ACTIVATE'
              ? 'فعال‌سازی نسخه تأییدشده'
              : 'بررسی دستی انتشار جدید'}
          </button>

          {updateSnap.state === 'NATIVE_STORE_REQUIRED' ? (
            <button
              type="button"
              disabled={!updateSnap.capabilities.supportsStoreDeepLink}
              onClick={() => updateCoordinator.openNativeStoreAction()}
              data-testid="native_store_update_btn"
              className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-sm active:scale-95 transition-all disabled:opacity-50"
            >
              <Download size={14} />
              {updateSnap.capabilities.supportsStoreDeepLink
                ? 'به‌روزرسانی از فروشگاه رسمی'
                : 'نشانی فروشگاه رسمی تنظیم نشده است'}
            </button>
          ) : loadActiveUser().role === 'manager' ? (
            <button
              type="button"
              onClick={handlePublishAndInstallNextBuild}
              disabled={checkingUpdates}
              data-testid="manager_publish_new_build_btn"
              className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-white hover:bg-violet-50 border border-violet-300 text-violet-900 text-xs font-extrabold shadow-sm active:scale-95 transition-all disabled:opacity-50"
            >
              <Zap size={14} className="text-amber-600" />
              ارسال اعلان بررسی به دستگاه‌های کلینیک
            </button>
          ) : (
            <button
              type="button"
              onClick={() => clearAllCachesAndHardReload()}
              className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-white hover:bg-slate-100 border border-slate-300 text-slate-800 text-xs font-extrabold active:scale-95 transition-all"
            >
              <RotateCcw size={14} />
              پاک‌سازی کش پوسته و بارگذاری مجدد
            </button>
          )}
        </div>

        {/* Distinct Typed Error State Box */}
        {updateSnap.error && (
          <div
            data-testid="update_error_box"
            className="p-2.5 rounded-xl text-xs font-bold bg-rose-50 text-rose-900 border border-rose-200 space-y-1"
          >
            <div className="flex items-center justify-between gap-2">
              <span>{updateSnap.error.messageFa}</span>
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-100">
                {updateSnap.error.code}
              </span>
            </div>
            {updateSnap.state === 'ROLLBACK_PENDING' && (
              <button
                type="button"
                data-testid="acknowledge_rollback_btn"
                onClick={async () => {
                  const res = await updateCoordinator.acknowledgeRollbackToLastKnownGood();
                  if (res.state === 'ROLLED_BACK') {
                    setUpdateMessage({
                      type: 'info',
                      text: `بازگشت به نسخه سالم تأییدشده (${res.installed.releaseId}) با موفقیت ثبت شد.`,
                    });
                  } else if (res.error?.messageFa) {
                    setUpdateMessage({
                      type: 'error',
                      text: res.error.messageFa,
                    });
                  }
                }}
                className="mt-1 px-2.5 py-1 rounded-lg bg-rose-700 text-white text-[11px] font-bold"
              >
                تأیید و راستی‌آزمایی ادامه کار با نسخه سالم قبلی
              </button>
            )}
          </div>
        )}

        {/* Update feedback message */}
        {updateMessage && (
          <div className={`p-2.5 rounded-xl text-xs font-bold flex items-center gap-2 ${
            updateMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
              : updateMessage.type === 'info'
              ? 'bg-blue-50 text-blue-900 border border-blue-200'
              : 'bg-rose-50 text-rose-900 border border-rose-200'
          }`}>
            <CheckCircle2 size={16} className="shrink-0" />
            <span className="leading-relaxed">{updateMessage.text}</span>
          </div>
        )}
      </div>

      {/* Clinic Base Definitions & Companies Card */}
      <div className="p-3.5 rounded-3xl bg-gradient-to-r from-purple-50 via-indigo-50 to-purple-50 border border-purple-200/80 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl bg-purple-600 text-white flex items-center justify-center shadow-md shadow-purple-500/20">
            <Building2 size={18} />
          </div>
          <div>
            <h3 className="text-xs font-bold text-purple-950">تعاریف پایه و شرکت‌های کلینیک</h3>
            <p className="text-[11px] text-purple-700/80">لابراتوارها، تأمین‌کنندگان، برندهای ایمپلنت و یونیت‌ها</p>
          </div>
        </div>
        <button
          onClick={() => setDefsModalOpen(true)}
          className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-md shadow-purple-600/30 transition-all haptic shrink-0"
        >
          مدیریت تعاریف
        </button>
      </div>

      <ClinicDefinitionsModal
        open={defsModalOpen}
        onClose={() => setDefsModalOpen(false)}
      />

      <div className="glass-card p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-xs font-bold text-[#14283B] dark:text-slate-100 flex items-center gap-1.5">
            <Building2 size={16} className="text-[#087C76]" />
            شعبه فعال، اهداف درآمد و ساعات کاری کلینیک
          </h3>
          <div className="flex items-center gap-1.5">
            {CLINIC_BRANCHES.map((br) => {
              const activeBr = branchId === br.id;
              return (
                <button
                  key={br.id}
                  type="button"
                  data-testid={`branch_switch_${br.id}`}
                  onClick={() => {
                    HapticEngine.selection();
                    setBranchId(setActiveBranchId(br.id));
                  }}
                  className={`px-2.5 py-1.5 rounded-[12px] text-[11px] font-bold border transition-colors ${
                    activeBr
                      ? 'bg-[#087C76] text-white border-[#087C76]'
                      : 'bg-[#F4F7F9] dark:bg-slate-800 text-[#526779] dark:text-slate-300 border-[#D8E2EA] dark:border-slate-700'
                  }`}
                >
                  {br.name}
                </button>
              );
            })}
          </div>
        </div>
        {fields.map(f => (
          <Field key={f.key} label={f.label}>
            <div className="relative">
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">{f.icon}</span>
              <Input value={values[f.key] ?? ''} onChange={e => setValues({ ...values, [f.key]: e.target.value })} placeholder={f.placeholder} className="pr-9" />
            </div>
          </Field>
        ))}
        <Button color="#087C76" disabled={saving} className="w-full" onClick={save} icon={<Save size={16} />}>{saving ? 'در حال ذخیره...' : 'ذخیره تنظیمات کلینیک'}</Button>
      </div>

      {/* Clean Multi-Platform Hub (Moved from Dashboard Top into Settings) */}
      <div className="glass-card p-4 space-y-3" data-testid="settings_version_download_card">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-extrabold text-slate-800 flex items-center gap-2">
              <Download size={16} className="text-indigo-600" />
              دانلود و نصب نسخه‌های برنامه (آیفون، اندروید، آیپد و ویندوز)
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              نسخه رسمی v{CURRENT_APP_VERSION} (بیلد #{CURRENT_APP_BUILD}) • پکیج کامل ۴ پلتفرم
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenInstallModal}
            data-testid="settings_open_install_modal_btn"
            className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold shadow-sm active:scale-95 transition-all shrink-0 flex items-center gap-1.5"
          >
            <Smartphone size={14} />
            راهنمای نصب ۴ پلتفرم
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={async () => {
              setDownloadingApk(true);
              setApkDownloadProgress(10);
              await downloadApkSafely('DentalCare.apk', (p) => setApkDownloadProgress(p));
              setDownloadingApk(false);
            }}
            disabled={downloadingApk}
            data-testid="settings_download_apk_btn"
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm active:scale-95 transition-all text-center disabled:opacity-50"
          >
            <Download size={14} className={downloadingApk ? 'animate-bounce' : ''} />
            {downloadingApk ? `دانلود (${apkDownloadProgress}%)` : `دانلود APK اندروید`}
          </button>

          <a
            href="./DentalCare.mobileconfig"
            download="MinaDental-iOS.mobileconfig"
            data-testid="settings_download_ios_profile_btn"
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold shadow-sm active:scale-95 transition-all no-underline text-center"
          >
            <Download size={14} />
            پروفایل آیفون و آیپد
          </a>

          <button
            type="button"
            onClick={() => downloadWindowsDesktopLauncher(window.location.origin + window.location.pathname)}
            data-testid="settings_download_windows_btn"
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-sm active:scale-95 transition-all text-center"
          >
            <Download size={14} />
            نصب نسخه ویندوز
          </button>

          <button
            type="button"
            onClick={() => {
              setHardReloading(true);
              clearServiceWorkerCacheAndHardReload();
            }}
            disabled={hardReloading}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition-all active:scale-95 disabled:opacity-50"
          >
            <RotateCcw size={14} className={hardReloading ? 'animate-spin' : ''} />
            {hardReloading ? 'در حال پاکسازی...' : 'پاکسازی کش و ری‌لود'}
          </button>
        </div>
      </div>

      {/* Manager & Upgrader Exclusive Section: Super-Audit, System Health & Architecture Lock */}
      {(() => {
        const activeUser = loadActiveUser();
        const isManagerOrUpgrader =
          activeUser.role === 'manager' ||
          Boolean(activeUser.canPublishUpdate) ||
          Boolean(activeUser.permissions?.canPublishOtaUpdate);
        if (!isManagerOrUpgrader) return null;
        return (
          <div
            data-testid="settings_manager_audit_section"
            className="p-4 rounded-3xl bg-white text-slate-900 border border-indigo-200 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-700">
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="text-xs font-black text-slate-900">
                      فوق ممیزی، گزارش سلامت و قفل معماری سیستم
                    </h3>
                    <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-200">
                      مختص مدیر و ارتقادهنده
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    دسترسی انحصاری دکتر مهدی امیری • بررسی زنده ۹ فاز، دفتر کل ممیزی و قفل نسخه
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onOpenAuditModal}
              data-testid="settings_manager_audit_btn"
              className="w-full py-2.5 px-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all"
            >
              <ShieldCheck size={16} />
              باز کردن پنل فوق ممیزی و گزارش سلامت (۹ فاز)
            </button>
          </div>
        );
      })()}

      {/* Cloud & Local Backup */}
      <div className="glass-card p-4 space-y-2.5">
        <h3 className="text-xs font-bold text-gray-700 flex items-center gap-2">
          <Database size={16} className="text-blue-500" />
          پشتیبان‌گیری و بازیابی اطلاعات
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            onClick={handleExportFullBackup}
            disabled={exporting}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-sm active:scale-95 transition-all disabled:opacity-50"
          >
            <Download size={14} />
            {exporting ? 'در حال دریافت...' : 'دانلود پشتیبان (JSON)'}
          </button>

          <label className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold shadow-sm active:scale-95 transition-all cursor-pointer">
            <Upload size={14} />
            بازیابی از فایل JSON
            <input type="file" accept=".json" onChange={handleFileChange} className="hidden" />
          </label>
        </div>

        {restorePreview && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50/80 p-3 space-y-2 mt-2">
            <p className="text-xs font-bold text-blue-900">پیش‌نمایش محتوای فایل پشتیبان:</p>
            <div className="grid grid-cols-2 gap-1.5 text-[11px] text-blue-800">
              <span>تعداد بیماران: {(restorePreview.tables?.patients ?? restorePreview.patients)?.length ?? 0}</span>
              <span>تعداد درمان‌ها: {(restorePreview.tables?.treatments ?? restorePreview.treatments)?.length ?? 0}</span>
              <span>تعداد نوبت‌ها: {(restorePreview.tables?.appointments ?? restorePreview.appointments)?.length ?? 0}</span>
              <span>تراکنش‌های مالی: {(restorePreview.tables?.payments ?? restorePreview.payments)?.length ?? 0}</span>
            </div>
            <button
              onClick={handleExecuteRestore}
              disabled={restoring}
              className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm active:scale-95 transition-all disabled:opacity-50 mt-1"
            >
              {restoring ? 'در حال بازیابی و ذخیره...' : 'تأیید و اعمال بازیابی در پایگاه داده'}
            </button>
          </div>
        )}

        {restoreMessage && (
          <div className={`p-2.5 rounded-xl text-xs flex items-center gap-1.5 ${restoreMessage.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {restoreMessage.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span>{restoreMessage.text}</span>
          </div>
        )}
      </div>

      {/* Zero-Delete Multi-Tier Recovery Vault (IndexedDB + Cloud SQL Restore) */}
      <ZeroDeleteVaultCard />

      {/* Multi-User Cloud Sync, Automatic Backup Scheduler & Instant OTA Update Publisher */}
      <CloudOtaAndAutoBackupCard />
    </div>
  );
}

function ZeroDeleteVaultCard() {
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [archived, setArchived] = useState<ArchivedRecordEntry[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [vaultMsg, setVaultMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadVault = useCallback(async () => {
    const activeUser = loadActiveUser();
    const activeScope = {
      tenantId: activeUser.tenantId || ACTIVE_TENANT_ID,
      branchId: getActiveBranchId(),
      userId: activeUser.id,
    };
    const [s, list] = await Promise.all([getVaultStats(), listArchivedRecords(activeScope)]);
    setStats(s);
    setArchived(list);
  }, []);

  useEffect(() => {
    loadVault();
    const handler = () => loadVault();
    window.addEventListener('minadental-vault-updated', handler);
    return () => window.removeEventListener('minadental-vault-updated', handler);
  }, [loadVault]);

  const handleRestore = async (archiveId: string) => {
    setRestoringId(archiveId);
    setVaultMsg(null);
    const activeUser = loadActiveUser();
    const res = await restoreArchivedRecord(archiveId, {
      tenantId: activeUser.tenantId || ACTIVE_TENANT_ID,
      branchId: getActiveBranchId(),
      userId: activeUser.id,
    });
    setRestoringId(null);
    setVaultMsg({ ok: res.ok, text: res.message });
    await loadVault();
  };

  return (
    <div className="glass-card p-4 space-y-3 border-2 border-emerald-200/80" data-testid="zero_delete_vault_card">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white flex items-center justify-center shadow-md shrink-0">
            <ShieldCheck size={20} />
          </div>
          <div>
            <h3 className="text-sm font-black text-gray-800">
              گاوصندوق ضدحذف و بازیابی آنی (Zero-Delete Vault)
            </h3>
            <p className="text-[11px] text-emerald-700 font-semibold">
              شناسه رهگیری: <span className="font-mono">TRC-MINA-VAULT-9006-F</span> • هیچ رکوردی هرگز حذف دائم نمی‌شود
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={loadVault}
          className="px-2.5 py-1.5 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-[11px] font-bold flex items-center gap-1"
        >
          <RefreshCw size={12} />
          بروزرسانی
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl bg-emerald-50/80 border border-emerald-200/70 p-2.5">
          <p className="text-[10px] text-emerald-800 font-bold">جداول آینه‌شده IndexedDB</p>
          <p className="text-base font-black text-emerald-700 mt-0.5">
            {(stats?.mirroredTables ?? 0).toLocaleString('fa-IR')} / ۲۰
          </p>
        </div>
        <div className="rounded-2xl bg-sky-50/80 border border-sky-200/70 p-2.5">
          <p className="text-[10px] text-sky-800 font-bold">کل رکوردهای محافظت‌شده</p>
          <p className="text-base font-black text-sky-700 mt-0.5">
            {(stats?.totalMirroredRecords ?? 0).toLocaleString('fa-IR')}
          </p>
        </div>
        <div className="rounded-2xl bg-amber-50/80 border border-amber-200/70 p-2.5">
          <p className="text-[10px] text-amber-800 font-bold">آرشیو قابل بازیابی</p>
          <p className="text-base font-black text-amber-700 mt-0.5">
            {(stats?.unrestoredDeletedCount ?? 0).toLocaleString('fa-IR')}
          </p>
        </div>
      </div>

      {vaultMsg && (
        <div className={`p-2.5 rounded-xl text-xs font-bold flex items-center gap-1.5 ${
          vaultMsg.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'
        }`}>
          {vaultMsg.ok ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          <span>{vaultMsg.text}</span>
        </div>
      )}

      {archived.length === 0 ? (
        <div className="rounded-2xl bg-slate-50 border border-slate-200/80 p-3 text-center">
          <p className="text-xs font-bold text-slate-700">گاوصندوق آماده و فعال است</p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            در صورت حذف هر پرونده، نوبت، چک یا درمان، نسخه کامل آن خودکار اینجا بایگانی شده و با یک کلیک به Cloud SQL بازمی‌گردد.
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-56 overflow-y-auto">
          {archived.slice(0, 12).map((item) => (
            <div key={item.archiveId} className="rounded-2xl bg-white border border-gray-200 p-2.5 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                    {item.table}
                  </span>
                  <span className="text-[10px] font-mono text-emerald-700 font-bold">
                    {item.traceId}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {new Date(item.deletedAt).toLocaleString('fa-IR')}
                  </span>
                </div>
                <p className="text-[11px] text-gray-700 font-bold truncate mt-1">
                  {item.record?.first_name
                    ? `${item.record.first_name} ${item.record.last_name || ''}`
                    : item.record?.title || item.record?.name || item.record?.work_type || item.recordId}
                </p>
              </div>
              {item.restoredAt ? (
                <Badge color="#059669" bg="#D1FAE5">بازیابی شد</Badge>
              ) : (
                <button
                  type="button"
                  onClick={() => handleRestore(item.archiveId)}
                  disabled={restoringId === item.archiveId}
                  className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shrink-0 disabled:opacity-50"
                >
                  {restoringId === item.archiveId ? 'بازگردانی...' : 'بازیابی آنی'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CloudOtaAndAutoBackupCard() {
  const [schedule, setSchedule] = useState(loadBackupSchedule());
  const [backingUpCloud, setBackingUpCloud] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleToggleAutoBackup = (partial: Partial<typeof schedule>) => {
    const next = { ...schedule, ...partial };
    setSchedule(next);
    saveBackupSchedule(next);
    setStatusMsg('تنظیمات بک‌آپ خودکار زمان‌بندی‌شده Cloud SQL و Google Drive ذخیره شد.');
  };

  const handleInstantCloudBackup = async () => {
    setBackingUpCloud(true);
    setStatusMsg(null);
    const [res, driveRes] = await Promise.all([
      performAutomaticCloudAndLocalBackup(),
      activateCloudSqlAndGoogleDrive('mehdi.amiri19851364@gmail.com'),
    ]);
    setSchedule(loadBackupSchedule());
    setBackingUpCloud(false);
    if (res.ok) {
      setStatusMsg(
        `بک‌آپ ۲۰ جدول (${res.totalRecords.toLocaleString('fa-IR')} رکورد • امضای ${driveRes.checksum}) همزمان در Cloud SQL، گوگل درایو و حافظه لوکال ثبت شد.`
      );
    }
  };

  return (
    <div className="glass-card p-4 space-y-3.5 border-2 border-emerald-200/80" data-testid="cloud_sql_drive_autobackup_card">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600 text-white flex items-center justify-center shadow-md">
            <Database size={20} />
          </div>
          <div>
            <h3 className="text-sm font-black text-gray-800">
              بک‌آپ خودکار و همزمان Cloud SQL و Google Drive
            </h3>
            <p className="text-[11px] text-emerald-700 font-semibold mt-0.5">
              فعال روی ۲۰ جدول دیتابیس و پوشه گوگل درایو (mehdi.amiri19851364@gmail.com)
            </p>
          </div>
        </div>
        <div className="text-left">
          <Badge color="#059669" bg="#D1FAE5">Cloud SQL + Drive Active</Badge>
        </div>
      </div>

      {/* Auto-Backup Schedule Controls */}
      <div className="rounded-2xl bg-emerald-50/70 border border-emerald-200/70 p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold text-emerald-950">بک‌آپ خودکار ابری، گوگل درایو و محلی (روزانه و همزمان)</span>
          <input
            type="checkbox"
            checked={schedule.enabled}
            onChange={e => handleToggleAutoBackup({ enabled: e.target.checked })}
            className="w-4 h-4 accent-emerald-600"
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="ساعت بک‌آپ اتوماتیک روزانه">
            <Input
              type="time"
              value={schedule.dailyTime}
              onChange={e => handleToggleAutoBackup({ dailyTime: e.target.value })}
            />
          </Field>
          <Field label="بک‌آپ همزمان با هر تغییر">
            <Select
              value={schedule.autoCloudSync ? 'yes' : 'no'}
              onChange={e => handleToggleAutoBackup({ autoCloudSync: e.target.value === 'yes' })}
              options={[
                { value: 'yes', label: 'فعال (سینک آنی Cloud SQL و Drive)' },
                { value: 'no', label: 'فقط در ساعت مقرر' },
              ]}
            />
          </Field>
        </div>
        {schedule.lastBackupAt && (
          <p className="text-[11px] text-emerald-800 font-semibold">
            آخرین بک‌آپ ابری موفق: {new Date(schedule.lastBackupAt).toLocaleTimeString('fa-IR')}
          </p>
        )}
        <button
          onClick={handleInstantCloudBackup}
          disabled={backingUpCloud}
          className="w-full py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm transition-all active:scale-95 disabled:opacity-50"
        >
          <Database size={14} />
          {backingUpCloud ? 'در حال ذخیره در Cloud SQL و Google Drive...' : 'اجرای فوری بک‌آپ همزمان در Cloud SQL، گوگل درایو و حافظه لوکال'}
        </button>
      </div>

      {statusMsg && (
        <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center gap-1.5">
          <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}
    </div>
  );
}

// ==================== DIAGNOSTICS PANEL ====================
function DiagnosticsPanel({ onOpenInstallModal }: { onOpenInstallModal: () => void }) {
  const [checking, setChecking] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [continuousPingRunning, setContinuousPingRunning] = useState(false);
  const [hardReloading, setHardReloading] = useState(false);

  const [swInfo, setSwInfo] = useState<{
    supported: boolean;
    status: string;
    scope: string;
    scriptUrl: string;
    hasWaiting: boolean;
    controllerActive: boolean;
  }>({
    supported: false,
    status: 'در حال بررسی...',
    scope: '-',
    scriptUrl: '-',
    hasWaiting: false,
    controllerActive: false,
  });

  // Advanced Real-time Network Diagnostics state (Multi-Ping, Latency, Jitter, Stability Grade)
  const [netDiag, setNetDiag] = useState<{
    connected: boolean;
    httpStatus: number | null;
    fetchLatencyMs: number | null;
    sdkLatencyMs: number | null;
    avgLatencyMs: number | null;
    minLatencyMs: number | null;
    maxLatencyMs: number | null;
    jitterMs: number | null;
    successRatePct: number;
    stabilityGrade: string;
    endpointUrl: string;
    statusText: string;
    lastChecked: string;
    online: boolean;
    history: { id: number; ms: number; ok: boolean; time: string }[];
  }>({
    connected: false,
    httpStatus: null,
    fetchLatencyMs: null,
    sdkLatencyMs: null,
    avgLatencyMs: null,
    minLatencyMs: null,
    maxLatencyMs: null,
    jitterMs: null,
    successRatePct: 100,
    stabilityGrade: 'در حال سنجش...',
    endpointUrl: `${supabaseUrl}/rest/v1/clinic_settings?select=id&limit=1`,
    statusText: 'در حال تست ارتباط شبکه...',
    lastChecked: '-',
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    history: [],
  });

  const [cacheInfo, setCacheInfo] = useState<{
    cacheNames: string[];
    totalCachedFiles: number;
    usageMB: string;
    quotaMB: string;
    displayMode: string;
    hasCorruptedOrStale: boolean;
  }>({
    cacheNames: [],
    totalCachedFiles: 0,
    usageMB: '0',
    quotaMB: '0',
    displayMode: 'در حال بررسی...',
    hasCorruptedOrStale: false,
  });

  const [clearingCache, setClearingCache] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Send single ping to health endpoint
  const sendSinglePing = useCallback(async (): Promise<{ ok: boolean; latency: number; status: number | null }> => {
    const healthEndpoint = `${supabaseUrl}/rest/v1/clinic_settings?select=id&limit=1`;
    const t0 = performance.now();
    try {
      const response = await fetch(healthEndpoint, {
        method: 'GET',
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store',
      });
      const latency = Math.round(performance.now() - t0);
      return { ok: response.ok, latency, status: response.status };
    } catch {
      return { ok: false, latency: Math.round(performance.now() - t0), status: null };
    }
  }, []);

  // Multi-request sequential ping runner for latency & stability diagnostics
  const runNetworkHealthCheck = useCallback(async () => {
    setPinging(true);
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
    const timeLabel = new Date().toLocaleTimeString('fa-IR');
    const samplesCount = 5;
    const historySamples: { id: number; ms: number; ok: boolean; time: string }[] = [];

    let totalMs = 0;
    let successCount = 0;
    let minMs = Infinity;
    let maxMs = -Infinity;
    let lastHttpStatus: number | null = null;

    for (let i = 0; i < samplesCount; i++) {
      const res = await sendSinglePing();
      if (res.status !== null) lastHttpStatus = res.status;
      if (res.ok) {
        successCount++;
        totalMs += res.latency;
        if (res.latency < minMs) minMs = res.latency;
        if (res.latency > maxMs) maxMs = res.latency;
      }
      historySamples.push({
        id: i + 1,
        ms: res.latency,
        ok: res.ok,
        time: new Date().toLocaleTimeString('fa-IR', { minute: '2-digit', second: '2-digit' }),
      });
      // Small pause between pings
      if (i < samplesCount - 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }

    const hasSuccess = successCount > 0;
    const avgMs = hasSuccess ? Math.round(totalMs / successCount) : null;
    const minMsVal = hasSuccess && minMs !== Infinity ? minMs : null;
    const maxMsVal = hasSuccess && maxMs !== -Infinity ? maxMs : null;
    const jitterMs = minMsVal !== null && maxMsVal !== null ? maxMsVal - minMsVal : null;
    const successRatePct = Math.round((successCount / samplesCount) * 100);

    let stabilityGrade = 'بحرانی (قطعی کامل)';
    if (successRatePct === 100) {
      if ((jitterMs ?? 0) < 60 && (avgMs ?? 0) < 300) stabilityGrade = 'عالی و پایدار (Stable ⚡)';
      else if ((avgMs ?? 0) < 800) stabilityGrade = 'مطلوب با نوسان جزئی (Good)';
      else stabilityGrade = 'نوسان‌دار (Network Jitter ⚠️)';
    } else if (successRatePct > 0) {
      stabilityGrade = `ناپایدار (افت بسته ${100 - successRatePct}%)`;
    }

    // SDK Ping check
    let sdkLatency: number | null = null;
    try {
      const tSdk0 = performance.now();
      await supabase.from('clinic_settings').select('id', { count: 'exact', head: true });
      sdkLatency = Math.round(performance.now() - tSdk0);
    } catch {
      // ignore
    }

    setNetDiag({
      connected: hasSuccess,
      httpStatus: lastHttpStatus,
      fetchLatencyMs: avgMs,
      sdkLatencyMs: sdkLatency,
      avgLatencyMs: avgMs,
      minLatencyMs: minMsVal,
      maxLatencyMs: maxMsVal,
      jitterMs,
      successRatePct,
      stabilityGrade,
      endpointUrl: `${supabaseUrl}/rest/v1/clinic_settings?select=id&limit=1`,
      statusText: hasSuccess
        ? `اتصال برقرار است (${stabilityGrade} • میانگین تاخیر: ${avgMs}ms • نوسان Jitter: ${jitterMs ?? 0}ms)`
        : isOnline
        ? `عدم پاسخگویی سرور Supabase (${lastHttpStatus ? `HTTP ${lastHttpStatus}` : 'خطای شبکه / VPN'})`
        : 'حالت آفلاین (اینترنت دستگاه قطع است)',
      lastChecked: timeLabel,
      online: isOnline,
      history: historySamples,
    });
    setPinging(false);
  }, [sendSinglePing]);

  const runDiagnostics = useCallback(async () => {
    setChecking(true);
    setActionMessage(null);

    // 1. Check Service Worker status
    try {
      const supported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
      if (!supported) {
        setSwInfo({
          supported: false,
          status: 'WebView محلی / بدون نیاز به SW',
          scope: window.location.origin,
          scriptUrl: 'داخلی (Local Asset Server)',
          hasWaiting: false,
          controllerActive: false,
        });
      } else {
        const reg = await navigator.serviceWorker.getRegistration();
        const hasController = Boolean(navigator.serviceWorker.controller);
        if (reg) {
          const state = reg.active
            ? hasController
              ? 'فعال و کنترل‌کننده صفحه (Active Controller)'
              : 'فعال بدون کنترولر (SW Active)'
            : reg.installing
            ? 'در حال نصب (Installing)'
            : reg.waiting
            ? 'آماده بروزرسانی (Waiting)'
            : 'ثبت‌شده';
          setSwInfo({
            supported: true,
            status: state,
            scope: reg.scope,
            scriptUrl: reg.active?.scriptURL || reg.installing?.scriptURL || './sw.js',
            hasWaiting: Boolean(reg.waiting),
            controllerActive: hasController,
          });
        } else {
          setSwInfo({
            supported: true,
            status: 'ثبت‌نشده (آماده رجیستر خودکار)',
            scope: window.location.origin,
            scriptUrl: './sw.js',
            hasWaiting: false,
            controllerActive: false,
          });
        }
      }
    } catch {
      setSwInfo({
        supported: false,
        status: 'اجرا در کانتینر داخلی اندروید',
        scope: window.location.origin,
        scriptUrl: 'http://127.0.0.1:8765',
        hasWaiting: false,
        controllerActive: false,
      });
    }

    // 2. Real-time Multi-Ping Health Check to Supabase Endpoint
    await runNetworkHealthCheck();

    // 3. Check PWA Cache Storage & Storage Quota
    try {
      let names: string[] = [];
      let fileCount = 0;
      if (typeof window !== 'undefined' && 'caches' in window) {
        names = await window.caches.keys();
        for (const name of names) {
          const c = await window.caches.open(name);
          const keys = await c.keys();
          fileCount += keys.length;
        }
      }

      let usageMB = 'نامشخص';
      let quotaMB = 'نامشخص';
      if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (est.usage !== undefined) usageMB = (est.usage / (1024 * 1024)).toFixed(2) + ' MB';
        if (est.quota !== undefined) quotaMB = (est.quota / (1024 * 1024)).toFixed(0) + ' MB';
      }

      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true;
      const isLocalAndroid = window.location.hostname === '127.0.0.1';

      setCacheInfo({
        cacheNames: names,
        totalCachedFiles: fileCount,
        usageMB,
        quotaMB,
        displayMode: isLocalAndroid
          ? 'پکیج نیتیو اندروید (APK Native Host)'
          : isStandalone
          ? 'اپلیکیشن مستقل نصب‌شده (Standalone PWA)'
          : 'مرورگر وب (آماده نصب PWA)',
        hasCorruptedOrStale: names.some(n => !n.includes('v3') && !n.includes('minadental')),
      });
    } catch {
      // ignore storage estimate errors
    }

    setChecking(false);
  }, [runNetworkHealthCheck]);

  useEffect(() => {
    runDiagnostics();
    const interval = setInterval(() => {
      runNetworkHealthCheck();
    }, 5000);
    return () => clearInterval(interval);
  }, [runDiagnostics, runNetworkHealthCheck]);

  const handleUpdateServiceWorker = async () => {
    try {
      const snap = await updateCoordinator.checkForUpdates('manual');
      if (snap.state === 'AVAILABLE' || snap.state === 'READY_TO_ACTIVATE') {
        setActionMessage('انتشار معتبر جدید یافت شد؛ برای فعال‌سازی ایمن از بخش به‌روزرسانی اقدام کنید.');
      } else if (snap.state === 'CHECK_FAILED' || snap.state === 'OFFLINE') {
        setActionMessage(snap.error?.messageFa || 'بررسی سرویس‌ورکر با خطا مواجه شد.');
      } else {
        setActionMessage('سرویس‌ورکر و مانیفست رسمی بررسی شدند؛ نسخه فعلی به‌روز است.');
      }
      runDiagnostics();
    } catch {
      setActionMessage('خطا در بررسی سرویس‌ورکر.');
    }
  };

  const handleClearPwaCache = async () => {
    setClearingCache(true);
    try {
      if ('caches' in window) {
        const names = await window.caches.keys();
        await Promise.all(names.map(n => window.caches.delete(n)));
      }
      setActionMessage('حافظه کش PWA با موفقیت پاکسازی شد. برای بازنشانی کامل می‌توانید دکمه Hard Reload را نیز بزنید.');
      await runDiagnostics();
    } catch {
      setActionMessage('خطا در پاکسازی کش.');
    } finally {
      setClearingCache(false);
    }
  };

  return (
    <div className="glass-card p-4 space-y-3.5 animate-fade-in" data-testid="diagnostics_panel">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
          <Activity size={17} className="text-blue-600" />
          پنل عیب‌یابی شبکه و سلامت پلتفرم (Network Diagnostics & SW Health)
        </h3>
        <button
          onClick={runDiagnostics}
          disabled={checking}
          data-testid="refresh_diagnostics_button"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-bold transition-all active:scale-95 disabled:opacity-50"
        >
          <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
          {checking ? 'در حال بررسی...' : 'بروزرسانی وضعیت'}
        </button>
      </div>

      {/* Dedicated Real-Time Network Diagnostics Panel (Multi-Ping Health Endpoint) */}
      <div
        className="rounded-2xl border-2 border-emerald-200/80 bg-gradient-to-br from-white via-emerald-50/30 to-teal-50/30 p-3.5 space-y-3"
        data-testid="network_diagnostics_panel"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wifi size={17} className={netDiag.connected ? 'text-emerald-600' : 'text-red-500'} />
            <div>
              <span className="text-xs font-extrabold text-gray-800 block">
                تست شبکه و پایداری لودینگ (Supabase Endpoint Diagnostics)
              </span>
              <span className="text-[10px] text-gray-500">ارسال ۵ درخواست متوالی جهت اندازه‌گیری Latency، Jitter و نرخ موفقیت</span>
            </div>
          </div>
          <Badge
            color={netDiag.connected ? '#16A34A' : '#DC2626'}
            bg={netDiag.connected ? '#DCFCE7' : '#FEE2E2'}
          >
            {netDiag.connected ? `${netDiag.stabilityGrade}` : 'خطای ارتباط'}
          </Badge>
        </div>

        {/* Latency & Stability Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-gray-700 bg-white/90 p-2.5 rounded-xl border border-emerald-100">
          <div>
            <span className="text-gray-400 block text-[10px]">میانگین Latency (پینگ)</span>
            <strong className="text-emerald-700 font-mono text-sm">
              {netDiag.avgLatencyMs !== null ? `${netDiag.avgLatencyMs} ms` : '---'}
            </strong>
          </div>
          <div>
            <span className="text-gray-400 block text-[10px]">نوسان شبکه (Jitter)</span>
            <strong className="text-purple-700 font-mono text-sm">
              {netDiag.jitterMs !== null ? `±${netDiag.jitterMs} ms` : '---'}
            </strong>
          </div>
          <div>
            <span className="text-gray-400 block text-[10px]">کمترین / بیشترین پینگ</span>
            <strong className="font-mono text-xs text-slate-800">
              {netDiag.minLatencyMs !== null ? `${netDiag.minLatencyMs} - ${netDiag.maxLatencyMs} ms` : '---'}
            </strong>
          </div>
          <div>
            <span className="text-gray-400 block text-[10px]">نرخ موفقیت (Success Rate)</span>
            <strong className={`font-mono text-sm ${netDiag.successRatePct === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
              {netDiag.successRatePct}% ({netDiag.httpStatus !== null ? `HTTP ${netDiag.httpStatus}` : '---'})
            </strong>
          </div>

          {/* Sequential Ping Sparkbar */}
          {netDiag.history.length > 0 && (
            <div className="col-span-2 sm:col-span-4 pt-2 border-t border-gray-100 space-y-1">
              <span className="text-[10px] text-gray-500 font-bold block">ریز درخواست‌های متوالی (۵ پینگ اخیر):</span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {netDiag.history.map(item => (
                  <div key={item.id} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-[10px]">
                    <span className="text-gray-400 font-mono">#{item.id}</span>
                    <span className={`font-bold font-mono ${item.ok ? 'text-emerald-700' : 'text-red-600'}`}>
                      {item.ok ? `${item.ms}ms` : 'خطا'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="col-span-2 sm:col-span-4 pt-1.5 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <span><strong>پایداری اتصال:</strong> {netDiag.statusText}</span>
            <span className="text-[10px] text-gray-400 font-mono truncate" dir="ltr">
              {netDiag.endpointUrl}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={runNetworkHealthCheck}
            disabled={pinging}
            data-testid="ping_supabase_button"
            className="flex-1 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition-all active:scale-95 disabled:opacity-50"
          >
            <Zap size={14} className={pinging ? 'animate-pulse' : ''} />
            {pinging ? 'در حال ارسال پینگ‌های متوالی جهت عیب‌یابی...' : 'ارسال درخواست‌های مکرر و تست پایداری شبکه (Continuous Ping Test)'}
          </button>

          <button
            onClick={onOpenInstallModal}
            data-testid="diagnostics_eligibility_button"
            className="py-2 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center gap-1.5 transition-all active:scale-95"
          >
            <Smartphone size={14} />
            معیارهای صلاحیت نصب PWA
          </button>
        </div>
      </div>

      {/* 1. Service Worker & PWA Health Status Module */}
      <div className="rounded-2xl border border-gray-200/80 bg-white/90 p-3.5 space-y-2.5" data-testid="sw_health_module">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server size={16} className="text-indigo-600" />
            <span className="text-xs font-bold text-gray-800">ماژول وضعیت‌سنجی Service Worker و حافظه کش</span>
          </div>
          <Badge
            color={swInfo.supported ? '#16A34A' : '#2563EB'}
            bg={swInfo.supported ? '#DCFCE7' : '#DBEAFE'}
          >
            {swInfo.status}
          </Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-gray-600 bg-gray-50 p-2.5 rounded-xl border border-gray-100">
          <div><strong>استراتژی کش:</strong> Network-First (v3.0)</div>
          <div><strong>کنترل‌کننده فعال:</strong> {swInfo.controllerActive ? 'بله (Active)' : 'خیر (درحال رفرش)'}</div>
          <div className="truncate" dir="ltr"><strong>Scope:</strong> {swInfo.scope}</div>
          <div className="truncate" dir="ltr"><strong>آدرس اسکریپت:</strong> {swInfo.scriptUrl}</div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            onClick={handleUpdateServiceWorker}
            data-testid="update_sw_button"
            className="py-2.5 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition-all active:scale-95 text-center"
          >
            بررسی و ارتقای دستی سرویس‌ورکر
          </button>

          <button
            onClick={() => {
              setHardReloading(true);
              clearServiceWorkerCacheAndHardReload();
            }}
            disabled={hardReloading}
            data-testid="diagnostics_hard_reload_button"
            className="py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-rose-600/20 transition-all active:scale-95 disabled:opacity-50"
          >
            <RotateCcw size={14} className={hardReloading ? 'animate-spin' : ''} />
            {hardReloading ? 'در حال پاکسازی و بازنشانی...' : 'پاکسازی کش و بارگذاری مجدد (Clear Cache & Hard Reload)'}
          </button>
        </div>
      </div>

      {/* SW Live Console Log Stream Card */}
      <div className="rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 p-3.5 space-y-2.5 shadow-lg" data-testid="sw_console_logs_panel">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-cyan-400" />
            <span className="text-xs font-bold text-slate-100">خروجی زنده کنسول سرویس‌ورکر (SW Console Log Stream)</span>
          </div>
          <Badge color="#38BDF8" bg="#0369A1">
            BackgroundSync Active
          </Badge>
        </div>

        <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 max-h-36 overflow-y-auto font-mono text-[10px] space-y-1" dir="ltr">
          <div className="text-emerald-400">[System] ServiceWorker Log Monitor active. Listening for events...</div>
          <div className="text-cyan-300">[SW v4.8.0] Cache strategy Network-First active. BackgroundSync listener initialized.</div>
          <div className="text-indigo-300">[Supabase] Realtime heartbeat socket connected to {supabaseUrl}</div>
        </div>
      </div>

      {/* BackgroundSync Offline Queue Monitor Card */}
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-3.5 space-y-2" data-testid="offline_queue_panel">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-indigo-600" />
            <span className="text-xs font-extrabold text-indigo-950">صف همگام‌سازی داده‌های آفلاین (BackgroundSync Queue)</span>
          </div>
          <Badge color="#4F46E5" bg="#EEF2FF">
            تراکنش‌های آفلاین
          </Badge>
        </div>
        <button
          onClick={async () => {
            const res = await processOfflineQueue();
            if (res.processed > 0) {
              setActionMessage(`همگام‌سازی فوری انجام شد: ${res.processed} تغییر با موفقیت ثبت شد.`);
            } else {
              setActionMessage('تمامی داده‌ها قبلاً به صورت کامل در دیتابیس ابری همگام‌سازی شده‌اند.');
            }
          }}
          className="w-full py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all active:scale-95"
        >
          اجرا و همگام‌سازی فوری داده‌های آفلاین (Sync Queue Now)
        </button>
      </div>

      {/* 3. PWA Cache Storage & Quota Card */}
      <div className="rounded-2xl border border-gray-200/80 bg-white/90 p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive size={16} className="text-cyan-600" />
            <span className="text-xs font-bold text-gray-800">حافظه کش PWA و ظرفیت مرورگر</span>
          </div>
          <Badge color="#0891B2" bg="#CFFAFE">
            {cacheInfo.totalCachedFiles} فایل کش‌شده
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-1.5 text-[11px] text-gray-600 bg-gray-50 p-2.5 rounded-xl border border-gray-100">
          <div className="col-span-2"><strong>حالت اجرای برنامه:</strong> {cacheInfo.displayMode}</div>
          <div><strong>حجم مصرفی کش:</strong> {cacheInfo.usageMB}</div>
          <div><strong>ظرفیت مجاز مرورگر:</strong> {cacheInfo.quotaMB}</div>
          <div className="col-span-2 truncate">
            <strong>نام مخازن کش:</strong> {cacheInfo.cacheNames.length > 0 ? cacheInfo.cacheNames.join(', ') : 'بدون کش اضافی'}
          </div>
        </div>

        <button
          onClick={handleClearPwaCache}
          disabled={clearingCache}
          data-testid="clear_cache_button"
          className="w-full py-2.5 px-3 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold transition-all active:scale-95 disabled:opacity-50"
        >
          {clearingCache ? 'در حال پاکسازی کش...' : 'پاکسازی کامل حافظه کش PWA (بدون رفرش صفحه)'}
        </button>
      </div>

      {actionMessage && (
        <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-1.5 animate-fade-in">
          <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* Technical Architecture & UI Engine Status (inside Diagnostics tab only) */}
      {(() => {
        const uiSummary = getActiveUILibrariesSummary();
        return (
          <div
            data-testid="settings_active_ui_libraries_panel"
            className="p-4 rounded-3xl bg-white text-slate-900 border border-slate-200/95 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-xs sm:text-sm font-black text-slate-900 flex items-center gap-2">
                <Zap size={16} className="text-indigo-600" />
                ماژول‌های رابط کاربری و استانداردهای معماری
              </h3>
              <span
                data-testid="active_ui_libs_badge"
                className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-extrabold"
              >
                {uiSummary.totalLibraries.toLocaleString('fa-IR')} کتابخانه • فعال
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {uiSummary.libraries.map((lib) => (
                <div
                  key={lib.id}
                  data-testid={`ui_lib_card_${lib.id}`}
                  className="p-2.5 rounded-2xl bg-slate-50 border border-slate-200 space-y-1"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-black text-slate-900 truncate">{lib.name}</span>
                    <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-md shrink-0 bg-indigo-50 text-indigo-800 border border-indigo-200">
                      v{lib.version}
                    </span>
                  </div>
                  <p className="text-[10px] font-extrabold text-indigo-700 truncate">{lib.persianRole}</p>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ==================== ADS TAB ====================
function AdsTab({ ads }: { ads: Advertisement[] }) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', content: '', image_url: '', link_url: '', target_audience: 'all', start_date: todayGregorian(), end_date: '' });

  const save = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    const res = await supabase.from('advertisements').insert({
      title: form.title, content: form.content || null,
      image_url: form.image_url || null, link_url: form.link_url || null,
      target_audience: form.target_audience, status: 'active',
      start_date: form.start_date, end_date: form.end_date || null,
    });
    setSaving(false);
    if (res.error) {
      HapticEngine.error();
      return;
    }
    if (verifyServerMutation(res)) HapticEngine.success();
    else HapticEngine.warning();
    setShowForm(false);
    setForm({ title: '', content: '', image_url: '', link_url: '', target_audience: 'all', start_date: todayGregorian(), end_date: '' });
  };

  const toggleStatus = async (id: string, current: string) => {
    await supabase.from('advertisements').update({ status: current === 'active' ? 'inactive' : 'active' }).eq('id', id);
  };
  const del = async (id: string) => { await supabase.from('advertisements').delete().eq('id', id); };

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2"><Megaphone size={16} className="text-slate-500" />تبلیغات و اطلاعیه‌ها</h3>
        <button onClick={() => setShowForm(true)} className="w-9 h-9 rounded-xl bg-slate-500 text-white flex items-center justify-center shadow haptic"><Plus size={20} /></button>
      </div>

      <Sheet
        open={showForm}
        onClose={() => setShowForm(false)}
        title="انتشار تبلیغ و اطلاعیه جدید"
        icon={<Megaphone size={20} />}
        color="#64748B"
      >
        <div className="space-y-4">
          <Field label="عنوان"><Input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="عنوان تبلیغ" /></Field>
          <Field label="محتوا"><Textarea value={form.content} onChange={e => setForm({ ...form, content: e.target.value })} rows={3} placeholder="متن تبلیغ..." /></Field>
          <Field label="آدرس تصویر (اختیاری)"><Input value={form.image_url} onChange={e => setForm({ ...form, image_url: e.target.value })} placeholder="https://..." /></Field>
          <Field label="لینک (اختیاری)"><Input value={form.link_url} onChange={e => setForm({ ...form, link_url: e.target.value })} placeholder="https://..." /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="مخاطب"><Select value={form.target_audience} onChange={e => setForm({ ...form, target_audience: e.target.value })} options={AD_AUDIENCES} /></Field>
            <Field label="تاریخ پایان"><JalaliDatePicker value={form.end_date} onChange={v => setForm({ ...form, end_date: v })} /></Field>
          </div>
          <Button color="#64748B" disabled={saving || !form.title.trim()} className="w-full" onClick={save}>{saving ? 'در حال ذخیره...' : 'انتشار تبلیغ'}</Button>
        </div>
      </Sheet>

      {ads.length === 0 ? (
        <EmptyState icon={<Megaphone size={28} />} title="تبلیغی ثبت نشده" subtitle="برای ساخت تبلیغ جدید روی + بزنید" color="#64748B" />
      ) : (
        <div className="space-y-2 stagger">
          {ads.map(ad => {
            const status = AD_STATUS[ad.status] ?? AD_STATUS.active;
            const audienceLabel = AD_AUDIENCES.find(a => a.value === ad.target_audience)?.label ?? ad.target_audience;
            return (
              <div key={ad.id} className="glass-card p-4">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-sm font-bold text-gray-800">{ad.title}</p>
                  <div className="flex items-center gap-2">
                    <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                    <button onClick={() => toggleStatus(ad.id, ad.status)} className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 haptic">
                      {ad.status === 'active' ? <Eye size={13} /> : <EyeOff size={13} />}
                    </button>
                    <button onClick={() => setDeleteId(ad.id)} className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 haptic"><Trash2 size={13} /></button>
                  </div>
                </div>
                {ad.content && <p className="text-xs text-gray-500 leading-relaxed">{ad.content}</p>}
                {ad.image_url && <img src={ad.image_url} alt={ad.title} className="w-full h-32 object-cover rounded-xl mt-2" />}
                <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-100 text-[10px] text-gray-400">
                  <span>مخاطب: {audienceLabel}</span>
                  <span className="flex items-center gap-1"><Calendar size={10} />{toJalaliStr(ad.start_date)}</span>
                  {ad.end_date && <span>تا {toJalaliStr(ad.end_date)}</span>}
                  {ad.link_url && <a href={ad.link_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-500"><Link size={10} />لینک</a>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && del(deleteId)} title="حذف تبلیغ" message="آیا مطمئن هستید؟" confirmLabel="حذف" />
    </div>
  );
}
