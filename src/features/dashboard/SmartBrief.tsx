import { AlertTriangle, ArrowUpLeft, CalendarCheck2, RefreshCw, Sparkles, TrendingUp, Wallet } from 'lucide-react';
import { toJalaliStr } from '@/lib/jalali';
import { PlatformHapticAdapter } from '@/platform/haptics';
import type { SmartDailyBriefSummary } from '@/services/intelligence/clinicIntelligence';
import type { AppRouteId } from '@/lib/navigationStack';
import type { DeepLinkPayload } from '@/navigation/DeepLinkHandler';
import type { DashboardPriorityAction } from './dashboard.types';

interface SmartBriefProps {
  brief: SmartDailyBriefSummary;
  todayIso: string;
  todayCollected: number | null;
  monthNetProfit: number | null;
  todayApptsCount: number;
  confirmedApptsCount: number;
  monthLabel: string;
  financialDataComplete: boolean;
  isLoading?: boolean;
  /** Rendered inline when the standalone PriorityAction card is hidden on compact viewports */
  hiddenUrgentAction?: DashboardPriorityAction | null;
  onRefresh?: () => void;
  onNavigate: (route: AppRouteId, deepLink?: Omit<DeepLinkPayload, 'section'>) => void;
}

const fmt = (n: number) => Number(n || 0).toLocaleString('fa-IR');
const fmtNullable = (n: number | null) => (n === null ? 'N/A' : fmt(n));

/**
 * V4 Bright Smart Clinic Overview Card:
 * - Minimum 12px typography across all KPI labels & badges (WCAG legibility — zero 9.5px/10px text)
 * - Integrates concise Jalali date & 1-tap refresh control (eliminating redundant DashboardHeader)
 * - Surfaces an accessible compact urgent alert strip whenever PriorityAction is hidden on short screens
 */
