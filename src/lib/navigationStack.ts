import type { SectionId } from '@/lib/sections';

/**
 * Navigation Stack & Home Selected Services Manager (V2 / IOS27-OVERRIDE)
 *
 * - AppRouteId extends SectionId with the independent full-screen 'services' directory route.
 * - Preserves per-route vertical scroll positions so Back/Tab navigation keeps context.
 * - Persists and reorders the maximum 4 Selected Services shown on the No-Scroll Home screen.
 */

export type AppRouteId = SectionId | 'services';

export const DEFAULT_SELECTED_HOME_SERVICES: SectionId[] = [
  'patients',
  'appointments',
  'treatments',
  'finance',
];

const SELECTED_HOME_SERVICES_KEY = 'minadental_home_selected_services_v2';
const HOME_SERVICES_EVENT = 'minadental-home-services-updated';

const VALID_SELECTABLE_SERVICES = new Set<SectionId>([
  'patients',
  'appointments',
  'calendar',
  'treatments',
  'lab',
  'implants',
  'finance',
  'inventory',
  'reminders',
  'staff',
  'messages',
  'settings',
]);

const routeScrollOffsets = new Map<AppRouteId, number>();

export function saveRouteScroll(route: AppRouteId, scrollTop: number): void {
  routeScrollOffsets.set(route, Math.max(0, Math.round(scrollTop)));
}

export function getRouteScroll(route: AppRouteId): number {
  return routeScrollOffsets.get(route) ?? 0;
}

export function clearRouteScroll(route: AppRouteId): void {
  routeScrollOffsets.delete(route);
}

export function pushNavRoute(history: AppRouteId[], current: AppRouteId, next: AppRouteId): AppRouteId[] {
  if (current === next) return history;
  return [...history.slice(-14), current];
}

export function popNavRoute(history: AppRouteId[]): { target: AppRouteId; nextHistory: AppRouteId[] } {
  if (history.length === 0) {
    return { target: 'dashboard', nextHistory: [] };
  }
  const copy = [...history];
  const target = copy.pop() || 'dashboard';
  return { target, nextHistory: copy };
}

export function normalizeSelectedHomeServices(ids: readonly string[]): SectionId[] {
  const unique: SectionId[] = [];
  for (const raw of ids) {
    const id = raw as SectionId;
    if (VALID_SELECTABLE_SERVICES.has(id) && !unique.includes(id)) {
      unique.push(id);
    }
    if (unique.length >= 4) break;
  }
  for (const fallback of DEFAULT_SELECTED_HOME_SERVICES) {
    if (unique.length >= 4) break;
    if (!unique.includes(fallback)) unique.push(fallback);
  }
  return unique.slice(0, 4);
}

export function loadSelectedHomeServices(): SectionId[] {
  if (typeof window === 'undefined') return [...DEFAULT_SELECTED_HOME_SERVICES];
  try {
    const raw = localStorage.getItem(SELECTED_HOME_SERVICES_KEY);
    if (!raw) return [...DEFAULT_SELECTED_HOME_SERVICES];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return normalizeSelectedHomeServices(parsed);
    }
  } catch {
    // ignore storage parse failure
  }
  return [...DEFAULT_SELECTED_HOME_SERVICES];
}

export function saveSelectedHomeServices(ids: readonly string[]): SectionId[] {
  const normalized = normalizeSelectedHomeServices(ids);
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SELECTED_HOME_SERVICES_KEY, JSON.stringify(normalized));
      window.dispatchEvent(new CustomEvent(HOME_SERVICES_EVENT, { detail: normalized }));
    }
  } catch {
    // ignore storage errors
  }
  return normalized;
}

export function reorderSelectedHomeServices(
  list: readonly SectionId[],
  fromIdx: number,
  toIdx: number
): SectionId[] {
  if (
    fromIdx < 0 ||
    toIdx < 0 ||
    fromIdx >= list.length ||
    toIdx >= list.length ||
    fromIdx === toIdx
  ) {
    return [...list];
  }
  const next = [...list];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next.slice(0, 4);
}

export function subscribeHomeServicesChange(cb: (services: SectionId[]) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (ev: Event) => {
    const detail = (ev as CustomEvent<SectionId[]>)?.detail;
    cb(Array.isArray(detail) ? normalizeSelectedHomeServices(detail) : loadSelectedHomeServices());
  };
  window.addEventListener(HOME_SERVICES_EVENT, handler);
  return () => window.removeEventListener(HOME_SERVICES_EVENT, handler);
}
