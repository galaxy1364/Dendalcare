import { Building2, RefreshCw } from 'lucide-react';
import { toJalaliStr } from '@/lib/jalali';
import { CLINIC_BRANCHES } from '@/services/authentication/authService';
import { PlatformHapticAdapter } from '@/platform/haptics';

interface DashboardHeaderProps {
  todayIso: string;
  monthLabel: string;
  branchId: string;
  isLoading: boolean;
  isStale: boolean;
  onRefresh: () => void;
}

export function DashboardHeader({
  todayIso,
  monthLabel,
  branchId,
  isLoading,
  isStale,
  onRefresh,
}: DashboardHeaderProps) {
  const branch = CLINIC_BRANCHES.find((b) => b.id === branchId) ?? CLINIC_BRANCHES[0];

  return (
    <div
      data-testid="dashboard_header_bar"
      className="flex items-center justify-between gap-2 px-1"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[12px] bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] text-[11px] font-bold text-[#14283B] dark:text-[#F1F5F9] truncate">
          <Building2 size={13} className="text-[#087C76] shrink-0" />
          <span className="truncate">{branch.name}</span>
        </span>
        <span className="text-[11px] font-semibold text-[#526779] dark:text-[#9FB1C1] truncate tabular-nums">
          {toJalaliStr(todayIso)} • {monthLabel}
        </span>
      </div>

      <button
        type="button"
        onClick={() => {
          PlatformHapticAdapter.selection();
          onRefresh();
        }}
        disabled={isLoading}
        aria-label="به‌روزرسانی داده‌های داشبورد"
        data-testid="dashboard_refresh_btn"
        className="min-h-[38px] min-w-[38px] px-2.5 rounded-[12px] bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] text-[11px] font-bold text-[#142E43] dark:text-[#F1F5F9] flex items-center gap-1.5 shrink-0 transition-colors active:scale-95 disabled:opacity-60"
      >
        <RefreshCw size={13} className={isLoading ? 'animate-spin text-[#087C76]' : 'text-[#087C76]'} />
        <span>{isLoading ? 'همگام‌سازی...' : isStale ? 'به‌روزرسانی مجدد' : 'تازه‌سازی'}</span>
      </button>
    </div>
  );
}
