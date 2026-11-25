import type { AppRouteId } from '@/lib/navigationStack';
import type { DeepLinkPayload } from '@/navigation/DeepLinkHandler';

export const ALL_APP_ROUTES: readonly AppRouteId[] = [
  'dashboard',
  'services',
  'customize_services',
  'reports',
  'patients',
  'patient_form',
  'appointments',
  'appointment_form',
  'calendar',
  'treatments',
  'treatment_form',
  'lab',
  'implants',
  'finance',
  'inventory',
  'reminders',
  'staff',
  'messages',
  'settings',
];

const APP_ROUTE_SET = new Set<string>(ALL_APP_ROUTES);

export interface ParsedRouteLocation {
  route: AppRouteId;
  params: Omit<DeepLinkPayload, 'section'>;
}

export function isValidAppRoute(candidate: string | null | undefined): candidate is AppRouteId {
  return Boolean(candidate && APP_ROUTE_SET.has(candidate));
}

/**
 * FIX 08: Encodes every route + deep-link parameters into a shareable, History-API-compatible
 * hash URL (`#/patients?recordId=p1&subTab=finance`) that works consistently across web,
 * GitHub Pages subpaths, PWA standalone mode, and Android WebView.
 */
export function buildRouteHashUrl(
  route: AppRouteId,
  params?: Omit<DeepLinkPayload, 'section'>
): string {
  const path = route === 'dashboard' ? '/' : `/${route}`;
  const sp = new URLSearchParams();
  if (params?.recordId) sp.set('recordId', params.recordId);
  if (params?.subTab) sp.set('subTab', params.subTab);
  if (params?.query) sp.set('query', params.query);
  if (params?.date) sp.set('date', params.date);
  if (params?.filters) {
    for (const [k, v] of Object.entries(params.filters)) {
      if (v) sp.set(`f_${k}`, v);
    }
  }
  const qs = sp.toString();
  return qs ? `#${path}?${qs}` : `#${path}`;
}

/**
 * Parses either a hash string (`#/finance?subTab=checks&recordId=chk_1`) or a full URL/path
 * back into a validated `{ route, params }` object.
 */
export function parseRouteFromUrl(rawHashOrPath: string | null | undefined): ParsedRouteLocation | null {
  if (!rawHashOrPath) return null;
  let cleaned = String(rawHashOrPath).trim();
  const hashIdx = cleaned.indexOf('#');
  if (hashIdx >= 0) {
    cleaned = cleaned.slice(hashIdx + 1);
  }
  if (!cleaned || cleaned === '/') {
    return { route: 'dashboard', params: {} };
  }

  const [rawPath, rawQuery = ''] = cleaned.split('?');
  const segment = rawPath.replace(/^\/+/, '').split('/')[0]?.trim() || '';
  const route: AppRouteId = segment === '' ? 'dashboard' : isValidAppRoute(segment) ? segment : 'dashboard';

  if (segment !== '' && !isValidAppRoute(segment)) {
    return null;
  }

  const sp = new URLSearchParams(rawQuery);
  const filters: Record<string, string> = {};
  sp.forEach((value, key) => {
    if (key.startsWith('f_') && value) {
      filters[key.slice(2)] = value;
    }
  });

  const params: Omit<DeepLinkPayload, 'section'> = {
    recordId: sp.get('recordId') || undefined,
    subTab: sp.get('subTab') || undefined,
    query: sp.get('query') || undefined,
    date: sp.get('date') || undefined,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
  };

  return { route, params };
}

export function readCurrentBrowserRoute(): ParsedRouteLocation | null {
  if (typeof window === 'undefined') return null;
  if (window.location.hash && window.location.hash.length > 1) {
    return parseRouteFromUrl(window.location.hash);
  }
  const pathCandidate = `${window.location.pathname}${window.location.search}`;
  const parsed = parseRouteFromUrl(pathCandidate);
  return parsed && parsed.route !== 'dashboard' ? parsed : null;
}
