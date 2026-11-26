/**
 * MinaDental V16 — Single Canonical Financial Read-Model, Ledger & Aging Engine.
 * Trace ID: TRC-MINA-V16-FINANCE-9018-Q
 */
import type {
  Check,
  FinanceTransaction,
  Installment,
  Patient,
  Payment,
  Safteh,
  Treatment,
} from '@/lib/supabaseCore';
import {
  isDuplicatePaymentTransaction,
  isGuaranteeCheck,
  isLinkedTreatmentDirectCostExpense,
  matchesTenantAndBranch,
  resolveTreatmentRealizationDate,
  toBaseIntMoney,
} from '@/features/dashboard/dashboard.metrics';
import { getCurrentJalaliMonthBounds, isDateInRange, todayGregorian } from '@/lib/jalali';
import { CURRENCY_CONTRACT } from './monetaryPrecision';
import type {
  ClinicCashAndOperatingMetrics,
  ClinicReceivablesSummary,
  PatientFinancialLedger,
  PaymentAllocationRecord,
  ReceivablesAgingBucketSummary,
  ServiceChargeRecord,
} from './financialLedgerTypes';
import {
  computeTreatmentNetCost,
  diffDaysIso,
  isRefundPayment,
  isVoidedPayment,
} from './financialAnalytics';

export * from './financialLedgerTypes';
export * from './financialAnalytics';

function isSaftehGuaranteeInstrument(sf: Safteh): boolean {
  return Boolean(sf);
}

/**
 * Computes authoritative patient ledger without Math.max(direct, payments) or planned-debt inflation.
 */
