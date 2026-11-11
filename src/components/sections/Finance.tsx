import { useState, useMemo } from 'react';
import {
  Wallet, Plus, TrendingUp, TrendingDown,
  ArrowUpCircle, ArrowDownCircle, Search,
  CreditCard, FileCheck, ScrollText,
  CheckCircle2, XCircle, AlertTriangle, Trash2,
  User, UserCog, Stethoscope, FlaskConical, Package,
  FileSpreadsheet, BellRing, ShieldAlert, ChevronDown, ChevronUp,
  Calculator, Sparkles, CheckCheck, Phone, Percent, X, Briefcase,
} from 'lucide-react';
import { useRealtimeTable } from '@/lib/useRealtimeTable';
import {
  supabase, type FinanceTransaction, type Patient,
  type Installment, type Check, type Safteh, type Treatment,
  type Payment, type Staff, type Reminder,
} from '@/lib/supabase';
import { Sheet, ConfirmDialog } from '@/components/ui/Sheet';
import { Field, Input, Textarea, Select, Button, Badge, EmptyState, Loading } from '@/components/ui/Form';
import { JalaliDatePicker } from '@/components/ui/JalaliDatePicker';
import { toJalaliStr, JALALI_MONTHS, todayGregorian } from '@/lib/jalali';
import { exportToCsv } from '@/lib/exportUtils';
import { PersonalFinance } from '@/components/sections/PersonalFinance';

const fmt = (n: number) => Number(n || 0).toLocaleString('fa-IR');
const today = todayGregorian();

type FinanceTab = 'debtors' | 'doctor' | 'personal' | 'installments' | 'checks' | 'safteh' | 'transactions';

const TXN_TYPES = [
  { value: 'income', label: 'درآمد' },
  { value: 'expense', label: 'هزینه' },
  { value: 'transfer', label: 'انتقال' },
];

const CATEGORIES = [
  { value: 'patient_payment', label: 'پرداخت بیمار' },
  { value: 'salary', label: 'تسویه سهم پزشک / حقوق' },
  { value: 'rent', label: 'اجاره' },
  { value: 'utilities', label: 'قبوض' },
  { value: 'supplies', label: 'تجهیزات مصرفی' },
  { value: 'equipment', label: 'تجهیزات' },
  { value: 'lab_cost', label: 'هزینه لابراتوار' },
  { value: 'maintenance', label: 'تعمیر و نگهداری' },
  { value: 'marketing', label: 'تبلیغات' },
  { value: 'tax', label: 'مالیات' },
  { value: 'other', label: 'سایر' },
];

const PAYMENT_METHODS = [
  { value: 'cash', label: 'نقدی' },
  { value: 'card', label: 'کارت‌خوان' },
  { value: 'transfer', label: 'انتقال بانکی' },
  { value: 'insurance', label: 'بیمه' },
];

const INSTALLMENT_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: 'فعال',        color: '#22C55E', bg: '#DCFCE7' },
  completed: { label: 'تکمیل‌شده',   color: '#3B82F6', bg: '#DBEAFE' },
  overdue:   { label: 'سررسید گذشته', color: '#EF4444', bg: '#FEE2E2' },
  cancelled: { label: 'لغوشده',     color: '#9CA3AF', bg: '#F3F4F6' },
};

const CHECK_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: 'در جریان', color: '#F59E0B', bg: '#FEF3C7' },
  cleared:   { label: 'پاس‌شده',  color: '#22C55E', bg: '#DCFCE7' },
  bounced:   { label: 'برگشتی',   color: '#EF4444', bg: '#FEE2E2' },
  cancelled: { label: 'لغوشده',   color: '#9CA3AF', bg: '#F3F4F6' },
};

function addDaysToIso(dateStr: string, daysOffset: number): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return today;
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

function diffDaysFromToday(targetDate: string): number {
  const t0 = new Date(today).getTime();
  const t1 = new Date(targetDate).getTime();
  return Math.round((t1 - t0) / (1000 * 60 * 60 * 24));
}

