import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileCheck,
  Phone,
  Stethoscope,
} from 'lucide-react';
import {
  supabase,
  type Check,
  type Installment,
  type Patient,
  type Payment,
  type Reminder,
  type Safteh,
  type Treatment,
} from '@/lib/supabase';
import { Badge, EmptyState } from '@/components/ui/Form';
import { toJalaliStr, todayGregorian } from '@/lib/jalali';
import { HapticEngine } from '@/lib/hapticsAudio';
import {
  buildStableFinanceReminderPayload,
  computeClinicReceivablesSummary,
  computePatientFinancialLedger,
  detectFinancialAnomalies,
  prioritizeAccountsReceivable,
} from './financialLedgerEngine';
import {
  computeDeterministicTreatmentAllocations,
  postPatientPaymentCommand,
} from './financialCommandService';
import { parseExactTomanAmount } from './monetaryPrecision';
import { fmtToman } from './financeConstants';
import { FinanceDebtorsOverview } from './FinanceDebtorsSummaryCard';
import { FinanceQuickPaySheet } from './FinanceQuickPaySheet';

export function FinanceDebtorsTab({
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
  const today = todayGregorian();
  const [filterMode, setFilterMode] = useState<'all_debtors' | 'overdue' | 'uncovered' | 'checks_due' | 'installments_due'>('all_debtors');
  const [expandedPatientId, setExpandedPatientId] = useState<string | null>(null);
  const [leadDaysBefore, setLeadDaysBefore] = useState<number>(3);
  const [syncingReminders, setSyncingReminders] = useState(false);
  const [syncResultMsg, setSyncResultMsg] = useState<string | null>(null);
  const [quickPayPatient, setQuickPayPatient] = useState<Patient | null>(null);
  const [quickPayAmount, setQuickPayAmount] = useState('');
  const [quickPayMethod, setQuickPayMethod] = useState<'cash' | 'card' | 'transfer' | 'insurance'>('card');
  const [quickPayError, setQuickPayError] = useState<string | null>(null);
  const [quickPayStatusMsg, setQuickPayStatusMsg] = useState<string | null>(null);
  const [savingQuickPay, setSavingQuickPay] = useState(false);
  const [showAuditDrawer, setShowAuditDrawer] = useState(false);

  const patientLedgers = useMemo(() => {
    return patients
      .map((p) =>
        computePatientFinancialLedger({
          patient: p,
          treatments,
          payments,
          installments,
          checks,
          safteh,
          referenceDateIso: today,
          leadDaysBefore,
        })
      )
      .filter((item) => item.hasAnyFinancialObligation)
      .sort((a, b) => {
        if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
        if (a.isUpcoming !== b.isUpcoming) return a.isUpcoming ? -1 : 1;
        return b.totalRemainingDebt - a.totalRemainingDebt;
      });
  }, [patients, treatments, payments, installments, checks, safteh, today, leadDaysBefore]);

  const summary = useMemo(() => computeClinicReceivablesSummary(patientLedgers, today), [patientLedgers, today]);
  const arPriorities = useMemo(() => prioritizeAccountsReceivable(patientLedgers).slice(0, 5), [patientLedgers]);
  const anomalies = useMemo(
    () => detectFinancialAnomalies({ payments, finance: [], checks, treatments, referenceDateIso: today }),
    [payments, checks, treatments, today]
  );

  const filteredLedgers = useMemo(() => {
    let list = patientLedgers;
    if (filterMode === 'overdue') list = list.filter((l) => l.isOverdue || l.isUpcoming);
    else if (filterMode === 'uncovered') list = list.filter((l) => l.uncoveredDebt > 0);
    else if (filterMode === 'checks_due') list = list.filter((l) => l.collectibleChecks.length > 0 || l.guaranteeChecks.length > 0);
    else if (filterMode === 'installments_due') list = list.filter((l) => l.installments.length > 0);

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (l) =>
          `${l.patient.first_name} ${l.patient.last_name}`.toLowerCase().includes(q) ||
          l.patient.phone?.includes(q) ||
          l.treatments.some((t) => t.tooth_numbers?.includes(q) || t.diagnosis?.toLowerCase().includes(q))
      );
    }
    return list;
  }, [patientLedgers, filterMode, searchQuery]);

  const allocationPreview = useMemo(() => {
    if (!quickPayPatient) return null;
    const parsed = parseExactTomanAmount(quickPayAmount, { allowZero: false });
    if (!parsed.ok) return null;
    const pTreatments = treatments.filter((t) => t.patient_id === quickPayPatient.id);
    return computeDeterministicTreatmentAllocations(parsed.amount, pTreatments);
  }, [quickPayPatient, quickPayAmount, treatments]);

  const handleGenerateSmartReminders = async () => {
    setSyncingReminders(true);
    setSyncResultMsg(null);
    let createdCount = 0;

    try {
      for (const ledger of patientLedgers) {
        for (const ch of ledger.collectibleChecks) {
          const payload = buildStableFinanceReminderPayload({
            kind: 'check_due',
            entityId: ch.id,
            patient: ledger.patient,
            targetDateIso: ch.due_date,
            leadDaysBefore,
            amountToman: ch.amount,
            todayIso: today,
          });
          const exists = reminders.some(
            (r) => r.patient_id === payload.patientId && (r.title.includes(payload.sourceKey) || r.title === payload.lockScreenSafeTitle) && r.status === 'pending'
          );
          if (!exists) {
            await supabase.from('reminders').insert({
              patient_id: payload.patientId,
              title: payload.lockScreenSafeTitle,
              description: payload.authenticatedDetail,
              reminder_date: payload.reminderDate,
              reminder_time: payload.reminderTime,
              category: payload.category,
              priority: payload.priority,
              status: 'pending',
            });
            createdCount++;
          }
        }

        for (const ins of ledger.installments) {
          if (!ins.next_due_date) continue;
          const payload = buildStableFinanceReminderPayload({
            kind: 'installment_due',
            entityId: ins.id,
            patient: ledger.patient,
            targetDateIso: ins.next_due_date,
            leadDaysBefore,
            amountToman: ins.monthly_amount,
            todayIso: today,
          });
          const exists = reminders.some(
            (r) => r.patient_id === payload.patientId && r.title.includes(payload.sourceKey) && r.status === 'pending'
          );
          if (!exists) {
            await supabase.from('reminders').insert({
              patient_id: payload.patientId,
              title: payload.lockScreenSafeTitle,
              description: payload.authenticatedDetail,
              reminder_date: payload.reminderDate,
              reminder_time: payload.reminderTime,
              category: payload.category,
              priority: payload.priority,
              status: 'pending',
            });
            createdCount++;
          }
        }

        if (ledger.uncoveredDebt > 0) {
          const payload = buildStableFinanceReminderPayload({
            kind: 'ar_followup',
            entityId: ledger.patient.id,
            patient: ledger.patient,
            targetDateIso: today,
            leadDaysBefore,
            amountToman: ledger.uncoveredDebt,
            todayIso: today,
          });
          const exists = reminders.some(
            (r) => r.patient_id === payload.patientId && r.title.includes(`ar:${ledger.patient.id}:`) && r.status === 'pending'
          );
          if (!exists) {
            await supabase.from('reminders').insert({
              patient_id: payload.patientId,
              title: payload.lockScreenSafeTitle,
              description: payload.authenticatedDetail,
              reminder_date: payload.reminderDate,
              reminder_time: payload.reminderTime,
              category: payload.category,
              priority: payload.priority,
              status: 'pending',
            });
            createdCount++;
          }
        }
      }

      onRefreshAll();
      setSyncResultMsg(
        createdCount > 0
          ? `${createdCount.toLocaleString('fa-IR')} یادآور جدید امن (بدون افشای اطلاعات حساس روی صفحه قفل) ثبت شد.`
          : 'تمام یادآورهای مالی فعال و بدون تکرار هستند.'
      );
    } catch {
      setSyncResultMsg('خطا در همگام‌سازی یادآوری‌ها.');
    } finally {
      setSyncingReminders(false);
    }
  };

  const handleQuickPaySubmit = async () => {
    if (!quickPayPatient) return;
    setQuickPayError(null);
    setQuickPayStatusMsg(null);

    const parsed = parseExactTomanAmount(quickPayAmount, { allowZero: false });
    if (!parsed.ok) {
      setQuickPayError(parsed.messageFa);
      HapticEngine.error();
      return;
    }

    setSavingQuickPay(true);
    try {
      const pId = quickPayPatient.id;
      const pTreatments = treatments.filter((t) => t.patient_id === pId);
      const res = await postPatientPaymentCommand({
        patientId: pId,
        amountInput: quickPayAmount,
        paymentMethod: quickPayMethod,
        businessDate: today,
        description: `تسویه بدهی بیمار (${quickPayPatient.first_name} ${quickPayPatient.last_name})`,
        treatmentsForDeterministicAllocation: pTreatments,
      });

      if (res.resolution === 'confirmed') {
        HapticEngine.success();
        setQuickPayStatusMsg(res.messageFa);
        setQuickPayPatient(null);
        setQuickPayAmount('');
        onRefreshAll();
      } else if (res.resolution === 'queued') {
        HapticEngine.warning();
        setQuickPayError(res.messageFa);
      } else {
        HapticEngine.error();
        setQuickPayError(res.messageFa);
      }
    } finally {
      setSavingQuickPay(false);
    }
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <FinanceDebtorsOverview
        summary={summary}
        arPriorities={arPriorities}
        anomalies={anomalies}
        showAuditDrawer={showAuditDrawer}
        onToggleAuditDrawer={() => setShowAuditDrawer(!showAuditDrawer)}
        leadDaysBefore={leadDaysBefore}
        onChangeLeadDays={setLeadDaysBefore}
        syncingReminders={syncingReminders}
        syncResultMsg={syncResultMsg}
        onSyncReminders={handleGenerateSmartReminders}
      />

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {[
          { id: 'all_debtors' as const, label: `همه حساب‌ها (${patientLedgers.length.toLocaleString('fa-IR')})` },
          { id: 'overdue' as const, label: `معوق و نزدیک سررسید (${summary.overduePatientsCount.toLocaleString('fa-IR')})` },
          { id: 'uncovered' as const, label: 'بدهی باز بدون چک/قسط' },
          { id: 'checks_due' as const, label: 'دارای چک' },
          { id: 'installments_due' as const, label: 'دارای قسط فعال' },
        ].map((f) => (
          <button
            key={f.id}
            onClick={() => setFilterMode(f.id)}
            className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-all haptic ${filterMode === f.id ? 'bg-slate-800 text-white shadow-sm' : 'bg-white/80 text-gray-600 border border-gray-200'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {quickPayStatusMsg && (
        <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">{quickPayStatusMsg}</div>
      )}

      {filteredLedgers.length === 0 ? (
        <EmptyState icon={<CheckCircle2 size={28} />} title="موردی یافت نشد" subtitle="تمامی حساب‌های این بخش تسویه شده‌اند" color="#10B981" />
      ) : (
        <div className="space-y-2.5 stagger">
          {filteredLedgers.map((item) => {
            const isExpanded = expandedPatientId === item.patient.id;
            return (
              <div
                key={item.patient.id}
                className="glass-card p-3.5 transition-all"
                style={{ borderRight: item.isOverdue ? '4px solid #EF4444' : item.uncoveredDebt > 0 ? '4px solid #F59E0B' : '4px solid #10B981' }}
              >
                <div className="flex items-start justify-between gap-2 cursor-pointer" onClick={() => setExpandedPatientId(isExpanded ? null : item.patient.id)}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold text-sm shrink-0" style={{ background: item.isOverdue ? '#DC2626' : '#059669' }}>
                      {item.patient.first_name[0]}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-extrabold text-gray-800 truncate">{item.patient.first_name} {item.patient.last_name}</p>
                        {item.isOverdue && <Badge color="#EF4444" bg="#FEE2E2">معوق</Badge>}
                        {!item.isOverdue && item.isUpcoming && <Badge color="#D97706" bg="#FEF3C7">نزدیک سررسید</Badge>}
                        {item.unappliedCredit > 0 && <Badge color="#0284C7" bg="#E0F2FE">بستانکاری: {fmtToman(item.unappliedCredit)} ت</Badge>}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-gray-500 mt-0.5 flex-wrap">
                        {item.patient.phone && <span className="flex items-center gap-1"><Phone size={10} /> {item.patient.phone}</span>}
                        {item.nearestDueDate && <span className="text-amber-700 font-semibold">سررسید: {toJalaliStr(item.nearestDueDate)}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="text-left shrink-0 flex items-center gap-2">
                    <div>
                      <p className="text-[10px] text-gray-400">مانده بدهی</p>
                      <p className="text-sm font-black text-rose-600 tabular-nums">{fmtToman(item.totalRemainingDebt)} ت</p>
                    </div>
                    <div className="w-7 h-7 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500">
                      {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5 mt-2.5 pt-2 border-t border-gray-100 text-[10px]">
                  <div className="bg-emerald-50/80 rounded-xl px-2 py-1.5"><span className="text-gray-500 block">خالص پرداختی</span><strong className="text-emerald-700 tabular-nums">{fmtToman(item.netPaidTotal)} ت</strong></div>
                  <div className="bg-amber-50/80 rounded-xl px-2 py-1.5"><span className="text-gray-500 block">چک وصولی و قسط</span><strong className="text-amber-700 tabular-nums">{fmtToman(item.installmentRemaining + item.collectiblePendingChecksAmount)} ت</strong></div>
                  <div className="bg-rose-50/80 rounded-xl px-2 py-1.5"><span className="text-gray-500 block">بدهی بدون پوشش</span><strong className="text-rose-700 tabular-nums">{fmtToman(item.uncoveredDebt)} ت</strong></div>
                </div>

                <div className="flex items-center gap-2 mt-2.5">
                  <button
                    data-testid={`quick_pay_btn_${item.patient.id}`}
                    onClick={() => {
                      const suggested = item.uncoveredDebt > 0 ? item.uncoveredDebt : item.totalRemainingDebt;
                      setQuickPayPatient(item.patient);
                      setQuickPayAmount(suggested > 0 ? String(suggested) : '');
                      setQuickPayError(null);
                    }}
                    className="flex-1 py-1.5 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold flex items-center justify-center gap-1"
                  >
                    <CheckCircle2 size={13} /> ثبت دریافت وجه اتمیک
                  </button>
                  <button onClick={() => setExpandedPatientId(isExpanded ? null : item.patient.id)} className="py-1.5 px-2.5 rounded-xl bg-gray-100 text-gray-700 text-[11px] font-bold">
                    {isExpanded ? 'بستن' : 'جزئیات'}
                  </button>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-gray-200/80 space-y-2 text-[11px]">
                    <p className="font-extrabold text-gray-700 flex items-center gap-1.5"><Stethoscope size={13} className="text-violet-600" /> درمان‌های قطعی و تعهدات:</p>
                    {item.acceptedTreatments.map((t) => (
                      <div key={t.id} className="rounded-xl bg-gray-50 p-2 border border-gray-200/60 flex justify-between">
                        <span>{t.diagnosis || 'درمان'} {t.tooth_numbers ? `(${t.tooth_numbers})` : ''}</span>
                        <span className="font-bold tabular-nums">{fmtToman(Math.max(0, Number(t.total_cost) - Number(t.discount)))} ت</span>
                      </div>
                    ))}
                    {item.guaranteeChecks.length > 0 && (
                      <div className="rounded-xl bg-slate-50 border border-slate-200 p-2 flex items-center justify-between text-slate-600">
                        <span className="flex items-center gap-1"><FileCheck size={12} /> چک ضمانت نزد مطب ({item.guaranteeChecks.length} فقره)</span>
                        <strong className="tabular-nums">{fmtToman(item.guaranteeChecksAmount)} ت</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <FinanceQuickPaySheet
        patient={quickPayPatient}
        amount={quickPayAmount}
        method={quickPayMethod}
        error={quickPayError}
        saving={savingQuickPay}
        allocationPreview={allocationPreview}
        onAmountChange={(val) => {
          setQuickPayAmount(val);
          setQuickPayError(null);
        }}
        onMethodChange={setQuickPayMethod}
        onClose={() => {
          setQuickPayPatient(null);
          setQuickPayError(null);
        }}
        onSubmit={handleQuickPaySubmit}
      />
    </div>
  );
}
