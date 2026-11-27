import { useEffect, type RefObject } from 'react';
import type { AppRouteId } from '@/lib/navigationStack';
import { hasActiveModalFocusTrap } from '@/platform/focusEngine';

interface UseShellKeyboardAndScrollParams {
  activeRoute: AppRouteId;
  mainRef: RefObject<HTMLDivElement | null>;
  getSavedScroll: (route: AppRouteId) => number;
  navigate: (route: AppRouteId) => void;
  openQBankMenu: (focusSearch?: boolean) => void;
  closeQBankMenu: () => void;
  setNotifOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setProjectFolderOpen: (open: boolean) => void;
  setUserModalOpen: (open: boolean) => void;
  setCallerIdOpen: (open: boolean) => void;
  clearSmartWorkflowPopup: () => void;
}

/**
 * GE-0005 Modular Shell Controller Hook:
 * Manages per-route scroll restoration and global accessible keyboard navigation
 * (Ctrl/Cmd+K Command Center, F1-F9 clinic workflow shortcuts, Escape overlay dismissal).
 */
export function useShellKeyboardAndScroll({
  activeRoute,
  mainRef,
  getSavedScroll,
  navigate,
  openQBankMenu,
  setShortcutsOpen,
}: UseShellKeyboardAndScrollParams) {
  useEffect(() => {
    const targetTop = activeRoute === 'dashboard' ? 0 : getSavedScroll(activeRoute);
    requestAnimationFrame(() => {
      mainRef.current?.scrollTo({ top: targetTop, behavior: 'auto' });
    });
  }, [activeRoute, getSavedScroll, mainRef]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.key === 'F5' || hasActiveModalFocusTrap()) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openQBankMenu(true);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
      ) {
        if (e.key === 'Escape') target.blur();
        return;
      }

      const shortcutRoutes: Record<string, AppRouteId> = {
        F2: 'patients',
        F3: 'appointments',
        F4: 'treatments',
        F6: 'finance',
        F7: 'implants',
        F8: 'lab',
        F9: 'calendar',
      };

      if (e.key === 'F1') {
        e.preventDefault();
        setShortcutsOpen(true);
      } else if (shortcutRoutes[e.key]) {
        e.preventDefault();
        navigate(shortcutRoutes[e.key]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    navigate,
    openQBankMenu,
    setShortcutsOpen,
  ]);
}
