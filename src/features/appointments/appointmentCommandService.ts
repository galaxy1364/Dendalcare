import { supabase, type Appointment } from '@/lib/supabase';
import { getBackendNamespaceKey } from '@/lib/supabaseCore';
import { getMutationOutcome, hasZeroAffectedRows, type MutationOutcome } from '@/lib/supabaseGuardian';
import {
  ACTIVE_TENANT_ID,
  getActiveBranchId,
  getActiveTenantId,
  getRuntimeAuthStatus,
} from '@/services/authentication/authService';
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
  errorCode?: string;
  affectedRows?: number;
  clientRequestId?: string;
  idempotentReplay?: boolean;
  data?: unknown;
}

export interface PersistentIdempotencyEntry {
  clientRequestId: string;
  payloadFingerprint: string;
  status: 'in_flight' | 'completed';
  timestamp: number;
  outcome?: AppointmentCommandOutcome;
}

const VALID_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const APPOINTMENT_IDEMPOTENCY_STORAGE_KEY = getBackendNamespaceKey(
  'minadental_appt_idempotency_v14'
);
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24h persistent ledger window
const IN_FLIGHT_REQUESTS = new Map<string, Promise<AppointmentCommandOutcome>>();
const MEMORY_IDEMPOTENCY_LEDGER = new Map<string, PersistentIdempotencyEntry>();

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
 * Shared domain validator unifying full-screen operational forms,
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

export function computeAppointmentPayloadFingerprint(
  id: string | null | undefined,
  payload: NormalizedAppointmentPayload
): string {
  return [
    id || 'new',
    payload.tenant_id,
    payload.branch_id,
    payload.patient_id || '',
    payload.staff_id || '',
    payload.appointment_date,
    payload.appointment_time,
    String(payload.duration_min),
    payload.type,
    payload.status,
    payload.room || '',
  ].join('|');
}

function loadPersistentIdempotencyLedger(): Record<string, PersistentIdempotencyEntry> {
  const now = Date.now();
  const out: Record<string, PersistentIdempotencyEntry> = {};

  for (const [k, v] of MEMORY_IDEMPOTENCY_LEDGER.entries()) {
    if (now - v.timestamp <= IDEMPOTENCY_TTL_MS) {
      out[k] = v;
    } else {
      MEMORY_IDEMPOTENCY_LEDGER.delete(k);
    }
  }

  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(APPOINTMENT_IDEMPOTENCY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, PersistentIdempotencyEntry>;
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (v && typeof v === 'object' && now - Number(v.timestamp || 0) <= IDEMPOTENCY_TTL_MS) {
              out[k] = v;
              MEMORY_IDEMPOTENCY_LEDGER.set(k, v);
            }
          }
        }
      }
    } catch {
      // ignore storage read error
    }
  }
  return out;
}

function savePersistentIdempotencyEntry(entry: PersistentIdempotencyEntry): void {
  MEMORY_IDEMPOTENCY_LEDGER.set(entry.clientRequestId, entry);
  if (typeof window !== 'undefined') {
    try {
      const current = loadPersistentIdempotencyLedger();
      current[entry.clientRequestId] = entry;
      window.localStorage.setItem(APPOINTMENT_IDEMPOTENCY_STORAGE_KEY, JSON.stringify(current));
    } catch {
      // ignore quota error
    }
  }
}

