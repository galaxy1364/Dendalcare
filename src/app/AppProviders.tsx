import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { SectionId } from '@/lib/sections';
import type {
  Appointment,
  Check,
  Implant,
  Installment,
  InventoryItem,
  LabOrder,
  Message,
  Patient,
  Reminder,
  Safteh,
  Treatment,
} from '@/lib/supabase';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';
import { computeLiveSmartAlerts, loadSmartReminderRules, type LiveSmartAlert } from '@/lib/smartReminderEngine';
import {
  CURRENT_APP_BUILD,
  CURRENT_APP_VERSION,
  ROLE_LABELS,
  createCredentialHashPair,
  initCloudSyncChannel,
  loadActiveUser,
  loadClinicUsers,
  performAutomaticCloudAndLocalBackup,
  saveActiveUser,
  saveClinicUsers,
  type ClinicUserAccount,
  type ClinicUserRole,
} from '@/lib/cloudSyncEngine';
import { MemPalace } from '@/lib/memPalace';
import {
  applyAppUpdateAtomically,
  checkForAppUpdates,
  getInstalledReleaseInfo,
  isAutoUpdateEnabled,
  type AtomicUpdateProgress,
} from '@/lib/updateManager';
import { activateCloudSqlAndGoogleDrive } from '@/lib/integrationsEngine';
import { clearOfflineQueue, getOfflineQueue, processOfflineQueue } from '@/lib/offlineQueue';
import {
  HapticEngine,
  isHapticsEnabled,
  isSoundEnabled,
  setHapticsEnabled,
  setSoundEnabled,
} from '@/platform/haptics';
import { initAppearanceEngine } from '@/design-system/themes/appearance';
import { getCurrentPlatformInfo, type PlatformInfo } from '@/platform/capabilities';
import { useViewportMetrics } from '@/platform/safeArea';
import {
  getDeviceNotificationPermission,
  isDeviceNotificationsEnabled,
  requestDeviceNotificationPermission,
  sendRealDeviceNotification,
  setDeviceNotificationsEnabled,
  syncSmartAlertsToDeviceNotifications,
  reconcileZeroLossAlerts,
  acknowledgeZeroLossAlert,
  snoozeZeroLossAlert,
  resetAllZeroLossAlertsForToday,
} from '@/lib/deviceNotifications';
import type { GlobalReminderPopupItem } from '@/components/ui/IOSReminderPopup';
import type { MascotMood } from '@/components/ui/MascotTooth';
import { NavigationProvider } from '@/navigation/NavigationStack';
import {
  getActiveBranchId,
  getVerifiedSupabaseSession,
  setActiveBranchId,
  signInWithSupabaseEmail,
  signOutSupabaseSession,
  type VerifiedSessionState,
} from '@/services/authentication/authService';
import { ACTIVE_TENANT_ID } from '@/services/authentication/authService';
import { resolveEffectiveRole } from '@/services/permissions/accessControl';
import {
  clearAllSessionVaultKeys,
  clearVaultMirrorsForScope,
  purgeExpiredVaultMirrors,
} from '@/lib/dataVault';
import { purgeClinicalLocalStorageCaches } from '@/services/supabase/scopedCache';
import { disconnectAllRealtimeChannels } from '@/services/realtime/realtimeHub';
import { appBootstrap, markShellCommitted, sanitizeLogMessage } from './bootstrapState';

export interface SmartWorkflowPopupState {
  id: string;
  type: 'appointment_booked' | 'treatment_completed';
  title: string;
  subtitle: string;
  targetRolesLabel: string;
  patientId?: string;
  patientName: string;
  doctorName: string;
  detailLine: string;
  amountLine?: string;
  suggestedNextStep: string;
  doctorSharePreview?: string;
  actorName: string;
  timestamp: string;
}

export interface GuardianToastState {
  message: string;
  severity: 'security' | 'offline' | 'vault';
  traceId: string;
}

export interface NewUserInput {
  name: string;
  username: string;
  role: ClinicUserRole;
  email: string;
  phone: string;
  pin: string;
}

interface ClinicShellContextValue {
  users: ClinicUserAccount[];
  currentUser: ClinicUserAccount;
  effectiveRole: ClinicUserRole;
  verifiedSession: VerifiedSessionState;
  authBusy: boolean;
  authFeedback: { ok: boolean; text: string } | null;
  branchId: string;
  switchBranch: (id: string) => void;
  switchUser: (u: ClinicUserAccount) => void;
  addNewUser: (input: NewUserInput) => Promise<void>;
  signInSupabase: (email: string, password: string) => Promise<void>;
  signOutSupabase: () => Promise<void>;

  isOnline: boolean;
  onlinePeersCount: number;
  platformInfo: PlatformInfo;
  syncPulse: boolean;
  syncing: boolean;
  triggerSync: () => Promise<void>;
  offlineQueueCount: number;
  flushingQueue: boolean;
  flushOfflineQueue: () => Promise<void>;
  clearQueue: () => void;

  updateAvailable: boolean;
  otaUpdateInfo: { version: string; build?: number; releaseNotes: string; publishedBy: string } | null;
  installingUpdate: boolean;
  atomicProgress: AtomicUpdateProgress | null;
  applyUpdate: (v?: string, b?: number, notes?: string) => Promise<void>;

