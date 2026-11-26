import type { Treatment } from '@/lib/supabaseCore';
import type { AuthStatus } from '@/services/authentication/authService';
import { CURRENCY_CONTRACT } from './monetaryPrecision';

export type FinanceCommandResolution = 'confirmed' | 'queued' | 'rejected' | 'unknown';

export interface ChargeAllocationInput {
  chargeId: string;
  amount: number;
}

export interface FinanceActorContext {
  userId?: string | null;
  localRole?: string | null;
  serverVerifiedRole?: string | null;
  sessionStatus?: AuthStatus;
  tenantId?: string;
  branchId?: string;
}

export interface PostPatientPaymentInput {
  patientId: string;
  amountInput: string | number;
  paymentMethod: 'cash' | 'card' | 'transfer' | 'insurance' | 'installment';
  businessDate?: string;
  description?: string;
  providerStaffId?: string | null;
  allocations?: ChargeAllocationInput[];
  treatmentsForDeterministicAllocation?: Treatment[];
  installmentId?: string | null;
  idempotencyKey?: string;
  closedBusinessDates?: string[];
  actorContext?: FinanceActorContext;
}

export interface ReverseOrRefundInput {
  paymentId: string;
  originalAmountToman: number;
  alreadyRefundedToman?: number;
  refundAmountInput: string | number;
  businessDate?: string;
  reason: string;
  idempotencyKey?: string;
  actorContext?: FinanceActorContext;
}

export interface DayCloseInput {
  businessDate: string;
  openingBalanceInput: string | number;
  countedCashInput: string | number;
  action: 'close' | 'reopen';
  exceptionNotes?: string;
  actorContext?: FinanceActorContext;
}

export interface FinanceCommandResult<T = Record<string, unknown>> {
  resolution: FinanceCommandResolution;
  ok: boolean;
  errorCode?: string;
  messageFa: string;
  idempotentReplay?: boolean;
  data?: T;
}

export interface StoredFinanceIdempotencyRecord {
  key: string;
  commandName: string;
  actorId: string;
  payloadHash: string;
  tenantId: string;
  branchId: string;
  response: FinanceCommandResult<any>;
  recordedAt: string;
}

export interface QueuedFinanceCommandDraft {
  id: string;
  projectRef: string;
  tenantId: string;
  branchId: string;
  actorId: string;
  commandName: 'post_patient_payment_v16' | 'reconcile_day_close_v16' | 'clear_check_v16';
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export type PostPaymentSuccessData = {
  paymentId?: string;
  amountToman: number;
  allocatedAmountToman: number;
  unappliedCreditToman: number;
  allocations: ChargeAllocationInput[];
  currency: typeof CURRENCY_CONTRACT;
};
