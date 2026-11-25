import type {
  Appointment,
  Check,
  ClinicSetting,
  FinanceTransaction,
  Implant,
  Installment,
  InventoryItem,
  LabOrder,
  Patient,
  Payment,
  Reminder,
  Safteh,
  Staff,
  Treatment,
} from '@/lib/supabase';
import { getCurrentJalaliMonthBounds, isDateInRange, todayGregorian } from '@/lib/jalali';
import type { DentalUnit } from '@/lib/clinicDefinitions';
import type { SectionId } from '@/lib/sections';
import type { ClinicUserRole } from '@/lib/cloudSyncEngine';
import { computeLiveSmartAlerts, loadSmartReminderRules } from '@/lib/smartReminderEngine';
import { buildSmartDailyBrief } from '@/services/intelligence/clinicIntelligence';
import { canAccessRoute } from '@/services/permissions/accessControl';
import { CORE_PALETTE, getModuleToken } from '@/design-system/tokens';
import type {
  DashboardCapacityMetrics,
  DashboardMetrics,
  DashboardPriorityAction,
  DashboardServerSummary,
} from './dashboard.types';

export interface DashboardMetricsInput {
  patients: Patient[];
  appointments: Appointment[];
  treatments: Treatment[];
  labOrders: LabOrder[];
  implants: Implant[];
  payments: Payment[];
  inventory: InventoryItem[];
  reminders: Reminder[];
  finance: FinanceTransaction[];
  installments: Installment[];
  checks: Check[];
  safteh: Safteh[];
  clinicSettings: ClinicSetting[];
  staff: Staff[];
  units: DentalUnit[];
  branchId: string;
  tenantId: string;
  userRole: ClinicUserRole;
  referenceDateIso?: string;
  /** Defaults to true for pure unit callers; set false when any financial source errored/unauthorized/partial/locked_offline/migration_required */
  financialDataComplete?: boolean;
  /** Authoritative full-dataset server RPC summary when deployed on Supabase */
  serverSummary?: DashboardServerSummary | null;
}

type TenantBranchScopedRecord = {
  tenant_id?: string | null;
  branch_id?: string | null;
};

/**
 * Base-unit integer money conversion (IRR_TOMAN).
 * Avoids floating-point drift on accumulated clinic financial totals.
 */
