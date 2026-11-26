import { rawSupabase, type Check, type Safteh } from '@/lib/supabaseCore';
import { hasZeroAffectedRows } from '@/lib/supabaseGuardian';
import { todayGregorian } from '@/lib/jalali';
import { parseExactTomanAmount } from './monetaryPrecision';
import type {
  DayCloseInput,
  FinanceActorContext,
  FinanceCommandResult,
} from './financialCommandTypes';
import { resolveFinanceActor } from './financialCommandStore';
import { postPatientPaymentCommand } from './financialCommandService';

export async function clearOrBounceInstrumentCommand(
  params: {
    kind: 'check' | 'safteh';
    record: Check | Safteh;
    nextStatus: 'cleared' | 'bounced' | 'cancelled';
    actorContext?: FinanceActorContext;
  },
  client: typeof rawSupabase = rawSupabase
): Promise<FinanceCommandResult<{ status: string; createdPaymentId?: string }>> {
  const actor = resolveFinanceActor(params.actorContext);
  if (actor.role !== 'manager' && actor.role !== 'secretary') {
    return {
      resolution: 'rejected',
      ok: false,
      errorCode: 'RBAC_INSTRUMENT_FORBIDDEN',
      messageFa: 'تغییر وضعیت چک یا سفته فقط برای مدیر یا منشی مجاز است.',
    };
  }

  const table = params.kind === 'check' ? 'checks' : 'safteh';
  const updRes = await (client as any)
    .from(table)
    .update({ status: params.nextStatus })
    .eq('id', params.record.id)
    .select('id,status');

  if (updRes?.error || hasZeroAffectedRows(updRes)) {
    return {
      resolution: 'rejected',
      ok: false,
      errorCode: 'INSTRUMENT_UPDATE_FAILED',
      messageFa: 'تغییر وضعیت سند در سرور تایید نشد.',
    };
  }

  const isGuarantee =
    params.kind === 'safteh' ||
    (params.record as Check).is_guarantee === true ||
    String((params.record as Check).type || '').toLowerCase() === 'guarantee';

  if (params.nextStatus === 'cleared' && !isGuarantee && params.record.patient_id) {
    const payRes = await postPatientPaymentCommand(
      {
        patientId: params.record.patient_id,
        amountInput: params.record.amount,
        paymentMethod: 'transfer',
        description: `وصول چک صیادی #${(params.record as Check).check_number || params.record.id.slice(0, 6)}`,
        idempotencyKey: `chk_clear_${params.record.id}`,
        actorContext: params.actorContext,
      },
      client
    );
    return {
      resolution: payRes.resolution,
      ok: payRes.ok,
      messageFa: payRes.ok
        ? 'چک وصول شد و سند دریافت در خزانه ثبت گردید.'
        : payRes.messageFa,
      data: { status: params.nextStatus, createdPaymentId: payRes.data?.paymentId },
    };
  }

  return {
    resolution: 'confirmed',
    ok: true,
    messageFa: isGuarantee
      ? 'وضعیت سند ضمانت (بدون تغییر کاذب در درآمد نقدی) به‌روزرسانی شد.'
      : 'وضعیت سند با موفقیت ثبت شد.',
    data: { status: params.nextStatus },
  };
}

export async function submitDayCloseCommand(
  input: DayCloseInput,
  client: typeof rawSupabase = rawSupabase
): Promise<FinanceCommandResult<{ status: string; varianceAmountToman: number }>> {
  const actor = resolveFinanceActor(input.actorContext);
  if (actor.role !== 'manager' && actor.role !== 'secretary') {
    return {
      resolution: 'rejected',
      ok: false,
      errorCode: 'RBAC_DAYCLOSE_FORBIDDEN',
      messageFa: 'بستن صندوق روزانه فقط برای منشی یا مدیر مجاز است.',
    };
  }
  if (input.action === 'reopen' && actor.role !== 'manager') {
    return {
      resolution: 'rejected',
      ok: false,
      errorCode: 'RBAC_REOPEN_MANAGER_ONLY',
      messageFa: 'بازگشایی روز مالی بسته‌شده فقط در اختیار مدیر کلینیک است.',
    };
  }
  if (input.action === 'reopen' && (!input.exceptionNotes || !input.exceptionNotes.trim())) {
    return {
      resolution: 'rejected',
      ok: false,
      errorCode: 'REOPEN_REASON_REQUIRED',
      messageFa: 'ذکر دلیل ممیزی برای بازگشایی روز بسته‌شده الزامی است.',
    };
  }

  const opening = parseExactTomanAmount(input.openingBalanceInput, { allowZero: true });
  const counted = parseExactTomanAmount(input.countedCashInput, { allowZero: true });
  if (!opening.ok || !counted.ok) {
    return {
      resolution: 'rejected',
      ok: false,
      errorCode: 'INVALID_DAYCLOSE_AMOUNTS',
      messageFa: !opening.ok ? opening.messageFa : !counted.ok ? counted.messageFa : 'مبلغ نامعتبر',
    };
  }

  try {
    const res = await (client as any).rpc('reconcile_day_close_v16', {
      p_tenant_id: actor.tenantId,
      p_branch_id: actor.branchId,
      p_business_date: input.businessDate || todayGregorian(),
      p_opening_balance: opening.amount,
      p_counted_cash: counted.amount,
      p_action: input.action,
      p_exception_notes: input.exceptionNotes?.trim() || null,
    });

    if (res?.error) {
      return {
        resolution: 'rejected',
        ok: false,
        errorCode: 'SERVER_DAYCLOSE_REJECTED',
        messageFa: String(res.error.message || 'خطا در بستن حساب روزانه'),
      };
    }

    if (hasZeroAffectedRows(res) || !res?.data?.ok) {
      return {
        resolution: 'unknown',
        ok: false,
        errorCode: 'UNVERIFIED_DAYCLOSE',
        messageFa: 'پاسخ تایید بستن صندوق از سرور دریافت نشد.',
      };
    }

    return {
      resolution: 'confirmed',
      ok: true,
      messageFa:
        input.action === 'reopen'
          ? 'روز مالی با ثبت لاگ بازگشایی شد.'
          : 'بستن صندوق و تطبیق روزانه با موفقیت ثبت شد.',
      data: {
        status: String(res.data.status || 'closed'),
        varianceAmountToman: Number(res.data.varianceAmountToman || 0),
      },
    };
  } catch {
    return {
      resolution: 'unknown',
      ok: false,
      errorCode: 'DAYCLOSE_AMBIGUOUS',
      messageFa: 'ارتباط با سرور هنگام بستن صندوق قطع شد.',
    };
  }
}
