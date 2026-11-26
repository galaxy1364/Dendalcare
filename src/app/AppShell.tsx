import { useEffect, useMemo, useRef } from 'react';
import {
  Archive,
  BarChart3,
  Bell,
  CalendarDays,
  CalendarPlus,
  CheckCircle2,
  ChevronRight,
  FolderKanban,
  Search,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  UploadCloud,
  User,
  UserPlus,
  WifiOff,
  X,
} from 'lucide-react';
import { getSection } from '@/lib/sections';
import { ROLE_LABELS } from '@/lib/cloudSyncEngine';
import { CLINIC_BRANCHES } from '@/services/authentication/authService';
import { useNavigation } from '@/navigation/NavigationStack';
import { FloatingDock } from '@/navigation/FloatingDock';
import { NavigationRail } from '@/navigation/NavigationRail';
import { PlatformHapticAdapter } from '@/platform/haptics';
import { useViewportMetrics } from '@/platform/safeArea';
import { canAccessRoute } from '@/services/permissions/accessControl';
import {
  beginRtlEdgeBackSwipe,
  cancelRtlEdgeBackSwipe,
  shouldCompleteRtlEdgeBackSwipe,
  type EdgeBackTracker,
} from '@/platform/gestures';
import { MascotTooth } from '@/components/ui/MascotTooth';
import { DraggableNotificationHandle } from '@/components/ui/DraggableNotificationHandle';
import { IOSReminderPopup } from '@/components/ui/IOSReminderPopup';
import { AuroraBackground } from '@/design-system/components/AuroraBackground';
import {
  ContextualToolbar,
  type ContextualActionItem,
} from '@/design-system/primitives/AdaptiveLayout';
import { useClinicShell } from './AppProviders';
import { AppRouter } from './AppRouter';
import { OverlayManager } from './OverlayManager';