  liveSyncToast: string | null;
  showSyncToast: (msg: string, ms?: number) => void;
  guardianToast: GuardianToastState | null;
  dismissGuardianToast: () => void;

  hapticsOn: boolean;
  toggleHaptics: () => void;
  soundOn: boolean;
  toggleSound: () => void;
  deviceNotifOn: boolean;
  deviceNotifPerm: string;
  toggleDeviceNotif: (next: boolean) => void;
  requestDeviceNotif: () => Promise<void>;
  testDeviceNotif: () => Promise<void>;

  deferredPrompt: any;
  clearDeferredPrompt: () => void;
  triggerInstall: () => Promise<void>;

  notifOpen: boolean;
  setNotifOpen: (open: boolean) => void;
  qbankMenuOpen: boolean;
  qbankFocusSearch: boolean;
  openQBankMenu: (focusSearch?: boolean) => void;
  closeQBankMenu: () => void;
  projectFolderOpen: boolean;
  setProjectFolderOpen: (open: boolean) => void;
  userModalOpen: boolean;
  setUserModalOpen: (open: boolean) => void;
  callerIdOpen: boolean;
  setCallerIdOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  roadmapModalOpen: boolean;
  setRoadmapModalOpen: (open: boolean) => void;
  installModalOpen: boolean;
  setInstallModalOpen: (open: boolean) => void;
  smartWorkflowPopup: SmartWorkflowPopupState | null;
  setSmartWorkflowPopup: (p: SmartWorkflowPopupState | null) => void;

  patients: Patient[];
  appointments: Appointment[];
  treatments: Treatment[];
  labOrders: LabOrder[];
  implants: Implant[];
  reminders: Reminder[];
  messages: Message[];
  checks: Check[];
  installments: Installment[];
  liveSmartAlerts: LiveSmartAlert[];
  unifiedGlobalAlerts: GlobalReminderPopupItem[];
  zeroLossPopupQueue: GlobalReminderPopupItem[];
  unreadMessages: Message[];
  pendingReminders: Reminder[];
  notifCount: number;
  mascotMood: MascotMood;
  forceExpandReminderKey: number;
  acknowledgeAlert: (id: string) => void;
  snoozeAlert: (id: string, mins: number) => void;
  resetAlerts: () => void;
  triggerReminderPopup: () => void;
  triggerQuickAction: (action: 'caller_id' | 'install' | 'sync' | 'reminder_popup') => void;
}

const ClinicShellContext = createContext<ClinicShellContextValue | null>(null);

export function useClinicShell(): ClinicShellContextValue {
  const ctx = useContext(ClinicShellContext);
  if (!ctx) throw new Error('useClinicShell must be used inside AppProviders');
  return ctx;
}

