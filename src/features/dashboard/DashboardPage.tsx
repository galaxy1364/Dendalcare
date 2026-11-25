import { SectionStatusBanner } from '@/components/shared/SectionStatusBanner';
import { useDashboard } from './useDashboard';
import { DashboardHeader } from './DashboardHeader';
import { SmartBrief } from './SmartBrief';
import { CompactKPIGrid } from './CompactKPIGrid';
import { PriorityAction } from './PriorityAction';
import { FavoriteModules } from './FavoriteModules';
import { NextAppointment } from './NextAppointment';

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
    showNextAppointmentCard,
    navigate,
  } = useDashboard();

  return (
    <div
      className="no-scroll-home-shell pb-1 animate-fade-in-up"
      data-testid="no_scroll_home_viewport"
      data-home-cap-indicators="4"
      data-home-cap-services="4"
    >
      <div className="sr-only" data-testid="global_benchmark_dashboard" />

      {/* 1. Compact Header (Branch + Jalali Month + Sync) */}
      <DashboardHeader
        todayIso={metrics.todayIso}
        monthLabel={metrics.monthLabel}
        branchId={metrics.branchId}
        isLoading={status.isLoading}
        isStale={status.isStale}
        onRefresh={refreshAll}
      />

      {/* Explicit Data Status Banner (Loading / Error / Offline / Stale / Empty / Unauthorized) */}
      {(status.overall !== 'ready' || status.isStale) && (
        <SectionStatusBanner
          status={status.overall}
          isStale={status.isStale}
          errorMessage={status.errorMessage}
          emptyText="هنوز اطلاعاتی برای این شعبه ثبت نشده است."
          onRetry={refreshAll}
        />
      )}

      {/* 2. One Explainable Smart Daily Brief */}
      <SmartBrief
        brief={metrics.smartBrief}
        todayCollected={metrics.revenue.todayCollected}
        monthNetProfit={metrics.revenue.monthNetProfit}
        monthLabel={metrics.monthLabel}
        onNavigate={navigate}
      />

      {/* 3. Maximum 4 Vital KPIs (No fake values; N/A on missing denominators) */}
      <CompactKPIGrid metrics={metrics} onNavigate={navigate} />

      {/* 4. One Priority Action */}
      <PriorityAction
        action={metrics.priorityAction}
        revenue={metrics.revenue}
        onNavigate={navigate}
      />

      {/* 5. Four Favorite QBank Modules + All Services Route Trigger */}
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

      {/* 6. Conditional Next Appointment (only when viewport height >= 700 and Large Text & Keyboard are off) */}
      {showNextAppointmentCard && metrics.nextAppt && (
        <NextAppointment nextAppt={metrics.nextAppt} onNavigate={navigate} />
      )}
    </div>
  );
}
