import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calculator,
  CheckCheck,
  CheckCircle2,
  FileSpreadsheet,
  Percent,
  Stethoscope,
  UserCog,
} from 'lucide-react';
import {
  supabase,
  type FinanceTransaction,
  type Patient,
  type Staff,
  type Treatment,
} from '@/lib/supabase';
import { EmptyState } from '@/components/ui/Form';
import { JALALI_MONTHS, toJalaliStr, todayGregorian } from '@/lib/jalali';
import { exportToCsv } from '@/lib/exportUtils';
import { getMutationOutcome } from '@/lib/supabaseGuardian';
import { HapticEngine } from '@/lib/hapticsAudio';
import { calculateDoctorShare, type DoctorShareMode } from '@/lib/doctorShareEngine';
import { resolveTreatmentRealizationDate } from '@/features/dashboard/dashboard.metrics';
import { fmtToman } from './financeConstants';

export function FinanceDoctorShareTab({
  treatments,
  patients,
  staff,
  transactions,
  searchQuery,
  onRefreshTransactions,
}: {
  treatments: Treatment[];
  patients: Patient[];
  staff: Staff[];
  transactions: FinanceTransaction[];
  searchQuery: string;
  onRefreshTransactions: () => void;
}) {
  const today = todayGregorian();
  const currentMonth = today.slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [formulaMode, setFormulaMode] = useState<DoctorShareMode>('net_half_after_lab');
  const [customPercent, setCustomPercent] = useState<number>(50);
  const [selectedDoctorProfile, setSelectedDoctorProfile] = useState<string>('mehdi_amiri_manager');
  const [settling, setSettling] = useState(false);
  const [settleMessage, setSettleMessage] = useState<string | null>(null);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    treatments.forEach((t) => {
      const realDate = resolveTreatmentRealizationDate(t);
      if (realDate) months.add(realDate.slice(0, 7));
    });
    months.add(currentMonth);
    return Array.from(months).sort().reverse();
  }, [treatments, currentMonth]);

  const doctorsList = useMemo(() => {
    const dbDocs = staff.filter((s) => s.role === 'dentist' || s.role === 'doctor' || s.role === 'manager');
    return [
      { id: 'mehdi_amiri_manager', name: 'دکتر مهدی امیری (مدیر و پزشک ارشد)', isManager: true },
      ...dbDocs.map((d) => ({
        id: d.id,
        name: `دکتر ${d.first_name} ${d.last_name}`,
        isManager: d.role === 'manager',
      })),
    ];
  }, [staff]);

  const currentDocObj = doctorsList.find((d) => d.id === selectedDoctorProfile) || doctorsList[0];

  const { monthTreatments, unverifiedCompletionCount } = useMemo(() => {
    let missingDates = 0;
    let list = treatments.filter((t) => {
      if (t.status !== 'completed') return false;
      const realDate = resolveTreatmentRealizationDate(t);
      if (!realDate) {
        missingDates += 1;
        return false;
      }
      return realDate.slice(0, 7) === selectedMonth;
    });

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((t) => {
        const p = patients.find((pt) => pt.id === t.patient_id);
        const pName = p ? `${p.first_name} ${p.last_name}`.toLowerCase() : '';
        return pName.includes(q) || t.diagnosis?.toLowerCase().includes(q) || t.tooth_numbers?.includes(q);
      });
    }
    return { monthTreatments: list, unverifiedCompletionCount: missingDates };
  }, [treatments, selectedMonth, searchQuery, patients]);

  const calcTreatmentShare = (t: Treatment): number => {
    const gross = Math.max(0, Number(t.total_cost || 0) - Number(t.discount || 0));
    const lab = Math.max(0, Number(t.lab_cost || 0));
    const fixedDoc = Math.max(0, Number(t.doctor_cost || 0));
    const res = calculateDoctorShare({
      mode: formulaMode,
      grossWorkAmount: gross,
      labCostAmount: lab,
      shareValue: formulaMode === 'fixed' ? (fixedDoc > 0 ? fixedDoc : Math.round(Math.max(0, gross - lab) / 2)) : customPercent,
      deductLabInPercentageMode: true,
      isClinicManager: currentDocObj.isManager && formulaMode === 'percentage' && customPercent === 100,
    });
    return res.doctorShare;
  };

  const stats = useMemo(() => {
    const grossWorkTotal = monthTreatments.reduce((s, t) => s + Math.max(0, Number(t.total_cost || 0) - Number(t.discount || 0)), 0);
    const labTotal = monthTreatments.reduce((s, t) => s + Number(t.lab_cost || 0), 0);
    const netAfterLabTotal = Math.max(0, grossWorkTotal - labTotal);
    const calculatedDoctorShare = monthTreatments.reduce((s, t) => s + calcTreatmentShare(t), 0);
    const clinicShare = Math.max(0, netAfterLabTotal - calculatedDoctorShare);

    const paidOutThisMonth = transactions
      .filter((tx) => tx.type === 'expense' && tx.category === 'salary' && tx.reference === `DOC_SETTLE_${selectedMonth}_${selectedDoctorProfile}`)
      .reduce((s, tx) => s + Number(tx.amount || 0), 0);

    return {
      grossWorkTotal,
      labTotal,
      netAfterLabTotal,
      calculatedDoctorShare,
      clinicShare,
      paidOutThisMonth,
      remainingToPayDoctor: Math.max(0, calculatedDoctorShare - paidOutThisMonth),
    };
  }, [monthTreatments, formulaMode, customPercent, selectedDoctorProfile, transactions, selectedMonth]);

  const faMonthName = (m: string) => {
    const [y, mo] = m.split('-');
    return `${JALALI_MONTHS[Number(mo) - 1] ?? mo} ${Number(y).toLocaleString('fa-IR')}`;
  };

  const handleSettleDoctorMonthlyShare = async () => {
    if (stats.remainingToPayDoctor <= 0) return;
    setSettling(true);
    setSettleMessage(null);
    try {
      const res = await supabase.from('finance_transactions').insert({
        type: 'expense',
        category: 'salary',
        amount: stats.remainingToPayDoctor,
        transaction_date: today,
        payment_method: 'transfer',
        reference: `DOC_SETTLE_${selectedMonth}_${selectedDoctorProfile}`,
        description: `تسویه سهم کارکرد ماه ${faMonthName(selectedMonth)} - ${currentDocObj.name}`,
      });
      const outcome = getMutationOutcome(res);
      if (outcome === 'error') {
        HapticEngine.error();
        setSettleMessage('خطا در ثبت تسویه پزشک در سرور.');
        return;
      }
      onRefreshTransactions();
      HapticEngine.success();
      setSettleMessage(`مبلغ ${fmtToman(stats.remainingToPayDoctor)} تومان بابت تسویه کارکرد ثبت شد.`);
    } finally {
      setSettling(false);
    }
  };

  const handleExportDoctor = () => {
    exportToCsv(
      `گزارش_سهم_پزشک_${selectedMonth}`,
      ['بیمار', 'شماره دندان', 'تاریخ انجام', 'کارکرد خالص (تومان)', 'هزینه لابراتوار', 'سهم پزشک'],
      monthTreatments.map((t) => {
        const p = patients.find((pt) => pt.id === t.patient_id);
        const gross = Math.max(0, Number(t.total_cost || 0) - Number(t.discount || 0));
        const realDate = resolveTreatmentRealizationDate(t);
        return [
          p ? `${p.first_name} ${p.last_name}` : '-',
          t.tooth_numbers || 'عمومی',
          realDate ? toJalaliStr(realDate.slice(0, 10)) : '-',
          String(gross),
          String(t.lab_cost || 0),
          String(calcTreatmentShare(t)),
        ];
      })
    );
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <div className="glass-card p-3.5 space-y-3 border border-violet-200">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-violet-100 text-violet-700 flex items-center justify-center"><Calculator size={18} /></div>
            <div>
              <h3 className="text-xs font-extrabold text-gray-800">محاسبه سهم ماهانه پزشک (بر مبنای تاریخ انجام قطعی)</h3>
              <p className="text-[10px] text-violet-700 font-semibold">مستقل از چک، قسط و بدهی بیمار • هزینه فیکسچر ایمپلنت به عهده مطب</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={handleExportDoctor} title="خروجی اکسل" className="w-8 h-8 rounded-xl bg-violet-600 text-white flex items-center justify-center shadow">
              <FileSpreadsheet size={15} />
            </button>
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="text-xs font-bold rounded-xl bg-violet-50 text-violet-900 px-3 py-1.5 border border-violet-200">
              {availableMonths.map((m) => <option key={m} value={m}>{faMonthName(m)}</option>)}
            </select>
          </div>
        </div>

        {unverifiedCompletionCount > 0 && (
          <div className="p-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[10.5px] flex items-center gap-1.5">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{unverifiedCompletionCount.toLocaleString('fa-IR')} درمان تکمیل‌شده بدون تاریخ انجام تاییدشده (performed_at) از محاسبه کارکرد کنار گذاشته شد.</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-gray-500 block mb-1">پزشک / مدیر کلینیک:</label>
            <select
              value={selectedDoctorProfile}
              onChange={(e) => {
                setSelectedDoctorProfile(e.target.value);
                setCustomPercent(e.target.value === 'mehdi_amiri_manager' ? 100 : 50);
              }}
              className="w-full text-xs font-bold rounded-xl bg-gray-100 px-3 py-2 border border-gray-200"
            >
              {doctorsList.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-500 block mb-1">فرمول محاسبه سهم:</label>
            <div className="grid grid-cols-3 gap-1 bg-gray-100 p-1 rounded-xl">
              <button onClick={() => setFormulaMode('net_half_after_lab')} className={`py-1.5 px-1 rounded-lg text-[10px] font-bold ${formulaMode === 'net_half_after_lab' ? 'bg-violet-600 text-white' : 'text-gray-600'}`}>(کارکرد-لاب)÷۲</button>
              <button onClick={() => setFormulaMode('fixed')} className={`py-1.5 px-1 rounded-lg text-[10px] font-bold ${formulaMode === 'fixed' ? 'bg-violet-600 text-white' : 'text-gray-600'}`}>ثابت هر درمان</button>
              <button onClick={() => setFormulaMode('percentage')} className={`py-1.5 px-1 rounded-lg text-[10px] font-bold ${formulaMode === 'percentage' ? 'bg-violet-600 text-white' : 'text-gray-600'}`}>درصدی ({customPercent.toLocaleString('fa-IR')}٪)</button>
            </div>
          </div>
        </div>

        {formulaMode === 'percentage' && (
          <div className="bg-violet-50/80 border border-violet-200 rounded-xl p-2.5 flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-bold text-violet-900 flex items-center gap-1"><Percent size={13} /> درصد:</span>
            <div className="flex gap-1">
              {[35, 40, 45, 50, 60, 70, 100].map((pct) => (
                <button key={pct} onClick={() => setCustomPercent(pct)} className={`px-2 py-1 rounded-lg text-[10px] font-extrabold ${customPercent === pct ? 'bg-violet-700 text-white' : 'bg-white text-violet-700 border border-violet-200'}`}>
                  {pct.toLocaleString('fa-IR')}٪
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="qbank-tile border border-violet-200" style={{ background: 'linear-gradient(155deg, #FFFFFF 0%, #F6F3FF 60%, #EDE9FE 100%)' }}>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-bold text-violet-800">سهم قابل پرداخت به {currentDocObj.name}</p>
            <p className="text-2xl font-black text-slate-900 mt-0.5 tabular-nums">{fmtToman(stats.calculatedDoctorShare)} <span className="text-xs font-bold text-violet-700">تومان</span></p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-white border border-violet-200 flex items-center justify-center text-violet-700"><Stethoscope size={20} /></div>
        </div>
        <div className="mt-3 pt-2 border-t border-violet-200/70 grid grid-cols-4 gap-2 text-center">
          <div className="bg-white rounded-xl p-1.5 border border-slate-200"><p className="text-[9px] text-slate-600">کل کارکرد</p><p className="text-[11px] font-black tabular-nums">{fmtToman(stats.grossWorkTotal)}</p></div>
          <div className="bg-white rounded-xl p-1.5 border border-rose-200"><p className="text-[9px] text-rose-700">لابراتوار</p><p className="text-[11px] font-black text-rose-800 tabular-nums">-{fmtToman(stats.labTotal)}</p></div>
          <div className="bg-white rounded-xl p-1.5 border border-emerald-200"><p className="text-[9px] text-emerald-700">سهم مطب</p><p className="text-[11px] font-black text-emerald-800 tabular-nums">{fmtToman(stats.clinicShare)}</p></div>
          <div className="bg-white rounded-xl p-1.5 border border-amber-200"><p className="text-[9px] text-amber-800">تسویه‌شده</p><p className="text-[11px] font-black text-amber-900 tabular-nums">{fmtToman(stats.paidOutThisMonth)}</p></div>
        </div>
        {stats.remainingToPayDoctor > 0 && (
          <button onClick={handleSettleDoctorMonthlyShare} disabled={settling} data-testid="settle_doctor_monthly_share_button" className="mt-3 w-full py-2.5 px-3 rounded-xl bg-violet-700 hover:bg-violet-800 text-white text-xs font-extrabold flex items-center justify-center gap-2 disabled:opacity-50">
            <CheckCheck size={16} /> {settling ? 'در حال ثبت...' : `تسویه سهم ماهانه (${fmtToman(stats.remainingToPayDoctor)} تومان)`}
          </button>
        )}
      </div>

      {settleMessage && (
        <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-1.5">
          <CheckCircle2 size={15} /> <span>{settleMessage}</span>
        </div>
      )}

      {monthTreatments.length === 0 ? (
        <EmptyState icon={<UserCog size={28} />} title="درمان انجام‌شده تاییدشده‌ای در این ماه ثبت نشده" color="#8B5CF6" />
      ) : (
        <div className="space-y-2 stagger">
          {monthTreatments.map((t) => {
            const patient = patients.find((p) => p.id === t.patient_id);
            const realDate = resolveTreatmentRealizationDate(t);
            return (
              <div key={t.id} className="glass-card p-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-800">{patient ? `${patient.first_name} ${patient.last_name}` : 'بیمار'}</p>
                  <p className="text-[10px] text-gray-500">{t.diagnosis || 'درمان'} • {realDate ? toJalaliStr(realDate.slice(0, 10)) : '-'}</p>
                </div>
                <span className="text-sm font-black text-violet-700 tabular-nums">{fmtToman(calcTreatmentShare(t))} ت</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
