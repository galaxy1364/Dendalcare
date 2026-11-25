import { supabase, type Appointment } from '@/lib/supabase';
import { getMutationOutcome, type MutationOutcome } from '@/lib/supabaseGuardian';
import { ACTIVE_TENANT_ID, getActiveBranchId, getActiveTenantId } from '@/services/authentication/authService';
import { canPerformAction } from '@/services/permissions/accessControl';
import {
  APPOINTMENT_STATUS,
  findSmartConflicts,
  minutesToTime,
  timeToMinutes,
} from '@/lib/appointments';

export type AppointmentCanonicalStatus =
  | 'scheduled'
  | 'confirmed'
  | 'arrived'
  | 'waiting'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'no_show';

export const APPOINTMENT_LEGAL_TRANSITIONS: Record<
  AppointmentCanonicalStatus,
  readonly AppointmentCanonicalStatus[]
> = {
  scheduled: ['confirmed', 'arrived', 'cancelled', 'no_show'],
  confirmed: ['arrived', 'waiting', 'in_progress', 'cancelled', 'no_show'],
  arrived: ['waiting', 'in_progress', 'cancelled', 'no_show'],
  waiting: ['in_progress', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export interface AppointmentDraftInput {
  id?: string | null;
  patient_id?: string | null;
  staff_id?: string | null;
  title?: string | null;
  appointment_date: string;
  appointment_time: string;
  duration_min: number | string;
  type: string;
  status?: string | null;
  notes?: string | null;
  room?: string | null;
  tenant_id?: string | null;
  branch_id?: string | null;
  bufferMin?: number;
  allowMissingPatient?: boolean;
  skipConflictCheck?: boolean;
  clientRequestId?: string | null;
}

export interface NormalizedAppointmentPayload {
  patient_id: string | null;
  staff_id?: string | null;
  title?: string | null;
  appointment_date: string;
  appointment_time: string;
  duration_min: number;
  type: string;
  status: AppointmentCanonicalStatus;
  notes: string | null;
  room: string | null;
  tenant_id: string;
  branch_id: string;
}

export interface AppointmentValidationResult {
  valid: boolean;
  error?: string;
  payload?: NormalizedAppointmentPayload;
  computedWindow?: {
    startTime: string;
    endTime: string;
    timezone: string;
  };
}

export interface AppointmentCommandOutcome {
  ok: boolean;
  outcome: MutationOutcome;
  errorMessage?: string;
  data?: unknown;
}

const VALID_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const RECENT_REQUEST_IDS = new Map<string, number>();
const IDEMPOTENCY_WINDOW_MS = 4000;

export function canTransitionAppointmentStatus(
  fromStatus: string | null | undefined,
  toStatus: string | null | undefined
): boolean {
  if (!fromStatus || !toStatus) return false;
  if (!(fromStatus in APPOINTMENT_LEGAL_TRANSITIONS)) return false;
  if (!(toStatus in APPOINTMENT_LEGAL_TRANSITIONS)) return false;
  if (fromStatus === toStatus) return false;
  return APPOINTMENT_LEGAL_TRANSITIONS[fromStatus as AppointmentCanonicalStatus].includes(
    toStatus as AppointmentCanonicalStatus
  );
}

/**
 * Shared client-side domain validator unifying full-screen operational forms,
 * Appointments manager modal, Calendar quick-add, and Caller-ID booking.
 * Never coerces NaN/invalid/fractional durations silently.
 */
export function validateAppointmentDraft(
  input: AppointmentDraftInput,
  existingAppointments: Appointment[] = []
): AppointmentValidationResult {
  if (!VALID_DATE_REGEX.test(String(input.appointment_date || '').trim())) {
    return { valid: false, error: 'تاریخ نوبت معتبر نیست (قالب YYYY-MM-DD الزامی است).' };
  }

  const normalizedTime = String(input.appointment_time || '').trim().slice(0, 5);
  if (!VALID_TIME_REGEX.test(normalizedTime)) {
    return { valid: false, error: 'ساعت شروع نوبت معتبر نیست.' };
  }

  const parsedDuration =
    typeof input.duration_min === 'number'
      ? input.duration_min
      : Number(String(input.duration_min ?? '').trim());
  if (!Number.isInteger(parsedDuration) || parsedDuration < 5 || parsedDuration > 480) {
    return {
      valid: false,
      error: 'مدت نوبت باید یک عدد صحیح بین ۵ تا ۴۸۰ دقیقه باشد.',
    };
  }

  if (!input.allowMissingPatient && !String(input.patient_id || '').trim()) {
    return { valid: false, error: 'انتخاب بیمار برای ثبت نوبت الزامی است.' };
  }

  const requestedStatus = String(input.status || 'scheduled').trim();
  if (!(requestedStatus in APPOINTMENT_STATUS)) {
    return { valid: false, error: 'وضعیت نوبت معتبر نیست.' };
  }

  if (!String(input.type || '').trim()) {
    return { valid: false, error: 'نوع خدمت یا علت مراجعه الزامی است.' };
  }

  const normalizedRoom = input.room ? String(input.room).trim() || null : null;
  if (!input.skipConflictCheck && existingAppointments.length > 0) {
    const conflicts = findSmartConflicts(
      existingAppointments,
      input.appointment_date,
      normalizedTime,
      parsedDuration,
      input.id ?? null,
      {
        room: normalizedRoom,
        staffId: input.staff_id ?? null,
        patientId: input.patient_id ?? null,
        bufferMin: input.bufferMin ?? 0,
      }
    );
    if (conflicts.length > 0) {
      return {
        valid: false,
        error: conflicts[0].reasonLabel || 'تداخل زمانی با نوبت دیگری در همین بازه وجود دارد.',
      };
    }
  }

  const tenantId = String(input.tenant_id || getActiveTenantId() || ACTIVE_TENANT_ID).trim();
  const branchId = String(input.branch_id || getActiveBranchId()).trim();
  if (!tenantId || !branchId) {
    return { valid: false, error: 'شناسه کلینیک یا شعبه فعال نامعتبر است.' };
  }

  const payload: NormalizedAppointmentPayload = {
    patient_id: input.patient_id ? String(input.patient_id).trim() : null,
    ...(input.staff_id !== undefined ? { staff_id: input.staff_id || null } : {}),
    ...(input.title ? { title: String(input.title).trim() } : {}),
    appointment_date: input.appointment_date.trim(),
    appointment_time: normalizedTime,
    duration_min: parsedDuration,
    type: String(input.type).trim(),
    status: requestedStatus as AppointmentCanonicalStatus,
    notes: input.notes ? String(input.notes).trim() || null : null,
    room: normalizedRoom,
    tenant_id: tenantId,
    branch_id: branchId,
  };

  return {
    valid: true,
    payload,
    computedWindow: {
      startTime: normalizedTime,
      endTime: minutesToTime(timeToMinutes(normalizedTime) + parsedDuration),
      timezone: 'Asia/Tehran',
    },
  };
}

function claimIdempotencyKey(key: string | null | undefined): boolean {
  if (!key) return true;
  const now = Date.now();
  for (const [k, ts] of RECENT_REQUEST_IDS.entries()) {
    if (now - ts > IDEMPOTENCY_WINDOW_MS) {
      RECENT_REQUEST_IDS.delete(k);
    }
  }
  const existing = RECENT_REQUEST_IDS.get(key);
  if (existing && now - existing < IDEMPOTENCY_WINDOW_MS) {
    return false;
  }
  RECENT_REQUEST_IDS.set(key, now);
  return true;
}

export async function saveAppointmentCommand(params: {
  actorRole: string | undefined;
  draft: AppointmentDraftInput;
  existingAppointments?: Appointment[];
}): Promise<AppointmentCommandOutcome> {
  if (!canPerformAction(params.actorRole, 'book_appointment')) {
    return {
      ok: false,
      outcome: 'error',
      errorMessage: 'نقش فعلی مجوز ثبت یا ویرایش نوبت را ندارد.',
    };
  }

  const validation = validateAppointmentDraft(params.draft, params.existingAppointments ?? []);
  if (!validation.valid || !validation.payload) {
    return {
      ok: false,
      outcome: 'error',
      errorMessage: validation.error || 'اطلاعات نوبت نامعتبر است.',
    };
  }

  const reqKey =
    params.draft.clientRequestId ||
    `${params.draft.id || 'new'}::${validation.payload.patient_id || 'none'}::${validation.payload.appointment_date}::${validation.payload.appointment_time}::${validation.payload.room || 'any'}`;
  if (!claimIdempotencyKey(reqKey)) {
    return {
      ok: false,
      outcome: 'error',
      errorMessage: 'درخواست مشابه در حال ثبت است. لطفاً چند لحظه صبر کنید.',
    };
  }

  const result = params.draft.id
    ? await supabase
        .from('appointments')
        .update(validation.payload)
        .eq('id', params.draft.id)
    : await supabase.from('appointments').insert(validation.payload);

  const outcome = getMutationOutcome(result);
  if (outcome === 'error') {
    RECENT_REQUEST_IDS.delete(reqKey);
    return {
      ok: false,
      outcome: 'error',
      errorMessage: result.error?.message || 'ثبت نوبت در سرور انجام نشد.',
    };
  }

  return {
    ok: true,
    outcome,
    data: result.data,
  };
}

export async function transitionAppointmentStatusCommand(params: {
  actorRole: string | undefined;
  appointmentId: string;
  currentStatus: string;
  nextStatus: string;
}): Promise<AppointmentCommandOutcome> {
  if (!canPerformAction(params.actorRole, 'book_appointment')) {
    return {
      ok: false,
      outcome: 'error',
      errorMessage: 'نقش فعلی مجوز تغییر وضعیت نوبت را ندارد.',
    };
  }

  if (!canTransitionAppointmentStatus(params.currentStatus, params.nextStatus)) {
    return {
      ok: false,
      outcome: 'error',
      errorMessage: `انتقال وضعیت از «${APPOINTMENT_STATUS[params.currentStatus]?.label || params.currentStatus}» به «${APPOINTMENT_STATUS[params.nextStatus]?.label || params.nextStatus}» مجاز نیست.`,
    };
  }

  const result = await supabase
    .from('appointments')
    .update({ status: params.nextStatus })
    .eq('id', params.appointmentId);

  const outcome = getMutationOutcome(result);
  if (outcome === 'error') {
    return {
      ok: false,
      outcome: 'error',
      errorMessage: result.error?.message || 'تغییر وضعیت نوبت انجام نشد.',
    };
  }

  return {
    ok: true,
    outcome,
    data: result.data,
  };
}

export async function deleteAppointmentCommand(params: {
  actorRole: string | undefined;
  appointmentId: string;
}): Promise<AppointmentCommandOutcome> {
  if (!canPerformAction(params.actorRole, 'delete_critical_records')) {
    return {
      ok: false,
      outcome: 'error',
      errorMessage: 'حذف نوبت صرفاً با دسترسی مدیر کلینیک مجاز است.',
    };
  }

  const result = await supabase.from('appointments').delete().eq('id', params.appointmentId);
  const outcome = getMutationOutcome(result);
  if (outcome === 'error') {
    return {
      ok: false,
      outcome: 'error',
      errorMessage: result.error?.message || 'حذف نوبت انجام نشد.',
    };
  }

  return {
    ok: true,
    outcome,
    data: result.data,
  };
}