export function AppShell() {
  const {
    currentUser,
    effectiveRole,
    branchId,
    isOnline,
    onlinePeersCount,
    platformInfo,
    syncPulse,
    offlineQueueCount,
    flushingQueue,
    flushOfflineQueue,
    clearQueue,
    updateSnapshot,
    updateAvailable,
    otaUpdateInfo,
    installingUpdate,
    atomicProgress,
    applyUpdate,
    deferUpdate,
    openNativeUpdateStore,
    liveSyncToast,
    guardianToast,
    dismissGuardianToast,
    deviceNotifOn,
    requestDeviceNotif,
    showSyncToast,
    notifOpen,
    setNotifOpen,
    openQBankMenu,
    closeQBankMenu,
    setProjectFolderOpen,
    setUserModalOpen,
    setCallerIdOpen,
    setShortcutsOpen,
    setSmartWorkflowPopup,
    zeroLossPopupQueue,
    notifCount,
    mascotMood,
    forceExpandReminderKey,
    acknowledgeAlert,
    snoozeAlert,
  } = useClinicShell();

  const {
    activeRoute,
    canGoBack,
    deniedRouteNotice,
    clearDeniedNotice,
    navigate,
    goBack,
    saveCurrentScroll,
    getSavedScroll,
  } = useNavigation();

  const mainRef = useRef<HTMLDivElement>(null);
  const edgeSwipeRef = useRef<EdgeBackTracker | null>(null);
  // Keep documentElement synchronized with live viewport breakpoint & virtual keyboard insets
  useViewportMetrics();

  const effectiveMascotMood = !isOnline ? 'offline' : mascotMood;

  const contextualActions = useMemo<ContextualActionItem[]>(() => {
    if (activeRoute === 'dashboard') return [];
    const items: ContextualActionItem[] = [];
    if (canAccessRoute(effectiveRole, 'patient_form')) {
      items.push({
        id: 'new_patient',
        label: 'بیمار جدید',
        icon: <UserPlus size={13} />,
        accent: '#087C76',
        onClick: () => {
          PlatformHapticAdapter.selection();
          navigate('patient_form');
        },
      });
    }
    if (canAccessRoute(effectiveRole, 'appointment_form')) {
      items.push({
        id: 'new_appointment',
        label: 'نوبت جدید',
        icon: <CalendarPlus size={13} />,
        accent: '#0369A1',
        onClick: () => {
          PlatformHapticAdapter.selection();
          navigate('appointment_form');
        },
      });
    }
    if (activeRoute !== 'treatments' && canAccessRoute(effectiveRole, 'treatment_form')) {
      items.push({
        id: 'new_treatment',
        label: 'طرح درمان',
        icon: <Stethoscope size={13} />,
        accent: '#5B3CC4',
        onClick: () => {
          PlatformHapticAdapter.selection();
          navigate('treatment_form');
        },
      });
    }
    if (activeRoute !== 'calendar' && canAccessRoute(effectiveRole, 'calendar')) {
      items.push({
        id: 'open_calendar',
        label: 'تقویم شمسی',
        icon: <CalendarDays size={13} />,
        accent: '#92510C',
        onClick: () => {
          PlatformHapticAdapter.selection();
          navigate('calendar');
        },
      });
    }
    if (activeRoute !== 'reports' && canAccessRoute(effectiveRole, 'reports')) {
      items.push({
        id: 'open_reports',
        label: 'گزارش جامع',
        icon: <BarChart3 size={13} />,
        accent: '#176B52',
        onClick: () => {
          PlatformHapticAdapter.selection();
          navigate('reports');
        },
      });
    }
    return items.slice(0, 4);
  }, [activeRoute, effectiveRole, navigate]);

  const section =
    activeRoute === 'services'
      ? { ...getSection('dashboard'), id: 'services' as const, label: 'همه خدمات کلینیک' }
      : activeRoute === 'customize_services'
      ? { ...getSection('dashboard'), id: 'customize_services' as const, label: 'تنظیم ۴ خدمت منتخب' }
      : activeRoute === 'reports'
      ? { ...getSection('finance'), id: 'reports' as const, label: 'گزارش جامع کلینیک' }
      : activeRoute === 'patient_form'
      ? { ...getSection('patients'), id: 'patient_form' as const, label: 'ثبت بیمار جدید' }
      : activeRoute === 'appointment_form'
      ? { ...getSection('appointments'), id: 'appointment_form' as const, label: 'ثبت نوبت جدید' }
      : activeRoute === 'treatment_form'
      ? { ...getSection('treatments'), id: 'treatment_form' as const, label: 'ثبت طرح درمان' }
      : getSection(activeRoute);

  const activeBranch = CLINIC_BRANCHES.find((b) => b.id === branchId) ?? CLINIC_BRANCHES[0];

  // Restore per-route scroll when switching screens
  useEffect(() => {
    const targetTop = activeRoute === 'dashboard' ? 0 : getSavedScroll(activeRoute);
    requestAnimationFrame(() => {
      mainRef.current?.scrollTo({ top: targetTop, behavior: 'auto' });
    });
  }, [activeRoute, getSavedScroll]);

  // Global keyboard shortcuts (Ctrl+K, F1-F9, Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openQBankMenu(true);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      if (e.key === 'F1') {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (e.key === 'F2') {
        e.preventDefault();
        navigate('patients');
      } else if (e.key === 'F3') {
        e.preventDefault();
        navigate('appointments');
      } else if (e.key === 'F4') {
        e.preventDefault();
        navigate('treatments');
      } else if (e.key === 'F5') {
        e.preventDefault();
        navigate('dashboard');
      } else if (e.key === 'F6') {
        e.preventDefault();
        navigate('finance');
      } else if (e.key === 'F7') {
        e.preventDefault();
        navigate('implants');
      } else if (e.key === 'F8') {
        e.preventDefault();
        navigate('lab');
      } else if (e.key === 'F9') {
        e.preventDefault();
        navigate('calendar');
      } else if (e.key === 'Escape') {
        setNotifOpen(false);
        setShortcutsOpen(false);
        setProjectFolderOpen(false);
        setUserModalOpen(false);
        setCallerIdOpen(false);
        setSmartWorkflowPopup(null);
        closeQBankMenu();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    closeQBankMenu,
    navigate,
    openQBankMenu,
    setCallerIdOpen,
    setNotifOpen,
    setProjectFolderOpen,
    setShortcutsOpen,
    setSmartWorkflowPopup,
    setUserModalOpen,
  ]);

  return (
    <div className={`app-shell-viewport relative ${section.themeClass}`}>
      <AuroraBackground />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Adaptive Tablet Rail / Desktop Sidebar */}
        <NavigationRail
          active={activeRoute}
          onChange={(id) => navigate(id, undefined, { rootTab: true })}
          onBack={goBack}
          canGoBack={canGoBack}
          notifCount={notifCount}
          mascotMood={effectiveMascotMood}
          currentUser={currentUser}
          effectiveRole={effectiveRole}
          platformInfo={platformInfo}
          onOpenUserModal={() => setUserModalOpen(true)}
          onOpenProjectFolder={() => setProjectFolderOpen(true)}
          onOpenGlobalSearch={() => {
            PlatformHapticAdapter.selection();
            openQBankMenu(true);
          }}
          onOpenNotifications={() => {
            PlatformHapticAdapter.selection();
            setNotifOpen(true);
          }}
          onOpenShortcuts={() => setShortcutsOpen(true)}
        />

        <div className="flex-1 min-w-0 flex flex-col min-h-0 relative">
          {/* Compact Non-Overlapping Adaptive Liquid-Glass Header (320px-1920px) */}
          <header className="shrink-0 z-20 bg-[#F4F7F9]/95 dark:bg-[#0A141E]/95 liquid-glass-header border-b border-[#D8E2EA]/80 dark:border-[#25394D]/80 px-2 md:px-5 py-1.5">
            <div className="adaptive-shell-container">
              <div className="liquid-glass-bar rounded-[20px] px-2 sm:px-3 py-1.5 flex items-center justify-between gap-1.5 sm:gap-2 text-[#14283B] dark:text-[#F1F5F9]">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                  {canGoBack && (
                    <button
                      type="button"
                      data-testid="topbar_back_button"
                      onClick={goBack}
                      aria-label="بازگشت به صفحه قبل"
                      title="بازگشت"
                      className="w-9 h-9 sm:w-10 sm:h-10 rounded-[12px] bg-[#EEF3F7] dark:bg-[#162738] border border-[#D8E2EA] dark:border-[#25394D] flex items-center justify-center text-[#14283B] dark:text-[#F1F5F9] shrink-0 active:scale-95"
                    >
                      <ChevronRight size={18} strokeWidth={2.5} />
                    </button>
                  )}

                  <button
                    type="button"
                    data-testid="topbar_brand_logo_button"
                    className="inline-flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-[14px] shrink-0 cursor-pointer active:scale-95 md:hidden"
                    onClick={() => navigate('dashboard', undefined, { rootTab: true })}
                    aria-label="مینادنتال - صفحه اصلی"
                  >
                    <MascotTooth mood={effectiveMascotMood} size={36} framed interactive={false} />
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h1 className="text-[clamp(13px,3.6vw,16px)] font-black leading-tight text-[#14283B] dark:text-[#F1F5F9] whitespace-nowrap truncate">
                        <span className="md:hidden">
                          {activeRoute === 'dashboard' ? 'مینادنتال' : section.label}
                        </span>
                        <span className="hidden md:inline">{section.label}</span>
                      </h1>
                      <span
                        className="hidden lg:inline-flex text-[10px] font-bold px-2 py-0.5 rounded-md text-white truncate max-w-[160px]"
                        style={{ background: section.color }}
                      >
                        {currentUser.fullName || currentUser.name}
                      </span>
                    </div>
                    <p className="text-[10.5px] font-medium text-[#526779] dark:text-[#9FB1C1] leading-tight truncate mt-0.5">
                      <span>{activeBranch.name}</span>
                      <span className="hidden md:inline"> • {onlinePeersCount.toLocaleString('fa-IR')} کاربر آنلاین</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                  <button
                    type="button"
                    className="topbar-btn bg-[#F2FAFF] dark:bg-[#162738] border border-[#B5DBF7] dark:border-[#25394D]"
                    onClick={() => {
                      PlatformHapticAdapter.selection();
                      openQBankMenu(true);
                    }}
                    aria-label="جستجوی سراسری و پوشه‌ها"
                    title="جستجوی سراسری (Ctrl+K)"
                    data-testid="topbar_global_search_button"
                  >
                    <Search size={17} className="text-[#0369A1] dark:text-[#38BDF8]" />
                  </button>

                  <button
                    type="button"
                    className="topbar-btn bg-[#FFF5F7] dark:bg-[#162738] border border-[#FECDD3] dark:border-[#25394D] hidden sm:flex"
                    onClick={() => {
                      PlatformHapticAdapter.selection();
                      setNotifOpen(true);
                    }}
                    aria-label="مرکز اعلان‌ها و یادآوری‌ها"
                    title="اعلان‌ها و یادآوری‌ها"
                    data-testid="topbar_notifications_button"
                  >
                    <Bell size={17} className="text-[#AD293C] dark:text-[#FDA4AF]" />
                    {notifCount > 0 && (
                      <span className="notif-dot">
                        {notifCount > 99 ? '99+' : notifCount.toLocaleString('fa-IR')}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    className="topbar-btn bg-[#EEF3F7] dark:bg-[#162738] border border-[#D8E2EA] dark:border-[#25394D]"
                    onClick={() => {
                      PlatformHapticAdapter.selection();
                      setUserModalOpen(true);
                    }}
                    aria-label="حساب کاربری و مدیریت دسترسی"
                    title={`${currentUser.fullName || 'مدیر'} (${effectiveRole === 'unauthorized' ? 'فاقد عضویت فعال' : ROLE_LABELS[effectiveRole]})`}
                    data-testid="topbar_user_avatar_button"
                  >
                    <User size={18} className="text-[#087C76] dark:text-[#2DD4BF]" />
                    <span
                      className="absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full border border-white"
                      style={{ background: currentUser.avatarColor || '#087C76' }}
                    />
                  </button>

                  <button
                    type="button"
                    className="topbar-btn bg-[#FFFDF5] dark:bg-[#162738] border border-[#FDE0A6] dark:border-[#25394D]"
                    onClick={() => {
                      PlatformHapticAdapter.selection();
                      setProjectFolderOpen(true);
                    }}
                    aria-label="پوشه پروژه مینادنتال"
                    title="ابزارها، کالرآیدی، نصب و همگام‌سازی"
                    data-testid="topbar_project_folder_button"
                  >
                    <FolderKanban size={18} className="text-[#92510C] dark:text-[#FBBF24]" />
                    {syncPulse && (
                      <span className="absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full bg-[#176B52] border border-white" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </header>

          {/* Viewport-Bounded Main Content */}
          <main
            ref={mainRef}
            onScroll={(e) => saveCurrentScroll(e.currentTarget.scrollTop)}
            onTouchStart={(e) => {
              edgeSwipeRef.current = beginRtlEdgeBackSwipe(e, canGoBack);
            }}
            onTouchEnd={(e) => {
              if (shouldCompleteRtlEdgeBackSwipe(edgeSwipeRef.current, e)) {
                goBack();
              }
              edgeSwipeRef.current = null;
            }}
            onTouchCancel={() => {
              edgeSwipeRef.current = cancelRtlEdgeBackSwipe(edgeSwipeRef.current);
            }}
            className={`app-shell-main pr-9 pl-2.5 sm:pr-9 sm:pl-3.5 md:pr-9 md:pl-5 xl:pr-10 xl:pl-8 desktop-scroll ${
              activeRoute === 'dashboard' ? 'main-no-scroll-home py-1.5' : 'py-2.5 pb-6'
            }`}
          >
            <div className="adaptive-shell-container space-y-2 h-full">
              {!isOnline && (
                <div className="rounded-[12px] bg-[#92510C] text-white text-xs font-bold py-1.5 px-3 flex items-center justify-center gap-2">
                  <WifiOff size={15} />
                  <span>حالت آفلاین (استفاده از کش محلی)</span>
                </div>
              )}

              {deniedRouteNotice && (
                <div
                  role="alert"
                  className="px-3 py-2 rounded-[12px] bg-[#FFF1F2] dark:bg-[#2A1218] border border-[#FECDD3] dark:border-[#7F1D1D] text-[#AD293C] dark:text-[#FDA4AF] text-xs font-bold flex items-center justify-between gap-2"
                >
                  <span>دسترسی نقش فعلی به بخش «{deniedRouteNotice}» محدود شده است.</span>
                  <button
                    type="button"
                    onClick={clearDeniedNotice}
                    aria-label="بستن پیام محدودیت"
                    className="p-1 rounded-lg bg-white dark:bg-[#11202E] border border-[#FECDD3] dark:border-[#7F1D1D]"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

              {!notifOpen && (
                <>
                  {liveSyncToast && (
                    <div className="px-3.5 py-2 rounded-[14px] bg-[#ECFDF5] dark:bg-[#0D2B22] border border-[#B7E4CE] dark:border-[#1B5E48] text-[#0F4B39] dark:text-[#6EE7B7] text-xs font-bold flex items-center justify-center gap-2 animate-fade-in">
                      <CheckCircle2 size={15} className="text-[#176B52] dark:text-[#34D399] shrink-0" />
                      <span>{liveSyncToast}</span>
                    </div>
                  )}

                  {guardianToast && (
                    <div
                      data-testid="guardian_security_toast"
                      className={`px-3.5 py-2 rounded-[14px] text-xs font-bold flex items-center justify-between gap-2 border animate-fade-in ${
                        guardianToast.severity === 'security'
                          ? 'bg-[#FFF1F2] dark:bg-[#2A1218] border-[#FECDD3] dark:border-[#7F1D1D] text-[#AD293C] dark:text-[#FDA4AF]'
                          : guardianToast.severity === 'offline'
                          ? 'bg-[#FFFBEB] dark:bg-[#291E0B] border-[#FDE0A6] dark:border-[#78350F] text-[#92510C] dark:text-[#FCD34D]'
                          : 'bg-[#ECFDF5] dark:bg-[#0D2B22] border-[#B7E4CE] dark:border-[#1B5E48] text-[#176B52] dark:text-[#6EE7B7]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {guardianToast.severity === 'security' ? (
                          <ShieldAlert size={16} className="shrink-0" />
                        ) : guardianToast.severity === 'offline' ? (
                          <WifiOff size={16} className="shrink-0" />
                        ) : (
                          <Archive size={16} className="shrink-0" />
                        )}
                        <div className="min-w-0">
                          <span className="leading-snug block">{guardianToast.message}</span>
                          <span className="text-[10px] font-mono opacity-80">{guardianToast.traceId}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={dismissGuardianToast}
                        aria-label="بستن هشدار"
                        className="p-1.5 rounded-lg bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] text-[#14283B] dark:text-[#F1F5F9] shrink-0"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}

                  {offlineQueueCount > 0 && (
                    <div
                      data-testid="offline_queue_pending_pill"
                      className="px-3.5 py-2 rounded-[14px] bg-[#FFFBEB] dark:bg-[#291E0B] border border-[#FDE0A6] dark:border-[#78350F] text-[#92510C] dark:text-[#FCD34D] text-[11px] font-bold flex items-center justify-between gap-2 animate-fade-in"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <UploadCloud size={15} className="shrink-0" />
                        <span className="truncate">
                          {offlineQueueCount.toLocaleString('fa-IR')} تغییر در صف آفلاین آماده ارسال است
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={flushOfflineQueue}
                          disabled={flushingQueue}
                          data-testid="flush_offline_queue_button"
                          className="min-h-[36px] px-2.5 py-1 rounded-[10px] bg-[#92510C] text-white font-bold text-[11px] disabled:opacity-60"
                        >
                          {flushingQueue ? 'ارسال...' : 'ارسال آنی'}
                        </button>
                        <button
                          type="button"
                          onClick={clearQueue}
                          data-testid="clear_offline_queue_button"
                          className="min-h-[36px] px-2 py-1 rounded-[10px] bg-white dark:bg-[#11202E] border border-[#FDE0A6] dark:border-[#78350F] text-[#92510C] dark:text-[#FCD34D] font-bold text-[11px]"
                        >
                          پاک‌سازی
                        </button>
                      </div>
                    </div>
                  )}

                  {updateAvailable &&
                    !(
                      updateSnapshot.candidate?.deferredUntil &&
                      Date.parse(updateSnapshot.candidate.deferredUntil) > Date.now() &&
                      updateSnapshot.candidate.manifest.urgency !== 'critical'
                    ) && (
                      <div
                        data-testid="top_atomic_update_banner"
                        className="p-2.5 rounded-[16px] bg-[#EFF6FF] dark:bg-[#102338] text-[#14283B] dark:text-[#F1F5F9] border border-[#BFDBFE] dark:border-[#1E3A5F] animate-fade-in"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-xs font-bold min-w-0">
                            <Sparkles size={16} className="text-[#0369A1] dark:text-[#38BDF8] shrink-0" />
                            <div className="min-w-0">
                              <span className="block truncate">
                                {updateSnapshot.state === 'NATIVE_STORE_REQUIRED'
                                  ? `نسخه جدید v${otaUpdateInfo?.version} در فروشگاه رسمی آماده است`
                                  : updateSnapshot.state === 'WAITING_FOR_SAFE_POINT'
                                  ? `نسخه v${otaUpdateInfo?.version} تأیید شد — در انتظار نقطه امن`
                                  : updateSnapshot.state === 'READY_TO_ACTIVATE'
                                  ? `نسخه v${otaUpdateInfo?.version} تأیید شد و آماده فعال‌سازی است`
                                  : `انتشار جدید v${otaUpdateInfo?.version} (#${otaUpdateInfo?.build}) در دسترس است`}
                              </span>
                              {otaUpdateInfo?.releaseNotes && (
                                <span className="block text-[10px] font-medium text-[#526779] dark:text-[#9FB1C1] truncate">
                                  {otaUpdateInfo.releaseNotes}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {updateSnapshot.candidate?.manifest.urgency !== 'critical' && !installingUpdate && (
                              <button
                                type="button"
                                onClick={() => deferUpdate(30)}
                                data-testid="top_update_defer_btn"
                                className="min-h-[36px] px-2.5 py-1 rounded-[10px] bg-white dark:bg-[#162738] border border-[#BFDBFE] dark:border-[#25394D] text-[#14283B] dark:text-[#F1F5F9] font-bold text-[11px]"
                              >
                                بعداً
                              </button>
                            )}
                            {updateSnapshot.state === 'NATIVE_STORE_REQUIRED' ? (
                              <button
                                type="button"
                                onClick={openNativeUpdateStore}
                                data-testid="top_atomic_update_install_btn"
                                className="min-h-[36px] px-3 py-1 rounded-[10px] bg-[#0369A1] text-white font-bold text-xs"
                              >
                                فروشگاه رسمی
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void applyUpdate(false)}
                                disabled={installingUpdate}
                                data-testid="top_atomic_update_install_btn"
                                className="min-h-[36px] px-3 py-1 rounded-[10px] bg-[#0369A1] text-white font-bold text-xs disabled:opacity-70"
                              >
                                {installingUpdate
                                  ? atomicProgress?.determinate && atomicProgress.percent !== null
                                    ? `بررسی (${atomicProgress.percent}%)...`
                                    : 'در حال تأیید...'
                                  : updateSnapshot.state === 'WAITING_FOR_SAFE_POINT'
                                  ? 'فعال‌سازی امن'
                                  : 'دریافت و فعال‌سازی'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                  {updateSnapshot.candidate?.manifest.urgency === 'critical' &&
                    updateSnapshot.state === 'READY_TO_ACTIVATE' && (
                      <div
                        role="dialog"
                        aria-modal="true"
                        data-testid="critical_update_modal"
                        className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
                      >
                        <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] p-5 space-y-3 shadow-xl">
                          <h2 className="text-sm font-black text-[#14283B] dark:text-[#F1F5F9]">
                            به‌روزرسانی امنیتی ضروری آماده فعال‌سازی است
                          </h2>
                          <p className="text-xs text-[#526779] dark:text-[#9FB1C1] leading-relaxed">
                            نسخه v{updateSnapshot.candidate.manifest.semver} ({updateSnapshot.candidate.manifest.releaseId}) دریافت و با SHA-256 تأیید شده است. تمامی پرونده‌ها، فرم‌های پیش‌نویس و صف آفلاین محفوظ می‌مانند.
                          </p>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void applyUpdate(false)}
                              className="flex-1 min-h-[42px] rounded-xl bg-[#087C76] text-white text-xs font-extrabold"
                            >
                              ذخیره و فعال‌سازی اکنون
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                  {activeRoute !== 'dashboard' && contextualActions.length > 0 && (
                    <ContextualToolbar
                      sectionLabel={section.label}
                      isOnline={isOnline}
                      syncPulse={syncPulse}
                      offlineQueueCount={offlineQueueCount}
                      actions={contextualActions}
                      onOpenSyncStatus={() => setProjectFolderOpen(true)}
                    />
                  )}

                  {activeRoute !== 'dashboard' && (
                    <IOSReminderPopup
                      items={zeroLossPopupQueue}
                      hidden={notifOpen}
                      forceExpandedKey={forceExpandReminderKey}
                      deviceNotifOn={deviceNotifOn}
                      onNavigate={(sec) => navigate(sec)}
                      onAcknowledge={acknowledgeAlert}
                      onSnooze={snoozeAlert}
                      onSendToPhone={async (item) => {
                        if (!deviceNotifOn) {
                          await requestDeviceNotif();
                        }
                        showSyncToast(`یادآوری «${item.title}» پردازش شد`, 2600);
                      }}
                      onOpenDrawer={() => setNotifOpen(true)}
                    />
                  )}
                </>
              )}

              <AppRouter />
            </div>
          </main>

          {/* Non-Overlapping Mobile Bottom Pill Dock (FIX 04: 4 tabs + direct All Services trigger) */}
          <FloatingDock
            active={activeRoute}
            onChange={(id) => navigate(id, undefined, { rootTab: true })}
            onOpenServices={() => navigate('services')}
            userRole={effectiveRole}
          />
        </div>
      </div>

      <DraggableNotificationHandle
        notifCount={notifCount}
        open={notifOpen}
        onOpen={() => setNotifOpen(true)}
      />

      <OverlayManager />
    </div>
  );
}