export function computePatientFinancialLedger(params: {
  patient: Patient;
  treatments: Treatment[];
  payments: Payment[];
  installments: Installment[];
  checks: Check[];
  safteh: Safteh[];
  serviceCharges?: ServiceChargeRecord[];
  paymentAllocations?: PaymentAllocationRecord[];
  referenceDateIso?: string;
  leadDaysBefore?: number;
}): PatientFinancialLedger {
  const today = params.referenceDateIso || todayGregorian();
  const leadDays = Math.max(0, params.leadDaysBefore ?? 3);
  const pid = params.patient.id;

  const pTreatments = params.treatments.filter((t) => t.patient_id === pid && t.status !== 'cancelled');
  const plannedTreatments = pTreatments.filter((t) => t.status === 'planned');
  const acceptedTreatments = pTreatments.filter((t) => t.status !== 'planned');

  const pCharges = (params.serviceCharges || []).filter(
    (c) => c.patient_id === pid && c.charge_status === 'posted'
  );
  const pAllocations = (params.paymentAllocations || []).filter((a) => a.patient_id === pid);

  const nonVoidPayments = params.payments.filter((p) => p.patient_id === pid && !isVoidedPayment(p));
  const completedPayments = nonVoidPayments.filter((p) => p.status === 'completed' && !isRefundPayment(p));
  const refunds = nonVoidPayments.filter((p) => isRefundPayment(p));

  const pInstallments = params.installments.filter(
    (ins) => ins.patient_id === pid && (ins.status === 'active' || ins.status === 'overdue')
  );
  const allChecks = params.checks.filter(
    (ch) => ch.patient_id === pid && (ch.status === 'pending' || ch.status === 'bounced')
  );
  const guaranteeChecks = allChecks.filter((c) => isGuaranteeCheck(c));
  const collectibleChecks = allChecks.filter((c) => !isGuaranteeCheck(c));
  const pSafteh = params.safteh.filter(
    (sf) => sf.patient_id === pid && (sf.status === 'pending' || sf.status === 'bounced')
  );

  const plannedTreatmentValue = plannedTreatments.reduce((s, t) => s + computeTreatmentNetCost(t), 0);

  let postedChargesTotal = 0;
  let unverifiedCompletionDatesCount = 0;
  for (const t of acceptedTreatments) {
    if (t.status === 'completed' && !resolveTreatmentRealizationDate(t)) {
      unverifiedCompletionDatesCount += 1;
    }
  }

  if (pCharges.length > 0) {
    postedChargesTotal = pCharges.reduce((s, c) => {
      const net =
        c.net_amount !== undefined
          ? toBaseIntMoney(c.net_amount)
          : Math.max(0, toBaseIntMoney(c.gross_amount) - toBaseIntMoney(c.discount_amount) + toBaseIntMoney(c.approved_adjustment));
      return s + net;
    }, 0);
  } else {
    postedChargesTotal = acceptedTreatments.reduce((s, t) => s + computeTreatmentNetCost(t), 0);
  }

  const acceptedTreatmentIds = new Set(acceptedTreatments.map((t) => t.id));
  const standaloneInstallmentPrincipal = pInstallments
    .filter((i) => !i.treatment_id || !acceptedTreatmentIds.has(i.treatment_id))
    .reduce((s, i) => s + toBaseIntMoney(i.total_amount), 0);

  const totalObligation = postedChargesTotal + standaloneInstallmentPrincipal;

  const grossCompletedPayments = completedPayments.reduce((s, p) => s + toBaseIntMoney(p.amount), 0);
  const refundedTotal = refunds.reduce((s, p) => s + Math.abs(toBaseIntMoney(p.amount)), 0);
  const netPaidTotal = Math.max(0, grossCompletedPayments - refundedTotal);

  let allocatedPaidTotal = 0;
  if (pAllocations.length > 0) {
    const netAlloc = pAllocations.reduce((sum, a) => {
      const amt = toBaseIntMoney(a.amount);
      return a.allocation_kind === 'reversal' ? sum - amt : sum + amt;
    }, 0);
    allocatedPaidTotal = Math.max(0, Math.min(totalObligation, netAlloc));
  } else if (nonVoidPayments.length > 0) {
    allocatedPaidTotal = Math.min(totalObligation, netPaidTotal);
  } else {
    const legacyDirect = acceptedTreatments.reduce((s, t) => s + toBaseIntMoney(t.paid_amount), 0);
    allocatedPaidTotal = Math.min(totalObligation, legacyDirect);
  }

  const effectiveNetCashPool = nonVoidPayments.length > 0 ? netPaidTotal : allocatedPaidTotal;
  const unappliedCredit = Math.max(0, effectiveNetCashPool - totalObligation);
  const totalRemainingDebt = Math.max(0, totalObligation - allocatedPaidTotal);

  const installmentRemaining = pInstallments.reduce(
    (s, ins) => s + Math.max(0, toBaseIntMoney(ins.total_amount) - toBaseIntMoney(ins.paid_amount)),
    0
  );
  const collectiblePendingChecksAmount = collectibleChecks
    .filter((c) => c.status === 'pending')
    .reduce((s, c) => s + toBaseIntMoney(c.amount), 0);
  const guaranteeChecksAmount = guaranteeChecks
    .filter((c) => c.status === 'pending')
    .reduce((s, c) => s + toBaseIntMoney(c.amount), 0);
  const bouncedChecksAmount = collectibleChecks
    .filter((c) => c.status === 'bounced')
    .reduce((s, c) => s + toBaseIntMoney(c.amount), 0);
  const pendingSaftehAmount = pSafteh
    .filter((sf) => isSaftehGuaranteeInstrument(sf) && sf.status === 'pending')
    .reduce((s, sf) => s + toBaseIntMoney(sf.amount), 0);

  const effectiveInstallmentCoverage = Math.min(totalRemainingDebt, installmentRemaining);
  const uncoveredDebt = Math.max(
    0,
    totalRemainingDebt - collectiblePendingChecksAmount - effectiveInstallmentCoverage
  );

  const overdueInstallments = pInstallments.filter(
    (i) => Boolean(i.next_due_date) && i.next_due_date! <= today
  );
  const upcomingInstallments = pInstallments.filter((i) => {
    if (!i.next_due_date) return false;
    const d = diffDaysIso(today, i.next_due_date);
    return d > 0 && d <= leadDays;
  });

  const overdueChecks = collectibleChecks.filter((c) => c.due_date <= today || c.status === 'bounced');
  const upcomingChecks = collectibleChecks.filter((c) => {
    if (c.status !== 'pending') return false;
    const d = diffDaysIso(today, c.due_date);
    return d > 0 && d <= leadDays;
  });

  const dueDates: string[] = [];
  pInstallments.forEach((i) => {
    if (i.next_due_date) dueDates.push(i.next_due_date);
  });
  collectibleChecks.forEach((c) => {
    if (c.due_date) dueDates.push(c.due_date);
  });
  pCharges.forEach((c) => {
    if (c.due_date) dueDates.push(c.due_date);
  });
  dueDates.sort();
  const nearestDueDate = dueDates[0] || null;

  let maxOverdueDays = 0;
  for (const d of dueDates) {
    const past = diffDaysIso(d, today);
    if (past > maxOverdueDays) maxOverdueDays = past;
  }

  const isOverdue =
    overdueInstallments.length > 0 || overdueChecks.length > 0 || bouncedChecksAmount > 0;
  const isUpcoming = upcomingInstallments.length > 0 || upcomingChecks.length > 0;

  const hasAnyFinancialObligation =
    totalRemainingDebt > 0 ||
    installmentRemaining > 0 ||
    collectiblePendingChecksAmount > 0 ||
    guaranteeChecksAmount > 0 ||
    bouncedChecksAmount > 0 ||
    pendingSaftehAmount > 0 ||
    unappliedCredit > 0;

  return {
    patient: params.patient,
    treatments: pTreatments,
    acceptedTreatments,
    plannedTreatments,
    postedCharges: pCharges,
    payments: completedPayments,
    refunds,
    installments: pInstallments,
    collectibleChecks,
    guaranteeChecks,
    safteh: pSafteh,
    postedChargesTotal,
    plannedTreatmentValue,
    grossCompletedPayments,
    refundedTotal,
    netPaidTotal,
    allocatedPaidTotal,
    unappliedCredit,
    totalRemainingDebt,
    installmentRemaining,
    collectiblePendingChecksAmount,
    guaranteeChecksAmount,
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
    maxOverdueDays,
    unverifiedCompletionDatesCount,
  };
}

