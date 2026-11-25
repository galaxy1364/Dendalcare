import { BellRing, CalendarPlus, Search, UserPlus, Wallet } from 'lucide-react';
import { PlatformHapticAdapter } from '@/platform/haptics';
import { canAccessRoute } from '@/services/permissions/accessControl';
import type { ClinicUserRole } from '@/lib/cloudSyncEngine';
import type { AppRouteId } from '@/lib/navigationStack';
import type { DeepLinkPayload } from '@/navigation/DeepLinkHandler';

export interface DashboardQuickActionItem {
  id: 'new_appointment' | 'new_patient' | 'receive_payment' | 'reminders' | 'search';
  label: string;
  route: AppRouteId;
  subTab?: string;
  accent: string;
  surfaceBg: string;
  borderColor: string;
}

export const DASHBOARD_QUICK_ACTIONS: readonly DashboardQuickActionItem[] = [
  {
    id: 'new_appointment',
    label: 'نوبت جدید',
    route: 'appointment_form',
    accent: '#087C76',
    surfaceBg: '#E6F7F5',
    borderColor: '#B8E5E1',
  },
  {
    id: 'new_patient',
    label: 'بیمار جدید',
    route: 'patient_form',
    accent: '#0369A1',
    surfaceBg: '#EBF6FF',
    borderColor: '#B5DBF7',
  },
  {
    id: 'receive_payment',
    label: 'دریافت',
    route: 'finance',
    subTab: 'payments',
    accent: '#176B52',
    surfaceBg: '#EAFBF3',
    borderColor: '#B7E4CE',
  },
  {
    id: 'reminders',
    label: 'یادآوری',
    route: 'reminders',
    accent: '#B45309',
    surfaceBg: '#FFF7E8',
    borderColor: '#FDE0A6',
  },
  {
    id: 'search',
    label: 'جستجو',
    route: 'services',
    subTab: 'search',
    accent: '#5B3CC4',
    surfaceBg: '#F3EFFF',
    borderColor: '#D9CCFF',
  },
] as const;

function renderQuickActionIcon(id: DashboardQuickActionItem['id'], color: string) {
  const props = { size: 19, strokeWidth: 2.2, style: { color } };
  switch (id) {
    case 'new_appointment':
      return <CalendarPlus {...props} />;
    case 'new_patient':
      return <UserPlus {...props} />;
    case 'receive_payment':
      return <Wallet {...props} />;
    case 'reminders':
      return <BellRing {...props} />;
    case 'search':
      return <Search {...props} />;
  }
}

interface QuickActionsRowProps {
  userRole: ClinicUserRole;
  onNavigate: (route: AppRouteId, deepLink?: Omit<DeepLinkPayload, 'section'>) => void;
}

/**
 * FIX 06 — 5-item QBank-inspired Quick Actions bar directly below the Smart Clinic Overview.
 * Each item opens its dedicated full-screen route (no nested dashboard panels).
 */
export function QuickActionsRow({ userRole, onNavigate }: QuickActionsRowProps) {
  const visibleActions = DASHBOARD_QUICK_ACTIONS.filter((item) =>
    canAccessRoute(userRole, item.route)
  );

  return (
    <section
      aria-label="اقدام‌های سریع کلینیک"
      data-testid="dashboard_quick_actions_row"
      className="rounded-[20px] px-2 py-2 bg-white/92 dark:bg-[#11202E]/95 border border-[#D8E2EA] dark:border-[#25394D] shadow-sm"
    >
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, visibleActions.length)}, minmax(0, 1fr))` }}
      >
        {visibleActions.map((item) => (
          <button
            key={item.id}
            type="button"
            data-testid={`quick_action_${item.id}`}
            onClick={() => {
              PlatformHapticAdapter.selection();
              onNavigate(item.route, item.subTab ? { subTab: item.subTab } : undefined);
            }}
            className="min-h-[58px] rounded-[14px] flex flex-col items-center justify-center gap-1 px-0.5 py-1 transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087C76]"
          >
            <span
              className="w-10 h-10 rounded-[14px] border flex items-center justify-center shadow-[0_2px_6px_rgba(20,46,67,0.06)] dark:bg-[#162738] dark:border-[#2B4258]"
              style={{
                backgroundColor: item.surfaceBg,
                borderColor: item.borderColor,
              }}
            >
              {renderQuickActionIcon(item.id, item.accent)}
            </span>
            <span className="text-[12px] font-bold text-[#14283B] dark:text-[#F1F5F9] leading-tight truncate max-w-full">
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
