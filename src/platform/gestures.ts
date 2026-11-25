import type { TouchEvent } from 'react';

export interface EdgeBackTracker {
  active: boolean;
  startX: number;
  startY: number;
  cancelled?: boolean;
}

export interface RtlEdgeSwipeOptions {
  hasUnsavedDraft?: boolean;
  isModalOpen?: boolean;
  viewportWidth?: number;
}

export function hasActiveDomGestureGuard(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(
    document.querySelector(
      '[data-unsaved-draft="true"], [data-gesture-lock="true"], [role="dialog"][aria-modal="true"]'
    )
  );
}

/**
 * Checks whether a touch event starts inside the RTL back-swipe corridor
 * while avoiding the rightmost 10px OS system gesture strip, horizontal scrollers,
 * active modal dialogs, and unsaved clinical/form drafts.
 */
export function beginRtlEdgeBackSwipe(
  e: Pick<TouchEvent<HTMLElement>, 'touches' | 'target'>,
  enabled: boolean,
  opts?: RtlEdgeSwipeOptions
): EdgeBackTracker | null {
  if (!enabled) return null;
  if (opts?.hasUnsavedDraft || opts?.isModalOpen) return null;
  if (hasActiveDomGestureGuard()) return null;

  const viewportWidth =
    opts?.viewportWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 0);
  if (!viewportWidth) return null;

  const touch = e.touches[0];
  if (!touch) return null;

  const target = e.target as HTMLElement | null;
  if (
    target &&
    typeof target.closest === 'function' &&
    target.closest(
      '[data-no-edge-back], [data-unsaved-draft="true"], .overflow-x-auto, [role="slider"], input, textarea, select'
    )
  ) {
    return null;
  }

  const distFromRight = viewportWidth - touch.clientX;
  // Avoid conflict with OS system edge gestures (0..10px) while supporting 10..44px RTL swipe back
  if (distFromRight >= 10 && distFromRight <= 44) {
    return { active: true, startX: touch.clientX, startY: touch.clientY, cancelled: false };
  }
  return null;
}

export function cancelRtlEdgeBackSwipe(tracker: EdgeBackTracker | null): EdgeBackTracker | null {
  if (!tracker) return null;
  tracker.active = false;
  tracker.cancelled = true;
  return null;
}

export function shouldCompleteRtlEdgeBackSwipe(
  tracker: EdgeBackTracker | null,
  e: Pick<TouchEvent<HTMLElement>, 'changedTouches'>,
  opts?: Pick<RtlEdgeSwipeOptions, 'hasUnsavedDraft' | 'isModalOpen'>
): boolean {
  if (!tracker?.active || tracker.cancelled) return false;
  if (opts?.hasUnsavedDraft || opts?.isModalOpen || hasActiveDomGestureGuard()) return false;
  const touch = e.changedTouches[0];
  if (!touch) return false;
  const dx = tracker.startX - touch.clientX; // Moving right-to-left yields positive dx in RTL back
  const dy = Math.abs(touch.clientY - tracker.startY);
  return dx > 64 && dy < 48;
}
