import { useState, useEffect, useRef, useMemo } from 'react';
import { type SectionId, getSection } from '@/lib/sections';
import { BottomDock } from '@/components/BottomDock';
import { DesktopSidebar } from '@/components/DesktopSidebar';
import { getCurrentPlatformInfo } from '@/lib/platformEngine';
import { Dashboard } from '@/components/sections/Dashboard';
import { Patients } from '@/components/sections/Patients';
import { Appointments } from '@/components/sections/Appointments';
import { CalendarSection } from '@/components/sections/CalendarSection';
import { Treatments } from '@/components/sections/Treatments';
import { Lab } from '@/components/sections/Lab';
import { Implants } from '@/components/sections/Implants';
import { Finance } from '@/components/sections/Finance';
import { Inventory } from '@/components/sections/Inventory';
import { Reminders } from '@/components/sections/Reminders';
import { StaffSection } from '@/components/sections/StaffSection';
import { Messages } from '@/components/sections/Messages';
import { SettingsSection } from '@/components/sections/SettingsSection';
import {
  Cloud, Sparkles, X, Keyboard, WifiOff, Download, ShieldAlert, Archive, UploadCloud,
  BellRing, ArrowLeft, User, ShieldCheck, RefreshCw, Plus, CheckCircle2, LogOut, PhoneIncoming, PhoneCall,
  FolderKanban, Volume2, Vibrate, Smartphone,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import {
  supabase,
  type Reminder, type Message, type Patient, type Appointment, type Treatment,
  type LabOrder, type Implant, type InventoryItem, type Installment, type Check, type Safteh,
} from '@/lib/supabase';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';
import { exportClinicBackupToJson } from '@/lib/exportUtils';
import { InstallAppModal } from '@/components/ui/InstallAppModal';
import { Sheet } from '@/components/ui/Sheet';
import { Field, Input, Select, Button, Badge } from '@/components/ui/Form';
import { computeLiveSmartAlerts, loadSmartReminderRules } from '@/lib/smartReminderEngine';
import {
  type ClinicUserAccount,
  type UserRole,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  CURRENT_APP_VERSION,
  CURRENT_APP_BUILD,
  loadClinicUsers,
  saveClinicUsers,
  loadActiveUser,
  saveActiveUser,
  initCloudSyncChannel,
  publishOtaUpdateToAllUsers,
  performAutomaticCloudAndLocalBackup,
} from '@/lib/cloudSyncEngine';
import { MascotTooth, type MascotMood } from '@/components/ui/MascotTooth';
import { RoadmapAuditModal } from '@/components/ui/RoadmapAuditModal';
import { MemPalace, OmniRoute } from '@/lib/memPalace';
import { broadcastNewAppBuild, checkForAppUpdates } from '@/lib/updateManager';
import { getOfflineQueue, processOfflineQueue } from '@/lib/offlineQueue';
import { DraggableNotificationHandle } from '@/components/ui/DraggableNotificationHandle';
import {
  playTactileFeedback,
  isHapticsEnabled,
  setHapticsEnabled,
  isSoundEnabled,
  setSoundEnabled,
} from '@/lib/hapticsAudio';
import {
  getDeviceNotificationPermission,
  isDeviceNotificationsEnabled,
  requestDeviceNotificationPermission,
  sendRealDeviceNotification,
  setDeviceNotificationsEnabled,
  syncSmartAlertsToDeviceNotifications,
} from '@/lib/deviceNotifications';

function App() {
  const [active, setActive] = useState<SectionId>('dashboard');
  const [syncPulse, setSyncPulse] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'all' | 'finance' | 'clinical' | 'ops'>('all');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(() =>
    typeof window !== 'undefined' ? (window as any).__deferredInstallPrompt || null : null
  );
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [otaUpdateInfo, setOtaUpdateInfo] = useState<{ version: string; releaseNotes: string; publishedBy: string } | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [appReady, setAppReady] = useState(true);

  const [roadmapModalOpen, setRoadmapModalOpen] = useState(false);
  const [projectFolderOpen, setProjectFolderOpen] = useState(false);
  const [platformInfo, setPlatformInfo] = useState(() => getCurrentPlatformInfo());
  const [hapticsOn, setHapticsOn] = useState<boolean>(() => isHapticsEnabled());
  const [soundOn, setSoundOn] = useState<boolean>(() => isSoundEnabled());
  const [deviceNotifOn, setDeviceNotifOn] = useState<boolean>(() => isDeviceNotificationsEnabled());
  const [deviceNotifPerm, setDeviceNotifPerm] = useState(() => getDeviceNotificationPermission());
  const [callerIdOpen, setCallerIdOpen] = useState(false);
  const [incomingPhone, setIncomingPhone] = useState('0912');
  const [callerNewFirstName, setCallerNewFirstName] = useState('');
  const [callerNewLastName, setCallerNewLastName] = useState('');
  const [callerApptTime, setCallerApptTime] = useState('17:00');
  const [callerBookingBusy, setCallerBookingBusy] = useState(false);
  const [headerVisible, setHeaderVisible] = useState(true);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const splashEl = document.getElementById('app-splash');
    if (splashEl) {
      splashEl.style.opacity = '0';
      splashEl.remove();
    }

    // OmniRoute restore previous active screen
    const savedRoute = OmniRoute.getCurrentRoute() as SectionId;
    if (savedRoute && savedRoute !== active) {
      setActive(savedRoute);
    }

    // MemPalace audit trail boot record with verifiable trace ID
    MemPalace.recordAudit({
      traceId: 'TRC-MINA-CORE-9001-A',
      action: 'SYSTEM_BOOT',
      category: 'lifecycle',
      details: `سیستم کلینیک مینادنتال نسخه ${CURRENT_APP_VERSION} (بیلد #${CURRENT_APP_BUILD}) با موفقیت راه‌اندازی شد`,
      actor: 'سیستم مرکزی',
      status: 'pass',
    });
  }, []);

  const handleNavigate = (newSection: SectionId) => {
    setActive(newSection);
    OmniRoute.navigate(newSection);
    MemPalace.recordAudit({
      traceId: 'TRC-MINA-CLINIC-9002-B',
      action: 'NAVIGATION',
      category: 'navigation',
      details: `تغییر بخش به ماژول: ${newSection}`,
      actor: currentUser?.fullName || 'کاربر',
      status: 'pass',
    });
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const currentY = e.currentTarget.scrollTop;
    if (currentY < 40) {
      setHeaderVisible(true);
    } else if (currentY > lastScrollY.current + 10) {
      // Scrolling down -> slide header away (Headroom physics)
      setHeaderVisible(false);
    } else if (currentY < lastScrollY.current - 14) {
      // Scrolling up -> reveal header instantly
      setHeaderVisible(true);
    }
    lastScrollY.current = currentY;
  };

  // Multi-User Role & Account Switcher State (Top Bar Avatar Icon)
  const [users, setUsers] = useState<ClinicUserAccount[]>(() => loadClinicUsers());
  const [currentUser, setCurrentUser] = useState<ClinicUserAccount>(() => loadActiveUser());
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [addingNewUser, setAddingNewUser] = useState(false);
  const [onlinePeersCount, setOnlinePeersCount] = useState(1);
  const [liveSyncToast, setLiveSyncToast] = useState<string | null>(null);
  const [guardianToast, setGuardianToast] = useState<{
    message: string;
    severity: 'security' | 'offline' | 'vault';
    traceId: string;
  } | null>(null);
  const [offlineQueueCount, setOfflineQueueCount] = useState<number>(() => getOfflineQueue().length);
  const [flushingQueue, setFlushingQueue] = useState(false);
  const [smartWorkflowPopup, setSmartWorkflowPopup] = useState<{
    id: string;
    type: 'appointment_booked' | 'treatment_completed';
    title: string;
    subtitle: string;
    targetRolesLabel: string;
    patientName: string;
    doctorName: string;
    detailLine: string;
    amountLine?: string;
    actorName: string;
    timestamp: string;
  } | null>(null);
  const [newUserForm, setNewUserForm] = useState({
    name: '',
    username: '',
    role: 'secretary' as UserRole,
    email: '',
    phone: '',
    pin: '1234',
  });

  const sectionRef = useRef<HTMLDivElement>(null);
  const section = getSection(active);

  const { data: reminders } = useRealtimeTable<Reminder>('reminders');
  const { data: messages } = useRealtimeTable<Message>('messages');
  const { data: patients } = useRealtimeTable<Patient>('patients');
  const { data: appointments } = useRealtimeTable<Appointment>('appointments');
  const { data: treatments } = useRealtimeTable<Treatment>('treatments');
  const { data: labOrders } = useRealtimeTable<LabOrder>('lab_orders');
  const { data: implants } = useRealtimeTable<Implant>('implants');
  const { data: inventory } = useRealtimeTable<InventoryItem>('inventory');
  const { data: installments } = useRealtimeTable<Installment>('installments');
  const { data: checks } = useRealtimeTable<Check>('checks');
  const { data: safteh } = useRealtimeTable<Safteh>('safteh');

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

  const pendingReminders = reminders.filter(r => r.status === 'pending');
  const unreadMessages = messages.filter(m => !m.is_read);
  const notifCount = Math.max(liveSmartAlerts.length, pendingReminders.length) + unreadMessages.length;

  const mascotMood: MascotMood = useMemo(() => {
    if (liveSmartAlerts.some(a => a.urgency === 'critical' || a.urgency === 'today') || pendingReminders.length > 5) {
      return 'sad';
    }
    if (active === 'treatments' || active === 'lab' || active === 'implants') {
      return 'pro';
    }
    if (active === 'calendar') {
      return 'ai';
    }
    return 'happy';
  }, [liveSmartAlerts, pendingReminders, active]);

  const filteredDrawerAlerts = useMemo(() => {
    if (drawerTab === 'finance') {
      return liveSmartAlerts.filter(a => a.domain === 'check' || a.domain === 'safteh' || a.domain === 'installment' || a.domain === 'debt');
    }
    if (drawerTab === 'clinical') {
      return liveSmartAlerts.filter(a => a.domain === 'implant' || a.domain === 'lab');
    }
    if (drawerTab === 'ops') {
      return liveSmartAlerts.filter(a => a.domain === 'appointment' || a.domain === 'inventory');
    }
    return liveSmartAlerts;
  }, [liveSmartAlerts, drawerTab]);

  // Dispatch urgent/due smart alerts to genuine OS/Device Notifications when enabled
  useEffect(() => {
    if (!deviceNotifOn || liveSmartAlerts.length === 0) return;
    syncSmartAlertsToDeviceNotifications(liveSmartAlerts).catch(() => {});
  }, [deviceNotifOn, liveSmartAlerts]);

  // Subscribe to Multi-User Cloud Sync & OTA Update Channel
  useEffect(() => {
    // Publish current build on app initialization to Supabase so all devices know latest version
    broadcastNewAppBuild(CURRENT_APP_VERSION, CURRENT_APP_BUILD, 'ارتقای سیستم کلینیک مینادنتال').catch(() => {});

    const cleanup = initCloudSyncChannel({
      onSyncEvent: (ev) => {
        setSyncPulse(true);
        setTimeout(() => setSyncPulse(false), 900);
        const currentUserName = currentUser?.fullName || currentUser?.name || 'مدیر کلینیک';
        if (ev.type === 'DATA_MUTATED' && ev.actorName !== currentUserName) {
          setLiveSyncToast(`سینک آنی از ${ev.actorName} (${ROLE_LABELS[ev.actorRole as UserRole] || 'کاربر'})`);
          setTimeout(() => setLiveSyncToast(null), 3500);
        } else if (ev.type === 'BACKUP_COMPLETED') {
          setLiveSyncToast(`بک‌آپ ابری خودکار توسط ${ev.actorName} انجام شد`);
          setTimeout(() => setLiveSyncToast(null), 3500);
        }
      },
      onOtaUpdate: (ota) => {
        if (ota.version && ota.version !== CURRENT_APP_VERSION) {
          setOtaUpdateInfo(ota);
          setUpdateAvailable(true);
          setLiveSyncToast(`نسخه جدید (${ota.version}) آماده بروزرسانی است`);
        }
      },
      onPresenceChange: (onlineUsers) => {
        setOnlinePeersCount(Math.max(1, onlineUsers.length));
      },
    });
    return cleanup;
  }, [currentUser?.fullName, currentUser?.name]);

  // Periodic Auto-Check for remote build updates every 30 seconds
  useEffect(() => {
    const checkTimer = setInterval(async () => {
      try {
        const res = await checkForAppUpdates();
        if (res.updateAvailable && res.latestBuild > CURRENT_APP_BUILD) {
          setUpdateAvailable(true);
          setOtaUpdateInfo({
            version: res.latestVersion,
            releaseNotes: res.releaseNotes,
            publishedBy: 'مدیریت کلینیک',
          });
        }
      } catch {
        // ignore
      }
    }, 30000);

    return () => clearInterval(checkTimer);
  }, []);

  // Listen to App-Wide Zero-Delete / RBAC / Offline Guardian events (TRC-MINA-GUARD-9007-G)
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
    const onQueueChanged = () => {
      setOfflineQueueCount(getOfflineQueue().length);
    };
    const onBackOnline = async () => {
      const count = getOfflineQueue().length;
      if (count > 0) {
        setFlushingQueue(true);
        const res = await processOfflineQueue();
        const remaining = getOfflineQueue().length;
        setFlushingQueue(false);
        setOfflineQueueCount(remaining);
        if (res.processed > 0) {
          setLiveSyncToast(`${res.processed.toLocaleString('fa-IR')} تغییر آفلاین با موفقیت به Cloud SQL ارسال شد`);
          setTimeout(() => setLiveSyncToast(null), 4000);
        }
      }
    };
    const onTableMutated = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      if (!detail?.table || !detail?.operation) return;
      const rawPayload = Array.isArray(detail.payload) ? detail.payload[0] : detail.payload || {};
      const patientObj = patients.find(p => p.id === rawPayload?.patient_id);
      const resolvedPatientName =
        rawPayload?.patient_name ||
        (patientObj ? `${patientObj.first_name || ''} ${patientObj.last_name || ''}`.trim() : '') ||
        'بیمار کلینیک';

      if (detail.table === 'appointments' && detail.operation === 'INSERT') {
        const apptDate = rawPayload?.appointment_date ? toJalaliStr(rawPayload.appointment_date) : toJalaliStr(todayGregorian());
        const apptTime = rawPayload?.appointment_time || '—';
        const serviceType = rawPayload?.service_type || rawPayload?.title || 'ویزیت و معاینه تخصصی';
        const docName = rawPayload?.doctor_name || 'دکتر مهدی امیری';
        playTactileFeedback('success');
        setSmartWorkflowPopup({
          id: `wf_appt_${Date.now()}`,
          type: 'appointment_booked',
          title: 'نوبت جدید بیمار ثبت شد',
          subtitle: 'اطلاع‌رسانی آنی جهت آماده‌سازی یونیت و طرح درمان',
          targetRolesLabel: 'ویژه پزشک معالج و مدیر کلینیک',
          patientName: resolvedPatientName,
          doctorName: docName,
          detailLine: `خدمت: ${serviceType} • زمان: ${apptDate} ساعت ${apptTime}`,
          actorName: detail.actor || 'پذیرش کلینیک',
          timestamp: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
        });
        if (isDeviceNotificationsEnabled()) {
          sendRealDeviceNotification({
            title: `نوبت جدید: ${resolvedPatientName}`,
            body: `${serviceType} • پزشک: ${docName} • ساعت ${apptTime}`,
            tag: `minadental-appt-${Date.now()}`,
          }).catch(() => {});
        }
      } else if (detail.table === 'treatments' && (detail.operation === 'INSERT' || detail.operation === 'UPDATE')) {
        const toothNum = rawPayload?.tooth_number ? `دندان شماره ${rawPayload.tooth_number}` : 'چارت عمومی';
        const treatType = rawPayload?.treatment_type || rawPayload?.description || 'درمان تخصصی دندانپزشکی';
        const docName = rawPayload?.doctor_name || detail.actor || 'دکتر مهدی امیری';
        const costVal = Number(rawPayload?.cost || rawPayload?.final_cost || 0);
        playTactileFeedback('success');
        setSmartWorkflowPopup({
          id: `wf_treat_${Date.now()}`,
          type: 'treatment_completed',
          title: 'ثبت / تکمیل درمان توسط پزشک (ضد فراموشی)',
          subtitle: 'جهت تسویه‌حساب، تقسیط، چک، لابراتوار یا تعیین نوبت جلسه بعد اقدام کنید',
          targetRolesLabel: 'ویژه منشی، دستیار و مدیر کلینیک',
          patientName: resolvedPatientName,
          doctorName: docName,
          detailLine: `${treatType} • ${toothNum}`,
          amountLine: costVal > 0 ? `${costVal.toLocaleString('fa-IR')} تومان` : undefined,
          actorName: detail.actor || docName,
          timestamp: new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
        });
        if (isDeviceNotificationsEnabled()) {
          sendRealDeviceNotification({
            title: `درمان ثبت شد: ${resolvedPatientName}`,
            body: `${treatType} (${toothNum}) توسط ${docName} — آماده اقدام مالی و نوبت بعدی`,
            tag: `minadental-treat-${Date.now()}`,
          }).catch(() => {});
        }
      }
    };

    window.addEventListener('minadental-guardian-toast', onGuardianToast);
    window.addEventListener('minadental-offline-queue-changed', onQueueChanged);
    window.addEventListener('minadental-table-mutated', onTableMutated);
    window.addEventListener('online', onBackOnline);
    return () => {
      if (toastTimer) clearTimeout(toastTimer);
      window.removeEventListener('minadental-guardian-toast', onGuardianToast);
      window.removeEventListener('minadental-offline-queue-changed', onQueueChanged);
      window.removeEventListener('minadental-table-mutated', onTableMutated);
      window.removeEventListener('online', onBackOnline);
    };
  }, [patients]);

  const handleFlushOfflineQueue = async () => {
    if (flushingQueue) return;
    setFlushingQueue(true);
    const res = await processOfflineQueue();
    const remaining = getOfflineQueue().length;
    setFlushingQueue(false);
    setOfflineQueueCount(remaining);
    if (res.processed > 0) {
      setLiveSyncToast(`${res.processed.toLocaleString('fa-IR')} تغییر صف آفلاین با موفقیت همگام‌سازی شد`);
      setTimeout(() => setLiveSyncToast(null), 4000);
    } else if (remaining > 0) {
      setGuardianToast({
        message: `اتصال به Cloud SQL برقرار نشد؛ ${remaining.toLocaleString('fa-IR')} تغییر همچنان در صف امن محفوظ است.`,
        severity: 'offline',
        traceId: 'TRC-MINA-GUARD-9007-G',
      });
    }
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setSyncPulse(true);
      setTimeout(() => setSyncPulse(false), 600);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      (window as any).__deferredInstallPrompt = e;
      setDeferredPrompt(e);
    };
    const handleInstallReady = () => {
      if ((window as any).__deferredInstallPrompt) {
        setDeferredPrompt((window as any).__deferredInstallPrompt);
      }
    };
    const handleInstalled = () => {
      setDeferredPrompt(null);
      setLiveSyncToast('برنامه مینادنتال با موفقیت روی دستگاه شما نصب شد');
      setTimeout(() => setLiveSyncToast(null), 3500);
    };
    if ((window as any).__deferredInstallPrompt) {
      setDeferredPrompt((window as any).__deferredInstallPrompt);
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('minadental:install-ready', handleInstallReady);
    window.addEventListener('minadental:installed', handleInstalled);

    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        const updateInterval = setInterval(() => {
          reg.update().catch(() => {});
        }, 15000);

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          }
        });

        return () => clearInterval(updateInterval);
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('minadental:install-ready', handleInstallReady);
      window.removeEventListener('minadental:installed', handleInstalled);
    };
  }, []);

  const handleApplyUpdate = async () => {
    try {
      if ('caches' in window) {
        const names = await window.caches.keys();
        await Promise.all(names.map(n => window.caches.delete(n)));
      }
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(reg => reg.unregister()));
      }
      try {
        sessionStorage.clear();
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
    const url = new URL(window.location.href);
    url.searchParams.set('ota_instant_sync', Date.now().toString());
    window.location.replace(url.toString());
  };

  const handleTriggerInstall = async () => {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice?.outcome === 'accepted') {
          setLiveSyncToast('برنامه مینادنتال با موفقیت روی دستگاه شما نصب شد');
          setTimeout(() => setLiveSyncToast(null), 3000);
          setDeferredPrompt(null);
          return;
        }
      } catch {
        // fallback to install modal
      }
    }
    setInstallModalOpen(true);
  };

  useEffect(() => {
    const onResize = () => setPlatformInfo(getCurrentPlatformInfo());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShortcutsOpen(prev => !prev);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.key === 'F1') { e.preventDefault(); setShortcutsOpen(prev => !prev); }
      else if (e.key === 'F2') { e.preventDefault(); setActive('patients'); }
      else if (e.key === 'F3') { e.preventDefault(); setActive('appointments'); }
      else if (e.key === 'F4') { e.preventDefault(); setActive('treatments'); }
      else if (e.key === 'F5') { e.preventDefault(); setActive('dashboard'); }
      else if (e.key === 'F6') { e.preventDefault(); setActive('finance'); }
      else if (e.key === 'F7') { e.preventDefault(); setActive('implants'); }
      else if (e.key === 'F8') { e.preventDefault(); setActive('lab'); }
      else if (e.key === 'F9') { e.preventDefault(); setActive('calendar'); }
      else if (e.key === 'Escape') {
        setNotifOpen(false);
        setShortcutsOpen(false);
        setProjectFolderOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    sectionRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [active]);

  const handleSync = async () => {
    setSyncing(true);
    await performAutomaticCloudAndLocalBackup();
    setLiveSyncToast('بک‌آپ ابری و همگام‌سازی زنده بین تمام پلتفرم‌ها انجام شد');
    setTimeout(() => {
      setSyncing(false);
      setTimeout(() => setLiveSyncToast(null), 2500);
    }, 1200);
  };

  const handleSwitchUser = (u: ClinicUserAccount) => {
    setCurrentUser(u);
    saveActiveUser(u);
    setLiveSyncToast(`ورود به حساب: ${u.name} (${ROLE_LABELS[u.role]})`);
    setTimeout(() => setLiveSyncToast(null), 3000);
  };

  const handleAddNewUser = () => {
    if (!newUserForm.name.trim()) return;
    const colors: Record<UserRole, string> = {
      manager: '#8B5CF6',
      dentist: '#3B82F6',
      secretary: '#10B981',
      assistant: '#EC4899',
    };
    const created: ClinicUserAccount = {
      id: `user_${Date.now()}`,
      username: newUserForm.username.trim() || `${newUserForm.role}_${Date.now().toString().slice(-4)}`,
      fullName: newUserForm.name.trim(),
      name: newUserForm.name.trim(),
      role: newUserForm.role,
      roleLabel: ROLE_LABELS[newUserForm.role],
      email: newUserForm.email.trim() || 'user@minadental.ir',
      phone: newUserForm.phone.trim() || '09120000000',
      pinOrPass: newUserForm.pin || '1234',
      avatarColor: colors[newUserForm.role],
      canPublishUpdate: newUserForm.role === 'manager',
      permissions: {
        canEditPricesAfterSave: newUserForm.role === 'manager',
        canDeleteCriticalRecords: newUserForm.role === 'manager',
        canPublishOtaUpdate: newUserForm.role === 'manager',
        canManageBackups: newUserForm.role === 'manager',
        canManageStaffAndShares: newUserForm.role === 'manager',
      },
    };
    const updated = [...users, created];
    setUsers(updated);
    saveClinicUsers(updated);
    handleSwitchUser(created);
    setAddingNewUser(false);
    setNewUserForm({ name: '', username: '', role: 'secretary', email: '', phone: '', pin: '1234' });
  };

  const renderSection = () => {
    switch (active) {
      case 'dashboard': return <Dashboard onNavigate={setActive} onOpenInstall={handleTriggerInstall} />;
      case 'patients': return <Patients />;
      case 'appointments': return <Appointments />;
      case 'calendar': return <CalendarSection onNavigate={setActive} />;
      case 'treatments': return <Treatments />;
      case 'lab': return <Lab />;
      case 'implants': return <Implants />;
      case 'finance': return <Finance />;
      case 'inventory': return <Inventory />;
      case 'reminders': return <Reminders />;
      case 'staff': return <StaffSection />;
      case 'messages': return <Messages />;
      case 'settings':
        return (
          <SettingsSection
            onOpenRoadmapAudit={() => setRoadmapModalOpen(true)}
            onOpenInstall={handleTriggerInstall}
          />
        );
      default: return <Dashboard onNavigate={setActive} onOpenInstall={handleTriggerInstall} />;
    }
  };

  return (
    <div className={`min-h-screen relative ${section.themeClass}`}>

      <div className="gemini-bg">
        <div
          className="gemini-orb gemini-orb-1"
          style={{ background: `radial-gradient(circle, ${section.color} 0%, transparent 72%)` }}
        />
        <div
          className="gemini-orb gemini-orb-2"
          style={{ background: `radial-gradient(circle, #ffffff 0%, ${section.orbSecondary}99 40%, transparent 74%)` }}
        />
        <div
          className="gemini-orb gemini-orb-3"
          style={{ background: `radial-gradient(circle, ${section.lightColor} 0%, ${section.color}CC 46%, transparent 72%)` }}
        />
        <div className="gemini-orb gemini-orb-4" />
      </div>

      <div className="section-glow" style={{ background: section.color }} />

      {/* Adaptive RTL Navigation Rail (iPad) & Full Sidebar (Windows/Mac Desktop) */}
      <DesktopSidebar
        active={active}
        onChange={handleNavigate}
        mascotMood={mascotMood}
        currentUser={currentUser}
        platformInfo={platformInfo}
        onOpenUserModal={() => setUserModalOpen(true)}
        onOpenProjectFolder={() => setProjectFolderOpen(true)}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />

      {/* Ultra-Clean Minimal Top Bar — Strictly 2 Action Icons (User Account + Project Folder) */}
      <header className={`fixed top-0 left-0 right-0 md:right-20 lg:right-64 z-30 px-2 md:px-4 pt-2 safe-top transition-transform duration-300 ${headerVisible ? 'translate-y-0' : '-translate-y-full'}`}>
        <div className="max-w-xl md:max-w-5xl xl:max-w-6xl mx-auto">
          <div
            className="glass-dark rounded-[22px] px-3.5 py-2 flex items-center justify-between"
            style={{
              boxShadow: '0 8px 28px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,0.10)',
            }}
          >
            {/* Right Side (RTL Start): Mascot Logo + Brand Name + Active User */}
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="cursor-pointer shrink-0 transition-transform active:scale-95 md:hidden"
                onClick={() => {
                  playTactileFeedback('tap');
                  handleNavigate('dashboard');
                }}
                title="مینادنتال - خانه"
              >
                <MascotTooth mood={mascotMood} size={40} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h1 className="text-sm font-black text-white leading-tight truncate">
                    <span className="md:hidden">مینادنتال</span>
                    <span className="hidden md:inline">{section.label}</span>
                  </h1>
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-md text-white truncate max-w-[130px]"
                    style={{ background: `${currentUser?.avatarColor || '#8B5CF6'}CC` }}
                  >
                    {currentUser?.fullName || currentUser?.name || 'دکتر مهدی امیری'}
                  </span>
                </div>
                <p className="text-[10px] text-purple-200/75 leading-tight truncate">
                  {platformInfo.labelFa} • {onlinePeersCount.toLocaleString('fa-IR')} دستگاه آنلاین • سینک زنده
                </p>
              </div>
            </div>

            {/* Left Side (RTL End): ONLY 2 Clean Circular QBank Buttons (Account + Project Folder) */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* 1. User Account, Username/Password & Role Switcher */}
              <button
                className="topbar-btn relative bg-white/10 hover:bg-white/15 border border-white/15"
                onClick={() => {
                  playTactileFeedback('tap');
                  setUserModalOpen(true);
                }}
                aria-label="حساب کاربری و مدیریت دسترسی"
                title={`${currentUser?.fullName || 'دکتر مهدی امیری'} (${ROLE_LABELS[currentUser?.role || 'manager']})`}
                data-testid="topbar_user_avatar_button"
              >
                <User size={18} className="text-purple-200" />
                <span
                  className="absolute bottom-1 right-1 w-2 h-2 rounded-full border border-slate-900"
                  style={{ background: currentUser?.avatarColor || '#8B5CF6' }}
                />
              </button>

              {/* 2. Project Folder (Houses Caller-ID, PWA Install, 8-Phase Super-Audit, Sync & iOS Haptics) */}
              <button
                className="topbar-btn relative bg-white/10 hover:bg-white/15 border border-white/15"
                onClick={() => {
                  playTactileFeedback('tap');
                  setProjectFolderOpen(true);
                }}
                aria-label="پوشه پروژه مینادنتال"
                title="پوشه برنامه: کالرآیدی، نصب روی آیفون/اندروید/آیپد/ویندوز، وضعیت سیستم و سینک"
                data-testid="topbar_project_folder_button"
              >
                <FolderKanban size={18} className="text-amber-300" />
                {syncPulse && (
                  <span className="absolute bottom-1 right-1 w-2 h-2 rounded-full bg-emerald-400" />
                )}
              </button>
            </div>
          </div>

          {/* Floating Status Banners — Automatically FADE OUT / HIDE whenever Reminder Drawer is Open */}
          {!notifOpen && (
            <>
              {/* Real-Time Multi-User Cloud Sync Toast */}
              {liveSyncToast && (
                <div className="mt-2 px-3 py-2 rounded-2xl bg-slate-900/95 border border-emerald-400/40 text-emerald-300 text-xs font-bold flex items-center justify-center gap-2 shadow-xl animate-fade-in">
                  <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                  <span>{liveSyncToast}</span>
                </div>
              )}

              {/* App-Wide Zero-Delete / RBAC / Offline Guardian Toast (TRC-MINA-GUARD-9007-G) */}
              {guardianToast && (
                <div
                  data-testid="guardian_security_toast"
                  className={`mt-2 px-3 py-2.5 rounded-2xl text-xs font-bold flex items-center justify-between gap-2 shadow-xl border animate-fade-in ${
                    guardianToast.severity === 'security'
                      ? 'bg-rose-950/95 border-rose-400/50 text-rose-100'
                      : guardianToast.severity === 'offline'
                      ? 'bg-amber-950/95 border-amber-400/50 text-amber-100'
                      : 'bg-emerald-950/95 border-emerald-400/50 text-emerald-100'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {guardianToast.severity === 'security' ? (
                      <ShieldAlert size={16} className="text-rose-400 shrink-0" />
                    ) : guardianToast.severity === 'offline' ? (
                      <WifiOff size={16} className="text-amber-400 shrink-0" />
                    ) : (
                      <Archive size={16} className="text-emerald-400 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <span className="leading-snug block">{guardianToast.message}</span>
                      <span className="text-[9px] font-mono opacity-75">{guardianToast.traceId}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setGuardianToast(null)}
                    aria-label="بستن هشدار"
                    className="p-1 rounded-lg bg-white/10 hover:bg-white/20 shrink-0"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* Pending Offline Write-Ahead Queue Pill */}
              {offlineQueueCount > 0 && (
                <div
                  data-testid="offline_queue_pending_pill"
                  className="mt-2 px-3 py-2 rounded-2xl bg-amber-950/90 border border-amber-400/45 text-amber-100 text-[11px] font-bold flex items-center justify-between gap-2 shadow-lg animate-fade-in"
                >
                  <div className="flex items-center gap-2">
                    <UploadCloud size={15} className="text-amber-300 shrink-0" />
                    <span>
                      {offlineQueueCount.toLocaleString('fa-IR')} تغییر در صف آفلاین آماده ارسال به Cloud SQL است
                    </span>
                  </div>
                  <button
                    onClick={handleFlushOfflineQueue}
                    disabled={flushingQueue}
                    data-testid="flush_offline_queue_button"
                    className="px-2.5 py-1 rounded-xl bg-amber-400 text-slate-950 font-black text-[10px] hover:bg-amber-300 active:scale-95 transition-all shrink-0 disabled:opacity-60"
                  >
                    {flushingQueue ? 'در حال ارسال...' : 'ارسال آنی'}
                  </button>
                </div>
              )}

              {/* Update Available / OTA Broadcast Floating Banner */}
              {updateAvailable && (
                <div className="mt-2 p-2.5 rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 text-white shadow-xl flex items-center justify-between border border-white/20 animate-fade-in">
                  <div className="flex items-center gap-2 text-xs font-bold min-w-0">
                    <Sparkles size={16} className="text-yellow-300 animate-spin shrink-0" />
                    <div className="truncate">
                      <span>آپدیت جدید ({otaUpdateInfo?.version || CURRENT_APP_VERSION}) منتشر شد</span>
                      {otaUpdateInfo?.releaseNotes && (
                        <span className="block text-[10px] text-purple-100 truncate">{otaUpdateInfo.releaseNotes}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={handleApplyUpdate}
                    className="px-3 py-1.5 rounded-xl bg-white text-purple-900 font-extrabold text-xs shadow hover:bg-white/90 active:scale-95 transition-all shrink-0"
                  >
                    نصب و بروزرسانی آنی
                  </button>
                </div>
              )}
            </>
          )}

          {/* Shortcuts Panel */}
          {shortcutsOpen && (
            <div className="max-w-lg mx-auto mt-2 glass-dark rounded-3xl p-4 notif-panel animate-scale-in" style={{ scrollbarWidth: 'none' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Keyboard size={16} className="text-blue-300" />
                  <h3 className="text-sm font-bold text-white">کلیدهای میانبر سریع کلینیک</h3>
                </div>
                <button onClick={() => setShortcutsOpen(false)} className="topbar-btn">
                  <X size={16} className="text-gray-400" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { key: 'F1', desc: 'راهنمای کلیدها' },
                  { key: 'F2', desc: 'پرونده بیماران' },
                  { key: 'F3', desc: 'سیستم نوبت‌دهی' },
                  { key: 'F4', desc: 'طرح‌های درمانی' },
                  { key: 'F5', desc: 'داشبورد مدیریتی' },
                  { key: 'F6', desc: 'امور مالی و شخصی' },
                  { key: 'F7', desc: 'پرونده ایمپلنت' },
                  { key: 'F8', desc: 'سفارشات لابراتوار' },
                  { key: 'F9', desc: 'تقویم دائمی فارسی' },
                  { key: 'Esc', desc: 'بستن پنجره‌ها' },
                ].map(sc => (
                  <div key={sc.key} className="flex items-center justify-between bg-white/5 rounded-xl px-2.5 py-1.5 border border-white/10">
                    <span className="text-gray-300 text-[11px]">{sc.desc}</span>
                    <span className="font-mono font-bold text-cyan-300 bg-cyan-950/60 px-1.5 py-0.5 rounded text-[10px] border border-cyan-500/30">
                      {sc.key}
                    </span>
                  </div>
                ))}
              </div>
              <div className="pt-2.5 border-t border-white/10 mt-3">
                <button
                  onClick={() => {
                    exportClinicBackupToJson(`MinaDental_Backup_${new Date().toISOString().slice(0, 10)}`, {
                      reminders,
                      messages,
                      exportedAt: new Date().toISOString(),
                      app: 'MinaDental',
                      version: CURRENT_APP_VERSION,
                    });
                  }}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-2xl bg-cyan-600/90 hover:bg-cyan-600 text-white text-xs font-bold transition-all shadow-md active:scale-95"
                >
                  <Download size={14} />
                  دانلود فایل پشتیبان آفلاین کلینیک (JSON)
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Full-Screen User Account, Role Access & OTA Sync Modal (باز شدن با کلیک روی آدمک داک بالا) */}
      <Sheet
        open={userModalOpen}
        onClose={() => { setUserModalOpen(false); setAddingNewUser(false); }}
        title="مدیریت حساب کاربری، سطوح دسترسی و سینک ابری"
        icon={<User size={20} />}
        color="#8B5CF6"
      >
        <div className="space-y-4">
          {/* Active Logged-In User Hero Card */}
          <div
            className="rounded-3xl p-4 text-white shadow-lg"
            style={{ background: `linear-gradient(135deg, ${currentUser?.avatarColor || '#8B5CF6'}, #1E1B4B)` }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center font-black text-lg">
                  {(currentUser?.fullName || currentUser?.name || 'د')[0]}
                </div>
                <div>
                  <h3 className="text-base font-black">{currentUser?.fullName || currentUser?.name || 'دکتر مهدی امیری'}</h3>
                  <p className="text-xs text-purple-100">{ROLE_LABELS[currentUser?.role || 'manager'] || 'مدیر کلینیک'}</p>
                  <p className="text-[11px] text-purple-200/80 mt-0.5" dir="ltr">{currentUser?.email || ''} • {currentUser?.phone || ''}</p>
                </div>
              </div>
              <Badge color="#FFFFFF" bg="rgba(255,255,255,0.2)">فعال</Badge>
            </div>
            <div className="mt-3 pt-2.5 border-t border-white/15 flex flex-wrap gap-1.5">
              {(ROLE_PERMISSIONS[currentUser?.role || 'manager'] || []).map(perm => (
                <span key={perm} className="text-[10px] font-bold bg-white/15 px-2 py-0.5 rounded-lg">
                  ✓ {perm}
                </span>
              ))}
            </div>
          </div>

          {/* Instant Cloud Backup & OTA Update Broadcast for Manager */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              onClick={handleSync}
              className="py-2.5 px-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm haptic"
            >
              <Cloud size={15} />
              سینک و بک‌آپ ابری فوری همه دستگاه‌ها
            </button>
            {(currentUser?.canPublishUpdate || currentUser?.role === 'manager') && (
              <button
                onClick={async () => {
                  await publishOtaUpdateToAllUsers(
                    CURRENT_APP_VERSION,
                    `بروزرسانی سراسری توسط ${currentUser?.fullName || currentUser?.name || 'مدیر کلینیک'}`
                  );
                  setLiveSyncToast('فرمان آپدیت اتوماتیک روی برنامه تمام کاربران ارسال شد');
                  setTimeout(() => setLiveSyncToast(null), 3500);
                }}
                className="py-2.5 px-3 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 shadow-sm haptic"
              >
                <RefreshCw size={15} />
                انتشار آپدیت اتوماتیک (OTA) به همه
              </button>
            )}
          </div>

          {/* Switch Between Clinic Accounts (Manager, Dentist, Secretary, Assistant) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5">
                <ShieldCheck size={15} className="text-purple-600" />
                تغییر کاربر فعال یا ورود با اکانت دیگر (سینک آنی Supabase)
              </h4>
              <button
                onClick={() => setAddingNewUser(!addingNewUser)}
                className="px-2.5 py-1.5 rounded-xl bg-purple-100 text-purple-700 text-[11px] font-extrabold flex items-center gap-1 haptic"
              >
                <Plus size={13} /> افزودن کاربر جدید
              </button>
            </div>

            {addingNewUser && (
              <div className="rounded-2xl border-2 border-purple-200 bg-purple-50/50 p-3.5 space-y-3">
                <h5 className="text-xs font-black text-purple-900">تعریف اکانت جدید پرسنل / پزشک</h5>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="نام و نام خانوادگی">
                    <Input
                      value={newUserForm.name}
                      onChange={e => setNewUserForm({ ...newUserForm, name: e.target.value })}
                      placeholder="مثلاً دکتر رضا محمدی"
                    />
                  </Field>
                  <Field label="نقش و سطح دسترسی">
                    <Select
                      value={newUserForm.role}
                      onChange={e => setNewUserForm({ ...newUserForm, role: e.target.value as UserRole })}
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
                  <Field label="نام کاربری اختصاصی (Username)">
                    <Input
                      value={newUserForm.username}
                      onChange={e => setNewUserForm({ ...newUserForm, username: e.target.value })}
                      placeholder="مثلاً dr.mohammadi"
                      dir="ltr"
                      className="text-left font-mono"
                    />
                  </Field>
                  <Field label="رمز عبور / پین ورود">
                    <Input
                      type="password"
                      value={newUserForm.pin}
                      onChange={e => setNewUserForm({ ...newUserForm, pin: e.target.value })}
                      placeholder="حداقل ۴ رقم"
                      dir="ltr"
                      className="text-left font-mono"
                    />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="جیمیل (جهت سینک ابری)">
                    <Input
                      value={newUserForm.email}
                      onChange={e => setNewUserForm({ ...newUserForm, email: e.target.value })}
                      placeholder="example@gmail.com"
                    />
                  </Field>
                  <Field label="شماره موبایل">
                    <Input
                      value={newUserForm.phone}
                      onChange={e => setNewUserForm({ ...newUserForm, phone: e.target.value })}
                      placeholder="0912..."
                    />
                  </Field>
                </div>
                <Button color="#8B5CF6" className="w-full" onClick={handleAddNewUser}>
                  ثبت کاربر و همگام‌سازی آنی ابری و لوکال
                </Button>
              </div>
            )}

            <div className="space-y-2">
              {users.map(u => {
                const isCurr = u.id === currentUser.id;
                return (
                  <div
                    key={u.id}
                    onClick={() => handleSwitchUser(u)}
                    className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                      isCurr
                        ? 'bg-purple-50 border-purple-400 shadow-sm'
                        : 'bg-white border-gray-100 hover:border-purple-200'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-10 h-10 rounded-2xl text-white font-black flex items-center justify-center shrink-0"
                        style={{ background: u.avatarColor }}
                      >
                        {(u.fullName || u.name || 'ک')[0]}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-extrabold text-gray-800 truncate">{u.fullName || u.name || 'کاربر'}</p>
                        <p className="text-[11px] text-gray-500 truncate">{ROLE_LABELS[u.role]}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isCurr ? (
                        <Badge color="#7C3AED" bg="#EDE9FE">کاربر فعلی</Badge>
                      ) : (
                        <span className="text-xs font-bold text-purple-600 flex items-center gap-1">
                          <LogOut size={13} /> سوییچ
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </Sheet>

      {/* Project Folder Sheet (پوشه پروژه — ابزارهای جانبی بدون شلوغ کردن داک بالا) */}
      <Sheet
        open={projectFolderOpen}
        onClose={() => setProjectFolderOpen(false)}
        title="پوشه پروژه مینادنتال"
        subtitle={`نسخه v${CURRENT_APP_VERSION} (بیلد #${CURRENT_APP_BUILD}) • تمام ابزارهای جانبی در یک جای تمیز`}
        icon={<FolderKanban size={20} />}
        color="#7C3AED"
      >
        <div className="space-y-3" data-testid="project_folder_sheet_content">
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => {
                playTactileFeedback('tap');
                setProjectFolderOpen(false);
                setCallerIdOpen(true);
              }}
              data-testid="folder_caller_id_btn"
              className="p-3.5 rounded-3xl bg-emerald-50 border border-emerald-200/80 text-right space-y-1.5 haptic shadow-sm"
            >
              <div className="w-10 h-10 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow">
                <PhoneIncoming size={19} />
              </div>
              <p className="text-xs font-black text-emerald-950">کالر آیدی هوشمند</p>
              <p className="text-[10px] text-emerald-700">تشخیص تماس بیمار و نوبت خودکار</p>
            </button>

            <button
              type="button"
              onClick={() => {
                playTactileFeedback('tap');
                setProjectFolderOpen(false);
                handleTriggerInstall();
              }}
              data-testid="folder_install_pwa_btn"
              className="p-3.5 rounded-3xl bg-purple-50 border border-purple-200/80 text-right space-y-1.5 haptic shadow-sm"
            >
              <div className="w-10 h-10 rounded-2xl bg-purple-600 text-white flex items-center justify-center shadow">
                <Download size={19} />
              </div>
              <p className="text-xs font-black text-purple-950">نصب روی گوشی، آیپد و ویندوز</p>
              <p className="text-[10px] text-purple-700">بسته نصب اندروید، آیفون، آیپد و دسکتاپ</p>
            </button>

            <button
              type="button"
              onClick={() => {
                playTactileFeedback('tap');
                setProjectFolderOpen(false);
                handleNavigate('settings');
              }}
              data-testid="folder_settings_shortcut_btn"
              className="p-3.5 rounded-3xl bg-indigo-50 border border-indigo-200/80 text-right space-y-1.5 haptic shadow-sm"
            >
              <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow">
                <Keyboard size={19} />
              </div>
              <p className="text-xs font-black text-indigo-950">تنظیمات و دانلود نسخه‌ها</p>
              <p className="text-[10px] text-indigo-700">تعرفه‌ها، بکاپ ابری و مدیریت نسخه</p>
            </button>

            <button
              type="button"
              onClick={() => {
                playTactileFeedback('tap');
                handleSync();
              }}
              data-testid="folder_cloud_sync_btn"
              className="p-3.5 rounded-3xl bg-sky-50 border border-sky-200/80 text-right space-y-1.5 haptic shadow-sm"
            >
              <div className="w-10 h-10 rounded-2xl bg-sky-600 text-white flex items-center justify-center shadow">
                <Cloud size={19} className={syncing ? 'animate-pulse' : ''} />
              </div>
              <p className="text-xs font-black text-sky-950">سینک ابری و لوکال آنی</p>
              <p className="text-[10px] text-sky-700">پشتیبان ابری + گاوصندوق ضدحذف</p>
            </button>
          </div>

          {/* Tactile Haptics & Soft Acoustic Click Toggles */}
          <div className="rounded-3xl bg-slate-50 border border-slate-200/80 p-3.5 space-y-2.5">
            <h4 className="text-xs font-black text-slate-800">تنظیمات بازخورد لمسی و صدای کلیک</h4>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="toggle_ios_haptics_btn"
                onClick={() => {
                  const next = !hapticsOn;
                  setHapticsOn(next);
                  setHapticsEnabled(next);
                  if (next) playTactileFeedback('tap');
                }}
                className={`p-2.5 rounded-2xl border text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                  hapticsOn ? 'bg-violet-600 text-white border-violet-600 shadow' : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                <Vibrate size={15} />
                <span>هپتیک لمسی: {hapticsOn ? 'روشن' : 'خاموش'}</span>
              </button>
              <button
                type="button"
                data-testid="toggle_ios_sound_btn"
                onClick={() => {
                  const next = !soundOn;
                  setSoundOn(next);
                  setSoundEnabled(next);
                  if (next) playTactileFeedback('success');
                }}
                className={`p-2.5 rounded-2xl border text-xs font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                  soundOn ? 'bg-indigo-600 text-white border-indigo-600 shadow' : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                <Volume2 size={15} />
                <span>صدای کلیک نرم: {soundOn ? 'روشن' : 'خاموش'}</span>
              </button>
            </div>
          </div>
        </div>
      </Sheet>

      {/* Right-Edge Draggable QBank Notification Ear Handle (Locks permanently wherever dropped) */}
      <DraggableNotificationHandle
        notifCount={notifCount}
        open={notifOpen}
        onOpen={() => setNotifOpen(true)}
      />

      {/* World-Class iOS Right-Side Slide-Over Notification & Smart Reminder Drawer */}
      {notifOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-start"
          onClick={() => {
            playTactileFeedback('soft');
            setNotifOpen(false);
          }}
          data-testid="slide_over_notification_drawer"
        >
          <div className="absolute inset-0 bg-slate-950/55 backdrop-blur-sm animate-fade-in" />
          <aside
            className="relative w-full max-w-sm h-full glass-dark border-l border-white/15 p-4 flex flex-col drawer-slide-in-right safe-top safe-bottom"
            onClick={e => e.stopPropagation()}
            style={{ boxShadow: '-12px 0 45px rgba(0,0,0,0.5)' }}
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center text-white shadow-lg">
                  <BellRing size={18} className="bell-swing" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white">رادار هوشمند یادآوری و اعلان‌ها</h3>
                  <p className="text-[10px] text-amber-200/80">
                    {notifCount.toLocaleString('fa-IR')} هشدار فعال در کل بخش‌های مطب
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  playTactileFeedback('soft');
                  setNotifOpen(false);
                }}
                aria-label="بستن یادآوری‌ها"
                className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all"
              >
                <X size={16} />
              </button>
            </div>

            {/* Real OS Device Notification Bridge (اتصال به نوتیفیکیشن واقعی گوشی) */}
            <div className="mt-2.5 p-2.5 rounded-2xl bg-white/8 border border-white/12 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Smartphone size={15} className={deviceNotifOn ? 'text-emerald-400 shrink-0' : 'text-amber-300 shrink-0'} />
                <div className="min-w-0">
                  <p className="text-[11px] font-extrabold text-white truncate">
                    {deviceNotifOn ? 'متصل به نوتیفیکیشن واقعی گوشی' : 'اتصال به اعلان واقعی گوشی'}
                  </p>
                  <p className="text-[9.5px] text-gray-300 truncate">
                    {deviceNotifPerm === 'denied'
                      ? 'مجوز اعلان در مرورگر مسدود است'
                      : deviceNotifOn
                      ? 'یادآوری چک، قسط، ایمپلنت و نوبت روی گوشی ارسال می‌شود'
                      : 'نمایش هشدارهای حیاتی در نوار اعلان گوشی'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {deviceNotifOn ? (
                  <>
                    <button
                      type="button"
                      data-testid="test_real_device_notif_btn"
                      onClick={async () => {
                        playTactileFeedback('success');
                        await sendRealDeviceNotification({
                          title: 'مینادنتال • تست اعلان واقعی گوشی',
                          body: `رادار هوشمند با ${notifCount.toLocaleString('fa-IR')} هشدار فعال به نوتیفیکیشن گوشی متصل است.`,
                          tag: `minadental-test-${Date.now()}`,
                        });
                      }}
                      className="px-2 py-1 rounded-xl bg-emerald-500 text-slate-950 text-[10px] font-black"
                    >
                      تست
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeviceNotificationsEnabled(false);
                        setDeviceNotifOn(false);
                      }}
                      className="px-2 py-1 rounded-xl bg-white/10 text-gray-200 text-[10px] font-bold"
                    >
                      خاموش
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    data-testid="enable_real_device_notif_btn"
                    onClick={async () => {
                      playTactileFeedback('tap');
                      const perm = await requestDeviceNotificationPermission();
                      setDeviceNotifPerm(perm);
                      const enabled = perm === 'granted';
                      setDeviceNotifOn(enabled);
                      if (enabled) {
                        await sendRealDeviceNotification({
                          title: 'مینادنتال متصل شد',
                          body: 'یادآوری‌های کلینیک از این پس روی نوتیفیکیشن واقعی گوشی نمایش داده می‌شوند.',
                          tag: 'minadental-connected',
                        });
                      }
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 text-slate-950 text-[10px] font-black"
                  >
                    فعال‌سازی
                  </button>
                )}
              </div>
            </div>

            {/* Category Filter Chips inside Slide-Over Drawer */}
            <div className="flex items-center gap-1.5 py-2.5 overflow-x-auto no-scrollbar">
              {[
                { id: 'all' as const, label: 'همه بخش‌ها', count: liveSmartAlerts.length },
                {
                  id: 'finance' as const,
                  label: 'چک، قسط و بدهی',
                  count: liveSmartAlerts.filter(a => a.domain === 'check' || a.domain === 'safteh' || a.domain === 'installment' || a.domain === 'debt').length,
                },
                {
                  id: 'clinical' as const,
                  label: 'ایمپلنت و لابراتوار',
                  count: liveSmartAlerts.filter(a => a.domain === 'implant' || a.domain === 'lab').length,
                },
                {
                  id: 'ops' as const,
                  label: 'نوبت و انبار',
                  count: liveSmartAlerts.filter(a => a.domain === 'appointment' || a.domain === 'inventory').length,
                },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setDrawerTab(tab.id)}
                  className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap transition-all ${
                    drawerTab === tab.id
                      ? 'bg-gradient-to-r from-amber-500 to-rose-500 text-white shadow-md'
                      : 'bg-white/10 text-gray-300 hover:bg-white/15'
                  }`}
                >
                  {tab.label} ({tab.count.toLocaleString('fa-IR')})
                </button>
              ))}
            </div>

            {/* Live Smart Alerts List */}
            <div className="flex-1 overflow-y-auto space-y-2 py-1 pr-0.5">
              {filteredDrawerAlerts.length === 0 && pendingReminders.length === 0 && unreadMessages.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-sm text-gray-300 font-bold">هیچ هشدار یا یادآوری فعالی وجود ندارد</p>
                  <p className="text-xs text-gray-500 mt-1">تمامی بخش‌های کلینیک در وضعیت پایدار هستند</p>
                </div>
              ) : (
                <>
                  {filteredDrawerAlerts.map(alert => {
                    const isCritical = alert.urgency === 'critical';
                    const isToday = alert.urgency === 'today';
                    const dotColor = isCritical ? '#EF4444' : isToday ? '#F59E0B' : '#38BDF8';
                    return (
                      <button
                        key={alert.id}
                        onClick={() => {
                          setActive(alert.targetSection);
                          setNotifOpen(false);
                        }}
                        className="w-full text-right rounded-2xl bg-white/8 hover:bg-white/15 border border-white/10 p-3 transition-all active:scale-98"
                      >
                        <div className="flex items-start gap-2.5">
                          <div
                            className="w-2.5 h-2.5 rounded-full mt-1 shrink-0"
                            style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-xs font-extrabold text-white truncate">
                                {alert.title}
                              </span>
                              <span className="text-[10px] text-amber-300 shrink-0 font-semibold">
                                {toJalaliStr(alert.dueDate)}
                              </span>
                            </div>
                            <p className="text-[11px] text-gray-300/90 mt-1 leading-relaxed line-clamp-2">
                              {alert.subtitle}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {unreadMessages.slice(0, 5).map(m => (
                    <button
                      key={m.id}
                      onClick={() => {
                        setActive('messages');
                        setNotifOpen(false);
                      }}
                      className="w-full text-right rounded-2xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/20 p-3 transition-all"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-white truncate">پیام جدید: {m.subject}</p>
                          <p className="text-[10px] text-sky-200/80 truncate">{m.body?.slice(0, 50)}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>

            {/* Footer CTA to Open Full Smart Reminders Command Center */}
            <div className="pt-3 border-t border-white/10 mt-2">
              <button
                onClick={() => {
                  setActive('reminders');
                  setNotifOpen(false);
                }}
                className="w-full py-2.5 px-4 rounded-2xl bg-gradient-to-r from-rose-500 via-amber-500 to-orange-500 text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all"
              >
                <BellRing size={15} />
                <span>ورود به مرکز فرماندهی جامع یادآوری‌ها</span>
                <ArrowLeft size={14} />
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main content — adaptive for Phone, iPad (Rail) & Windows Desktop (Sidebar) */}
      <main
        ref={sectionRef}
        onScroll={handleScroll}
        className="fixed inset-0 md:right-20 lg:right-64 overflow-y-auto pt-[80px] pb-36 md:pb-12 px-2 md:px-5 desktop-scroll"
      >
        <div className="max-w-xl md:max-w-5xl xl:max-w-6xl mx-auto space-y-2.5">
          {!isOnline && (
            <div className="rounded-2xl bg-amber-600/95 text-white text-xs font-bold py-1.5 px-3 flex items-center justify-center gap-2 shadow-lg animate-pulse mb-2">
              <WifiOff size={15} />
              <span>حالت آفلاین (استفاده از حافظه محلی و کش PWA)</span>
            </div>
          )}
          <ErrorBoundary>
            <div key={active} className="animate-fade-in-up">
              {renderSection()}
            </div>
          </ErrorBoundary>
        </div>
      </main>

      <BottomDock active={active} onChange={handleNavigate} />

      {/* Smart Incoming Call Caller-ID & Auto-Booking Assistant Sheet */}
      <Sheet
        open={callerIdOpen}
        onClose={() => setCallerIdOpen(false)}
        title="کالر آیدی هوشمند و نوبت‌دهی خودکار هنگام تماس بیمار"
        icon={<PhoneIncoming size={20} />}
        color="#10B981"
      >
        {(() => {
          const cleanPhone = incomingPhone.replace(/\s+/g, '').trim();
          const matchedPatient = cleanPhone.length >= 4
            ? patients.find(p => p.phone && p.phone.replace(/\s+/g, '').includes(cleanPhone))
            : undefined;
          const pTreatments = matchedPatient ? treatments.filter(t => t.patient_id === matchedPatient.id) : [];

          const handleQuickBookExisting = async (pat: Patient) => {
            setCallerBookingBusy(true);
            await supabase.from('appointments').insert({
              patient_id: pat.id,
              title: `نوبت تلفنی: ${pat.first_name} ${pat.last_name}`,
              appointment_date: todayGregorian(),
              appointment_time: callerApptTime || '17:00',
              duration_min: 30,
              type: 'checkup',
              status: 'confirmed',
              notes: 'ثبت اتوماتیک از طریق کالر آیدی تماس ورودی',
            });
            setCallerBookingBusy(false);
            setCallerIdOpen(false);
            setLiveSyncToast(`نوبت فوری برای ${pat.first_name} ${pat.last_name} در ساعت ${callerApptTime} ثبت و سینک شد`);
            setTimeout(() => setLiveSyncToast(null), 3500);
            handleNavigate('appointments');
          };

          const handleQuickCreateAndBook = async () => {
            if (!callerNewFirstName.trim()) return;
            setCallerBookingBusy(true);
            const fileTag = `[پرونده: ${1001 + patients.length}]`;
            const { data: createdList } = await supabase.from('patients').insert({
              first_name: callerNewFirstName.trim(),
              last_name: callerNewLastName.trim() || 'بیمار جدید',
              phone: cleanPhone,
              insurance_number: String(1001 + patients.length),
              notes: `${fileTag} ثبت خودکار از تماس ورودی`,
              status: 'active',
            }).select();
            const newPat = Array.isArray(createdList) ? createdList[0] : null;
            await supabase.from('appointments').insert({
              patient_id: newPat?.id ?? null,
              title: `نوبت اول: ${callerNewFirstName.trim()} ${callerNewLastName.trim()}`,
              appointment_date: todayGregorian(),
              appointment_time: callerApptTime || '17:00',
              duration_min: 30,
              type: 'consultation',
              status: 'confirmed',
              notes: `تماس ورودی شماره ${cleanPhone}`,
            });
            setCallerBookingBusy(false);
            setCallerIdOpen(false);
            setCallerNewFirstName('');
            setCallerNewLastName('');
            setLiveSyncToast(`پرونده و نوبت فوری برای ${callerNewFirstName} ثبت و بین همه پلتفرم‌ها سینک شد`);
            setTimeout(() => setLiveSyncToast(null), 3500);
            handleNavigate('appointments');
          };

          return (
            <div className="space-y-4">
              <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0 animate-bounce">
                  <PhoneCall size={20} />
                </div>
                <div>
                  <h4 className="text-xs font-black text-emerald-900">تشخیص هوشمند شماره تماس بیمار</h4>
                  <p className="text-[10.5px] text-emerald-700 mt-0.5">
                    شماره تماس ورودی را وارد کنید یا از لیست تماس‌های اخیر انتخاب نمایید تا پرونده بیمار بلافاصله بالا بیاید.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Field label="شماره تماس ورودی بیمار">
                    <Input
                      value={incomingPhone}
                      onChange={e => setIncomingPhone(e.target.value)}
                      placeholder="مثلاً 0912..."
                      className="font-mono font-bold text-left"
                    />
                  </Field>
                </div>
                <Field label="ساعت نوبت پیشنهادی">
                  <Input
                    type="time"
                    value={callerApptTime}
                    onChange={e => setCallerApptTime(e.target.value)}
                    className="font-mono font-bold"
                  />
                </Field>
              </div>

              {/* Quick Sample Caller Numbers from Existing Patients */}
              {patients.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                  <span className="text-[10px] font-bold text-gray-400 shrink-0">تست سریع تماس:</span>
                  {patients.slice(0, 4).map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setIncomingPhone(p.phone || '09121112233')}
                      className="px-2.5 py-1 rounded-xl bg-gray-100 hover:bg-emerald-50 text-[10px] font-bold text-gray-700 whitespace-nowrap shrink-0"
                    >
                      {p.first_name} {p.last_name} ({p.phone || 'بدون شماره'})
                    </button>
                  ))}
                </div>
              )}

              {matchedPatient ? (
                <div className="rounded-3xl bg-gradient-to-br from-emerald-600 to-teal-700 p-4 text-white shadow-lg space-y-3 animate-scale-in">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-extrabold bg-white/20 px-2 py-0.5 rounded-full">
                        ✓ دارای پرونده فعال در مینادنتال
                      </span>
                      <h3 className="text-base font-black mt-1.5">
                        {matchedPatient.first_name} {matchedPatient.last_name}
                      </h3>
                      <p className="text-xs text-emerald-100 mt-0.5">
                        شماره تماس: {matchedPatient.phone} • {pTreatments.length.toLocaleString('fa-IR')} سابقه درمان
                      </p>
                    </div>
                    <Badge color="#065F46" bg="#D1FAE5">شناسایی شد</Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/15">
                    <button
                      disabled={callerBookingBusy}
                      onClick={() => handleQuickBookExisting(matchedPatient)}
                      className="py-2.5 px-3 rounded-2xl bg-white text-emerald-900 font-black text-xs shadow-md active:scale-95 transition-all"
                    >
                      {callerBookingBusy ? 'در حال ثبت...' : `ثبت نوبت فوری (${callerApptTime})`}
                    </button>
                    <button
                      onClick={() => {
                        setCallerIdOpen(false);
                        handleNavigate('patients');
                      }}
                      className="py-2.5 px-3 rounded-2xl bg-white/20 hover:bg-white/30 text-white font-bold text-xs transition-all"
                    >
                      مشاهده پرونده کامل
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl bg-amber-50 border-2 border-amber-200 p-4 space-y-3 animate-scale-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-amber-900">
                      پرونده‌ای با این شماره یافت نشد — تشکیل فوری پرونده و نوبت:
                    </span>
                    <Badge color="#B45309" bg="#FEF3C7">بیمار جدید</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label="نام بیمار تماس‌گیرنده">
                      <Input
                        value={callerNewFirstName}
                        onChange={e => setCallerNewFirstName(e.target.value)}
                        placeholder="نام"
                      />
                    </Field>
                    <Field label="نام خانوادگی">
                      <Input
                        value={callerNewLastName}
                        onChange={e => setCallerNewLastName(e.target.value)}
                        placeholder="نام خانوادگی"
                      />
                    </Field>
                  </div>
                  <Button
                    color="#10B981"
                    disabled={callerBookingBusy || !callerNewFirstName.trim()}
                    onClick={handleQuickCreateAndBook}
                    className="w-full"
                  >
                    {callerBookingBusy ? 'در حال ثبت...' : `تشکیل پرونده و ثبت نوبت خودکار (${callerApptTime})`}
                  </Button>
                </div>
              )}
            </div>
          );
        })()}
      </Sheet>

      <RoadmapAuditModal
        open={roadmapModalOpen}
        onClose={() => setRoadmapModalOpen(false)}
      />

      <InstallAppModal
        open={installModalOpen}
        onClose={() => setInstallModalOpen(false)}
        deferredPrompt={deferredPrompt}
        onInstallSuccess={() => setDeferredPrompt(null)}
        updateAvailable={updateAvailable}
        onApplyUpdate={handleApplyUpdate}
      />

      {/* Smart Cross-Role Real-Time Workflow Popup (پاپ‌آپ مدرن هوشمند نوبت و درمان — ضد فراموشی) */}
      {smartWorkflowPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md animate-fade-in"
          data-testid="smart_workflow_popup"
        >
          <div className="w-full max-w-md rounded-[28px] bg-white border border-slate-200/90 shadow-2xl overflow-hidden animate-scale-in">
            {/* Header Banner */}
            <div
              className={`p-4 text-white flex items-start justify-between gap-3 ${
                smartWorkflowPopup.type === 'appointment_booked'
                  ? 'bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-700'
                  : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700'
              }`}
            >
              <div className="space-y-1 min-w-0">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/20 text-[10px] font-black">
                  <BellRing size={11} />
                  {smartWorkflowPopup.targetRolesLabel}
                </span>
                <h3 className="text-sm font-black leading-snug">{smartWorkflowPopup.title}</h3>
                <p className="text-[11px] text-white/85 leading-relaxed">{smartWorkflowPopup.subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setSmartWorkflowPopup(null)}
                aria-label="بستن پنجره اطلاع‌رسانی"
                data-testid="smart_workflow_popup_close"
                className="w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center shrink-0 transition-all"
              >
                <X size={16} />
              </button>
            </div>

            {/* Patient & Clinical / Financial Details Card */}
            <div className="p-4 space-y-3">
              <div className="rounded-2xl bg-slate-50 border border-slate-200/80 p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-slate-500">نام بیمار:</span>
                  <span className="text-xs font-black text-slate-900">{smartWorkflowPopup.patientName}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-slate-500">پزشک معالج:</span>
                  <span className="text-xs font-extrabold text-indigo-700">{smartWorkflowPopup.doctorName}</span>
                </div>
                <div className="pt-1.5 border-t border-slate-200/70 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-extrabold text-slate-700">{smartWorkflowPopup.detailLine}</span>
                  {smartWorkflowPopup.amountLine && (
                    <span className="text-xs font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200">
                      {smartWorkflowPopup.amountLine}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                  <span>ثبت توسط: {smartWorkflowPopup.actorName}</span>
                  <span>ساعت {smartWorkflowPopup.timestamp}</span>
                </div>
              </div>

              {/* Role-Specific 1-Click Action Buttons */}
              {smartWorkflowPopup.type === 'appointment_booked' ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    data-testid="smart_popup_open_treatment_btn"
                    onClick={() => {
                      playTactileFeedback('tap');
                      setSmartWorkflowPopup(null);
                      handleNavigate('treatments');
                    }}
                    className="w-full py-2.5 px-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
                  >
                    <CheckCircle2 size={15} />
                    انتخاب بیمار و ورود به چارت درمان (ویژه پزشک و مدیر)
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        playTactileFeedback('tap');
                        setSmartWorkflowPopup(null);
                        handleNavigate('appointments');
                      }}
                      className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-all"
                    >
                      مشاهده لیست نوبت‌ها
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        playTactileFeedback('tap');
                        setSmartWorkflowPopup(null);
                        handleNavigate('patients');
                      }}
                      className="py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold transition-all"
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
                      playTactileFeedback('tap');
                      setSmartWorkflowPopup(null);
                      handleNavigate('finance');
                    }}
                    className="w-full py-2.5 px-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
                  >
                    <CheckCircle2 size={15} />
                    ثبت دریافتی، تقسیط یا چک ضمانت بیمار (منشی / مدیر)
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      data-testid="smart_popup_open_next_appt_btn"
                      onClick={() => {
                        playTactileFeedback('tap');
                        setSmartWorkflowPopup(null);
                        handleNavigate('appointments');
                      }}
                      className="py-2 px-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 text-xs font-extrabold transition-all"
                    >
                      تعیین نوبت جلسه بعد
                    </button>
                    <button
                      type="button"
                      data-testid="smart_popup_open_lab_btn"
                      onClick={() => {
                        playTactileFeedback('tap');
                        setSmartWorkflowPopup(null);
                        handleNavigate('lab');
                      }}
                      className="py-2 px-3 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 text-xs font-extrabold transition-all"
                    >
                      سفارش لابراتوار / ایمپلنت
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

declare global {
  interface String {
    toPersianDigits(): string;
  }
}

String.prototype.toPersianDigits = function(this: string) {
  const persian = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
  return this.replace(/[0-9]/g, d => persian[parseInt(d)]);
};

export default App;