export function Finance() {
  const { data: transactions, loading: lt, refresh: rt } = useRealtimeTable<FinanceTransaction>('finance_transactions');
  const { data: patients, loading: lp } = useRealtimeTable<Patient>('patients');
  const { data: installments, loading: li, refresh: ri } = useRealtimeTable<Installment>('installments');
  const { data: checks, loading: lc, refresh: rc } = useRealtimeTable<Check>('checks');
  const { data: safteh, loading: ls, refresh: rs } = useRealtimeTable<Safteh>('safteh');
  const { data: treatments, loading: ltr } = useRealtimeTable<Treatment>('treatments');
  const { data: payments, loading: lpay, refresh: rpay } = useRealtimeTable<Payment>('payments');
  const { data: staff } = useRealtimeTable<Staff>('staff');
  const { data: reminders, refresh: rrem } = useRealtimeTable<Reminder>('reminders');

  const [tab, setTab] = useState<FinanceTab>('debtors');
  const [searchOpen, setSearchOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');

  if (lt || lp || li || lc || ls || ltr || lpay) return <Loading color="#22C55E" />;

  const chips: { v: FinanceTab; l: string; i: React.ReactNode; badge?: number }[] = [
    {
      v: 'debtors',
      l: 'بدهکاران و مطالبات مطب',
      i: <ShieldAlert size={13} />,
    },
    {
      v: 'doctor',
      l: 'سهم کارکرد پزشکان',
      i: <UserCog size={13} />,
    },
    {
      v: 'personal',
      l: 'مالی شخصی (وام، اجاره، چک و خرید)',
      i: <Briefcase size={13} />,
    },
    {
      v: 'installments',
      l: 'اقساط',
      i: <CreditCard size={13} />,
      badge: installments.filter(i => i.status === 'active').length,
    },
    {
      v: 'checks',
      l: 'چک‌های صیادی',
      i: <FileCheck size={13} />,
      badge: checks.filter(c => c.status === 'pending').length,
    },
    {
      v: 'safteh',
      l: 'سفته و ضمانت',
      i: <ScrollText size={13} />,
      badge: safteh.filter(s => s.status === 'pending').length,
    },
    {
      v: 'transactions',
      l: 'خزانه و تراکنش‌ها',
      i: <Wallet size={13} />,
    },
  ];

  return (
    <div className="space-y-2.5 pb-36 animate-fade-in-up">
      {/* Sliding Chip Bar + Expandable Magnifier Search (Q-Bank Standard) */}
      <div className="glass-card p-2.5">
        <div className="flex items-center gap-2">
          {/* Expandable Magnifier Search Button */}
          <button
            onClick={() => {
              setSearchOpen(!searchOpen);
              if (searchOpen) setGlobalSearch('');
            }}
            data-testid="finance_search_toggle"
            className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 transition-all haptic ${
              searchOpen
                ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/30'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
            title="جستجوی سریع در امور مالی"
          >
            {searchOpen ? <X size={16} /> : <Search size={16} />}
          </button>

          {/* Horizontal Sliding Chip Bar */}
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 flex-1 no-scrollbar">
            {chips.map(c => {
              const active = tab === c.v;
              return (
                <button
                  key={c.v}
                  onClick={() => setTab(c.v)}
                  data-testid={`finance_tab_${c.v}`}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-bold whitespace-nowrap transition-all haptic ${
                    active
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-500/25 scale-[1.02]'
                      : 'bg-gray-100/90 text-gray-600 hover:bg-gray-200/70'
                  }`}
                >
                  {c.i}
                  <span>{c.l}</span>
                  {c.badge !== undefined && c.badge > 0 && (
                    <span
                      className={`px-1.5 py-0.2 rounded-full text-[10px] font-extrabold ${
                        active ? 'bg-white/25 text-white' : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {c.badge.toLocaleString('fa-IR')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Animated Expandable Search Input */}
        {searchOpen && (
          <div className="mt-2 pt-2 border-t border-gray-100 animate-slide-down">
            <div className="relative">
              <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600" />
              <Input
                autoFocus
                value={globalSearch}
                onChange={e => setGlobalSearch(e.target.value)}
                placeholder="جستجوی نام بیمار، شماره دندان، شماره چک صیادی، کد درمان..."
                className="pr-9 text-xs"
              />
            </div>
          </div>
        )}
      </div>

      {tab === 'debtors' && (
        <DebtorsAndReceivablesTab
          patients={patients}
          treatments={treatments}
          payments={payments}
          installments={installments}
          checks={checks}
          safteh={safteh}
          reminders={reminders}
          searchQuery={globalSearch}
          onRefreshAll={() => {
            rpay();
            ri();
            rc();
            rs();
            rt();
            rrem();
          }}
        />
      )}
      {tab === 'doctor' && (
        <DoctorTab
          treatments={treatments}
          patients={patients}
          staff={staff}
          transactions={transactions}
          searchQuery={globalSearch}
          onRefreshTransactions={rt}
        />
      )}
      {tab === 'personal' && <PersonalFinance />}
      {tab === 'installments' && <InstallmentsTab installments={installments} patients={patients} refresh={ri} />}
      {tab === 'checks' && <ChecksTab checks={checks} patients={patients} refresh={rc} />}
      {tab === 'safteh' && <SaftehTab safteh={safteh} patients={patients} refresh={rs} />}
      {tab === 'transactions' && <TransactionsTab transactions={transactions} patients={patients} refresh={rt} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. CLINIC DEBTORS & RECEIVABLES AUDIT + SMART AUTO-REMINDER ENGINE
 *    (مطب طرف حساب بدهکاران، اقساط، چک‌ها و پرداختی‌ها است)
 * ═══════════════════════════════════════════════════════════════════════════ */
function DebtorsAndReceivablesTab({
  patients,
  treatments,
  payments,
  installments,
  checks,
  safteh,
  reminders,
  searchQuery,
  onRefreshAll,
}: {
  patients: Patient[];
  treatments: Treatment[];
  payments: Payment[];
  installments: Installment[];
  checks: Check[];
  safteh: Safteh[];
  reminders: Reminder[];
  searchQuery: string;
  onRefreshAll: () => void;
}) {
  const [filterMode, setFilterMode] = useState<'all_debtors' | 'overdue' | 'uncovered' | 'checks_due' | 'installments_due'>('all_debtors');
  const [expandedPatientId, setExpandedPatientId] = useState<string | null>(null);
  const [leadDaysBefore, setLeadDaysBefore] = useState<number>(3);
  const [syncingReminders, setSyncingReminders] = useState(false);
  const [syncResultMsg, setSyncResultMsg] = useState<string | null>(null);
  const [quickPayPatient, setQuickPayPatient] = useState<{ patient: Patient; suggestedAmount: number } | null>(null);
  const [quickPayAmount, setQuickPayAmount] = useState('');
  const [quickPayMethod, setQuickPayMethod] = useState('card');
  const [savingQuickPay, setSavingQuickPay] = useState(false);

  // Build comprehensive per-patient financial ledger
  const patientLedgers = useMemo(() => {
    return patients
      .map(p => {
        const pTreatments = treatments.filter(t => t.patient_id === p.id && t.status !== 'cancelled');
        const pPayments = payments.filter(pay => pay.patient_id === p.id && pay.status === 'completed');
        const pInstallments = installments.filter(ins => ins.patient_id === p.id && ins.status === 'active');
        const pChecks = checks.filter(ch => ch.patient_id === p.id && (ch.status === 'pending' || ch.status === 'bounced'));
        const pSafteh = safteh.filter(sf => sf.patient_id === p.id && (sf.status === 'pending' || sf.status === 'bounced'));

        const totalTreatmentCost = pTreatments.reduce((s, t) => s + Number(t.total_cost || 0), 0);
        const totalDirectPaid = pTreatments.reduce((s, t) => s + Number(t.paid_amount || 0), 0);
        const totalPaymentsTable = pPayments.reduce((s, pay) => s + Number(pay.amount || 0), 0);
        const effectivePaid = Math.max(totalDirectPaid, totalPaymentsTable);

        const totalRemainingDebt = Math.max(0, totalTreatmentCost - effectivePaid);

        const installmentRemaining = pInstallments.reduce(
          (s, ins) => s + Math.max(0, Number(ins.total_amount) - Number(ins.paid_amount)),
          0
        );
        const pendingChecksAmount = pChecks
          .filter(c => c.status === 'pending')
          .reduce((s, c) => s + Number(c.amount), 0);
        const bouncedChecksAmount = pChecks
          .filter(c => c.status === 'bounced')
          .reduce((s, c) => s + Number(c.amount), 0);
        const pendingSaftehAmount = pSafteh.reduce((s, sf) => s + Number(sf.amount), 0);

        // Uncovered open debt (بدهی باز بدون چک یا قسط)
        const coveredByInstruments = installmentRemaining + pendingChecksAmount;
        const uncoveredDebt = Math.max(0, totalRemainingDebt - coveredByInstruments);

        // Overdue checks & installments
        const overdueInstallments = pInstallments.filter(i => i.next_due_date && i.next_due_date <= today);
        const upcomingInstallments = pInstallments.filter(
          i => i.next_due_date && diffDaysFromToday(i.next_due_date) > 0 && diffDaysFromToday(i.next_due_date) <= leadDaysBefore
        );

        const overdueChecks = pChecks.filter(c => c.due_date <= today || c.status === 'bounced');
        const upcomingChecks = pChecks.filter(
          c => c.status === 'pending' && diffDaysFromToday(c.due_date) > 0 && diffDaysFromToday(c.due_date) <= leadDaysBefore
        );

        const hasAnyFinancialObligation =
          totalRemainingDebt > 0 ||
          installmentRemaining > 0 ||
          pendingChecksAmount > 0 ||
          bouncedChecksAmount > 0 ||
          pendingSaftehAmount > 0;

        const isOverdue = overdueInstallments.length > 0 || overdueChecks.length > 0 || bouncedChecksAmount > 0;
        const isUpcoming = upcomingInstallments.length > 0 || upcomingChecks.length > 0;

        // Calculate earliest due date
        const dueDates: string[] = [];
        pInstallments.forEach(i => { if (i.next_due_date) dueDates.push(i.next_due_date); });
        pChecks.forEach(c => { if (c.due_date) dueDates.push(c.due_date); });
        pSafteh.forEach(sf => { if (sf.due_date) dueDates.push(sf.due_date); });
        dueDates.sort();
        const nearestDueDate = dueDates[0] || null;

        return {
          patient: p,
          treatments: pTreatments,
          payments: pPayments,
          installments: pInstallments,
          checks: pChecks,
          safteh: pSafteh,
          totalTreatmentCost,
          effectivePaid,
          totalRemainingDebt,
          installmentRemaining,
          pendingChecksAmount,
          bouncedChecksAmount,
          pendingSaftehAmount,
          uncoveredDebt,
          overdueInstallments,
          upcomingInstallments,
          overdueChecks,
          upcomingChecks,
          hasAnyFinancialObligation,
          isOverdue,
          isUpcoming,
          nearestDueDate,
        };
      })
      .filter(item => item.hasAnyFinancialObligation)
      .sort((a, b) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        if (a.isUpcoming !== b.isUpcoming) return a.isUpcoming ? -1 : 1;
        return b.totalRemainingDebt - a.totalRemainingDebt;
      });
  }, [patients, treatments, payments, installments, checks, safteh, leadDaysBefore]);

  const filteredLedgers = useMemo(() => {
    let list = patientLedgers;
    if (filterMode === 'overdue') {
      list = list.filter(l => l.isOverdue || l.isUpcoming);
    } else if (filterMode === 'uncovered') {
      list = list.filter(l => l.uncoveredDebt > 0);
    } else if (filterMode === 'checks_due') {
      list = list.filter(l => l.checks.length > 0);
    } else if (filterMode === 'installments_due') {
      list = list.filter(l => l.installments.length > 0);
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        l =>
          `${l.patient.first_name} ${l.patient.last_name}`.toLowerCase().includes(q) ||
          l.patient.phone?.includes(q) ||
          l.treatments.some(t => t.tooth_numbers?.includes(q) || t.diagnosis?.toLowerCase().includes(q))
      );
    }
    return list;
  }, [patientLedgers, filterMode, searchQuery]);

  // Overall clinic receivables summary
  const summary = useMemo(() => {
    const totalReceivables = patientLedgers.reduce((s, l) => s + l.totalRemainingDebt, 0);
    const totalUncovered = patientLedgers.reduce((s, l) => s + l.uncoveredDebt, 0);
    const totalChecksInHand = patientLedgers.reduce((s, l) => s + l.pendingChecksAmount, 0);
    const totalInstallmentsActive = patientLedgers.reduce((s, l) => s + l.installmentRemaining, 0);
    const overduePatientsCount = patientLedgers.filter(l => l.isOverdue).length;
    return {
      totalReceivables,
      totalUncovered,
      totalChecksInHand,
      totalInstallmentsActive,
      overduePatientsCount,
      totalDebtorsCount: patientLedgers.length,
    };
  }, [patientLedgers]);

  // Smart Multi-Stage Reminder Generator for Checks, Installments & Uncovered Debts
  const handleGenerateSmartReminders = async () => {
    setSyncingReminders(true);
    setSyncResultMsg(null);
    let createdCount = 0;

    try {
      for (const ledger of patientLedgers) {
        const pName = `${ledger.patient.first_name} ${ledger.patient.last_name}`;

        // 1. Check Reminders (N days before due_date + on due_date)
        for (const ch of ledger.checks) {
          const targetReminderDate =
            diffDaysFromToday(ch.due_date) > leadDaysBefore
              ? addDaysToIso(ch.due_date, -leadDaysBefore)
              : today;
          const title = `یادآوری سررسید چک صیادی: ${pName} (${fmt(ch.amount)} تومان)`;
          const exists = reminders.some(
            r => r.patient_id === ledger.patient.id && r.title === title && r.status === 'pending'
          );
          if (!exists) {
            await supabase.from('reminders').insert({
              patient_id: ledger.patient.id,
              title,
              description: `چک شماره ${ch.check_number || '-'} بانک ${ch.bank_name || '-'} به مبلغ ${fmt(ch.amount)} تومان با سررسید ${toJalaliStr(ch.due_date)}. (${leadDaysBefore} روز قبل از سررسید)`,
              reminder_date: targetReminderDate,
              reminder_time: '09:30',
              category: 'payment',
              priority: ch.due_date <= today ? 'urgent' : 'high',
              status: 'pending',
            });
            createdCount++;
          }
        }

        // 2. Installment Reminders (N days before next_due_date)
        for (const ins of ledger.installments) {
          if (!ins.next_due_date) continue;
          const targetReminderDate =
            diffDaysFromToday(ins.next_due_date) > leadDaysBefore
              ? addDaysToIso(ins.next_due_date, -leadDaysBefore)
              : today;
          const title = `یادآوری قسط ماهانه: ${pName} (${fmt(ins.monthly_amount)} تومان)`;
          const exists = reminders.some(
            r => r.patient_id === ledger.patient.id && r.title === title && r.status === 'pending'
          );
          if (!exists) {
            await supabase.from('reminders').insert({
              patient_id: ledger.patient.id,
              title,
              description: `قسط شماره ${ins.paid_months + 1} از ${ins.total_months} به مبلغ ${fmt(ins.monthly_amount)} تومان با سررسید ${toJalaliStr(ins.next_due_date)}.`,
              reminder_date: targetReminderDate,
              reminder_time: '10:00',
              category: 'payment',
              priority: ins.next_due_date <= today ? 'urgent' : 'high',
              status: 'pending',
            });
            createdCount++;
          }
        }

        // 3. Uncovered Open Debt Follow-up Reminder
        if (ledger.uncoveredDebt > 0) {
          const title = `پیگیری تسویه بدهی باز درمانی: ${pName} (${fmt(ledger.uncoveredDebt)} تومان)`;
          const exists = reminders.some(
            r => r.patient_id === ledger.patient.id && r.title === title && r.status === 'pending'
          );
          if (!exists) {
            await supabase.from('reminders').insert({
              patient_id: ledger.patient.id,
              title,
              description: `بیمار دارای ${fmt(ledger.uncoveredDebt)} تومان مانده بدهی درمانی بدون چک یا تقسیط است. جهت تعیین تکلیف یا تسویه تماس گرفته شود.`,
              reminder_date: today,
              reminder_time: '11:00',
              category: 'payment',
              priority: 'high',
              status: 'pending',
            });
            createdCount++;
          }
        }
      }

      onRefreshAll();
      setSyncResultMsg(
        createdCount > 0
          ? `${createdCount.toLocaleString('fa-IR')} یادآوری هوشمند جدید (با بازه پیش‌فرض ${leadDaysBefore.toLocaleString('fa-IR')} روز قبل از سررسید) در سیستم ثبت و فعال شد.`
          : 'تمامی یادآوری‌های چک‌ها، اقساط و بدهکاران از قبل به‌روز و فعال هستند.'
      );
    } catch {
      setSyncResultMsg('خطا در همگام‌سازی یادآوری‌ها.');
    } finally {
      setSyncingReminders(false);
    }
  };

  const handleQuickPaySubmit = async () => {
    if (!quickPayPatient || !quickPayAmount) return;
    const amt = Number(quickPayAmount);
    if (amt <= 0) return;
    setSavingQuickPay(true);

    try {
      const pId = quickPayPatient.patient.id;
      // 1. Insert into payments
      await supabase.from('payments').insert({
        patient_id: pId,
        amount: amt,
        payment_method: quickPayMethod,
        payment_date: today,
        description: `تسویه بدهی بیمار (${quickPayPatient.patient.first_name} ${quickPayPatient.patient.last_name})`,
        status: 'completed',
      });

      // 2. Insert into finance_transactions (clinic treasury)
      await supabase.from('finance_transactions').insert({
        type: 'income',
        category: 'patient_payment',
        amount: amt,
        transaction_date: today,
        patient_id: pId,
        payment_method: quickPayMethod,
        description: `دریافت بدهی درمانی - ${quickPayPatient.patient.first_name} ${quickPayPatient.patient.last_name}`,
      });

      // 3. Distribute paid amount across unpaid treatments of this patient
      let remainingToAllocate = amt;
      const pTreatments = treatments.filter(t => t.patient_id === pId && Number(t.total_cost) > Number(t.paid_amount));
      for (const tr of pTreatments) {
        if (remainingToAllocate <= 0) break;
        const unpaid = Number(tr.total_cost) - Number(tr.paid_amount);
        const addNow = Math.min(unpaid, remainingToAllocate);
        await supabase
          .from('treatments')
          .update({ paid_amount: Number(tr.paid_amount) + addNow })
          .eq('id', tr.id);
        remainingToAllocate -= addNow;
      }

      setQuickPayPatient(null);
      setQuickPayAmount('');
      onRefreshAll();
    } finally {
      setSavingQuickPay(false);
    }
  };

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Clinic Receivables Command Banner */}
      <div
        className="bento-tile"
        style={{
          background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 55%, #065F46 100%)',
          boxShadow: '0 10px 30px rgba(6, 95, 70, 0.25)',
        }}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-[10px] font-bold mb-1">
              <ShieldAlert size={11} />
              <span>مرکز کنترل مطالبات مطب (مستقل از کارکرد پزشکان)</span>
            </div>
            <p className="text-xs text-slate-300">کل مطالبات و بدهی‌های بیماران به مطب</p>
            <p className="text-2xl font-black text-white tracking-tight mt-0.5">
              {fmt(summary.totalReceivables)} <span className="text-xs font-normal text-emerald-300">تومان</span>
            </p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300">
            <Wallet size={22} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/10">
          <div className="bg-white/5 rounded-xl p-2">
            <p className="text-[9px] text-rose-300 font-semibold">بدهی باز (بدون چک/قسط)</p>
            <p className="text-xs font-black text-white mt-0.5">{fmt(summary.totalUncovered)} ت</p>
          </div>
          <div className="bg-white/5 rounded-xl p-2">
            <p className="text-[9px] text-amber-300 font-semibold">چک‌های نزد مطب</p>
            <p className="text-xs font-black text-white mt-0.5">{fmt(summary.totalChecksInHand)} ت</p>
          </div>
          <div className="bg-white/5 rounded-xl p-2">
            <p className="text-[9px] text-cyan-300 font-semibold">اقساط در جریان</p>
            <p className="text-xs font-black text-white mt-0.5">{fmt(summary.totalInstallmentsActive)} ت</p>
          </div>
        </div>
      </div>

      {/* Smart Multi-Stage Auto-Reminder Control Panel */}
      <div className="glass-card p-3.5 space-y-2.5 border border-emerald-200/80">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
              <BellRing size={16} />
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-gray-800">
                سیستم هوشمند یادآوری خودکار چک، اقساط و بدهی‌ها
              </h3>
              <p className="text-[10px] text-gray-500">
                تعیین زمان هشدار قبل از سررسید برای پیگیری منشی و مدیریت مطب
              </p>
            </div>
          </div>

          {/* Lead days selector */}
          <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
            {[1, 2, 3, 5, 7, 10].map(d => (
              <button
                key={d}
                onClick={() => setLeadDaysBefore(d)}
                className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                  leadDaysBefore === d
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-200'
                }`}
              >
                {d.toLocaleString('fa-IR')} روز قبل
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleGenerateSmartReminders}
          disabled={syncingReminders}
          data-testid="sync_smart_finance_reminders_button"
          className="w-full py-2.5 px-3 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white text-xs font-bold shadow-md shadow-amber-500/20 flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
        >
          <Sparkles size={15} />
          {syncingReminders
            ? 'در حال اسکن پرونده‌ها و ساخت یادآوری‌ها...'
            : `تولید خودکار یادآوری برای کلیه چک‌ها، اقساط و بدهکاران (${leadDaysBefore.toLocaleString('fa-IR')} روز قبل از سررسید)`}
        </button>

        {syncResultMsg && (
          <div className="p-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] flex items-center gap-1.5">
            <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
            <span>{syncResultMsg}</span>
          </div>
        )}
      </div>

      {/* Filter Chips for Debtors */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {[
          { id: 'all_debtors' as const, label: `همه بدهکاران (${patientLedgers.length.toLocaleString('fa-IR')})` },
          { id: 'overdue' as const, label: `معوق و نزدیک سررسید (${summary.overduePatientsCount.toLocaleString('fa-IR')})` },
          { id: 'uncovered' as const, label: 'بدهی باز (بدون چک/قسط)' },
          { id: 'checks_due' as const, label: 'دارای چک صیادی' },
          { id: 'installments_due' as const, label: 'دارای تقسیط فعال' },
        ].map(f => (
          <button
            key={f.id}
            onClick={() => setFilterMode(f.id)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-all haptic ${
              filterMode === f.id
                ? 'bg-slate-800 text-white shadow-sm'
                : 'bg-white/80 text-gray-600 border border-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Debtors Collapsible Cards with Full Treatment, Tooth, Doctor & Instrument Audit */}
      {filteredLedgers.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 size={28} />}
          title="موردی در این دسته‌بندی یافت نشد"
          subtitle="تمامی حساب‌های این بخش تسویه یا تعیین تکلیف شده‌اند"
          color="#10B981"
        />
      ) : (
        <div className="space-y-2.5 stagger">
          {filteredLedgers.map(item => {
            const isExpanded = expandedPatientId === item.patient.id;
            return (
              <div
                key={item.patient.id}
                className="glass-card p-3.5 transition-all"
                style={{
                  borderRight: item.isOverdue
                    ? '4px solid #EF4444'
                    : item.uncoveredDebt > 0
                    ? '4px solid #F59E0B'
                    : '4px solid #10B981',
                }}
              >
                {/* Top Summary Row */}
                <div
                  className="flex items-start justify-between gap-2 cursor-pointer"
                  onClick={() => setExpandedPatientId(isExpanded ? null : item.patient.id)}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-sm"
                      style={{
                        background: item.isOverdue
                          ? 'linear-gradient(135deg,#EF4444,#DC2626)'
                          : 'linear-gradient(135deg,#10B981,#059669)',
                      }}
                    >
                      {item.patient.first_name[0]}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-extrabold text-gray-800 truncate">
                          {item.patient.first_name} {item.patient.last_name}
                        </p>
                        {item.isOverdue && (
                          <Badge color="#EF4444" bg="#FEE2E2">
                            سررسید گذشته / معوق
                          </Badge>
                        )}
                        {!item.isOverdue && item.isUpcoming && (
                          <Badge color="#D97706" bg="#FEF3C7">
                            نزدیک سررسید
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2.5 text-[11px] text-gray-500 mt-0.5">
                        {item.patient.phone && (
                          <span className="flex items-center gap-1">
                            <Phone size={10} /> {item.patient.phone}
                          </span>
                        )}
                        <span>{item.treatments.length.toLocaleString('fa-IR')} درمان</span>
                        {item.nearestDueDate && (
                          <span className="text-amber-700 font-semibold">
                            نزدیک‌ترین سررسید: {toJalaliStr(item.nearestDueDate)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-left shrink-0 flex items-center gap-2">
                    <div>
                      <p className="text-[10px] text-gray-400">مانده کل بدهی</p>
                      <p className="text-sm font-black text-rose-600">{fmt(item.totalRemainingDebt)} ت</p>
                    </div>
                    <div className="w-7 h-7 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500">
                      {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </div>
                  </div>
                </div>

                {/* Financial Coverage Pills (Open Debt vs Check vs Installment) */}
                <div className="grid grid-cols-3 gap-1.5 mt-2.5 pt-2 border-t border-gray-100 text-[10px]">
                  <div className="bg-emerald-50/80 rounded-xl px-2 py-1.5">
                    <span className="text-gray-500 block">پرداخت‌شده تاکنون</span>
                    <strong className="text-emerald-700">{fmt(item.effectivePaid)} ت</strong>
                  </div>
                  <div className="bg-amber-50/80 rounded-xl px-2 py-1.5">
                    <span className="text-gray-500 block">پوشش چک و اقساط</span>
                    <strong className="text-amber-700">
                      {fmt(item.installmentRemaining + item.pendingChecksAmount)} ت
                    </strong>
                  </div>
                  <div className="bg-rose-50/80 rounded-xl px-2 py-1.5">
                    <span className="text-gray-500 block">بدهی باز بدون تضمین</span>
                    <strong className="text-rose-700">{fmt(item.uncoveredDebt)} ت</strong>
                  </div>
                </div>

                {/* Quick Action Bar */}
                <div className="flex items-center gap-2 mt-2.5">
                  <button
                    onClick={() => {
                      setQuickPayPatient({
                        patient: item.patient,
                        suggestedAmount: item.uncoveredDebt > 0 ? item.uncoveredDebt : item.totalRemainingDebt,
                      });
                      setQuickPayAmount(
                        String(item.uncoveredDebt > 0 ? item.uncoveredDebt : item.totalRemainingDebt)
                      );
                    }}
                    className="flex-1 py-1.5 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center justify-center gap-1 transition-all active:scale-95"
                  >
                    <CheckCircle2 size={13} />
                    ثبت دریافت وجه / تسویه
                  </button>

                  {item.patient.phone && (
                    <a
                      href={`tel:${item.patient.phone}`}
                      className="py-1.5 px-3 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 text-[11px] font-bold flex items-center justify-center gap-1 no-underline transition-all"
                    >
                      <Phone size={12} />
                      تماس با بیمار
                    </a>
                  )}

                  <button
                    onClick={() => setExpandedPatientId(isExpanded ? null : item.patient.id)}
                    className="py-1.5 px-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-[11px] font-bold transition-all"
                  >
                    {isExpanded ? 'بستن ریز پرونده' : 'ریز درمان و چک‌ها'}
                  </button>
                </div>

                {/* Collapsible Detailed Audit Breakdown */}
                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-gray-200/80 space-y-2.5 animate-slide-down">
                    <p className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5">
                      <Stethoscope size={14} className="text-violet-600" />
                      ریز کامل درمان‌ها، شماره دندان، هزینه و سهم پزشک:
                    </p>
                    {item.treatments.length === 0 ? (
                      <p className="text-[11px] text-gray-400">درمانی ثبت نشده است.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {item.treatments.map(t => {
                          const rem = Math.max(0, Number(t.total_cost) - Number(t.paid_amount));
                          return (
                            <div
                              key={t.id}
                              className="rounded-xl bg-gray-50 p-2.5 border border-gray-200/60 text-[11px] space-y-1"
                            >
                              <div className="flex items-center justify-between font-bold text-gray-800">
                                <span>
                                  {t.diagnosis || t.treatment_plan || 'خدمات دندانپزشکی'}
                                  {t.tooth_numbers ? ` • دندان: ${t.tooth_numbers}` : ''}
                                </span>
                                <span className="text-gray-500 text-[10px]">
                                  {toJalaliStr(t.created_at.slice(0, 10))}
                                </span>
                              </div>
                              <div className="grid grid-cols-3 gap-1 text-[10px] pt-1 border-t border-gray-200/50">
                                <span>هزینه کل: <b>{fmt(t.total_cost)} ت</b></span>
                                <span className="text-emerald-700">پرداختی: <b>{fmt(t.paid_amount)} ت</b></span>
                                <span className="text-rose-600">مانده: <b>{fmt(rem)} ت</b></span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Active Checks & Installments of this Patient */}
                    {(item.checks.length > 0 || item.installments.length > 0 || item.safteh.length > 0) && (
                      <div className="space-y-1.5 pt-1">
                        <p className="text-xs font-extrabold text-gray-700 flex items-center gap-1.5">
                          <FileCheck size={14} className="text-amber-600" />
                          چک‌های صیادی، اقساط و تضامین بیمار نزد مطب:
                        </p>
                        {item.checks.map(ch => (
                          <div
                            key={ch.id}
                            className="flex items-center justify-between bg-amber-50/90 border border-amber-200 rounded-xl px-2.5 py-1.5 text-[11px]"
                          >
                            <span>
                              چک {ch.bank_name || ''} #{ch.check_number || '-'} • سررسید:{' '}
                              <b>{toJalaliStr(ch.due_date)}</b>
                            </span>
                            <span className="font-bold text-amber-800">{fmt(ch.amount)} ت</span>
                          </div>
                        ))}
                        {item.installments.map(ins => (
                          <div
                            key={ins.id}
                            className="flex items-center justify-between bg-blue-50/90 border border-blue-200 rounded-xl px-2.5 py-1.5 text-[11px]"
                          >
                            <span>
                              قسط ({ins.paid_months}/{ins.total_months}) • سررسید بعدی:{' '}
                              <b>{ins.next_due_date ? toJalaliStr(ins.next_due_date) : '-'}</b>
                            </span>
                            <span className="font-bold text-blue-800">
                              ماهانه {fmt(ins.monthly_amount)} ت
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Quick Payment Sheet */}
      <Sheet
        open={!!quickPayPatient}
        onClose={() => setQuickPayPatient(null)}
        title={
          quickPayPatient
            ? `ثبت دریافت وجه از ${quickPayPatient.patient.first_name} ${quickPayPatient.patient.last_name}`
            : ''
        }
        icon={<Wallet size={20} />}
        color="#10B981"
      >
        <div className="space-y-3.5">
          <Field label="مبلغ دریافتی به تومان">
            <Input
              type="number"
              value={quickPayAmount}
              onChange={e => setQuickPayAmount(e.target.value)}
              placeholder="مبلغ دریافتی..."
            />
          </Field>
          <Field label="روش پرداخت به مطب">
            <Select
              value={quickPayMethod}
              onChange={e => setQuickPayMethod(e.target.value)}
              options={PAYMENT_METHODS}
            />
          </Field>
          <Button
            color="#10B981"
            disabled={savingQuickPay || !quickPayAmount}
            onClick={handleQuickPaySubmit}
            className="w-full"
          >
            {savingQuickPay ? 'در حال ثبت در خزانه مطب...' : 'تأیید و کسر از بدهی بیمار'}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. DOCTOR MONTHLY WORK & COMMISSION ENGINE (سهم پزشک از کارکرد ماهانه)
 *    100% Independent from patient cash/check/installment payments!
 *    Supports 3 Formula Models + Manager Profile (دکتر مهدی امیری)
 * ═══════════════════════════════════════════════════════════════════════════ */
type CommissionFormulaMode = 'net_after_lab_half' | 'custom_percentage' | 'fixed_per_treatment';

function DoctorTab({
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
  const currentMonth = todayGregorian().slice(0, 7);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [formulaMode, setFormulaMode] = useState<CommissionFormulaMode>('net_after_lab_half');
  const [customPercent, setCustomPercent] = useState<number>(50);
  const [selectedDoctorProfile, setSelectedDoctorProfile] = useState<string>('mehdi_amiri_manager');
  const [settling, setSettling] = useState(false);
  const [settleMessage, setSettleMessage] = useState<string | null>(null);

  const monthKey = (d: string) => d.slice(0, 7);

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    treatments.forEach(t => { if (t.created_at) months.add(monthKey(t.created_at)); });
    months.add(currentMonth);
    return Array.from(months).sort().reverse();
  }, [treatments, currentMonth]);

  const doctorsList = useMemo(() => {
    const dbDocs = staff.filter(s => s.role === 'dentist' || s.role === 'doctor' || s.role === 'manager');
    return [
      { id: 'mehdi_amiri_manager', name: 'دکتر مهدی امیری (مدیر و پزشک ارشد)', isManager: true, defaultPercent: 100 },
      ...dbDocs.map(d => ({
        id: d.id,
        name: `دکتر ${d.first_name} ${d.last_name}`,
        isManager: false,
        defaultPercent: 50,
      })),
    ];
  }, [staff]);

  const currentDocObj = doctorsList.find(d => d.id === selectedDoctorProfile) || doctorsList[0];

  const monthTreatments = useMemo(() => {
    let list = treatments.filter(t => monthKey(t.created_at) === selectedMonth && t.status !== 'cancelled');
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(t => {
        const p = patients.find(pt => pt.id === t.patient_id);
        const pName = p ? `${p.first_name} ${p.last_name}`.toLowerCase() : '';
        return (
          pName.includes(q) ||
          t.diagnosis?.toLowerCase().includes(q) ||
          t.tooth_numbers?.includes(q)
        );
      });
    }
    return list;
  }, [treatments, selectedMonth, searchQuery, patients]);

  // Calculate per-treatment and monthly totals based on selected formula mode
  const calcTreatmentShare = (t: Treatment): number => {
    const gross = Number(t.total_cost || 0);
    const lab = Number(t.lab_cost || 0);
    const fixedDoc = Number(t.doctor_cost || 0);
    const netAfterLab = Math.max(0, gross - lab);

    if (currentDocObj.isManager && formulaMode === 'custom_percentage' && customPercent === 100) {
      return netAfterLab;
    }

    if (formulaMode === 'net_after_lab_half') {
      // راه اول: (کل کارکرد منهای کل هزینه لابراتوار) تقسیم بر ۲
      return Math.round(netAfterLab / 2);
    } else if (formulaMode === 'fixed_per_treatment') {
      // راه دوم: دستمزد ثابت هر جراحی یا درمان که دستی ثبت می‌شود
      return fixedDoc > 0 ? fixedDoc : Math.round(netAfterLab / 2);
    } else {
      // راه سوم: درصدی اختصاصی هر پزشک (از خالص پس از کسر لابراتوار)
      return Math.round((netAfterLab * customPercent) / 100);
    }
  };

  const stats = useMemo(() => {
    const grossWorkTotal = monthTreatments.reduce((s, t) => s + Number(t.total_cost || 0), 0);
    const labTotal = monthTreatments.reduce((s, t) => s + Number(t.lab_cost || 0), 0);
    const matTotal = monthTreatments.reduce((s, t) => s + Number(t.material_cost || 0), 0);
    const netAfterLabTotal = Math.max(0, grossWorkTotal - labTotal);
    const calculatedDoctorShare = monthTreatments.reduce((s, t) => s + calcTreatmentShare(t), 0);
    const clinicShare = Math.max(0, netAfterLabTotal - calculatedDoctorShare);

    // Check how much has already been paid out to doctors this month in finance_transactions
    const paidOutThisMonth = transactions
      .filter(
        tx =>
          tx.type === 'expense' &&
          tx.category === 'salary' &&
          tx.reference === `DOC_SETTLE_${selectedMonth}_${selectedDoctorProfile}`
      )
      .reduce((s, tx) => s + Number(tx.amount || 0), 0);

    const remainingToPayDoctor = Math.max(0, calculatedDoctorShare - paidOutThisMonth);

    return {
      grossWorkTotal,
      labTotal,
      matTotal,
      netAfterLabTotal,
      calculatedDoctorShare,
      clinicShare,
      paidOutThisMonth,
      remainingToPayDoctor,
      totalCount: monthTreatments.length,
    };
  }, [monthTreatments, formulaMode, customPercent, selectedDoctorProfile, transactions, selectedMonth]);

  const getPatient = (id: string | null) => patients.find(p => p.id === id);

  const faMonthName = (m: string) => {
    const [y, mo] = m.split('-');
    const mi = Number(mo) - 1;
    return `${JALALI_MONTHS[mi] ?? mo} ${Number(y).toLocaleString('fa-IR')}`;
  };

  const handleSettleDoctorMonthlyShare = async () => {
    if (stats.remainingToPayDoctor <= 0) return;
    setSettling(true);
    setSettleMessage(null);
    try {
      await supabase.from('finance_transactions').insert({
        type: 'expense',
        category: 'salary',
        amount: stats.remainingToPayDoctor,
        transaction_date: today,
        payment_method: 'transfer',
        reference: `DOC_SETTLE_${selectedMonth}_${selectedDoctorProfile}`,
        description: `تسویه کامل سهم کارکرد ماه ${faMonthName(selectedMonth)} - ${currentDocObj.name} (مستقل از بدهی/اقساط بیماران)`,
      });
      onRefreshTransactions();
      setSettleMessage(
        `مبلغ ${fmt(stats.remainingToPayDoctor)} تومان بابت تسویه کارکرد ماهانه ${currentDocObj.name} در خزانه ثبت و پرداخت شد.`
      );
    } catch {
      setSettleMessage('خطا در ثبت تسویه پزشک.');
    } finally {
      setSettling(false);
    }
  };

  const handleExportDoctor = () => {
    exportToCsv(
      `گزارش_سهم_کارکرد_پزشک_${selectedMonth}`,
      ['بیمار', 'شماره دندان', 'تاریخ درمان', 'کل کارکرد (تومان)', 'هزینه لابراتوار', 'خالص پس از لابراتوار', 'سهم محاسبه‌شده پزشک (تومان)', 'وضعیت وصول بیمار'],
      monthTreatments.map(t => {
        const p = getPatient(t.patient_id);
        const gross = Number(t.total_cost || 0);
        const lab = Number(t.lab_cost || 0);
        const share = calcTreatmentShare(t);
        return [
          p ? `${p.first_name} ${p.last_name}` : '-',
          t.tooth_numbers ? `دندان ${t.tooth_numbers}` : 'عمومی',
          t.created_at ? toJalaliStr(t.created_at.slice(0, 10)) : '-',
          String(gross),
          String(lab),
          String(Math.max(0, gross - lab)),
          String(share),
          'طرف حساب وصول: مطب (تسویه با پزشک بر اساس کارکرد)',
        ];
      })
    );
  };

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Golden Rule Explanation + Doctor & Month Selector */}
      <div className="glass-card p-3.5 space-y-3 border border-violet-200">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-2xl bg-violet-100 text-violet-700 flex items-center justify-center">
              <Calculator size={18} />
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-gray-800">
                موتور محاسبه سهم ماهانه پزشک (صرفاً بر اساس کارکرد)
              </h3>
              <p className="text-[10px] text-violet-700 font-semibold">
                مستقل از نحوه پرداخت بیمار (چک، اقساط یا بدهکاری بیمار طرف حساب مطب است)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={handleExportDoctor}
              title="خروجی اکسل کارکرد پزشک"
              className="w-8 h-8 rounded-xl bg-violet-600 text-white flex items-center justify-center shadow haptic"
            >
              <FileSpreadsheet size={15} />
            </button>
            <select
              value={selectedMonth}
              onChange={e => setSelectedMonth(e.target.value)}
              className="text-xs font-bold rounded-xl bg-violet-50 text-violet-900 px-3 py-1.5 border border-violet-200 outline-none"
            >
              {availableMonths.map(m => (
                <option key={m} value={m}>{faMonthName(m)}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Select Doctor Profile (Manager Mehdi Amiri vs Other Doctors) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-gray-500 block mb-1">انتخاب پزشک / مدیر کلینیک:</label>
            <select
              value={selectedDoctorProfile}
              onChange={e => {
                setSelectedDoctorProfile(e.target.value);
                if (e.target.value === 'mehdi_amiri_manager') {
                  setCustomPercent(100);
                } else {
                  setCustomPercent(50);
                }
              }}
              className="w-full text-xs font-bold rounded-xl bg-gray-100 px-3 py-2 border border-gray-200 outline-none"
            >
              {doctorsList.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-gray-500 block mb-1">مدل فرمول محاسبه سهم پزشک:</label>
            <div className="grid grid-cols-3 gap-1 bg-gray-100 p-1 rounded-xl">
              <button
                onClick={() => setFormulaMode('net_after_lab_half')}
                className={`py-1.5 px-1.5 rounded-lg text-[10px] font-bold transition-all ${
                  formulaMode === 'net_after_lab_half'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-gray-600'
                }`}
              >
                (کارکرد - لابراتوار) ÷ ۲
              </button>
              <button
                onClick={() => setFormulaMode('fixed_per_treatment')}
                className={`py-1.5 px-1.5 rounded-lg text-[10px] font-bold transition-all ${
                  formulaMode === 'fixed_per_treatment'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-gray-600'
                }`}
              >
                دستمزد ثابت هر درمان
              </button>
              <button
                onClick={() => setFormulaMode('custom_percentage')}
                className={`py-1.5 px-1.5 rounded-lg text-[10px] font-bold transition-all ${
                  formulaMode === 'custom_percentage'
                    ? 'bg-violet-600 text-white shadow-sm'
                    : 'text-gray-600'
                }`}
              >
                درصد اختصاصی ({customPercent.toLocaleString('fa-IR')}٪)
              </button>
            </div>
          </div>
        </div>

        {/* Custom Percentage Slider when in custom_percentage mode */}
        {formulaMode === 'custom_percentage' && (
          <div className="bg-violet-50/80 border border-violet-200 rounded-xl p-2.5 flex items-center justify-between gap-3 animate-slide-down">
            <div className="flex items-center gap-1.5 text-xs font-bold text-violet-900">
              <Percent size={14} className="text-violet-600" />
              <span>درصد اختصاصی {currentDocObj.name}:</span>
            </div>
            <div className="flex items-center gap-1.5">
              {[35, 40, 45, 50, 60, 70, 100].map(pct => (
                <button
                  key={pct}
                  onClick={() => setCustomPercent(pct)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-extrabold transition-all ${
                    customPercent === pct
                      ? 'bg-violet-700 text-white shadow-sm'
                      : 'bg-white text-violet-700 border border-violet-200'
                  }`}
                >
                  {pct.toLocaleString('fa-IR')}٪
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Doctor Monthly Payout Hero Card */}
      <div
        className="bento-tile"
        style={{
          background: 'linear-gradient(135deg, #6D28D9 0%, #4C1D95 60%, #311068 100%)',
          boxShadow: '0 10px 28px rgba(109, 40, 217, 0.3)',
        }}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold text-violet-200 mb-0.5">
              سهم قطعی قابل پرداخت به {currentDocObj.name}
            </p>
            <p className="text-2xl font-black text-white tracking-tight">
              {fmt(stats.calculatedDoctorShare)} <span className="text-xs font-normal text-violet-200">تومان</span>
            </p>
            <p className="text-[10px] text-violet-200/80 mt-1">
              فرمول فعال:{' '}
              {formulaMode === 'net_after_lab_half'
                ? '(کل کارکرد − هزینه لابراتوار) ÷ ۲'
                : formulaMode === 'fixed_per_treatment'
                ? 'مجموع دستمزد ثابت ثبت‌شده برای هر جراحی/درمان'
                : `${customPercent.toLocaleString('fa-IR')}٪ از خالص کارکرد پس از کسر لابراتوار`}
            </p>
          </div>
          <div className="w-11 h-11 rounded-2xl bg-white/15 flex items-center justify-center text-white">
            <Stethoscope size={22} />
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t border-white/15 grid grid-cols-4 gap-2 text-center">
          <div className="bg-white/10 rounded-xl p-1.5">
            <p className="text-[9px] text-violet-200">کل کارکرد ماه</p>
            <p className="text-[11px] font-bold text-white">{fmt(stats.grossWorkTotal)}</p>
          </div>
          <div className="bg-white/10 rounded-xl p-1.5">
            <p className="text-[9px] text-pink-200">کسر لابراتوار</p>
            <p className="text-[11px] font-bold text-pink-200">-{fmt(stats.labTotal)}</p>
          </div>
          <div className="bg-white/10 rounded-xl p-1.5">
            <p className="text-[9px] text-emerald-200">سهم خالص مطب</p>
            <p className="text-[11px] font-bold text-emerald-300">{fmt(stats.clinicShare)}</p>
          </div>
          <div className="bg-white/10 rounded-xl p-1.5">
            <p className="text-[9px] text-amber-200">تسویه‌شده</p>
            <p className="text-[11px] font-bold text-amber-300">{fmt(stats.paidOutThisMonth)}</p>
          </div>
        </div>

        {/* One-Click Monthly Doctor Payout Button */}
        <div className="mt-3">
          {stats.remainingToPayDoctor > 0 ? (
            <button
              onClick={handleSettleDoctorMonthlyShare}
              disabled={settling}
              data-testid="settle_doctor_monthly_share_button"
              className="w-full py-2.5 px-3 rounded-xl bg-white text-violet-950 hover:bg-violet-50 text-xs font-extrabold flex items-center justify-center gap-2 shadow-lg transition-all active:scale-95 disabled:opacity-50"
            >
              <CheckCheck size={16} className="text-emerald-600" />
              {settling
                ? 'در حال ثبت تسویه ماهانه پزشک...'
                : `تسویه و پرداخت سهم ماهانه پزشک (${fmt(stats.remainingToPayDoctor)} تومان)`}
            </button>
          ) : stats.calculatedDoctorShare > 0 ? (
            <div className="w-full py-2 px-3 rounded-xl bg-emerald-500/25 border border-emerald-400/40 text-emerald-100 text-xs font-bold flex items-center justify-center gap-1.5">
              <CheckCircle2 size={15} />
              <span>سهم کارکرد این ماه پزشک به‌طور کامل تسویه و پرداخت شده است</span>
            </div>
          ) : null}
        </div>
      </div>

      {settleMessage && (
        <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-1.5">
          <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
          <span>{settleMessage}</span>
        </div>
      )}

      {/* Detailed Treatment Work List */}
      {monthTreatments.length === 0 ? (
        <EmptyState icon={<UserCog size={28} />} title="درمانی در این ماه ثبت نشده" color="#8B5CF6" />
      ) : (
        <div className="space-y-2 stagger">
          {monthTreatments.sort((a, b) => b.created_at.localeCompare(a.created_at)).map(t => {
            const patient = getPatient(t.patient_id);
            const gross = Number(t.total_cost || 0);
            const lab = Number(t.lab_cost || 0);
            const docShare = calcTreatmentShare(t);
            const patientPaid = Number(t.paid_amount || 0);
            const patientDebt = Math.max(0, gross - patientPaid);

            return (
              <div key={t.id} className="glass-card p-3.5 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-extrabold text-gray-800">
                      {patient ? `${patient.first_name} ${patient.last_name}` : 'بیمار نامشخص'}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {t.diagnosis || t.treatment_plan || 'درمان دندانپزشکی'}
                      {t.tooth_numbers ? ` • دندان: ${t.tooth_numbers}` : ''}
                      {' • '}
                      {toJalaliStr(t.created_at.slice(0, 10))}
                    </p>
                  </div>
                  <div className="text-left">
                    <span className="text-[10px] text-gray-400 block">سهم پزشک از این کار</span>
                    <span className="text-sm font-black text-violet-700">{fmt(docShare)} ت</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5 text-[10px] bg-gray-50 p-2 rounded-xl border border-gray-100">
                  <div>
                    <span className="text-gray-400 block">کل تعرفه درمان</span>
                    <strong className="text-gray-800">{fmt(gross)} ت</strong>
                  </div>
                  <div>
                    <span className="text-gray-400 block">هزینه لابراتوار</span>
                    <strong className="text-pink-600">{fmt(lab)} ت</strong>
                  </div>
                  <div>
                    <span className="text-gray-400 block">خالص کارکرد</span>
                    <strong className="text-emerald-700">{fmt(Math.max(0, gross - lab))} ت</strong>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] pt-1">
                  <span className="text-violet-700 font-semibold">
                    ✓ محاسبه‌شده در کارکرد ماهانه پزشک
                  </span>
                  <span className={patientDebt > 0 ? 'text-amber-700 font-semibold' : 'text-emerald-600 font-semibold'}>
                    {patientDebt > 0
                      ? `مانده بدهی بیمار به مطب: ${fmt(patientDebt)} ت`
                      : 'بیمار با مطب تسویه کرده است'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════ */
function TransactionsTab({ transactions, patients, refresh }: {
  transactions: FinanceTransaction[];
  patients: Patient[];
  refresh: () => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<FinanceTransaction | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    let list = transactions;
    if (filter !== 'all') list = list.filter(t => t.type === filter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(t => t.description?.toLowerCase().includes(q) || t.category.toLowerCase().includes(q));
    return list.sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
  }, [transactions, search, filter]);

  const totals = useMemo(() => {
    const income = transactions.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
    const expense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
    return { income, expense, net: income - expense };
  }, [transactions]);

  const todayTxns = transactions.filter(t => t.transaction_date === today);
  const todayIncome = todayTxns.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const todayExpense = todayTxns.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);

  const getPatient = (id: string | null) => patients.find(p => p.id === id);

  const handleSave = async (data: Partial<FinanceTransaction>) => {
    setSaving(true);
    if (editing) await supabase.from('finance_transactions').update(data).eq('id', editing.id);
    else await supabase.from('finance_transactions').insert(data);
    setSaving(false); setSheetOpen(false); setEditing(null); refresh();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await supabase.from('finance_transactions').delete().eq('id', deleteId);
    refresh();
  };

  const handleExport = () => {
    exportToCsv(
      `گزارش_تراکنش‌های_مینادنتال_${today}`,
      ['شناسه', 'نوع', 'مبلغ (تومان)', 'دسته‌بندی', 'بیمار', 'روش پرداخت', 'تاریخ', 'توضیحات'],
      filtered.map(t => {
        const patient = getPatient(t.patient_id);
        const cat = CATEGORIES.find(c => c.value === t.category)?.label || t.category || '-';
        const method = PAYMENT_METHODS.find(m => m.value === t.payment_method)?.label || t.payment_method || '-';
        return [
          t.id.slice(0, 8),
          t.type === 'income' ? 'درآمد' : 'هزینه',
          String(t.amount),
          cat,
          patient ? `${patient.first_name} ${patient.last_name}` : '-',
          method,
          toJalaliStr(t.transaction_date),
          t.description || ''
        ];
      })
    );
  };

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <div className="glass-card p-3">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-green-600" />
            <span className="text-[11px] font-semibold text-gray-500">درآمد کل خزانه</span>
          </div>
          <p className="text-base font-black text-green-600">{fmt(totals.income)}</p>
        </div>
        <div className="glass-card p-3">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown size={14} className="text-red-500" />
            <span className="text-[11px] font-semibold text-gray-500">هزینه و تسویه‌ها</span>
          </div>
          <p className="text-base font-black text-red-500">{fmt(totals.expense)}</p>
        </div>
      </div>

      <div className="glass-card p-3" style={{ borderTop: `3px solid ${totals.net >= 0 ? '#22C55E' : '#EF4444'}` }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-gray-500">تراز خالص خزانه مطب</p>
            <p className={`text-xl font-black ${totals.net >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmt(totals.net)}</p>
          </div>
          <div className="text-left">
            <p className="text-[10px] text-gray-400">امروز</p>
            <p className="text-[11px] font-bold text-green-500">+{fmt(todayIncome)}</p>
            <p className="text-[11px] font-bold text-red-500">-{fmt(todayExpense)}</p>
          </div>
        </div>
      </div>

      <div className="glass-card p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-gray-700">تراکنش‌های خزانه</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              title="خروجی اکسل (CSV)"
              className="w-8 h-8 rounded-xl bg-blue-600/90 hover:bg-blue-600 text-white flex items-center justify-center shadow haptic"
            >
              <FileSpreadsheet size={15} />
            </button>
            <button onClick={() => { setEditing(null); setSheetOpen(true); }} className="w-8 h-8 rounded-xl bg-green-500 text-white flex items-center justify-center shadow haptic">
              <Plus size={18} />
            </button>
          </div>
        </div>
        <div className="relative mb-2">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input placeholder="جستجو در تراکنش‌ها..." value={search} onChange={e => setSearch(e.target.value)} className="pr-9 text-sm" />
        </div>
        <div className="flex gap-1.5">
          {[
            { v: 'all', l: 'همه' },
            { v: 'income', l: 'ورودی / درآمد' },
            { v: 'expense', l: 'خروجی / هزینه' },
          ].map(f => (
            <button key={f.v} onClick={() => setFilter(f.v)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-semibold haptic ${filter === f.v ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
              {f.l}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={<Wallet size={28} />} title="تراکنشی یافت نشد" color="#22C55E" />
      ) : (
        <div className="space-y-2 stagger">
          {filtered.slice(0, 30).map(t => {
            const patient = getPatient(t.patient_id);
            const isIncome = t.type === 'income';
            const catLabel = CATEGORIES.find(c => c.value === t.category)?.label ?? t.category;
            return (
              <div key={t.id} className="glass-card p-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: isIncome ? '#DCFCE7' : '#FEE2E2' }}>
                    {isIncome ? <ArrowUpCircle size={18} className="text-green-600" /> : <ArrowDownCircle size={18} className="text-red-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-800 truncate">{t.description ?? catLabel}</p>
                    <div className="flex items-center gap-2 text-[10px] text-gray-400">
                      <span>{toJalaliStr(t.transaction_date)}</span>
                      <Badge color="#6B7280" bg="#F3F4F6">{catLabel}</Badge>
                      {patient && <span>{patient.first_name} {patient.last_name}</span>}
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    <p className={`text-sm font-black ${isIncome ? 'text-green-600' : 'text-red-500'}`}>
                      {isIncome ? '+' : '-'}{fmt(Number(t.amount))}
                    </p>
                    <button onClick={() => { setEditing(t); setSheetOpen(true); }} className="text-[9px] text-gray-400 hover:text-gray-600">ویرایش</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Sheet open={sheetOpen} onClose={() => { setSheetOpen(false); setEditing(null); }}
        title={editing ? 'ویرایش تراکنش' : 'تراکنش جدید'} icon={<Wallet size={20} />} color="#22C55E">
        <FinanceForm transaction={editing} patients={patients} onSave={handleSave} saving={saving} />
      </Sheet>
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete}
        title="حذف تراکنش" message="آیا از حذف این تراکنش اطمینان دارید؟" confirmLabel="حذف" />
    </>
  );
}

/* ═══════════════════════════════════════════ */
function InstallmentsTab({ installments, patients, refresh }: {
  installments: Installment[];
  patients: Patient[];
  refresh: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ patient_id: '', total_amount: '', monthly_amount: '', total_months: '', start_date: today, notes: '' });

  const getPatient = (id: string | null) => patients.find(p => p.id === id);

  const stats = useMemo(() => {
    const totalDebt = installments.filter(i => i.status === 'active').reduce((s, i) => s + Number(i.total_amount) - Number(i.paid_amount), 0);
    const overdueCount = installments.filter(i => i.status === 'active' && i.next_due_date && i.next_due_date < today).length;
    return { totalDebt, overdueCount, active: installments.filter(i => i.status === 'active').length };
  }, [installments]);

  const save = async () => {
    if (!form.patient_id || !form.total_amount) return;
    setSaving(true);
    const totalAmt = Number(form.total_amount);
    const monthly = Number(form.monthly_amount) || Math.round(totalAmt / Math.max(Number(form.total_months) || 1, 1));
    const months = Number(form.total_months) || Math.ceil(totalAmt / Math.max(monthly, 1));
    const startDate = form.start_date;
    const nextDue = new Date(startDate);
    nextDue.setMonth(nextDue.getMonth() + 1);
    const nextDueStr = nextDue.toISOString().slice(0, 10);

    await supabase.from('installments').insert({
      patient_id: form.patient_id, total_amount: totalAmt, paid_amount: 0,
      monthly_amount: monthly, total_months: months, paid_months: 0,
      start_date: startDate, next_due_date: nextDueStr,
      status: 'active', notes: form.notes || null,
    });

    // Automatically create a reminder 3 days before the first installment due date
    const patient = getPatient(form.patient_id);
    if (patient) {
      await supabase.from('reminders').insert({
        patient_id: form.patient_id,
        title: `یادآوری قسط اول: ${patient.first_name} ${patient.last_name} (${fmt(monthly)} تومان)`,
        description: `سررسید قسط اول از ${months} قسط در تاریخ ${toJalaliStr(nextDueStr)}`,
        reminder_date: addDaysToIso(nextDueStr, -3),
        reminder_time: '10:00',
        category: 'payment',
        priority: 'high',
        status: 'pending',
      });
    }

    setSaving(false); setShowForm(false);
    setForm({ patient_id: '', total_amount: '', monthly_amount: '', total_months: '', start_date: today, notes: '' });
    refresh();
  };

  const recordPayment = async (inst: Installment) => {
    const newPaid = Number(inst.paid_amount) + Number(inst.monthly_amount);
    const newMonths = inst.paid_months + 1;
    const nextDue = new Date(inst.next_due_date || today);
    nextDue.setMonth(nextDue.getMonth() + 1);
    const isComplete = newPaid >= Number(inst.total_amount);
    await supabase.from('installments').update({
      paid_amount: newPaid, paid_months: newMonths,
      next_due_date: isComplete ? null : nextDue.toISOString().slice(0, 10),
      status: isComplete ? 'completed' : 'active',
    }).eq('id', inst.id);

    // Also record in clinic treasury
    const patient = getPatient(inst.patient_id);
    await supabase.from('finance_transactions').insert({
      type: 'income',
      category: 'patient_payment',
      amount: Number(inst.monthly_amount),
      transaction_date: today,
      patient_id: inst.patient_id,
      payment_method: 'card',
      description: `دریافت قسط شماره ${newMonths} - ${patient ? `${patient.first_name} ${patient.last_name}` : ''}`,
    });

    refresh();
  };

  const del = async (id: string) => { await supabase.from('installments').delete().eq('id', id); refresh(); };

  return (
    <>
      <div className="glass-card p-3" style={{ borderTop: '3px solid #22C55E' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-gray-500">باقی‌مانده اقساط فعال نزد مطب</p>
            <p className="text-xl font-black text-green-600">{fmt(stats.totalDebt)} ت</p>
          </div>
          <div className="text-left">
            <p className="text-[10px] text-gray-400">اقساط فعال: <b className="text-gray-700">{stats.active}</b></p>
            {stats.overdueCount > 0 && <p className="text-[10px] text-red-500 flex items-center gap-1 justify-end"><AlertTriangle size={10} /> {stats.overdueCount} سررسید گذشته</p>}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-gray-700">طرح‌های اقساطی بیماران</span>
        <button onClick={() => setShowForm(true)} className="px-3 h-8 rounded-xl bg-green-500 text-white text-xs font-bold flex items-center gap-1 shadow haptic">
          <Plus size={16} /> اقساط جدید
        </button>
      </div>

      <Sheet
        open={showForm}
        onClose={() => setShowForm(false)}
        title="ثبت طرح اقساطی جدید (همراه با یادآوری خودکار)"
        icon={<CreditCard size={20} />}
        color="#22C55E"
      >
        <div className="space-y-3.5">
          <Field label="بیمار">
            <Select value={form.patient_id} onChange={e => setForm({ ...form, patient_id: e.target.value })}
              options={[{ value: '', label: 'انتخاب...' }, ...patients.map(p => ({ value: p.id, label: `${p.first_name} ${p.last_name}` }))]} />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="مبلغ کل تقسیط"><Input type="number" value={form.total_amount} onChange={e => setForm({ ...form, total_amount: e.target.value })} placeholder="0" /></Field>
            <Field label="مبلغ هر قسط"><Input type="number" value={form.monthly_amount} onChange={e => setForm({ ...form, monthly_amount: e.target.value })} placeholder="محاسبه خودکار" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="تعداد اقساط (ماه)"><Input type="number" value={form.total_months} onChange={e => setForm({ ...form, total_months: e.target.value })} placeholder="مثلاً ۶" /></Field>
            <Field label="تاریخ شروع"><JalaliDatePicker value={form.start_date} onChange={v => setForm({ ...form, start_date: v })} /></Field>
          </div>
          <Field label="یادداشت"><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="یادداشت..." /></Field>
          <Button color="#22C55E" disabled={saving || !form.patient_id || !form.total_amount} className="w-full" onClick={save}>
            {saving ? 'در حال ذخیره...' : 'ثبت طرح اقساطی و فعال‌سازی یادآوری'}
          </Button>
        </div>
      </Sheet>

      {installments.length === 0 ? (
        <EmptyState icon={<CreditCard size={28} />} title="طرح اقساطی ثبت نشده" color="#22C55E" />
      ) : (
        <div className="space-y-2 stagger">
          {installments.map(inst => {
            const patient = getPatient(inst.patient_id);
            const status = INSTALLMENT_STATUS[inst.status] ?? INSTALLMENT_STATUS.active;
            const balance = Number(inst.total_amount) - Number(inst.paid_amount);
            const progress = Math.min(100, (Number(inst.paid_amount) / Math.max(Number(inst.total_amount), 1)) * 100);
            const isOverdue = inst.status === 'active' && inst.next_due_date && inst.next_due_date < today;
            return (
              <div key={inst.id} className="glass-card p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-gray-800">{patient ? `${patient.first_name} ${patient.last_name}` : 'نامشخص'}</p>
                  <div className="flex items-center gap-1.5">
                    <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                    <button onClick={() => setDeleteId(inst.id)} className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center text-gray-400 haptic">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-400">وصول‌شده: {fmt(Number(inst.paid_amount))} / {fmt(Number(inst.total_amount))}</span>
                  <span className="font-bold text-green-600">{Math.round(progress).toLocaleString('fa-IR')}٪</span>
                </div>
                <div className="prog-track h-2 mb-2">
                  <div className="prog-fill" style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#22C55E,#4ADE80)' }} />
                </div>
                <div className="flex items-center justify-between text-[10px] text-gray-400 mb-2">
                  <span>{inst.paid_months.toLocaleString('fa-IR')} / {inst.total_months.toLocaleString('fa-IR')} قسط</span>
                  <span>ماهانه: {fmt(Number(inst.monthly_amount))} ت</span>
                  {inst.next_due_date && (
                    <span className={isOverdue ? 'text-red-500 font-bold' : ''}>
                      سررسید بعدی: {toJalaliStr(inst.next_due_date)}
                    </span>
                  )}
                </div>
                {balance > 0 && inst.status === 'active' && (
                  <button onClick={() => recordPayment(inst)}
                    className="w-full py-2 rounded-xl bg-green-500 text-white text-xs font-bold haptic flex items-center justify-center gap-1">
                    <CheckCircle2 size={14} /> ثبت وصول قسط و واریز به خزانه ({fmt(Number(inst.monthly_amount))} ت)
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && del(deleteId)}
        title="حذف طرح اقساطی" message="آیا مطمئن هستید؟" confirmLabel="حذف" />
    </>
  );
}

/* ═══════════════════════════════════════════ */
function ChecksTab({ checks, patients, refresh }: {
  checks: Check[];
  patients: Patient[];
  refresh: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ patient_id: '', check_number: '', sayad_id: '', bank_name: '', amount: '', issue_date: today, due_date: '', notes: '' });

  const getPatient = (id: string | null) => patients.find(p => p.id === id);

  const stats = useMemo(() => {
    const pending = checks.filter(c => c.status === 'pending');
    const totalPending = pending.reduce((s, c) => s + Number(c.amount), 0);
    const overdue = pending.filter(c => c.due_date < today).length;
    return { totalPending, overdue, count: pending.length };
  }, [checks]);

  const handleExportChecks = () => {
    exportToCsv(
      `گزارش_چک‌های_صیادی_مینادنتال_${today}`,
      ['نام بیمار', 'شماره چک', 'شناسه صیادی', 'بانک', 'مبلغ (تومان)', 'تاریخ صدور', 'تاریخ سررسید', 'وضعیت', 'یادداشت'],
      checks.map(c => {
        const p = getPatient(c.patient_id);
        const st = CHECK_STATUS[c.status]?.label || c.status;
        const sayadMatch = c.notes?.match(/صیاد:\s*([0-9]{16})/);
        return [
          p ? `${p.first_name} ${p.last_name}` : '-',
          c.check_number || '-',
          sayadMatch ? sayadMatch[1] : '-',
          c.bank_name || '-',
          String(c.amount),
          toJalaliStr(c.issue_date),
          toJalaliStr(c.due_date),
          st,
          c.notes || ''
        ];
      })
    );
  };

  const save = async () => {
    if (!form.patient_id || !form.amount || !form.due_date) return;
    setSaving(true);
    let finalNotes = form.notes || '';
    if (form.sayad_id.trim()) {
      finalNotes = `[صیاد: ${form.sayad_id.trim()}] ${finalNotes}`.trim();
    }
    await supabase.from('checks').insert({
      patient_id: form.patient_id, check_number: form.check_number || null,
      bank_name: form.bank_name || null, amount: Number(form.amount),
      issue_date: form.issue_date, due_date: form.due_date, status: 'pending',
      notes: finalNotes || null,
    });

    // Automatically insert a reminder 3 days before the check due date
    const patient = getPatient(form.patient_id);
    if (patient) {
      await supabase.from('reminders').insert({
        patient_id: form.patient_id,
        title: `یادآوری سررسید چک صیادی: ${patient.first_name} ${patient.last_name} (${fmt(Number(form.amount))} تومان)`,
        description: `چک بانک ${form.bank_name || '-'} به شماره ${form.check_number || '-'} با سررسید ${toJalaliStr(form.due_date)}`,
        reminder_date: addDaysToIso(form.due_date, -3),
        reminder_time: '09:30',
        category: 'payment',
        priority: 'urgent',
        status: 'pending',
      });
    }

    setSaving(false); setShowForm(false);
    setForm({ patient_id: '', check_number: '', sayad_id: '', bank_name: '', amount: '', issue_date: today, due_date: '', notes: '' });
    refresh();
  };

  const setStatus = async (ch: Check, status: string) => {
    await supabase.from('checks').update({ status }).eq('id', ch.id);
    if (status === 'cleared') {
      const patient = getPatient(ch.patient_id);
      await supabase.from('finance_transactions').insert({
        type: 'income',
        category: 'patient_payment',
        amount: Number(ch.amount),
        transaction_date: today,
        patient_id: ch.patient_id,
        payment_method: 'transfer',
        description: `وصول چک صیادی #${ch.check_number || '-'} - ${patient ? `${patient.first_name} ${patient.last_name}` : ''}`,
      });
    }
    refresh();
  };
  const del = async (id: string) => { await supabase.from('checks').delete().eq('id', id); refresh(); };

  return (
    <>
      <div className="glass-card p-3" style={{ borderTop: '3px solid #F59E0B' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-gray-500">چک‌های در جریان نزد مطب</p>
            <p className="text-xl font-black text-amber-600">{fmt(stats.totalPending)} ت</p>
          </div>
          <div className="text-left">
            <p className="text-[10px] text-gray-400">تعداد: <b className="text-gray-700">{stats.count}</b></p>
            {stats.overdue > 0 && <p className="text-[10px] text-red-500 flex items-center gap-1 justify-end"><AlertTriangle size={10} /> {stats.overdue} سررسید گذشته</p>}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-gray-700">چک‌های صیادی دریافتی</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportChecks}
            title="خروجی اکسل چک‌ها"
            className="w-8 h-8 rounded-xl bg-blue-600/90 hover:bg-blue-600 text-white flex items-center justify-center shadow haptic"
          >
            <FileSpreadsheet size={15} />
          </button>
          <button onClick={() => setShowForm(true)} className="px-3 h-8 rounded-xl bg-amber-500 text-white text-xs font-bold flex items-center gap-1 shadow haptic">
            <Plus size={16} /> چک صیادی جدید
          </button>
        </div>
      </div>

      <Sheet
        open={showForm}
        onClose={() => setShowForm(false)}
        title="ثبت چک صیادی جدید (با یادآوری خودکار سررسید)"
        icon={<FileCheck size={20} />}
        color="#F59E0B"
      >
        <div className="space-y-3.5">
          <Field label="بیمار">
            <Select value={form.patient_id} onChange={e => setForm({ ...form, patient_id: e.target.value })}
              options={[{ value: '', label: 'انتخاب...' }, ...patients.map(p => ({ value: p.id, label: `${p.first_name} ${p.last_name}` }))]} />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="شماره چک"><Input value={form.check_number} onChange={e => setForm({ ...form, check_number: e.target.value })} placeholder="سریال چک" /></Field>
            <Field label="شناسه صیادی (۱۶ رقم)">
              <Input
                value={form.sayad_id}
                maxLength={16}
                onChange={e => setForm({ ...form, sayad_id: e.target.value.replace(/\D/g, '') })}
                placeholder="۱۶ رقم صیاد"
                className="font-mono text-center tracking-wider text-xs"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="نام بانک"><Input value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} placeholder="مثلاً ملی، ملت..." /></Field>
            <Field label="مبلغ (تومان)"><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="تاریخ صدور"><JalaliDatePicker value={form.issue_date} onChange={v => setForm({ ...form, issue_date: v })} /></Field>
            <Field label="تاریخ سررسید"><JalaliDatePicker value={form.due_date} onChange={v => setForm({ ...form, due_date: v })} /></Field>
          </div>
          <Field label="یادداشت"><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="توضیحات و بابت..." /></Field>
          <Button color="#F59E0B" disabled={saving || !form.patient_id || !form.amount || !form.due_date} className="w-full" onClick={save}>
            {saving ? 'در حال ذخیره...' : 'ثبت چک صیادی و ایجاد یادآوری'}
          </Button>
        </div>
      </Sheet>

      {checks.length === 0 ? (
        <EmptyState icon={<FileCheck size={28} />} title="چکی ثبت نشده" color="#F59E0B" />
      ) : (
        <div className="space-y-2 stagger">
          {checks.sort((a, b) => a.due_date.localeCompare(b.due_date)).map(ch => {
            const patient = getPatient(ch.patient_id);
            const status = CHECK_STATUS[ch.status] ?? CHECK_STATUS.pending;
            const isOverdue = ch.status === 'pending' && ch.due_date < today;
            const sayadMatch = ch.notes?.match(/صیاد:\s*([0-9]{16})/);
            return (
              <div key={ch.id} className="glass-card p-3" style={{ borderRight: isOverdue ? '3px solid #EF4444' : undefined }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
                      <FileCheck size={16} className="text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-800">{patient ? `${patient.first_name} ${patient.last_name}` : 'نامشخص'}</p>
                      <p className="text-[10px] text-gray-400">
                        {ch.check_number && `چک #${ch.check_number} • `}
                        {ch.bank_name && `${ch.bank_name} • `}
                        سررسید: {toJalaliStr(ch.due_date)}
                      </p>
                      {sayadMatch && (
                        <span className="inline-block mt-0.5 text-[9px] font-mono font-bold bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200">
                          صیاد: {sayadMatch[1]}
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-base font-black text-amber-600">{fmt(Number(ch.amount))} ت</span>
                  {ch.status === 'pending' && (
                    <div className="flex gap-1.5">
                      <button onClick={() => setStatus(ch, 'cleared')} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-50 text-green-600 text-[11px] font-bold haptic">
                        <CheckCircle2 size={13} /> پاس شد (واریز به خزانه)
                      </button>
                      <button onClick={() => setStatus(ch, 'bounced')} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 text-red-500 text-[11px] font-bold haptic">
                        <XCircle size={13} /> برگشت
                      </button>
                      <button onClick={() => setDeleteId(ch.id)} className="px-2 py-1.5 rounded-lg bg-gray-50 text-gray-400 haptic">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                  {ch.status !== 'pending' && (
                    <button onClick={() => setDeleteId(ch.id)} className="px-2 py-1.5 rounded-lg bg-gray-50 text-gray-400 haptic">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && del(deleteId)}
        title="حذف چک" message="آیا مطمئن هستید؟" confirmLabel="حذف" />
    </>
  );
}

/* ═══════════════════════════════════════════ */
function SaftehTab({ safteh, patients, refresh }: {
  safteh: Safteh[];
  patients: Patient[];
  refresh: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({
    patient_id: '', safteh_number: '', amount: '',
    issue_date: today, due_date: '',
    guarantor_name: '', guarantor_national_id: '', notes: '',
  });

  const getPatient = (id: string | null) => patients.find(p => p.id === id);

  const stats = useMemo(() => {
    const pending = safteh.filter(s => s.status === 'pending');
    const totalPending = pending.reduce((s, sf) => s + Number(sf.amount), 0);
    const overdue = pending.filter(s => s.due_date < today).length;
    return { totalPending, overdue, count: pending.length };
  }, [safteh]);

  const save = async () => {
    if (!form.patient_id || !form.amount || !form.due_date) return;
    setSaving(true);
    await supabase.from('safteh').insert({
      patient_id: form.patient_id, safteh_number: form.safteh_number || null,
      amount: Number(form.amount), issue_date: form.issue_date, due_date: form.due_date,
      guarantor_name: form.guarantor_name || null,
      guarantor_national_id: form.guarantor_national_id || null,
      status: 'pending', notes: form.notes || null,
    });
    setSaving(false); setShowForm(false);
    setForm({ patient_id: '', safteh_number: '', amount: '', issue_date: today, due_date: '', guarantor_name: '', guarantor_national_id: '', notes: '' });
    refresh();
  };

  const setStatus = async (id: string, status: string) => {
    await supabase.from('safteh').update({ status }).eq('id', id);
    refresh();
  };
  const del = async (id: string) => { await supabase.from('safteh').delete().eq('id', id); refresh(); };

  return (
    <>
      <div className="glass-card p-3" style={{ borderTop: '3px solid #6366F1' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] text-gray-500">سفته‌های ضمانت در جریان</p>
            <p className="text-xl font-black text-indigo-600">{fmt(stats.totalPending)} ت</p>
          </div>
          <div className="text-left">
            <p className="text-[10px] text-gray-400">تعداد: <b className="text-gray-700">{stats.count}</b></p>
            {stats.overdue > 0 && <p className="text-[10px] text-red-500 flex items-center gap-1 justify-end"><AlertTriangle size={10} /> {stats.overdue} سررسید گذشته</p>}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-gray-700">سفته‌های دریافتی</span>
        <button onClick={() => setShowForm(true)} className="px-3 h-8 rounded-xl bg-indigo-500 text-white text-xs font-bold flex items-center gap-1 shadow haptic">
          <Plus size={16} /> سفته جدید
        </button>
      </div>

      <Sheet
        open={showForm}
        onClose={() => setShowForm(false)}
        title="ثبت سفته ضمانت جدید"
        icon={<ScrollText size={20} />}
        color="#6366F1"
      >
        <div className="space-y-3.5">
          <Field label="بیمار">
            <Select value={form.patient_id} onChange={e => setForm({ ...form, patient_id: e.target.value })}
              options={[{ value: '', label: 'انتخاب...' }, ...patients.map(p => ({ value: p.id, label: `${p.first_name} ${p.last_name}` }))]} />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="شماره سفته"><Input value={form.safteh_number} onChange={e => setForm({ ...form, safteh_number: e.target.value })} placeholder="شماره سفته" /></Field>
            <Field label="مبلغ (تومان)"><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="تاریخ صدور"><JalaliDatePicker value={form.issue_date} onChange={v => setForm({ ...form, issue_date: v })} /></Field>
            <Field label="تاریخ سررسید"><JalaliDatePicker value={form.due_date} onChange={v => setForm({ ...form, due_date: v })} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="نام ضامن"><Input value={form.guarantor_name} onChange={e => setForm({ ...form, guarantor_name: e.target.value })} placeholder="نام و نام خانوادگی ضامن" /></Field>
            <Field label="کد ملی ضامن"><Input value={form.guarantor_national_id} onChange={e => setForm({ ...form, guarantor_national_id: e.target.value })} placeholder="کد ملی" /></Field>
          </div>
          <Field label="یادداشت"><Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="یادداشت..." /></Field>
          <Button color="#6366F1" disabled={saving || !form.patient_id || !form.amount || !form.due_date} className="w-full" onClick={save}>
            {saving ? 'در حال ذخیره...' : 'ثبت سفته'}
          </Button>
        </div>
      </Sheet>

      {safteh.length === 0 ? (
        <EmptyState icon={<ScrollText size={28} />} title="سفته‌ای ثبت نشده" color="#6366F1" />
      ) : (
        <div className="space-y-2 stagger">
          {safteh.sort((a, b) => a.due_date.localeCompare(b.due_date)).map(sf => {
            const patient = getPatient(sf.patient_id);
            const status = CHECK_STATUS[sf.status] ?? CHECK_STATUS.pending;
            const isOverdue = sf.status === 'pending' && sf.due_date < today;
            return (
              <div key={sf.id} className="glass-card p-3" style={{ borderRight: isOverdue ? '3px solid #EF4444' : undefined }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
                      <ScrollText size={16} className="text-indigo-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-800">{patient ? `${patient.first_name} ${patient.last_name}` : 'نامشخص'}</p>
                      <p className="text-[10px] text-gray-400">
                        {sf.safteh_number && `سفته #${sf.safteh_number} • `}
                        سررسید: {toJalaliStr(sf.due_date)}
                      </p>
                    </div>
                  </div>
                  <Badge color={status.color} bg={status.bg}>{status.label}</Badge>
                </div>

                {sf.guarantor_name && (
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mb-2">
                    <User size={11} /> ضامن: {sf.guarantor_name}
                    {sf.guarantor_national_id && ` (${sf.guarantor_national_id})`}
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <span className="text-base font-black text-indigo-600">{fmt(Number(sf.amount))} ت</span>
                  {sf.status === 'pending' && (
                    <div className="flex gap-1.5">
                      <button onClick={() => setStatus(sf.id, 'cleared')} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-50 text-green-600 text-[11px] font-bold haptic">
                        <CheckCircle2 size={13} /> تسویه
                      </button>
                      <button onClick={() => setStatus(sf.id, 'bounced')} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 text-red-500 text-[11px] font-bold haptic">
                        <XCircle size={13} /> برگشت
                      </button>
                      <button onClick={() => setDeleteId(sf.id)} className="px-2 py-1.5 rounded-lg bg-gray-50 text-gray-400 haptic">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                  {sf.status !== 'pending' && (
                    <button onClick={() => setDeleteId(sf.id)} className="px-2 py-1.5 rounded-lg bg-gray-50 text-gray-400 haptic">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteId && del(deleteId)}
        title="حذف سفته" message="آیا مطمئن هستید؟" confirmLabel="حذف" />
    </>
  );
}

/* ═══════════════════════════════════════════ */
function FinanceForm({ transaction, patients, onSave, saving }: {
  transaction: FinanceTransaction | null;
  patients: Patient[];
  onSave: (d: Partial<FinanceTransaction>) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    type: transaction?.type ?? 'income',
    category: transaction?.category ?? 'patient_payment',
    amount: transaction?.amount ?? 0,
    transaction_date: transaction?.transaction_date ?? today,
    description: transaction?.description ?? '',
    patient_id: transaction?.patient_id ?? '',
    payment_method: transaction?.payment_method ?? 'cash',
    reference: transaction?.reference ?? '',
  });

  const submit = () => {
    if (!form.amount) return;
    onSave({
      ...form,
      amount: Number(form.amount),
      patient_id: form.patient_id || null,
    });
  };

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-2 gap-3">
        <Field label="نوع">
          <Select value={form.type} onChange={e => setForm({ ...form, type: e.target.value as 'income' | 'expense' | 'transfer' })} options={TXN_TYPES} />
        </Field>
        <Field label="دسته‌بندی">
          <Select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} options={CATEGORIES} />
        </Field>
      </div>
      <Field label="مبلغ (تومان)"><Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: Number(e.target.value) })} placeholder="مبلغ" /></Field>
      <Field label="تاریخ"><JalaliDatePicker value={form.transaction_date} onChange={v => setForm({ ...form, transaction_date: v })} /></Field>
      <Field label="شرح"><Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} placeholder="شرح تراکنش..." /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="روش پرداخت">
          <Select value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })} options={PAYMENT_METHODS} />
        </Field>
        <Field label="بیمار (اختیاری)">
          <Select
            value={form.patient_id}
            onChange={e => setForm({ ...form, patient_id: e.target.value })}
            options={[
              { value: '', label: 'بدون بیمار' },
              ...patients.map(p => ({ value: p.id, label: `${p.first_name} ${p.last_name}` })),
            ]}
          />
        </Field>
      </div>
      <Field label="مرجع"><Input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="شماره فاکتور، شماره تراکنش..." /></Field>
      <Button onClick={submit} color="#22C55E" disabled={saving} className="w-full">
        {saving ? 'در حال ذخیره...' : 'ذخیره'}
      </Button>
    </div>
  );
}
