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
import type { DashboardCapacityMetrics, DashboardMetrics, DashboardPriorityAction } from './dashboard.types';

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
  tenantId?: string;
  userRole: ClinicUserRole;
  referenceDateIso?: string;
  /** Defaults to true for pure unit callers; set false when any financial source errored/unauthorized/migration_required */
  financialDataComplete?: boolean;
}

type TenantBranchScopedRecord = {
  tenant_id?: string | null;
  branch_id?: string | null;
};

/**
 * Strict tenant & branch isolation:
 * Records without an explicit matching `branch_id` are NEVER leaked across branches.
 */
export function matchesTenantAndBranch<T extends TenantBranchScopedRecord>(
  row: T,
  branchId: string,
  tenantId?: string
): boolean {
  if (tenantId && row.tenant_id && row.tenant_id !== tenantId) {
    return false;
  }
  if (!row.branch_id) {
    return false;
  }
  return row.branch_id === branchId;
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
 * Third Audit FIX 03: Date-aware chair capacity based on active units, active doctors,
 * clinic shift schedule, AND working days for `referenceDateIso`.
 * Missing any real denominator returns `null` rather than hiding gaps with guessed defaults.
 */
export function computeRealChairCapacity(params: {
  units: DentalUnit[];
  staff: Staff[];
  clinicSettings: ClinicSetting[];
  activeTodaySlots: number;
  referenceDateIso?: string;
}): DashboardCapacityMetrics {
  const { units, staff, clinicSettings, activeTodaySlots, referenceDateIso } = params;
  const activeUnits = units.filter((u) => u.status === 'active');
  const activeDoctors = staff.filter(
    (st) => st.active !== false && (st.role === 'manager' || st.role === 'dentist')
  );

  // Check if selected date is explicitly configured as a closed weekday (e.g., "5" for Friday)
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

  const slotDurationMinutes =
    parsePositiveNumberSetting(clinicSettings, 'default_appointment_duration') ?? 30;

  const shiftMinutesPerDay = parsedShiftMinutes;
  const effectiveChairs = Math.min(activeUnits.length, activeDoctors.length);

  let dailyChairCapacity: number | null = null;
  if (isClosedDay) {
    dailyChairCapacity = 0;
  } else if (effectiveChairs > 0 && shiftMinutesPerDay > 0 && slotDurationMinutes > 0) {
    dailyChairCapacity = Math.floor((effectiveChairs * shiftMinutesPerDay) / slotDurationMinutes);
  }

  const chairUtilizationPct =
    dailyChairCapacity && dailyChairCapacity > 0
      ? Math.min(100, Math.round((activeTodaySlots / dailyChairCapacity) * 100))
      : null;

  return {
    activeUnitsCount: activeUnits.length,
    activeDoctorsCount: activeDoctors.length,
    shiftMinutesPerDay,
    slotDurationMinutes,
    dailyChairCapacity,
    activeTodaySlots,
    chairUtilizationPct,
    isClosedDay,
  };
}

/**
 * Third Audit FIX 03: Deterministic foreign-key payment deduplication ONLY.
 * A `finance_transactions` income row is deduplicated ONLY when it references an ACTUAL
 * existing `Payment.id` in `completedPayments` (via `payment_id`, exact `PAY:<id>` reference,
 * or exact `[PAY_ID:<id>]` tag).
 * NEVER drops a transaction solely because `reference` starts with `PAY:` or `PAYMENT_`!
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
 * Third Audit FIX 03: Prevent double-counting direct clinical treatment costs (`doctor_cost`,
 * `lab_cost`, `material_cost`, `other_cost` on `treatments`) when an accounting expense row
 * in `finance_transactions` is explicitly linked to that same performed treatment (`treatment_id`
 * or `[TREAT_ID:<id>]` / `TREAT:<id>`).
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
      Number(t.doctor_cost || 0) +
      Number(t.lab_cost || 0) +
      Number(t.material_cost || 0) +
      Number(t.other_cost || 0);
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

export function computeDashboardMetrics(input: DashboardMetricsInput): DashboardMetrics {
  const todayIso = input.referenceDateIso || todayGregorian();
  const monthBounds = getCurrentJalaliMonthBounds(todayIso);
  const { startGregorian: monthStartIso, endGregorian: monthEndIso, monthLabel } = monthBounds;
  const financialDataComplete = input.financialDataComplete !== false;

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
  const activeTodaySlots = todayAppts.filter(
    (a) => a.status !== 'cancelled' && a.status !== 'no_show'
  ).length;

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

  // Strict Solar Month (Jalali) + Asia/Tehran date bounds
  const completedPaymentsAll = payments.filter((p) => p.status === 'completed');
  const todayCollectedVal = completedPaymentsAll
    .filter((p) => p.payment_date?.slice(0, 10) === todayIso)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const monthPayments = completedPaymentsAll.filter((p) =>
    isDateInRange(p.payment_date, monthStartIso, monthEndIso)
  );
  const monthCollectedVal = monthPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const monthFinance = finance.filter((f) =>
    isDateInRange(f.transaction_date, monthStartIso, monthEndIso)
  );

  // FIX 03: ONLY performed/completed treatments count toward realized accrual profit & production
  const monthPerformedTreatments = treatments.filter(
    (t) => t.status === 'completed' && isDateInRange(t.created_at, monthStartIso, monthEndIso)
  );
  const monthPlannedTreatments = treatments.filter(
    (t) =>
      (t.status === 'planned' || t.status === 'in_progress') &&
      isDateInRange(t.created_at, monthStartIso, monthEndIso)
  );

  const monthTreatmentProductionVal = monthPerformedTreatments.reduce(
    (sum, t) => sum + Math.max(0, Number(t.total_cost || 0) - Number(t.discount || 0)),
    0
  );
  const monthPlannedProductionVal = monthPlannedTreatments.reduce(
    (sum, t) => sum + Math.max(0, Number(t.total_cost || 0) - Number(t.discount || 0)),
    0
  );
  const monthDirectCostsVal = monthPerformedTreatments.reduce(
    (sum, t) =>
      sum +
      Number(t.doctor_cost || 0) +
      Number(t.lab_cost || 0) +
      Number(t.material_cost || 0) +
      Number(t.other_cost || 0),
    0
  );

  const monthExtraIncomeVal = monthFinance
    .filter((f) => f.type === 'income' && !isDuplicatePaymentTransaction(f, monthPayments))
    .reduce((sum, f) => sum + Number(f.amount || 0), 0);

  // Cash operating expense (all cash outflows for Cash Flow)
  const monthTotalCashExpenseVal = monthFinance
    .filter((f) => f.type === 'expense')
    .reduce((sum, f) => sum + Number(f.amount || 0), 0);

  // Operating expense deduplicated against treatment direct costs for Accrual Net Profit
  const monthDedupedOperatingExpenseVal = monthFinance
    .filter(
      (f) =>
        f.type === 'expense' &&
        !isLinkedTreatmentDirectCostExpense(f, monthPerformedTreatments)
    )
    .reduce((sum, f) => sum + Number(f.amount || 0), 0);

  // Cash flow = actual cash received minus cash outflows
  const monthCashFlowVal = monthCollectedVal + monthExtraIncomeVal - monthTotalCashExpenseVal;

  // Accrual Net Profit = Realized (Completed) Production + Extra Income - Direct Clinical Costs - Deduplicated Operating Expenses
  const monthNetProfitVal =
    monthTreatmentProductionVal +
    monthExtraIncomeVal -
    monthDirectCostsVal -
    monthDedupedOperatingExpenseVal;

  // Reconciled Receivables (A/R):
  // - Only performed/in-progress treatments have collectible balances (never planned/unaccepted quotes)
  // - Installments linked via `treatment_id` are reconciled against their parent treatment (not double-counted)
  // - Collectible checks linked via `treatment_id` or `installment_id` are not double-counted; guarantee checks stay isolated
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
          Math.max(0, Number(t.total_cost || 0) - Number(t.discount || 0)) -
            Number(t.paid_amount || 0)
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
      (sum, i) => sum + Math.max(0, Number(i.total_amount || 0) - Number(i.paid_amount || 0)),
      0
    );

  const collectionChecksPendingAmountVal = checks
    .filter((c) => c.status === 'pending' && !isGuaranteeCheck(c))
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);

  const guaranteeChecksPendingAmountVal = checks
    .filter((c) => c.status === 'pending' && isGuaranteeCheck(c))
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);

  const standaloneCollectionChecksAmount = checks
    .filter(
      (c) =>
        c.status === 'pending' &&
        !isGuaranteeCheck(c) &&
        (!c.treatment_id || !treatmentIdSet.has(c.treatment_id)) &&
        (!c.installment_id || !installmentIdSet.has(c.installment_id))
    )
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);

  const totalReceivablesVal =
    treatmentReceivables + standaloneInstallmentReceivables + standaloneCollectionChecksAmount;

  // Explicit denominators — NEVER return artificial defaults or conflate incomplete data with 0
  const monthPaidTowardsProduction = monthCollectedVal + monthExtraIncomeVal;
  const pcRatioPct =
    financialDataComplete && monthTreatmentProductionVal > 0
      ? Math.min(100, Math.round((monthPaidTowardsProduction / monthTreatmentProductionVal) * 100))
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
      ? Math.min(100, Math.round((todayCollectedVal / dailyRevenueTarget) * 100))
      : null;
  const monthlyGoalProgressPct =
    financialDataComplete && monthlyRevenueTarget && monthlyRevenueTarget > 0
      ? Math.min(100, Math.round(((monthCollectedVal + monthExtraIncomeVal) / monthlyRevenueTarget) * 100))
      : null;

  const capacity = computeRealChairCapacity({
    units: input.units,
    staff: input.staff,
    clinicSettings: input.clinicSettings,
    activeTodaySlots,
    referenceDateIso: todayIso,
  });

  const lowStock = inventory.filter(
    (i) => Number(i.quantity) <= Number(i.min_quantity) && Number(i.min_quantity) > 0
  );
  const pendingRem = reminders.filter((r) => r.status === 'pending');
  const overdueRem = pendingRem.filter((r) => r.reminder_date < todayIso);

  const overdueInstallments = installments.filter(
    (i) => (i.status === 'active' || i.status === 'overdue') && i.next_due_date && i.next_due_date < todayIso
  ).length;
  const overdueChecks = checks.filter(
    (c) => c.status === 'pending' && !isGuaranteeCheck(c) && c.due_date < todayIso
  ).length;
  const overdueGuaranteeChecks = checks.filter(
    (c) => c.status === 'pending' && isGuaranteeCheck(c) && c.due_date < todayIso
  ).length;
  const overdueSafteh = safteh.filter((sf) => sf.status === 'pending' && sf.due_date < todayIso).length;
  const totalOverdueFinCount = overdueInstallments + overdueChecks;

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
      todayAppts.length > 0
        ? `${fmt(confirmedAppts.length)} نوبت تاییدشده از ${fmt(todayAppts.length)} نوبت امروز`
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
  } else if (lowStock.length > 0 && canAccessRoute(input.userRole, 'inventory')) {
    priorityAction = {
      title: `${fmt(lowStock.length)} قلم مصرفی زیر حد نصاب`,
      subtitle: 'ثبت سفارش مجدد اقلام حیاتی انبار کلینیک',
      cta: 'بررسی انبار',
      target: 'inventory',
      color: CORE_PALETTE.warning,
      bg: '#FFFBEB',
      border: '#FDE68A',
      urgent: true,
    };
  } else if (pendingLab.length > 0 && canAccessRoute(input.userRole, 'lab')) {
    priorityAction = {
      title: `${fmt(pendingLab.length)} سفارش لابراتوار در جریان`,
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
    patients.length > 0 ||
    appointments.length > 0 ||
    treatments.length > 0 ||
    payments.length > 0 ||
    finance.length > 0;

  const smartBrief = buildSmartDailyBrief({
    alerts: liveAlerts,
    todayDate: todayIso,
    todayApptsCount: todayAppts.length,
    confirmedApptsCount: confirmedAppts.length,
    pendingLabCount: pendingLab.length,
    lowStockCount: lowStock.length,
    userRole: input.userRole,
    hasSufficientData,
  });

  const serviceValues: Record<SectionId, number | string> = {
    dashboard: todayAppts.length,
    patients: patients.length,
    appointments: todayAppts.length,
    calendar: todayAppts.length + pendingRem.length,
    treatments: activeTreat.length,
    lab: pendingLab.length,
    implants: activeImp.length,
    finance: !financialDataComplete
      ? 'ناقص'
      : totalOverdueFinCount > 0
      ? `${fmt(totalOverdueFinCount)} معوق`
      : `${fmt(todayCollectedVal)} ت`,
    inventory: lowStock.length,
    reminders: pendingRem.length,
    staff: activeTreat.length,
    messages: pendingRem.length,
    settings: 0,
  };

  return {
    todayIso,
    monthLabel,
    monthStartIso,
    monthEndIso,
    branchId: input.branchId,
    hasSufficientData,
    financialDataComplete,
    todayApptsCount: todayAppts.length,
    confirmedApptsCount: confirmedAppts.length,
    activeTreatCount: activeTreat.length,
    plannedTreatCount: plannedTreat.length,
    completedTreatCount: completedTreat.length,
    pendingLabCount: pendingLab.length,
    activeImplantCount: activeImp.length,
    lowStockCount: lowStock.length,
    pendingRemindersCount: pendingRem.length,
    overdueChecksCount: overdueChecks,
    overdueGuaranteeChecksCount: overdueGuaranteeChecks,
    overdueInstallmentsCount: overdueInstallments,
    overdueSaftehCount: overdueSafteh,
    totalOverdueFinCount,
    pcRatioPct,
    caseAcceptancePct,
    revenue: {
      financialDataComplete,
      todayCollected: financialDataComplete ? todayCollectedVal : null,
      monthCollected: financialDataComplete ? monthCollectedVal : null,
      monthExtraIncome: financialDataComplete ? monthExtraIncomeVal : null,
      monthExpense: financialDataComplete ? monthDedupedOperatingExpenseVal : null,
      monthDirectCosts: financialDataComplete ? monthDirectCostsVal : null,
      monthNetProfit: financialDataComplete ? monthNetProfitVal : null,
      monthCashFlow: financialDataComplete ? monthCashFlowVal : null,
      monthTreatmentProduction: financialDataComplete ? monthTreatmentProductionVal : null,
      monthPlannedProduction: financialDataComplete ? monthPlannedProductionVal : null,
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
