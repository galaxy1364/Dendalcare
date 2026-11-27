/**
 * MinaDental V16 — Authoritative Financial Command Service
 * Trace ID: TRC-MINA-V16-FINANCE-9018-Q
 */
import { rawSupabase, SUPABASE_PROJECT_REF, type Treatment } from '@/lib/supabaseCore';
import { hasZeroAffectedRows } from '@/lib/supabaseGuardian';
import { todayGregorian } from '@/lib/jalali';
import { CURRENCY_CONTRACT, parseExactTomanAmount } from './monetaryPrecision';
import type {
  ChargeAllocationInput,
  FinanceActorContext,
  FinanceCommandResult,
  PostPatientPaymentInput,
  PostPaymentSuccessData,
  QueuedFinanceCommandDraft,
  ReverseOrRefundInput,
} from './financialCommandTypes';
import {
  getQueuedFinanceDrafts,
  hashPayloadDeterministic,
  inFlightCommandLocks,
  isFinanceNetworkError,
  readIdempotencyRecord,
  resolveFinanceActor,
  saveQueuedFinanceDrafts,
  writeIdempotencyRecord,
} from './financialCommandStore';

export * from './financialCommandTypes';
export {
  getQueuedFinanceDrafts,
  resetFinanceCommandRuntimeForTest,
} from './financialCommandStore';
export {
  clearOrBounceInstrumentCommand,
  submitDayCloseCommand,
} from './financialDayCloseAndInstruments';

export function computeDeterministicTreatmentAllocations(
  amountToman: number,
  treatments: Treatment[]
): { allocations: ChargeAllocationInput[]; unappliedCreditToman: number } {
  const sorted = [...treatments]
    .filter((t) => t.status !== 'cancelled' && t.status !== 'planned')
    .sort((a, b) => a.id.localeCompare(b.id));

  let remaining = amountToman;
  const allocations: ChargeAllocationInput[] = [];
  for (const t of sorted) {
    if (remaining <= 0) break;
    const netCost = Math.max(0, Math.round(Number(t.total_cost || 0) - Number(t.discount || 0)));
    const alreadyPaid = Math.max(0, Math.round(Number(t.paid_amount || 0)));
    const open = Math.max(0, netCost - alreadyPaid);
    if (open <= 0) continue;
    const apply = Math.min(open, remaining);
    allocations.push({ chargeId: t.id, amount: apply });
    remaining -= apply;
  }

  return { allocations, unappliedCreditToman: remaining };
}

function sameQueuedPaymentScope(draft: QueuedFinanceCommandDraft, scope: { tenantId: string; branchId: string; idempotencyKey: string }): boolean {
  return draft.projectRef === SUPABASE_PROJECT_REF &&
    draft.tenantId === scope.tenantId && draft.branchId === scope.branchId &&
    draft.commandName === 'post_patient_payment_v16' && draft.idempotencyKey === scope.idempotencyKey;
}

function queuePaymentDraft(params: {
  tenantId: string;
  branchId: string;
  actorId: string;
  idempotencyKey: string;
  patientId: string;
  amountToman: number;
  paymentMethod: string;
  businessDate: string;
  allocations: ChargeAllocationInput[];
  replaySafe: boolean;
}) {
  const drafts = getQueuedFinanceDrafts();
  if (drafts.some(d => sameQueuedPaymentScope(d, params))) return;
  drafts.push({
    id: `fin_draft_${Date.now()}`,
    projectRef: SUPABASE_PROJECT_REF,
    tenantId: params.tenantId,
    branchId: params.branchId,
    actorId: params.actorId,
    commandName: 'post_patient_payment_v16',
    idempotencyKey: params.idempotencyKey,
    payload: {
      patientId: params.patientId,
      amountToman: params.amountToman,
      paymentMethod: params.paymentMethod,
      businessDate: params.businessDate,
      allocations: params.allocations,
      replaySafe: params.replaySafe,
    },
    createdAt: new Date().toISOString(),
  });
  saveQueuedFinanceDrafts(drafts);
}

