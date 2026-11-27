import { useId, useRef, useState } from 'react';
import { useFocusTrap } from '@/platform/focusEngine';
import {
  Archive,
  BellRing,
  CheckCircle2,
  Cloud,
  Download,
  FolderKanban,
  Keyboard,
  Lock,
  LogOut,
  PhoneCall,
  PhoneIncoming,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  User,
  Volume2,
  Vibrate,
  X,
} from 'lucide-react';
import {
  CURRENT_APP_VERSION,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type ClinicUserRole,
} from '@/lib/cloudSyncEngine';
import { todayGregorian } from '@/lib/jalali';
import { exportClinicBackupToJson } from '@/lib/exportUtils';
import { activateCloudSqlAndGoogleDrive } from '@/lib/integrationsEngine';
import { supabase, type Patient } from '@/lib/supabase';
import { getMutationOutcome, verifyServerMutation } from '@/lib/supabaseGuardian';
import { PlatformHapticAdapter, HapticEngine } from '@/platform/haptics';
import { CLINIC_BRANCHES } from '@/services/authentication/authService';
import { canAccessRoute } from '@/services/permissions/accessControl';
import { saveAppointmentCommand } from '@/features/appointments/appointmentCommandService';
import { useNavigation } from '@/navigation/NavigationStack';
import { Badge, Button, Field, Input, Select } from '@/components/ui/Form';
import { InstallAppModal } from '@/components/ui/InstallAppModal';
import { NotificationDrawer } from '@/components/ui/NotificationDrawer';
import { QBankTile } from '@/components/ui/QBankTile';
import { DuotoneCallerIdIcon, ModuleDuotoneIcon } from '@/design-system/icons/DentalDuotoneIcons';
import { RoadmapAuditModal } from '@/components/ui/RoadmapAuditModal';
import { Sheet } from '@/components/ui/Sheet';
import { useClinicShell } from './AppProviders';
import { QBankFoldersOverlay } from './QBankFoldersOverlay';