export function SmartBrief({
  brief,
  todayIso,
  todayCollected,
  monthNetProfit,
  todayApptsCount,
  confirmedApptsCount,
  monthLabel,
  financialDataComplete,
  isLoading = false,
  hiddenUrgentAction = null,
  onRefresh,
  onNavigate,
}: SmartBriefProps) {
  const isCritical = brief.priority === 'critical';
  const isHigh = brief.priority === 'high';

  const badgeStyles = isCritical
    ? 'bg-[#FFF1F2] text-[#AD293C] border-[#FECDD3] dark:bg-[#3A1622] dark:text-[#FDA4AF] dark:border-[#6E263A]'
    : isHigh
    ? 'bg-[#FFFBEB] text-[#92510C] border-[#FDE68A] dark:bg-[#382711] dark:text-[#FCD34D] dark:border-[#6B481B]'
    : 'bg-white/90 text-[#087C76] border-[#A7E6DF] dark:bg-[#13313A] dark:text-[#5EEAD4] dark:border-[#245966]';

  return (
    <section
      data-testid="dashboard_smart_summary"
      className="rounded-[22px] p-3 border border-[#BDE2E8] dark:border-[#28455E] shadow-[0_8px_24px_-12px_rgba(8,124,118,0.28)] bg-gradient-to-br from-[#E6FAF7] via-[#EEF4FF] to-[#F7EEFF] dark:from-[#122638] dark:via-[#162742] dark:to-[#1F2142]"
    >
      {/* Top row: Smart Brief insight + refresh + full reports link */}
      <div className="flex flex-wrap sm:flex-nowrap items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            PlatformHapticAdapter.selection();
            onNavigate(brief.destination.section, {
              recordId: brief.destination.recordId,
              subTab: brief.destination.subTab,
              date: brief.destination.filters?.date,
            });
          }}
          className="flex items-center gap-2.5 min-w-0 flex-1 text-right active:scale-[0.99] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087C76] rounded-[14px]"
        >
          <div
            className={`w-10 h-10 rounded-[14px] border flex items-center justify-center shrink-0 shadow-sm ${
              isCritical
                ? 'bg-[#FFF1F2] text-[#AD293C] border-[#FECDD3]'
                : isHigh
                ? 'bg-[#FFFBEB] text-[#B45309] border-[#FDE0A6]'
                : 'bg-gradient-to-br from-[#087C76] to-[#0EA5E9] text-white border-white/60'
            }`}
          >
            {isCritical ? <AlertTriangle size={18} /> : <Sparkles size={18} />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[14px] font-black text-[#12283B] dark:text-[#F8FAFC] leading-snug">
                {brief.headline}
              </span>
              <span
                className={`text-[12px] font-bold px-2 py-0.5 rounded-full border max-w-full ${badgeStyles}`}
              >
                {brief.source}
              </span>
            </div>
            <p className="text-[12.5px] font-semibold text-[#476075] dark:text-[#B4C6D8] leading-snug line-clamp-2 mt-1">
              {brief.reason} • {toJalaliStr(todayIso)}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          {onRefresh && (
            <button
              type="button"
              data-testid="dashboard_refresh_btn"
              aria-label="به‌روزرسانی اطلاعات داشبورد"
              onClick={() => {
                PlatformHapticAdapter.selection();
                onRefresh();
              }}
              className="w-11 h-11 rounded-[12px] bg-white/90 dark:bg-[#1A3147] border border-[#C6DCE8] dark:border-[#32516D] text-[#087C76] dark:text-[#5EEAD4] flex items-center justify-center shadow-xs active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087C76]"
            >
              <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            </button>
          )}

          <button
            type="button"
            data-testid="smart_overview_reports_btn"
            onClick={() => {
              PlatformHapticAdapter.selection();
              onNavigate('reports');
            }}
            className="min-h-[44px] px-3 py-1.5 rounded-[12px] bg-white/90 dark:bg-[#1A3147] border border-[#C6DCE8] dark:border-[#32516D] text-[#087C76] dark:text-[#5EEAD4] text-[12px] font-black flex items-center gap-1 shrink-0 shadow-xs active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087C76]"
          >
            <span>گزارش</span>
            <ArrowUpLeft size={14} />
          </button>
        </div>
      </div>

      {/* Compact urgent alert pill when PriorityAction is hidden on short viewports (zero lost critical alerts) */}
      {hiddenUrgentAction && (
        <button
          type="button"
          data-testid="smart_brief_compact_urgent_alert"
          onClick={() => {
            PlatformHapticAdapter.selection();
            onNavigate(hiddenUrgentAction.target, {
              subTab: hiddenUrgentAction.subTab,
              recordId: hiddenUrgentAction.recordId,
            });
          }}
          className="mt-2 w-full min-h-[44px] px-3 py-1.5 rounded-[12px] bg-[#FFF1F2] dark:bg-[#3A1622] border border-[#FECDD3] dark:border-[#6E263A] text-[#AD293C] dark:text-[#FDA4AF] flex items-center justify-between gap-2 text-right active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#AD293C]"
        >
          <span className="text-[12px] font-black truncate flex items-center gap-1.5">
            <AlertTriangle size={14} className="shrink-0" />
            <span className="truncate">{hiddenUrgentAction.title}</span>
          </span>
          <span className="text-[12px] font-black shrink-0 flex items-center gap-0.5">
            {hiddenUrgentAction.cta}
            <ArrowUpLeft size={13} />
          </span>
        </button>
      )}

      {/* Compact inline summary strip (3 real metrics — N/A when financial data incomplete, >=12px labels) */}
      <div className="grid grid-cols-3 gap-1.5 mt-2.5">
        <button
          type="button"
          onClick={() => {
            PlatformHapticAdapter.selection();
            onNavigate('appointments');
          }}
          className="min-h-[54px] rounded-[14px] px-2.5 py-1.5 bg-white/90 dark:bg-[#0F2030]/90 border border-white/90 dark:border-[#253E54] text-right active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087C76]"
        >
          <span className="text-[12px] font-bold text-[#4B6378] dark:text-[#9FB6C8] flex items-center gap-1">
            <CalendarCheck2 size={12} className="text-[#087C76] dark:text-[#2DD4BF] shrink-0" />
            <span className="truncate">نوبت امروز</span>
          </span>
          <p className="text-[14px] font-black text-[#12283B] dark:text-[#F8FAFC] tabular-nums leading-tight mt-0.5 truncate">
            {fmt(todayApptsCount)}{' '}
            <span className="text-[12px] font-bold text-[#087C76] dark:text-[#2DD4BF]">
              ({fmt(confirmedApptsCount)})
            </span>
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            PlatformHapticAdapter.selection();
            onNavigate('finance', { subTab: 'payments' });
          }}
          className="min-h-[54px] rounded-[14px] px-2.5 py-1.5 bg-white/90 dark:bg-[#0F2030]/90 border border-white/90 dark:border-[#253E54] text-right active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087C76]"
        >
          <span className="text-[12px] font-bold text-[#4B6378] dark:text-[#9FB6C8] flex items-center gap-1">
            <Wallet size={12} className="text-[#176B52] dark:text-[#34D399] shrink-0" />
            <span className="truncate">وصولی امروز</span>
          </span>
          <p className="text-[14px] font-black text-[#176B52] dark:text-[#34D399] tabular-nums leading-tight mt-0.5 truncate">
            {fmtNullable(todayCollected)}
            {todayCollected !== null && (
              <span className="text-[12px] font-bold text-[#526779] dark:text-[#9FB1C1]"> ت</span>
            )}
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            PlatformHapticAdapter.selection();
            onNavigate('reports');
          }}
          className="min-h-[54px] rounded-[14px] px-2.5 py-1.5 bg-white/90 dark:bg-[#0F2030]/90 border border-white/90 dark:border-[#253E54] text-right active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087C76]"
        >
          <span
            title={`سود ${monthLabel}`}
            className="text-[12px] font-bold text-[#4B6378] dark:text-[#9FB6C8] flex items-center gap-1"
          >
            <TrendingUp size={12} className="text-[#5B3CC4] dark:text-[#C4B5FD] shrink-0" />
            <span className="truncate">سود {(monthLabel || '').trim().split(/\s+/)[0] || 'ماه'}</span>
          </span>
          <p className="text-[14px] font-black text-[#5B3CC4] dark:text-[#C4B5FD] tabular-nums leading-tight mt-0.5 truncate">
            {financialDataComplete ? fmtNullable(monthNetProfit) : 'N/A'}
            {financialDataComplete && monthNetProfit !== null && (
              <span className="text-[12px] font-bold text-[#526779] dark:text-[#9FB1C1]"> ت</span>
            )}
          </p>
        </button>
      </div>
    </section>
  );
}