/**
 * Atomic patient payment collection command.
 */
export async function postPatientPaymentCommand(
  input: PostPatientPaymentInput,
  client: typeof rawSupabase = rawSupabase
): Promise<FinanceCommandResult<PostPaymentSuccessData>> {
  const actor = resolveFinanceActor(input.actorContext);
  if (actor.role !== 'manager' && actor.role !== 'secretary') {
    return {
      resolution: 'rejected',
      ok: false,
      errorCode: 'RBAC_PAYMENT_FORBIDDEN',
      messageFa: 'فقط مدیر کلینیک یا منشی مجاز به ثبت دریافت وجه است.',
    };
  }

  if (!input.patientId || !input.patientId.trim()) {
    return {
      resolution: 'rejected',
      ok: false,
      errorCode: 'PATIENT_REQUIRED',
      messageFa: 'انتخاب بیمار برای ثبت دریافت وجه الزامی است.',
    };
  }

  const parsedAmount = parseExactTomanAmount(input.amountInput, { allowZero: false });
  if (!parsedAmount.ok) {
    return {
      resolution: 'rejected',
      ok: false,
      errorCode: parsedAmount.errorCode,
      messageFa: parsedAmount.messageFa,
    };
  }

  const businessDate = input.businessDate || todayGregorian();
  if (input.closedBusinessDates?.includes(businessDate)) {
    return {
      resolution: 'rejected',
      ok: false,
      errorCode: 'PERIOD_CLOSED',
      messageFa: 'روز مالی انتخاب‌شده بسته شده است؛ ثبت تراکنش بدون بازگشایی مجاز نیست.',
    };
  }

  const allocations =
    input.allocations ??
    computeDeterministicTreatmentAllocations(
      parsedAmount.amount,
      input.treatmentsForDeterministicAllocation || []
    ).allocations;

  const allocTotal = allocations.reduce((s, a) => s + a.amount, 0);
  if (allocTotal > parsedAmount.amount) {
    return {
      resolution: 'rejected',
      ok: false,
      errorCode: 'OVER_ALLOCATION',
      messageFa: 'مجموع تخصیص‌ها نمی‌تواند از مبلغ پرداخت بیشتر باشد.',
    };
  }

  const idempotencyKey =
    input.idempotencyKey?.trim() ||
    `pay_${actor.tenantId}_${actor.branchId}_${input.patientId}_${parsedAmount.amount}_${businessDate}_${Date.now()}`;

  const scopedKey = `${actor.tenantId}:${actor.branchId}:post_patient_payment_v16:${idempotencyKey}`;
  const payloadHash = hashPayloadDeterministic({
    patientId: input.patientId,
    amount: parsedAmount.amount,
    paymentMethod: input.paymentMethod,
    businessDate,
    allocations,
  });

  if (inFlightCommandLocks.has(scopedKey)) {
    return {
      resolution: 'rejected',
      ok: false,
      errorCode: 'CONCURRENT_IN_FLIGHT_DUPLICATE',
      messageFa: 'درخواست پرداخت با این شناسه در حال پردازش است؛ از ارسال تکراری جلوگیری شد.',
    };
  }

  const existing = readIdempotencyRecord(scopedKey);
  if (existing) {
    if (existing.actorId !== actor.actorId) {
      return {
        resolution: 'rejected',
        ok: false,
        errorCode: 'IDEMPOTENCY_ACTOR_MISMATCH',
        messageFa: 'کلید یکتای تراکنش متعلق به کاربر دیگری است.',
      };
    }
    if (existing.payloadHash !== payloadHash) {
      return {
        resolution: 'rejected',
        ok: false,
        errorCode: 'IDEMPOTENCY_PAYLOAD_CONFLICT',
        messageFa: 'کلید یکتای تراکنش با مبلغ یا جزئیات متفاوت تکرار شده است.',
      };
    }
    return { ...existing.response, idempotentReplay: true };
  }

  const replaySafe = !input.description && !input.providerStaffId && !input.installmentId && input.paymentMethod !== 'installment';
  const pending = getQueuedFinanceDrafts().find(d => sameQueuedPaymentScope(d, { ...actor, idempotencyKey }));
  if (pending) {
    const expectedPayload = { patientId: input.patientId, amountToman: parsedAmount.amount, paymentMethod: input.paymentMethod, businessDate, allocations, replaySafe };
    if (pending.actorId !== actor.actorId || !replaySafe || pending.payload.replaySafe !== true || JSON.stringify(pending.payload) !== JSON.stringify(expectedPayload)) {
      return {
        resolution: 'unknown', ok: false, errorCode: 'PENDING_PAYMENT_RECONCILIATION_REQUIRED',
        messageFa: 'درخواست قبلی نیازمند تطبیق حساب است؛ پیش از ارسال مجدد، وضعیت وصول را بررسی کنید.',
      };
    }
  }
  inFlightCommandLocks.add(scopedKey);
  const unappliedCreditToman = parsedAmount.amount - allocTotal;

  try {
    const descWithInstallment = input.installmentId
      ? `${input.description || 'پرداخت قسط'} [installment:${input.installmentId}]`.trim()
      : input.description || null;
    const rpcRes = await (client as any).rpc('post_patient_payment_v16', {
      p_tenant_id: actor.tenantId,
      p_branch_id: actor.branchId,
      p_patient_id: input.patientId,
      p_amount_toman: parsedAmount.amount,
      p_payment_method: input.paymentMethod,
      p_business_date: businessDate,
      p_description: descWithInstallment,
      p_allocations: allocations,
      p_idempotency_key: idempotencyKey,
      p_provider_staff_id: input.providerStaffId || null,
      p_expected_charge_versions: {},
    });

    if (rpcRes?.error) {
      if (isFinanceNetworkError(rpcRes.error)) {
        queuePaymentDraft({
          tenantId: actor.tenantId,
          branchId: actor.branchId,
          actorId: actor.actorId,
          idempotencyKey,
          patientId: input.patientId,
          amountToman: parsedAmount.amount,
          paymentMethod: input.paymentMethod,
          businessDate,
          allocations,
          replaySafe,
        });
        return {
          resolution: 'queued',
          ok: false,
          errorCode: 'OFFLINE_QUEUED_UNCONFIRMED',
          messageFa: 'اتصال اینترنت برقرار نیست؛ پیش‌نویس پرداخت در صف آفلاین ذخیره شد و تا همگام‌سازی جزء وصول تاییدشده نیست.',
          data: {
            amountToman: parsedAmount.amount,
            allocatedAmountToman: allocTotal,
            unappliedCreditToman,
            allocations,
            currency: CURRENCY_CONTRACT,
          },
        };
      }

      const msg = String(rpcRes.error.message || '');
      return {
        resolution: 'rejected',
        ok: false,
        errorCode: msg.includes('MINA_FIN_') ? msg.split(':')[0] : 'SERVER_RPC_REJECTED',
        messageFa: msg || 'ثبت پرداخت توسط سرور رد شد.',
      };
    }

    if (hasZeroAffectedRows(rpcRes) || !rpcRes?.data?.ok) {
      return {
        resolution: 'unknown',
        ok: false,
        errorCode: 'UNVERIFIED_SERVER_RESPONSE',
        messageFa: 'پاسخ قطعی تایید تراکنش از سرور دریافت نشد؛ پیش از ثبت مجدد وضعیت حساب را بررسی کنید.',
      };
    }

    const success: FinanceCommandResult<PostPaymentSuccessData> = {
      resolution: 'confirmed',
      ok: true,
      idempotentReplay: Boolean(rpcRes.data.idempotentReplay),
      messageFa: 'دریافت وجه با موفقیت در دفتر کل، رسید بیمار و خزانه کلینیک ثبت شد.',
      data: {
        paymentId: rpcRes.data.paymentId,
        amountToman: parsedAmount.amount,
        allocatedAmountToman: Number(rpcRes.data.allocatedAmountToman ?? allocTotal),
        unappliedCreditToman: Number(rpcRes.data.unappliedCreditToman ?? unappliedCreditToman),
        allocations,
        currency: CURRENCY_CONTRACT,
      },
    };

    writeIdempotencyRecord(scopedKey, {
      key: idempotencyKey,
      commandName: 'post_patient_payment_v16',
      actorId: actor.actorId,
      payloadHash,
      tenantId: actor.tenantId,
      branchId: actor.branchId,
      response: success,
      recordedAt: new Date().toISOString(),
    });

    return success;
  } catch (err) {
    if (isFinanceNetworkError(err)) {
      queuePaymentDraft({
        tenantId: actor.tenantId,
        branchId: actor.branchId,
        actorId: actor.actorId,
        idempotencyKey,
        patientId: input.patientId,
        amountToman: parsedAmount.amount,
        paymentMethod: input.paymentMethod,
        businessDate,
        allocations,
        replaySafe,
      });
      return {
        resolution: 'queued',
        ok: false,
        errorCode: 'OFFLINE_QUEUED_UNCONFIRMED',
        messageFa: 'دستگاه آفلاین است؛ پیش‌نویس در صف همگام‌سازی ذخیره شد (تایید نشده).',
      };
    }
    return {
      resolution: 'unknown',
      ok: false,
      errorCode: 'NETWORK_AMBIGUOUS',
      messageFa: 'وضعیت تایید تراکنش نامشخص است؛ لطفاً لیست پرداخت‌ها را بررسی کنید.',
    };
  } finally {
    inFlightCommandLocks.delete(scopedKey);
  }
}

