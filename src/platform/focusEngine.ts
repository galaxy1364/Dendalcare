import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// Track stacked modal traps so only the topmost open overlay intercepts Escape/Tab
const activeModalStack: symbol[] = [];

export function hasActiveModalFocusTrap(): boolean {
  return activeModalStack.length > 0;
}

export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return nodes.filter((el) => {
    if (el.closest('[aria-hidden="true"], [inert], [hidden]')) return false;
    if (el.tabIndex < 0 || el.getClientRects().length === 0) return false;
    const style = typeof window !== 'undefined' ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return true;
  });
}

export interface FocusTrapOptions {
  onEscape?: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
  restoreFocus?: boolean;
}

/**
 * GE-0003 Unified Focus Engine
 * - Traps Tab / Shift+Tab inside active dialogs, sheets, drawers, and command centers
 * - Guarantees topmost overlay handles Escape cleanly without closing parent layers prematurely
 * - Restores keyboard focus to the invoking trigger on unmount/close (WCAG 2.2 AA 2.4.3 / 2.1.2)
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  options: FocusTrapOptions = {}
): void {
  const { onEscape, initialFocusRef, restoreFocus = true } = options;
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    if (!active || typeof document === 'undefined') return;

    const token = Symbol('modal_focus_trap');
    activeModalStack.push(token);
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const rafId = requestAnimationFrame(() => {
      if (activeModalStack[activeModalStack.length - 1] !== token) return;
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus({ preventScroll: true });
        return;
      }
      const focusables = getFocusableElements(containerRef.current);
      if (!containerRef.current?.contains(document.activeElement)) {
        (focusables[0] ?? containerRef.current)?.focus({ preventScroll: true });
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only topmost modal in stack processes Escape/Tab trapping
      if (activeModalStack[activeModalStack.length - 1] !== token) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        escapeRef.current?.();
        return;
      }

      if (e.key === 'Tab') {
        const focusables = getFocusableElements(containerRef.current);
        if (focusables.length === 0) {
          e.preventDefault();
          containerRef.current?.focus({ preventScroll: true });
          return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const current = document.activeElement as HTMLElement | null;

        if (e.shiftKey) {
          if (!current || current === first || !containerRef.current?.contains(current)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (!current || current === last || !containerRef.current?.contains(current)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', handleKeyDown, true);
      const wasTop = activeModalStack[activeModalStack.length - 1] === token;
      const idx = activeModalStack.lastIndexOf(token);
      if (idx !== -1) activeModalStack.splice(idx, 1);

      const remainingTop = activeModalStack[activeModalStack.length - 1];
      if (wasTop && restoreFocus && previouslyFocused && typeof previouslyFocused.focus === 'function') {
        requestAnimationFrame(() => {
          if (activeModalStack[activeModalStack.length - 1] === remainingTop && document.contains(previouslyFocused)) {
            previouslyFocused.focus({ preventScroll: true });
          }
        });
      }
    };
  }, [active, containerRef, initialFocusRef, restoreFocus]);
}

/**
 * RTL-aware keyboard roving focus for horizontal toolbars and segmented tablists.
 */
export function handleRovingToolbarKeyDown(
  e: React.KeyboardEvent<HTMLElement>,
  itemSelector = 'button:not([disabled]), [role="tab"]:not([disabled])'
): void {
  const container = e.currentTarget;
  const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
  if (items.length <= 1) return;

  const isRtl =
    container.dir === 'rtl' ||
    (typeof document !== 'undefined' && document.documentElement.dir === 'rtl');

  const currentIdx = items.indexOf(document.activeElement as HTMLElement);
  if (currentIdx === -1) return;

  let nextIdx = currentIdx;
  if (e.key === 'ArrowRight') {
    nextIdx = isRtl
      ? (currentIdx - 1 + items.length) % items.length
      : (currentIdx + 1) % items.length;
  } else if (e.key === 'ArrowLeft') {
    nextIdx = isRtl
      ? (currentIdx + 1) % items.length
      : (currentIdx - 1 + items.length) % items.length;
  } else if (e.key === 'Home') {
    nextIdx = 0;
  } else if (e.key === 'End') {
    nextIdx = items.length - 1;
  } else {
    return;
  }

  e.preventDefault();
  items[nextIdx]?.focus();
}
