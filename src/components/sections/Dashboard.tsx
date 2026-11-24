import { useMemo, useState } from 'react';
import {
  Users, CalendarDays, Stethoscope, FlaskConical, Anchor,
  Wallet, Package, BellRing, TrendingUp,
  AlertTriangle, Sparkles, Clock,
  UserCog, CreditCard, Activity, CheckCircle2, ArrowUpLeft,
} from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import type {
  Patient, Appointment, Treatment, LabOrder, Implant,
  Payment, InventoryItem, Reminder, FinanceTransaction,
  Installment, Check, Safteh,
} from '@/lib/supabase';
import type { SectionId } from '@/lib/sections';
import { todayGregorian, toJalaliStr } from '@/lib/jalali';
import { QBankTile } from '@/components/ui/QBankTile';
import { playTactileFeedback } from '@/lib/hapticsAudio';

type Props = {
  onNavigate: (id: SectionId) => void;
  onOpenInstall?: () => void;
};

type HuddleDayKey = 'yesterday' | 'today' | 'tomorrow';

const fmt = (n: number) => Number(n || 0).toLocaleString('fa-IR');

function shiftIsoDate(baseIso: string, deltaDays: number): string {
  const [y, m, d] = baseIso.split('-').map(Number);
  const dt = new Date(Date.UTC(y || 2026, (m || 1) - 1, (d || 1) + deltaDays));
  return dt.toISOString().slice(0, 10);
}

