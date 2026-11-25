import { useEffect, useRef } from 'react';
import {
  Archive,
  CheckCircle2,
  ChevronRight,
  FolderKanban,
  Search,
  ShieldAlert,
  Sparkles,
  UploadCloud,
  User,
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
import { beginRtlEdgeBackSwipe, shouldCompleteRtlEdgeBackSwipe, type EdgeBackTracker } from '@/platform/gestures';
import { MascotTooth } from '@/components/ui/MascotTooth';
import { DraggableNotificationHandle } from '@/components/ui/DraggableNotificationHandle';
import { IOSReminderPopup } from '@/components/ui/IOSReminderPopup';
import { AuroraBackground } from '@/design-system/components/AuroraBackground';
import { useClinicShell } from './AppProviders';
import { AppRouter } from './AppRouter';
import { OverlayManager } from './OverlayManager';

export function AppShell() {
  const {
    currentUser,
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
          onChange={(id) => navigate(id)}
          onBack={goBack}
          canGoBack={canGoBack}
          notifCount={notifCount}
          mascotMood={mascotMood}
          currentUser={currentUser}
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
          {/* Compact Non-Overlapping Header */}
          <header className="shrink-0 z-20 bg-[#F4F7F9] dark:bg-[#0A141E] border-b border-[#D8E2EA] dark:border-[#25394D] px-2 md:px-4 py-1.5">
            <div className="max-w-xl md:max-w-5xl xl:max-w-6xl mx-auto">
              <div className="rounded-[20px] px-3 py-1.5 flex items-center justify-between bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] text-[#14283B] dark:text-[#F1F5F9] shadow-sm">
                <div className="flex items-center gap-2 min-w-0">
                  {activeRoute !== 'dashboard' && (
                    <button
                      type="button"
                      data-testid="topbar_back_button"
                      onClick={goBack}
                      aria-label="بازگشت به صفحه قبل"
                      title="بازگشت"
                      className="w-10 h-10 rounded-[12px] bg-[#EEF3F7] dark:bg-[#162738] border border-[#D8E2EA] dark:border-[#25394D] flex items-center justify-center text-[#14283B] dark:text-[#F1F5F9] shrink-0 active:scale-95"
                    >
                      <ChevronRight size={18} strokeWidth={2.5} />
                    </button>
                  )}

                  <button
                    type="button"
                    className="cursor-pointer shrink-0 active:scale-95 md:hidden"
                    onClick={() => navigate('dashboard')}
                    aria-label="مینادنتال - صفحه اصلی"
                  >
                    <MascotTooth mood={mascotMood} size={36} />
                  </button>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h1 className="text-sm font-bold leading-tight truncate">
                        <span className="md:hidden">
                          {activeRoute === 'dashboard' ? 'مینادنتال' : section.label}
                        </span>
                        <span className="hidden md:inline">{section.label}</span>
                      </h1>
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-md text-white truncate max-w-[120px]"
                        style={{ background: section.color }}
                      >
                        {currentUser.fullName || currentUser.name}
                      </span>
                    </div>
                    <p className="text-[10px] font-medium text-[#526779] dark:text-[#9FB1C1] leading-tight truncate">
                      {activeBranch.name} • {onlinePeersCount.toLocaleString('fa-IR')} کاربر آنلاین
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
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
                    className="topbar-btn bg-[#EEF3F7] dark:bg-[#162738] border border-[#D8E2EA] dark:border-[#25394D]"
                    onClick={() => {
                      PlatformHapticAdapter.selection();
                      setUserModalOpen(true);
                    }}
                    aria-label="حساب کاربری و مدیریت دسترسی"
                    title={`${currentUser.fullName || 'مدیر'} (${ROLE_LABELS[currentUser.role]})`}
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
              edgeSwipeRef.current = beginRtlEdgeBackSwipe(e, activeRoute !== 'dashboard');
            }}
            onTouchEnd={(e) => {
              if (shouldCompleteRtlEdgeBackSwipe(edgeSwipeRef.current, e)) {
                goBack();
              }
              edgeSwipeRef.current = null;
            }}
            onTouchCancel={() => {
              edgeSwipeRef.current = null;
            }}
            className={`app-shell-main px-2 md:px-5 desktop-scroll ${
              activeRoute === 'dashboard' ? 'main-no-scroll-home py-1.5' : 'py-2.5 pb-6'
            }`}
          >
            <div className="max-w-xl md:max-w-5xl xl:max-w-6xl mx-auto space-y-2 h-full">
              {!isOnline && (
                <div className="rounded-[12px] bg-[#92510C] text-white text-xs font-bold py-1.5 px-3 flex items-center justify-center gap-2">
                  <WifiOff size={15} />
                  <span>حالت آفلاین (استفاده از کش محلی)</span>
                </div>
              )}

              {deniedRouteNotice && (
                <div
                  role="alert"
                  className="px-3 py-2 rounded-[12px] bg-[#FFF1F2] border border-[#FECDD3] text-[#AD293C] text-xs font-bold flex items-center justify-between gap-2"
                >
                  <span>دسترسی نقش فعلی به بخش «{deniedRouteNotice}» محدود شده است.</span>
                  <button
                    type="button"
                    onClick={clearDeniedNotice}
                    aria-label="بستن پیام محدودیت"
                    className="p-1 rounded-lg bg-white border border-[#FECDD3]"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

              {!notifOpen && (
                <>
                  {liveSyncToast && (
                    <div className="px-3.5 py-2 rounded-[14px] bg-[#ECFDF5] border border-[#B7E4CE] text-[#0F4B39] text-xs font-bold flex items-center justify-center gap-2 animate-fade-in">
                      <CheckCircle2 size={15} className="text-[#176B52] shrink-0" />
                      <span>{liveSyncToast}</span>
                    </div>
                  )}

                  {guardianToast && (
                    <div
                      data-testid="guardian_security_toast"
                      className={`px-3.5 py-2 rounded-[14px] text-xs font-bold flex items-center justify-between gap-2 border animate-fade-in ${
                        guardianToast.severity === 'security'
                          ? 'bg-[#FFF1F2] border-[#FECDD3] text-[#AD293C]'
                          : guardianToast.severity === 'offline'
                          ? 'bg-[#FFFBEB] border-[#FDE0A6] text-[#92510C]'
                          : 'bg-[#ECFDF5] border-[#B7E4CE] text-[#176B52]'
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
                        className="p-1.5 rounded-lg bg-white border border-[#D8E2EA] text-[#14283B] shrink-0"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}

                  {offlineQueueCount > 0 && (
                    <div
                      data-testid="offline_queue_pending_pill"
                      className="px-3.5 py-2 rounded-[14px] bg-[#FFFBEB] border border-[#FDE0A6] text-[#92510C] text-[11px] font-bold flex items-center justify-between gap-2 animate-fade-in"
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
                          className="min-h-[36px] px-2 py-1 rounded-[10px] bg-white border border-[#FDE0A6] text-[#92510C] font-bold text-[11px]"
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
            onChange={(id) => navigate(id)}
            onOpenServices={() => navigate('services')}
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
