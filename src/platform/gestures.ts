import type { TouchEvent } from 'react';

export interface EdgeBackTracker {
  active: boolean;
  startX: number;
  startY: number;
}

/**
 * Checks whether a touch event starts inside the RTL back-swipe corridor
 * while avoiding the rightmost 10px OS system gesture strip and horizontal scroll containers.
 */
export function beginRtlEdgeBackSwipe(
  e: TouchEvent<HTMLElement>,
  enabled: boolean
): EdgeBackTracker | null {
  if (!enabled || typeof window === 'undefined') return null;
  const touch = e.touches[0];
  if (!touch) return null;

  const target = e.target as HTMLElement | null;
  if (
    target?.closest(
      '[data-no-edge-back], .overflow-x-auto, [role="slider"], input, textarea, select'
    )
  ) {
    return null;
  }

  const distFromRight = window.innerWidth - touch.clientX;
  // Avoid conflict with OS system edge gestures (0..10px) while supporting 10..44px RTL swipe back
  if (distFromRight >= 10 && distFromRight <= 44) {
    return { active: true, startX: touch.clientX, startY: touch.clientY };
  }
  return null;
}

export function shouldCompleteRtlEdgeBackSwipe(
  tracker: EdgeBackTracker | null,
  e: TouchEvent<HTMLElement>
): boolean {
  if (!tracker?.active) return false;
  const touch = e.changedTouches[0];
  if (!touch) return false;
  const dx = tracker.startX - touch.clientX; // Moving right-to-left yields positive dx in RTL back
  const dy = Math.abs(touch.clientY - tracker.startY);
  return dx > 64 && dy < 48;
}