export function OverlayManager() {
  const {
    users,
    currentUser,
    effectiveRole,
    verifiedSession,
    authBusy,
    authFeedback,
    branchId,
    switchBranch,
    switchUser,
    addNewUser,
    signInSupabase,
    signOutSupabase,
    syncing,
    triggerSync,
    hapticsOn,
    toggleHaptics,
    soundOn,
    toggleSound,
    deviceNotifOn,
    deviceNotifPerm,
    toggleDeviceNotif,
    requestDeviceNotif,
    testDeviceNotif,
    deferredPrompt,
    clearDeferredPrompt,
    triggerInstall,
    notifOpen,
    qbankMenuOpen,
    setNotifOpen,
    openQBankMenu,
    projectFolderOpen,
    setProjectFolderOpen,
    userModalOpen,
    setUserModalOpen,
    callerIdOpen,
    setCallerIdOpen,
    shortcutsOpen,
    setShortcutsOpen,
    roadmapModalOpen,
    setRoadmapModalOpen,
    installModalOpen,
    setInstallModalOpen,
    smartWorkflowPopup,
    setSmartWorkflowPopup,
    patients,
    treatments,
    reminders,
    messages,
    liveSmartAlerts,
    unifiedGlobalAlerts,
    zeroLossPopupQueue,
    unreadMessages,
    notifCount,
    acknowledgeAlert,
    snoozeAlert,
    resetAlerts,
    triggerReminderPopup,
    showSyncToast,
    updateAvailable,
    applyUpdate,
  } = useClinicShell();

  const { navigate } = useNavigation();
  const shortcutsDialogRef = useRef<HTMLDivElement>(null);
  const workflowDialogRef = useRef<HTMLDivElement>(null);
  const shortcutsTitleId = useId();
  const workflowTitleId = useId();
  useFocusTrap(shortcutsDialogRef, shortcutsOpen, { onEscape: () => setShortcutsOpen(false) });
  const showWorkflowDialog = Boolean(smartWorkflowPopup) && ![userModalOpen, projectFolderOpen, callerIdOpen, shortcutsOpen, roadmapModalOpen, installModalOpen, notifOpen, qbankMenuOpen].some(Boolean);
  useFocusTrap(workflowDialogRef, showWorkflowDialog, { onEscape: () => setSmartWorkflowPopup(null) });

  const [addingNewUser, setAddingNewUser] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    username: '',
    role: 'secretary' as ClinicUserRole,
    email: '',
    phone: '',
    pin: '',
  });
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');

  const [incomingPhone, setIncomingPhone] = useState('0912');
  const [callerNewFirstName, setCallerNewFirstName] = useState('');
  const [callerNewLastName, setCallerNewLastName] = useState('');
  const [callerApptTime, setCallerApptTime] = useState('17:00');
  const [callerBookingBusy, setCallerBookingBusy] = useState(false);

  const handleCreateUser = async () => {
    if (!newUserForm.name.trim()) return;
    await addNewUser(newUserForm);
    setAddingNewUser(false);
    setNewUserForm({ name: '', username: '', role: 'secretary', email: '', phone: '', pin: '' });
  };

  return (
    <>
      {/* Keyboard Shortcuts Panel */}
      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-[#142E43]/45"
          onClick={() => setShortcutsOpen(false)}
        >
          <div
            ref={shortcutsDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={shortcutsTitleId}
            tabIndex={-1}
            className="w-full max-w-lg max-h-[calc(100dvh-5rem)] overflow-y-auto bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] shadow-2xl rounded-[20px] p-4 animate-scale-in text-[#14283B] dark:text-[#F1F5F9]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Keyboard size={17} className="text-[#087C76]" />
                <h3 id={shortcutsTitleId} className="text-sm font-bold">کلیدهای میانبر سریع کلینیک</h3>
              </div>
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                aria-label="بستن راهنمای کلیدها"
                className="w-12 h-12 rounded-[12px] bg-[#EEF3F7] dark:bg-[#162738] border border-[#D8E2EA] dark:border-[#25394D] flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                { key: 'F1', desc: 'راهنمای کلیدها' },
                { key: 'F2', desc: 'پرونده بیماران' },
                { key: 'F3', desc: 'سیستم نوبت‌دهی' },
                { key: 'F4', desc: 'طرح‌های درمانی' },
                { key: 'F5', desc: 'بازخوانی استاندارد مرورگر' },
                { key: 'F6', desc: 'امور مالی و شخصی' },
                { key: 'F7', desc: 'پرونده ایمپلنت' },
                { key: 'F8', desc: 'سفارشات لابراتوار' },
                { key: 'F9', desc: 'تقویم دائمی فارسی' },
                { key: 'Ctrl/⌘+K', desc: 'جستجوی سریع' },
                { key: 'Esc', desc: 'بستن پنجره فعال' },
              ].map((sc) => (
                <div
                  key={sc.key}
                  className="flex items-center justify-between bg-[#F4F7F9] dark:bg-[#162738] rounded-[12px] px-2.5 py-2 border border-[#D8E2EA] dark:border-[#25394D]"
                >
                  <span className="font-bold text-[11px]">{sc.desc}</span>
                  <span className="font-mono font-bold text-[#087C76] dark:text-[#2DD4BF] bg-[#E2F5F3] dark:bg-[#0D1B2A] px-2 py-0.5 rounded text-[10px] border border-[#B8E5E1] dark:border-[#25394D]">
                    {sc.key}
                  </span>
                </div>
              ))}
            </div>
            <div className="pt-3 border-t border-[#D8E2EA] dark:border-[#25394D] mt-3">
              <button
                type="button"
                onClick={() => {
                  exportClinicBackupToJson(`MinaDental_Backup_${todayGregorian()}`, {
                    reminders,
                    messages,
                    exportedAt: new Date().toISOString(),
                    app: 'MinaDental',
                    version: CURRENT_APP_VERSION,
                  });
                }}
                className="w-full min-h-[44px] flex items-center justify-center gap-2 py-2.5 px-3 rounded-[12px] bg-[#087C76] hover:bg-[#065A56] text-white text-xs font-bold shadow-sm active:scale-95"
              >
                <Download size={15} />
                خروجی یادآوری‌ها و پیام‌ها (JSON)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User Account, Server Session, Branch Switcher & Role Access Modal */}
      <Sheet
        open={userModalOpen}
        onClose={() => {
          setUserModalOpen(false);
          setAddingNewUser(false);
        }}
        title="حساب کاربری، نشست سرور و سطوح دسترسی"
        icon={<User size={20} />}
        color="#087C76"
      >
        <div className="space-y-4" data-testid="user_account_modal">
          <div
            className="rounded-[20px] p-4 text-white shadow-md"
            style={{ background: 'linear-gradient(135deg, #142E43, #087C76)' }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-[14px] bg-white/15 flex items-center justify-center font-bold text-lg shrink-0">
                  {(currentUser.fullName || currentUser.name || 'د')[0]}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold truncate">{currentUser.fullName || currentUser.name}</h3>
                  <p className="text-xs text-teal-100 truncate">{ROLE_LABELS[currentUser.role]}</p>
                  <p className="text-[11px] text-slate-200 mt-0.5 truncate" dir="ltr">
                    {currentUser.email} • {currentUser.phone}
                  </p>
                </div>
              </div>
              <Badge color="#FFFFFF" bg="rgba(255,255,255,0.2)">
                {verifiedSession.status === 'authenticated'
                  ? 'تایید سرور'
                  : verifiedSession.status === 'unauthorized'
                    ? 'فاقد عضویت فعال'
                    : 'محلی'}
              </Badge>
            </div>
            <div className="mt-3 pt-2.5 border-t border-white/15 flex flex-wrap gap-1.5">
              {(ROLE_PERMISSIONS[currentUser.role] || []).map((perm) => (
                <span key={perm} className="text-[10px] font-bold bg-white/15 px-2 py-0.5 rounded-lg">
                  ✓ {perm}
                </span>
              ))}
            </div>
          </div>

          {/* Active Branch Selector */}
          <div className="rounded-[20px] bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] p-3.5 space-y-2">
            <h4 className="text-xs font-bold text-[#14283B] dark:text-[#F1F5F9]">شعبه فعال کلینیک</h4>
            <div className="grid grid-cols-2 gap-2">
              {CLINIC_BRANCHES.map((branch) => {
                const isActiveBranch = branch.id === branchId;
                return (
                  <button
                    key={branch.id}
                    type="button"
                    onClick={() => switchBranch(branch.id)}
                    className={`min-h-[44px] px-3 py-2 rounded-[12px] border text-xs font-bold transition-colors ${
                      isActiveBranch
                        ? 'bg-[#E2F5F3] border-[#087C76] text-[#065A56]'
                        : 'bg-[#F4F7F9] dark:bg-[#162738] border-[#D8E2EA] dark:border-[#25394D] text-[#526779] dark:text-[#9FB1C1]'
                    }`}
                  >
                    {branch.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Real Supabase Auth Session */}
          <div className="rounded-[20px] bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-[#14283B] dark:text-[#F1F5F9] flex items-center gap-1.5">
                <Lock size={14} className="text-[#087C76]" />
                احراز هویت ابری Supabase Auth
              </h4>
              <span className="text-[11px] font-bold text-[#526779] dark:text-[#9FB1C1]">
                {verifiedSession.status === 'authenticated'
                  ? verifiedSession.supabaseEmail || 'نشست فعال'
                  : verifiedSession.status === 'unauthorized'
                    ? `${verifiedSession.supabaseEmail || 'حساب'} (بدون عضویت فعال)`
                    : 'بدون نشست سرور'}
              </span>
            </div>

            {verifiedSession.status === 'authenticated' || verifiedSession.status === 'unauthorized' ? (
              <button
                type="button"
                disabled={authBusy}
                onClick={signOutSupabase}
                className="w-full min-h-[44px] py-2 px-3 rounded-[12px] bg-[#FFF1F2] border border-[#FECDD3] text-[#AD293C] text-xs font-bold flex items-center justify-center gap-1.5"
              >
                <LogOut size={14} />
                خروج از نشست سرور و پاکسازی کش
              </button>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Input
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="ایمیل حساب Supabase"
                    dir="ltr"
                    className="text-left"
                  />
                  <Input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="رمز عبور سرور"
                    dir="ltr"
                    className="text-left"
                  />
                </div>
                <button
                  type="button"
                  disabled={authBusy || !authEmail.trim() || !authPassword.trim()}
                  onClick={() => signInSupabase(authEmail.trim(), authPassword)}
                  className="w-full min-h-[44px] py-2 px-3 rounded-[12px] bg-[#142E43] text-white text-xs font-bold disabled:opacity-50"
                >
                  {authBusy ? 'در حال بررسی...' : 'ورود تاییدشده به نشست سرور'}
                </button>
              </div>
            )}

            {authFeedback && (
              <p
                className={`text-[11px] font-bold px-2.5 py-1.5 rounded-[10px] ${
                  authFeedback.ok
                    ? 'bg-[#ECFDF5] text-[#176B52] border border-[#B7E4CE]'
                    : 'bg-[#FFF1F2] text-[#AD293C] border border-[#FECDD3]'
                }`}
              >
                {authFeedback.text}
              </p>
            )}
          </div>

          {canAccessRoute(currentUser.role, 'settings') && (
            <button
              type="button"
              onClick={async () => {
                await triggerSync();
                await activateCloudSqlAndGoogleDrive(currentUser.email || 'mehdi.amiri19851364@gmail.com');
                showSyncToast('کلود SQL و گوگل درایو همگام‌سازی شدند', 3500);
              }}
              className="w-full min-h-[44px] py-2.5 px-3 rounded-[12px] bg-[#176B52] hover:bg-[#0F4B39] text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm"
            >
              <Cloud size={15} />
              سینک فوری کلود SQL و آرشیو گوگل درایو
            </button>
          )}

          {/* Switch Clinic Account */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-[#14283B] dark:text-[#F1F5F9] flex items-center gap-1.5">
                <ShieldCheck size={15} className="text-[#087C76]" />
                تغییر کاربر کلینیک
              </h4>
              {currentUser.role === 'manager' && (
                <button
                  type="button"
                  onClick={() => setAddingNewUser(!addingNewUser)}
                  className="min-h-[38px] px-2.5 py-1.5 rounded-[10px] bg-[#E2F5F3] text-[#065A56] text-[11px] font-bold flex items-center gap-1"
                >
                  <Plus size={13} /> افزودن کاربر جدید
                </button>
              )}
            </div>

            {addingNewUser && (
              <div className="rounded-[20px] border border-[#B8E5E1] bg-[#F2FBFA] dark:bg-[#162738] p-3.5 space-y-3">
                <h5 className="text-xs font-bold text-[#065A56] dark:text-[#2DD4BF]">
                  تعریف اکانت جدید پرسنل / پزشک
                </h5>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="نام و نام خانوادگی">
                    <Input
                      value={newUserForm.name}
                      onChange={(e) => setNewUserForm({ ...newUserForm, name: e.target.value })}
                      placeholder="مثلاً دکتر رضا محمدی"
                    />
                  </Field>
                  <Field label="نقش و سطح دسترسی">
                    <Select
                      value={newUserForm.role}
                      onChange={(e) =>
                        setNewUserForm({ ...newUserForm, role: e.target.value as ClinicUserRole })
                      }
                      options={[
                        { value: 'manager', label: 'مدیر کلینیک و پزشک ارشد' },
                        { value: 'dentist', label: 'پزشک معالج' },
                        { value: 'secretary', label: 'منشی و پذیرش' },
                        { value: 'assistant', label: 'دستیار دندانپزشک' },
                      ]}
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="نام کاربری اختصاصی">
                    <Input
                      value={newUserForm.username}
                      onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                      placeholder="dr.mohammadi"
                      dir="ltr"
                      className="text-left font-mono"
                    />
                  </Field>
                  <Field label="رمز عبور / پین ورود">
                    <Input
                      type="password"
                      value={newUserForm.pin}
                      onChange={(e) => setNewUserForm({ ...newUserForm, pin: e.target.value })}
                      placeholder="حداقل ۴ رقم"
                      dir="ltr"
                      className="text-left font-mono"
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="جیمیل">
                    <Input
                      value={newUserForm.email}
                      onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
                      placeholder="example@gmail.com"
                    />
                  </Field>
                  <Field label="شماره موبایل">
                    <Input
                      value={newUserForm.phone}
                      onChange={(e) => setNewUserForm({ ...newUserForm, phone: e.target.value })}
                      placeholder="0912..."
                    />
                  </Field>
                </div>
                <Button color="#087C76" className="w-full" onClick={handleCreateUser}>
                  ثبت کاربر با رمزنگاری امن
                </Button>
              </div>
            )}

            <div className="space-y-2">
              {users.map((u) => {
                const isCurr = u.id === currentUser.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => switchUser(u)}
                    className={`w-full min-h-[52px] p-3 rounded-[16px] border transition-colors flex items-center justify-between text-right ${
                      isCurr
                        ? 'bg-[#E2F5F3] border-[#087C76]'
                        : 'bg-white dark:bg-[#11202E] border-[#D8E2EA] dark:border-[#25394D]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-10 h-10 rounded-[12px] text-white font-bold flex items-center justify-center shrink-0"
                        style={{ background: u.avatarColor }}
                      >
                        {(u.fullName || u.name || 'ک')[0]}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#14283B] dark:text-[#F1F5F9] truncate">
                          {u.fullName || u.name || 'کاربر'}
                        </p>
                        <p className="text-[11px] text-[#526779] dark:text-[#9FB1C1] truncate">
                          {ROLE_LABELS[u.role]}
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {isCurr ? (
                        <Badge color="#065A56" bg="#CCFBF1">کاربر فعلی</Badge>
                      ) : (
                        <span className="text-xs font-bold text-[#087C76] flex items-center gap-1">
                          <LogOut size={13} /> سوییچ
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Sheet>

      {/* Project Folder Sheet */}
      <Sheet
        open={projectFolderOpen}
        onClose={() => setProjectFolderOpen(false)}
        title="پوشه پروژه مینادنتال"
        subtitle={`نسخه ${CURRENT_APP_VERSION}`}
        icon={<FolderKanban size={20} />}
        color="#087C76"
      >
        <div className="space-y-3" data-testid="project_folder_sheet_content">
          <div className="grid grid-cols-2 gap-2.5">
            <QBankTile
              label="کالر آیدی هوشمند"
              sub="تشخیص تماس بیمار"
              color="#176B52"
              darkColor="#0F4B39"
              surfaceBg="#F2FBF7"
              surfaceBgEnd="#DFF5EA"
              borderColor="#B7E4CE"
              icon={<DuotoneCallerIdIcon size={28} primaryColor="#142E43" secondaryColor="#176B52" />}
              testId="folder_caller_id_btn"
              onClick={() => {
                setProjectFolderOpen(false);
                setCallerIdOpen(true);
              }}
            />

            <QBankTile
              label="نصب ۴ پلتفرم"
              sub="آیفون، اندروید، آیپد، ویندوز"
              color="#5B3CC4"
              darkColor="#3E278E"
              surfaceBg="#F7F5FF"
              surfaceBgEnd="#EBE6FD"
              borderColor="#D2C8FA"
              icon={<Download size={24} />}
              testId="folder_install_pwa_btn"
              onClick={() => {
                setProjectFolderOpen(false);
                void triggerInstall();
              }}
            />

            <QBankTile
              label="تنظیمات و نسخه‌ها"
              sub="تعرفه‌ها، بکاپ و مدیریت"
              color="#142E43"
              darkColor="#0C1E2D"
              surfaceBg="#F4F7F9"
              surfaceBgEnd="#E6EDF2"
              borderColor="#CAD6E0"
              icon={<ModuleDuotoneIcon id="settings" size={28} primaryColor="#142E43" secondaryColor="#087C76" />}
              testId="folder_settings_shortcut_btn"
              onClick={() => {
                setProjectFolderOpen(false);
                navigate('settings');
              }}
            />

            <QBankTile
              label="سینک ابری و لوکال"
              sub="بک‌آپ فوری و بازیابی"
              color="#0369A1"
              darkColor="#024B73"
              surfaceBg="#F2FAFF"
              surfaceBgEnd="#DFEFFC"
              borderColor="#B5DBF7"
              icon={<Cloud size={19} className={syncing ? 'animate-pulse' : ''} />}
              testId="folder_cloud_sync_btn"
              onClick={() => {
                void triggerSync();
              }}
            />

            <QBankTile
              label="جستجوی پوشه‌ها"
              sub="یافتن بیمار، چک و خدمات"
              color="#92510C"
              darkColor="#6B3B08"
              surfaceBg="#FFFDF5"
              surfaceBgEnd="#FEF1D6"
              borderColor="#FDE0A6"
              icon={<Search size={19} />}
              testId="folder_global_search_btn"
              onClick={() => {
                setProjectFolderOpen(false);
                openQBankMenu(true);
              }}
            />
          </div>

          <div className="rounded-[20px] bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] p-3 space-y-2 shadow-sm">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-[#14283B] dark:text-[#F1F5F9]">
                پیش‌نمایش تست پاپ‌آپ نوبت و درمان
              </h4>
              <span className="text-[10px] font-bold text-[#176B52] bg-[#DFF5EA] px-2 py-0.5 rounded-full border border-[#B7E4CE]">
                آزمایشی
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="simulate_appt_popup_btn"
                onClick={() => {
                  setProjectFolderOpen(false);
                  const samplePatient = patients[0];
                  window.dispatchEvent(
                    new CustomEvent('minadental-table-mutated', {
                      detail: {
                        table: 'appointments',
                        operation: 'INSERT',
                        actor: 'منشی و پذیرش',
                        actorRole: 'secretary',
                        payload: {
                          patient_id: samplePatient?.id,
                          patient_name: samplePatient
                            ? `${samplePatient.first_name} ${samplePatient.last_name}`
                            : 'بیمار نمونه آزمایشی',
                          doctor_name: 'دکتر مهدی امیری',
                          service_type: 'ویزیت و معاینه',
                          appointment_date: todayGregorian(),
                          appointment_time: '18:00',
                        },
                      },
                    })
                  );
                }}
                className="min-h-[44px] py-2 px-3 rounded-[12px] bg-[#E2F5F3] text-[#065A56] border border-[#B8E5E1] text-[11px] font-bold active:scale-95"
              >
                پاپ‌آپ ثبت نوبت
              </button>
              <button
                type="button"
                data-testid="simulate_treat_popup_btn"
                onClick={() => {
                  setProjectFolderOpen(false);
                  const samplePatient = patients[0];
                  window.dispatchEvent(
                    new CustomEvent('minadental-table-mutated', {
                      detail: {
                        table: 'treatments',
                        operation: 'INSERT',
                        actor: 'دکتر مهدی امیری',
                        actorRole: 'manager',
                        payload: {
                          patient_id: samplePatient?.id,
                          patient_name: samplePatient
                            ? `${samplePatient.first_name} ${samplePatient.last_name}`
                            : 'بیمار نمونه آزمایشی',
                          doctor_name: 'دکتر مهدی امیری',
                          tooth_number: 'UR6',
                          treatment_type: 'ترمیم / درمان دندانپزشکی',
                          cost: 0,
                        },
                      },
                    })
                  );
                }}
                className="min-h-[44px] py-2 px-3 rounded-[12px] bg-[#F2FBF7] text-[#176B52] border border-[#B7E4CE] text-[11px] font-bold active:scale-95"
              >
                پاپ‌آپ ثبت درمان
              </button>
            </div>
          </div>

          <div className="rounded-[20px] bg-[#F4F7F9] dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] p-3.5 space-y-2.5">
            <h4 className="text-xs font-bold text-[#14283B] dark:text-[#F1F5F9]">
              بازخورد لمسی و صدای کلیک
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="toggle_ios_haptics_btn"
                onClick={() => {
                  toggleHaptics();
                  if (!hapticsOn) PlatformHapticAdapter.selection();
                }}
                className={`min-h-[44px] p-2.5 rounded-[12px] border text-xs font-bold flex items-center justify-center gap-1.5 ${
                  hapticsOn
                    ? 'bg-[#087C76] text-white border-[#087C76]'
                    : 'bg-white dark:bg-[#162738] text-[#526779] border-[#D8E2EA]'
                }`}
              >
                <Vibrate size={15} />
                <span>هپتیک لمسی: {hapticsOn ? 'روشن' : 'خاموش'}</span>
              </button>
              <button
                type="button"
                data-testid="toggle_ios_sound_btn"
                onClick={() => {
                  toggleSound();
                }}
                className={`min-h-[44px] p-2.5 rounded-[12px] border text-xs font-bold flex items-center justify-center gap-1.5 ${
                  soundOn
                    ? 'bg-[#142E43] text-white border-[#142E43]'
                    : 'bg-white dark:bg-[#162738] text-[#526779] border-[#D8E2EA]'
                }`}
              >
                <Volume2 size={15} />
                <span>صدای کلیک: {soundOn ? 'روشن' : 'خاموش'}</span>
              </button>
            </div>
          </div>
        </div>
      </Sheet>

      {/* Smart Caller-ID & Auto-Booking Sheet */}
      <Sheet
        open={callerIdOpen}
        onClose={() => setCallerIdOpen(false)}
        title="کالر آیدی هوشمند و نوبت‌دهی سریع"
        icon={<PhoneIncoming size={20} />}
        color="#176B52"
      >
        {(() => {
          const cleanPhone = incomingPhone.replace(/\s+/g, '').trim();
          const matchedPatient =
            cleanPhone.length >= 4
              ? patients.find((p) => p.phone && p.phone.replace(/\s+/g, '').includes(cleanPhone))
              : undefined;
          const pTreatments = matchedPatient
            ? treatments.filter((t) => t.patient_id === matchedPatient.id)
            : [];

          const handleQuickBookExisting = async (pat: Patient) => {
            setCallerBookingBusy(true);
            const cmd = await saveAppointmentCommand({
              actorRole: effectiveRole,
              draft: {
                patient_id: pat.id,
                title: `نوبت تلفنی: ${pat.first_name} ${pat.last_name}`,
                appointment_date: todayGregorian(),
                appointment_time: callerApptTime || '17:00',
                duration_min: 30,
                type: 'checkup',
                status: 'confirmed',
                notes: 'ثبت از طریق کالر آیدی تماس ورودی',
                skipConflictCheck: true,
              },
            });
            setCallerBookingBusy(false);
            if (!cmd.ok) {
              HapticEngine.error();
              if (cmd.errorMessage) showSyncToast(cmd.errorMessage, 3200);
              return;
            }
            if (cmd.outcome === 'confirmed') {
              HapticEngine.success();
              showSyncToast(
                `نوبت فوری برای ${pat.first_name} ${pat.last_name} در ساعت ${callerApptTime} در سرور ثبت شد`,
                3500
              );
            } else {
              HapticEngine.warning();
              showSyncToast('نوبت در صف آفلاین ذخیره شد و پس از اتصال تایید می‌شود', 3500);
            }
            setCallerIdOpen(false);
            navigate('appointments', { date: todayGregorian() });
          };

          const handleQuickCreateAndBook = async () => {
            if (!callerNewFirstName.trim()) return;
            setCallerBookingBusy(true);
            const fileNo = String(1001 + patients.length);
            const patRes = await supabase
              .from('patients')
              .insert({
                first_name: callerNewFirstName.trim(),
                last_name: callerNewLastName.trim() || 'بیمار جدید',
                phone: cleanPhone,
                insurance_number: fileNo,
                notes: `[پرونده: ${fileNo}] ثبت از تماس ورودی`,
                status: 'active',
              })
              .select('id,first_name,last_name');
            const createdList = patRes.data;
            const newPat = Array.isArray(createdList) ? createdList[0] : null;
            const apptCmd = await saveAppointmentCommand({
              actorRole: effectiveRole,
              draft: {
                patient_id: newPat?.id ?? null,
                allowMissingPatient: !newPat?.id,
                title: `نوبت اول: ${callerNewFirstName.trim()} ${callerNewLastName.trim()}`,
                appointment_date: todayGregorian(),
                appointment_time: callerApptTime || '17:00',
                duration_min: 30,
                type: 'consultation',
                status: 'confirmed',
                notes: `تماس ورودی شماره ${cleanPhone}`,
                skipConflictCheck: true,
              },
            });
            setCallerBookingBusy(false);
            const patOk = verifyServerMutation(patRes);
            if (!apptCmd.ok) {
              HapticEngine.error();
              if (apptCmd.errorMessage) showSyncToast(apptCmd.errorMessage, 3200);
              return;
            }
            if (patOk && apptCmd.outcome === 'confirmed') {
              HapticEngine.success();
              showSyncToast(`پرونده و نوبت فوری برای ${callerNewFirstName} در سرور ثبت شد`, 3500);
            } else {
              HapticEngine.warning();
              showSyncToast('اطلاعات در صف آفلاین ذخیره شد و پس از اتصال تایید می‌شود', 3500);
            }
            setCallerIdOpen(false);
            setCallerNewFirstName('');
            setCallerNewLastName('');
            navigate('appointments', { date: todayGregorian() });
          };

          return (
            <div className="space-y-4">
              <div className="rounded-[20px] bg-[#F2FBF7] border border-[#B7E4CE] p-3 flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-[14px] bg-[#176B52] text-white flex items-center justify-center shrink-0">
                  <PhoneCall size={20} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[#0F4B39]">تشخیص شماره تماس بیمار</h4>
                  <p className="text-[11px] text-[#176B52] mt-0.5">
                    شماره تماس ورودی را وارد کنید تا پرونده بیمار فوراً شناسایی شود.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Field label="شماره تماس ورودی بیمار">
                    <Input
                      value={incomingPhone}
                      onChange={(e) => setIncomingPhone(e.target.value)}
                      placeholder="مثلاً 0912..."
                      className="font-mono font-bold text-left"
                    />
                  </Field>
                </div>
                <Field label="ساعت نوبت">
                  <Input
                    type="time"
                    value={callerApptTime}
                    onChange={(e) => setCallerApptTime(e.target.value)}
                    className="font-mono font-bold"
                  />
                </Field>
              </div>

              {patients.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  <span className="text-[10px] font-bold text-[#526779] shrink-0">بیماران اخیر:</span>
                  {patients.slice(0, 4).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setIncomingPhone(p.phone || '')}
                      className="min-h-[36px] px-2.5 py-1 rounded-[10px] bg-[#EEF3F7] hover:bg-[#DFF5EA] text-[10px] font-bold text-[#14283B] whitespace-nowrap shrink-0"
                    >
                      {p.first_name} {p.last_name} ({p.phone || 'بدون شماره'})
                    </button>
                  ))}
                </div>
              )}

              {matchedPatient ? (
                <div className="rounded-[20px] bg-[#176B52] p-4 text-white shadow-md space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-bold bg-white/20 px-2 py-0.5 rounded-full">
                        دارای پرونده فعال در مینادنتال
                      </span>
                      <h3 className="text-base font-bold mt-1.5">
                        {matchedPatient.first_name} {matchedPatient.last_name}
                      </h3>
                      <p className="text-xs text-emerald-100 mt-0.5">
                        {matchedPatient.phone} • {pTreatments.length.toLocaleString('fa-IR')} سابقه درمان
                      </p>
                    </div>
                    <Badge color="#0F4B39" bg="#DFF5EA">شناسایی شد</Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/15">
                    <button
                      type="button"
                      disabled={callerBookingBusy}
                      onClick={() => handleQuickBookExisting(matchedPatient)}
                      className="min-h-[44px] py-2 px-3 rounded-[12px] bg-white text-[#0F4B39] font-bold text-xs"
                    >
                      {callerBookingBusy ? 'در حال ثبت...' : `ثبت نوبت فوری (${callerApptTime})`}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCallerIdOpen(false);
                        navigate('patients', { recordId: matchedPatient.id });
                      }}
                      className="min-h-[44px] py-2 px-3 rounded-[12px] bg-white/20 text-white font-bold text-xs"
                    >
                      مشاهده پرونده کامل
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-[20px] bg-[#FFFBEB] border border-[#FDE0A6] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#92510C]">
                      پرونده‌ای با این شماره یافت نشد — تشکیل فوری پرونده:
                    </span>
                    <Badge color="#92510C" bg="#FEF3C7">بیمار جدید</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label="نام بیمار">
                      <Input
                        value={callerNewFirstName}
                        onChange={(e) => setCallerNewFirstName(e.target.value)}
                        placeholder="نام"
                      />
                    </Field>
                    <Field label="نام خانوادگی">
                      <Input
                        value={callerNewLastName}
                        onChange={(e) => setCallerNewLastName(e.target.value)}
                        placeholder="نام خانوادگی"
                      />
                    </Field>
                  </div>
                  <Button
                    color="#176B52"
                    disabled={callerBookingBusy || !callerNewFirstName.trim()}
                    onClick={handleQuickCreateAndBook}
                    className="w-full"
                  >
                    {callerBookingBusy ? 'در حال ثبت...' : `تشکیل پرونده و ثبت نوبت (${callerApptTime})`}
                  </Button>
                </div>
              )}
            </div>
          );
        })()}
      </Sheet>

      <NotificationDrawer
        open={notifOpen}
        onClose={() => setNotifOpen(false)}
        notifCount={notifCount}
        deviceNotifOn={deviceNotifOn}
        deviceNotifPerm={deviceNotifPerm}
        onToggleDeviceNotif={toggleDeviceNotif}
        onRequestDeviceNotif={requestDeviceNotif}
        onTestDeviceNotif={testDeviceNotif}
        spotlightQueue={zeroLossPopupQueue}
        alerts={liveSmartAlerts}
        unreadMessages={unreadMessages}
        totalAlertsCount={unifiedGlobalAlerts.length}
        onNavigate={(sec) => navigate(sec)}
        onAcknowledge={acknowledgeAlert}
        onSnooze={snoozeAlert}
        onResetQueue={() => {
          PlatformHapticAdapter.selection();
          resetAlerts();
        }}
        onOpenIOSPopup={() => {
          PlatformHapticAdapter.selection();
          setNotifOpen(false);
          triggerReminderPopup();
        }}
      />

      <RoadmapAuditModal open={roadmapModalOpen} onClose={() => setRoadmapModalOpen(false)} />

      <InstallAppModal
        open={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        deferredPrompt={deferredPrompt}
        onInstallSuccess={clearDeferredPrompt}
        updateAvailable={updateAvailable}
        onApplyUpdate={() => void applyUpdate()}
      />

      {/* Smart Cross-Role Real-Time Workflow Popup */}
      {showWorkflowDialog && smartWorkflowPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#142E43]/60 animate-fade-in"
          data-testid="smart_workflow_popup"
        >
          <div ref={workflowDialogRef} role="dialog" aria-modal="true" aria-labelledby={workflowTitleId} tabIndex={-1} className="w-full max-w-md max-h-[calc(100dvh-2rem)] rounded-[24px] bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] shadow-2xl overflow-y-auto animate-scale-in">
            <div
              className="p-4 text-white flex items-start justify-between gap-3"
              style={{
                background:
                  smartWorkflowPopup.type === 'appointment_booked' ? '#142E43' : '#087C76',
              }}
            >
              <div className="space-y-1 min-w-0">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/20 text-[10px] font-bold">
                  <BellRing size={11} />
                  {smartWorkflowPopup.targetRolesLabel}
                </span>
                <h3 id={workflowTitleId} className="text-sm font-bold leading-snug">{smartWorkflowPopup.title}</h3>
                <p className="text-[11px] text-white/85 leading-relaxed">
                  {smartWorkflowPopup.subtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSmartWorkflowPopup(null)}
                aria-label="بستن پنجره اطلاع‌رسانی"
                data-testid="smart_workflow_popup_close"
                className="w-12 h-12 rounded-[10px] bg-white/15 hover:bg-white/25 flex items-center justify-center shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="rounded-[16px] bg-[#F4F7F9] dark:bg-[#162738] border border-[#D8E2EA] dark:border-[#25394D] p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-[#526779] dark:text-[#9FB1C1]">
                    نام بیمار:
                  </span>
                  <span className="text-xs font-bold text-[#14283B] dark:text-[#F1F5F9]">
                    {smartWorkflowPopup.patientName}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-[#526779] dark:text-[#9FB1C1]">
                    پزشک معالج:
                  </span>
                  <span className="text-xs font-bold text-[#087C76] dark:text-[#2DD4BF]">
                    {smartWorkflowPopup.doctorName}
                  </span>
                </div>
                <div className="pt-1.5 border-t border-[#D8E2EA] dark:border-[#25394D] flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-[#14283B] dark:text-[#F1F5F9]">
                    {smartWorkflowPopup.detailLine}
                  </span>
                  {smartWorkflowPopup.amountLine && (
                    <span className="text-xs font-bold text-[#176B52] bg-[#DFF5EA] px-2 py-0.5 rounded-lg border border-[#B7E4CE]">
                      {smartWorkflowPopup.amountLine}
                    </span>
                  )}
                </div>
                {smartWorkflowPopup.suggestedNextStep && (
                  <div className="rounded-[10px] bg-[#E2F5F3] border border-[#B8E5E1] px-2.5 py-1.5 text-[11px] font-bold text-[#065A56] leading-relaxed">
                    {smartWorkflowPopup.suggestedNextStep}
                  </div>
                )}
                {smartWorkflowPopup.doctorSharePreview && (
                  <div className="rounded-[10px] bg-[#FFFBEB] border border-[#FDE0A6] px-2.5 py-1.5 text-[10px] font-bold text-[#92510C] leading-relaxed">
                    {smartWorkflowPopup.doctorSharePreview}
                  </div>
                )}
                <div className="flex items-center justify-between text-[10px] text-[#526779] pt-1">
                  <span>ثبت توسط: {smartWorkflowPopup.actorName}</span>
                  <span>ساعت {smartWorkflowPopup.timestamp}</span>
                </div>
              </div>

              {smartWorkflowPopup.type === 'appointment_booked' ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    data-testid="smart_popup_open_treatment_btn"
                    onClick={() => {
                      setSmartWorkflowPopup(null);
                      navigate('treatments', { recordId: smartWorkflowPopup.patientId });
                    }}
                    className="w-full min-h-[44px] py-2.5 px-3.5 rounded-[12px] bg-[#087C76] text-white text-xs font-bold flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={15} />
                    ورود به چارت درمان (ویژه پزشک و مدیر)
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSmartWorkflowPopup(null);
                        navigate('appointments');
                      }}
                      className="min-h-[44px] py-2 px-3 rounded-[12px] bg-[#EEF3F7] text-[#14283B] text-xs font-bold"
                    >
                      مشاهده لیست نوبت‌ها
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSmartWorkflowPopup(null);
                        navigate('patients', { recordId: smartWorkflowPopup.patientId });
                      }}
                      className="min-h-[44px] py-2 px-3 rounded-[12px] bg-[#EEF3F7] text-[#14283B] text-xs font-bold"
                    >
                      پرونده کامل بیمار
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    type="button"
                    data-testid="smart_popup_open_finance_btn"
                    onClick={() => {
                      setSmartWorkflowPopup(null);
                      navigate('finance');
                    }}
                    className="w-full min-h-[44px] py-2.5 px-3.5 rounded-[12px] bg-[#176B52] text-white text-xs font-bold flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={15} />
                    ثبت دریافتی، تقسیط یا چک ضمانت
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      data-testid="smart_popup_open_next_appt_btn"
                      onClick={() => {
                        setSmartWorkflowPopup(null);
                        navigate('appointments');
                      }}
                      className="min-h-[44px] py-2 px-3 rounded-[12px] bg-[#E2F5F3] text-[#065A56] border border-[#B8E5E1] text-xs font-bold"
                    >
                      تعیین نوبت جلسه بعد
                    </button>
                    <button
                      type="button"
                      data-testid="smart_popup_open_lab_btn"
                      onClick={() => {
                        setSmartWorkflowPopup(null);
                        navigate('lab');
                      }}
                      className="min-h-[44px] py-2 px-3 rounded-[12px] bg-[#FFFBEB] text-[#92510C] border border-[#FDE0A6] text-xs font-bold"
                    >
                      سفارش لابراتوار
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <QBankFoldersOverlay />
    </>
  );
}
