import type { SectionId } from '@/lib/sections';

export interface GlobalFocusPayload {
  section: SectionId;
  query?: string;
  subTab?: string;
  date?: string;
  recordId?: string;
}

export const GLOBAL_FOCUS_EVENT = 'minadental-global-focus';

/**
 * Dispatches a global deep-link focus payload so any module opens
 * directly to the searched patient, check, installment, lab order, implant, or appointment.
 */
export function emitGlobalFocus(payload: GlobalFocusPayload) {
  if (typeof window === 'undefined') return;
  // Delay slightly so newly mounted section attaches its listener first
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent<GlobalFocusPayload>(GLOBAL_FOCUS_EVENT, { detail: payload }));
  }, 45);
}

export function subscribeGlobalFocus(
  targetSection: SectionId,
  handler: (payload: GlobalFocusPayload) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (ev: Event) => {
    const detail = (ev as CustomEvent<GlobalFocusPayload>)?.detail;
    if (!detail || detail.section !== targetSection) return;
    handler(detail);
  };
  window.addEventListener(GLOBAL_FOCUS_EVENT, listener);
  return () => window.removeEventListener(GLOBAL_FOCUS_EVENT, listener);
}