export function computeReceivablesAgingBuckets(
  ledgers: PatientFinancialLedger[],
  referenceDateIso: string = todayGregorian()
): ReceivablesAgingBucketSummary {
  const buckets: ReceivablesAgingBucketSummary = {
    current: 0,
    days_1_30: 0,
    days_31_60: 0,
    days_61_90: 0,
    over_90: 0,
    unscheduledDueDateAmount: 0,
  };

  for (const l of ledgers) {
    if (l.totalRemainingDebt <= 0) continue;
    if (!l.nearestDueDate) {
      buckets.unscheduledDueDateAmount += l.totalRemainingDebt;
      continue;
    }
    const overdueDays = diffDaysIso(l.nearestDueDate, referenceDateIso);
    if (overdueDays <= 0) buckets.current += l.totalRemainingDebt;
    else if (overdueDays <= 30) buckets.days_1_30 += l.totalRemainingDebt;
    else if (overdueDays <= 60) buckets.days_31_60 += l.totalRemainingDebt;
    else if (overdueDays <= 90) buckets.days_61_90 += l.totalRemainingDebt;
    else buckets.over_90 += l.totalRemainingDebt;
  }

  return buckets;
}

export function computeClinicReceivablesSummary(
  ledgers: PatientFinancialLedger[],
  referenceDateIso: string = todayGregorian()
): ClinicReceivablesSummary {
  const active = ledgers.filter((l) => l.hasAnyFinancialObligation);
  return {
    currency: CURRENCY_CONTRACT,
    totalReceivables: active.reduce((s, l) => s + l.totalRemainingDebt, 0),
    totalUncovered: active.reduce((s, l) => s + l.uncoveredDebt, 0),
    totalCollectibleChecksInHand: active.reduce((s, l) => s + l.collectiblePendingChecksAmount, 0),
    totalGuaranteeChecksHeld: active.reduce((s, l) => s + l.guaranteeChecksAmount, 0),
    totalBouncedChecks: active.reduce((s, l) => s + l.bouncedChecksAmount, 0),
    totalInstallmentsActive: active.reduce((s, l) => s + l.installmentRemaining, 0),
    totalUnappliedCredit: active.reduce((s, l) => s + l.unappliedCredit, 0),
    totalPlannedEstimatesExcluded: ledgers.reduce((s, l) => s + l.plannedTreatmentValue, 0),
    overduePatientsCount: active.filter((l) => l.isOverdue).length,
    totalDebtorsCount: active.filter(
      (l) => l.totalRemainingDebt > 0 || l.collectiblePendingChecksAmount > 0 || l.installmentRemaining > 0
    ).length,
    aging: computeReceivablesAgingBuckets(active, referenceDateIso),
  };
}

