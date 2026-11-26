import { useEffect, useRef, useState } from 'react';
import { SectionStatusBanner } from '@/components/shared/SectionStatusBanner';
import { useDashboard } from './useDashboard';
import { SmartBrief } from './SmartBrief';
import { QuickActionsRow } from './QuickActionsRow';
import { PriorityAction } from './PriorityAction';
import { FavoriteModules } from './FavoriteModules';

const PRIORITY_ALERT_RESERVED_HEIGHT = 76;
const HYSTERESIS_PX = 14;

/**
 * V4 QBank-Faithful No-Scroll Dashboard Layout:
 * 1. Single unified header owned by AppShell (zero duplicate DashboardHeader strip)
 * 2. Optional Status Banner (only on non-ready/stale/partial/locked_offline/migration_required)
 * 3. Bright Colorful Smart Clinic Overview Card (includes Jalali date, 1-tap refresh, & compact urgent pill fallback)
 * 4. 5 Quick Actions Row
 * 5. 4 Curved QBankTile Favorite Cards
 * 6. 1 Priority Alert — controlled by hysteresis-stabilized ResizeObserver (zero oscillation loop)
 */
export function DashboardPage() {
  const {
    metrics,
    status,
    refreshAll,
    selectedServices,
    draggingIndex,
    setDraggingIndex,
    handleReorderDrop,
    handleMoveToFirst,
    navigate,
    userRole,
  } = useDashboard();

  const shellRef = useRef<HTMLDivElement>(null);
  const showPriorityRef = useRef(true);
  const [showPriorityAlert, setShowPriorityAlert] = useState(true);
  const [fitsViewport, setFitsViewport] = useState(true);

  const hasStatusBanner = status.overall !== 'ready' || status.isStale;

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;

    let rafId = 0;

    const measureFit = () => {
      const scrollHost = el.closest('main') as HTMLElement | null;
      const availableH = scrollHost ? scrollHost.clientHeight : window.innerHeight - 156;
      if (availableH <= 0) return;

      const contentH = el.scrollHeight;
      const currentlyShowing = showPriorityRef.current;

      // Apply hysteresis so toggling the alert NEVER enters a ResizeObserver oscillation loop
      let nextShow = currentlyShowing;
      if (currentlyShowing) {
        if (contentH > availableH + 2) {
          nextShow = false;
        }
      } else {
        if (contentH + PRIORITY_ALERT_RESERVED_HEIGHT + HYSTERESIS_PX <= availableH) {
          nextShow = true;
        }
      }

      if (nextShow !== currentlyShowing) {
        showPriorityRef.current = nextShow;
        setShowPriorityAlert(nextShow);
      }

      const nextFits = contentH <= availableH + 2;
      setFitsViewport((prev) => (prev === nextFits ? prev : nextFits));
    };

    const scheduleMeasure = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measureFit);
    };

    scheduleMeasure();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', scheduleMeasure);
      return () => {
        if (rafId) cancelAnimationFrame(rafId);
        window.removeEventListener('resize', scheduleMeasure);
      };
    }

    const observer = new ResizeObserver(scheduleMeasure);
    const scrollHost = el.closest('main');
    if (scrollHost) observer.observe(scrollHost);
    observer.observe(el);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [hasStatusBanner]);

  return (
    <div
      ref={shellRef}
      className="no-scroll-home-shell pb-1 animate-fade-in-up"
      data-testid="no_scroll_home_viewport"
      data-home-cap-services="4"
      data-home-quick-actions="5"
      data-home-fits-viewport={fitsViewport ? 'true' : 'false'}
      data-compact-scroll-mode={fitsViewport ? 'false' : 'true'}
      data-priority-visible={showPriorityAlert ? 'true' : 'false'}
      data-data-source-mode={metrics.dataSourceMode}
    >
      <div className="sr-only" data-testid="global_benchmark_dashboard" />

      {/* Explicit Data Status Banner (Loading / Error / Offline / Locked Offline / Partial / Stale / Empty / Unauthorized / Migration Required) */}
      {hasStatusBanner && (
        <SectionStatusBanner
          status={status.overall}
          isStale={status.isStale}
          errorMessage={status.errorMessage}
          migrationTables={status.migrationRequiredTables}
          emptyText="هنوز اطلاعاتی برای این شعبه ثبت نشده است."
          onRetry={refreshAll}
        />
      )}

      {/* Intelligent Responsive Bento Grid (Mobile: QBank vertical stack • Desktop/Ultrawide: 12-col Bento) */}
      <div
        className="flex flex-col gap-2 lg:grid lg:grid-cols-12 lg:gap-4 lg:items-start flex-1"
        data-testid="dashboard_adaptive_bento_grid"
      >
        <div className="flex flex-col gap-2 lg:col-span-5 xl:col-span-5 min-w-0">
          {/* 1. Bright Colorful Smart Clinic Overview (with concise date, refresh control, & compact urgent fallback) */}
          <SmartBrief
            brief={metrics.smartBrief}
            todayIso={metrics.todayIso}
            todayCollected={metrics.revenue.todayCollected}
            monthNetProfit={metrics.revenue.monthNetProfit}
            todayApptsCount={metrics.todayApptsCount}
            confirmedApptsCount={metrics.confirmedApptsCount}
            monthLabel={metrics.monthLabel}
            financialDataComplete={status.financialDataComplete}
            isLoading={status.isLoading}
            hiddenUrgentAction={
              !showPriorityAlert && metrics.priorityAction.urgent ? metrics.priorityAction : null
            }
            onRefresh={refreshAll}
            onNavigate={navigate}
          />

          {/* 4. One Important Alert — Shown on desktop Bento column or on mobile when viewport fits */}
          {showPriorityAlert && (
            <div className="hidden lg:block">
              <PriorityAction
                action={metrics.priorityAction}
                revenue={metrics.revenue}
                onNavigate={navigate}
              />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 lg:col-span-7 xl:col-span-7 min-w-0">
          {/* 2. Five Quick Actions Row */}
          <QuickActionsRow userRole={userRole} onNavigate={navigate} />

          {/* 3. Four Favorite Curved QBank Modules + All Services Route Trigger */}
          <FavoriteModules
            selectedServices={selectedServices}
            serviceValues={metrics.serviceValues}
            draggingIndex={draggingIndex}
            onDragStart={setDraggingIndex}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleReorderDrop}
            onDragEnd={() => setDraggingIndex(null)}
            onMoveToFirst={handleMoveToFirst}
            onNavigate={navigate}
          />

          {/* Mobile Priority Alert Slot */}
          {showPriorityAlert && (
            <div className="lg:hidden">
              <PriorityAction
                action={metrics.priorityAction}
                revenue={metrics.revenue}
                onNavigate={navigate}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
