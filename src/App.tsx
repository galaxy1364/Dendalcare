import { useState, useEffect, useRef, useMemo } from 'react';
import { type SectionId, getSection } from '@/lib/sections';
import { BottomDock } from '@/components/BottomDock';
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
  Bell, Cloud, Sparkles, X, Keyboard, WifiOff, Download,
  BellRing, ArrowLeft, User, ShieldCheck, RefreshCw, Plus, CheckCircle2, LogOut, CalendarRange, PhoneIncoming, PhoneCall,
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

function App() {
  const [active, setActive] = useState<SectionId>('dashboard');
  const [syncPulse, setSyncPulse] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'all' | 'finance' | 'clinical' | 'ops'>('all');
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [otaUpdateInfo, setOtaUpdateInfo] = useState<{ version: string; releaseNotes: string; publishedBy: string } | null>(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [appReady, setAppReady] = useState(false);

  const [roadmapModalOpen, setRoadmapModalOpen] = useState(false);
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
      setTimeout(() => splashEl.remove(), 400);
    }
    const timer = setTimeout(() => setAppReady(true), 500);

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

    return () => clearTimeout(timer);
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
  const [newUserForm, setNewUserForm] = useState({
    name: '',
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
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
      else if (e.key === 'Escape') { setNotifOpen(false); setShortcutsOpen(false); }
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
    setNewUserForm({ name: '', role: 'secretary', email: '', phone: '', pin: '1234' });
  };

  const renderSection = () => {
    switch (active) {
      case 'dashboard': return <Dashboard onNavigate={setActive} />;
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
      case 'settings': return <SettingsSection />;
      default: return <Dashboard onNavigate={setActive} />;
    }
  };

  return (
    <div className={`min-h-screen relative ${section.themeClass}`}>
      {/* CSS Loader Layer (bg-slate-950) before full React render to prevent black screen */}
      {!appReady && (
        <div className="fixed inset-0 z-[10000] bg-slate-950 flex flex-col items-center justify-center p-6 text-center transition-opacity duration-500">
          <div className="relative w-24 h-24 mb-4 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-purple-600/40 blur-xl animate-pulse" />
            <MascotTooth mood="happy" size={88} />
          </div>
          <h2 className="text-xl font-black text-white mb-1">مینادنتال</h2>
          <p className="text-xs text-purple-200/80 mb-6">سیستم مدیریت تخصصی کلینیک دندانپزشکی • نسخه ۵.۰.۰</p>
          <div className="w-40 h-1.5 bg-slate-800 rounded-full overflow-hidden relative">
            <div className="absolute inset-0 w-1/2 bg-gradient-to-r from-purple-500 via-pink-500 to-sky-400 rounded-full animate-pulse" />
          </div>
        </div>
      )}

      <div className="gemini-bg">
        <div
          className="gemini-orb gemini-orb-1"
          style={{ background: `radial-gradient(circle, ${section.color} 0%, transparent 70%)` }}
        />
        <div
          className="gemini-orb gemini-orb-2"
          style={{ background: `radial-gradient(circle, #ffffff 0%, ${section.color}88 38%, transparent 72%)` }}
        />
        <div
          className="gemini-orb gemini-orb-3"
          style={{ background: `radial-gradient(circle, ${section.color}CC 0%, transparent 70%)` }}
        />
        <div className="gemini-orb gemini-orb-4" />
      </div>

      <div className="section-glow" style={{ background: section.color }} />

      {/* Top bar — iOS 27 floating glass with logo, User Avatar Switcher, Caller-ID, Calendar shortcut, Cloud Sync, Roadmap Audit, Notification Bell */}
      <header className={`fixed top-0 left-0 right-0 z-30 px-2 pt-2 safe-top transition-transform duration-300 ${headerVisible ? 'translate-y-0' : '-translate-y-full'}`}>
        <div className="max-w-xl md:max-w-4xl lg:max-w-5xl mx-auto">
          <div
            className="glass-dark rounded-[22px] px-3 py-2 flex items-center justify-between"
            style={{
              boxShadow: '0 8px 32px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            {/* Mascot Tooth Logo (Organic Duolingo Style - No Square Box) + App Name */}
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="cursor-pointer shrink-0 transition-transform active:scale-95"
                onClick={() => handleNavigate('dashboard')}
                title="مینادنتال - سیستم هوشمند مدیریت کلینیک"
              >
                <MascotTooth mood={mascotMood} size={42} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h1 className="text-sm font-black text-white leading-tight truncate">مینادنتال</h1>
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-md text-white truncate max-w-[110px]"
                    style={{ background: `${currentUser?.avatarColor || '#8B5CF6'}CC` }}
                  >
                    {currentUser?.fullName || currentUser?.name || 'دکتر مهدی امیری'}
                  </span>
                </div>
                <p className="text-[10px] text-purple-200/70 leading-tight truncate">
                  مدیریت کلینیک • {onlinePeersCount.toLocaleString('fa-IR')} آنلاین
                </p>
              </div>
            </div>

            {/* Right icons: User Avatar Icon, Caller-ID, Calendar, AI, Roadmap Audit, Cloud Sync, Notification Bell */}
            <div className="flex items-center gap-1 shrink-0">
              {/* Smart Incoming Call Caller-ID & Auto-Booking Button */}
              <button
                className="topbar-btn relative"
                onClick={() => setCallerIdOpen(true)}
                aria-label="تشخیص تماس بیمار و نوبت‌دهی خودکار"
                title="کالر آیدی هوشمند و نوبت‌دهی خودکار هنگام تماس بیمار"
                data-testid="topbar_caller_id_button"
              >
                <PhoneIncoming size={17} className="text-emerald-300" />
              </button>

              {/* Top-Bar User Avatar Button (لوگو آدمک مدیریت کاربر و سطح دسترسی) */}
              <button
                className="topbar-btn relative"
                onClick={() => setUserModalOpen(true)}
                aria-label="حساب کاربری و تغییر کاربر"
                title={`${currentUser?.fullName || currentUser?.name || 'کاربر'} (${ROLE_LABELS[currentUser?.role || 'manager'] || 'کاربر'})`}
                data-testid="topbar_user_avatar_button"
              >
                <User size={18} className="text-purple-200" />
                <span
                  className="absolute bottom-1 right-1 w-2 h-2 rounded-full border border-slate-900"
                  style={{ background: currentUser?.avatarColor || '#8B5CF6' }}
                />
              </button>

              {/* Perpetual Persian Calendar Quick Button */}
              <button
                className="topbar-btn"
                onClick={() => handleNavigate('calendar')}
                aria-label="تقویم فارسی"
                title="تقویم جامع فارسی"
              >
                <CalendarRange size={17} className="text-fuchsia-300" />
              </button>

              {/* AI Assistant */}
              <button
                className="topbar-btn ai-pulse"
                onClick={() => handleNavigate('treatments')}
                aria-label="هوش مصنوعی"
              >
                <Sparkles size={18} className="text-purple-400" />
              </button>

              {/* Verifiable Roadmap & Memory Audit (شناسه قابل پیگیری و قفل پروژه) */}
              <button
                className="topbar-btn relative"
                onClick={() => setRoadmapModalOpen(true)}
                aria-label="نقشه راه و ممیزی سیستم"
                title="مشاهده نقشه راه ۰ تا ۱۰۰ و لاگ‌های ممیزی قفل‌شده"
                data-testid="topbar_roadmap_audit_button"
              >
                <ShieldCheck size={18} className="text-emerald-400" />
                <span className="absolute -top-1 -right-1 text-[8px] font-black bg-emerald-500 text-slate-950 px-1 rounded-full font-mono">
                  TRC
                </span>
              </button>

              {/* Cloud Sync & Instant Backup */}
              <button
                className={`topbar-btn ${syncing ? 'cloud-sync-active' : ''}`}
                onClick={handleSync}
                aria-label="همگام‌سازی ابری و بک‌آپ آنی"
                title="همگام‌سازی ابری و بک‌آپ آنی"
              >
                <Cloud size={17} className={syncing ? 'text-cyan-400' : syncPulse ? 'text-green-400' : 'text-blue-200/70'} />
                {!syncing && (
                  <div
                    className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full"
                    style={{
                      background: syncPulse ? '#22C55E' : 'rgba(34,197,94,0.5)',
                      boxShadow: syncPulse ? '0 0 6px #22C55E' : 'none',
                      transition: 'all 0.3s var(--spring)',
                    }}
                  />
                )}
              </button>

              {/* Pendulum Swinging Colorful Notification Bell */}
              <button
                className="topbar-btn"
                onClick={() => setNotifOpen(!notifOpen)}
                aria-label="اعلان‌ها و رادار یادآوری"
                data-testid="topbar_notification_bell"
              >
                <Bell
                  size={18}
                  className={notifCount > 0 ? 'text-amber-300 bell-swing' : 'text-amber-200/80'}
                  style={notifCount > 0 ? { filter: 'drop-shadow(0 0 8px rgba(251,191,36,0.65))' } : undefined}
                />
                {notifCount > 0 && (
                  <span className="notif-dot">
                    {notifCount > 99 ? '99+' : String(notifCount).toPersianDigits()}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Real-Time Multi-User Cloud Sync Toast */}
          {liveSyncToast && (
            <div className="mt-2 px-3 py-2 rounded-2xl bg-slate-900/95 border border-emerald-400/40 text-emerald-300 text-xs font-bold flex items-center justify-center gap-2 shadow-xl animate-fade-in">
              <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
              <span>{liveSyncToast}</span>
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
                  await publishOtaUpdateToAllUsers('بروزرسانی سراسری توسط مدیر کلینیک', currentUser?.fullName || currentUser?.name || 'مدیر کلینیک');
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
                  ثبت کاربر و فعال‌سازی سینک ابری
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

      {/* World-Class Slide-Over Notification & Smart Reminder Drawer (کشویی از کنار صفحه) */}
      {notifOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end"
          onClick={() => setNotifOpen(false)}
          data-testid="slide_over_notification_drawer"
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm animate-fade-in" />
          <aside
            className="relative w-full max-w-sm h-full glass-dark border-r border-white/15 p-4 flex flex-col drawer-slide-in safe-top safe-bottom"
            onClick={e => e.stopPropagation()}
            style={{ boxShadow: '12px 0 45px rgba(0,0,0,0.55)' }}
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
                onClick={() => setNotifOpen(false)}
                className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all"
              >
                <X size={16} />
              </button>
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

      {/* Main content — viewport-fit with edge-to-edge stretched tiles */}
      <main
        ref={sectionRef}
        onScroll={handleScroll}
        className="fixed inset-0 overflow-y-auto pt-[80px] pb-36 px-2"
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="max-w-xl md:max-w-4xl lg:max-w-5xl mx-auto space-y-2">
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
              duration: 30,
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
              duration: 30,
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
