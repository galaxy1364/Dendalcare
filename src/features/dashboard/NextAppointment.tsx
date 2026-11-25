import { Clock } from 'lucide-react';
import { toJalaliStr } from '@/lib/jalali';
import { PlatformHapticAdapter } from '@/platform/haptics';
import type { AppRouteId } from '@/lib/navigationStack';
import type { DeepLinkPayload } from '@/navigation/DeepLinkHandler';
import type { DashboardNextAppointment } from './dashboard.types';

interface NextAppointmentProps {
  nextAppt: DashboardNextAppointment;
  onNavigate: (route: AppRouteId, deepLink?: Omit<DeepLinkPayload, 'section'>) => void;
}

export function NextAppointment({ nextAppt, onNavigate }: NextAppointmentProps) {
  return (
    <button
      type="button"
      data-testid="dashboard_next_appointment"
      onClick={() => {
        PlatformHapticAdapter.selection();
        onNavigate('appointments', {
          date: nextAppt.appointmentDate,
          recordId: nextAppt.id,
        });
      }}
      className="w-full min-h-[54px] rounded-[20px] px-3.5 py-2 bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] shadow-sm flex items-center justify-between gap-2 text-right active:scale-[0.99] transition-transform"
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-9 h-9 rounded-[12px] bg-[#FFFBEB] dark:bg-[#1B2D3E] border border-[#FDE68A] dark:border-[#25394D] flex items-center justify-center shrink-0">
          <Clock size={16} className="text-[#92510C] dark:text-[#FBBF24]" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-[#14283B] dark:text-[#F1F5F9] truncate">
            نوبت بعدی: {nextAppt.patientName}
          </p>
          <p className="text-[11px] font-medium text-[#526779] dark:text-[#9FB1C1] truncate tabular-nums">
            {toJalaliStr(nextAppt.appointmentDate)} • ساعت {nextAppt.appointmentTime}
          </p>
        </div>
      </div>
      <span className="text-[11px] font-bold text-[#92510C] dark:text-[#FBBF24] bg-[#FFFBEB] dark:bg-[#1B2D3E] px-2.5 py-1 rounded-[10px] border border-[#FDE68A] dark:border-[#25394D] shrink-0">
        مشاهده
      </span>
    </button>
  );
}
