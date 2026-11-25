import { useEffect, useState } from 'react';

export type ViewportBreakpoint = 'mobile' | 'tablet' | 'desktop';

export interface ViewportMetrics {
  width: number;
  height: number;
  visualHeight: number;
  keyboardOpen: boolean;
  breakpoint: ViewportBreakpoint;
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
      breakpoint: 'mobile',
      isCompactHeight: false,
      hasNextAppointmentRoom: true,
    };
  }
  const width = window.innerWidth;
  const height = window.innerHeight;
  const visualHeight = window.visualViewport?.height ?? height;
  const keyboardOpen = height - visualHeight > 130;
  const breakpoint: ViewportBreakpoint =
    width >= 1024 ? 'desktop' : width >= 768 ? 'tablet' : 'mobile';

  return {
    width,
    height,
    visualHeight,
    keyboardOpen,
    breakpoint,
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
