import { ArrowUpLeft, CalendarPlus, CheckCircle2, FilePlus2, ShieldCheck, Stethoscope, TrendingUp, Wallet } from 'lucide-react';
import { useDashboard } from '@/features/dashboard/useDashboard';
import { SectionStatusBanner } from '@/components/shared/SectionStatusBanner';
import { ModuleDuotoneIcon } from '@/design-system/icons/DentalDuotoneIcons';
import { PlatformHapticAdapter } from '@/platform/haptics';
import { canAccessRoute } from '@/services/permissions/accessControl';

const fmt = (n: number) => Number(n || 0).toLocaleString('fa-IR');

/**
 * FIX 04 — Full-Screen Financial & Clinical Reports Route ('reports')
 * Clearly separates Accrual Net Profit, Cash Flow, Collectible Checks,
 * Guarantee Collateral Checks, True A/R, and Real Chair Capacity.
 */
export function ReportsPage() {
  const { metrics, status, refreshAll, navigate, userRole } = useDashboard();
  const { revenue, capacity } = metrics;

  return (
    <div className="space-y-3 pb-6 animate-fade-in-up" data-testid="reports_fullscreen_page">
      {/* Header Banner */}
      <div className="rounded-[22px] p-4 bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] shadow-sm flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-[16px] bg-[#EEF2FF] dark:bg-[#162738] border border-[#C7D2FE] dark:border-[#25394D] flex items-center justify-center shrink-0">
            <ModuleDuotoneIcon id="reports" size={28} secondaryColor="#6366F1" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-black text-[#14283B] dark:text-[#F1F5F9] truncate">
              گزارش جامع مالی و عملکرد کلینیک
            </h2>
            <p className="text-[11px] font-semibold text-[#526779] dark:text-[#9FB1C1] mt-0.5 truncate">
              دوره شمسی {metrics.monthLabel} • تفکیک سود تعهدی، جریان نقد و چک‌های ضمانت
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            PlatformHapticAdapter.selection();
            void refreshAll();
          }}
          className="min-h-[40px] px-3 py-1.5 rounded-[12px] bg-[#EEF2FF] dark:bg-[#162738] text-[#4338CA] dark:text-[#A5B4FC] border border-[#C7D2FE] dark:border-[#25394D] text-xs font-bold shrink-0 active:scale-95"
        >
          به‌روزرسانی
        </button>
      </div>

      {(status.overall !== 'ready' || status.isStale) && (
        <SectionStatusBanner
          status={status.overall}
          isStale={status.isStale}
          errorMessage={status.errorMessage}
          onRetry={refreshAll}
        />
      )}

      {/* Accrual vs Cash Flow Separation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" data-testid="reports_accrual_vs_cashflow">
        <div className="rounded-[22px] p-4 bg-white dark:bg-[#11202E] border border-[#B7E4CE] dark:border-[#25394D] shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#176B52] dark:text-[#34D399] flex items-center gap-1.5">
              <TrendingUp size={15} />
              سود خالص تعهدی ({metrics.monthLabel})
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#176B52] border border-[#B7E4CE]">
              حسابداری تعهدی
            </span>
          </div>
          <p className="text-xl font-black text-[#14283B] dark:text-[#F1F5F9] tabular-nums">
            {fmt(revenue.monthNetProfit)} <span className="text-xs font-bold text-[#526779]">تومان</span>
          </p>
          <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-[#E6EDF2] dark:border-[#25394D] text-[10.5px]">
            <div>
              <span className="text-[#526779] dark:text-[#9FB1C1] block">کارکرد درمان</span>
              <strong className="text-[#14283B] dark:text-[#F1F5F9] tabular-nums">{fmt(revenue.monthTreatmentProduction)}</strong>
            </div>
            <div>
              <span className="text-[#526779] dark:text-[#9FB1C1] block">هزینه مستقیم</span>
              <strong className="text-[#AD293C] tabular-nums">{fmt(revenue.monthDirectCosts)}</strong>
            </div>
            <div>
              <span className="text-[#526779] dark:text-[#9FB1C1] block">هزینه جاری</span>
              <strong className="text-[#92510C] tabular-nums">{fmt(revenue.monthExpense)}</strong>
            </div>
          </div>
        </div>

        <div className="rounded-[22px] p-4 bg-white dark:bg-[#11202E] border border-[#B5DBF7] dark:border-[#25394D] shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#0369A1] dark:text-[#38BDF8] flex items-center gap-1.5">
              <Wallet size={15} />
              جریان نقد واقعی ({metrics.monthLabel})
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#0369A1] border border-[#BFDBFE]">
              خزانه نقدی
            </span>
          </div>
          <p className="text-xl font-black text-[#14283B] dark:text-[#F1F5F9] tabular-nums">
            {fmt(revenue.monthCashFlow)} <span className="text-xs font-bold text-[#526779]">تومان</span>
          </p>
          <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-[#E6EDF2] dark:border-[#25394D] text-[10.5px]">
            <div>
              <span className="text-[#526779] dark:text-[#9FB1C1] block">وصولی درمان</span>
              <strong className="text-[#176B52] tabular-nums">{fmt(revenue.monthCollected)}</strong>
            </div>
            <div>
              <span className="text-[#526779] dark:text-[#9FB1C1] block">سایر درآمدها</span>
              <strong className="text-[#0369A1] tabular-nums">{fmt(revenue.monthExtraIncome)}</strong>
            </div>
            <div>
              <span className="text-[#526779] dark:text-[#9FB1C1] block">وصولی امروز</span>
              <strong className="text-[#14283B] dark:text-[#F1F5F9] tabular-nums">{fmt(revenue.todayCollected)}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Receivables vs Guarantee Collateral Checks */}
      <div className="rounded-[22px] p-4 bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] shadow-sm space-y-3" data-testid="reports_receivables_breakdown">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black text-[#14283B] dark:text-[#F1F5F9] flex items-center gap-1.5">
            <ShieldCheck size={15} className="text-[#087C76]" />
            مطالبات واقعی و تفکیک چک‌های وصولی از ضمانت
          </h3>
          {canAccessRoute(userRole, 'finance') && (
            <button
              type="button"
              onClick={() => navigate('finance', { subTab: 'checks' })}
              className="text-[11px] font-bold text-[#087C76] flex items-center gap-1"
            >
              <span>مدیریت چک‌ها</span>
              <ArrowUpLeft size={13} />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="p-3 rounded-[16px] bg-[#F4F7F9] dark:bg-[#162738] border border-[#D8E2EA] dark:border-[#25394D]">
            <span className="text-[11px] font-bold text-[#526779] dark:text-[#9FB1C1] block">جمع مطالبات واقعی (A/R)</span>
            <strong className="text-base font-black text-[#14283B] dark:text-[#F1F5F9] tabular-nums mt-1 block">
              {fmt(revenue.totalReceivables)} ت
            </strong>
          </div>
          <div className="p-3 rounded-[16px] bg-[#ECFDF5] dark:bg-[#162738] border border-[#B7E4CE] dark:border-[#25394D]">
            <span className="text-[11px] font-bold text-[#176B52] dark:text-[#34D399] block">چک‌های وصولی در جریان</span>
            <strong className="text-base font-black text-[#176B52] dark:text-[#34D399] tabular-nums mt-1 block">
              {fmt(revenue.collectionChecksPendingAmount)} ت
            </strong>
            <span className="text-[10px] font-semibold text-[#526779] dark:text-[#9FB1C1]">
              {fmt(metrics.overdueChecksCount)} چک سررسید گذشته
            </span>
          </div>
          <div className="p-3 rounded-[16px] bg-[#FFFBEB] dark:bg-[#162738] border border-[#FDE0A6] dark:border-[#25394D]">
            <span className="text-[11px] font-bold text-[#92510C] dark:text-[#FBBF24] block">چک‌های ضمانت (خارج از وصولی)</span>
            <strong className="text-base font-black text-[#92510C] dark:text-[#FBBF24] tabular-nums mt-1 block">
              {fmt(revenue.guaranteeChecksPendingAmount)} ت
            </strong>
            <span className="text-[10px] font-semibold text-[#526779] dark:text-[#9FB1C1]">
              وثیقه امانی • {fmt(metrics.overdueGuaranteeChecksCount)} مورد سررسید
            </span>
          </div>
        </div>
      </div>

      {/* Real Chair Capacity & Clinical Utilization */}
      <div className="rounded-[22px] p-4 bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] shadow-sm space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-black text-[#14283B] dark:text-[#F1F5F9] flex items-center gap-1.5">
            <CheckCircle2 size={15} className="text-[#0E7490]" />
            بهره‌وری واقعی یونیت و شاخص‌های کلینیک
          </h3>
          <span className="text-xs font-black text-[#0E7490] dark:text-[#38BDF8] tabular-nums">
            {capacity.chairUtilizationPct !== null ? `٪${fmt(capacity.chairUtilizationPct)}` : 'N/A'}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <div className="p-2.5 rounded-[14px] bg-[#F4F7F9] dark:bg-[#162738]">
            <span className="text-[#526779] dark:text-[#9FB1C1] block">یونیت فعال</span>
            <strong className="text-sm font-black text-[#14283B] dark:text-[#F1F5F9] tabular-nums">{fmt(capacity.activeUnitsCount)}</strong>
          </div>
          <div className="p-2.5 rounded-[14px] bg-[#F4F7F9] dark:bg-[#162738]">
            <span className="text-[#526779] dark:text-[#9FB1C1] block">پزشک فعال</span>
            <strong className="text-sm font-black text-[#14283B] dark:text-[#F1F5F9] tabular-nums">{fmt(capacity.activeDoctorsCount)}</strong>
          </div>
          <div className="p-2.5 rounded-[14px] bg-[#F4F7F9] dark:bg-[#162738]">
            <span className="text-[#526779] dark:text-[#9FB1C1] block">ظرفیت روزانه</span>
            <strong className="text-sm font-black text-[#14283B] dark:text-[#F1F5F9] tabular-nums">
              {capacity.dailyChairCapacity !== null ? `${fmt(capacity.dailyChairCapacity)} نوبت` : 'نیاز به تنظیم شیفت'}
            </strong>
          </div>
          <div className="p-2.5 rounded-[14px] bg-[#F4F7F9] dark:bg-[#162738]">
            <span className="text-[#526779] dark:text-[#9FB1C1] block">پذیرش طرح درمان</span>
            <strong className="text-sm font-black text-[#5B3CC4] dark:text-[#C4B5FD] tabular-nums">
              {metrics.caseAcceptancePct !== null ? `٪${fmt(metrics.caseAcceptancePct)}` : 'N/A'}
            </strong>
          </div>
        </div>
      </div>

      {/* Dedicated Full-Screen Form Launchers */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {canAccessRoute(userRole, 'patient_form') && (
          <button
            type="button"
            data-testid="reports_open_patient_form_btn"
            onClick={() => navigate('patient_form')}
            className="min-h-[48px] px-3.5 py-2.5 rounded-[16px] bg-[#ECFDF5] dark:bg-[#162738] border border-[#B7E4CE] dark:border-[#25394D] text-[#176B52] dark:text-[#34D399] text-xs font-black flex items-center justify-center gap-2 active:scale-95"
          >
            <FilePlus2 size={16} />
            <span>ثبت پرونده بیمار جدید</span>
          </button>
        )}
        {canAccessRoute(userRole, 'appointment_form') && (
          <button
            type="button"
            data-testid="reports_open_appointment_form_btn"
            onClick={() => navigate('appointment_form')}
            className="min-h-[48px] px-3.5 py-2.5 rounded-[16px] bg-[#FFFBEB] dark:bg-[#162738] border border-[#FDE0A6] dark:border-[#25394D] text-[#92510C] dark:text-[#FBBF24] text-xs font-black flex items-center justify-center gap-2 active:scale-95"
          >
            <CalendarPlus size={16} />
            <span>ثبت نوبت جدید</span>
          </button>
        )}
        {canAccessRoute(userRole, 'treatment_form') && (
          <button
            type="button"
            data-testid="reports_open_treatment_form_btn"
            onClick={() => navigate('treatment_form')}
            className="min-h-[48px] px-3.5 py-2.5 rounded-[16px] bg-[#F5F3FF] dark:bg-[#162738] border border-[#DDD6FE] dark:border-[#25394D] text-[#5B3CC4] dark:text-[#C4B5FD] text-xs font-black flex items-center justify-center gap-2 active:scale-95"
          >
            <Stethoscope size={16} />
            <span>ثبت طرح درمان جدید</span>
          </button>
        )}
      </div>
    </div>
  );
}
