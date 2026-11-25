import type { AppRouteId } from '@/lib/navigationStack';
import type { SectionId } from '@/lib/sections';
import type { SmartDailyBriefSummary } from '@/services/intelligence/clinicIntelligence';
import type { TableDataStatus } from '@/lib/useRealtimeTable';

export type DashboardSourceKey =
  | 'patients'
  | 'appointments'
  | 'treatments'
  | 'lab_orders'
  | 'implants'
  | 'payments'
  | 'inventory'
  | 'reminders'
  | 'finance_transactions'
  | 'installments'
  | 'checks'
  | 'safteh'
  | 'clinic_settings'
  | 'staff';

/**
 * Authoritative server-side aggregation payload returned by PostgreSQL RPC
 * `public.get_clinic_dashboard_summary(...)` (SECURITY INVOKER — enforces RLS).
 * Aggregates the FULL dataset across all rows without any 500-row truncation.
 */
export interface DashboardServerSummary {
  tenant_id: string;
  branch_id: string;
  today_iso: string;
  month_start: string;
  month_end: string;
  currency_unit: 'IRR_TOMAN';
  today_collected: number;
  month_collected: number;
  month_refunded: number;
  month_extra_income: number;
  month_total_cash_expense: number;
  month_operating_expense: number;
  month_treatment_production: number;
  month_planned_production: number;
  month_direct_costs: number;
  unverified_completion_date_count: number;
  completed_treatments_count: number;
  planned_treatments_count: number;
  active_treatments_count: number;
  today_appointments_count: number;
  confirmed_appointments_count: number;
  active_today_slots: number;
  pending_lab_count: number;
  active_implant_count: number;
  low_stock_count: number;
  pending_reminders_count: number;
  collection_checks_pending_amount: number;
  guarantee_checks_pending_amount: number;
  overdue_checks_count: number;
  overdue_guarantee_checks_count: number;
  overdue_installments_count: number;
  overdue_safteh_count: number;
  treatment_receivables: number;
  standalone_installment_receivables: number;
  standalone_collection_checks_amount: number;
  total_receivables: number;
  month_cash_flow: number;
  month_net_profit: number;
}

export interface DashboardRevenueMetrics {
  /** Base integer currency unit — all monetary fields are rounded integer Tomans */
  currencyUnit: 'IRR_TOMAN';
  /** False when any required financial table is unauthorized, errored, partial/truncated, locked_offline, or missing migration */
  financialDataComplete: boolean;
  /** Nullable when financialDataComplete === false (never conflates unknown/failed data with 0) */
  todayCollected: number | null;
  monthCollected: number | null;
  /** Refunded/reversed payments inside the current Jalali month (already deducted from monthCollected) */
  monthRefunded: number | null;
  monthExtraIncome: number | null;
  /** Operating expenses deduplicated against direct treatment costs */
  monthExpense: number | null;
  /** Direct clinical costs (doctor/lab/material/other) of performed/completed treatments only */
  monthDirectCosts: number | null;
  /** Realized accrual net profit from completed treatments ONLY (based on performed_at/completed_at) */
  monthNetProfit: number | null;
  monthCashFlow: number | null;
  /** Performed/completed treatment net production only (based on performed_at/completed_at) */
  monthTreatmentProduction: number | null;
  /** Separate pipeline value of planned/unperformed treatments (never included in realized profit) */
  monthPlannedProduction: number | null;
  /** Count of completed treatments missing both performed_at and completed_at (excluded from realized accrual) */
  unverifiedCompletionDateCount: number;
  collectionChecksPendingAmount: number | null;
  guaranteeChecksPendingAmount: number | null;
  totalReceivables: number | null;
  dailyRevenueTarget: number | null;
  monthlyRevenueTarget: number | null;
  /** Real unclamped progress percentage (>100% preserved) */
  dailyGoalProgressPct: number | null;
  /** Real unclamped progress percentage (>100% preserved) */
  monthlyGoalProgressPct: number | null;
}

export interface DashboardCapacityMetrics {
  activeUnitsCount: number;
  activeDoctorsCount: number;
  shiftMinutesPerDay: number;
  /** Explicit clinic setting `default_appointment_duration` (null if unconfigured — zero guessed 30m fallback) */
  slotDurationMinutes: number | null;
  dailyChairCapacity: number | null;
  activeTodaySlots: number;
  bookedMinutesToday: number;
  /** Real unclamped utilization percentage (>100% preserved for overbooking visibility) */
  chairUtilizationPct: number | null;
  isClosedDay?: boolean;
}

export interface DashboardPriorityAction {
  title: string;
  subtitle: string;
  cta: string;
  target: AppRouteId;
  subTab?: string;
  recordId?: string;
  color: string;
  bg: string;
  border: string;
  urgent: boolean;
}

export interface DashboardNextAppointment {
  id: string;
  patientName: string;
  appointmentDate: string;
  appointmentTime: string;
  type: string;
}

export interface DashboardMetrics {
  todayIso: string;
  monthLabel: string;
  monthStartIso: string;
  monthEndIso: string;
  branchId: string;
  dataSourceMode: 'server_rpc' | 'client_paginated';
  hasSufficientData: boolean;
  financialDataComplete: boolean;
  unverifiedCompletionDateCount: number;
  todayApptsCount: number;
  confirmedApptsCount: number;
  activeTreatCount: number;
  plannedTreatCount: number;
  completedTreatCount: number;
  pendingLabCount: number;
  activeImplantCount: number;
  lowStockCount: number;
  pendingRemindersCount: number;
  overdueChecksCount: number;
  overdueGuaranteeChecksCount: number;
  overdueInstallmentsCount: number;
  overdueSaftehCount: number;
  totalOverdueFinCount: number;
  /** Real unclamped collection-to-production ratio (>100% preserved); null when production === 0 or financial data incomplete */
  pcRatioPct: number | null;
  /** Null when totalCases === 0 */
  caseAcceptancePct: number | null;
  revenue: DashboardRevenueMetrics;
  capacity: DashboardCapacityMetrics;
  nextAppt: DashboardNextAppointment | null;
  priorityAction: DashboardPriorityAction;
  serviceValues: Record<SectionId, number | string>;
  smartBrief: SmartDailyBriefSummary;
}

export interface DashboardAggregateStatus {
  overall: TableDataStatus;
  isStale: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  sourceStatuses: Record<DashboardSourceKey, TableDataStatus>;
  incompleteSources: DashboardSourceKey[];
  truncatedSources: DashboardSourceKey[];
  lockedOfflineTables: DashboardSourceKey[];
  migrationRequiredTables: DashboardSourceKey[];
  financialDataComplete: boolean;
  dataSourceMode: 'server_rpc' | 'client_paginated';
}