export function clearAppointmentIdempotencyLedger(): void {
  MEMORY_IDEMPOTENCY_LEDGER.clear();
  IN_FLIGHT_REQUESTS.clear();
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(APPOINTMENT_IDEMPOTENCY_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

export const clearAppointmentIdempotencyWindow = clearAppointmentIdempotencyLedger;

function extractCanonicalAffectedRows(data: unknown, explicitCount?: number | null): {
  affectedRows: number;
  row: unknown;
} {
  if (typeof explicitCount === 'number' && explicitCount >= 0) {
    return {
      affectedRows: explicitCount,
      row: Array.isArray(data) ? data[0] ?? null : data,
    };
  }
  if (Array.isArray(data)) {
    return {
      affectedRows: data.length,
      row: data[0] ?? null,
    };
  }
  if (data && typeof data === 'object') {
    return {
      affectedRows: 1,
      row: data,
    };
  }
  return { affectedRows: 0, row: null };
}

function isRpcNotDeployedError(error: any): boolean {
  const code = String(error?.code || '');
  const msg = String(error?.message || '').toLowerCase();
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    msg.includes('could not find the function') ||
    msg.includes('book_or_update_appointment_v14') ||
    msg.includes('transition_appointment_status_v14')
  );
}

export async function saveAppointmentCommand(params: {
  actorRole: string | undefined;
  draft: AppointmentDraftInput;
  editingId?: string | null;
  currentStatus?: string | null;
  idempotencyKey?: string | null;
  existingAppointments?: Appointment[];
  client?: any;
  supabaseClient?: any;
}): Promise<AppointmentCommandOutcome> {
  if (getRuntimeAuthStatus() === 'unauthorized' || !canPerformAction(params.actorRole, 'book_appointment')) {
    return {
      ok: false,
      outcome: 'error',
      errorCode: 'MINA_APPT_UNAUTHORIZED',
      affectedRows: 0,
      errorMessage: 'نقش فعلی یا وضعیت عضویت شما مجوز ثبت یا ویرایش نوبت را ندارد.',
    };
  }

  const effectiveDraft: AppointmentDraftInput = {
    ...params.draft,
    id: params.draft.id ?? params.editingId ?? null,
    clientRequestId: params.draft.clientRequestId ?? params.idempotencyKey ?? null,
  };

  const validation = validateAppointmentDraft(effectiveDraft, params.existingAppointments ?? []);
  if (!validation.valid || !validation.payload) {
    return {
      ok: false,
      outcome: 'error',
      errorCode: 'MINA_APPT_VALIDATION_FAILED',
      affectedRows: 0,
      errorMessage: validation.error || 'اطلاعات نوبت نامعتبر است.',
    };
  }

  const payload = validation.payload;
  const fingerprint = computeAppointmentPayloadFingerprint(effectiveDraft.id, payload);
  const clientRequestId = String(
    effectiveDraft.clientRequestId ||
      `appt_v14_${effectiveDraft.id || 'new'}_${payload.tenant_id}_${payload.branch_id}_${payload.patient_id || 'none'}_${payload.appointment_date}_${payload.appointment_time}_${payload.room || 'any'}`
  ).trim();

  // 1. Check persistent idempotency ledger (only when explicit clientRequestId is provided or in-flight)
  if (effectiveDraft.clientRequestId) {
    const ledger = loadPersistentIdempotencyLedger();
    const existingEntry = ledger[clientRequestId];
    if (existingEntry) {
      if (existingEntry.payloadFingerprint !== fingerprint) {
        return {
          ok: false,
          outcome: 'error',
          errorCode: 'MINA_APPT_IDEMPOTENCY_CONFLICT',
          affectedRows: 0,
          clientRequestId,
          errorMessage: 'شناسه یکتای درخواست قبلاً با مشخصات نوبت متفاوتی ثبت شده است.',
        };
      }
      if (existingEntry.status === 'completed' && existingEntry.outcome) {
        return {
          ...existingEntry.outcome,
          clientRequestId,
          idempotentReplay: true,
        };
      }
    }
  }

  const inFlight = IN_FLIGHT_REQUESTS.get(clientRequestId);
  if (inFlight) {
    const settled = await inFlight;
    return {
      ...settled,
      clientRequestId,
      idempotentReplay: true,
    };
  }

  const executionPromise = (async (): Promise<AppointmentCommandOutcome> => {
    const dbClient = params.client || params.supabaseClient || supabase;
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

    // 2. Try authoritative PostgreSQL transactional RPC first when online and rpc() is available
    if (!isOffline && typeof dbClient.rpc === 'function') {
      try {
        const rpcRes = await dbClient.rpc('book_or_update_appointment_v14', {
          p_tenant_id: payload.tenant_id,
          p_branch_id: payload.branch_id,
          p_client_request_id: clientRequestId,
          p_appointment_id: effectiveDraft.id ?? null,
          p_patient_id: payload.patient_id,
          p_staff_id: payload.staff_id ?? null,
          p_title: payload.title ?? null,
          p_appointment_date: payload.appointment_date,
          p_appointment_time: payload.appointment_time,
          p_duration_min: payload.duration_min,
          p_type: payload.type,
          p_status: payload.status,
          p_room: payload.room,
          p_notes: payload.notes,
        });

        if (!rpcRes?.error && rpcRes?.data) {
          const rpcPayload = rpcRes.data as {
            ok?: boolean;
            affectedRows?: number;
            affected_rows?: number;
            idempotentReplay?: boolean;
            idempotent_replay?: boolean;
            appointment?: unknown;
            record?: unknown;
          };
          const recordObj = rpcPayload.appointment ?? rpcPayload.record ?? null;
          const affected = Number(
            rpcPayload.affectedRows ?? rpcPayload.affected_rows ?? (recordObj ? 1 : 0)
          );
          if (affected <= 0 || !recordObj) {
            return {
              ok: false,
              outcome: 'error',
              errorCode: 'MINA_APPT_ZERO_ROWS',
              affectedRows: 0,
              clientRequestId,
              errorMessage: 'هیچ ردیفی در سرور ثبت یا به‌روزرسانی نشد.',
            };
          }
          const confirmedOutcome: AppointmentCommandOutcome = {
            ok: true,
            outcome: 'confirmed',
            affectedRows: affected,
            clientRequestId,
            idempotentReplay: Boolean(rpcPayload.idempotentReplay ?? rpcPayload.idempotent_replay),
            data: recordObj,
          };
          savePersistentIdempotencyEntry({
            clientRequestId,
            payloadFingerprint: fingerprint,
            status: 'completed',
            timestamp: Date.now(),
            outcome: confirmedOutcome,
          });
          return confirmedOutcome;
        }

        if (rpcRes?.error && !isRpcNotDeployedError(rpcRes.error)) {
          return {
            ok: false,
            outcome: 'error',
            errorCode: String(rpcRes.error.code || 'MINA_APPT_RPC_REJECTED'),
            clientRequestId,
            errorMessage: rpcRes.error.message || 'ثبت نوبت توسط قوانین تراکنشی سرور رد شد.',
          };
        }
      } catch (rpcErr: any) {
        if (!isRpcNotDeployedError(rpcErr)) {
          // If network failure, fall through to guarded table builder so offline queue handles it
          const msg = String(rpcErr?.message || '').toLowerCase();
          if (!msg.includes('fetch') && !msg.includes('network') && !msg.includes('timeout')) {
            return {
              ok: false,
              outcome: 'error',
              errorCode: 'MINA_APPT_RPC_ERROR',
              clientRequestId,
              errorMessage: rpcErr?.message || 'خطا در اجرای تراکنش نوبت‌دهی سرور.',
            };
          }
        }
      }
    }

    // 3. Fallback / Offline-Guarded Table Mutation with explicit .select() canonical row verification
    const baseQuery = params.draft.id
      ? dbClient.from('appointments').update(payload).eq('id', params.draft.id)
      : dbClient.from('appointments').insert(payload);

    const result =
      typeof baseQuery?.select === 'function' ? await baseQuery.select() : await baseQuery;

    const outcome = getMutationOutcome(result);
    if (outcome === 'error') {
      const isZeroRow = !result?.error && hasZeroAffectedRows(result);
      return {
        ok: false,
        outcome: 'error',
        errorCode: isZeroRow
          ? 'MINA_APPT_ZERO_ROWS'
          : String(result?.error?.code || 'MINA_APPT_MUTATION_FAILED'),
        affectedRows: 0,
        clientRequestId,
        errorMessage:
          result?.error?.message ||
          'ثبت یا ویرایش نوبت در سرور انجام نشد (ردیف هدف یافت نشد یا دسترسی محدود است).',
      };
    }

    if (outcome === 'queued_offline') {
      const queuedOutcome: AppointmentCommandOutcome = {
        ok: true,
        outcome: 'queued_offline',
        affectedRows: 0,
        clientRequestId,
        idempotentReplay: false,
        data: result?.data,
      };
      savePersistentIdempotencyEntry({
        clientRequestId,
        payloadFingerprint: fingerprint,
        status: 'completed',
        timestamp: Date.now(),
        outcome: queuedOutcome,
      });
      return queuedOutcome;
    }

    const { affectedRows, row } = extractCanonicalAffectedRows(result?.data, result?.affectedRows);
    if (affectedRows <= 0) {
      return {
        ok: false,
        outcome: 'error',
        errorCode: 'MINA_APPT_ZERO_ROWS',
        affectedRows: 0,
        clientRequestId,
        errorMessage: 'هیچ ردیفی در جدول نوبت‌ها تغییر نکرد (ممکن است نوبت حذف شده یا خارج از شعبه فعال باشد).',
      };
    }

    const confirmedOutcome: AppointmentCommandOutcome = {
      ok: true,
      outcome: 'confirmed',
      affectedRows,
      clientRequestId,
      idempotentReplay: false,
      data: row ?? result?.data,
    };

    savePersistentIdempotencyEntry({
      clientRequestId,
      payloadFingerprint: fingerprint,
      status: 'completed',
      timestamp: Date.now(),
      outcome: confirmedOutcome,
    });

    return confirmedOutcome;
  })();

  IN_FLIGHT_REQUESTS.set(clientRequestId, executionPromise);
  try {
    return await executionPromise;
  } finally {
    IN_FLIGHT_REQUESTS.delete(clientRequestId);
  }
}

export async function transitionAppointmentStatusCommand(params: {
  actorRole: string | undefined;
  appointmentId: string;
  currentStatus?: string;
  nextStatus?: string;
  fromStatus?: string;
  toStatus?: string;
  clientRequestId?: string;
  client?: any;
  supabaseClient?: any;
}): Promise<AppointmentCommandOutcome> {
  if (getRuntimeAuthStatus() === 'unauthorized' || !canPerformAction(params.actorRole, 'book_appointment')) {
    return {
      ok: false,
      outcome: 'error',
      errorCode: 'MINA_APPT_UNAUTHORIZED',
      affectedRows: 0,
      errorMessage: 'نقش فعلی مجوز تغییر وضعیت نوبت را ندارد.',
    };
  }

  const currentStatus = String(params.currentStatus ?? params.fromStatus ?? '');
  const nextStatus = String(params.nextStatus ?? params.toStatus ?? '');

  if (!canTransitionAppointmentStatus(currentStatus, nextStatus)) {
    return {
      ok: false,
      outcome: 'error',
      errorCode: 'MINA_APPT_ILLEGAL_TRANSITION',
      affectedRows: 0,
      errorMessage: `انتقال وضعیت از «${APPOINTMENT_STATUS[currentStatus]?.label || currentStatus}» به «${APPOINTMENT_STATUS[nextStatus]?.label || nextStatus}» مجاز نیست.`,
    };
  }

  const dbClient = params.client || params.supabaseClient || supabase;
  const tenantId = getActiveTenantId() || ACTIVE_TENANT_ID;
  const branchId = getActiveBranchId();
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  if (!isOffline && typeof dbClient.rpc === 'function') {
    try {
      const rpcRes = await dbClient.rpc('transition_appointment_status_v14', {
        p_tenant_id: tenantId,
        p_branch_id: branchId,
        p_appointment_id: params.appointmentId,
        p_expected_status: currentStatus,
        p_next_status: nextStatus,
        p_client_request_id: params.clientRequestId ?? null,
      });

      if (!rpcRes?.error && rpcRes?.data) {
        const rpcPayload = rpcRes.data as {
          affectedRows?: number;
          affected_rows?: number;
          appointment?: unknown;
          record?: unknown;
        };
        const recordObj = rpcPayload.appointment ?? rpcPayload.record ?? null;
        const affected = Number(
          rpcPayload.affectedRows ?? rpcPayload.affected_rows ?? (recordObj ? 1 : 0)
        );
        if (affected <= 0 || !recordObj) {
          return {
            ok: false,
            outcome: 'error',
            errorCode: 'MINA_APPT_ZERO_ROWS',
            affectedRows: 0,
            errorMessage: 'تغییر وضعیت اعمال نشد؛ نوبت یافت نشد یا وضعیت آن توسط کاربر دیگری تغییر کرده است.',
          };
        }
        return {
          ok: true,
          outcome: 'confirmed',
          affectedRows: affected,
          data: recordObj,
        };
      }

      if (rpcRes?.error && !isRpcNotDeployedError(rpcRes.error)) {
        return {
          ok: false,
          outcome: 'error',
          errorCode: String(rpcRes.error.code || 'MINA_APPT_TRANSITION_REJECTED'),
          affectedRows: 0,
          errorMessage: rpcRes.error.message || 'تغییر وضعیت نوبت توسط سرور رد شد.',
        };
      }
    } catch (rpcErr: any) {
      if (!isRpcNotDeployedError(rpcErr)) {
        const msg = String(rpcErr?.message || '').toLowerCase();
        if (!msg.includes('fetch') && !msg.includes('network') && !msg.includes('timeout')) {
          return {
            ok: false,
            outcome: 'error',
            errorCode: 'MINA_APPT_RPC_ERROR',
            affectedRows: 0,
            errorMessage: rpcErr?.message || 'خطا در تغییر وضعیت نوبت.',
          };
        }
      }
    }
  }

  const updateQuery = dbClient
    .from('appointments')
    .update({ status: nextStatus })
    .eq('id', params.appointmentId);

  const result =
    typeof updateQuery?.select === 'function' ? await updateQuery.select() : await updateQuery;

  const outcome = getMutationOutcome(result);
  if (outcome === 'error') {
    const isZeroRow = !result?.error && hasZeroAffectedRows(result);
    return {
      ok: false,
      outcome: 'error',
      errorCode: isZeroRow
        ? 'MINA_APPT_ZERO_ROWS'
        : String(result?.error?.code || 'MINA_APPT_TRANSITION_FAILED'),
      affectedRows: 0,
      errorMessage: result?.error?.message || 'تغییر وضعیت نوبت انجام نشد.',
    };
  }

  if (outcome === 'queued_offline') {
    return {
      ok: true,
      outcome: 'queued_offline',
      affectedRows: 0,
      data: result?.data,
    };
  }

  const { affectedRows, row } = extractCanonicalAffectedRows(result?.data, result?.affectedRows);
  if (affectedRows <= 0) {
    return {
      ok: false,
      outcome: 'error',
      errorCode: 'MINA_APPT_ZERO_ROWS',
      affectedRows: 0,
      errorMessage: 'تغییر وضعیت نوبت هیچ ردیفی را تغییر نداد.',
    };
  }

  return {
    ok: true,
    outcome: 'confirmed',
    affectedRows,
    data: row ?? result?.data,
  };
}

export async function deleteAppointmentCommand(params: {
  actorRole: string | undefined;
  appointmentId: string;
  client?: any;
  supabaseClient?: any;
}): Promise<AppointmentCommandOutcome> {
  if (
    getRuntimeAuthStatus() === 'unauthorized' ||
    !canPerformAction(params.actorRole, 'delete_critical_records')
  ) {
    return {
      ok: false,
      outcome: 'error',
      errorCode: 'MINA_APPT_DELETE_FORBIDDEN',
      affectedRows: 0,
      errorMessage: 'حذف نوبت صرفاً با دسترسی تاییدشده مدیر کلینیک مجاز است.',
    };
  }

  const dbClient = params.client || params.supabaseClient || supabase;
  const delQuery = dbClient.from('appointments').delete().eq('id', params.appointmentId);
  const result =
    typeof delQuery?.select === 'function' ? await delQuery.select() : await delQuery;

  const outcome = getMutationOutcome(result);
  if (outcome === 'error') {
    const isZeroRow = !result?.error && hasZeroAffectedRows(result);
    return {
      ok: false,
      outcome: 'error',
      errorCode: isZeroRow
        ? 'MINA_APPT_ZERO_ROWS'
        : String(result?.error?.code || 'MINA_APPT_DELETE_FAILED'),
      affectedRows: 0,
      errorMessage: result?.error?.message || 'حذف نوبت انجام نشد.',
    };
  }

  if (outcome === 'queued_offline') {
    return {
      ok: true,
      outcome: 'queued_offline',
      affectedRows: 0,
      data: result?.data,
    };
  }

  const { affectedRows, row } = extractCanonicalAffectedRows(result?.data, result?.affectedRows);
  if (affectedRows <= 0) {
    return {
      ok: false,
      outcome: 'error',
      errorCode: 'MINA_APPT_ZERO_ROWS',
      affectedRows: 0,
      errorMessage: 'نوبت مورد نظر در سرور یافت نشد یا قبلاً حذف شده است.',
    };
  }

  return {
    ok: true,
    outcome: 'confirmed',
    affectedRows,
    data: row ?? result?.data,
  };
}
