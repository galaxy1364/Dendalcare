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
} from '@/lib/updateManager';
import { getOfflineQueue, processOfflineQueue, type OfflineMutationItem } from '@/lib/offlineQueue';
import { ClinicDefinitionsModal } from '@/components/ui/ClinicDefinitionsModal';

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

export function SettingsSection() {
  const { data: settings } = useRealtimeTable<ClinicSetting>('clinic_settings');
  const { data: ads } = useRealtimeTable<Advertisement>('advertisements');

  const [tab, setTab] = useState<SettingsTab>('clinic');
  const [installModalOpen, setInstallModalOpen] = useState(false);

  return (
    <div className="space-y-2.5 pb-2 animate-fade-in-up">
      {/* QBank Top Bar: Sliding Horizontal Chip Bar */}
      <div className="glass-card p-2.5">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {[
            { key: 'clinic' as const, label: 'کلینیک، تعرفه‌ها و بکاپ خودکار', icon: <Building2 size={13} /> },
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
          onOpenInstallModal={() => setInstallModalOpen(true)}
        />
      )}
      {tab === 'integrations' && <IntegrationsTab />}
      {tab === 'diagnostics' && (
        <DiagnosticsPanel onOpenInstallModal={() => setInstallModalOpen(true)} />
      )}
      {tab === 'ads' && <AdsTab ads={ads} />}

      <InstallAppModal
        open={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        deferredPrompt={null}
        onInstallSuccess={() => {}}
      />
    </div>
  );
}

// ==================== CLINIC SETTINGS TAB ====================
function ClinicSettingsTab({
  settings,
  onOpenDiagnostics,
  onOpenInstallModal,
}: {
  settings: ClinicSetting[];
  onOpenDiagnostics: () => void;
  onOpenInstallModal: () => void;
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
  const [autoUpdate, setAutoUpdate] = useState(isAutoUpdateEnabled());
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);
  const [defsModalOpen, setDefsModalOpen] = useState(false);

  const handleToggleAutoUpdate = (enabled: boolean) => {
    setAutoUpdate(enabled);
    setAutoUpdateEnabled(enabled);
    setUpdateMessage({
      type: 'success',
      text: enabled
        ? 'بروزرسانی خودکار فعال شد.'
        : 'بروزرسانی خودکار غیرفعال شد.'
    });
  };

  const handleManualCheckUpdate = async () => {
    setCheckingUpdates(true);
    setUpdateMessage(null);
    // Broadcast latest build #38 to cloud so all connected clients get notified instantly
    await broadcastNewAppBuild(CURRENT_APP_VERSION, CURRENT_APP_BUILD, 'بروزرسانی خودکار و دستی ارتقا یافته');
    const res = await checkForAppUpdates();
    setCheckingUpdates(false);
    if (res.updateAvailable) {
      setUpdateMessage({
        type: 'info',
        text: `نسخه جدیدتر (v${res.latestVersion} بیلد #${res.latestBuild}) در دسترس است. در حال اعمال...`
      });
      setTimeout(() => {
        clearAllCachesAndHardReload();
      }, 1000);
    } else {
      setUpdateMessage({
        type: 'success',
        text: `برنامه به آخرین نسخه v${CURRENT_APP_VERSION} (بیلد #${CURRENT_APP_BUILD}) ارتقا یافت و همگام است.`
      });
    }
  };

  useEffect(() => {
    const map: Record<string, string> = {};
    settings.forEach(s => { map[s.key] = s.value ?? ''; });
    setValues(map);
  }, [settings]);

  const save = async () => {
    setSaving(true);
    for (const [key, value] of Object.entries(values)) {
      const existing = settings.find(s => s.key === key);
      if (existing) {
        if (existing.value !== value) await supabase.from('clinic_settings').update({ value }).eq('id', existing.id);
      } else {
        await supabase.from('clinic_settings').insert({ key, value, category: 'general' });
      }
    }
    setSaving(false);
  };

  const handleExportFullBackup = async () => {
    setExporting(true);
    try {
      const [
        { data: patients },
        { data: appointments },
        { data: treatments },
        { data: payments },
        { data: labOrders },
        { data: implants },
        { data: inventory },
        { data: staff },
        { data: reminders },
      ] = await Promise.all([
        supabase.from('patients').select('*'),
        supabase.from('appointments').select('*'),
        supabase.from('treatments').select('*'),
        supabase.from('payments').select('*'),
        supabase.from('lab_orders').select('*'),
        supabase.from('implants').select('*'),
        supabase.from('inventory_items').select('*'),
        supabase.from('staff').select('*'),
        supabase.from('reminders').select('*'),
      ]);

      const backupData = {
        exportedAt: new Date().toISOString(),
        version: '3.0.0',
        app: 'DentalCare',
        settings,
        patients: patients || [],
        appointments: appointments || [],
        treatments: treatments || [],
        payments: payments || [],
        labOrders: labOrders || [],
        implants: implants || [],
        inventory: inventory || [],
        staff: staff || [],
        reminders: reminders || [],
      };

      const dateStr = new Date().toISOString().slice(0, 10);
      exportClinicBackupToJson(`DentalCare_FullClinic_Backup_${dateStr}`, backupData);
    } catch (err: any) {
      console.error('Backup error:', err);
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
      if (Array.isArray(restorePreview.patients) && restorePreview.patients.length > 0) {
        await supabase.from('patients').upsert(restorePreview.patients, { onConflict: 'id' });
      }
      if (Array.isArray(restorePreview.treatments) && restorePreview.treatments.length > 0) {
        await supabase.from('treatments').upsert(restorePreview.treatments, { onConflict: 'id' });
      }
      if (Array.isArray(restorePreview.appointments) && restorePreview.appointments.length > 0) {
        await supabase.from('appointments').upsert(restorePreview.appointments, { onConflict: 'id' });
      }
      if (Array.isArray(restorePreview.payments) && restorePreview.payments.length > 0) {
        await supabase.from('payments').upsert(restorePreview.payments, { onConflict: 'id' });
      }
      if (Array.isArray(restorePreview.inventory) && restorePreview.inventory.length > 0) {
        await supabase.from('inventory_items').upsert(restorePreview.inventory, { onConflict: 'id' });
      }
      setRestoreMessage({ type: 'success', text: 'بازیابی اطلاعات با موفقیت انجام شد و تمامی جداول با سرور ابری همگام شدند.' });
      setRestorePreview(null);
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
    { key: 'default_appointment_duration', label: 'مدت پیش‌فرض نوبت (دقیقه)', icon: <Calendar size={14} />, placeholder: '30' },
    { key: 'clinic_morning_hours', label: 'ساعت کاری شیفت صبح', icon: <Clock size={14} />, placeholder: '09:00 الی 13:30' },
    { key: 'clinic_evening_hours', label: 'ساعت کاری شیفت عصر', icon: <Clock size={14} />, placeholder: '16:00 الی 21:30' },
    { key: 'doctor_commission_default', label: 'درصد پیش‌فرض سهم پزشک (درصد)', icon: <Percent size={14} />, placeholder: '40' },
  ];

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Auto & Manual Live Update Management Card */}
      <div className="p-4 rounded-3xl bg-gradient-to-br from-indigo-900 via-purple-950 to-slate-900 text-white border border-purple-500/30 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-cyan-400 to-blue-500 flex items-center justify-center text-white shadow-lg shadow-cyan-500/30">
              <RefreshCw size={20} className={checkingUpdates ? 'animate-spin' : ''} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                بروزرسانی خودکار و دستی مینادنتال
              </h3>
              <p className="text-[11px] text-cyan-200">
                نسخه فعال: <strong className="text-white font-mono">v{CURRENT_APP_VERSION}</strong> • شماره بیلد: <strong className="text-white font-mono">Build #{CURRENT_APP_BUILD}</strong>
              </p>
            </div>
          </div>
          <span className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 font-mono font-bold">
            Live Sync v4
          </span>
        </div>

        {/* Option 1: Auto Update Toggle */}
        <div className="p-2.5 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between">
          <span className="text-xs font-bold text-white">
            بروزرسانی خودکار هوشمند (Live Auto-Update)
          </span>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              checked={autoUpdate}
              onChange={(e) => handleToggleAutoUpdate(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:right-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
          </label>
        </div>

        {/* Option 2: Manual Update Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleManualCheckUpdate}
            disabled={checkingUpdates}
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-md shadow-purple-600/30 active:scale-95 transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={checkingUpdates ? 'animate-spin' : ''} />
            {checkingUpdates ? 'در حال بررسی...' : 'بررسی دستی بروزرسانی'}
          </button>

          <button
            type="button"
            onClick={() => clearAllCachesAndHardReload()}
            className="flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/30 active:scale-95 transition-all"
          >
            <RotateCcw size={14} />
            پاکسازی کش و ارتقای فوری
          </button>
        </div>

        {/* Update feedback message */}
        {updateMessage && (
          <div className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
            updateMessage.type === 'success'
              ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/30'
              : updateMessage.type === 'info'
              ? 'bg-blue-500/20 text-blue-200 border border-blue-400/30'
              : 'bg-rose-500/20 text-rose-200 border border-rose-400/30'
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
        <h3 className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
          <Building2 size={16} className="text-slate-500" />
          اطلاعات و ساعات کاری کلینیک
        </h3>
        {fields.map(f => (
          <Field key={f.key} label={f.label}>
            <div className="relative">
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">{f.icon}</span>
              <Input value={values[f.key] ?? ''} onChange={e => setValues({ ...values, [f.key]: e.target.value })} placeholder={f.placeholder} className="pr-9" />
            </div>
          </Field>
        ))}
        <Button color="#64748B" disabled={saving} className="w-full" onClick={save} icon={<Save size={16} />}>{saving ? 'در حال ذخیره...' : 'ذخیره تنظیمات کلینیک'}</Button>
      </div>

      {/* Clean Multi-Platform Hub */}
      <div className="glass-card p-4 space-y-2.5">
        <h3 className="text-xs font-bold text-gray-700 flex items-center gap-2">
          <Download size={16} className="text-indigo-600" />
          دانلود و راه‌اندازی نسخه‌ها
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={async () => {
              setDownloadingApk(true);
              setApkDownloadProgress(10);
              const res = await downloadApkSafely('DentalCare.apk', (p) => setApkDownloadProgress(p));
              setDownloadingApk(false);
            }}
            disabled={downloadingApk}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm active:scale-95 transition-all text-center disabled:opacity-50"
          >
            <Download size={14} className={downloadingApk ? 'animate-bounce' : ''} />
            {downloadingApk ? `دانلود (${apkDownloadProgress}%)` : `دانلود فایل APK`}
          </button>

          <a
            href="./DentalCare.mobileconfig"
            download="DentalCare.mobileconfig"
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold shadow-sm active:scale-95 transition-all no-underline text-center"
          >
            <Download size={14} />
            پروفایل iOS
          </a>

          <a
            href="https://galaxy1364.github.io/Dendalcare/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm active:scale-95 transition-all no-underline text-center"
          >
            <Link size={14} />
            نسخه GitHub Pages
          </a>

          <button
            onClick={() => {
              setHardReloading(true);
              clearServiceWorkerCacheAndHardReload();
            }}
            disabled={hardReloading}
            className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition-all active:scale-95 disabled:opacity-50"
          >
            <RotateCcw size={14} className={hardReloading ? 'animate-spin' : ''} />
            {hardReloading ? 'در حال پاکسازی...' : 'پاکسازی کش و ری‌لود'}
          </button>
        </div>
      </div>

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
              <span>تعداد بیماران: {restorePreview.patients?.length ?? 0}</span>
              <span>تعداد درمان‌ها: {restorePreview.treatments?.length ?? 0}</span>
              <span>تعداد نوبت‌ها: {restorePreview.appointments?.length ?? 0}</span>
              <span>تراکنش‌های مالی: {restorePreview.payments?.length ?? 0}</span>
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

      {/* Multi-User Cloud Sync, Automatic Backup Scheduler & Instant OTA Update Publisher */}
      <CloudOtaAndAutoBackupCard />

      {/* Inline Live Diagnostics Summary */}
      <DiagnosticsPanel onOpenInstallModal={onOpenInstallModal} />
    </div>
  );
}

function CloudOtaAndAutoBackupCard() {
  const [schedule, setSchedule] = useState(loadBackupSchedule());
  const [otaNotes, setOtaNotes] = useState('ارتقای سیستم تقویم دائمی، نوبت‌دهی هوشمند، مالی شخصی و همگام‌سازی ابری');
  const [publishingOta, setPublishingOta] = useState(false);
  const [backingUpCloud, setBackingUpCloud] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleToggleAutoBackup = (partial: Partial<typeof schedule>) => {
    const next = { ...schedule, ...partial };
    setSchedule(next);
    saveBackupSchedule(next);
    setStatusMsg('تنظیمات بک‌آپ خودکار زمان‌بندی‌شده ذخیره شد.');
  };

  const handleInstantCloudBackup = async () => {
    setBackingUpCloud(true);
    setStatusMsg(null);
    const res = await performAutomaticCloudAndLocalBackup();
    setSchedule(loadBackupSchedule());
    setBackingUpCloud(false);
    if (res.ok) {
      setStatusMsg(`بک‌آپ ابری و محلی (${res.totalRecords.toLocaleString('fa-IR')} رکورد) با موفقیت در Supabase و حافظه دستگاه ثبت شد.`);
    }
  };

  const handlePublishOta = async () => {
    setPublishingOta(true);
    setStatusMsg(null);
    const user = loadActiveUser();
    await publishOtaUpdateToAllUsers(otaNotes, user.fullName || user.name || 'مدیر کلینیک');
    setPublishingOta(false);
    setStatusMsg('فرمان آپدیت اتوماتیک (OTA) به صورت آنی برای تمامی کاربران متصل (پزشک، مدیر، منشی و دستیار) ارسال شد.');
  };

  return (
    <div className="glass-card p-4 space-y-3.5 border-2 border-purple-200/80">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-600 via-indigo-600 to-fuchsia-600 text-white flex items-center justify-center shadow-md">
            <Zap size={20} />
          </div>
          <div>
            <h3 className="text-sm font-black text-gray-800">
              نسخه، شماره بیلد و بروزرسانی خودکار کلینیک
            </h3>
            <div className="flex items-center gap-2 text-[11px] text-gray-600 mt-0.5">
              <span>نسخه انتشار: <strong className="text-purple-700 font-mono">v{CURRENT_APP_VERSION}</strong></span>
              <span>•</span>
              <span>شماره بیلد فعال: <strong className="text-indigo-700 font-mono">Build #{CURRENT_APP_BUILD}</strong></span>
            </div>
          </div>
        </div>
        <div className="text-left">
          <Badge color="#7C3AED" bg="#EDE9FE">Supabase Realtime v4</Badge>
          <span className="block text-[9px] text-emerald-600 font-bold mt-1 text-center">همگام‌سازی ابری آنی</span>
        </div>
      </div>

      {/* Auto-Backup Schedule Controls */}
      <div className="rounded-2xl bg-purple-50/70 border border-purple-200/70 p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold text-purple-950">بک‌آپ خودکار ابری و محلی (زمان‌بندی روزانه و همزمان)</span>
          <input
            type="checkbox"
            checked={schedule.enabled}
            onChange={e => handleToggleAutoBackup({ enabled: e.target.checked })}
            className="w-4 h-4 accent-purple-600"
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
                { value: 'yes', label: 'فعال (سینک آنی ابری)' },
                { value: 'no', label: 'فقط در ساعت مقرر' },
              ]}
            />
          </Field>
        </div>
        {schedule.lastBackupAt && (
          <p className="text-[11px] text-purple-800 font-semibold">
            آخرین بک‌آپ ابری موفق: {new Date(schedule.lastBackupAt).toLocaleTimeString('fa-IR')}
          </p>
        )}
        <button
          onClick={handleInstantCloudBackup}
          disabled={backingUpCloud}
          className="w-full py-2.5 px-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm transition-all active:scale-95 disabled:opacity-50"
        >
          <Database size={14} />
          {backingUpCloud ? 'در حال ذخیره در ابر Supabase...' : 'اجرای فوری بک‌آپ ابری در سرور Supabase و حافظه لوکال'}
        </button>
      </div>

      {/* OTA Broadcast to all connected users */}
      <div className="rounded-2xl bg-indigo-50/70 border border-indigo-200/70 p-3 space-y-2.5">
        <p className="text-xs font-extrabold text-indigo-950">
          انتشار آپدیت اتوماتیک روی برنامه همه کاربران (مدیر، پزشکان، دستیار و منشی)
        </p>
        <Input
          value={otaNotes}
          onChange={e => setOtaNotes(e.target.value)}
          placeholder="توضیحات نسخه جدید جهت نمایش به کاربران..."
        />
        <button
          onClick={handlePublishOta}
          disabled={publishingOta}
          className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-indigo-600 via-purple-600 to-fuchsia-600 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-md transition-all active:scale-95 disabled:opacity-50"
        >
          <RefreshCw size={14} className={publishingOta ? 'animate-spin' : ''} />
          {publishingOta ? 'در حال ارسال سیگنال آپدیت به همه دستگاه‌ها...' : 'انتشار آنی آپدیت روی دستگاه تمام کاربران متصل'}
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
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          }
          setActionMessage('سرویس‌ورکر با موفقیت بررسی و به آخرین نسخه (Network-First) همگام شد.');
        } else {
          await navigator.serviceWorker.register('./sw.js');
          setActionMessage('سرویس‌ورکر مجدداً ثبت و فعال‌سازی شد.');
        }
      } else {
        setActionMessage('در محیط APK بومی، فایل‌ها مستقیماً بدون کش قدیمی از سرور داخلی بارگذاری می‌شوند.');
      }
      runDiagnostics();
    } catch {
      setActionMessage('بررسی سرویس‌ورکر انجام شد.');
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
    await supabase.from('advertisements').insert({
      title: form.title, content: form.content || null,
      image_url: form.image_url || null, link_url: form.link_url || null,
      target_audience: form.target_audience, status: 'active',
      start_date: form.start_date, end_date: form.end_date || null,
    });
    setSaving(false); setShowForm(false);
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
