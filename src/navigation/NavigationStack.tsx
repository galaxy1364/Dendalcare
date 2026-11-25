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
import {
  type AppRouteId,
  getRouteScroll,
  popNavRoute,
  pushNavRoute,
  saveRouteScroll,
} from '@/lib/navigationStack';
import type { SectionId } from '@/lib/sections';
import { OmniRoute } from '@/lib/memPalace';
import { HapticEngine } from '@/platform/haptics';
import {
  dispatchDeepLink,
  type DeepLinkPayload,
} from '@/navigation/DeepLinkHandler';
import { canAccessRoute } from '@/services/permissions/accessControl';
import type { ClinicUserRole } from '@/lib/cloudSyncEngine';

const routeFilterCache = new Map<AppRouteId, Record<string, string>>();

export function saveRouteFilters(route: AppRouteId, filters: Record<string, string>): void {
  routeFilterCache.set(route, { ...filters });
}

export function getRouteFilters(route: AppRouteId): Record<string, string> | null {
  return routeFilterCache.get(route) ?? null;
}

export interface NavigationContextValue {
  activeRoute: AppRouteId;
  history: AppRouteId[];
  canGoBack: boolean;
  deniedRouteNotice: AppRouteId | null;
  clearDeniedNotice: () => void;
  navigate: (route: AppRouteId, deepLink?: Omit<DeepLinkPayload, 'section'>) => boolean;
  goBack: () => void;
  resetToHome: () => void;
  saveCurrentScroll: (scrollTop: number) => void;
  getSavedScroll: (route: AppRouteId) => number;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationProvider({
  children,
  userRole,
  onBeforeOverlayBack,
}: {
  children: ReactNode;
  userRole: ClinicUserRole;
  /** Returns true if an overlay/drawer intercepted Back before changing routes */
  onBeforeOverlayBack?: () => boolean;
}) {
  const [activeRoute, setActiveRoute] = useState<AppRouteId>(() => {
    const restored = OmniRoute.getCurrentRoute() as AppRouteId;
    if (restored && canAccessRoute(userRole, restored)) {
      return restored;
    }
    return 'dashboard';
  });
  const [history, setHistory] = useState<AppRouteId[]>([]);
  const [deniedRouteNotice, setDeniedRouteNotice] = useState<AppRouteId | null>(null);

  const activeRef = useRef(activeRoute);
  const overlayBackRef = useRef(onBeforeOverlayBack);
  overlayBackRef.current = onBeforeOverlayBack;
  activeRef.current = activeRoute;

  useEffect(() => {
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      try {
        window.history.replaceState({ minadental: true, route: activeRef.current }, '');
      } catch {
        // ignore sandboxed history
      }
    }
  }, []);

  // Re-evaluate active route if role switches to one without access
  useEffect(() => {
    if (!canAccessRoute(userRole, activeRoute)) {
      setDeniedRouteNotice(activeRoute);
      setActiveRoute('dashboard');
      setHistory([]);
      OmniRoute.navigate('dashboard');
    }
  }, [userRole, activeRoute]);

  const navigate = useCallback(
    (route: AppRouteId, deepLink?: Omit<DeepLinkPayload, 'section'>): boolean => {
      if (!canAccessRoute(userRole, route)) {
        HapticEngine.warning();
        setDeniedRouteNotice(route);
        return false;
      }

      HapticEngine.selection();
      setDeniedRouteNotice(null);

      if (deepLink) {
        dispatchDeepLink({ section: route, ...deepLink });
      }

      if (route !== activeRef.current) {
        setHistory((prev) => pushNavRoute(prev, activeRef.current, route));
        if (typeof window !== 'undefined' && window.history?.pushState) {
          try {
            window.history.pushState({ minadental: true, route }, '');
          } catch {
            // ignore
          }
        }
      }

      setActiveRoute(route);
      OmniRoute.navigate(route as SectionId);
      return true;
    },
    [userRole]
  );

  const goBack = useCallback(() => {
    HapticEngine.selection();
    setDeniedRouteNotice(null);
    setHistory((prev) => {
      const { target, nextHistory } = popNavRoute(prev);
      const safeTarget = canAccessRoute(userRole, target) ? target : 'dashboard';
      setActiveRoute(safeTarget);
      OmniRoute.navigate(safeTarget as SectionId);
      return nextHistory;
    });
  }, [userRole]);

  const resetToHome = useCallback(() => {
    HapticEngine.selection();
    setDeniedRouteNotice(null);
    setHistory([]);
    setActiveRoute('dashboard');
    OmniRoute.navigate('dashboard');
  }, []);

  const saveCurrentScroll = useCallback((scrollTop: number) => {
    saveRouteScroll(activeRef.current, scrollTop);
  }, []);

  const getSavedScroll = useCallback((route: AppRouteId) => {
    return route === 'dashboard' ? 0 : getRouteScroll(route);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      if (overlayBackRef.current?.()) {
        return;
      }
      if (activeRef.current !== 'dashboard') {
        goBack();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [goBack]);

  const value = useMemo<NavigationContextValue>(
    () => ({
      activeRoute,
      history,
      canGoBack: history.length > 0 || activeRoute !== 'dashboard',
      deniedRouteNotice,
      clearDeniedNotice: () => setDeniedRouteNotice(null),
      navigate,
      goBack,
      resetToHome,
      saveCurrentScroll,
      getSavedScroll,
    }),
    [
      activeRoute,
      history,
      deniedRouteNotice,
      navigate,
      goBack,
      resetToHome,
      saveCurrentScroll,
      getSavedScroll,
    ]
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error('useNavigation must be used inside NavigationProvider');
  }
  return ctx;
}
