import type {
  Check,
  Installment,
  Patient,
  Payment,
  Safteh,
  Treatment,
} from '@/lib/supabaseCore';
import { CURRENCY_CONTRACT } from './monetaryPrecision';

export interface ServiceChargeRecord {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  patient_id: string;
  treatment_id?: string | null;
  provider_staff_id?: string | null;
  procedure_title: string;
  fdi_teeth?: string | null;
  charge_status: 'estimate' | 'draft' | 'posted' | 'reversed';
  gross_amount: number;
  discount_amount?: number;
  approved_adjustment?: number;
  net_amount?: number;
  allocated_paid_amount?: number;
  performed_at?: string | null;
  due_date?: string | null;
}

export interface PaymentAllocationRecord {
  id: string;
  tenant_id?: string | null;
  branch_id?: string | null;
  patient_id: string;
  payment_id: string;
  charge_id: string;
  provider_staff_id?: string | null;
  amount: number;
  allocation_kind: 'payment' | 'credit_apply' | 'reversal';
}

export interface PatientFinancialLedger {
  patient: Patient;
  treatments: Treatment[];
  acceptedTreatments: Treatment[];
  plannedTreatments: Treatment[];
  postedCharges: ServiceChargeRecord[];
  payments: Payment[];
  refunds: Payment[];
  installments: Installment[];
  collectibleChecks: Check[];
  guaranteeChecks: Check[];
  safteh: Safteh[];
  postedChargesTotal: number;
  plannedTreatmentValue: number;
  grossCompletedPayments: number;
  refundedTotal: number;
  netPaidTotal: number;
  allocatedPaidTotal: number;
  unappliedCredit: number;
  totalRemainingDebt: number;
  installmentRemaining: number;
  collectiblePendingChecksAmount: number;
  guaranteeChecksAmount: number;
  bouncedChecksAmount: number;
  pendingSaftehAmount: number;
  uncoveredDebt: number;
  overdueInstallments: Installment[];
  upcomingInstallments: Installment[];
  overdueChecks: Check[];
  upcomingChecks: Check[];
  hasAnyFinancialObligation: boolean;
  isOverdue: boolean;
  isUpcoming: boolean;
  nearestDueDate: string | null;
  maxOverdueDays: number;
  unverifiedCompletionDatesCount: number;
}

export interface ReceivablesAgingBucketSummary {
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  over_90: number;
  unscheduledDueDateAmount: number;
}

export interface ClinicReceivablesSummary {
  currency: typeof CURRENCY_CONTRACT;
  totalReceivables: number;
  totalUncovered: number;
  totalCollectibleChecksInHand: number;
  totalGuaranteeChecksHeld: number;
  totalBouncedChecks: number;
  totalInstallmentsActive: number;
  totalUnappliedCredit: number;
  totalPlannedEstimatesExcluded: number;
  overduePatientsCount: number;
  totalDebtorsCount: number;
  aging: ReceivablesAgingBucketSummary;
}

export interface KpiProvenanceMetadata {
  currency: typeof CURRENCY_CONTRACT;
  windowStart: string;
  windowEnd: string;
  basis: 'cash_collected' | 'accrual_performed_date' | 'reconciled_ledger';
  dataCompleteness: 'complete' | 'partial_or_truncated';
  snapshotTimestamp: string;
  isProvisional: boolean;
}

export interface ClinicCashAndOperatingMetrics {
  currency: typeof CURRENCY_CONTRACT;
  grossCollections: number;
  periodRefunds: number;
  netCollections: number;
  extraNonPatientIncome: number;
  internalTransfersTotal: number;
  cashExpensesTotal: number;
  dedupedOperatingExpenses: number;
  netCashFlow: number;
  netClinicalProduction: number;
  directClinicalCosts: number;
  operatingResult: number;
  unverifiedCompletionDateCount: number;
  provenance: KpiProvenanceMetadata;
}

export interface AccountsReceivablePriorityItem {
  patientId: string;
  patientName: string;
  score: number;
  overdueDays: number;
  bouncedChecksCount: number;
  uncoveredDebt: number;
  totalRemainingDebt: number;
  nearestDueDate: string | null;
  reasonsFa: string[];
  urgentCareProtected: true;
}

export interface FinancialAnomalyItem {
  id: string;
  ruleCode:
    | 'DUPLICATE_RECEIPT_CANDIDATE'
    | 'UNLINKED_PATIENT_PAYMENT_TX'
    | 'REFUND_EXCEEDS_PAYMENT'
    | 'STALE_PENDING_CHECK'
    | 'NEGATIVE_TREATMENT_BALANCE'
    | 'MISSING_PERFORMED_DATE';
  severity: 'high' | 'medium' | 'low';
  entityType: 'payment' | 'finance_transaction' | 'check' | 'treatment';
  entityId: string;
  titleFa: string;
  explanationFa: string;
  amountToman: number;
}

export interface DailyCloseReconciliationSummary {
  businessDate: string;
  openingBalance: number;
  expectedCash: number;
  expectedCard: number;
  expectedTransfer: number;
  expectedRefunds: number;
  expectedDrawerCash: number;
  countedCash: number;
  varianceAmount: number;
  hasVariance: boolean;
  unmatchedCount: number;
  canCloseSilently: boolean;
  requiresVarianceExplanation: boolean;
  currency: typeof CURRENCY_CONTRACT;
}

export interface FinanceReminderPayload {
  sourceKey: string;
  patientId: string;
  category: 'payment';
  reminderDate: string;
  reminderTime: string;
  priority: 'urgent' | 'high' | 'medium';
  /** Lock-screen & notification preview must never expose clinical diagnosis or exact patient debt PHI */
  lockScreenSafeTitle: string;
  /** Internal authenticated chart description */
  authenticatedDetail: string;
}
