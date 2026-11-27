import { useMemo, useRef } from 'react';
import { CLINIC_BRANCHES } from '@/services/authentication/authService';
import { useNavigation } from '@/navigation/NavigationStack';
import { FloatingDock } from '@/navigation/FloatingDock';
import { NavigationRail } from '@/navigation/NavigationRail';
import { PlatformHapticAdapter } from '@/platform/haptics';
import { useViewportMetrics } from '@/platform/safeArea';
import {
  beginRtlEdgeBackSwipe,
  cancelRtlEdgeBackSwipe,
  shouldCompleteRtlEdgeBackSwipe,
  type EdgeBackTracker,
} from '@/platform/gestures';
import { IOSReminderPopup } from '@/components/ui/IOSReminderPopup';
import { ReleaseWatcher } from '@/components/ui/ReleaseWatcher';
import { AuroraBackground } from '@/design-system/components/AuroraBackground';
import { ContextualToolbar } from '@/design-system/primitives/AdaptiveLayout';
import { useClinicShell } from './AppProviders';
import { AppRouter } from './AppRouter';
import { OverlayManager } from './OverlayManager';
import { AdaptiveTopBar } from './shell/AdaptiveTopBar';
import { ShellAccessibilityBar } from './shell/ShellAccessibilityBar';
import { ShellStatusBanners } from './shell/ShellStatusBanners';
import { buildShellContextualActions, resolveShellSection } from './shell/shellMetadata';
import { useShellKeyboardAndScroll } from './shell/useShellKeyboardAndScroll';

/**
 * GE-0005 Modular Universal Adaptive App Shell:
 * Clean architectural composition root (<200 lines) orchestrating:
 * - AdaptiveTopBar (Apple Liquid Glass / Material 3 / Fluent 2)
 * - NavigationRail (Tablet/Desktop) & FloatingDock (Mobile QBank 4+1 pill)
 * - ShellAccessibilityBar (WCAG 2.2 AA Skip-Link & Persian route live announcer)
 * - ShellStatusBanners (Offline, RBAC, Guardian, Queue, Signed Atomic OTA)
 * - ContextualToolbar, IOSReminderPopup, AppRouter & OverlayManager (single authoritative notification bell in AdaptiveTopBar/NavigationRail)
 */
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
  useViewportMetrics();

  const effectiveMascotMood = !isOnline ? 'offline' : mascotMood;
  const section = useMemo(() => resolveShellSection(activeRoute), [activeRoute]);
  const activeBranch = CLINIC_BRANCHES.find((b) => b.id === branchId) ?? CLINIC_BRANCHES[0];

  const contextualActions = useMemo(
    () => buildShellContextualActions(activeRoute, effectiveRole, (route) => navigate(route)),
    [activeRoute, effectiveRole, navigate]
  );

  useShellKeyboardAndScroll({
    activeRoute,
    mainRef,
    getSavedScroll,
    navigate: (route) => navigate(route),
    openQBankMenu,
    closeQBankMenu,
    setNotifOpen,
    setShortcutsOpen,
    setProjectFolderOpen,
    setUserModalOpen,
    setCallerIdOpen,
    clearSmartWorkflowPopup: () => setSmartWorkflowPopup(null),
  });

  return (
    <div className={`app-shell-viewport relative ${section.themeClass}`}>
      <ShellAccessibilityBar activeSectionLabel={section.label} branchName={activeBranch.name} />
      <AuroraBackground />

      <div className="flex-1 min-h-0 flex overflow-hidden">
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
          <AdaptiveTopBar
            activeRoute={activeRoute}
            section={section}
            canGoBack={canGoBack}
            mascotMood={effectiveMascotMood}
            currentUser={currentUser}
            effectiveRole={effectiveRole}
            branchName={activeBranch.name}
            onlinePeersCount={onlinePeersCount}
            notifCount={notifCount}
            syncPulse={syncPulse}
            onGoBack={goBack}
            onGoHome={() => navigate('dashboard', undefined, { rootTab: true })}
            onOpenSearch={() => openQBankMenu(true)}
            onOpenNotifications={() => setNotifOpen(true)}
            onOpenUserModal={() => setUserModalOpen(true)}
            onOpenProjectFolder={() => setProjectFolderOpen(true)}
          />

          <main
            id="main-clinic-content"
            tabIndex={-1}
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
            className={`app-shell-main shell-content-gutter desktop-scroll focus:outline-none ${
              activeRoute === 'dashboard' ? 'main-no-scroll-home py-1' : 'py-2 pb-6'
            }`}
          >
            <div className="adaptive-shell-container shell-content-stack min-h-full">
              <ShellStatusBanners
                isOnline={isOnline}
                notifOpen={notifOpen}
                deniedRouteNotice={deniedRouteNotice}
                clearDeniedNotice={clearDeniedNotice}
                liveSyncToast={liveSyncToast}
                guardianToast={guardianToast}
                dismissGuardianToast={dismissGuardianToast}
                offlineQueueCount={offlineQueueCount}
                flushingQueue={flushingQueue}
                flushOfflineQueue={flushOfflineQueue}
                clearQueue={clearQueue}
                updateSnapshot={updateSnapshot}
                updateAvailable={updateAvailable}
                otaUpdateInfo={otaUpdateInfo}
                installingUpdate={installingUpdate}
                atomicProgress={atomicProgress}
                applyUpdate={applyUpdate}
                deferUpdate={deferUpdate}
                openNativeUpdateStore={openNativeUpdateStore}
              />

              {!notifOpen && activeRoute !== 'dashboard' && contextualActions.length > 0 && (
                <ContextualToolbar
                  sectionLabel={section.label}
                  isOnline={isOnline}
                  syncPulse={syncPulse}
                  offlineQueueCount={offlineQueueCount}
                  actions={contextualActions}
                  onOpenSyncStatus={() => setProjectFolderOpen(true)}
                />
              )}

              {!notifOpen && activeRoute !== 'dashboard' && (
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

              <AppRouter />
            </div>
          </main>

          <FloatingDock
            active={activeRoute}
            onChange={(id) => navigate(id, undefined, { rootTab: true })}
            onOpenServices={() => navigate('services')}
            userRole={effectiveRole}
          />
        </div>
      </div>

      <ReleaseWatcher />
      <OverlayManager />
    </div>
  );
}