export function toBaseIntMoney(val: unknown): number {
  const n = Number(val ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/**
 * Strict fail-closed tenant & branch isolation (V4 P0):
 * Rejects rows with missing/empty `tenant_id` or `branch_id`, AND rejects calls with
 * missing/empty expected `tenantId` or `branchId`.
 */
export function matchesTenantAndBranch<T extends TenantBranchScopedRecord>(
  row: T,
  branchId: string,
  tenantId: string
): boolean {
  if (!tenantId || !tenantId.trim() || !row.tenant_id || !row.tenant_id.trim()) {
    return false;
  }
  if (row.tenant_id.trim() !== tenantId.trim()) {
    return false;
  }
  if (!row.branch_id) {
    return false;
  }
  if (!branchId || !branchId.trim()) {
    return false;
  }
  return row.branch_id.trim() === branchId.trim();
}

/**
 * V4 Accounting Realization Date Rule:
 * Accrual revenue and direct clinical costs are recognized STRICTLY on `performed_at` or `completed_at`.
 * NEVER falls back to `created_at` (which is when a treatment plan was drafted, not performed).
 * Completed treatments lacking both timestamps return `null` and are reported via `unverifiedCompletionDateCount`.
 */
export function resolveTreatmentRealizationDate(t: Treatment): string | null {
  const perf = typeof t.performed_at === 'string' ? t.performed_at.trim() : '';
  if (perf) return perf;
  const comp = typeof t.completed_at === 'string' ? t.completed_at.trim() : '';
  if (comp) return comp;
  return null;
}

function parseShiftRangeMinutes(rangeStr: string | undefined): number {
  if (!rangeStr) return 0;
  const matches = rangeStr.match(/\d{1,2}:\d{2}/g);
  if (!matches || matches.length < 2) return 0;
  const [startH, startM] = matches[0].split(':').map(Number);
  const [endH, endM] = matches[1].split(':').map(Number);
  const startTotal = startH * 60 + startM;
  const endTotal = endH * 60 + endM;
  return endTotal > startTotal ? endTotal - startTotal : 0;
}

function parsePositiveNumberSetting(settings: ClinicSetting[], key: string): number | null {
  const row = settings.find((s) => s.key === key);
  if (!row || !row.value) return null;
  const num = Number(String(row.value).replace(/[^\d.]/g, ''));
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * Guarantee collateral checks vs collectible receivable checks.
 */
export function isGuaranteeCheck(c: Check): boolean {
  if (c.is_guarantee === true) return true;
  if (String(c.type || '').toLowerCase() === 'guarantee') return true;
  if (/ضمانت/.test(String(c.notes || ''))) return true;
  return false;
}

/**
 * V4 Date-Aware Chair Capacity:
 * Computes real chair capacity from active units, active doctors, clinic shift schedule,
 * explicit `default_appointment_duration` (NO silent 30-min fallback!), working days,
 * and booked appointment minutes. Preserves real unclamped utilization (>100% visible when overbooked).
 */
export function computeRealChairCapacity(params: {
  units: DentalUnit[];
  staff: Staff[];
  clinicSettings: ClinicSetting[];
  activeTodaySlots: number;
  todayActiveAppointments?: Appointment[];
  referenceDateIso?: string;
}): DashboardCapacityMetrics {
  const {
    units,
    staff,
    clinicSettings,
    activeTodaySlots,
    todayActiveAppointments,
    referenceDateIso,
  } = params;
  const activeUnits = units.filter((u) => u.status === 'active');
  const activeDoctors = staff.filter(
    (st) => st.active !== false && (st.role === 'manager' || st.role === 'dentist')
  );

  let isClosedDay = false;
  if (referenceDateIso) {
    const dt = new Date(`${referenceDateIso.slice(0, 10)}T12:00:00Z`);
    if (!Number.isNaN(dt.getTime())) {
      const weekday = dt.getUTCDay(); // 0=Sun..5=Fri..6=Sat
      const closedRaw = clinicSettings.find((s) => s.key === 'clinic_closed_weekdays')?.value;
      if (closedRaw) {
        const closedDays = closedRaw
          .split(',')
          .map((d) => Number(d.trim()))
          .filter((n) => Number.isInteger(n));
        if (closedDays.includes(weekday)) {
          isClosedDay = true;
        }
      }
      const workingRaw = clinicSettings.find((s) => s.key === 'clinic_working_days')?.value;
      if (workingRaw) {
        const workingDays = workingRaw
          .split(',')
          .map((d) => Number(d.trim()))
          .filter((n) => Number.isInteger(n));
        if (workingDays.length > 0 && !workingDays.includes(weekday)) {
          isClosedDay = true;
        }
      }
    }
  }

  const morningStr = clinicSettings.find((s) => s.key === 'clinic_morning_hours')?.value || '';
  const eveningStr = clinicSettings.find((s) => s.key === 'clinic_evening_hours')?.value || '';
  const parsedShiftMinutes = isClosedDay
    ? 0
    : parseShiftRangeMinutes(morningStr) + parseShiftRangeMinutes(eveningStr);

  // V4 P0: Require explicit `default_appointment_duration` from clinic settings — zero silent 30m fallback
  const slotDurationMinutes = parsePositiveNumberSetting(
    clinicSettings,
    'default_appointment_duration'
  );

  const shiftMinutesPerDay = parsedShiftMinutes;
  const effectiveChairs = Math.min(activeUnits.length, activeDoctors.length);
  const totalAvailableChairMinutes = effectiveChairs * shiftMinutesPerDay;

  let dailyChairCapacity: number | null = null;
  if (isClosedDay) {
    dailyChairCapacity = 0;
  } else if (
    effectiveChairs > 0 &&
    shiftMinutesPerDay > 0 &&
    slotDurationMinutes !== null &&
    slotDurationMinutes > 0
  ) {
    dailyChairCapacity = Math.floor(totalAvailableChairMinutes / slotDurationMinutes);
  }

  // Prefer actual booked appointment duration minutes when available, else slot-based calculation
  let bookedMinutesToday = 0;
  let allAppointmentsHaveDuration = false;
  if (Array.isArray(todayActiveAppointments) && todayActiveAppointments.length > 0) {
    let validDurationCount = 0;
    for (const appt of todayActiveAppointments) {
      const dur = Number(appt.duration_min || 0);
      if (Number.isFinite(dur) && dur > 0) {
        bookedMinutesToday += Math.round(dur);
        validDurationCount += 1;
      } else if (slotDurationMinutes !== null) {
        bookedMinutesToday += Math.round(slotDurationMinutes);
      }
    }
    allAppointmentsHaveDuration = validDurationCount === todayActiveAppointments.length;
  } else if (slotDurationMinutes !== null && activeTodaySlots > 0) {
    bookedMinutesToday = Math.round(activeTodaySlots * slotDurationMinutes);
  }

  // Real unclamped utilization (>100% preserved so overbooking is never hidden)
  let chairUtilizationPct: number | null = null;
  if (!isClosedDay && totalAvailableChairMinutes > 0) {
    if (allAppointmentsHaveDuration && bookedMinutesToday > 0) {
      chairUtilizationPct = Math.round((bookedMinutesToday / totalAvailableChairMinutes) * 100);
    } else if (dailyChairCapacity !== null && dailyChairCapacity > 0) {
      chairUtilizationPct = Math.round((activeTodaySlots / dailyChairCapacity) * 100);
    }
  }

  return {
    activeUnitsCount: activeUnits.length,
    activeDoctorsCount: activeDoctors.length,
    shiftMinutesPerDay,
    slotDurationMinutes,
    dailyChairCapacity,
    activeTodaySlots,
    bookedMinutesToday,
    chairUtilizationPct,
    isClosedDay,
  };
}

/**
 * Deterministic foreign-key payment deduplication ONLY.
 * A `finance_transactions` income row is deduplicated ONLY when it references an ACTUAL
 * existing `Payment.id` in `completedPayments` (via `payment_id`, exact `PAY:<id>` reference,
 * or exact `[PAY_ID:<id>]` tag).
 */
export function isDuplicatePaymentTransaction(
  tx: FinanceTransaction & { payment_id?: string | null },
  completedPayments: Payment[]
): boolean {
  if (completedPayments.length === 0) return false;

  const paymentIds = new Set<string>();
  const paymentIdsUpper = new Set<string>();
  for (const p of completedPayments) {
    const pid = String(p.id || '').trim();
    if (pid) {
      paymentIds.add(pid);
      paymentIdsUpper.add(pid.toUpperCase());
    }
  }
  if (paymentIds.size === 0) return false;

  const linkedPaymentId = tx.payment_id ? String(tx.payment_id).trim() : '';
  if (linkedPaymentId && paymentIds.has(linkedPaymentId)) {
    return true;
  }

  const ref = String(tx.reference || '').trim().toUpperCase();
  if (ref) {
    if (paymentIdsUpper.has(ref)) return true;
    if (ref.startsWith('PAY:') && paymentIdsUpper.has(ref.slice(4).trim())) return true;
    if (ref.startsWith('PAYMENT_') && paymentIdsUpper.has(ref.slice(8).trim())) return true;
  }

  const desc = String(tx.description || '');
  if (desc) {
    const tagMatch = desc.match(/\[PAY_ID:([^\]]+)\]/i);
    if (tagMatch && tagMatch[1] && paymentIdsUpper.has(tagMatch[1].trim().toUpperCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Prevent double-counting direct clinical treatment costs (`doctor_cost`, `lab_cost`,
 * `material_cost`, `other_cost` on `treatments`) when an accounting expense row in
 * `finance_transactions` is explicitly linked to that same performed treatment.
 */
export function isLinkedTreatmentDirectCostExpense(
  tx: FinanceTransaction & { treatment_id?: string | null },
  performedTreatmentsWithDirectCosts: Treatment[]
): boolean {
  if (tx.type !== 'expense' || performedTreatmentsWithDirectCosts.length === 0) return false;

  const treatIds = new Set<string>();
  const treatIdsUpper = new Set<string>();
  for (const t of performedTreatmentsWithDirectCosts) {
    const directCost =
      toBaseIntMoney(t.doctor_cost) +
      toBaseIntMoney(t.lab_cost) +
      toBaseIntMoney(t.material_cost) +
      toBaseIntMoney(t.other_cost);
    if (directCost > 0 && t.id) {
      treatIds.add(String(t.id).trim());
      treatIdsUpper.add(String(t.id).trim().toUpperCase());
    }
  }
  if (treatIds.size === 0) return false;

  const linkedTreatId = tx.treatment_id ? String(tx.treatment_id).trim() : '';
  if (linkedTreatId && treatIds.has(linkedTreatId)) {
    return true;
  }

  const ref = String(tx.reference || '').trim().toUpperCase();
  if (ref) {
    if (ref.startsWith('TREAT:') && treatIdsUpper.has(ref.slice(6).trim())) return true;
    if (ref.startsWith('DIRECT_COST:') && treatIdsUpper.has(ref.slice(12).trim())) return true;
  }

  const desc = String(tx.description || '');
  if (desc) {
    const tagMatch = desc.match(/\[TREAT_ID:([^\]]+)\]/i);
    if (tagMatch && tagMatch[1] && treatIdsUpper.has(tagMatch[1].trim().toUpperCase())) {
      return true;
    }
  }

  return false;
}

function isVoidedPayment(p: Payment): boolean {
  const st = String(p.status || '').toLowerCase();
  return st === 'voided' || st === 'cancelled' || Boolean(p.voided_at);
}

function isRefundedPayment(p: Payment): boolean {
  const st = String(p.status || '').toLowerCase();
  return st === 'refunded' || st === 'reversed' || Boolean(p.refunded_at);
}

export function computeDashboardMetrics(input: DashboardMetricsInput): DashboardMetrics {
  const todayIso = input.referenceDateIso || todayGregorian();
  const monthBounds = getCurrentJalaliMonthBounds(todayIso);
  const { startGregorian: monthStartIso, endGregorian: monthEndIso, monthLabel } = monthBounds;

  const validServerSummary =
    input.serverSummary &&
    input.serverSummary.tenant_id?.trim() === input.tenantId?.trim() &&
    input.serverSummary.branch_id?.trim() === input.branchId?.trim()
      ? input.serverSummary
      : null;

  const financialDataComplete = validServerSummary !== null || input.financialDataComplete !== false;

  const patients = input.patients.filter((r) =>
    matchesTenantAndBranch(r as Patient & TenantBranchScopedRecord, input.branchId, input.tenantId)
  );
  const appointments = input.appointments.filter((r) =>
    matchesTenantAndBranch(r as Appointment & TenantBranchScopedRecord, input.branchId, input.tenantId)
  );
  const treatments = input.treatments.filter((r) =>
    matchesTenantAndBranch(r as Treatment & TenantBranchScopedRecord, input.branchId, input.tenantId)
  );
  const labOrders = input.labOrders.filter((r) =>
    matchesTenantAndBranch(r as LabOrder & TenantBranchScopedRecord, input.branchId, input.tenantId)
  );
  const implants = input.implants.filter((r) =>
    matchesTenantAndBranch(r as Implant & TenantBranchScopedRecord, input.branchId, input.tenantId)
  );
  const payments = input.payments.filter((r) =>
    matchesTenantAndBranch(r as Payment & TenantBranchScopedRecord, input.branchId, input.tenantId)
  );
  const inventory = input.inventory.filter((r) =>
    matchesTenantAndBranch(r as InventoryItem & TenantBranchScopedRecord, input.branchId, input.tenantId)
  );
  const reminders = input.reminders.filter((r) =>
    matchesTenantAndBranch(r as Reminder & TenantBranchScopedRecord, input.branchId, input.tenantId)
  );
  const finance = input.finance.filter((r) =>
    matchesTenantAndBranch(r as FinanceTransaction & TenantBranchScopedRecord, input.branchId, input.tenantId)
  );
  const installments = input.installments.filter((r) =>
    matchesTenantAndBranch(r as Installment & TenantBranchScopedRecord, input.branchId, input.tenantId)
  );
  const checks = input.checks.filter((r) =>
    matchesTenantAndBranch(r as Check & TenantBranchScopedRecord, input.branchId, input.tenantId)
  );
  const safteh = input.safteh.filter((r) =>
    matchesTenantAndBranch(r as Safteh & TenantBranchScopedRecord, input.branchId, input.tenantId)
  );

  const todayAppts = appointments.filter((a) => a.appointment_date === todayIso);
  const confirmedAppts = todayAppts.filter(
    (a) => a.status === 'confirmed' || a.status === 'scheduled'
  );
  const activeTodayAppts = todayAppts.filter(
    (a) => a.status !== 'cancelled' && a.status !== 'no_show'
  );
  const activeTodaySlots = validServerSummary
    ? toBaseIntMoney(validServerSummary.active_today_slots)
    : activeTodayAppts.length;

  const plannedTreat = treatments.filter((t) => t.status === 'planned');
  const completedTreat = treatments.filter((t) => t.status === 'completed');
  const acceptedTreat = treatments.filter(
    (t) => t.status === 'in_progress' || t.status === 'completed'
  );
  const activeTreat = treatments.filter(
    (t) => t.status === 'in_progress' || t.status === 'planned'
  );
  const pendingLab = labOrders.filter((l) => l.status === 'sent' || l.status === 'in_progress');
  const activeImp = implants.filter((i) => i.stage !== 'completed' && i.stage !== 'failed');

  // Strict Solar Month (Jalali) + Asia/Tehran date bounds + Refunds/Voids handling
  const nonVoidPayments = payments.filter((p) => !isVoidedPayment(p));
  const completedPaymentsAll = nonVoidPayments.filter(
    (p) => p.status === 'completed' && !isRefundedPayment(p)
  );
  const refundedPaymentsAll = nonVoidPayments.filter((p) => isRefundedPayment(p));

  const todayGrossCollected = completedPaymentsAll
    .filter((p) => p.payment_date?.slice(0, 10) === todayIso)
    .reduce((sum, p) => sum + toBaseIntMoney(p.amount), 0);
  const todayRefunded = refundedPaymentsAll
    .filter((p) => (p.refunded_at || p.payment_date)?.slice(0, 10) === todayIso)
    .reduce((sum, p) => sum + Math.abs(toBaseIntMoney(p.amount)), 0);
  const clientTodayCollectedVal = todayGrossCollected - todayRefunded;

  const monthPayments = completedPaymentsAll.filter((p) =>
    isDateInRange(p.payment_date, monthStartIso, monthEndIso)
  );
  const monthGrossCollected = monthPayments.reduce((sum, p) => sum + toBaseIntMoney(p.amount), 0);
  const clientMonthRefundedVal = refundedPaymentsAll
    .filter((p) => isDateInRange(p.refunded_at || p.payment_date, monthStartIso, monthEndIso))
    .reduce((sum, p) => sum + Math.abs(toBaseIntMoney(p.amount)), 0);
  const clientMonthCollectedVal = monthGrossCollected - clientMonthRefundedVal;

  const monthFinance = finance.filter((f) =>
    isDateInRange(f.transaction_date, monthStartIso, monthEndIso)
  );

  // V4 P0: Accrual revenue & direct costs recognized STRICTLY on `performed_at` / `completed_at` (NEVER `created_at`)
  let clientUnverifiedCompletionDateCount = 0;
  const monthPerformedTreatments: Treatment[] = [];
  for (const t of treatments) {
    if (t.status !== 'completed') continue;
    const realizationDate = resolveTreatmentRealizationDate(t);
    if (!realizationDate) {
      clientUnverifiedCompletionDateCount += 1;
      continue;
    }
    if (isDateInRange(realizationDate, monthStartIso, monthEndIso)) {
      monthPerformedTreatments.push(t);
    }
  }

  const monthPlannedTreatments = treatments.filter(
    (t) =>
      (t.status === 'planned' || t.status === 'in_progress') &&
      isDateInRange(t.created_at, monthStartIso, monthEndIso)
  );

  const clientMonthTreatmentProductionVal = monthPerformedTreatments.reduce(
    (sum, t) => sum + Math.max(0, toBaseIntMoney(t.total_cost) - toBaseIntMoney(t.discount)),
    0
  );
  const clientMonthPlannedProductionVal = monthPlannedTreatments.reduce(
    (sum, t) => sum + Math.max(0, toBaseIntMoney(t.total_cost) - toBaseIntMoney(t.discount)),
    0
  );
  const clientMonthDirectCostsVal = monthPerformedTreatments.reduce(
    (sum, t) =>
      sum +
      toBaseIntMoney(t.doctor_cost) +
      toBaseIntMoney(t.lab_cost) +
      toBaseIntMoney(t.material_cost) +
      toBaseIntMoney(t.other_cost),
    0
  );

  const clientMonthExtraIncomeVal = monthFinance
    .filter((f) => f.type === 'income' && !isDuplicatePaymentTransaction(f, monthPayments))
    .reduce((sum, f) => sum + toBaseIntMoney(f.amount), 0);

  const clientMonthTotalCashExpenseVal = monthFinance
    .filter((f) => f.type === 'expense')
    .reduce((sum, f) => sum + toBaseIntMoney(f.amount), 0);

  const clientMonthDedupedOperatingExpenseVal = monthFinance
    .filter(
      (f) =>
        f.type === 'expense' &&
        !isLinkedTreatmentDirectCostExpense(f, monthPerformedTreatments)
    )
    .reduce((sum, f) => sum + toBaseIntMoney(f.amount), 0);

  const clientMonthCashFlowVal =
    clientMonthCollectedVal + clientMonthExtraIncomeVal - clientMonthTotalCashExpenseVal;

  const clientMonthNetProfitVal =
    clientMonthTreatmentProductionVal +
    clientMonthExtraIncomeVal -
    clientMonthDirectCostsVal -
    clientMonthDedupedOperatingExpenseVal;

  // Reconciled Receivables (A/R)
  const treatmentIdSet = new Set(
    treatments.filter((t) => t.status !== 'cancelled' && t.status !== 'planned').map((t) => t.id)
  );
  const installmentIdSet = new Set(
    installments.filter((i) => i.status === 'active' || i.status === 'overdue').map((i) => i.id)
  );

  const treatmentReceivables = treatments
    .filter((t) => t.status === 'completed' || t.status === 'in_progress')
    .reduce(
      (sum, t) =>
        sum +
        Math.max(
          0,
          Math.max(0, toBaseIntMoney(t.total_cost) - toBaseIntMoney(t.discount)) -
            toBaseIntMoney(t.paid_amount)
        ),
      0
    );

  const standaloneInstallmentReceivables = installments
    .filter(
      (i) =>
        (i.status === 'active' || i.status === 'overdue') &&
        (!i.treatment_id || !treatmentIdSet.has(i.treatment_id))
    )
    .reduce(
      (sum, i) => sum + Math.max(0, toBaseIntMoney(i.total_amount) - toBaseIntMoney(i.paid_amount)),
      0
    );

  const clientCollectionChecksPendingAmountVal = checks
    .filter((c) => c.status === 'pending' && !isGuaranteeCheck(c))
    .reduce((sum, c) => sum + toBaseIntMoney(c.amount), 0);

  const clientGuaranteeChecksPendingAmountVal = checks
    .filter((c) => c.status === 'pending' && isGuaranteeCheck(c))
    .reduce((sum, c) => sum + toBaseIntMoney(c.amount), 0);

  const standaloneCollectionChecksAmount = checks
    .filter(
      (c) =>
        c.status === 'pending' &&
        !isGuaranteeCheck(c) &&
        (!c.treatment_id || !treatmentIdSet.has(c.treatment_id)) &&
        (!c.installment_id || !installmentIdSet.has(c.installment_id))
    )
    .reduce((sum, c) => sum + toBaseIntMoney(c.amount), 0);

  const clientTotalReceivablesVal =
    treatmentReceivables + standaloneInstallmentReceivables + standaloneCollectionChecksAmount;

  // Prefer authoritative full-dataset server RPC values when present & verified
  const todayCollectedVal = validServerSummary
    ? toBaseIntMoney(validServerSummary.today_collected)
    : clientTodayCollectedVal;
  const monthCollectedVal = validServerSummary
    ? toBaseIntMoney(validServerSummary.month_collected)
    : clientMonthCollectedVal;
  const monthRefundedVal = validServerSummary
    ? toBaseIntMoney(validServerSummary.month_refunded)
    : clientMonthRefundedVal;
  const monthExtraIncomeVal = validServerSummary
    ? toBaseIntMoney(validServerSummary.month_extra_income)
    : clientMonthExtraIncomeVal;
  const monthDedupedOperatingExpenseVal = validServerSummary
    ? toBaseIntMoney(validServerSummary.month_operating_expense)
    : clientMonthDedupedOperatingExpenseVal;
  const monthDirectCostsVal = validServerSummary
    ? toBaseIntMoney(validServerSummary.month_direct_costs)
    : clientMonthDirectCostsVal;
  const monthTreatmentProductionVal = validServerSummary
    ? toBaseIntMoney(validServerSummary.month_treatment_production)
    : clientMonthTreatmentProductionVal;
  const monthPlannedProductionVal = validServerSummary
    ? toBaseIntMoney(validServerSummary.month_planned_production)
    : clientMonthPlannedProductionVal;
  const monthCashFlowVal = validServerSummary
    ? toBaseIntMoney(validServerSummary.month_cash_flow)
    : clientMonthCashFlowVal;
  const monthNetProfitVal = validServerSummary
    ? toBaseIntMoney(validServerSummary.month_net_profit)
    : clientMonthNetProfitVal;
  const collectionChecksPendingAmountVal = validServerSummary
    ? toBaseIntMoney(validServerSummary.collection_checks_pending_amount)
    : clientCollectionChecksPendingAmountVal;
  const guaranteeChecksPendingAmountVal = validServerSummary
    ? toBaseIntMoney(validServerSummary.guarantee_checks_pending_amount)
    : clientGuaranteeChecksPendingAmountVal;
  const totalReceivablesVal = validServerSummary
    ? toBaseIntMoney(validServerSummary.total_receivables)
    : clientTotalReceivablesVal;
  const unverifiedCompletionDateCount = validServerSummary
    ? toBaseIntMoney(validServerSummary.unverified_completion_date_count)
    : clientUnverifiedCompletionDateCount;

  // V4 P0: Unclamped real percentages (NEVER hide >100% collections or target overachievement)
  const monthPaidTowardsProduction = monthCollectedVal + monthExtraIncomeVal;
  const pcRatioPct =
    financialDataComplete && monthTreatmentProductionVal > 0
      ? Math.round((monthPaidTowardsProduction / monthTreatmentProductionVal) * 100)
      : null;

  const totalCasesCount = plannedTreat.length + acceptedTreat.length;
  const caseAcceptancePct =
    totalCasesCount > 0 ? Math.round((acceptedTreat.length / totalCasesCount) * 100) : null;

  const dailyRevenueTarget = parsePositiveNumberSetting(input.clinicSettings, 'daily_revenue_target');
  const monthlyRevenueTarget = parsePositiveNumberSetting(
    input.clinicSettings,
    'monthly_revenue_target'
  );
  const dailyGoalProgressPct =
    financialDataComplete && dailyRevenueTarget && dailyRevenueTarget > 0
      ? Math.round((todayCollectedVal / dailyRevenueTarget) * 100)
      : null;
  const monthlyGoalProgressPct =
    financialDataComplete && monthlyRevenueTarget && monthlyRevenueTarget > 0
      ? Math.round(((monthCollectedVal + monthExtraIncomeVal) / monthlyRevenueTarget) * 100)
      : null;

  const capacity = computeRealChairCapacity({
    units: input.units,
    staff: input.staff,
    clinicSettings: input.clinicSettings,
    activeTodaySlots,
    todayActiveAppointments: activeTodayAppts,
    referenceDateIso: todayIso,
  });

  const lowStock = inventory.filter(
    (i) => Number(i.quantity) <= Number(i.min_quantity) && Number(i.min_quantity) > 0
  );
  const pendingRem = reminders.filter((r) => r.status === 'pending');
  const overdueRem = pendingRem.filter((r) => r.reminder_date < todayIso);

  const overdueInstallments = validServerSummary
    ? toBaseIntMoney(validServerSummary.overdue_installments_count)
    : installments.filter(
        (i) =>
          (i.status === 'active' || i.status === 'overdue') &&
          i.next_due_date &&
          i.next_due_date < todayIso
      ).length;
  const overdueChecks = validServerSummary
    ? toBaseIntMoney(validServerSummary.overdue_checks_count)
    : checks.filter(
        (c) => c.status === 'pending' && !isGuaranteeCheck(c) && c.due_date < todayIso
      ).length;
  const overdueGuaranteeChecks = validServerSummary
    ? toBaseIntMoney(validServerSummary.overdue_guarantee_checks_count)
    : checks.filter(
        (c) => c.status === 'pending' && isGuaranteeCheck(c) && c.due_date < todayIso
      ).length;
  const overdueSafteh = validServerSummary
    ? toBaseIntMoney(validServerSummary.overdue_safteh_count)
    : safteh.filter((sf) => sf.status === 'pending' && sf.due_date < todayIso).length;
  const totalOverdueFinCount = overdueInstallments + overdueChecks;

  const todayApptsCount = validServerSummary
    ? toBaseIntMoney(validServerSummary.today_appointments_count)
    : todayAppts.length;
  const confirmedApptsCount = validServerSummary
    ? toBaseIntMoney(validServerSummary.confirmed_appointments_count)
    : confirmedAppts.length;
  const activeTreatCount = validServerSummary
    ? toBaseIntMoney(validServerSummary.active_treatments_count)
    : activeTreat.length;
  const plannedTreatCount = validServerSummary
    ? toBaseIntMoney(validServerSummary.planned_treatments_count)
    : plannedTreat.length;
  const completedTreatCount = validServerSummary
    ? toBaseIntMoney(validServerSummary.completed_treatments_count)
    : completedTreat.length;
  const pendingLabCount = validServerSummary
    ? toBaseIntMoney(validServerSummary.pending_lab_count)
    : pendingLab.length;
  const activeImplantCount = validServerSummary
    ? toBaseIntMoney(validServerSummary.active_implant_count)
    : activeImp.length;
  const lowStockCount = validServerSummary
    ? toBaseIntMoney(validServerSummary.low_stock_count)
    : lowStock.length;
  const pendingRemindersCount = validServerSummary
    ? toBaseIntMoney(validServerSummary.pending_reminders_count)
    : pendingRem.length;

  const patientMap = new Map<string, Patient>();
  for (const p of patients) patientMap.set(p.id, p);

  const upcomingAppts = appointments
    .filter(
      (a) =>
        (a.status === 'scheduled' || a.status === 'confirmed' || a.status === 'in_progress') &&
        a.appointment_date >= todayIso
    )
    .sort((a, b) =>
      `${a.appointment_date} ${a.appointment_time || ''}`.localeCompare(
        `${b.appointment_date} ${b.appointment_time || ''}`
      )
    );
  const nextApptRaw = upcomingAppts[0] || null;
  const nextApptPatient = nextApptRaw?.patient_id ? patientMap.get(nextApptRaw.patient_id) : undefined;
  const nextAppt = nextApptRaw
    ? {
        id: nextApptRaw.id,
        patientName: nextApptPatient
          ? `${nextApptPatient.first_name} ${nextApptPatient.last_name}`.trim()
          : nextApptRaw.title || 'بیمار مطب',
        appointmentDate: nextApptRaw.appointment_date,
        appointmentTime: (nextApptRaw.appointment_time || '09:00').slice(0, 5),
        type: nextApptRaw.type || 'ویزیت',
      }
    : null;

  const fmt = (n: number) => Number(n || 0).toLocaleString('fa-IR');

  let priorityAction: DashboardPriorityAction = {
    title: 'برنامه نوبت‌های امروز مطب',
    subtitle:
      todayApptsCount > 0
        ? `${fmt(confirmedApptsCount)} نوبت تاییدشده از ${fmt(todayApptsCount)} نوبت امروز`
        : 'نوبت فعالی برای امروز ثبت نشده است',
    cta: 'مدیریت نوبت‌ها',
    target: 'appointments',
    color: getModuleToken('appointments').primary,
    bg: '#FFFDF5',
    border: '#FDE0A6',
    urgent: false,
  };

  if (totalOverdueFinCount > 0 && canAccessRoute(input.userRole, 'finance')) {
    priorityAction = {
      title: `${fmt(totalOverdueFinCount)} چک وصولی یا قسط سررسید گذشته`,
      subtitle: `${fmt(overdueChecks)} چک صیادی و ${fmt(overdueInstallments)} قسط نیازمند پیگیری`,
      cta: 'پیگیری مالی',
      target: 'finance',
      subTab: overdueChecks > 0 ? 'checks' : 'installments',
      color: CORE_PALETTE.critical,
      bg: '#FFF1F2',
      border: '#FECDD3',
      urgent: true,
    };
  } else if (overdueRem.length > 0) {
    priorityAction = {
      title: `${fmt(overdueRem.length)} یادآوری سررسید گذشته`,
      subtitle: 'بررسی و تعیین تکلیف یادآوری‌های معوق',
      cta: 'باز کردن یادآوری‌ها',
      target: 'reminders',
      color: CORE_PALETTE.critical,
      bg: '#FFF1F2',
      border: '#FECDD3',
      urgent: true,
    };
  } else if (lowStockCount > 0 && canAccessRoute(input.userRole, 'inventory')) {
    priorityAction = {
      title: `${fmt(lowStockCount)} قلم مصرفی زیر حد نصاب`,
      subtitle: 'ثبت سفارش مجدد اقلام حیاتی انبار کلینیک',
      cta: 'بررسی انبار',
      target: 'inventory',
      color: CORE_PALETTE.warning,
      bg: '#FFFBEB',
      border: '#FDE68A',
      urgent: true,
    };
  } else if (pendingLabCount > 0 && canAccessRoute(input.userRole, 'lab')) {
    priorityAction = {
      title: `${fmt(pendingLabCount)} سفارش لابراتوار در جریان`,
      subtitle: 'پیگیری وضعیت ارسال و دریافت پروتز بیماران',
      cta: 'بخش لابراتوار',
      target: 'lab',
      color: getModuleToken('lab').primary,
      bg: '#FFF5F9',
      border: '#F7C2DA',
      urgent: false,
    };
  }

  const rules = loadSmartReminderRules();
  const liveAlerts = computeLiveSmartAlerts({
    patients,
    appointments,
    treatments,
    labOrders,
    implants,
    inventory,
    installments,
    checks,
    safteh,
    rules,
  });

  const hasSufficientData =
    validServerSummary !== null ||
    patients.length > 0 ||
    appointments.length > 0 ||
    treatments.length > 0 ||
    payments.length > 0 ||
    finance.length > 0;

  const smartBrief = buildSmartDailyBrief({
    alerts: liveAlerts,
    todayDate: todayIso,
    todayApptsCount,
    confirmedApptsCount,
    pendingLabCount,
    lowStockCount,
    userRole: input.userRole,
    hasSufficientData,
  });

  const serviceValues: Record<SectionId, number | string> = {
    dashboard: todayApptsCount,
    patients: patients.length,
    appointments: todayApptsCount,
    calendar: todayApptsCount + pendingRemindersCount,
    treatments: activeTreatCount,
    lab: pendingLabCount,
    implants: activeImplantCount,
    finance: !financialDataComplete
      ? 'ناقص'
      : totalOverdueFinCount > 0
      ? `${fmt(totalOverdueFinCount)} معوق`
      : `${fmt(todayCollectedVal)} ت`,
    inventory: lowStockCount,
    reminders: pendingRemindersCount,
    staff: activeTreatCount,
    messages: pendingRemindersCount,
    settings: 0,
  };

  return {
    todayIso,
    monthLabel,
    monthStartIso,
    monthEndIso,
    branchId: input.branchId,
    dataSourceMode: validServerSummary ? 'server_rpc' : 'client_paginated',
    hasSufficientData,
    financialDataComplete,
    unverifiedCompletionDateCount,
    todayApptsCount,
    confirmedApptsCount,
    activeTreatCount,
    plannedTreatCount,
    completedTreatCount,
    pendingLabCount,
    activeImplantCount,
    lowStockCount,
    pendingRemindersCount,
    overdueChecksCount: overdueChecks,
    overdueGuaranteeChecksCount: overdueGuaranteeChecks,
    overdueInstallmentsCount: overdueInstallments,
    overdueSaftehCount: overdueSafteh,
    totalOverdueFinCount,
    pcRatioPct,
    caseAcceptancePct,
    revenue: {
      currencyUnit: 'IRR_TOMAN',
      financialDataComplete,
      todayCollected: financialDataComplete ? todayCollectedVal : null,
      monthCollected: financialDataComplete ? monthCollectedVal : null,
      monthRefunded: financialDataComplete ? monthRefundedVal : null,
      monthExtraIncome: financialDataComplete ? monthExtraIncomeVal : null,
      monthExpense: financialDataComplete ? monthDedupedOperatingExpenseVal : null,
      monthDirectCosts: financialDataComplete ? monthDirectCostsVal : null,
      monthNetProfit: financialDataComplete ? monthNetProfitVal : null,
      monthCashFlow: financialDataComplete ? monthCashFlowVal : null,
      monthTreatmentProduction: financialDataComplete ? monthTreatmentProductionVal : null,
      monthPlannedProduction: financialDataComplete ? monthPlannedProductionVal : null,
      unverifiedCompletionDateCount,
      collectionChecksPendingAmount: financialDataComplete ? collectionChecksPendingAmountVal : null,
      guaranteeChecksPendingAmount: financialDataComplete ? guaranteeChecksPendingAmountVal : null,
      totalReceivables: financialDataComplete ? totalReceivablesVal : null,
      dailyRevenueTarget,
      monthlyRevenueTarget,
      dailyGoalProgressPct,
      monthlyGoalProgressPct,
    },
    capacity,
    nextAppt,
    priorityAction,
    serviceValues,
    smartBrief,
  };
}