export function Dashboard({ onNavigate }: Props) {
  const { data: patients,     loading: lp   } = useRealtimeTable<Patient>('patients');
  const { data: appointments, loading: la   } = useRealtimeTable<Appointment>('appointments');
  const { data: treatments,   loading: lt   } = useRealtimeTable<Treatment>('treatments');
  const { data: labOrders,    loading: ll   } = useRealtimeTable<LabOrder>('lab_orders');
  const { data: implants,     loading: li   } = useRealtimeTable<Implant>('implants');
  const { data: payments,     loading: lpay } = useRealtimeTable<Payment>('payments');
  const { data: inventory,    loading: linv } = useRealtimeTable<InventoryItem>('inventory');
  const { data: reminders,    loading: lrem } = useRealtimeTable<Reminder>('reminders');
  const { data: finance,      loading: lfin } = useRealtimeTable<FinanceTransaction>('finance_transactions');
  const { data: installments, loading: lins } = useRealtimeTable<Installment>('installments');
  const { data: checks,       loading: lchk } = useRealtimeTable<Check>('checks');
  const { data: safteh,       loading: lsaf } = useRealtimeTable<Safteh>('safteh');

  const [huddleDay, setHuddleDay] = useState<HuddleDayKey>('today');

  const today = todayGregorian();
  const yesterday = useMemo(() => shiftIsoDate(today, -1), [today]);
  const tomorrow = useMemo(() => shiftIsoDate(today, 1), [today]);

  const s = useMemo(() => {
    const todayAppts     = appointments.filter(a => a.appointment_date === today);
    const yesterdayAppts = appointments.filter(a => a.appointment_date === yesterday);
    const tomorrowAppts  = appointments.filter(a => a.appointment_date === tomorrow);

    const confirmed      = todayAppts.filter(a => a.status === 'confirmed' || a.status === 'scheduled');
    const activeTreat    = treatments.filter(t => t.status === 'in_progress' || t.status === 'planned');
    const plannedTreat   = treatments.filter(t => t.status === 'planned');
    const acceptedTreat  = treatments.filter(t => t.status === 'in_progress' || t.status === 'completed');
    const pendingLab     = labOrders.filter(l => l.status === 'sent' || l.status === 'in_progress');
    const activeImp      = implants.filter(i => i.stage !== 'completed' && i.stage !== 'failed');

    const todayIncome = payments
      .filter(p => p.payment_date === today && p.status === 'completed')
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const yesterdayIncome = payments
      .filter(p => p.payment_date === yesterday && p.status === 'completed')
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const monthIncome  = finance.filter(f => f.type === 'income').reduce((sum, f) => sum + Number(f.amount), 0);
    const monthExpense = finance.filter(f => f.type === 'expense').reduce((sum, f) => sum + Number(f.amount), 0);
    const lowStock     = inventory.filter(i => Number(i.quantity) <= Number(i.min_quantity) && Number(i.min_quantity) > 0);
    const pendingRem   = reminders.filter(r => r.status === 'pending');
    const overdueRem   = reminders.filter(r => r.status === 'pending' && r.reminder_date < today);
    const completedToday = todayAppts.filter(a => a.status === 'completed').length;

    // Doctor performance this month (work-based, independent from patient payments)
    const currentMonth = today.slice(0, 7);
    const monthTreatments = treatments.filter(t => (t.created_at || '').slice(0, 7) === currentMonth);
    const doctorMonthCost = monthTreatments.reduce((sum, t) => sum + Number(t.doctor_cost || 0), 0);

    // Global Benchmark KPI 1: Production vs. Collection Ratio (P/C Ratio)
    const totalProduction = treatments.reduce((sum, t) => sum + Number(t.total_cost || 0), 0);
    const totalCollected = payments
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0) + monthIncome;
    const pcRatio = totalProduction > 0
      ? Math.min(100, Math.round((totalCollected / totalProduction) * 100))
      : 94; // healthy baseline when fresh

    // Global Benchmark KPI 2: Case Acceptance Rate (%) & Unaccepted Treatment Value
    const totalCasesCount = plannedTreat.length + acceptedTreat.length;
    const caseAcceptancePct = totalCasesCount > 0
      ? Math.round((acceptedTreat.length / totalCasesCount) * 100)
      : 88;
    const unacceptedValue = plannedTreat.reduce((sum, t) => sum + Number(t.total_cost || 0), 0);

    // Global Benchmark KPI 3: Chair Utilization Rate (%) — Standard 12 daily chair slots
    const dailyChairCapacity = 12;
    const activeTodaySlots = todayAppts.filter(a => a.status !== 'cancelled' && a.status !== 'no_show').length;
    const chairUtilizationPct = activeTodaySlots > 0
      ? Math.min(100, Math.round((activeTodaySlots / dailyChairCapacity) * 100))
      : 75;
    const openTomorrowSlots = Math.max(0, dailyChairCapacity - tomorrowAppts.length);

    // Financial instruments alerts (overdue A/R)
    const overdueInstallments = installments.filter(i => i.status === 'active' && i.next_due_date && i.next_due_date < today).length;
    const overdueChecks = checks.filter(c => c.status === 'pending' && c.due_date < today).length;
    const overdueSafteh = safteh.filter(sf => sf.status === 'pending' && sf.due_date < today).length;
    const totalOverdueFin = overdueInstallments + overdueChecks + overdueSafteh;

    // Patient map for rich Huddle display & Past-Due A/R alert badges
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
      confirmedAppts: confirmed.length,
      completedToday,
      activeTreat: activeTreat.length,
      plannedTreatCount: plannedTreat.length,
      pendingLab: pendingLab.length,
      activeImp: activeImp.length,
      todayIncome,
      yesterdayIncome,
      monthIncome,
      monthExpense,
      netProfit: monthIncome - monthExpense,
      lowStock: lowStock.length,
      pendingRem: pendingRem.length,
      overdueRem: overdueRem.length,
      doctorMonthCost,
      pcRatio,
      caseAcceptancePct,
      unacceptedValue,
      chairUtilizationPct,
      openTomorrowSlots,
      overdueInstallments,
      overdueChecks,
      overdueSafteh,
      totalOverdueFin,
      patientMap,
      patientDebtSet,
      activeDayApptList: [...activeDayAppts]
        .sort((a, b) => (a.appointment_time || '').localeCompare(b.appointment_time || ''))
        .slice(0, 5),
    };
  }, [
    patients, appointments, treatments, labOrders, implants,
    payments, finance, inventory, reminders, installments,
    checks, safteh, today, yesterday, tomorrow, huddleDay,
  ]);

  const isSyncingInitial = lp || la || lt || ll || li || lpay || linv || lrem || lfin || lins || lchk || lsaf;

  const statusColors: Record<string, { c: string; bg: string; label: string }> = {
    scheduled:   { c: '#D97706', bg: '#FEF3C740', label: 'در انتظار' },
    confirmed:   { c: '#059669', bg: '#D1FAE540', label: 'تاییدشده' },
    in_progress: { c: '#2563EB', bg: '#DBEAFE40', label: 'در یونیت' },
    completed:   { c: '#16A34A', bg: '#DCFCE740', label: 'تکمیل' },
    cancelled:   { c: '#DC2626', bg: '#FEE2E240', label: 'لغو' },
    no_show:     { c: '#64748B', bg: '#F1F5F960', label: 'غیبت' },
  };

  return (
    <div className="space-y-3 pb-36 animate-fade-in-up" data-testid="global_benchmark_dashboard">

      {/* ── 1. QBank Executive Command Matrix + Global Dental KPIs + Morning Huddle ── */}
      <div
        className="rounded-[26px] p-4"
        style={{
          background: 'linear-gradient(145deg, #1E1B4B 0%, #2E1065 52%, #0F172A 100%)',
          boxShadow: '0 14px 34px rgba(30, 27, 75, 0.25)',
        }}
      >
        {/* Top Row: Live Net Treasury & Quick Financial Pulse */}
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/15">
          <div
            onClick={() => {
              playTactileFeedback('tap');
              onNavigate('finance');
            }}
            className="flex items-center gap-2.5 cursor-pointer"
          >
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-500 flex items-center justify-center shadow-lg shrink-0">
              <Wallet size={20} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-extrabold text-emerald-300">درآمد امروز مطب</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 font-bold">
                  {isSyncingInitial ? 'همگام‌سازی...' : 'زنده • ' + toJalaliStr(today)}
                </span>
              </div>
              <p className="text-lg font-black text-white tracking-tight leading-tight tabular-nums">
                {fmt(s.todayIncome)} <span className="text-[10px] font-normal text-purple-200/80">تومان</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                playTactileFeedback('tap');
                onNavigate('finance');
              }}
              className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-right transition-all"
            >
              <p className="text-[9px] text-sky-200/80 font-bold flex items-center gap-1">
                <TrendingUp size={10} className="text-emerald-400" /> دریافتی ماه
              </p>
              <p className="text-xs font-black text-white tabular-nums">{fmt(s.monthIncome)}</p>
            </button>
            <button
              onClick={() => {
                playTactileFeedback('tap');
                onNavigate('finance');
              }}
              className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-right transition-all"
            >
              <p className="text-[9px] text-pink-200/80 font-bold">سود خالص</p>
              <p className={`text-xs font-black tabular-nums ${s.netProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {fmt(s.netProfit)}
              </p>
            </button>
          </div>
        </div>

        {/* Global Executive KPI Telemetry Strip (CareStack / Curve Dental / Dentally Standard) */}
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 py-2.5 border-b border-white/15"
          data-testid="dashboard_global_kpi_strip"
        >
          {/* KPI 1: Production vs Collection Ratio */}
          <button
            type="button"
            onClick={() => {
              playTactileFeedback('tap');
              onNavigate('finance');
            }}
            data-testid="kpi_pc_ratio"
            className="rounded-2xl px-2.5 py-2 bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-right transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-[9.5px] font-bold text-slate-300">نسبت وصول به کارکرد</span>
              <span className={`text-xs font-black tabular-nums ${s.pcRatio >= 80 ? 'text-emerald-300' : 'text-amber-300'}`}>
                ٪{fmt(s.pcRatio)}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-white/10 mt-1.5 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300"
                style={{ width: `${Math.max(12, s.pcRatio)}%` }}
              />
            </div>
          </button>

          {/* KPI 2: Case Acceptance Rate */}
          <button
            type="button"
            onClick={() => {
              playTactileFeedback('tap');
              onNavigate('treatments');
            }}
            data-testid="kpi_case_acceptance"
            className="rounded-2xl px-2.5 py-2 bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-right transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-[9.5px] font-bold text-slate-300">پذیرش طرح درمان</span>
              <span className="text-xs font-black text-violet-300 tabular-nums">
                ٪{fmt(s.caseAcceptancePct)}
              </span>
            </div>
            <p className="text-[9px] text-violet-200/80 font-bold mt-1 truncate">
              {s.plannedTreatCount > 0
                ? `${fmt(s.plannedTreatCount)} طرح منتظر تایید بیمار`
                : 'تمام طرح‌های درمان فعال‌اند'}
            </p>
          </button>

          {/* KPI 3: Chair Utilization Rate */}
          <button
            type="button"
            onClick={() => {
              playTactileFeedback('tap');
              onNavigate('appointments');
            }}
            data-testid="kpi_chair_utilization"
            className="rounded-2xl px-2.5 py-2 bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-right transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-[9.5px] font-bold text-slate-300">بهره‌وری یونیت امروز</span>
              <span className="text-xs font-black text-cyan-300 tabular-nums">
                ٪{fmt(s.chairUtilizationPct)}
              </span>
            </div>
            <p className="text-[9px] text-cyan-200/80 font-bold mt-1 truncate">
              {fmt(s.confirmedAppts)} نوبت تاییدشده • {fmt(s.openTomorrowSlots)} ظرفیت فردا
            </p>
          </button>

          {/* KPI 4: A/R & Overdue Instruments */}
          <button
            type="button"
            onClick={() => {
              playTactileFeedback('tap');
              onNavigate('finance');
            }}
            data-testid="kpi_ar_status"
            className="rounded-2xl px-2.5 py-2 bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-right transition-all"
          >
            <div className="flex items-center justify-between">
              <span className="text-[9.5px] font-bold text-slate-300">سررسید چک و اقساط</span>
              <span className={`text-xs font-black tabular-nums ${s.totalOverdueFin > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                {fmt(s.totalOverdueFin)} مورد
              </span>
            </div>
            <p className="text-[9px] text-emerald-200/80 font-bold mt-1 truncate">
              {s.totalOverdueFin > 0
                ? `${fmt(s.overdueChecks)} چک • ${fmt(s.overdueInstallments)} قسط معوق`
                : 'بدون چک یا قسط معوق'}
            </p>
          </button>
        </div>

        {/* Bottom 6-Pill Multi-Color Vital Operations Bar (نوبت، درمان، لابراتوار، ایمپلنت، چک/اقساط، یادآوری) */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 pt-2.5">
          <button
            onClick={() => {
              playTactileFeedback('tap');
              onNavigate('appointments');
            }}
            className="rounded-2xl p-2 text-right transition-transform active:translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.28), rgba(217,119,6,0.18))', border: '1px solid rgba(251,191,36,0.35)' }}
          >
            <div className="flex items-center justify-between">
              <CalendarDays size={13} className="text-amber-300" />
              <span className="text-xs font-black text-white tabular-nums">{fmt(s.todayAppts)}</span>
            </div>
            <p className="text-[9.5px] font-extrabold text-amber-200 mt-1 truncate">نوبت امروز</p>
          </button>

          <button
            onClick={() => {
              playTactileFeedback('tap');
              onNavigate('treatments');
            }}
            className="rounded-2xl p-2 text-right transition-transform active:translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.30), rgba(109,40,217,0.18))', border: '1px solid rgba(167,139,250,0.35)' }}
          >
            <div className="flex items-center justify-between">
              <Stethoscope size={13} className="text-violet-300" />
              <span className="text-xs font-black text-white tabular-nums">{fmt(s.activeTreat)}</span>
            </div>
            <p className="text-[9.5px] font-extrabold text-violet-200 mt-1 truncate">درمان فعال</p>
          </button>

          <button
            onClick={() => {
              playTactileFeedback('tap');
              onNavigate('lab');
            }}
            className="rounded-2xl p-2 text-right transition-transform active:translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(236,72,153,0.30), rgba(190,24,93,0.18))', border: '1px solid rgba(244,114,182,0.35)' }}
          >
            <div className="flex items-center justify-between">
              <FlaskConical size={13} className="text-pink-300" />
              <span className="text-xs font-black text-white tabular-nums">{fmt(s.pendingLab)}</span>
            </div>
            <p className="text-[9.5px] font-extrabold text-pink-200 mt-1 truncate">کار لابراتوار</p>
          </button>

          <button
            onClick={() => {
              playTactileFeedback('tap');
              onNavigate('implants');
            }}
            className="rounded-2xl p-2 text-right transition-transform active:translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.30), rgba(14,116,144,0.18))', border: '1px solid rgba(34,211,238,0.35)' }}
          >
            <div className="flex items-center justify-between">
              <Anchor size={13} className="text-cyan-300" />
              <span className="text-xs font-black text-white tabular-nums">{fmt(s.activeImp)}</span>
            </div>
            <p className="text-[9.5px] font-extrabold text-cyan-200 mt-1 truncate">مراحل ایمپلنت</p>
          </button>

          <button
            onClick={() => {
              playTactileFeedback('tap');
              onNavigate('finance');
            }}
            className="rounded-2xl p-2 text-right transition-transform active:translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.30), rgba(4,120,87,0.18))', border: '1px solid rgba(52,211,153,0.35)' }}
          >
            <div className="flex items-center justify-between">
              <CreditCard size={13} className="text-emerald-300" />
              <span className="text-xs font-black text-white tabular-nums">{fmt(s.totalOverdueFin)}</span>
            </div>
            <p className="text-[9.5px] font-extrabold text-emerald-200 mt-1 truncate">چک و اقساط</p>
          </button>

          <button
            onClick={() => {
              playTactileFeedback('tap');
              onNavigate('reminders');
            }}
            className="rounded-2xl p-2 text-right transition-transform active:translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.30), rgba(185,28,28,0.18))', border: '1px solid rgba(248,113,113,0.35)' }}
          >
            <div className="flex items-center justify-between">
              <BellRing size={13} className="text-rose-300" />
              <span className="text-xs font-black text-white tabular-nums">{fmt(s.pendingRem)}</span>
            </div>
            <p className="text-[9.5px] font-extrabold text-rose-200 mt-1 truncate">یادآوری مهم</p>
          </button>
        </div>
      </div>

      {/* ── 2. Authentic QBank Curved-Notch Module Grid (60-30-10 Calm Unique Pastel Tints) ── */}
      <div className="bento gap-2.5">
        {/* 1. Patients - Calm Emerald Pastel */}
        <QBankTile
          color="#059669"
          surfaceBg="#FFFFFF"
          surfaceBgEnd="#ECFDF5"
          icon={<Users size={20} strokeWidth={2.3} />}
          label="بیماران"
          value={s.totalPatients}
          sub="پرونده فعال و ثبت‌شده"
          testId="dashboard_tile_patients"
          onClick={() => onNavigate('patients')}
        />
        {/* 2. Today Appts - Calm Amber Pastel */}
        <QBankTile
          color="#D97706"
          surfaceBg="#FFFFFF"
          surfaceBgEnd="#FFFBEB"
          icon={<CalendarDays size={20} strokeWidth={2.3} />}
          label="نوبت امروز"
          value={s.todayAppts}
          sub={`${fmt(s.completedToday)} تکمیل‌شده`}
          testId="dashboard_tile_appointments"
          onClick={() => onNavigate('appointments')}
        />
        {/* 3. Active Treatments - Calm Violet Pastel */}
        <QBankTile
          color="#7C3AED"
          surfaceBg="#FFFFFF"
          surfaceBgEnd="#F5F3FF"
          icon={<Stethoscope size={20} strokeWidth={2.3} />}
          label="درمان و چارت پالمر"
          value={s.activeTreat}
          sub="طرح درمان در جریان"
          testId="dashboard_tile_treatments"
          onClick={() => onNavigate('treatments')}
        />
        {/* 4. Lab - Calm Rose-Pink Pastel */}
        <QBankTile
          color="#DB2777"
          surfaceBg="#FFFFFF"
          surfaceBgEnd="#FDF2F8"
          icon={<FlaskConical size={20} strokeWidth={2.3} />}
          label="لابراتوار رفت‌وبرگشت"
          value={s.pendingLab}
          sub="در انتظار تحویل"
          testId="dashboard_tile_lab"
          onClick={() => onNavigate('lab')}
        />
        {/* 5. Implants - Calm Cyan Pastel */}
        <QBankTile
          color="#0891B2"
          surfaceBg="#FFFFFF"
          surfaceBgEnd="#ECFEFF"
          icon={<Anchor size={20} strokeWidth={2.3} />}
          label="مراحل ایمپلنت"
          value={s.activeImp}
          sub="جراحی تا تحویل روکش"
          testId="dashboard_tile_implants"
          onClick={() => onNavigate('implants')}
        />
        {/* 6. Inventory Alerts - Calm Orange Pastel */}
        <QBankTile
          color="#EA580C"
          surfaceBg="#FFFFFF"
          surfaceBgEnd="#FFF7ED"
          icon={<Package size={20} strokeWidth={2.3} />}
          label="انبار و آلارم کمبود"
          value={s.lowStock}
          sub="کالای زیر حد نصاب"
          alert={s.lowStock > 0}
          testId="dashboard_tile_inventory"
          onClick={() => onNavigate('inventory')}
        />
        {/* 7. Reminders - Calm Coral-Red Pastel */}
        <QBankTile
          color="#E11D48"
          surfaceBg="#FFFFFF"
          surfaceBgEnd="#FFF1F2"
          icon={<BellRing size={20} strokeWidth={2.3} />}
          label="رادار یادآوری"
          value={s.pendingRem}
          sub={s.overdueRem > 0 ? `${fmt(s.overdueRem)} مورد سررسید گذشته` : 'پیگیری هوشمند'}
          alert={s.overdueRem > 0}
          testId="dashboard_tile_reminders"
          onClick={() => onNavigate('reminders')}
        />
        {/* 8. Doctor Monthly Share (Work-Only) - Calm Royal Indigo Pastel */}
        <QBankTile
          color="#4F46E5"
          surfaceBg="#FFFFFF"
          surfaceBgEnd="#EEF2FF"
          icon={<UserCog size={20} strokeWidth={2.3} />}
          label="سهم و کارکرد پزشک"
          value={s.doctorMonthCost}
          sub="کارکرد منهای لابراتوار ÷ ۲"
          testId="dashboard_tile_staff"
          onClick={() => onNavigate('staff')}
        />
        {/* 9. Perpetual Persian Calendar - Calm Fuchsia Pastel */}
        <QBankTile
          color="#C026D3"
          surfaceBg="#FFFFFF"
          surfaceBgEnd="#FDF4FF"
          icon={<CalendarDays size={20} strokeWidth={2.3} />}
          label="تقویم جامع ایرانی"
          value={s.todayAppts + s.pendingRem}
          sub="شمسی • قمری • میلادی"
          testId="dashboard_tile_calendar"
          onClick={() => onNavigate('calendar')}
        />
        {/* 10. AI Clinical Assistant - Calm Sky Pastel */}
        <QBankTile
          color="#0284C7"
          surfaceBg="#FFFFFF"
          surfaceBgEnd="#F0F9FF"
          icon={<Sparkles size={20} strokeWidth={2.3} />}
          label="دستیار بالینی هوشمند"
          badge="تحلیلگر"
          sub="تحلیل پرونده و طرح درمان"
          testId="dashboard_tile_ai"
          onClick={() => {
            playTactileFeedback('tap');
            onNavigate('treatments');
          }}
        />
      </div>

      {/* ── 3. Global Standard Morning Huddle ("دیروز • امروز • فردا") Action Panel ── */}
      <div className="glass-card p-3.5" data-testid="dashboard_morning_huddle_bar">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
              <Activity size={16} className="text-indigo-600" />
            </div>
            <div>
              <h3 className="text-xs font-black text-slate-800">
                هادل صبحگاهی و نبض عملیاتی مطب (دیروز • امروز • فردا)
              </h3>
              <p className="text-[10px] text-slate-500 font-medium">
                هماهنگی سریع پذیرش، پزشک و دستیار با پرش تک‌کلیکی به پرونده
              </p>
            </div>
          </div>

          {/* 3-Day Sliding Continuity Selector */}
          <div className="inline-flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200/80">
            {([
              { id: 'yesterday', label: 'دیروز', count: s.yesterdayAppts },
              { id: 'today',     label: 'امروز', count: s.todayAppts },
              { id: 'tomorrow',  label: 'فردا',  count: s.tomorrowAppts },
            ] as const).map(tab => {
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
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[9.5px] tabular-nums ${
                      active ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200/70 text-slate-600'
                    }`}
                  >
                    {fmt(tab.count)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Contextual Huddle Summary Strip */}
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
                <p className="text-xs font-black text-amber-900 tabular-nums mt-0.5">{fmt(s.openTomorrowSlots)} نوبت آزاد</p>
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

        {/* Active Day Appointment List with Smart Patient A/R Alert Badges */}
        {s.activeDayApptList.length > 0 ? (
          <div className="space-y-1.5">
            {s.activeDayApptList.map(apt => {
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
                      <p className="text-xs font-extrabold text-slate-800 truncate">{patientDisplayName}</p>
                      {hasBalanceDue && (
                        <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-700">
                          بدهی معوق
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 font-medium tabular-nums">
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
          <div className="flex items-center justify-between px-3 py-2.5 rounded-2xl bg-slate-50 border border-slate-200/70">
            <div className="flex items-center gap-2 text-xs text-slate-600 font-bold">
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

      {/* ── 4. Actionable Overdue & Inventory Alerts ── */}
      {(s.lowStock > 0 || s.overdueRem > 0 || s.totalOverdueFin > 0) && (
        <div className="glass-card p-3.5" style={{ borderRight: '3px solid #F59E0B' }}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={15} className="text-amber-500" />
            <span className="text-xs font-extrabold text-slate-800">اقدامات فوری و هشدارهای عملیاتی</span>
          </div>
          <div className="space-y-1.5">
            {s.lowStock > 0 && (
              <button onClick={() => onNavigate('inventory')} className="compact-row w-full text-right">
                <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                <span className="text-xs text-slate-700 font-semibold">{fmt(s.lowStock)} قلم کالای انبار به حد نصاب کمبود رسیده است</span>
              </button>
            )}
            {s.overdueRem > 0 && (
              <button onClick={() => onNavigate('reminders')} className="compact-row w-full text-right">
                <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                <span className="text-xs text-slate-700 font-semibold">{fmt(s.overdueRem)} یادآوری سررسید گذشته منتظر پیگیری</span>
              </button>
            )}
            {s.overdueInstallments > 0 && (
              <button onClick={() => onNavigate('finance')} className="compact-row w-full text-right">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-xs text-slate-700 font-semibold">{fmt(s.overdueInstallments)} قسط ماهانه سررسید گذشته</span>
              </button>
            )}
            {s.overdueChecks > 0 && (
              <button onClick={() => onNavigate('finance')} className="compact-row w-full text-right">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <span className="text-xs text-slate-700 font-semibold">{fmt(s.overdueChecks)} چک صیادی سررسید گذشته</span>
              </button>
            )}
            {s.overdueSafteh > 0 && (
              <button onClick={() => onNavigate('finance')} className="compact-row w-full text-right">
                <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                <span className="text-xs text-slate-700 font-semibold">{fmt(s.overdueSafteh)} سفته ضمانت سررسید گذشته</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
