import { SlidersHorizontal } from 'lucide-react';
import { PlatformHapticAdapter } from '@/platform/haptics';
import type { AppRouteId } from '@/lib/navigationStack';

export function DashboardCustomizerButton({
  onNavigate,
}: {
  onNavigate: (route: AppRouteId) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        PlatformHapticAdapter.selection();
        onNavigate('services');
      }}
      data-testid="dashboard_customizer_link"
      className="min-h-[38px] px-2.5 py-1 rounded-[12px] bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] text-[11px] font-bold text-[#526779] dark:text-[#9FB1C1] hover:text-[#14283B] flex items-center gap-1"
    >
      <SlidersHorizontal size={12} />
      <span>سفارشی‌سازی</span>
    </button>
  );
}