export function AppProviders({ children }: { children: ReactNode }) {
  const viewport = useViewportMetrics();

  const [users, setUsers] = useState<ClinicUserAccount[]>(() => loadClinicUsers());
  const [currentUser, setCurrentUser] = useState<ClinicUserAccount>(() => loadActiveUser());
  const [branchId, setBranchId] = useState<string>(() => getActiveBranchId());
  const [verifiedSession, setVerifiedSession] = useState<VerifiedSessionState>({
    status: 'unauthenticated',
    supabaseUserId: null,
    supabaseEmail: null,
    serverVerifiedRole: null,
    tenantId: ACTIVE_TENANT_ID,
    branchId: getActiveBranchId(),
  });
  const [authBusy, setAuthBusy] = useState(false);
  const [authFeedback, setAuthFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [onlinePeersCount, setOnlinePeersCount] = useState(1);
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo>(() => getCurrentPlatformInfo());
  const [syncPulse, setSyncPulse] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [offlineQueueCount, setOfflineQueueCount] = useState(() => getOfflineQueue().length);
  const [flushingQueue, setFlushingQueue] = useState(false);

  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [otaUpdateInfo, setOtaUpdateInfo] = useState<{
    version: string;
    build?: number;
    releaseNotes: string;
    publishedBy: string;
  } | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [atomicProgress, setAtomicProgress] = useState<AtomicUpdateProgress | null>(null);

  const [liveSyncToast, setLiveSyncToast] = useState<string | null>(null);
  const [guardianToast, setGuardianToast] = useState<GuardianToastState | null>(null);

  const [hapticsOn, setHapticsOn] = useState(() => isHapticsEnabled());
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());
  const [deviceNotifOn, setDeviceNotifOn] = useState(() => isDeviceNotificationsEnabled());
  const [deviceNotifPerm, setDeviceNotifPerm] = useState(() => getDeviceNotificationPermission());

  const [deferredPrompt, setDeferredPrompt] = useState<any>(() =>
    typeof window !== 'undefined' ? (window as any).__deferredInstallPrompt || null : null
  );

  const [notifOpen, setNotifOpen] = useState(false);
  const [qbankMenuOpen, setQbankMenuOpen] = useState(false);
  const [qbankFocusSearch, setQbankFocusSearch] = useState(false);
  const [projectFolderOpen, setProjectFolderOpen] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [callerIdOpen, setCallerIdOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [roadmapModalOpen, setRoadmapModalOpen] = useState(false);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [smartWorkflowPopup, setSmartWorkflowPopup] = useState<SmartWorkflowPopupState | null>(null);

  const [zeroLossTick, setZeroLossTick] = useState(0);
  const [forceExpandReminderKey, setForceExpandReminderKey] = useState(0);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSyncToast = useCallback((msg: string, ms = 3200) => {
    setLiveSyncToast(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setLiveSyncToast(null), ms);
  }, []);

  // Sync visualViewport keyboard state for zero-scroll layout adaptation
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.keyboardOpen = viewport.keyboardOpen ? 'true' : 'false';
    }
  }, [viewport.keyboardOpen]);

  // Post-commit shell handshake, appearance boot, explicit Auth bootstrap state machine & SW update listener
  useEffect(() => {
    const cleanupAppearance = initAppearanceEngine();
    // V5 P0-04: Genuine post-commit handshake (replaces premature main.tsx flag)
    markShellCommitted();
    appBootstrap.transition('AUTH_RESOLVING');

    getVerifiedSupabaseSession()
      .then((session) => {
        setVerifiedSession(session);
        if (session.status === 'authenticated') {
          appBootstrap.transition('READY');
        } else {
          appBootstrap.transition('DEGRADED', {
            code: session.status === 'unauthenticated' ? 'UNAUTHENTICATED' : 'AUTH_DEGRADED',
            message: 'نشست سرور تایید نشده است؛ دسترسی بر اساس سیاست امنیتی محدود می‌ماند.',
          });
        }
      })
      .catch((err) => {
        appBootstrap.transition('DEGRADED', {
          code: 'AUTH_CHECK_FAILED',
          message: sanitizeLogMessage(err),
        });
      });

    purgeExpiredVaultMirrors().catch(() => {});

    const onSwUpdateAvailable = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      const installed = getInstalledReleaseInfo();
      setOtaUpdateInfo({
        version: detail?.buildId || installed.version,
        build: installed.build + 1,
        releaseNotes: 'نسخه جدید پوسته سامانه دریافت شد و آماده فعال‌سازی کنترل‌شده است.',
        publishedBy: 'سامانه بروزرسانی مینادنتال',
      });
      setUpdateAvailable(true);
    };
    window.addEventListener('minadental:sw-update-available', onSwUpdateAvailable);

    MemPalace.recordAudit({
      traceId: 'TRC-MINA-CORE-9001-A',
      action: 'SYSTEM_BOOT',
      category: 'lifecycle',
      details: `سیستم کلینیک مینادنتال نسخه ${CURRENT_APP_VERSION} (بیلد #${CURRENT_APP_BUILD}) با موفقیت راه‌اندازی شد`,
      actor: currentUser.fullName || 'سیستم مرکزی',
      status: 'pass',
    });

    return () => {
      window.removeEventListener('minadental:sw-update-available', onSwUpdateAvailable);
      cleanupAppearance();
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  // Minimal-column realtime tables (eliminating select('*') across the global shell)
  const { data: reminders } = useRealtimeTable<Reminder>(
    'reminders',
    'id,patient_id,title,description,reminder_date,reminder_time,category,priority,status,created_at'
  );
  const { data: messages } = useRealtimeTable<Message>(
    'messages',
    'id,subject,body,is_read,created_at'
  );
  const { data: patients } = useRealtimeTable<Patient>(
    'patients',
    'id,first_name,last_name,phone,insurance_number,national_id,created_at'
  );
  const { data: appointments } = useRealtimeTable<Appointment>(
    'appointments',
    'id,patient_id,title,appointment_date,appointment_time,room,type,status,created_at'
  );
  const { data: treatments } = useRealtimeTable<Treatment>(
    'treatments',
    'id,patient_id,diagnosis,treatment_plan,tooth_numbers,total_cost,paid_amount,status,created_at'
  );
  const { data: labOrders } = useRealtimeTable<LabOrder>(
    'lab_orders',
    'id,patient_id,lab_name,tooth_numbers,work_type,status,due_date,received_date,created_at'
  );
  const { data: implants } = useRealtimeTable<Implant>(
    'implants',
    'id,patient_id,brand,tooth_number,stage,placement_date,osseointegration_date,abutment_date,crown_date,created_at'
  );
  const { data: inventory } = useRealtimeTable<InventoryItem>(
    'inventory',
    'id,name,quantity,min_quantity,unit,expiry_date,created_at'
  );
  const { data: installments } = useRealtimeTable<Installment>(
    'installments',
    'id,patient_id,total_amount,paid_amount,monthly_amount,next_due_date,status,created_at'
  );
  const { data: checks } = useRealtimeTable<Check>(
    'checks',
    'id,patient_id,check_number,bank_name,amount,due_date,status,created_at'
  );
  const { data: safteh } = useRealtimeTable<Safteh>(
    'safteh',
    'id,patient_id,safteh_number,guarantor_name,amount,due_date,status,created_at'
  );

  const liveSmartAlerts = useMemo(() => {
    const rules = loadSmartReminderRules();
    return computeLiveSmartAlerts({
      patients,
      appointments,
      treatments,
      labOrders,
      implants,
      inventory,
      installments,
      checks,
      safteh,
      rules,
    });
  }, [patients, appointments, treatments, labOrders, implants, inventory, installments, checks, safteh]);

  const pendingReminders = useMemo(
    () => reminders.filter((r) => r.status === 'pending'),
    [reminders]
  );
  const unreadMessages = useMemo(() => messages.filter((m) => !m.is_read), [messages]);
  const notifCount = Math.max(liveSmartAlerts.length, pendingReminders.length) + unreadMessages.length;

  const mascotMood: MascotMood = useMemo(() => {
    if (
      liveSmartAlerts.some((a) => a.urgency === 'critical' || a.urgency === 'today') ||
      pendingReminders.length > 5
    ) {
      return 'sad';
    }
    return 'happy';
  }, [liveSmartAlerts, pendingReminders.length]);

  const unifiedGlobalAlerts: GlobalReminderPopupItem[] = useMemo(() => {
    const mappedLive: GlobalReminderPopupItem[] = liveSmartAlerts.map((a) => ({
      id: a.id,
      domain: a.domain,
      targetSection: a.targetSection,
      patientName: a.patientName,
      patientPhone: a.patientPhone,
      title: a.title,
      subtitle: a.subtitle,
      dueDate: a.dueDate,
      urgency: a.urgency,
      amount: a.amount,
    }));

    const existingTitles = new Set(mappedLive.map((m) => m.title));
    const mappedStored: GlobalReminderPopupItem[] = pendingReminders
      .filter((r) => !existingTitles.has(r.title))
      .map((r) => {
        const pt = patients.find((p) => p.id === r.patient_id);
        const ptName = pt ? `${pt.first_name} ${pt.last_name}` : 'بیمار کلینیک';
        const secMap: Record<string, SectionId> = {
          payment: 'finance',
          implant: 'implants',
          lab: 'lab',
          appointment: 'appointments',
          inventory: 'inventory',
          treatment: 'treatments',
        };
        return {
          id: `rem_${r.id}`,
          domain: r.category || 'appointment',
          targetSection: secMap[r.category] || 'reminders',
          patientName: ptName,
          patientPhone: pt?.phone || null,
          title: r.title,
          subtitle:
            r.description ||
            `موعد یادآوری: ${toJalaliStr(r.reminder_date)} ساعت ${r.reminder_time || '09:30'}`,
          dueDate: r.reminder_date,
          urgency: r.priority === 'urgent' ? 'critical' : r.priority === 'high' ? 'today' : 'upcoming',
        };
      });

    return [...mappedLive, ...mappedStored];
  }, [liveSmartAlerts, pendingReminders, patients]);

  const zeroLossPopupQueue = useMemo(() => {
    void zeroLossTick;
    return reconcileZeroLossAlerts(unifiedGlobalAlerts);
  }, [unifiedGlobalAlerts, zeroLossTick]);

  // Periodic snooze timer & zero-loss trigger events
  useEffect(() => {
    const timer = setInterval(() => setZeroLossTick((t) => t + 1), 15000);
    const onTriggerPopup = () => {
      resetAllZeroLossAlertsForToday();
      setZeroLossTick((t) => t + 1);
      setForceExpandReminderKey((k) => k + 1);
    };
    const onZeroLossUpdated = () => setZeroLossTick((t) => t + 1);
    const onOpenQBank = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      setQbankFocusSearch(Boolean(detail?.focusSearch));
      setQbankMenuOpen(true);
    };
    const onCloseQBank = () => setQbankMenuOpen(false);
    const onResize = () => setPlatformInfo(getCurrentPlatformInfo());

    window.addEventListener('minadental-trigger-ios-reminder-popup', onTriggerPopup);
    window.addEventListener('minadental-zero-loss-updated', onZeroLossUpdated);
    window.addEventListener('minadental-open-qbank-menu', onOpenQBank);
    window.addEventListener('minadental-close-qbank-menu', onCloseQBank);
    window.addEventListener('resize', onResize);

    return () => {
      clearInterval(timer);
      window.removeEventListener('minadental-trigger-ios-reminder-popup', onTriggerPopup);
      window.removeEventListener('minadental-zero-loss-updated', onZeroLossUpdated);
      window.removeEventListener('minadental-open-qbank-menu', onOpenQBank);
      window.removeEventListener('minadental-close-qbank-menu', onCloseQBank);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    if (!deviceNotifOn || unifiedGlobalAlerts.length === 0) return;
    syncSmartAlertsToDeviceNotifications(unifiedGlobalAlerts).catch(() => {});
  }, [deviceNotifOn, unifiedGlobalAlerts]);

  const applyUpdate = useCallback(
    async (targetVersionOverride?: string, targetBuildOverride?: number, releaseNotesOverride?: string) => {
      if (installingUpdate) return;
      setInstallingUpdate(true);
      try {
        const installed = getInstalledReleaseInfo();
        const targetBuild = targetBuildOverride || otaUpdateInfo?.build || installed.build + 1;
        const targetVersion = targetVersionOverride || otaUpdateInfo?.version || `6.6.${targetBuild}`;
        const releaseNotes =
          releaseNotesOverride ||
          otaUpdateInfo?.releaseNotes ||
          `ارتقای اتمیک به نسخه ${targetVersion} (Build #${targetBuild})`;

        const upgraded = await applyAppUpdateAtomically({
          targetVersion,
          targetBuild,
          releaseNotes,
          reloadPage: false,
          onProgress: (p) => setAtomicProgress(p),
        });

        HapticEngine.success();
        setUpdateAvailable(false);
        setOtaUpdateInfo(null);
        showSyncToast(`بیلد #${upgraded.build} (${upgraded.version}) با موفقیت نصب و قفل شد`, 4000);
      } catch {
        HapticEngine.error();
      } finally {
        setInstallingUpdate(false);
        setTimeout(() => setAtomicProgress(null), 1500);
      }
    },
    [installingUpdate, otaUpdateInfo, showSyncToast]
  );

  // Cloud SQL & Real-Time Sync Channel
  useEffect(() => {
    activateCloudSqlAndGoogleDrive(currentUser.email || 'mehdi.amiri19851364@gmail.com').catch(() => {});

    const cleanup = initCloudSyncChannel({
      onSyncEvent: (ev) => {
        setSyncPulse(true);
        setTimeout(() => setSyncPulse(false), 900);
        const name = currentUser.fullName || currentUser.name || 'مدیر کلینیک';
        if (ev.type === 'DATA_MUTATED' && ev.actorName !== name) {
          showSyncToast(
            `سینک آنی از ${ev.actorName} (${ROLE_LABELS[ev.actorRole as ClinicUserRole] || 'کاربر'})`,
            3500
          );
        } else if (ev.type === 'BACKUP_COMPLETED') {
          showSyncToast(`بک‌آپ ابری خودکار توسط ${ev.actorName} انجام شد`, 3500);
        }
      },
      onOtaUpdate: (ota) => {
        const installed = getInstalledReleaseInfo();
        const incomingBuild = Number((ota as { build?: number }).build || installed.build + 1);
        if (ota.version && (incomingBuild > installed.build || ota.version !== installed.version)) {
          const nextInfo = {
            version: ota.version,
            build: incomingBuild,
            releaseNotes: ota.releaseNotes,
            publishedBy: ota.publishedBy || 'مدیریت کلینیک',
          };
          setOtaUpdateInfo(nextInfo);
          setUpdateAvailable(true);
          if (isAutoUpdateEnabled()) {
            void applyUpdate(nextInfo.version, nextInfo.build, nextInfo.releaseNotes);
          } else {
            showSyncToast(`بیلد جدید (#${incomingBuild} • ${ota.version}) آماده نصب است`);
          }
        }
      },
      onPresenceChange: (onlineUsers) => {
        setOnlinePeersCount(Math.max(1, onlineUsers.length));
      },
    });
    return cleanup;
  }, [currentUser.fullName, currentUser.name, currentUser.email, applyUpdate, showSyncToast]);

  // Periodic Update Check
  useEffect(() => {
    const onReleaseUpgraded = () => {
      setUpdateAvailable(false);
      setOtaUpdateInfo(null);
      setInstallingUpdate(false);
      setAtomicProgress(null);
    };
    window.addEventListener('minadental-release-upgraded', onReleaseUpgraded);

    const runCheck = async () => {
      try {
        const installed = getInstalledReleaseInfo();
        const res = await checkForAppUpdates();
        if (res.updateAvailable && res.latestBuild > installed.build) {
          const nextInfo = {
            version: res.latestVersion,
            build: res.latestBuild,
            releaseNotes: res.releaseNotes,
            publishedBy: 'مدیریت کلینیک',
          };
          setOtaUpdateInfo(nextInfo);
          setUpdateAvailable(true);
          if (isAutoUpdateEnabled()) {
            void applyUpdate(nextInfo.version, nextInfo.build, nextInfo.releaseNotes);
          }
        } else {
          setUpdateAvailable(false);
        }
      } catch {
        // ignore
      }
    };

    void runCheck();
    const checkTimer = setInterval(runCheck, 30000);
    return () => {
      clearInterval(checkTimer);
      window.removeEventListener('minadental-release-upgraded', onReleaseUpgraded);
    };
  }, [applyUpdate]);

  // Guardian Toasts, Offline Queue & Table Workflow Popups
  useEffect(() => {
    let toastTimer: ReturnType<typeof setTimeout> | null = null;
    const onGuardianToast = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      if (!detail?.message) return;
      setGuardianToast({
        message: detail.message,
        severity: detail.severity || 'security',
        traceId: detail.traceId || 'TRC-MINA-GUARD',
      });
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => setGuardianToast(null), 5500);
    };
    const onQueueChanged = () => setOfflineQueueCount(getOfflineQueue().length);
    const onBackOnline = async () => {
      const count = getOfflineQueue().length;
      if (count > 0) {
        setFlushingQueue(true);
        const res = await processOfflineQueue();
        const remaining = getOfflineQueue().length;
        setFlushingQueue(false);
        setOfflineQueueCount(remaining);
        if (res.processed > 0) {
          HapticEngine.success();
          showSyncToast(`${res.processed.toLocaleString('fa-IR')} تغییر آفلاین با موفقیت به Cloud SQL ارسال شد`, 4000);
        }
      }
    };
    const onTableMutated = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      if (!detail?.table || !detail?.operation) return;
      const rawPayload = Array.isArray(detail.payload) ? detail.payload[0] : detail.payload || {};
      const patientObj = patients.find((p) => p.id === rawPayload?.patient_id);
      const resolvedPatientName =
        rawPayload?.patient_name ||
        (patientObj ? `${patientObj.first_name || ''} ${patientObj.last_name || ''}`.trim() : '') ||
        'بیمار کلینیک';

      if (detail.table === 'appointments' && detail.operation === 'INSERT') {
        const apptDate = rawPayload?.appointment_date
          ? toJalaliStr(rawPayload.appointment_date)
          : toJalaliStr(todayGregorian());
        const apptTime = rawPayload?.appointment_time || '17:30';
        const serviceType = rawPayload?.service_type || rawPayload?.title || 'ویزیت و معاینه تخصصی';
        const docName = rawPayload?.doctor_name || 'دکتر مهدی امیری';
        HapticEngine.impact('medium');
        setSmartWorkflowPopup({
          id: `wf_appt_${Date.now()}`,
          type: 'appointment_booked',
          title: 'نوبت جدید بیمار ثبت شد',
          subtitle: 'اطلاع‌رسانی آنی جهت انتخاب بیمار و باز کردن چارت پالمر',
          targetRolesLabel: 'ویژه پزشک معالج و مدیر کلینیک',
          patientId: rawPayload?.patient_id,
          patientName: resolvedPatientName,
          doctorName: docName,
          detailLine: `خدمت: ${serviceType} • زمان: ${apptDate} ساعت ${apptTime}`,
          suggestedNextStep: 'گام بعدی: بررسی سابقه پزشکی بیمار و ثبت طرح درمان مرحله‌ای',
          actorName: detail.actor || 'پذیرش کلینیک',
          timestamp: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
        });
      } else if (detail.table === 'treatments' && (detail.operation === 'INSERT' || detail.operation === 'UPDATE')) {
        const toothNum = rawPayload?.tooth_number ? `دندان شماره ${rawPayload.tooth_number}` : 'چارت پالمر';
        const treatType = rawPayload?.treatment_type || rawPayload?.description || 'درمان دندانپزشکی';
        const docName = rawPayload?.doctor_name || detail.actor || 'دکتر مهدی امیری';
        const costVal = Number(rawPayload?.cost || rawPayload?.final_cost || 0);
        const estDoctorHalf = costVal > 0 ? Math.round(costVal / 2) : 0;
        HapticEngine.impact('medium');
        setSmartWorkflowPopup({
          id: `wf_treat_${Date.now()}`,
          type: 'treatment_completed',
          title: 'ثبت / تکمیل درمان توسط پزشک',
          subtitle: 'جهت تسویه، تقسیط، چک ضمانت یا سفارش لابراتوار اقدام کنید',
          targetRolesLabel: 'ویژه منشی، دستیار و مدیر کلینیک',
          patientId: rawPayload?.patient_id,
          patientName: resolvedPatientName,
          doctorName: docName,
          detailLine: `${treatType} • ${toothNum}`,
          amountLine: costVal > 0 ? `${costVal.toLocaleString('fa-IR')} تومان` : undefined,
          suggestedNextStep: '۱. ثبت دریافتی یا چک ضمانت • ۲. سفارش لابراتوار/ایمپلنت • ۳. ثبت نوبت بعدی',
          doctorSharePreview:
            costVal > 0
              ? `سهم کارکرد پایه (۵۰٪ خالص پس از کسر لابراتوار): حدود ${estDoctorHalf.toLocaleString('fa-IR')} تومان`
              : undefined,
          actorName: detail.actor || docName,
          timestamp: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
        });
      }
    };

    window.addEventListener('minadental-guardian-toast', onGuardianToast);
    window.addEventListener('minadental-offline-queue-changed', onQueueChanged);
    window.addEventListener('minadental-table-mutated', onTableMutated);
    window.addEventListener('online', onBackOnline);
    if (typeof navigator === 'undefined' || navigator.onLine) {
      void onBackOnline();
    }
    return () => {
      if (toastTimer) clearTimeout(toastTimer);
      window.removeEventListener('minadental-guardian-toast', onGuardianToast);
      window.removeEventListener('minadental-offline-queue-changed', onQueueChanged);
      window.removeEventListener('minadental-table-mutated', onTableMutated);
      window.removeEventListener('online', onBackOnline);
    };
  }, [patients, showSyncToast]);

  // Network & PWA Install Listeners
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      (window as any).__deferredInstallPrompt = e;
      setDeferredPrompt(e);
    };
    const handleInstalled = () => {
      setDeferredPrompt(null);
      showSyncToast('برنامه مینادنتال با موفقیت روی دستگاه نصب شد', 3500);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('minadental:installed', handleInstalled);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('minadental:installed', handleInstalled);
    };
  }, [showSyncToast]);

  const triggerSync = useCallback(async () => {
    setSyncing(true);
    try {
      await performAutomaticCloudAndLocalBackup();
      HapticEngine.success();
      showSyncToast('بک‌آپ ابری و همگام‌سازی زنده بین تمام پلتفرم‌ها انجام شد', 2800);
    } catch {
      HapticEngine.error();
    } finally {
      setSyncing(false);
    }
  }, [showSyncToast]);

  const flushOfflineQueue = useCallback(async () => {
    if (flushingQueue) return;
    setFlushingQueue(true);
    const res = await processOfflineQueue();
    const remaining = getOfflineQueue().length;
    setFlushingQueue(false);
    setOfflineQueueCount(remaining);
    if (remaining === 0 && res.processed >= 0) {
      HapticEngine.success();
      showSyncToast('صف آفلاین با موفقیت به Cloud SQL ارسال و تایید شد', 4000);
    } else if (remaining > 0) {
      HapticEngine.warning();
      setGuardianToast({
        message: `اتصال به Cloud SQL برقرار نشد؛ ${remaining.toLocaleString('fa-IR')} تغییر همچنان در صف امن محفوظ است.`,
        severity: 'offline',
        traceId: 'TRC-MINA-GUARD-9007-G',
      });
    }
  }, [flushingQueue, showSyncToast]);

  const clearQueue = useCallback(() => {
    clearOfflineQueue();
    setOfflineQueueCount(0);
    showSyncToast('صف آفلاین پاک‌سازی و با دیتابیس محلی یکپارچه شد', 3500);
  }, [showSyncToast]);

  const switchBranch = useCallback(
    (id: string) => {
      const next = setActiveBranchId(id);
      setBranchId(next);
      HapticEngine.selection();
      showSyncToast(`شعبه فعال تغییر یافت`, 2500);
    },
    [showSyncToast]
  );

  const switchUser = useCallback(
    (u: ClinicUserAccount) => {
      const prevUserId = currentUser.id;
      if (prevUserId && prevUserId !== u.id) {
        disconnectAllRealtimeChannels();
        clearAllSessionVaultKeys();
        purgeClinicalLocalStorageCaches({ userId: prevUserId });
        void clearVaultMirrorsForScope({ userId: prevUserId });
      }
      setCurrentUser(u);
      saveActiveUser(u);
      HapticEngine.selection();
      showSyncToast(`ورود به حساب: ${u.fullName || u.name} (${ROLE_LABELS[u.role]})`, 3000);
    },
    [currentUser.id, showSyncToast]
  );

  const addNewUser = useCallback(
    async (input: NewUserInput) => {
      if (!input.name.trim()) return;
      const colors: Record<ClinicUserRole, string> = {
        manager: '#087C76',
        dentist: '#0E7490',
        secretary: '#B02364',
        assistant: '#176B52',
      };
      const creds = input.pin.trim()
        ? await createCredentialHashPair(input.pin.trim())
        : undefined;
      const created: ClinicUserAccount = {
        id: `user_${Date.now()}`,
        username: input.username.trim() || `${input.role}_${Date.now().toString().slice(-4)}`,
        fullName: input.name.trim(),
        name: input.name.trim(),
        role: input.role,
        roleLabel: ROLE_LABELS[input.role],
        email: input.email.trim() || 'user@minadental.ir',
        phone: input.phone.trim() || '09120000000',
        pinHash: creds?.pinHash,
        pinSalt: creds?.pinSalt,
        branchId,
        tenantId: ACTIVE_TENANT_ID,
        avatarColor: colors[input.role],
        canPublishUpdate: input.role === 'manager',
        permissions: {
          canEditPricesAfterSave: input.role === 'manager',
          canDeleteCriticalRecords: input.role === 'manager',
          canPublishOtaUpdate: input.role === 'manager',
          canManageBackups: input.role === 'manager',
          canManageStaffAndShares: input.role === 'manager',
        },
      };
      const updated = [...users, created];
      setUsers(updated);
      saveClinicUsers(updated);
      switchUser(created);
    },
    [branchId, switchUser, users]
  );

  const signInSupabase = useCallback(async (email: string, password: string) => {
    setAuthBusy(true);
    setAuthFeedback(null);
    const res = await signInWithSupabaseEmail(email, password);
    setAuthBusy(false);
    setAuthFeedback({ ok: res.ok, text: res.message });
    if (res.ok && res.session) {
      setVerifiedSession(res.session);
      HapticEngine.success();
    } else {
      HapticEngine.error();
    }
  }, []);

  const signOutSupabase = useCallback(async () => {
    setAuthBusy(true);
    await signOutSupabaseSession();
    const session = await getVerifiedSupabaseSession();
    setVerifiedSession(session);
    setAuthBusy(false);
    setAuthFeedback({ ok: true, text: 'خروج از نشست سرور و پاکسازی کش محلی انجام شد.' });
  }, []);

  const triggerInstall = useCallback(async () => {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice?.outcome === 'accepted') {
          showSyncToast('برنامه مینادنتال با موفقیت روی دستگاه نصب شد', 3000);
          setDeferredPrompt(null);
          return;
        }
      } catch {
        // fallback to modal
      }
    }
    setInstallModalOpen(true);
  }, [deferredPrompt, showSyncToast]);

  const triggerReminderPopup = useCallback(() => {
    resetAllZeroLossAlertsForToday();
    setZeroLossTick((t) => t + 1);
    setForceExpandReminderKey((k) => k + 1);
  }, []);

  const triggerQuickAction = useCallback(
    (action: 'caller_id' | 'install' | 'sync' | 'reminder_popup') => {
      if (action === 'caller_id') setCallerIdOpen(true);
      else if (action === 'install') void triggerInstall();
      else if (action === 'sync') void triggerSync();
      else if (action === 'reminder_popup') triggerReminderPopup();
    },
    [triggerInstall, triggerReminderPopup, triggerSync]
  );

  const onBeforeOverlayBack = useCallback(() => {
    if (qbankMenuOpen) {
      setQbankMenuOpen(false);
      return true;
    }
    if (notifOpen) {
      setNotifOpen(false);
      return true;
    }
    if (smartWorkflowPopup) {
      setSmartWorkflowPopup(null);
      return true;
    }
    if (projectFolderOpen) {
      setProjectFolderOpen(false);
      return true;
    }
    if (userModalOpen) {
      setUserModalOpen(false);
      return true;
    }
    if (callerIdOpen) {
      setCallerIdOpen(false);
      return true;
    }
    if (shortcutsOpen) {
      setShortcutsOpen(false);
      return true;
    }
    if (roadmapModalOpen) {
      setRoadmapModalOpen(false);
      return true;
    }
    if (installModalOpen) {
      setInstallModalOpen(false);
      return true;
    }
    return false;
  }, [
    qbankMenuOpen,
    notifOpen,
    smartWorkflowPopup,
    projectFolderOpen,
    userModalOpen,
    callerIdOpen,
    shortcutsOpen,
    roadmapModalOpen,
    installModalOpen,
  ]);

  const effectiveRole = useMemo(
    () =>
      resolveEffectiveRole({
        serverVerifiedRole: verifiedSession.serverVerifiedRole,
        localRole: currentUser.role,
        sessionStatus: verifiedSession.status,
      }),
    [verifiedSession.serverVerifiedRole, verifiedSession.status, currentUser.role]
  );

  const value: ClinicShellContextValue = {
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
    isOnline,
    onlinePeersCount,
    platformInfo,
    syncPulse,
    syncing,
    triggerSync,
    offlineQueueCount,
    flushingQueue,
    flushOfflineQueue,
    clearQueue,
    updateAvailable,
    otaUpdateInfo,
    installingUpdate,
    atomicProgress,
    applyUpdate,
    liveSyncToast,
    showSyncToast,
    guardianToast,
    dismissGuardianToast: () => setGuardianToast(null),
    hapticsOn,
    toggleHaptics: () => {
      const next = !hapticsOn;
      setHapticsOn(next);
      setHapticsEnabled(next);
    },
    soundOn,
    toggleSound: () => {
      const next = !soundOn;
      setSoundOn(next);
      setSoundEnabled(next);
    },
    deviceNotifOn,
    deviceNotifPerm,
    toggleDeviceNotif: (next) => {
      setDeviceNotificationsEnabled(next);
      setDeviceNotifOn(next);
    },
    requestDeviceNotif: async () => {
      const perm = await requestDeviceNotificationPermission();
      setDeviceNotifPerm(perm);
      const enabled = perm === 'granted';
      setDeviceNotifOn(enabled);
      if (enabled) {
        await sendRealDeviceNotification({
          title: 'مینادنتال متصل شد',
          body: 'یادآوری‌های کلینیک روی نوتیفیکیشن گوشی نمایش داده می‌شوند.',
          tag: 'minadental-connected',
        });
      }
    },
    testDeviceNotif: async () => {
      await sendRealDeviceNotification({
        title: 'مینادنتال • تست اعلان گوشی',
        body: `${notifCount.toLocaleString('fa-IR')} یادآوری فعال در کلینیک ثبت شده است.`,
        tag: `minadental-test-${Date.now()}`,
      });
    },
    deferredPrompt,
    clearDeferredPrompt: () => setDeferredPrompt(null),
    triggerInstall,
    notifOpen,
    setNotifOpen,
    qbankMenuOpen,
    qbankFocusSearch,
    openQBankMenu: (focusSearch = false) => {
      setQbankFocusSearch(focusSearch);
      setQbankMenuOpen(true);
    },
    closeQBankMenu: () => setQbankMenuOpen(false),
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
    appointments,
    treatments,
    labOrders,
    implants,
    reminders,
    messages,
    checks,
    installments,
    liveSmartAlerts,
    unifiedGlobalAlerts,
    zeroLossPopupQueue,
    unreadMessages,
    pendingReminders,
    notifCount,
    mascotMood,
    forceExpandReminderKey,
    acknowledgeAlert: (id) => {
      acknowledgeZeroLossAlert(id);
      setZeroLossTick((t) => t + 1);
    },
    snoozeAlert: (id, mins) => {
      snoozeZeroLossAlert(id, mins);
      setZeroLossTick((t) => t + 1);
      showSyncToast(`یادآوری برای ${mins.toLocaleString('fa-IR')} دقیقه بعد تنظیم شد`, 2600);
    },
    resetAlerts: () => {
      resetAllZeroLossAlertsForToday();
      setZeroLossTick((t) => t + 1);
      showSyncToast('تمام یادآوری‌های امروز بازگردانی شدند', 2600);
    },
    triggerReminderPopup,
    triggerQuickAction,
  };

  return (
    <ClinicShellContext.Provider value={value}>
      <NavigationProvider userRole={effectiveRole} onBeforeOverlayBack={onBeforeOverlayBack}>
        {children}
      </NavigationProvider>
    </ClinicShellContext.Provider>
  );
}
