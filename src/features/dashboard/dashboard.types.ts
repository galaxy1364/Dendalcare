import type { AppRouteId } from '@/lib/navigationStack';
import type { SectionId } from '@/lib/sections';
import type { SmartDailyBriefSummary } from '@/services/intelligence/clinicIntelligence';
import type { TableDataStatus } from '@/lib/useRealtimeTable';

export interface DashboardRevenueMetrics {
  todayCollected: number;
  monthCollected: number;
  monthExtraIncome: number;
  monthExpense: number;
  monthNetProfit: number;
  monthCashFlow: number;
  monthTreatmentProduction: number;
  totalReceivables: number;
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
  todayApptsCount: number;
  confirmedApptsCount: number;
  activeTreatCount: number;
  plannedTreatCount: number;
  pendingLabCount: number;
  activeImplantCount: number;
  lowStockCount: number;
  pendingRemindersCount: number;
  overdueChecksCount: number;
  overdueInstallmentsCount: number;
  overdueSaftehCount: number;
  totalOverdueFinCount: number;
  /** Null when totalProduction === 0 (never conflates missing denominator with 0% or fake 94%) */
  pcRatioPct: number | null;
  /** Null when totalCases === 0 (never fakes 88%) */
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
}