/**
 * Manager-only refund / reversal without editing or erasing historical posted entries.
 */
export async function reverseOrRefundPaymentCommand(
  input: ReverseOrRefundInput,
  client: typeof rawSupabase = rawSupabase
): Promise<FinanceCommandResult<{ refundPaymentId?: string; refundAmountToman: number }>> {
  const actor = resolveFinanceActor(input.actorContext);
  if (actor.role !== 'manager') {
    return {
      resolution: 'rejected',
      ok: false,
      errorCode: 'RBAC_REFUND_MANAGER_ONLY',
      messageFa: 'ثبت استرداد یا برگشت سند مالی فقط با دسترسی مدیر کلینیک مجاز است.',
    };
  }

  if (!input.reason || !input.reason.trim()) {
    return {
      resolution: 'rejected',
      ok: false,
      errorCode: 'REASON_REQUIRED',
      messageFa: 'ثبت دلیل استرداد یا اصلاح سند الزامی است.',
    };
  }

  const parsed = parseExactTomanAmount(input.refundAmountInput, { allowZero: false });
  if (!parsed.ok) {
    return { resolution: 'rejected', ok: false, errorCode: parsed.errorCode, messageFa: parsed.messageFa };
  }

  const alreadyRefunded = Math.max(0, Math.round(input.alreadyRefundedToman || 0));
  const available = Math.max(0, Math.round(input.originalAmountToman) - alreadyRefunded);
  if (parsed.amount > available) {
    return {
      resolution: 'rejected',
      ok: false,
      errorCode: 'REFUND_EXCEEDS_PAYMENT',
      messageFa: 'مبلغ استرداد نمی‌تواند از مانده قابل استرداد رسید اصلی بیشتر باشد.',
    };
  }

  const idempotencyKey =
    input.idempotencyKey?.trim() || `ref_${actor.tenantId}_${actor.branchId}_${input.paymentId}_${Date.now()}`;

  try {
    const res = await (client as any).rpc('reverse_or_refund_payment_v16', {
      p_tenant_id: actor.tenantId,
      p_branch_id: actor.branchId,
      p_payment_id: input.paymentId,
      p_refund_amount_toman: parsed.amount,
      p_business_date: input.businessDate || todayGregorian(),
      p_reason: input.reason.trim(),
      p_idempotency_key: idempotencyKey,
    });

    if (res?.error) {
      return {
        resolution: 'rejected',
        ok: false,
        errorCode: 'SERVER_REFUND_REJECTED',
        messageFa: String(res.error.message || 'خطا در ثبت سند برگشت/استرداد'),
      };
    }

    if (hasZeroAffectedRows(res) || !res?.data?.ok) {
      return {
        resolution: 'unknown',
        ok: false,
        errorCode: 'UNVERIFIED_REFUND_RESPONSE',
        messageFa: 'پاسخ تایید استرداد از سرور دریافت نشد.',
      };
    }

    return {
      resolution: 'confirmed',
      ok: true,
      messageFa: 'سند استرداد/برگشت وجه با حفظ تاریخچه اصلی با موفقیت ثبت شد.',
      data: {
        refundPaymentId: res.data.refundPaymentId,
        refundAmountToman: parsed.amount,
      },
    };
  } catch {
    return {
      resolution: 'unknown',
      ok: false,
      errorCode: 'REFUND_AMBIGUOUS',
      messageFa: 'پاسخ سرور برای استرداد نامشخص بود.',
    };
  }
}

