import { useMemo } from 'react';
import {
  Users, CalendarDays, Stethoscope, FlaskConical, Anchor,
  Wallet, Package, BellRing, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle2, ArrowUpLeft, Sparkles, Clock,
  UserCog, FileCheck, ScrollText, CreditCard, Download,
} from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import type {
  Patient, Appointment, Treatment, LabOrder, Implant,
  Payment, InventoryItem, Reminder, FinanceTransaction,
  Installment, Check, Safteh,
} from '@/lib/supabase';
import type { SectionId } from '@/lib/sections';
import { todayGregorian } from '@/lib/jalali';
import { QBankTile } from '@/components/ui/QBankTile';
import { playTactileFeedback } from '@/lib/hapticsAudio';

type Props = {
  onNavigate: (id: SectionId) => void;
  onOpenInstall?: () => void;
};

const fmt = (n: number) => n.toLocaleString('fa-IR');

export function Dashboard({ onNavigate }: Props) {
  const { data: patients,     loading: lp  } = useRealtimeTable<Patient>('patients');
  const { data: appointments, loading: la  } = useRealtimeTable<Appointment>('appointments');
  const { data: treatments,   loading: lt  } = useRealtimeTable<Treatment>('treatments');
  const { data: labOrders,    loading: ll  } = useRealtimeTable<LabOrder>('lab_orders');
  const { data: implants,     loading: li  } = useRealtimeTable<Implant>('implants');
  const { data: payments,     loading: lpay} = useRealtimeTable<Payment>('payments');
  const { data: inventory,    loading: linv} = useRealtimeTable<InventoryItem>('inventory');
  const { data: reminders,    loading: lrem} = useRealtimeTable<Reminder>('reminders');
  const { data: finance,      loading: lfin} = useRealtimeTable<FinanceTransaction>('finance_transactions');
  const { data: installments, loading: lins } = useRealtimeTable<Installment>('installments');
  const { data: checks,       loading: lchk } = useRealtimeTable<Check>('checks');
  const { data: safteh,       loading: lsaf } = useRealtimeTable<Safteh>('safteh');

  const today = todayGregorian();

  const s = useMemo(() => {
    const todayAppts   = appointments.filter(a => a.appointment_date === today);
    const confirmed    = todayAppts.filter(a => a.status === 'confirmed' || a.status === 'scheduled');
    const activeTreat  = treatments.filter(t => t.status === 'in_progress' || t.status === 'planned');
    const pendingLab   = labOrders.filter(l => l.status === 'sent' || l.status === 'in_progress');
    const activeImp    = implants.filter(i => i.stage !== 'completed' && i.stage !== 'failed');
    const todayIncome  = payments
      .filter(p => p.payment_date === today && p.status === 'completed')
      .reduce((s, p) => s + Number(p.amount), 0);
    const monthIncome  = finance.filter(f => f.type === 'income').reduce((s, f) => s + Number(f.amount), 0);
    const monthExpense = finance.filter(f => f.type === 'expense').reduce((s, f) => s + Number(f.amount), 0);
    const lowStock     = inventory.filter(i => Number(i.quantity) <= Number(i.min_quantity) && Number(i.min_quantity) > 0);
    const pendingRem   = reminders.filter(r => r.status === 'pending');
    const overdueRem   = reminders.filter(r => r.status === 'pending' && r.reminder_date < today);
    const completedToday = todayAppts.filter(a => a.status === 'completed').length;

    // Doctor performance this month (independent from patient payments)
    const currentMonth = today.slice(0, 7);
    const monthTreatments = treatments.filter(t => t.created_at.slice(0, 7) === currentMonth);
    const doctorMonthCost = monthTreatments.reduce((s, t) => s + Number(t.doctor_cost || 0), 0);

    // Financial instruments alerts (overdue)
    const overdueInstallments = installments.filter(i => i.status === 'active' && i.next_due_date && i.next_due_date < today).length;
    const overdueChecks = checks.filter(c => c.status === 'pending' && c.due_date < today).length;
    const overdueSafteh = safteh.filter(s => s.status === 'pending' && s.due_date < today).length;
    const totalOverdueFin = overdueInstallments + overdueChecks + overdueSafteh;

    return {
      totalPatients: patients.length,
      todayAppts: todayAppts.length,
      confirmedAppts: confirmed.length,
      completedToday,
      activeTreat: activeTreat.length,
      pendingLab: pendingLab.length,
      activeImp: activeImp.length,
      todayIncome, monthIncome, monthExpense,
      netProfit: monthIncome - monthExpense,
      lowStock: lowStock.length,
      pendingRem: pendingRem.length,
      overdueRem: overdueRem.length,
      doctorMonthCost,
      overdueInstallments, overdueChecks, overdueSafteh, totalOverdueFin,
      todayApptList: todayAppts.sort((a,b) => a.appointment_time.localeCompare(b.appointment_time)).slice(0, 4),
    };
  }, [patients, appointments, treatments, labOrders, implants, payments, finance, inventory, reminders, installments, checks, safteh, today]);

  const isSyncingInitial = lp || la || lt || ll || li || lpay || linv || lrem || lfin || lins || lchk || lsaf;

  const statusColors: Record<string, { c: string; bg: string; label: string }> = {
    scheduled:  { c:'#F59E0B', bg:'#FEF3C720', label:'در انتظار' },
    confirmed:  { c:'#10B981', bg:'#D1FAE520', label:'تاییدشده' },
    in_progress:{ c:'#3B82F6', bg:'#DBEAFE20', label:'در جریان' },
    completed:  { c:'#22C55E', bg:'#DCFCE720', label:'تکمیل' },
    cancelled:  { c:'#EF4444', bg:'#FEE2E220', label:'لغو' },
    no_show:    { c:'#9CA3AF', bg:'#F3F4F620', label:'غیبت' },
  };

  return (
    <div className="space-y-3 pb-36 animate-fade-in-up">

      {/* ── QBank-Style Live Clinical & Financial Command Matrix (Replacing Bank Card) ── */}
      <div
        className="rounded-[26px] p-4"
        style={{
          background: 'linear-gradient(145deg, #1E1B4B 0%, #2E1065 52%, #0F172A 100%)',
          boxShadow: '0 12px 30px rgba(30, 27, 75, 0.24)',
        }}
      >
        {/* Top Row: Live Net Treasury & Quick Financial Pulse */}
        <div className="flex items-center justify-between gap-2 pb-2.5 border-b border-white/15">
          <div
            onClick={() => onNavigate('finance')}
            className="flex items-center gap-2.5 cursor-pointer"
          >
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-500 flex items-center justify-center shadow-lg shrink-0">
              <Wallet size={20} className="text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-extrabold text-emerald-300">درآمد امروز مطب</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200 font-bold">
                  {isSyncingInitial ? 'همگام‌سازی...' : 'زنده'}
                </span>
              </div>
              <p className="text-lg font-black text-white tracking-tight leading-tight">
                {fmt(s.todayIncome)} <span className="text-[10px] font-normal text-purple-200/80">تومان</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => onNavigate('finance')}
              className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-right transition-all"
            >
              <p className="text-[9px] text-sky-200/80 font-bold flex items-center gap-1">
                <TrendingUp size={10} className="text-emerald-400" /> دریافتی ماه
              </p>
              <p className="text-xs font-black text-white">{fmt(s.monthIncome)}</p>
            </button>
            <button
              onClick={() => onNavigate('finance')}
              className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-right transition-all"
            >
              <p className="text-[9px] text-pink-200/80 font-bold">سود خالص</p>
              <p className={`text-xs font-black ${s.netProfit >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {fmt(s.netProfit)}
              </p>
            </button>
          </div>
        </div>

        {/* Bottom 6-Pill Multi-Color Vital Operations Bar (نوبت، درمان، لابراتوار، ایمپلنت، چک/اقساط، یادآوری) */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 pt-2.5">
          <button
            onClick={() => onNavigate('appointments')}
            className="rounded-2xl p-2 text-right transition-transform active:translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.28), rgba(217,119,6,0.18))', border: '1px solid rgba(251,191,36,0.35)' }}
          >
            <div className="flex items-center justify-between">
              <CalendarDays size={13} className="text-amber-300" />
              <span className="text-xs font-black text-white">{fmt(s.todayAppts)}</span>
            </div>
            <p className="text-[9.5px] font-extrabold text-amber-200 mt-1 truncate">نوبت امروز</p>
          </button>

          <button
            onClick={() => onNavigate('treatments')}
            className="rounded-2xl p-2 text-right transition-transform active:translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.30), rgba(109,40,217,0.18))', border: '1px solid rgba(167,139,250,0.35)' }}
          >
            <div className="flex items-center justify-between">
              <Stethoscope size={13} className="text-violet-300" />
              <span className="text-xs font-black text-white">{fmt(s.activeTreat)}</span>
            </div>
            <p className="text-[9.5px] font-extrabold text-violet-200 mt-1 truncate">درمان فعال</p>
          </button>

          <button
            onClick={() => onNavigate('lab')}
            className="rounded-2xl p-2 text-right transition-transform active:translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(236,72,153,0.30), rgba(190,24,93,0.18))', border: '1px solid rgba(244,114,182,0.35)' }}
          >
            <div className="flex items-center justify-between">
              <FlaskConical size={13} className="text-pink-300" />
              <span className="text-xs font-black text-white">{fmt(s.pendingLab)}</span>
            </div>
            <p className="text-[9.5px] font-extrabold text-pink-200 mt-1 truncate">کار لابراتوار</p>
          </button>

          <button
            onClick={() => onNavigate('implants')}
            className="rounded-2xl p-2 text-right transition-transform active:translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.30), rgba(14,116,144,0.18))', border: '1px solid rgba(34,211,238,0.35)' }}
          >
            <div className="flex items-center justify-between">
              <Anchor size={13} className="text-cyan-300" />
              <span className="text-xs font-black text-white">{fmt(s.activeImp)}</span>
            </div>
            <p className="text-[9.5px] font-extrabold text-cyan-200 mt-1 truncate">مراحل ایمپلنت</p>
          </button>

          <button
            onClick={() => onNavigate('finance')}
            className="rounded-2xl p-2 text-right transition-transform active:translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.30), rgba(4,120,87,0.18))', border: '1px solid rgba(52,211,153,0.35)' }}
          >
            <div className="flex items-center justify-between">
              <CreditCard size={13} className="text-emerald-300" />
              <span className="text-xs font-black text-white">{fmt(s.totalOverdueFin)}</span>
            </div>
            <p className="text-[9.5px] font-extrabold text-emerald-200 mt-1 truncate">چک و اقساط</p>
          </button>

          <button
            onClick={() => onNavigate('reminders')}
            className="rounded-2xl p-2 text-right transition-transform active:translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.30), rgba(185,28,28,0.18))', border: '1px solid rgba(248,113,113,0.35)' }}
          >
            <div className="flex items-center justify-between">
              <BellRing size={13} className="text-rose-300" />
              <span className="text-xs font-black text-white">{fmt(s.pendingRem)}</span>
            </div>
            <p className="text-[9.5px] font-extrabold text-rose-200 mt-1 truncate">یادآوری مهم</p>
          </button>
        </div>
      </div>

      {/* ── 2-Column 100% Authentic QBank Curved-Notch Module Grid (Calm Unique Pastel Tints) ── */}
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
          label="هوش مصنوعی کلینیک"
          badge="هوشمند"
          sub="تحلیل پرونده و طرح درمان"
          testId="dashboard_tile_ai"
          onClick={() => {
            playTactileFeedback('tap');
            onNavigate('treatments');
          }}
        />
      </div>

      {/* ── Today's Appointments ── */}
      {s.todayApptList.length > 0 && (
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center">
                <Clock size={16} className="text-amber-600" />
              </div>
              <span className="text-sm font-bold text-gray-800">نوبت‌های امروز</span>
            </div>
            <button
              onClick={() => onNavigate('appointments')}
              className="text-xs text-blue-500 font-bold haptic px-3 py-1 rounded-lg hover:bg-blue-50 transition-colors"
            >
              همه ←
            </button>
          </div>
          <div className="space-y-2">
            {s.todayApptList.map(apt => {
              const sc = statusColors[apt.status] ?? statusColors.scheduled;
              return (
                <div key={apt.id} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-all" style={{ background: sc.bg }}>
                  <div className="w-1 h-9 rounded-full shrink-0" style={{ background: sc.c }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-gray-800 truncate">{apt.title ?? 'نوبت'}</p>
                    <p className="text-[10px] text-gray-400">{apt.appointment_time.slice(0,5)} • {apt.type}</p>
                  </div>
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ color: sc.c, background: `${sc.c}18` }}>
                    {sc.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Alerts ── */}
      {(s.lowStock > 0 || s.overdueRem > 0 || s.totalOverdueFin > 0) && (
        <div className="glass-card p-4" style={{ borderRight:'3px solid #F59E0B' }}>
          <div className="flex items-center gap-2 mb-2.5">
            <AlertTriangle size={16} className="text-amber-500" />
            <span className="text-sm font-bold text-gray-700">هشدارها</span>
          </div>
          <div className="space-y-2">
            {s.lowStock > 0 && (
              <button onClick={() => onNavigate('inventory')} className="compact-row w-full text-right">
                <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
                <span className="text-xs text-gray-600">{s.lowStock} کالا به حد نصاب رسیده</span>
              </button>
            )}
            {s.overdueRem > 0 && (
              <button onClick={() => onNavigate('reminders')} className="compact-row w-full text-right">
                <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                <span className="text-xs text-gray-600">{s.overdueRem} یادآوری گذشته بدون پاسخ</span>
              </button>
            )}
            {s.overdueInstallments > 0 && (
              <button onClick={() => onNavigate('finance')} className="compact-row w-full text-right">
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                <span className="text-xs text-gray-600">{s.overdueInstallments} قسط سررسید گذشته</span>
              </button>
            )}
            {s.overdueChecks > 0 && (
              <button onClick={() => onNavigate('finance')} className="compact-row w-full text-right">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <span className="text-xs text-gray-600">{s.overdueChecks} چک سررسید گذشته</span>
              </button>
            )}
            {s.overdueSafteh > 0 && (
              <button onClick={() => onNavigate('finance')} className="compact-row w-full text-right">
                <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                <span className="text-xs text-gray-600">{s.overdueSafteh} سفته سررسید گذشته</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
