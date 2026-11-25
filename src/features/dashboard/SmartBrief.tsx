import { Sparkles, AlertTriangle } from 'lucide-react';
import { toJalaliStr } from '@/lib/jalali';
import { PlatformHapticAdapter } from '@/platform/haptics';
import type { SmartDailyBriefSummary } from '@/services/intelligence/clinicIntelligence';
import type { AppRouteId } from '@/lib/navigationStack';
import type { DeepLinkPayload } from '@/navigation/DeepLinkHandler';

interface SmartBriefProps {
  brief: SmartDailyBriefSummary;
  todayCollected: number;
  monthNetProfit: number;
  monthLabel: string;
  onNavigate: (route: AppRouteId, deepLink?: Omit<DeepLinkPayload, 'section'>) => void;
}

const fmt = (n: number) => Number(n || 0).toLocaleString('fa-IR');

export function SmartBrief({
  brief,
  todayCollected,
  monthNetProfit,
  monthLabel,
  onNavigate,
}: SmartBriefProps) {
  const isCritical = brief.priority === 'critical';
  const isHigh = brief.priority === 'high';

  const badgeStyles = isCritical
    ? 'bg-[#FFF1F2] text-[#AD293C] border-[#FECDD3]'
    : isHigh
    ? 'bg-[#FFFBEB] text-[#92510C] border-[#FDE68A]'
    : 'bg-[#F0FDFA] text-[#087C76] border-[#B8E5E1]';

  const iconBoxStyles = isCritical
    ? 'bg-[#FFF1F2] text-[#AD293C] border-[#FECDD3]'
    : isHigh
    ? 'bg-[#FFFBEB] text-[#92510C] border-[#FDE68A]'
    : 'bg-[#E2F5F3] text-[#087C76] border-[#B8E5E1]';

  return (
    <button
      type="button"
      data-testid="dashboard_smart_summary"
      onClick={() => {
        PlatformHapticAdapter.selection();
        onNavigate(brief.destination.section, {
          recordId: brief.destination.recordId,
          subTab: brief.destination.subTab,
          date: brief.destination.filters?.date,
        });
      }}
      className="w-full min-h-[48px] rounded-[20px] px-3.5 py-2.5 bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] shadow-sm flex items-center justify-between gap-2.5 text-right transition-transform active:scale-[0.99]"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className={`w-10 h-10 rounded-[14px] border flex items-center justify-center shrink-0 ${iconBoxStyles}`}
        >
          {isCritical ? <AlertTriangle size={18} /> : <Sparkles size={18} />}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-[#14283B] dark:text-[#F1F5F9] truncate">
              {brief.headline}
            </span>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 ${badgeStyles}`}
            >
              {brief.source}
            </span>
          </div>
          <p className="text-[11px] font-medium text-[#526779] dark:text-[#9FB1C1] truncate mt-0.5">
            {brief.reason} • {toJalaliStr(brief.dueDate)}
          </p>
        </div>
      </div>

      <div className="text-left shrink-0 pl-0.5">
        <p className="text-sm font-black text-[#176B52] dark:text-[#34D399] tabular-nums leading-tight">
          {fmt(todayCollected)}
        </p>
        <p className="text-[10px] font-semibold text-[#526779] dark:text-[#9FB1C1] tabular-nums">
          وصولی امروز • سود {monthLabel}: {fmt(monthNetProfit)} ت
        </p>
      </div>
    </button>
  );
}
