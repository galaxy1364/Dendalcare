import type { SectionId } from '@/lib/sections';
import type { AppRouteId } from '@/lib/navigationStack';

export interface DeepLinkPayload {
  section: AppRouteId;
  recordId?: string;
  subTab?: string;
  query?: string;
  date?: string;
  filters?: Record<string, string>;
}

export const GLOBAL_FOCUS_EVENT = 'minadental-global-focus';

const VALID_SECTIONS = new Set<AppRouteId>([
  'dashboard',
  'services',
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
]);

let pendingDeepLink: DeepLinkPayload | null = null;
const deepLinkListeners = new Set<(payload: DeepLinkPayload) => void>();

export function validateDeepLink(raw: Partial<DeepLinkPayload> | null | undefined): DeepLinkPayload | null {
  if (!raw || !raw.section || !VALID_SECTIONS.has(raw.section)) return null;
  return {
    section: raw.section,
    recordId: raw.recordId ? String(raw.recordId).trim() : undefined,
    subTab: raw.subTab ? String(raw.subTab).trim() : undefined,
    query: raw.query ? String(raw.query).trim() : undefined,
    date: raw.date ? String(raw.date).trim() : undefined,
    filters: raw.filters && typeof raw.filters === 'object' ? { ...raw.filters } : undefined,
  };
}

/**
 * Deterministic deep-link dispatcher (replaces brittle 45ms setTimeout race):
 * Stores the validated payload so newly mounted routes consume it immediately on mount,
 * and notifies active subscribers synchronously.
 */
export function dispatchDeepLink(raw: DeepLinkPayload): DeepLinkPayload | null {
  const validated = validateDeepLink(raw);
  if (!validated) return null;

  pendingDeepLink = validated;
  deepLinkListeners.forEach((cb) => cb(validated));

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<DeepLinkPayload>(GLOBAL_FOCUS_EVENT, { detail: validated }));
  }
  return validated;
}

export function peekPendingDeepLink(section: AppRouteId): DeepLinkPayload | null {
  if (pendingDeepLink && pendingDeepLink.section === section) {
    return pendingDeepLink;
  }
  return null;
}

export function consumePendingDeepLink(section: AppRouteId): DeepLinkPayload | null {
  if (pendingDeepLink && pendingDeepLink.section === section) {
    const val = pendingDeepLink;
    pendingDeepLink = null;
    return val;
  }
  return null;
}

export function clearPendingDeepLink(): void {
  pendingDeepLink = null;
}

export function subscribeDeepLink(
  targetSection: SectionId,
  handler: (payload: DeepLinkPayload) => void
): () => void {
  const pending = consumePendingDeepLink(targetSection);
  if (pending) {
    handler(pending);
  }

  const listener = (payload: DeepLinkPayload) => {
    if (payload.section !== targetSection) return;
    if (pendingDeepLink?.section === targetSection) {
      pendingDeepLink = null;
    }
    handler(payload);
  };

  deepLinkListeners.add(listener);
  return () => {
    deepLinkListeners.delete(listener);
  };
}
