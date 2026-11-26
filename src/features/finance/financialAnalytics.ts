import type { Check, FinanceTransaction, Patient, Payment, Treatment } from '@/lib/supabaseCore';
import {
  isDuplicatePaymentTransaction,
  isGuaranteeCheck,
  resolveTreatmentRealizationDate,
  toBaseIntMoney,
} from '@/features/dashboard/dashboard.metrics';
import { todayGregorian } from '@/lib/jalali';
import { CURRENCY_CONTRACT, formatToman } from './monetaryPrecision';
import type {
  AccountsReceivablePriorityItem,
  DailyCloseReconciliationSummary,
  FinanceReminderPayload,
  FinancialAnomalyItem,
  PatientFinancialLedger,
} from './financialLedgerTypes';

export function diffDaysIso(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${toIso.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export function addDaysIso(dateIso: string, daysOffset: number): string {
  const d = new Date(`${dateIso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return todayGregorian();
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

export function isVoidedPayment(p: Payment): boolean {
  const st = String(p.status || '').toLowerCase();
  return st === 'voided' || st === 'cancelled' || Boolean(p.voided_at);
}

export function isRefundPayment(p: Payment): boolean {
  const st = String(p.status || '').toLowerCase();
  return st === 'refunded' || st === 'reversed' || Boolean(p.refunded_at);
}

export function computeTreatmentNetCost(t: Treatment): number {
  return Math.max(0, toBaseIntMoney(t.total_cost) - toBaseIntMoney(t.discount));
}

/**
 * Deterministic, explainable AR follow-up prioritization (never blocks urgent clinical care).
 */
export function prioritizeAccountsReceivable(
  ledgers: PatientFinancialLedger[]
): AccountsReceivablePriorityItem[] {
  const results: AccountsReceivablePriorityItem[] = [];

  for (const l of ledgers) {
    if (l.totalRemainingDebt <= 0 && l.bouncedChecksAmount <= 0) continue;

    const bouncedCount = l.collectibleChecks.filter((c) => c.status === 'bounced').length;
    const score =
      bouncedCount * 400 +
      l.maxOverdueDays * 8 +
      Math.round(l.uncoveredDebt / 200_000) +
      Math.round(l.totalRemainingDebt / 500_000);

    const reasonsFa: string[] = [];
    if (bouncedCount > 0) reasonsFa.push(`${bouncedCount.toLocaleString('fa-IR')} چک برگشتی`);
    if (l.maxOverdueDays > 0) reasonsFa.push(`${l.maxOverdueDays.toLocaleString('fa-IR')} روز تاخیر سررسید`);
    if (l.uncoveredDebt > 0) reasonsFa.push(`بدهی باز بدون پوشش (${formatToman(l.uncoveredDebt)} تومان)`);
    if (reasonsFa.length === 0) reasonsFa.push('مطالبه در جریان مطابق برنامه پرداخت');

    results.push({
      patientId: l.patient.id,
      patientName: `${l.patient.first_name} ${l.patient.last_name}`.trim(),
      score,
      overdueDays: l.maxOverdueDays,
      bouncedChecksCount: bouncedCount,
      uncoveredDebt: l.uncoveredDebt,
      totalRemainingDebt: l.totalRemainingDebt,
      nearestDueDate: l.nearestDueDate,
      reasonsFa,
      urgentCareProtected: true,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

/**
 * Explainable anomaly & revenue-leakage detection (surfaces candidates for human review only).
 */
export function detectFinancialAnomalies(params: {
  payments: Payment[];
  finance: FinanceTransaction[];
  checks: Check[];
  treatments: Treatment[];
  referenceDateIso?: string;
}): FinancialAnomalyItem[] {
  const today = params.referenceDateIso || todayGregorian();
  const anomalies: FinancialAnomalyItem[] = [];

  const seenReceiptKeys = new Map<string, Payment>();
  for (const p of params.payments) {
    if (p.status !== 'completed' || isVoidedPayment(p) || isRefundPayment(p)) continue;
    const key = `${p.patient_id || ''}:${toBaseIntMoney(p.amount)}:${p.payment_date.slice(0, 10)}:${p.payment_method}`;
    const prev = seenReceiptKeys.get(key);
    if (prev && prev.id !== p.id) {
      anomalies.push({
        id: `anom_dup_${p.id}`,
        ruleCode: 'DUPLICATE_RECEIPT_CANDIDATE',
        severity: 'high',
        entityType: 'payment',
        entityId: p.id,
        titleFa: 'احتمال ثبت تکراری دریافت وجه',
        explanationFa: `دو دریافت هم‌مبلغ (${formatToman(p.amount)} تومان) در تاریخ یکسان برای بیمار ثبت شده است؛ نیازمند بررسی پیش از تایید نهایی.`,
        amountToman: toBaseIntMoney(p.amount),
      });
    } else {
      seenReceiptKeys.set(key, p);
    }
  }

  const completedPayments = params.payments.filter((p) => p.status === 'completed' && !isVoidedPayment(p));
  for (const tx of params.finance) {
    if (tx.type === 'income' && tx.category === 'patient_payment') {
      if (!isDuplicatePaymentTransaction(tx, completedPayments)) {
        anomalies.push({
          id: `anom_unlinked_${tx.id}`,
          ruleCode: 'UNLINKED_PATIENT_PAYMENT_TX',
          severity: 'medium',
          entityType: 'finance_transaction',
          entityId: tx.id,
          titleFa: 'تراکنش دریافت بیمار بدون اتصال به رسید پرداخت',
          explanationFa: 'تراکنش در خزانه با دسته‌بندی «پرداخت بیمار» ثبت شده اما شناسه رسید پرداخت متناظر ندارد.',
          amountToman: toBaseIntMoney(tx.amount),
        });
      }
    }
  }

  for (const ch of params.checks) {
    if (ch.status === 'pending' && !isGuaranteeCheck(ch)) {
      const daysPast = diffDaysIso(ch.due_date, today);
      if (daysPast > 14) {
        anomalies.push({
          id: `anom_stale_chk_${ch.id}`,
          ruleCode: 'STALE_PENDING_CHECK',
          severity: 'high',
          entityType: 'check',
          entityId: ch.id,
          titleFa: 'چک وصولی تعیین‌تکلیف‌نشده پس از سررسید',
          explanationFa: `چک شماره ${ch.check_number || '-'} بیش از ${daysPast.toLocaleString('fa-IR')} روز از سررسید گذشته و هنوز وضعیت وصول یا برگشت آن ثبت نشده است.`,
          amountToman: toBaseIntMoney(ch.amount),
        });
      }
    }
  }

  for (const t of params.treatments) {
    if (t.status === 'completed' && !resolveTreatmentRealizationDate(t)) {
      anomalies.push({
        id: `anom_missing_date_${t.id}`,
        ruleCode: 'MISSING_PERFORMED_DATE',
        severity: 'low',
        entityType: 'treatment',
        entityId: t.id,
        titleFa: 'درمان تکمیل‌شده بدون تاریخ انجام تاییدشده',
        explanationFa: 'درمان به وضعیت تکمیل‌شده ثبت شده اما تاریخ انجام (performed_at) برای گزارش‌گیری تعهدی خالی است.',
        amountToman: computeTreatmentNetCost(t),
      });
    }
    const net = computeTreatmentNetCost(t);
    if (toBaseIntMoney(t.paid_amount) > net) {
      anomalies.push({
        id: `anom_neg_bal_${t.id}`,
        ruleCode: 'NEGATIVE_TREATMENT_BALANCE',
        severity: 'medium',
        entityType: 'treatment',
        entityId: t.id,
        titleFa: 'پرداختی بیشتر از تعرفه خالص درمان',
        explanationFa: 'مبلغ تخصیصی درمان از هزینه خالص بیشتر است؛ مابه‌التفاوت باید به عنوان بستانکاری تخصیص‌نیافته بررسی شود.',
        amountToman: toBaseIntMoney(t.paid_amount) - net,
      });
    }
  }

  return anomalies;
}

export function evaluateDailyCloseReconciliation(params: {
  businessDate: string;
  openingBalance: number;
  countedCash: number;
  payments: Payment[];
  unmatchedCount?: number;
}): DailyCloseReconciliationSummary {
  const dayPayments = params.payments.filter(
    (p) => !isVoidedPayment(p) && (p.payment_date || '').slice(0, 10) === params.businessDate
  );

  const expectedCash = dayPayments
    .filter((p) => p.status === 'completed' && !isRefundPayment(p) && p.payment_method === 'cash')
    .reduce((s, p) => s + toBaseIntMoney(p.amount), 0);
  const expectedCard = dayPayments
    .filter((p) => p.status === 'completed' && !isRefundPayment(p) && p.payment_method === 'card')
    .reduce((s, p) => s + toBaseIntMoney(p.amount), 0);
  const expectedTransfer = dayPayments
    .filter((p) => p.status === 'completed' && !isRefundPayment(p) && p.payment_method === 'transfer')
    .reduce((s, p) => s + toBaseIntMoney(p.amount), 0);
  const expectedRefunds = dayPayments
    .filter((p) => isRefundPayment(p) && p.payment_method === 'cash')
    .reduce((s, p) => s + Math.abs(toBaseIntMoney(p.amount)), 0);

  const expectedDrawerCash = toBaseIntMoney(params.openingBalance) + expectedCash - expectedRefunds;
  const countedCash = toBaseIntMoney(params.countedCash);
  const varianceAmount = countedCash - expectedDrawerCash;
  const unmatchedCount = Math.max(0, toBaseIntMoney(params.unmatchedCount));

  return {
    businessDate: params.businessDate,
    openingBalance: toBaseIntMoney(params.openingBalance),
    expectedCash,
    expectedCard,
    expectedTransfer,
    expectedRefunds,
    expectedDrawerCash,
    countedCash,
    varianceAmount,
    hasVariance: varianceAmount !== 0,
    unmatchedCount,
    canCloseSilently: varianceAmount === 0 && unmatchedCount === 0,
    requiresVarianceExplanation: varianceAmount !== 0 || unmatchedCount > 0,
    currency: CURRENCY_CONTRACT,
  };
}

/**
 * Generates deterministic deduplicated reminders without exposing sensitive PHI or exact amounts on lock screens.
 */
export function buildStableFinanceReminderPayload(params: {
  kind: 'check_due' | 'installment_due' | 'ar_followup';
  entityId: string;
  patient: Patient;
  targetDateIso: string;
  leadDaysBefore: number;
  amountToman: number;
  todayIso?: string;
}): FinanceReminderPayload {
  const today = params.todayIso || todayGregorian();
  const daysUntil = diffDaysIso(today, params.targetDateIso);
  const reminderDate =
    daysUntil > params.leadDaysBefore ? addDaysIso(params.targetDateIso, -params.leadDaysBefore) : today;

  const sourceKey =
    params.kind === 'check_due'
      ? `chk:${params.entityId}:due:${params.targetDateIso}`
      : params.kind === 'installment_due'
      ? `ins:${params.entityId}:due:${params.targetDateIso}`
      : `ar:${params.patient.id}:${today}`;

  const lockScreenSafeTitle =
    params.kind === 'check_due'
      ? `یادآور پیگیری مالی کلینیک (چک سررسید نزدیک) [${sourceKey}]`
      : params.kind === 'installment_due'
      ? `یادآور پیگیری برنامه پرداخت بیمار [${sourceKey}]`
      : `یادآور پیگیری حساب مالی پرونده [${sourceKey}]`;

  const pName = `${params.patient.first_name} ${params.patient.last_name}`.trim();
  const authenticatedDetail = `پرونده ${pName} • مبلغ ${formatToman(params.amountToman)} تومان • مرجع ${sourceKey}`;

  return {
    sourceKey,
    patientId: params.patient.id,
    category: 'payment',
    reminderDate,
    reminderTime: params.kind === 'check_due' ? '09:30' : '10:00',
    priority: daysUntil <= 0 ? 'urgent' : 'high',
    lockScreenSafeTitle,
    authenticatedDetail,
  };
}