export function computeClinicCashAndOperatingMetrics(params: {
  tenantId: string;
  branchId: string;
  treatments: Treatment[];
  payments: Payment[];
  finance: FinanceTransaction[];
  referenceDateIso?: string;
  windowStartIso?: string;
  windowEndIso?: string;
  financialDataComplete?: boolean;
  pageLimit?: number;
}): ClinicCashAndOperatingMetrics {
  const refDate = params.referenceDateIso || todayGregorian();
  const bounds = getCurrentJalaliMonthBounds(refDate);
  const windowStart = params.windowStartIso || bounds.startGregorian;
  const windowEnd = params.windowEndIso || bounds.endGregorian;
  const limit = params.pageLimit ?? 500;

  const scopedTreatments = params.treatments.filter((t) =>
    matchesTenantAndBranch(t, params.branchId, params.tenantId)
  );
  const scopedPayments = params.payments.filter((p) =>
    matchesTenantAndBranch(p, params.branchId, params.tenantId)
  );
  const scopedFinance = params.finance.filter((f) =>
    matchesTenantAndBranch(f, params.branchId, params.tenantId)
  );

  const nonVoid = scopedPayments.filter((p) => !isVoidedPayment(p));
  const completedInWindow = nonVoid.filter(
    (p) => p.status === 'completed' && !isRefundPayment(p) && isDateInRange(p.payment_date, windowStart, windowEnd)
  );
  const refundedInWindow = nonVoid.filter(
    (p) => isRefundPayment(p) && isDateInRange(p.refunded_at || p.payment_date, windowStart, windowEnd)
  );

  const grossCollections = completedInWindow.reduce((s, p) => s + toBaseIntMoney(p.amount), 0);
  const periodRefunds = refundedInWindow.reduce((s, p) => s + Math.abs(toBaseIntMoney(p.amount)), 0);
  const netCollections = grossCollections - periodRefunds;

  const windowFinance = scopedFinance.filter((f) =>
    isDateInRange(f.transaction_date, windowStart, windowEnd)
  );

  const internalTransfersTotal = windowFinance
    .filter((f) => f.type === 'transfer')
    .reduce((s, f) => s + toBaseIntMoney(f.amount), 0);

  const extraNonPatientIncome = windowFinance
    .filter((f) => f.type === 'income' && !isDuplicatePaymentTransaction(f, completedInWindow))
    .reduce((s, f) => s + toBaseIntMoney(f.amount), 0);

  let unverifiedCompletionDateCount = 0;
  const performedTreatmentsInWindow: Treatment[] = [];
  for (const t of scopedTreatments) {
    if (t.status !== 'completed') continue;
    const realDate = resolveTreatmentRealizationDate(t);
    if (!realDate) {
      unverifiedCompletionDateCount += 1;
      continue;
    }
    if (isDateInRange(realDate, windowStart, windowEnd)) {
      performedTreatmentsInWindow.push(t);
    }
  }

  const netClinicalProduction = performedTreatmentsInWindow.reduce(
    (s, t) => s + computeTreatmentNetCost(t),
    0
  );
  const directClinicalCosts = performedTreatmentsInWindow.reduce(
    (s, t) =>
      s +
      toBaseIntMoney(t.doctor_cost) +
      toBaseIntMoney(t.lab_cost) +
      toBaseIntMoney(t.material_cost) +
      toBaseIntMoney(t.other_cost),
    0
  );

  const cashExpensesTotal = windowFinance
    .filter((f) => f.type === 'expense')
    .reduce((s, f) => s + toBaseIntMoney(f.amount), 0);

  const dedupedOperatingExpenses = windowFinance
    .filter((f) => f.type === 'expense' && !isLinkedTreatmentDirectCostExpense(f, performedTreatmentsInWindow))
    .reduce((s, f) => s + toBaseIntMoney(f.amount), 0);

  const truncated =
    params.financialDataComplete === false ||
    params.payments.length >= limit ||
    params.treatments.length >= limit ||
    params.finance.length >= limit;

  return {
    currency: CURRENCY_CONTRACT,
    grossCollections,
    periodRefunds,
    netCollections,
    extraNonPatientIncome,
    internalTransfersTotal,
    cashExpensesTotal,
    dedupedOperatingExpenses,
    netCashFlow: netCollections + extraNonPatientIncome - cashExpensesTotal,
    netClinicalProduction,
    directClinicalCosts,
    operatingResult:
      netClinicalProduction + extraNonPatientIncome - directClinicalCosts - dedupedOperatingExpenses,
    unverifiedCompletionDateCount,
    provenance: {
      currency: CURRENCY_CONTRACT,
      windowStart,
      windowEnd,
      basis: 'reconciled_ledger',
      dataCompleteness: truncated ? 'partial_or_truncated' : 'complete',
      snapshotTimestamp: new Date().toISOString(),
      isProvisional: truncated || unverifiedCompletionDateCount > 0,
    },
  };
}
