import type { ReactNode } from 'react';
import type { AppRouteId } from '@/lib/navigationStack';

export function FullScreenRoute({
  routeId,
  children,
}: {
  routeId: AppRouteId;
  children: ReactNode;
}) {
  return (
    <section
      key={routeId}
      data-route-screen={routeId}
      className={routeId === 'dashboard' ? 'h-full' : 'animate-fade-in-up pb-2'}
    >
      {children}
    </section>
  );
}
