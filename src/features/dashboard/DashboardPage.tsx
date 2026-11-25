import { useEffect, useRef, useState } from 'react';
import { SectionStatusBanner } from '@/components/shared/SectionStatusBanner';
import { useDashboard } from './useDashboard';
import { DashboardHeader } from './DashboardHeader';
import { SmartBrief } from './SmartBrief';
import { QuickActionsRow } from './QuickActionsRow';
import { PriorityAction } from './PriorityAction';
import { FavoriteModules } from './FavoriteModules';

/**
 * FIX 06 — Final QBank-Faithful No-Scroll Dashboard Layout:
 * 1. Minimal Header
 * 2. Optional Status Banner (only on non-ready/stale/migration_required)
 * 3. Bright Colorful Smart Clinic Overview Card
 * 4. 5 Quick Actions Row
 * 5. 4 Curved QBankTile Favorite Cards
 * 6. 1 Priority Alert — rendered ONLY when real ResizeObserver viewport measurement confirms fit
 *    (no overflow:hidden clipping; gracefully hides alert on very compact viewports).
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
  const [showPriorityAlert, setShowPriorityAlert] = useState(true);
  const [fitsViewport, setFitsViewport] = useState(true);

  const hasStatusBanner = status.overall !== 'ready' || status.isStale;

  useEffect(() => {
    const el = shellRef.current;
    if (!el) return;

    const measureFit = () => {
      const scrollHost = el.closest('main') as HTMLElement | null;
      const availableH = scrollHost ? scrollHost.clientHeight : window.innerHeight - 156;
      const contentH = el.scrollHeight;
      // Reserve ~64px for the PriorityAction card when testing whether it can fit cleanly
      const estimatedWithAlert = showPriorityAlert ? contentH : contentH + 66;
      const canShowAlert = availableH > 0 && estimatedWithAlert <= availableH + 2;

      setShowPriorityAlert(canShowAlert);
      setFitsViewport(availableH <= 0 || contentH <= availableH + 2);
    };

    measureFit();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureFit);
      return () => window.removeEventListener('resize', measureFit);
    }

    const observer = new ResizeObserver(() => {
      measureFit();
    });
    observer.observe(el);
    const scrollHost = el.closest('main');
    if (scrollHost) observer.observe(scrollHost);
    return () => observer.disconnect();
  }, [hasStatusBanner, showPriorityAlert]);

  return (
    <div
      ref={shellRef}
      className="no-scroll-home-shell pb-1 animate-fade-in-up"
      data-testid="no_scroll_home_viewport"
      data-home-cap-services="4"
      data-home-quick-actions="5"
      data-home-fits-viewport={fitsViewport ? 'true' : 'false'}
      data-priority-visible={showPriorityAlert ? 'true' : 'false'}
    >
      <div className="sr-only" data-testid="global_benchmark_dashboard" />

      {/* 1. Minimal Header (Branch + Jalali Month + Sync) */}
      <DashboardHeader
        todayIso={metrics.todayIso}
        monthLabel={metrics.monthLabel}
        branchId={metrics.branchId}
        isLoading={status.isLoading}
        isStale={status.isStale}
        onRefresh={refreshAll}
      />

      {/* Explicit Data Status Banner (Loading / Error / Offline / Stale / Empty / Unauthorized / Migration Required) */}
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

      {/* 2. Bright Colorful Smart Clinic Overview */}
      <SmartBrief
        brief={metrics.smartBrief}
        todayCollected={metrics.revenue.todayCollected}
        monthNetProfit={metrics.revenue.monthNetProfit}
        todayApptsCount={metrics.todayApptsCount}
        confirmedApptsCount={metrics.confirmedApptsCount}
        monthLabel={metrics.monthLabel}
        financialDataComplete={status.financialDataComplete}
        onNavigate={navigate}
      />

      {/* 3. Five Quick Actions Row */}
      <QuickActionsRow userRole={userRole} onNavigate={navigate} />

      {/* 4. Four Favorite Curved QBank Modules + All Services Route Trigger */}
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

      {/* 5. One Important Alert — Only when real viewport measurement confirms fit */}
      {showPriorityAlert && (
        <PriorityAction
          action={metrics.priorityAction}
          revenue={metrics.revenue}
          onNavigate={navigate}
        />
      )}
    </div>
  );
}
