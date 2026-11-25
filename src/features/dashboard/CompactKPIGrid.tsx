import { PlatformHapticAdapter } from '@/platform/haptics';
import type { AppRouteId } from '@/lib/navigationStack';
import type { DeepLinkPayload } from '@/navigation/DeepLinkHandler';
import type { DashboardMetrics } from './dashboard.types';

interface CompactKPIGridProps {
  metrics: DashboardMetrics;
  onNavigate: (route: AppRouteId, deepLink?: Omit<DeepLinkPayload, 'section'>) => void;
}

const fmt = (n: number) => Number(n || 0).toLocaleString('fa-IR');

export function CompactKPIGrid({ metrics, onNavigate }: CompactKPIGridProps) {
  const { revenue, capacity } = metrics;
  const pcLabel = metrics.pcRatioPct === null ? 'N/A' : `٪${fmt(metrics.pcRatioPct)}`;
  const caseLabel =
    metrics.caseAcceptancePct === null ? 'N/A' : `٪${fmt(metrics.caseAcceptancePct)}`;
  const chairLabel =
    capacity.chairUtilizationPct === null ? 'N/A' : `٪${fmt(capacity.chairUtilizationPct)}`;

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 gap-2"
      data-testid="dashboard_global_kpi_strip"
    >
      {/* 1. Month Collection vs Treatment Production Ratio */}
      <button
        type="button"
        onClick={() => {
          PlatformHapticAdapter.lightImpact();
          onNavigate('finance');
        }}
        data-testid="kpi_pc_ratio"
        className="min-h-[64px] rounded-[20px] px-3 py-2 bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] text-right shadow-sm active:scale-[0.98] transition-transform"
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-bold text-[#526779] dark:text-[#9FB1C1] truncate">
            نسبت وصول ماه
          </span>
          <span
            className={`text-xs font-black tabular-nums ${
              metrics.pcRatioPct === null
                ? 'text-[#526779] dark:text-[#9FB1C1]'
                : metrics.pcRatioPct >= 80
                ? 'text-[#176B52] dark:text-[#34D399]'
                : 'text-[#92510C] dark:text-[#FBBF24]'
            }`}
          >
            {pcLabel}
          </span>
        </div>
        {metrics.pcRatioPct !== null ? (
          <div className="w-full h-1.5 rounded-full bg-[#EEF3F7] dark:bg-[#1B2D3E] mt-1.5 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#087C76] dark:bg-[#2DD4BF]"
              style={{ width: `${metrics.pcRatioPct}%` }}
            />
          </div>
        ) : (
          <p className="text-[10px] font-medium text-[#526779] dark:text-[#9FB1C1] mt-1.5 truncate">
            داده ناکافی (کارکرد ماه ۰)
          </p>
        )}
      </button>

      {/* 2. Treatment Case Acceptance */}
      <button
        type="button"
        onClick={() => {
          PlatformHapticAdapter.lightImpact();
          onNavigate('treatments');
        }}
        data-testid="kpi_case_acceptance"
        className="min-h-[64px] rounded-[20px] px-3 py-2 bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] text-right shadow-sm active:scale-[0.98] transition-transform"
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-bold text-[#526779] dark:text-[#9FB1C1] truncate">
            پذیرش درمان
          </span>
          <span
            className={`text-xs font-black tabular-nums ${
              metrics.caseAcceptancePct === null
                ? 'text-[#526779] dark:text-[#9FB1C1]'
                : 'text-[#5B3CC4] dark:text-[#C4B5FD]'
            }`}
          >
            {caseLabel}
          </span>
        </div>
        <p className="text-[10px] font-semibold text-[#526779] dark:text-[#9FB1C1] mt-1.5 truncate tabular-nums">
          {metrics.caseAcceptancePct === null
            ? 'داده ناکافی'
            : metrics.plannedTreatCount > 0
            ? `${fmt(metrics.plannedTreatCount)} طرح منتظر تایید`
            : `${fmt(metrics.activeTreatCount)} پرونده فعال`}
        </p>
      </button>

      {/* 3. Real Chair Capacity Utilization */}
      <button
        type="button"
        onClick={() => {
          PlatformHapticAdapter.lightImpact();
          onNavigate('appointments');
        }}
        data-testid="kpi_chair_utilization"
        className="min-h-[64px] rounded-[20px] px-3 py-2 bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] text-right shadow-sm active:scale-[0.98] transition-transform"
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-bold text-[#526779] dark:text-[#9FB1C1] truncate">
            ظرفیت یونیت
          </span>
          <span
            className={`text-xs font-black tabular-nums ${
              capacity.chairUtilizationPct === null
                ? 'text-[#526779] dark:text-[#9FB1C1]'
                : 'text-[#0E7490] dark:text-[#67E8F9]'
            }`}
          >
            {chairLabel}
          </span>
        </div>
        <p className="text-[10px] font-semibold text-[#526779] dark:text-[#9FB1C1] mt-1.5 truncate tabular-nums">
          {capacity.dailyChairCapacity === null
            ? 'نیازمند تعریف یونیت/شیفت'
            : `${fmt(capacity.activeTodaySlots)} از ${fmt(capacity.dailyChairCapacity)} نوبت (${fmt(capacity.activeUnitsCount)} یونیت)`}
        </p>
      </button>

      {/* 4. Receivables & Overdue Checks/Installments */}
      <button
        type="button"
        onClick={() => {
          PlatformHapticAdapter.lightImpact();
          onNavigate('finance', {
            subTab: metrics.overdueChecksCount > 0 ? 'checks' : 'installments',
          });
        }}
        data-testid="kpi_ar_status"
        className="min-h-[64px] rounded-[20px] px-3 py-2 bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] text-right shadow-sm active:scale-[0.98] transition-transform"
      >
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] font-bold text-[#526779] dark:text-[#9FB1C1] truncate">
            مطالبات و معوقات
          </span>
          <span
            className={`text-xs font-black tabular-nums ${
              metrics.totalOverdueFinCount > 0
                ? 'text-[#AD293C] dark:text-[#FB7185]'
                : 'text-[#176B52] dark:text-[#34D399]'
            }`}
          >
            {metrics.totalOverdueFinCount > 0
              ? `${fmt(metrics.totalOverdueFinCount)} معوق`
              : `${fmt(revenue.totalReceivables)} ت`}
          </span>
        </div>
        <p className="text-[10px] font-semibold text-[#526779] dark:text-[#9FB1C1] mt-1.5 truncate tabular-nums">
          {metrics.totalOverdueFinCount > 0
            ? `${fmt(metrics.overdueChecksCount)} چک • ${fmt(metrics.overdueInstallmentsCount)} قسط`
            : `جریان نقد ماه: ${fmt(revenue.monthCashFlow)} ت`}
        </p>
      </button>
    </div>
  );
}
