import { useEffect, useState } from 'react';
import { getAdaptiveBreakpoint, type AdaptiveWindowClass } from './capabilities';

export type ViewportBreakpoint = 'mobile' | 'tablet' | 'desktop';

export interface ViewportMetrics {
  width: number;
  height: number;
  visualHeight: number;
  keyboardOpen: boolean;
  keyboardInsetPx: number;
  breakpoint: ViewportBreakpoint;
  adaptiveClass: AdaptiveWindowClass;
  isCompactHeight: boolean;
  hasNextAppointmentRoom: boolean;
}

export function readViewportMetrics(): ViewportMetrics {
  if (typeof window === 'undefined') {
    return {
      width: 390,
      height: 844,
      visualHeight: 844,
      keyboardOpen: false,
      keyboardInsetPx: 0,
      breakpoint: 'mobile',
      adaptiveClass: 'compact',
      isCompactHeight: false,
      hasNextAppointmentRoom: true,
    };
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const visualHeight = window.visualViewport?.height ?? height;
  const keyboardInsetPx = Math.max(0, Math.round(height - visualHeight));
  const keyboardOpen = keyboardInsetPx > 130;
  const breakpoint: ViewportBreakpoint =
    width >= 1024 ? 'desktop' : width >= 768 ? 'tablet' : 'mobile';

  return {
    width,
    height,
    visualHeight,
    keyboardOpen,
    keyboardInsetPx: keyboardOpen ? keyboardInsetPx : 0,
    breakpoint,
    adaptiveClass: getAdaptiveBreakpoint(width),
    isCompactHeight: height < 660,
    hasNextAppointmentRoom: height >= 700,
  };
}

/**
 * Synchronizes live viewport class and virtual-keyboard safe-area inset tokens
 * onto documentElement so CSS layouts, sheets, sticky form actions, and bottom docks
 * react deterministically across iOS, iPadOS, Android, Windows, and PWA.
 */
export function syncViewportToDocument(metrics: ViewportMetrics): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-keyboard-open', metrics.keyboardOpen ? 'true' : 'false');
  root.setAttribute('data-window-class', metrics.adaptiveClass);
  root.setAttribute('data-viewport-breakpoint', metrics.breakpoint);
  root.style.setProperty('--keyboard-inset-bottom', `${metrics.keyboardInsetPx}px`);
  root.style.setProperty('--viewport-visual-height', `${Math.round(metrics.visualHeight)}px`);
}

export function useViewportMetrics(): ViewportMetrics {
  const [metrics, setMetrics] = useState<ViewportMetrics>(readViewportMetrics);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => {
      const next = readViewportMetrics();
      syncViewportToDocument(next);
      setMetrics(next);
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);

  return metrics;
}
