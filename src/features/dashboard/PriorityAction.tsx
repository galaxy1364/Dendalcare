import { AlertTriangle, ArrowUpLeft, CalendarDays, Target } from 'lucide-react';
import { PlatformHapticAdapter } from '@/platform/haptics';
import type { AppRouteId } from '@/lib/navigationStack';
import type { DeepLinkPayload } from '@/navigation/DeepLinkHandler';
import type { DashboardPriorityAction, DashboardRevenueMetrics } from './dashboard.types';

interface PriorityActionProps {
  action: DashboardPriorityAction;
  revenue: DashboardRevenueMetrics;
  onNavigate: (route: AppRouteId, deepLink?: Omit<DeepLinkPayload, 'section'>) => void;
}

const fmt = (n: number) => Number(n || 0).toLocaleString('fa-IR');

export function PriorityAction({ action, revenue, onNavigate }: PriorityActionProps) {
  const hasRealDailyTarget =
    revenue.dailyRevenueTarget !== null && revenue.dailyGoalProgressPct !== null;

  return (
    <button
      type="button"
      data-testid="dashboard_priority_action"
      onClick={() => {
        PlatformHapticAdapter.impact('medium');
        onNavigate(action.target, {
          subTab: action.subTab,
          recordId: action.recordId,
        });
      }}
      className="w-full min-h-[56px] rounded-[20px] px-3.5 py-2.5 border shadow-sm flex items-center justify-between gap-2.5 text-right active:scale-[0.99] transition-transform"
      style={{
        background: action.bg,
        borderColor: action.border,
      }}
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div
          className="w-10 h-10 rounded-[14px] flex items-center justify-center text-white shrink-0 shadow-sm"
          style={{ background: action.color }}
        >
          {action.urgent ? <AlertTriangle size={18} /> : <CalendarDays size={18} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-[#14283B] truncate">{action.title}</p>
          <p className="text-[11px] font-medium text-[#526779] truncate mt-0.5">
            {action.subtitle}
          </p>
          {hasRealDailyTarget && (
            <div className="flex items-center gap-1.5 mt-1">
              <Target size={11} className="text-[#087C76] shrink-0" />
              <div className="flex-1 h-1.5 rounded-full bg-white/80 border border-[#D8E2EA] overflow-hidden max-w-[140px]">
                <div
                  className="h-full rounded-full bg-[#087C76]"
                  style={{ width: `${revenue.dailyGoalProgressPct}%` }}
                />
              </div>
              <span className="text-[10px] font-bold text-[#14283B] tabular-nums">
                هدف روز: ٪{fmt(revenue.dailyGoalProgressPct!)}
              </span>
            </div>
          )}
        </div>
      </div>

      <span
        className="min-h-[38px] px-3 py-1.5 rounded-[12px] bg-white text-[11px] font-bold shrink-0 border flex items-center gap-1 shadow-sm"
        style={{ color: action.color, borderColor: action.border }}
      >
        <span>{action.cta}</span>
        <ArrowUpLeft size={13} />
      </span>
    </button>
  );
}
