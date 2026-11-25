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
  type AtomicUpdateProgress,
  type UpdateSnapshot,
} from '@/lib/updateManager';
import { activateCloudSqlAndGoogleDrive } from '@/lib/integrationsEngine';
import { clearOfflineQueue, getOfflineQueue, processOfflineQueue } from '@/lib/offlineQueue';
import { HapticEngine } from '@/platform/haptics';
import { getCurrentPlatformInfo, type PlatformInfo } from '@/platform/capabilities';
import { useViewportMetrics } from '@/platform/safeArea';
import {
  requestDeviceNotificationPermission,
  syncSmartAlertsToDeviceNotifications,
  reconcileZeroLossAlerts,
  acknowledgeZeroLossAlert,
  snoozeZeroLossAlert,
  resetAllZeroLossAlertsForToday,
} from '@/lib/deviceNotifications';
import {
  AppearanceProvider,
  useAppearanceProvider,
} from './providers/AppearanceProvider';
import {
  UpdateProvider,
  useUpdateProvider,
} from './providers/UpdateProvider';
import {
  NOTIFICATION_READ_MODEL_PROJECTIONS,
  buildUnifiedNotificationAlerts,
  computeMascotMood,
  computeNotificationCount,
} from './providers/NotificationReadModel';
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

  updateSnapshot: UpdateSnapshot;
  updateAvailable: boolean;
  otaUpdateInfo: { version: string; build?: number; releaseId?: string; releaseNotes: string; publishedBy: string } | null;
  installingUpdate: boolean;
  atomicProgress: AtomicUpdateProgress | null;
  applyUpdate: (forceEvenIfBusy?: boolean) => Promise<void>;
  deferUpdate: (minutes?: number) => void;
  checkUpdatesNow: () => Promise<void>;
  openNativeUpdateStore: () => void;

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
  const [liveSyncToast, setLiveSyncToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSyncToast = useCallback((msg: string, ms = 3200) => {
    setLiveSyncToast(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setLiveSyncToast(null), ms);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, []);

  return (
    <AppearanceProvider requestPermissionFn={requestDeviceNotificationPermission}>
      <UpdateProvider onToast={showSyncToast} applyUpdateFn={applyAppUpdateAtomically}>
        <ClinicShellProviders
          liveSyncToast={liveSyncToast}
          showSyncToast={showSyncToast}
        >
          {children}
        </ClinicShellProviders>
      </UpdateProvider>
    </AppearanceProvider>
  );
}

function ClinicShellProviders({
  children,
  liveSyncToast,
  showSyncToast,
}: {
  children: ReactNode;
  liveSyncToast: string | null;
  showSyncToast: (msg: string, ms?: number) => void;
}) {
  const viewport = useViewportMetrics();
  const appearance = useAppearanceProvider();
  const updates = useUpdateProvider();

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

  const [guardianToast, setGuardianToast] = useState<GuardianToastState | null>(null);

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

  // Sync visualViewport keyboard state for zero-scroll layout adaptation
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.keyboardOpen = viewport.keyboardOpen ? 'true' : 'false';
    }
  }, [viewport.keyboardOpen]);

  // Post-commit shell handshake & explicit Auth bootstrap state machine
  // (Runs before parent UpdateProvider's useEffect so markShellCommitted() always precedes updateCoordinator.start())
  useEffect(() => {
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

    MemPalace.recordAudit({
      traceId: 'TRC-MINA-CORE-9001-A',
      action: 'SYSTEM_BOOT',
      category: 'lifecycle',
      details: `سیستم کلینیک مینادنتال نسخه ${CURRENT_APP_VERSION} (بیلد #${CURRENT_APP_BUILD}) با موفقیت راه‌اندازی شد`,
      actor: currentUser.fullName || 'سیستم مرکزی',
      status: 'pass',
    });
  }, []);

  // V10 P1 Data-Minimized realtime shell tables (strictly excluding clinical PHI/PII columns)
  const { data: reminders } = useRealtimeTable<Reminder>(
    'reminders',
    NOTIFICATION_READ_MODEL_PROJECTIONS.reminders
  );
  const { data: messages } = useRealtimeTable<Message>(
    'messages',
    NOTIFICATION_READ_MODEL_PROJECTIONS.messages
  );
  const { data: patients } = useRealtimeTable<Patient>(
    'patients',
    NOTIFICATION_READ_MODEL_PROJECTIONS.patients
  );
  const { data: appointments } = useRealtimeTable<Appointment>(
    'appointments',
    NOTIFICATION_READ_MODEL_PROJECTIONS.appointments
  );
  const { data: treatments } = useRealtimeTable<Treatment>(
    'treatments',
    NOTIFICATION_READ_MODEL_PROJECTIONS.treatments
  );
  const { data: labOrders } = useRealtimeTable<LabOrder>(
    'lab_orders',
    NOTIFICATION_READ_MODEL_PROJECTIONS.lab_orders
  );
  const { data: implants } = useRealtimeTable<Implant>(
    'implants',
    NOTIFICATION_READ_MODEL_PROJECTIONS.implants
  );
  const { data: inventory } = useRealtimeTable<InventoryItem>(
    'inventory',
    NOTIFICATION_READ_MODEL_PROJECTIONS.inventory
  );
  const { data: installments } = useRealtimeTable<Installment>(
    'installments',
    NOTIFICATION_READ_MODEL_PROJECTIONS.installments
  );
  const { data: checks } = useRealtimeTable<Check>(
    'checks',
    NOTIFICATION_READ_MODEL_PROJECTIONS.checks
  );
  const { data: safteh } = useRealtimeTable<Safteh>(
    'safteh',
    NOTIFICATION_READ_MODEL_PROJECTIONS.safteh
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
  const notifCount = computeNotificationCount(
    liveSmartAlerts.length,
    pendingReminders.length,
    unreadMessages.length
  );

  const mascotMood: MascotMood = useMemo(
    () => computeMascotMood(liveSmartAlerts, pendingReminders.length),
    [liveSmartAlerts, pendingReminders.length]
  );

  const unifiedGlobalAlerts: GlobalReminderPopupItem[] = useMemo(
    () =>
      buildUnifiedNotificationAlerts({
        liveSmartAlerts,
        pendingReminders,
        patients,
      }),
    [liveSmartAlerts, pendingReminders, patients]
  );

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
    if (!appearance.deviceNotifOn || unifiedGlobalAlerts.length === 0) return;
    syncSmartAlertsToDeviceNotifications(unifiedGlobalAlerts).catch(() => {});
  }, [appearance.deviceNotifOn, unifiedGlobalAlerts]);

  useEffect(() => {
    if (verifiedSession.status !== 'authenticated') return;
    activateCloudSqlAndGoogleDrive(currentUser.email || 'mehdi.amiri19851364@gmail.com').catch(() => {});
  }, [verifiedSession.status, currentUser.email]);

  // Cloud SQL & Real-Time Sync Channel (Realtime OTA events are HINT-ONLY — never release authority)
  useEffect(() => {
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
        let parsedReleaseId: string | undefined;
        try {
          const parsed = JSON.parse(ota.releaseNotes || '{}') as { releaseId?: string };
          parsedReleaseId = parsed.releaseId;
        } catch {
          parsedReleaseId = (ota as { releaseId?: string }).releaseId;
        }
        // Strictly treat Realtime push as an untrusted hint; coordinator validates releaseId & fetches manifest
        void updates.handleRealtimeHint({
          releaseId: parsedReleaseId,
          version: ota.version,
        });
      },
      onPresenceChange: (onlineUsers) => {
        setOnlinePeersCount(Math.max(1, onlineUsers.length));
      },
    });
    return cleanup;
  }, [currentUser.fullName, currentUser.name, currentUser.email, showSyncToast, updates.handleRealtimeHint]);

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
      getVerifiedSupabaseSession(next)
        .then((session) => {
          setVerifiedSession(session);
          if (session.status === 'authenticated') {
            appBootstrap.transition('READY');
          } else {
            appBootstrap.transition('DEGRADED', {
              code: session.status === 'unauthenticated' ? 'UNAUTHENTICATED' : 'AUTH_DEGRADED',
              message: 'عضویت فعال کلینیک برای شعبه انتخاب‌شده تایید نشد.',
            });
          }
        })
        .catch(() => {});
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
    if (res.session) {
      setVerifiedSession(res.session);
      if (res.session.status === 'authenticated') {
        appBootstrap.transition('READY');
      } else {
        appBootstrap.transition('DEGRADED', {
          code: 'AUTH_DEGRADED',
          message: 'عضویت فعال کلینیک برای این حساب تایید نشد.',
        });
      }
    }
    if (res.ok && res.session?.status === 'authenticated') {
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
    updateSnapshot: updates.updateSnapshot,
    updateAvailable: updates.updateAvailable,
    otaUpdateInfo: updates.otaUpdateInfo,
    installingUpdate: updates.installingUpdate,
    atomicProgress: updates.atomicProgress,
    applyUpdate: updates.applyUpdate,
    deferUpdate: updates.deferUpdate,
    checkUpdatesNow: updates.checkUpdatesNow,
    openNativeUpdateStore: updates.openNativeUpdateStore,
    liveSyncToast,
    showSyncToast,
    guardianToast,
    dismissGuardianToast: () => setGuardianToast(null),
    hapticsOn: appearance.hapticsOn,
    toggleHaptics: appearance.toggleHaptics,
    soundOn: appearance.soundOn,
    toggleSound: appearance.toggleSound,
    deviceNotifOn: appearance.deviceNotifOn,
    deviceNotifPerm: appearance.deviceNotifPerm,
    toggleDeviceNotif: appearance.toggleDeviceNotif,
    requestDeviceNotif: appearance.requestDeviceNotif,
    testDeviceNotif: () => appearance.testDeviceNotif(notifCount),
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
