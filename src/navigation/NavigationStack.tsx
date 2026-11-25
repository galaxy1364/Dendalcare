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
import {
  buildRouteHashUrl,
  isValidAppRoute,
  parseRouteFromUrl,
  readCurrentBrowserRoute,
} from '@/navigation/urlRouter';
import { canAccessRoute } from '@/services/permissions/accessControl';
import type { ClinicUserRole } from '@/lib/cloudSyncEngine';

const routeFilterCache = new Map<AppRouteId, Record<string, string>>();
const routeDraftCache = new Map<AppRouteId, Record<string, unknown>>();

export function saveRouteFilters(route: AppRouteId, filters: Record<string, string>): void {
  routeFilterCache.set(route, { ...filters });
}

export function getRouteFilters(route: AppRouteId): Record<string, string> | null {
  return routeFilterCache.get(route) ?? null;
}

/**
 * FIX 08: Preserve in-progress form draft state across Back/Forward & route transitions.
 */
export function saveRouteDraft<T extends Record<string, unknown>>(route: AppRouteId, draft: T): void {
  routeDraftCache.set(route, { ...draft });
}

export function getRouteDraft<T extends Record<string, unknown>>(route: AppRouteId): T | null {
  return (routeDraftCache.get(route) as T | undefined) ?? null;
}

export function clearRouteDraft(route: AppRouteId): void {
  routeDraftCache.delete(route);
}

export function clearAllRouteDrafts(): void {
  routeDraftCache.clear();
  routeFilterCache.clear();
}

export interface NavigationContextValue {
  activeRoute: AppRouteId;
  activeParams: Omit<DeepLinkPayload, 'section'>;
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

interface HistoryRouteState {
  minadental: true;
  route: AppRouteId;
  params?: Omit<DeepLinkPayload, 'section'>;
  depth: number;
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
  const initialLocation = useMemo(() => {
    const fromBrowser = readCurrentBrowserRoute();
    if (fromBrowser && canAccessRoute(userRole, fromBrowser.route)) {
      return fromBrowser;
    }
    const restored = OmniRoute.getCurrentRoute() as AppRouteId;
    if (restored && isValidAppRoute(restored) && canAccessRoute(userRole, restored)) {
      return { route: restored, params: {} as Omit<DeepLinkPayload, 'section'> };
    }
    return { route: 'dashboard' as AppRouteId, params: {} as Omit<DeepLinkPayload, 'section'> };
  }, []);

  const [activeRoute, setActiveRoute] = useState<AppRouteId>(initialLocation.route);
  const [activeParams, setActiveParams] = useState<Omit<DeepLinkPayload, 'section'>>(
    initialLocation.params
  );
  const [history, setHistory] = useState<AppRouteId[]>([]);
  const [deniedRouteNotice, setDeniedRouteNotice] = useState<AppRouteId | null>(null);

  const activeRef = useRef(activeRoute);
  const historyDepthRef = useRef(0);
  const overlayBackRef = useRef(onBeforeOverlayBack);
  overlayBackRef.current = onBeforeOverlayBack;
  activeRef.current = activeRoute;

  // Hydrate initial URL and deep-link payload on mount
  useEffect(() => {
    if (
      initialLocation.params &&
      Object.values(initialLocation.params).some((v) => v !== undefined)
    ) {
      dispatchDeepLink({ section: initialLocation.route, ...initialLocation.params });
    }
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      try {
        const state: HistoryRouteState = {
          minadental: true,
          route: initialLocation.route,
          params: initialLocation.params,
          depth: 0,
        };
        window.history.replaceState(
          state,
          '',
          buildRouteHashUrl(initialLocation.route, initialLocation.params)
        );
      } catch {
        // ignore sandboxed history
      }
    }
  }, [initialLocation]);

  // Re-evaluate active route if role switches to one without access
  useEffect(() => {
    if (!canAccessRoute(userRole, activeRoute)) {
      setDeniedRouteNotice(activeRoute);
      setActiveRoute('dashboard');
      setActiveParams({});
      setHistory([]);
      historyDepthRef.current = 0;
      OmniRoute.navigate('dashboard');
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        try {
          window.history.replaceState(
            { minadental: true, route: 'dashboard', params: {}, depth: 0 } satisfies HistoryRouteState,
            '',
            buildRouteHashUrl('dashboard')
          );
        } catch {
          // ignore
        }
      }
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

      const cleanParams = deepLink ? { ...deepLink } : {};
      if (deepLink) {
        dispatchDeepLink({ section: route, ...cleanParams });
      }

      const nextHashUrl = buildRouteHashUrl(route, cleanParams);
      const isRouteOrParamChanged =
        route !== activeRef.current ||
        (typeof window !== 'undefined' && window.location.hash !== nextHashUrl);

      if (isRouteOrParamChanged) {
        if (route !== activeRef.current) {
          setHistory((prev) => pushNavRoute(prev, activeRef.current, route));
        }
        historyDepthRef.current += 1;
        if (typeof window !== 'undefined' && window.history?.pushState) {
          try {
            const state: HistoryRouteState = {
              minadental: true,
              route,
              params: cleanParams,
              depth: historyDepthRef.current,
            };
            window.history.pushState(state, '', nextHashUrl);
          } catch {
            // ignore
          }
        }
      }

      setActiveRoute(route);
      setActiveParams(cleanParams);
      OmniRoute.navigate(route as SectionId);
      return true;
    },
    [userRole]
  );

