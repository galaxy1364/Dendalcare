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

export interface DashboardRevenueMetrics {
  /** False when any required financial table is unauthorized, errored, or missing migration */
  financialDataComplete: boolean;
  /** Nullable when financialDataComplete === false (never conflates unknown/failed data with 0) */
  todayCollected: number | null;
  monthCollected: number | null;
  monthExtraIncome: number | null;
  /** Operating expenses deduplicated against direct treatment costs */
  monthExpense: number | null;
  /** Direct clinical costs (doctor/lab/material/other) of performed/completed treatments only */
  monthDirectCosts: number | null;
  /** Realized accrual net profit from completed treatments ONLY */
  monthNetProfit: number | null;
  monthCashFlow: number | null;
  /** Performed/completed treatment net production only */
  monthTreatmentProduction: number | null;
  /** Separate pipeline value of planned/unperformed treatments (never included in realized profit) */
  monthPlannedProduction: number | null;
  collectionChecksPendingAmount: number | null;
  guaranteeChecksPendingAmount: number | null;
  totalReceivables: number | null;
  dailyRevenueTarget: number | null;
  monthlyRevenueTarget: number | null;
  dailyGoalProgressPct: number | null;
  monthlyGoalProgressPct: number | null;
}

export interface DashboardCapacityMetrics {
  activeUnitsCount: number;
  activeDoctorsCount: number;
  shiftMinutesPerDay: number;
  slotDurationMinutes: number;
  dailyChairCapacity: number | null;
  activeTodaySlots: number;
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
  hasSufficientData: boolean;
  financialDataComplete: boolean;
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
  /** Null when totalProduction === 0 or financial data incomplete */
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
  migrationRequiredTables: DashboardSourceKey[];
  financialDataComplete: boolean;
}
