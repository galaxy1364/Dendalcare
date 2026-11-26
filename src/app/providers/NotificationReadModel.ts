import type { SectionId } from '@/lib/sections';
import type { Patient, Reminder } from '@/lib/supabase';
import type { LiveSmartAlert } from '@/lib/smartReminderEngine';
import type { GlobalReminderPopupItem } from '@/components/ui/IOSReminderPopup';
import type { MascotMood } from '@/components/ui/MascotTooth';
import { toJalaliStr } from '@/lib/jalali';

/**
 * V10 P1 Data-Minimization Contract:
 * Global shell realtime projections MUST NEVER fetch sensitive clinical PHI/PII columns
 * that are only needed inside patient/treatment detail screens.
 */
export const FORBIDDEN_SHELL_PHI_COLUMNS = Object.freeze([
  'national_id',
  'diagnosis',
  'treatment_plan',
  'medical_history',
  'allergies',
  'clinical_notes',
] as const);

/**
 * Minimal, explicit column projections for the global shell NotificationReadModel.
 * Deliberately excludes `national_id` from `patients` and `diagnosis`, `treatment_plan`
 * from `treatments` to minimize PHI exposure in memory and IndexedDB shell mirrors.
 */
export const NOTIFICATION_READ_MODEL_PROJECTIONS = Object.freeze({
  reminders:
    'id,patient_id,title,description,reminder_date,reminder_time,category,priority,status,created_at',
  messages: 'id,subject,body,is_read,created_at',
  patients: 'id,first_name,last_name,phone,insurance_number,created_at',
  appointments:
    'id,patient_id,title,appointment_date,appointment_time,room,type,status,created_at',
  treatments: 'id,patient_id,tooth_numbers,total_cost,paid_amount,status,created_at',
  lab_orders:
    'id,patient_id,lab_name,tooth_numbers,work_type,status,due_date,received_date,created_at',
  implants:
    'id,patient_id,brand,tooth_number,stage,placement_date,osseointegration_date,abutment_date,crown_date,created_at',
  inventory: 'id,name,quantity,min_quantity,unit,expiry_date,created_at',
  installments:
    'id,patient_id,total_amount,paid_amount,monthly_amount,next_due_date,status,created_at',
  checks: 'id,patient_id,check_number,bank_name,amount,due_date,status,created_at',
  safteh: 'id,patient_id,safteh_number,guarantor_name,amount,due_date,status,created_at',
} as const);

const REMINDER_SECTION_MAP: Readonly<Record<string, SectionId>> = Object.freeze({
  payment: 'finance',
  implant: 'implants',
  lab: 'lab',
  appointment: 'appointments',
  inventory: 'inventory',
  treatment: 'treatments',
});

export interface BuildUnifiedAlertsInput {
  liveSmartAlerts: readonly LiveSmartAlert[];
  pendingReminders: readonly Reminder[];
  patients: readonly Pick<Patient, 'id' | 'first_name' | 'last_name' | 'phone'>[];
}

/**
 * Pure, React-free selector merging live smart radar alerts with stored pending reminders.
 * Preserves exact before/after notification parity while avoiding redundant O(N*M) lookups
 * via an indexed patient lookup map.
 */
export function buildUnifiedNotificationAlerts({
  liveSmartAlerts,
  pendingReminders,
  patients,
}: BuildUnifiedAlertsInput): GlobalReminderPopupItem[] {
  const mappedLive: GlobalReminderPopupItem[] = liveSmartAlerts.map((a) => ({
    id: a.id,
    domain: a.domain,
    targetSection: a.targetSection,
    patientName: a.patientName,
    patientPhone: a.patientPhone,
    title: a.title,
    subtitle: a.subtitle,
    dueDate: a.dueDate,
    urgency: a.urgency,
    amount: a.amount,
  }));

  const existingTitles = new Set(mappedLive.map((m) => m.title));
  const patientById = new Map<string, Pick<Patient, 'id' | 'first_name' | 'last_name' | 'phone'>>();
  for (const p of patients) {
    patientById.set(p.id, p);
  }

  const mappedStored: GlobalReminderPopupItem[] = pendingReminders
    .filter((r) => !existingTitles.has(r.title))
    .map((r) => {
      const pt = r.patient_id ? patientById.get(r.patient_id) : undefined;
      const ptName = pt ? `${pt.first_name} ${pt.last_name}` : 'بیمار کلینیک';
      return {
        id: `rem_${r.id}`,
        domain: r.category || 'appointment',
        targetSection: REMINDER_SECTION_MAP[r.category] || 'reminders',
        patientName: ptName,
        patientPhone: pt?.phone || null,
        title: r.title,
        subtitle:
          r.description ||
          `موعد یادآوری: ${toJalaliStr(r.reminder_date)} ساعت ${r.reminder_time || '09:30'}`,
        dueDate: r.reminder_date,
        urgency:
          r.priority === 'urgent' ? 'critical' : r.priority === 'high' ? 'today' : 'upcoming',
      };
    });

  return [...mappedLive, ...mappedStored];
}

export function computeNotificationCount(
  liveSmartAlertsCount: number,
  pendingRemindersCount: number,
  unreadMessagesCount: number
): number {
  return Math.max(liveSmartAlertsCount, pendingRemindersCount) + unreadMessagesCount;
}

export interface MascotTaskSignals {
  isOnline?: boolean;
  isProcessing?: boolean;
  /** True when user session/membership is verified; false maps to deterministic 'neutral' (unknown state) */
  isAuthorized?: boolean;
  justCompleted?: boolean;
  overdueCount?: number;
  pendingCount?: number;
}

/**
 * GE-0008 Deterministic 7-State Emotional Engine:
 * Strictly derived from real authorized clinic task state — zero randomness, zero patient PHI.
 * Priority:
 *  1. Offline -> 'offline'
 *  2. Processing / syncing -> 'thinking'
 *  3. Unknown / unauthorized state -> 'neutral'
 *  4. Overdue / critical tasks -> 'sad'
 *  5. Successful completion pulse -> 'celebrating'
 *  6. Pending tasks / reminders -> 'concerned'
 *  7. All verified tasks completed -> 'happy'
 */
export function computeMascotMood(
  liveSmartAlerts: readonly LiveSmartAlert[],
  pendingRemindersCount: number,
  signals?: MascotTaskSignals
): MascotMood {
  if (signals?.isOnline === false) return 'offline';
  if (signals?.isProcessing) return 'thinking';
  if (signals?.isAuthorized === false) return 'neutral';

  const hasOverdueOrCritical =
    (signals?.overdueCount ?? 0) > 0 ||
    liveSmartAlerts.some((a) => a.urgency === 'critical' || a.urgency === 'today') ||
    pendingRemindersCount > 5;
  if (hasOverdueOrCritical) return 'sad';

  if (signals?.justCompleted) return 'celebrating';

  const hasPending =
    (signals?.pendingCount ?? 0) > 0 ||
    liveSmartAlerts.length > 0 ||
    pendingRemindersCount > 0;
  if (hasPending) return 'concerned';

  return 'happy';
}