export async function replayQueuedFinanceCommands(
  actorContext?: FinanceActorContext,
  client: typeof rawSupabase = rawSupabase
): Promise<{ replayed: number; blocked: number; remaining: number; errorCode?: string }> {
  const actor = resolveFinanceActor(actorContext);
  const drafts = getQueuedFinanceDrafts();
  if (drafts.length === 0) return { replayed: 0, blocked: 0, remaining: 0 };

  if (actor.sessionStatus === 'unauthorized' || actor.role === 'unauthorized') {
    return {
      replayed: 0,
      blocked: drafts.length,
      remaining: drafts.length,
      errorCode: 'UNAUTHORIZED_MEMBERSHIP_REPLAY_BLOCKED',
    };
  }

  let replayed = 0;
  let blocked = 0;
  for (const d of drafts) {
    if (d.projectRef !== SUPABASE_PROJECT_REF || d.tenantId !== actor.tenantId || d.branchId !== actor.branchId || d.actorId !== actor.actorId) {
      blocked += 1;
      continue;
    }
    if (d.commandName === 'post_patient_payment_v16') {
      // Legacy drafts lack replay provenance. Installment schedule and payment
      // are not atomic; do not replay a receipt alone.
      if (d.payload.replaySafe !== true || d.payload.paymentMethod === 'installment') {
        blocked += 1;
        continue;
      }
      const r = await postPatientPaymentCommand(
        {
          patientId: String(d.payload.patientId || ''),
          amountInput: Number(d.payload.amountToman || 0),
          paymentMethod: (d.payload.paymentMethod as any) || 'cash',
          businessDate: String(d.payload.businessDate || todayGregorian()),
          allocations: Array.isArray(d.payload.allocations) ? (d.payload.allocations as ChargeAllocationInput[]) : [],
          idempotencyKey: d.idempotencyKey,
          actorContext,
        },
        client
      );
      if (r.resolution === 'confirmed' && r.ok) {
        replayed += 1;
        saveQueuedFinanceDrafts(getQueuedFinanceDrafts().filter(current =>
          !(sameQueuedPaymentScope(current, d) && current.actorId === d.actorId &&
            JSON.stringify(current.payload) === JSON.stringify(d.payload))
        ));
      }
    }
  }

  return { replayed, blocked, remaining: getQueuedFinanceDrafts().length };
}
