import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowUpLeft, BellRing, CalendarDays, CheckCircle2, Clock,
  CreditCard, FlaskConical, GripVertical, LayoutGrid, PhoneIncoming,
  Search, Smartphone, Star, Cloud, Download,
} from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import type {
  Patient, Appointment, Treatment, LabOrder, Implant,
  Payment, InventoryItem, Reminder, FinanceTransaction,
  Installment, Check, Safteh, ClinicSetting, Staff,
} from '@/lib/supabase';
import { SECTIONS, type SectionId } from '@/lib/sections';
import { getModuleToken } from '@/design-system/tokens';
import { getCurrentJalaliMonthBounds, isDateInRange, todayGregorian } from '@/lib/jalali';
import { loadDentalUnits } from '@/lib/clinicDefinitions';
import { computeRealChairCapacity, isDuplicatePaymentTransaction } from '@/features/dashboard/dashboard.metrics';
import { getActiveBranchId } from '@/services/authentication/authService';
import { QBankTile } from '@/components/ui/QBankTile';
import { HapticEngine, playTactileFeedback } from '@/platform/haptics';
import {
  type AppRouteId,
  loadSelectedHomeServices,
  saveSelectedHomeServices,
  reorderSelectedHomeServices,
  subscribeHomeServicesChange,
} from '@/lib/navigationStack';

type HuddleDayKey = 'yesterday' | 'today' | 'tomorrow';

interface AllServicesScreenProps {
  onNavigate: (id: AppRouteId) => void;
  onQuickAction?: (action: 'caller_id' | 'install' | 'sync' | 'reminder_popup') => void;
}

const fmt = (n: number) => Number(n || 0).toLocaleString('fa-IR');

function shiftIsoDate(baseIso: string, deltaDays: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, (d || 1) + deltaDays));
  return dt.toISOString().slice(0, 10);
}

/**
 * Independent Full-Screen Services, 3-Day Morning Huddle & Home Tile Customizer Route ('services')
 * Moved off the Home screen to keep Home strictly NO-SCROLL under IOS27-OVERRIDE.fa.md
 */
