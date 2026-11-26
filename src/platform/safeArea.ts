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

function readViewportMetrics(): ViewportMetrics {
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

export function useViewportMetrics(): ViewportMetrics {
  const [metrics, setMetrics] = useState<ViewportMetrics>(readViewportMetrics);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setMetrics(readViewportMetrics());

    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);

    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);

  return metrics;
}