  const goBack = useCallback(() => {
    HapticEngine.selection();
    setDeniedRouteNotice(null);

    // Unified History Stack: prefer browser history.back() when we pushed entries so Back & Forward stay 100% synced
    if (typeof window !== 'undefined' && historyDepthRef.current > 0) {
      window.history.back();
      return;
    }

    setHistory((prev) => {
      const { target, nextHistory } = popNavRoute(prev);
      const safeTarget = canAccessRoute(userRole, target) ? target : 'dashboard';
      setActiveRoute(safeTarget);
      setActiveParams({});
      OmniRoute.navigate(safeTarget as SectionId);
      if (typeof window !== 'undefined' && window.history?.replaceState) {
        try {
          window.history.replaceState(
            { minadental: true, route: safeTarget, params: {}, depth: 0 } satisfies HistoryRouteState,
            '',
            buildRouteHashUrl(safeTarget)
          );
        } catch {
          // ignore
        }
      }
      return nextHistory;
    });
  }, [userRole]);

  const resetToHome = useCallback(() => {
    HapticEngine.selection();
    setDeniedRouteNotice(null);
    setHistory([]);
    setActiveRoute('dashboard');
    setActiveParams({});
    historyDepthRef.current = 0;
    OmniRoute.navigate('dashboard');
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      try {
        window.history.replaceState(
          { minadental: true, route: 'dashboard', params: {}, depth: 0 } satisfies HistoryRouteState,
          '',
          buildRouteHashUrl('dashboard')
        );
      } catch {
        // ignore
      }
    }
  }, []);

  const saveCurrentScroll = useCallback((scrollTop: number) => {
    saveRouteScroll(activeRef.current, scrollTop);
  }, []);

  const getSavedScroll = useCallback((route: AppRouteId) => {
    return route === 'dashboard' ? 0 : getRouteScroll(route);
  }, []);

  // Unified Browser Back/Forward + Android Back + Hash Navigation listener
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncFromHistoryEvent = (ev?: PopStateEvent) => {
      if (overlayBackRef.current?.()) {
        // Re-push current URL so closing an overlay doesn't leave the current page
        try {
          window.history.pushState(
            {
              minadental: true,
              route: activeRef.current,
              params: activeParams,
              depth: historyDepthRef.current,
            } satisfies HistoryRouteState,
            '',
            buildRouteHashUrl(activeRef.current, activeParams)
          );
        } catch {
          // ignore
        }
        return;
      }

      const rawState = ev?.state as Partial<HistoryRouteState> | null | undefined;
      const parsedFromUrl = parseRouteFromUrl(window.location.hash);

      let nextRoute: AppRouteId = 'dashboard';
      let nextParams: Omit<DeepLinkPayload, 'section'> = {};

      if (rawState?.minadental && isValidAppRoute(rawState.route)) {
        nextRoute = rawState.route;
        nextParams = rawState.params ? { ...rawState.params } : {};
        historyDepthRef.current = Math.max(0, Number(rawState.depth ?? 0));
      } else if (parsedFromUrl) {
        nextRoute = parsedFromUrl.route;
        nextParams = parsedFromUrl.params;
        historyDepthRef.current = Math.max(0, historyDepthRef.current - 1);
      } else {
        historyDepthRef.current = 0;
      }

      const safeRoute = canAccessRoute(userRole, nextRoute) ? nextRoute : 'dashboard';
      if (safeRoute !== nextRoute) {
        setDeniedRouteNotice(nextRoute);
      } else {
        setDeniedRouteNotice(null);
      }

      if (nextParams && Object.values(nextParams).some((v) => v !== undefined)) {
        dispatchDeepLink({ section: safeRoute, ...nextParams });
      }

      setHistory((prev) => {
        if (safeRoute === 'dashboard') return [];
        const idx = prev.lastIndexOf(safeRoute);
        return idx >= 0 ? prev.slice(0, idx) : prev.slice(0, -1);
      });
      setActiveRoute(safeRoute);
      setActiveParams(nextParams);
      OmniRoute.navigate(safeRoute as SectionId);
    };

    const onPopState = (ev: PopStateEvent) => syncFromHistoryEvent(ev);
    const onHashChange = () => syncFromHistoryEvent();

    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [userRole, activeParams]);

  const value = useMemo<NavigationContextValue>(
    () => ({
      activeRoute,
      activeParams,
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
      activeParams,
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