export function AllServicesScreen({ onNavigate, onQuickAction }: AllServicesScreenProps) {
  const { data: patients } = useRealtimeTable<Patient>('patients', 'id,first_name,last_name,phone');
  const { data: appointments } = useRealtimeTable<Appointment>(
    'appointments',
    'id,patient_id,title,appointment_date,appointment_time,type,status'
  );
  const { data: treatments } = useRealtimeTable<Treatment>(
    'treatments',
    'id,patient_id,total_cost,paid_amount,status'
  );
  const { data: labOrders } = useRealtimeTable<LabOrder>('lab_orders', 'id,status');
  const { data: implants } = useRealtimeTable<Implant>('implants', 'id,stage');
  const { data: payments } = useRealtimeTable<Payment>(
    'payments',
    'id,patient_id,amount,payment_date,status'
  );
  const { data: inventory } = useRealtimeTable<InventoryItem>('inventory', 'id,quantity,min_quantity');
  const { data: reminders } = useRealtimeTable<Reminder>('reminders', 'id,status');
  const { data: finance } = useRealtimeTable<FinanceTransaction>(
    'finance_transactions',
    'id,patient_id,type,amount,transaction_date,reference,description'
  );
  const { data: installments } = useRealtimeTable<Installment>(
    'installments',
    'id,status,next_due_date'
  );
  const { data: checks } = useRealtimeTable<Check>('checks', 'id,status,due_date');
  const { data: safteh } = useRealtimeTable<Safteh>('safteh', 'id,status,due_date');
  const { data: clinicSettings } = useRealtimeTable<ClinicSetting>(
    'clinic_settings',
    'id,key,value,category'
  );
  const { data: staff } = useRealtimeTable<Staff>('staff', 'id,first_name,last_name,role,active');

  const [selectedHome, setSelectedHome] = useState<SectionId[]>(() => loadSelectedHomeServices());
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [huddleDay, setHuddleDay] = useState<HuddleDayKey>('today');
  const [bannerSlide, setBannerSlide] = useState(0);
  const [bannerDragX, setBannerDragX] = useState(0);
  const [bannerDragging, setBannerDragging] = useState(false);
  const bannerSwipeRef = useRef<{ id: number | null; x: number; moved: boolean }>({
    id: null,
    x: 0,
    moved: false,
  });

  useEffect(() => subscribeHomeServicesChange(setSelectedHome), []);

  const today = todayGregorian();
  const yesterday = useMemo(() => shiftIsoDate(today, -1), [today]);
  const tomorrow = useMemo(() => shiftIsoDate(today, 1), [today]);
  const units = useMemo(() => loadDentalUnits(), []);
  const activeBranchId = getActiveBranchId();

  const s = useMemo(() => {
    void activeBranchId;
    const monthBounds = getCurrentJalaliMonthBounds(today);
    const todayAppts = appointments.filter((a) => a.appointment_date === today);
    const yesterdayAppts = appointments.filter((a) => a.appointment_date === yesterday);
    const tomorrowAppts = appointments.filter((a) => a.appointment_date === tomorrow);
    const confirmedAppts = todayAppts.filter(
      (a) => a.status === 'confirmed' || a.status === 'scheduled'
    );
    const completedToday = todayAppts.filter((a) => a.status === 'completed').length;
    const activeTreat = treatments.filter((t) => t.status === 'in_progress' || t.status === 'planned');
    const plannedTreat = treatments.filter((t) => t.status === 'planned');
    const unacceptedValue = plannedTreat.reduce((sum, t) => sum + Number(t.total_cost || 0), 0);
    const pendingLab = labOrders.filter((l) => l.status === 'sent' || l.status === 'in_progress');
    const activeImp = implants.filter((i) => i.stage !== 'completed' && i.stage !== 'failed');
    const completedPayments = payments.filter((p) => p.status === 'completed');
    const todayIncome = completedPayments
      .filter((p) => p.payment_date === today)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const yesterdayIncome = completedPayments
      .filter((p) => p.payment_date === yesterday)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const monthPayments = completedPayments.filter((p) =>
      isDateInRange(p.payment_date, monthBounds.startGregorian, monthBounds.endGregorian)
    );
    const monthExtraIncome = finance
      .filter(
        (f) =>
          f.type === 'income' &&
          isDateInRange(f.transaction_date, monthBounds.startGregorian, monthBounds.endGregorian) &&
          !isDuplicatePaymentTransaction(f, monthPayments)
      )
      .reduce((sum, f) => sum + Number(f.amount), 0);
    const monthIncome =
      monthPayments.reduce((sum, p) => sum + Number(p.amount), 0) + monthExtraIncome;
    const lowStock = inventory.filter(
      (i) => Number(i.quantity) <= Number(i.min_quantity) && Number(i.min_quantity) > 0
    );
    const pendingRem = reminders.filter((r) => r.status === 'pending');
    const overdueInstallments = installments.filter(
      (i) => i.status === 'active' && i.next_due_date && i.next_due_date < today
    ).length;
    const overdueChecks = checks.filter((c) => c.status === 'pending' && c.due_date < today).length;
    const overdueSafteh = safteh.filter((sf) => sf.status === 'pending' && sf.due_date < today).length;
    const totalOverdueFin = overdueInstallments + overdueChecks + overdueSafteh;

    const capacity = computeRealChairCapacity({
      units,
      staff,
      clinicSettings,
      activeTodaySlots: todayAppts.filter((a) => a.status !== 'cancelled' && a.status !== 'no_show').length,
    });
    const openTomorrowSlots =
      capacity.dailyChairCapacity !== null
        ? Math.max(0, capacity.dailyChairCapacity - tomorrowAppts.length)
        : null;

    const dailyTargetRaw = clinicSettings.find((c) => c.key === 'daily_revenue_target')?.value;
    const dailyTargetNum = dailyTargetRaw ? Number(String(dailyTargetRaw).replace(/[^\d.]/g, '')) : 0;
    const dailyRevenueTarget = Number.isFinite(dailyTargetNum) && dailyTargetNum > 0 ? dailyTargetNum : null;
    const dailyGoalPct =
      dailyRevenueTarget && dailyRevenueTarget > 0
        ? Math.min(100, Math.round((todayIncome / dailyRevenueTarget) * 100))
        : null;

    const patientMap = new Map<string, Patient>();
    for (const p of patients) patientMap.set(p.id, p);
    const patientDebtSet = new Set<string>();
    for (const t of treatments) {
      if (t.patient_id && Number(t.total_cost || 0) > Number(t.paid_amount || 0)) {
        patientDebtSet.add(t.patient_id);
      }
    }

    const activeDayAppts =
      huddleDay === 'yesterday'
        ? yesterdayAppts
        : huddleDay === 'tomorrow'
        ? tomorrowAppts
        : todayAppts;

    return {
      totalPatients: patients.length,
      todayAppts: todayAppts.length,
      yesterdayAppts: yesterdayAppts.length,
      tomorrowAppts: tomorrowAppts.length,
      confirmedAppts: confirmedAppts.length,
      completedToday,
      activeTreat: activeTreat.length,
      unacceptedValue,
      pendingLab: pendingLab.length,
      activeImp: activeImp.length,
      todayIncome,
      yesterdayIncome,
      monthIncome,
      dailyRevenueTarget,
      dailyGoalPct,
      lowStock: lowStock.length,
      pendingRem: pendingRem.length,
      overdueChecks,
      overdueInstallments,
      totalOverdueFin,
      openTomorrowSlots,
      patientMap,
      patientDebtSet,
      activeDayApptList: [...activeDayAppts]
        .sort((a, b) => (a.appointment_time || '').localeCompare(b.appointment_time || ''))
        .slice(0, 5),
    };
  }, [
    patients,
    appointments,
    treatments,
    labOrders,
    implants,
    payments,
    finance,
    inventory,
    reminders,
    installments,
    checks,
    safteh,
    clinicSettings,
    staff,
    units,
    activeBranchId,
    today,
    yesterday,
    tomorrow,
    huddleDay,
  ]);

  const statusColors: Record<string, { c: string; bg: string; label: string }> = {
    scheduled: { c: '#D97706', bg: '#FEF3C740', label: 'در انتظار' },
    confirmed: { c: '#059669', bg: '#D1FAE540', label: 'تاییدشده' },
    in_progress: { c: '#2563EB', bg: '#DBEAFE40', label: 'در یونیت' },
    completed: { c: '#16A34A', bg: '#DCFCE740', label: 'تکمیل' },
    cancelled: { c: '#DC2626', bg: '#FEE2E240', label: 'لغو' },
    no_show: { c: '#64748B', bg: '#F1F5F960', label: 'غیبت' },
  };

  const slides = [
    {
      id: 'huddle',
      title: 'خدمات و پوشه‌های کلینیک',
      subtitle: `${fmt(s.todayAppts)} نوبت امروز • ${fmt(s.confirmedAppts)} تاییدشده • ${fmt(s.activeTreat)} طرح درمان فعال`,
      cta: 'مشاهده نوبت‌ها',
      color: '#2563EB',
      bgStart: '#EEF2FF',
      bgEnd: '#DBEAFE',
      border: '#BFDBFE',
      icon: CalendarDays,
      onAction: () => onNavigate('appointments'),
    },
    {
      id: 'finance_alerts',
      title: 'مدیریت چک صیادی و اقساط',
      subtitle:
        s.totalOverdueFin > 0
          ? `${fmt(s.totalOverdueFin)} مورد سررسید گذشته (${fmt(s.overdueChecks)} چک • ${fmt(s.overdueInstallments)} قسط)`
          : `تمام چک‌ها و اقساط بدون معوقه • دریافتی ماه ${fmt(s.monthIncome)} تومان`,
      cta: 'ورود به مالی',
      color: '#16A34A',
      bgStart: '#ECFDF5',
      bgEnd: '#DCFCE7',
      border: '#BBF7D0',
      icon: CreditCard,
      onAction: () => onNavigate('finance'),
    },
    {
      id: 'lab_implant',
      title: 'زنجیره لابراتوار و ایمپلنت',
      subtitle: `${fmt(s.pendingLab)} سفارش لابراتوار در جریان • ${fmt(s.activeImp)} پرونده فعال ایمپلنت`,
      cta: 'پیگیری مراحل',
      color: '#DB2777',
      bgStart: '#FDF2F8',
      bgEnd: '#FCE7F3',
      border: '#FBCFE8',
      icon: FlaskConical,
      onAction: () => onNavigate('lab'),
    },
    {
      id: 'global_search',
      title: 'جستجوی سریع پوشه‌ها',
      subtitle: 'دسترسی فوری به بخش‌ها و پرونده بیماران',
      cta: 'باز کردن جستجو',
      color: '#7C3AED',
      bgStart: '#F5F3FF',
      bgEnd: '#EDE9FE',
      border: '#DDD6FE',
      icon: Search,
      onAction: () => {
        window.dispatchEvent(new CustomEvent('minadental-open-qbank-menu', { detail: { focusSearch: true } }));
      },
    },
  ];

  const currentSlide = slides[bannerSlide % slides.length];
  const SIcon = currentSlide.icon;

  const toggleHomeFavorite = (secId: SectionId) => {
    if (secId === 'dashboard') return;
    HapticEngine.selection();
    let next: SectionId[];
    if (selectedHome.includes(secId)) {
      if (selectedHome.length <= 1) return;
      next = selectedHome.filter((id) => id !== secId);
    } else {
      next = [secId, ...selectedHome].slice(0, 4);
    }
    setSelectedHome(saveSelectedHomeServices(next));
  };

  return (
    <div className="space-y-3 pb-6 animate-fade-in-up" data-testid="all_services_screen">
      {/* ── 1. Daily Goal & Live Reminder Trigger Bar ── */}
      <div
        className="glass-card p-3 flex flex-wrap items-center justify-between gap-2"
        data-testid="dashboard_zero_loss_reminder_command"
      >
        <div className="flex items-center gap-2 min-w-[180px] flex-1" data-testid="dashboard_daily_goal_bar">
          <span className="text-[11px] font-bold text-[#14283B] dark:text-slate-200 whitespace-nowrap">
            هدف درآمد امروز:
          </span>
          {s.dailyGoalPct !== null ? (
            <>
              <div className="flex-1 h-1.5 rounded-full bg-[#EEF3F7] dark:bg-slate-700 overflow-hidden max-w-[180px]">
                <div
                  className="h-full rounded-full bg-[#087C76]"
                  style={{ width: `${s.dailyGoalPct}%` }}
                />
              </div>
              <span className="text-[11px] font-black text-[#176B52] dark:text-emerald-400 tabular-nums">
                ٪{fmt(s.dailyGoalPct)}
              </span>
            </>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="text-[11px] font-bold text-[#526779] dark:text-slate-300 underline decoration-dotted"
            >
              داده ناکافی (تنظیم هدف در تنظیمات)
            </button>
          )}
        </div>

        <button
          type="button"
          data-testid="dashboard_trigger_ios_reminder_popup_btn"
          onClick={() => {
            HapticEngine.impact('medium');
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('minadental-trigger-ios-reminder-popup'));
            }
          }}
          className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-extrabold flex items-center gap-1.5 shadow-sm active:scale-95 transition-all"
        >
          <Smartphone size={12} className="text-rose-100" />
          <span>یادآوری‌های فعال ({fmt(s.pendingRem + s.totalOverdueFin + s.lowStock)})</span>
        </button>
      </div>

      {/* ── 2. Touch-Swipeable QBank Banner ── */}
      <div
        data-testid="dashboard_qbank_slide_banner"
        className="rounded-[24px] p-3 border shadow-sm overflow-hidden relative select-none touch-pan-y cursor-pointer"
        style={{
          background: `linear-gradient(125deg, ${currentSlide.bgStart} 0%, #FFFFFF 55%, ${currentSlide.bgEnd} 100%)`,
          borderColor: currentSlide.border,
          transform: `translateX(${bannerDragX}px)`,
          transition: bannerDragging ? 'none' : 'transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement)?.closest('button')) return;
          bannerSwipeRef.current = { id: e.pointerId, x: e.clientX, moved: false };
          setBannerDragging(true);
        }}
        onPointerMove={(e) => {
          const st = bannerSwipeRef.current;
          if (st.id !== e.pointerId) return;
          const dx = e.clientX - st.x;
          if (Math.abs(dx) > 6) st.moved = true;
          setBannerDragX(Math.max(-70, Math.min(70, dx * 0.5)));
        }}
        onPointerUp={(e) => {
          const st = bannerSwipeRef.current;
          if (st.id !== e.pointerId) return;
          const dx = e.clientX - st.x;
          st.id = null;
          setBannerDragging(false);
          setBannerDragX(0);
          if (Math.abs(dx) > 36) {
            playTactileFeedback('soft');
            setBannerSlide((prev) =>
              dx < 0 ? (prev + 1) % slides.length : (prev - 1 + slides.length) % slides.length
            );
          } else if (!st.moved) {
            playTactileFeedback('tap');
            currentSlide.onAction();
          }
        }}
      >
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-white shrink-0 shadow-sm"
              style={{ background: currentSlide.color }}
            >
              <SIcon size={19} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black text-slate-900 truncate">{currentSlide.title}</p>
              <p className="text-[10.5px] font-semibold text-slate-600 truncate mt-0.5">{currentSlide.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              playTactileFeedback('tap');
              currentSlide.onAction();
            }}
            className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 border text-[10px] font-black shrink-0 shadow-sm transition-all"
            style={{ color: currentSlide.color, borderColor: currentSlide.border }}
          >
            {currentSlide.cta}
          </button>
        </div>

        <div className="flex items-center justify-center gap-1.5 mt-2">
          {slides.map((sl, idx) => {
            const isAct = idx === bannerSlide % slides.length;
            return (
              <button
                key={sl.id}
                type="button"
                aria-label={sl.title}
                onClick={(e) => {
                  e.stopPropagation();
                  playTactileFeedback('soft');
                  setBannerSlide(idx);
                }}
                className="h-1.5 rounded-full transition-all duration-200"
                style={{
                  width: isAct ? '22px' : '6px',
                  background: isAct ? currentSlide.color : '#CBD5E1',
                }}
              />
            );
          })}
        </div>
      </div>

      {/* ── 3. Drag & Drop Customizer for 4 Home Selected Services ── */}
      <div className="glass-card p-3.5 space-y-2.5" data-testid="services_home_customizer">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Star size={15} className="text-amber-500" />
            <h3 className="text-xs font-black text-slate-900 dark:text-slate-100">
              چیدمان ۴ خدمت منتخب صفحه اصلی (Drag & Drop)
            </h3>
          </div>
          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
            حداکثر ۴ خدمت
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {selectedHome.map((id, idx) => {
            const sec = SECTIONS.find((item) => item.id === id) ?? SECTIONS[1];
            const tok = getModuleToken(sec.id);
            return (
              <div
                key={sec.id}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIdx === null || dragIdx === idx) return;
                  const reordered = reorderSelectedHomeServices(selectedHome, dragIdx, idx);
                  setSelectedHome(saveSelectedHomeServices(reordered));
                  setDragIdx(null);
                  HapticEngine.selection();
                }}
                onDragEnd={() => setDragIdx(null)}
                className="flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-2xl border cursor-grab active:cursor-grabbing"
                style={{
                  background: tok.surfaceTintStart,
                  borderColor: tok.surfaceBorder,
                }}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <GripVertical size={13} className="text-slate-500 shrink-0" />
                  <span className="text-[11px] font-black text-slate-900 truncate">{sec.label}</span>
                </div>
                <span className="text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-white text-slate-700 border border-slate-200">
                  {(idx + 1).toLocaleString('fa-IR')}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 4. Complete 13-Module Services Directory ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-black text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
            <LayoutGrid size={14} className="text-indigo-600" />
            تمام ماژول‌ها و خدمات کلینیک ({SECTIONS.length.toLocaleString('fa-IR')})
          </h3>
          <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
            برای افزودن به خانه روی ستاره بزنید
          </span>
        </div>

        <div className="bento gap-2.5">
          {SECTIONS.filter((sec) => sec.id !== 'dashboard').map((sec) => {
            const tok = getModuleToken(sec.id);
            const Icon = sec.icon;
            const isPinned = selectedHome.includes(sec.id);
            return (
              <div key={sec.id} className="relative">
                <QBankTile
                  color={tok.primary}
                  darkColor={tok.primaryDark}
                  surfaceBg={tok.surfaceTintStart}
                  surfaceBgEnd={tok.surfaceTintEnd}
                  borderColor={tok.surfaceBorder}
                  icon={<Icon size={19} strokeWidth={2.3} />}
                  label={sec.label}
                  selected={isPinned}
                  testId={`services_tile_${sec.id}`}
                  onClick={() => onNavigate(sec.id)}
                />
                <button
                  type="button"
                  aria-label={`انتخاب ${sec.label} در صفحه اصلی`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleHomeFavorite(sec.id);
                  }}
                  className={`absolute top-1.5 left-1.5 z-20 w-7 h-7 rounded-full flex items-center justify-center border transition-all ${
                    isPinned
                      ? 'bg-amber-400 border-amber-500 text-slate-900 shadow-sm'
                      : 'bg-white/90 border-slate-200 text-slate-400 hover:text-amber-500'
                  }`}
                >
                  <Star size={12} fill={isPinned ? 'currentColor' : 'none'} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 5. 3-Day Morning Huddle (Moved from Home for Zero-Scroll Compliance) ── */}
      <div className="glass-card p-3.5" data-testid="dashboard_morning_huddle_bar">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
              <Activity size={16} className="text-indigo-600" />
            </div>
            <h3 className="text-xs font-black text-slate-800 dark:text-slate-100">
              برنامه نوبت‌های مطب (دیروز • امروز • فردا)
            </h3>
          </div>

          <div className="inline-flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200/80 dark:border-slate-700">
            {(
              [
                { id: 'yesterday', label: 'دیروز', count: s.yesterdayAppts },
                { id: 'today', label: 'امروز', count: s.todayAppts },
                { id: 'tomorrow', label: 'فردا', count: s.tomorrowAppts },
              ] as const
            ).map((tab) => {
              const active = huddleDay === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-testid={`huddle_tab_${tab.id}`}
                  onClick={() => {
                    playTactileFeedback('tap');
                    setHuddleDay(tab.id);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold transition-all flex items-center gap-1 ${
                    active
                      ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[9.5px] tabular-nums ${
                      active
                        ? 'bg-indigo-50 text-indigo-700'
                        : 'bg-slate-200/70 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {fmt(tab.count)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          {huddleDay === 'yesterday' && (
            <>
              <div className="rounded-xl bg-slate-50 border border-slate-200/70 p-2 text-right">
                <p className="text-[9.5px] text-slate-500 font-bold">نوبت‌های دیروز</p>
                <p className="text-xs font-black text-slate-800 tabular-nums mt-0.5">{fmt(s.yesterdayAppts)} نوبت</p>
              </div>
              <div className="rounded-xl bg-emerald-50/70 border border-emerald-200/70 p-2 text-right">
                <p className="text-[9.5px] text-emerald-700 font-bold">وصولی دیروز</p>
                <p className="text-xs font-black text-emerald-800 tabular-nums mt-0.5">{fmt(s.yesterdayIncome)} ت</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('treatments')}
                className="rounded-xl bg-violet-50/70 border border-violet-200/70 p-2 text-right hover:bg-violet-100/60 transition-colors"
              >
                <p className="text-[9.5px] text-violet-700 font-bold flex items-center justify-between">
                  <span>پیگیری درمان</span>
                  <ArrowUpLeft size={11} />
                </p>
                <p className="text-xs font-black text-violet-900 tabular-nums mt-0.5">{fmt(s.activeTreat)} پرونده</p>
              </button>
            </>
          )}

          {huddleDay === 'today' && (
            <>
              <div className="rounded-xl bg-amber-50/70 border border-amber-200/70 p-2 text-right">
                <p className="text-[9.5px] text-amber-800 font-bold">نوبت تاییدشده امروز</p>
                <p className="text-xs font-black text-amber-900 tabular-nums mt-0.5">
                  {fmt(s.confirmedAppts)} از {fmt(s.todayAppts)}
                </p>
              </div>
              <div className="rounded-xl bg-emerald-50/70 border border-emerald-200/70 p-2 text-right">
                <p className="text-[9.5px] text-emerald-800 font-bold">تکمیل‌شده امروز</p>
                <p className="text-xs font-black text-emerald-900 tabular-nums mt-0.5">{fmt(s.completedToday)} بیمار</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('treatments')}
                className="rounded-xl bg-indigo-50/70 border border-indigo-200/70 p-2 text-right hover:bg-indigo-100/60 transition-colors"
              >
                <p className="text-[9.5px] text-indigo-700 font-bold flex items-center justify-between">
                  <span>فرصت طرح درمان</span>
                  <ArrowUpLeft size={11} />
                </p>
                <p className="text-xs font-black text-indigo-900 tabular-nums mt-0.5">
                  {s.unacceptedValue > 0 ? `${fmt(s.unacceptedValue)} ت` : 'تکمیل'}
                </p>
              </button>
            </>
          )}

          {huddleDay === 'tomorrow' && (
            <>
              <div className="rounded-xl bg-sky-50/70 border border-sky-200/70 p-2 text-right">
                <p className="text-[9.5px] text-sky-800 font-bold">نوبت‌های رزرو فردا</p>
                <p className="text-xs font-black text-sky-900 tabular-nums mt-0.5">{fmt(s.tomorrowAppts)} نوبت</p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('appointments')}
                className="rounded-xl bg-amber-50/70 border border-amber-200/70 p-2 text-right hover:bg-amber-100/60 transition-colors"
              >
                <p className="text-[9.5px] text-amber-800 font-bold flex items-center justify-between">
                  <span>ظرفیت خالی فردا</span>
                  <ArrowUpLeft size={11} />
                </p>
                <p className="text-xs font-black text-amber-900 tabular-nums mt-0.5">
                  {s.openTomorrowSlots !== null ? `${fmt(s.openTomorrowSlots)} نوبت آزاد` : 'N/A (نیاز به تعریف یونیت)'}
                </p>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('lab')}
                className="rounded-xl bg-pink-50/70 border border-pink-200/70 p-2 text-right hover:bg-pink-100/60 transition-colors"
              >
                <p className="text-[9.5px] text-pink-800 font-bold flex items-center justify-between">
                  <span>تحویل لابراتوار</span>
                  <ArrowUpLeft size={11} />
                </p>
                <p className="text-xs font-black text-pink-900 tabular-nums mt-0.5">{fmt(s.pendingLab)} سفارش</p>
              </button>
            </>
          )}
        </div>

        {s.activeDayApptList.length > 0 ? (
          <div className="space-y-1.5">
            {s.activeDayApptList.map((apt) => {
              const sc = statusColors[apt.status] ?? statusColors.scheduled;
              const pt = apt.patient_id ? s.patientMap.get(apt.patient_id) : undefined;
              const patientDisplayName = pt
                ? `${pt.first_name} ${pt.last_name}`.trim()
                : apt.title ?? 'بیمار مطب';
              const hasBalanceDue = Boolean(apt.patient_id && s.patientDebtSet.has(apt.patient_id));

              return (
                <div
                  key={apt.id}
                  onClick={() => {
                    playTactileFeedback('tap');
                    onNavigate('appointments');
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-2xl border border-slate-200/70 hover:border-indigo-300 transition-all cursor-pointer"
                  style={{ background: sc.bg }}
                >
                  <div className="w-1 h-8 rounded-full shrink-0" style={{ background: sc.c }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-extrabold text-slate-800 dark:text-slate-100 truncate">
                        {patientDisplayName}
                      </p>
                      {hasBalanceDue && (
                        <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-700">
                          بدهی معوق
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium tabular-nums">
                      <Clock size={10} className="inline ml-1 text-slate-400" />
                      {(apt.appointment_time || '').slice(0, 5)} • {apt.title || apt.type || 'ویزیت دندانپزشکی'}
                    </p>
                  </div>
                  <span
                    className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full shrink-0"
                    style={{ color: sc.c, background: `${sc.c}1A` }}
                  >
                    {sc.label}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-between px-3 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700">
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 font-bold">
              <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
              <span>
                {huddleDay === 'yesterday'
                  ? 'نوبتی برای دیروز ثبت نشده است.'
                  : huddleDay === 'tomorrow'
                  ? 'ظرفیت نوبت‌های فردا کاملاً باز و آماده رزرو است.'
                  : 'نوبتی برای امروز ثبت نشده است.'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                playTactileFeedback('tap');
                onNavigate('appointments');
              }}
              className="text-[11px] font-extrabold text-indigo-600 hover:text-indigo-800 px-2.5 py-1 rounded-lg bg-indigo-50"
            >
              ثبت نوبت +
            </button>
          </div>
        )}
      </div>

      {/* ── 6. Quick Clinic Tools Strip ── */}
      {onQuickAction && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => onQuickAction('caller_id')}
            className="glass-card px-3 py-2.5 flex items-center gap-2 text-xs font-black text-emerald-800 dark:text-emerald-300"
          >
            <PhoneIncoming size={15} className="text-emerald-600 shrink-0" />
            <span>کالرآیدی تماس</span>
          </button>
          <button
            type="button"
            onClick={() => onQuickAction('reminder_popup')}
            className="glass-card px-3 py-2.5 flex items-center gap-2 text-xs font-black text-rose-800 dark:text-rose-300"
          >
            <BellRing size={15} className="text-rose-600 shrink-0" />
            <span>پاپ‌آپ یادآور</span>
          </button>
          <button
            type="button"
            onClick={() => onQuickAction('sync')}
            className="glass-card px-3 py-2.5 flex items-center gap-2 text-xs font-black text-sky-800 dark:text-sky-300"
          >
            <Cloud size={15} className="text-sky-600 shrink-0" />
            <span>بک‌آپ و درایو</span>
          </button>
          <button
            type="button"
            onClick={() => onQuickAction('install')}
            className="glass-card px-3 py-2.5 flex items-center gap-2 text-xs font-black text-violet-800 dark:text-violet-300"
          >
            <Download size={15} className="text-violet-600 shrink-0" />
            <span>نصب ۴ پلتفرم</span>
          </button>
        </div>
      )}
    </div>
  );
}
