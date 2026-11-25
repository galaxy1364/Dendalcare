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
  userRole: ClinicUserRole;
  referenceDateIso?: string;
}

type BranchScopedRecord = { branch_id?: string | null };

function matchesBranch<T extends BranchScopedRecord>(row: T, branchId: string): boolean {
  if (!row.branch_id) return true;
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

export function computeRealChairCapacity(params: {
  units: DentalUnit[];
  staff: Staff[];
  clinicSettings: ClinicSetting[];
  activeTodaySlots: number;
}): DashboardCapacityMetrics {
  const { units, staff, clinicSettings, activeTodaySlots } = params;
  const activeUnits = units.filter((u) => u.status === 'active');
  const activeDoctors = staff.filter(
    (st) => st.active !== false && (st.role === 'manager' || st.role === 'dentist')
  );

  const morningStr =
    clinicSettings.find((s) => s.key === 'clinic_morning_hours')?.value || '09:00 الی 13:30';
  const eveningStr =
    clinicSettings.find((s) => s.key === 'clinic_evening_hours')?.value || '16:00 الی 21:00';
  const parsedShiftMinutes =
    parseShiftRangeMinutes(morningStr) + parseShiftRangeMinutes(eveningStr);

  const slotDurationMinutes =
    parsePositiveNumberSetting(clinicSettings, 'default_appointment_duration') ?? 30;

  const shiftMinutesPerDay = parsedShiftMinutes;
  const effectiveChairs =
    activeDoctors.length > 0
      ? Math.min(activeUnits.length, activeDoctors.length)
      : activeUnits.length;

  let dailyChairCapacity: number | null = null;
  if (effectiveChairs > 0 && shiftMinutesPerDay > 0 && slotDurationMinutes > 0) {
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
  };
}

/**
 * Deduplicates finance_transactions income against payments so payments aren't double-counted.
 */
export function isDuplicatePaymentTransaction(
  tx: FinanceTransaction,
  completedPayments: Payment[]
): boolean {
  const ref = String(tx.reference || '').toUpperCase();
  const desc = String(tx.description || '');
  if (ref.startsWith('PAY:') || ref.startsWith('PAYMENT_')) return true;

  return completedPayments.some((p) => {
    if (ref && ref === p.id.toUpperCase()) return true;
    const samePatient = Boolean(p.patient_id && tx.patient_id && p.patient_id === tx.patient_id);
    const sameDate = p.payment_date?.slice(0, 10) === tx.transaction_date?.slice(0, 10);
    const sameAmount = Math.abs(Number(p.amount) - Number(tx.amount)) < 1;
    if (samePatient && sameDate && sameAmount) return true;
    if (desc && desc.includes(p.id)) return true;
    return false;
  });
}

export function computeDashboardMetrics(input: DashboardMetricsInput): DashboardMetrics {
  const todayIso = input.referenceDateIso || todayGregorian();
  const monthBounds = getCurrentJalaliMonthBounds(todayIso);
  const { startGregorian: monthStartIso, endGregorian: monthEndIso, monthLabel } = monthBounds;

  const patients = input.patients.filter((r) => matchesBranch(r as Patient & BranchScopedRecord, input.branchId));
  const appointments = input.appointments.filter((r) => matchesBranch(r as Appointment & BranchScopedRecord, input.branchId));
  const treatments = input.treatments.filter((r) => matchesBranch(r as Treatment & BranchScopedRecord, input.branchId));
  const labOrders = input.labOrders.filter((r) => matchesBranch(r as LabOrder & BranchScopedRecord, input.branchId));
  const implants = input.implants.filter((r) => matchesBranch(r as Implant & BranchScopedRecord, input.branchId));
  const payments = input.payments.filter((r) => matchesBranch(r as Payment & BranchScopedRecord, input.branchId));
  const inventory = input.inventory.filter((r) => matchesBranch(r as InventoryItem & BranchScopedRecord, input.branchId));
  const reminders = input.reminders.filter((r) => matchesBranch(r as Reminder & BranchScopedRecord, input.branchId));
  const finance = input.finance.filter((r) => matchesBranch(r as FinanceTransaction & BranchScopedRecord, input.branchId));
  const installments = input.installments.filter((r) => matchesBranch(r as Installment & BranchScopedRecord, input.branchId));
  const checks = input.checks.filter((r) => matchesBranch(r as Check & BranchScopedRecord, input.branchId));
  const safteh = input.safteh.filter((r) => matchesBranch(r as Safteh & BranchScopedRecord, input.branchId));

  const todayAppts = appointments.filter((a) => a.appointment_date === todayIso);
  const confirmedAppts = todayAppts.filter(
    (a) => a.status === 'confirmed' || a.status === 'scheduled'
  );
  const activeTodaySlots = todayAppts.filter(
    (a) => a.status !== 'cancelled' && a.status !== 'no_show'
  ).length;

  const plannedTreat = treatments.filter((t) => t.status === 'planned');
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
  const todayCollected = completedPaymentsAll
    .filter((p) => p.payment_date?.slice(0, 10) === todayIso)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const monthPayments = completedPaymentsAll.filter((p) =>
    isDateInRange(p.payment_date, monthStartIso, monthEndIso)
  );
  const monthCollected = monthPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const monthFinance = finance.filter((f) =>
    isDateInRange(f.transaction_date, monthStartIso, monthEndIso)
  );
  const monthExtraIncome = monthFinance
    .filter((f) => f.type === 'income' && !isDuplicatePaymentTransaction(f, monthPayments))
    .reduce((sum, f) => sum + Number(f.amount || 0), 0);

  const monthExpense = monthFinance
    .filter((f) => f.type === 'expense')
    .reduce((sum, f) => sum + Number(f.amount || 0), 0);

  const monthCashFlow = monthCollected + monthExtraIncome - monthExpense;
  const monthNetProfit = monthCashFlow;

  const monthTreatments = treatments.filter(
    (t) => t.status !== 'cancelled' && isDateInRange(t.created_at, monthStartIso, monthEndIso)
  );
  const monthTreatmentProduction = monthTreatments.reduce(
    (sum, t) => sum + Number(t.total_cost || 0),
    0
  );

  // Total outstanding patient receivables (treatments unpaid + active installment remainder)
  const treatmentReceivables = treatments
    .filter((t) => t.status !== 'cancelled')
    .reduce((sum, t) => sum + Math.max(0, Number(t.total_cost || 0) - Number(t.paid_amount || 0)), 0);
  const pendingChecksAmount = checks
    .filter((c) => c.status === 'pending')
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const totalReceivables = Math.max(treatmentReceivables, pendingChecksAmount);

  // Explicit denominators — NEVER return artificial defaults (no 94, 88, 75, 15M, 35M, 18%)
  const monthPaidTowardsProduction = monthCollected + monthExtraIncome;
  const pcRatioPct =
    monthTreatmentProduction > 0
      ? Math.min(100, Math.round((monthPaidTowardsProduction / monthTreatmentProduction) * 100))
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
    dailyRevenueTarget && dailyRevenueTarget > 0
      ? Math.min(100, Math.round((todayCollected / dailyRevenueTarget) * 100))
      : null;
  const monthlyGoalProgressPct =
    monthlyRevenueTarget && monthlyRevenueTarget > 0
      ? Math.min(100, Math.round(((monthCollected + monthExtraIncome) / monthlyRevenueTarget) * 100))
      : null;

  const capacity = computeRealChairCapacity({
    units: input.units,
    staff: input.staff,
    clinicSettings: input.clinicSettings,
    activeTodaySlots,
  });

  const lowStock = inventory.filter(
    (i) => Number(i.quantity) <= Number(i.min_quantity) && Number(i.min_quantity) > 0
  );
  const pendingRem = reminders.filter((r) => r.status === 'pending');
  const overdueRem = pendingRem.filter((r) => r.reminder_date < todayIso);

  const overdueInstallments = installments.filter(
    (i) => i.status === 'active' && i.next_due_date && i.next_due_date < todayIso
  ).length;
  const overdueChecks = checks.filter((c) => c.status === 'pending' && c.due_date < todayIso).length;
  const overdueSafteh = safteh.filter((sf) => sf.status === 'pending' && sf.due_date < todayIso).length;
  const totalOverdueFinCount = overdueInstallments + overdueChecks + overdueSafteh;

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
      title: `${fmt(totalOverdueFinCount)} چک یا قسط سررسید گذشته`,
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
    finance: totalOverdueFinCount > 0 ? `${fmt(totalOverdueFinCount)} معوق` : `${fmt(todayCollected)} ت`,
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
    todayApptsCount: todayAppts.length,
    confirmedApptsCount: confirmedAppts.length,
    activeTreatCount: activeTreat.length,
    plannedTreatCount: plannedTreat.length,
    pendingLabCount: pendingLab.length,
    activeImplantCount: activeImp.length,
    lowStockCount: lowStock.length,
    pendingRemindersCount: pendingRem.length,
    overdueChecksCount: overdueChecks,
    overdueInstallmentsCount: overdueInstallments,
    overdueSaftehCount: overdueSafteh,
    totalOverdueFinCount,
    pcRatioPct,
    caseAcceptancePct,
    revenue: {
      todayCollected,
      monthCollected,
      monthExtraIncome,
      monthExpense,
      monthNetProfit,
      monthCashFlow,
      monthTreatmentProduction,
      totalReceivables,
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
