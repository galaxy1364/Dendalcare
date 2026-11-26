import type {
  Appointment,
  Check,
  Implant,
  Installment,
  LabOrder,
  Patient,
  Payment,
  Reminder,
  Treatment,
} from '@/lib/supabase';
import type { AppRouteId } from '@/lib/navigationStack';

/**
 * MINADENTAL V14 / V15 — ENCOUNTER-SCOPED 9-STAGE CLINICAL PATIENT JOURNEY
 *
 * Connects the complete end-to-end clinical & financial workflow across:
 *   1. reception          (پذیرش و تشکیل پرونده — HL7 FHIR Patient)
 *   2. appointment        (نوبت‌دهی تاییدشده — HL7 FHIR Appointment.status = booked)
 *   3. check_in           (پذیرش حضوری در مطب — HL7 FHIR Appointment.status = arrived)
 *   4. waiting            (انتظار یونیت — HL7 FHIR Encounter.status = arrived)
 *   5. examination        (معاینه و چارت پالمر — HL7 FHIR ClinicalImpression / Observation)
 *   6. treatment_planning (طرح درمان — HL7 FHIR CarePlan / ServiceRequest)
 *   7. treatment_execution(اجرای درمان و لابراتوار/ایمپلنت — HL7 FHIR Procedure)
 *   8. billing            (صورتحساب و تسویه مالی — HL7 FHIR Invoice / PaymentReconciliation)
 *   9. follow_up          (یادآوری و پیگیری پس از درمان — HL7 FHIR Task / CommunicationRequest)
 *
 * V15 Clinical Safety Enhancement (CL-04):
 *   - Separates active encounter / care episode state from longitudinal patient history.
 *   - Past completed appointments, treatments, or payments NEVER mark a newly scheduled,
 *     confirmed, arrived, waiting, no-show, or emergency walk-in encounter as completed.
 *   - Payment is never treated as evidence of clinical treatment completion.
 */

export type ClinicalJourneyStageId =
  | 'reception'
  | 'appointment'
  | 'check_in'
  | 'waiting'
  | 'examination'
  | 'treatment_planning'
  | 'treatment_execution'
  | 'billing'
  | 'follow_up';

export type ClinicalJourneyStageState = 'completed' | 'current' | 'pending' | 'attention';

export type EncounterEpisodeStatus =
  | 'no_encounter'
  | 'scheduled'
  | 'checked_in'
  | 'in_progress'
  | 'completed'
  | 'no_show'
  | 'cancelled'
  | 'interrupted'
  | 'emergency_walk_in';

export interface ClinicalJourneyStageNode {
  id: ClinicalJourneyStageId;
  order: number;
  labelFa: string;
  shortLabelFa: string;
  fhirResource: string;
  state: ClinicalJourneyStageState;
  detailFa: string;
  targetRoute: AppRouteId;
  color: string;
}

export interface LongitudinalClinicalHistorySummary {
  totalHistoricalAppointments: number;
  completedEncountersCount: number;
  noShowCount: number;
  cancelledCount: number;
  historicalCompletedTreatmentsCount: number;
  lifetimeNetTreatmentCost: number;
  lifetimePaidAmount: number;
}

export interface ActiveEncounterContextSummary {
  encounterAppointmentId: string | null;
  encounterDate: string | null;
  episodeStatus: EncounterEpisodeStatus;
  isNewEpisodeAfterHistoricalCompletion: boolean;
  encounterTreatmentsCount: number;
  walkInReason: string | null;
}

export interface PatientClinicalJourneySummary {
  patientId: string;
  stages: ClinicalJourneyStageNode[];
  currentStageId: ClinicalJourneyStageId;
  currentStageLabelFa: string;
  completedStagesCount: number;
  totalStagesCount: 9;
  progressPercent: number;
  netTreatmentCost: number;
  totalPaidAmount: number;
  outstandingBalance: number;
  nextActionLabelFa: string;
  nextActionRoute: AppRouteId;
  activeEncounter: ActiveEncounterContextSummary;
  longitudinalHistory: LongitudinalClinicalHistorySummary;
}

export interface ComputePatientJourneyInput {
  patient: Pick<Patient, 'id' | 'first_name' | 'last_name' | 'status'>;
  appointments?: Appointment[];
  treatments?: Treatment[];
  payments?: Payment[];
  installments?: Installment[];
  checks?: Check[];
  labOrders?: LabOrder[];
  implants?: Implant[];
  reminders?: Reminder[];
  toothConditionsCount?: number;
  activeAppointmentId?: string | null;
  encounterStatusOverride?: 'interrupted' | 'emergency_walk_in' | null;
  walkInReason?: string | null;
}

export const CANONICAL_CLINICAL_JOURNEY_STAGE_IDS: readonly ClinicalJourneyStageId[] = [
  'reception',
  'appointment',
  'check_in',
  'waiting',
  'examination',
  'treatment_planning',
  'treatment_execution',
  'billing',
  'follow_up',
];

function sortAppointmentsChronologically(list: Appointment[]): Appointment[] {
  return [...list].sort((a, b) => {
    const keyA = `${a.appointment_date || ''}T${a.appointment_time || '00:00'}|${a.created_at || ''}`;
    const keyB = `${b.appointment_date || ''}T${b.appointment_time || '00:00'}|${b.created_at || ''}`;
    return keyA.localeCompare(keyB);
  });
}

export function computePatientClinicalJourney(
  input: ComputePatientJourneyInput
): PatientClinicalJourneySummary {
  const pid = input.patient.id;
  const allPatientAppts = sortAppointmentsChronologically(
    (input.appointments ?? []).filter((a) => a.patient_id === pid)
  );
  const allPatientTreats = (input.treatments ?? []).filter(
    (t) => t.patient_id === pid && t.status !== 'cancelled'
  );
  const pays = (input.payments ?? []).filter(
    (p) =>
      p.patient_id === pid &&
      (p as any).status !== 'cancelled' &&
      (p as any).status !== 'voided' &&
      !(p as any).voided_at
  );
  const insts = (input.installments ?? []).filter(
    (i) => i.patient_id === pid && (i.status === 'active' || i.status === 'overdue')
  );
  const chks = (input.checks ?? []).filter(
    (c) => c.patient_id === pid && c.status === 'pending'
  );
  const labs = (input.labOrders ?? []).filter(
    (l) => l.patient_id === pid && l.status !== 'cancelled'
  );
  const imps = (input.implants ?? []).filter(
    (im) => im.patient_id === pid && im.stage !== 'failed'
  );
  const rems = (input.reminders ?? []).filter((r) => r.patient_id === pid);

  // Longitudinal history metrics across all visits
  const historicalCompletedAppts = allPatientAppts.filter((a) => a.status === 'completed');
  const noShowAppts = allPatientAppts.filter((a) => a.status === 'no_show');
  const cancelledAppts = allPatientAppts.filter((a) => a.status === 'cancelled');
  const historicalCompletedTreats = allPatientTreats.filter((t) => t.status === 'completed');

  const netTreatmentCost = allPatientTreats.reduce(
    (sum, t) => sum + Math.max(0, Math.round(Number(t.total_cost || 0) - Number(t.discount || 0))),
    0
  );
  const totalPaidAmount = pays.reduce(
    (sum, p) => sum + Math.max(0, Math.round(Number(p.amount || 0))),
    0
  );
  const outstandingBalance = Math.max(0, netTreatmentCost - totalPaidAmount);

  const longitudinalHistory: LongitudinalClinicalHistorySummary = {
    totalHistoricalAppointments: allPatientAppts.length,
    completedEncountersCount: historicalCompletedAppts.length,
    noShowCount: noShowAppts.length,
    cancelledCount: cancelledAppts.length,
    historicalCompletedTreatmentsCount: historicalCompletedTreats.length,
    lifetimeNetTreatmentCost: netTreatmentCost,
    lifetimePaidAmount: totalPaidAmount,
  };

  // CL-04: Determine the active encounter / current care episode
  const explicitTargetAppt = input.activeAppointmentId
    ? allPatientAppts.find((a) => a.id === input.activeAppointmentId) ?? null
    : null;
  const latestAppt =
    explicitTargetAppt ??
    (allPatientAppts.length > 0 ? allPatientAppts[allPatientAppts.length - 1] : null);

  const isLatestApptNewActiveEpisode =
    latestAppt !== null &&
    ['scheduled', 'confirmed', 'arrived', 'waiting', 'in_progress'].includes(latestAppt.status);

  const isNewEpisodeAfterHistoricalCompletion =
    isLatestApptNewActiveEpisode && historicalCompletedAppts.length > 0;

  // Scope treatments to the active encounter when a new care episode exists
  const encounterScopedTreats = (() => {
    if (!latestAppt) return allPatientTreats;
    // If there are treatments explicitly linked to latestAppt.id, use them
    const directLinked = allPatientTreats.filter((t) => t.appointment_id === latestAppt.id);
    if (directLinked.length > 0) return directLinked;

    // If this is a new non-completed appointment after a previous visit (or a brand new appointment),
    // only include treatments created on or after the active appointment date/creation!
    if (isLatestApptNewActiveEpisode) {
      const apptDate = latestAppt.appointment_date || '';
      const apptCreated = latestAppt.created_at || '';
      return allPatientTreats.filter((t) => {
        if (t.appointment_id && t.appointment_id !== latestAppt.id) return false;
        const tDate = (t.performed_at || t.created_at || '').slice(0, 10);
        if (apptDate && tDate && tDate < apptDate) return false;
        if (apptCreated && t.created_at && t.created_at < apptCreated) return false;
        return true;
      });
    }

    // If latest appointment was cancelled or no_show, no active encounter treatments apply
    if (latestAppt.status === 'cancelled' || latestAppt.status === 'no_show') {
      return [];
    }

    return allPatientTreats;
  })();

  const activeAppts = latestAppt
    ? latestAppt.status === 'cancelled' || latestAppt.status === 'no_show'
      ? []
      : [latestAppt]
    : [];

  let episodeStatus: EncounterEpisodeStatus = 'no_encounter';
  if (input.encounterStatusOverride === 'interrupted') {
    episodeStatus = 'interrupted';
  } else if (
    input.encounterStatusOverride === 'emergency_walk_in' ||
    latestAppt?.type === 'emergency'
  ) {
    episodeStatus = 'emergency_walk_in';
  } else if (latestAppt?.status === 'no_show') {
    episodeStatus = 'no_show';
  } else if (latestAppt?.status === 'cancelled') {
    episodeStatus = 'cancelled';
  } else if (latestAppt?.status === 'scheduled' || latestAppt?.status === 'confirmed') {
    episodeStatus = 'scheduled';
  } else if (latestAppt?.status === 'arrived' || latestAppt?.status === 'waiting') {
    episodeStatus = 'checked_in';
  } else if (
    latestAppt?.status === 'in_progress' ||
    encounterScopedTreats.some((t) => t.status === 'in_progress')
  ) {
    episodeStatus = 'in_progress';
  } else if (
    latestAppt?.status === 'completed' ||
    encounterScopedTreats.some((t) => t.status === 'completed')
  ) {
    episodeStatus = 'completed';
  }

  const activeEncounter: ActiveEncounterContextSummary = {
    encounterAppointmentId: latestAppt?.id ?? null,
    encounterDate: latestAppt?.appointment_date ?? null,
    episodeStatus,
    isNewEpisodeAfterHistoricalCompletion,
    encounterTreatmentsCount: encounterScopedTreats.length,
    walkInReason: input.walkInReason ?? null,
  };

  // 1. Reception
  const hasReception = Boolean(pid && input.patient.first_name);

  // 2. Appointment booked / scheduled / confirmed (or emergency walk-in)
  const isLatestNoShowOrCancelled =
    latestAppt?.status === 'no_show' || latestAppt?.status === 'cancelled';
  const hasAppointment =
    !isLatestNoShowOrCancelled &&
    (activeAppts.length > 0 ||
      encounterScopedTreats.length > 0 ||
      episodeStatus === 'emergency_walk_in');
  const hasScheduledOrConfirmedAppt = activeAppts.some(
    (a) => a.status === 'scheduled' || a.status === 'confirmed'
  );

  // 3. Check-in (arrived or further along in the current encounter)
  const hasArrivedAppt =
    activeAppts.some((a) =>
      ['arrived', 'waiting', 'in_progress', 'completed'].includes(a.status)
    ) || episodeStatus === 'emergency_walk_in';
  const isCurrentlyCheckedIn = activeAppts.some((a) => a.status === 'arrived');

  // 4. Waiting room / unit queue
  const hasReachedWaitingOrChair =
    activeAppts.some((a) => ['waiting', 'in_progress', 'completed'].includes(a.status)) ||
    encounterScopedTreats.length > 0 ||
    episodeStatus === 'emergency_walk_in';
  const isCurrentlyWaiting = activeAppts.some((a) => a.status === 'waiting');

  // 5. Examination & Palmer tooth chart / diagnosis (strictly for current encounter)
  const hasExamination =
    ((input.toothConditionsCount ?? 0) > 0 && !isNewEpisodeAfterHistoricalCompletion) ||
    encounterScopedTreats.some((t) => Boolean(t.diagnosis?.trim() || t.tooth_numbers?.trim())) ||
    activeAppts.some((a) => a.status === 'in_progress' || a.status === 'completed');
  const isCurrentlyInExam =
    (activeAppts.some((a) => a.status === 'in_progress') ||
      episodeStatus === 'emergency_walk_in') &&
    encounterScopedTreats.length === 0;

  // 6. Treatment planning (strictly for current encounter)
  const hasPlannedTreatment = encounterScopedTreats.some((t) =>
    ['planned', 'in_progress', 'completed'].includes(t.status)
  );
  const hasOnlyPlannedTreatment =
    encounterScopedTreats.length > 0 &&
    encounterScopedTreats.every((t) => t.status === 'planned');

  // 7. Treatment execution (chairside procedure + active lab + active implants)
  // CRITICAL (CL-04): Payment is NEVER evidence of treatment execution completion!
  const hasActiveExecution =
    episodeStatus === 'interrupted' ||
    encounterScopedTreats.some((t) => t.status === 'in_progress') ||
    labs.some((l) => l.status !== 'delivered_to_patient') ||
    imps.some((im) => im.stage !== 'completed');
  const hasCompletedExecution =
    encounterScopedTreats.some((t) => t.status === 'completed') &&
    !hasActiveExecution &&
    episodeStatus !== 'interrupted';

  // 8. Billing & financial settlement
  const hasOverdueInstrument = insts.some((i) => i.status === 'overdue');
  const isBillingSettled =
    hasCompletedExecution &&
    netTreatmentCost > 0 &&
    outstandingBalance === 0 &&
    !hasOverdueInstrument;
  const isBillingActive =
    hasCompletedExecution &&
    netTreatmentCost > 0 &&
    (outstandingBalance > 0 || insts.length > 0 || chks.length > 0);

  // 9. Follow-up & recall reminder
  const hasFollowUpScheduled = hasCompletedExecution && rems.length > 0;
  const hasCompletedFollowUp =
    hasCompletedExecution &&
    rems.length > 0 &&
    rems.every((r) => r.status === 'completed' || r.status === 'done');
  const hasPendingFollowUp = rems.some((r) => r.status === 'pending');

  // Determine canonical current stage for the active encounter
  let currentStageId: ClinicalJourneyStageId = 'reception';
  if (!hasAppointment) {
    currentStageId = 'appointment';
  } else if (hasScheduledOrConfirmedAppt && !hasArrivedAppt && encounterScopedTreats.length === 0) {
    currentStageId = 'check_in';
  } else if (isCurrentlyCheckedIn) {
    currentStageId = 'waiting';
  } else if (isCurrentlyWaiting || isCurrentlyInExam) {
    currentStageId = 'examination';
  } else if (!hasPlannedTreatment) {
    currentStageId = 'treatment_planning';
  } else if (hasOnlyPlannedTreatment || hasActiveExecution || !hasCompletedExecution) {
    currentStageId = 'treatment_execution';
  } else if (outstandingBalance > 0 || hasOverdueInstrument) {
    currentStageId = 'billing';
  } else {
    currentStageId = 'follow_up';
  }

  const stages: ClinicalJourneyStageNode[] = [
    {
      id: 'reception',
      order: 1,
      labelFa: 'پذیرش و پرونده',
      shortLabelFa: 'پذیرش',
      fhirResource: 'Patient',
      state: hasReception ? 'completed' : 'current',
      detailFa: hasReception ? 'پرونده فعال' : 'در انتظار تشکیل پرونده',
      targetRoute: 'patients',
      color: '#176B52',
    },
    {
      id: 'appointment',
      order: 2,
      labelFa: 'نوبت‌دهی',
      shortLabelFa: 'نوبت',
      fhirResource: 'Appointment',
      state: isLatestNoShowOrCancelled
        ? 'attention'
        : hasAppointment
        ? 'completed'
        : currentStageId === 'appointment'
        ? 'current'
        : 'pending',
      detailFa:
        latestAppt?.status === 'no_show'
          ? 'عدم حضور (No-Show)'
          : latestAppt?.status === 'cancelled'
          ? 'نوبت لغوشده'
          : episodeStatus === 'emergency_walk_in'
          ? 'مراجعه اورژانسی حضوری'
          : hasAppointment
          ? `${activeAppts.length.toLocaleString('fa-IR')} نوبت فعال`
          : 'نوبت ثبت نشده',
      targetRoute: 'appointments',
      color: '#92510C',
    },
    {
      id: 'check_in',
      order: 3,
      labelFa: 'ورود و پذیرش حضوری',
      shortLabelFa: 'حضور',
      fhirResource: 'Appointment.arrived',
      state:
        hasArrivedAppt || encounterScopedTreats.length > 0
          ? 'completed'
          : currentStageId === 'check_in'
          ? 'current'
          : 'pending',
      detailFa:
        hasArrivedAppt || encounterScopedTreats.length > 0
          ? 'حضور ثبت شد'
          : 'در انتظار حضور بیمار',
      targetRoute: 'appointments',
      color: '#087C76',
    },
    {
      id: 'waiting',
      order: 4,
      labelFa: 'انتظار یونیت',
      shortLabelFa: 'انتظار',
      fhirResource: 'Encounter.arrived',
      state: isCurrentlyWaiting
        ? 'current'
        : hasReachedWaitingOrChair
        ? 'completed'
        : 'pending',
      detailFa: isCurrentlyWaiting
        ? 'در سالن انتظار یونیت'
        : hasReachedWaitingOrChair
        ? 'فراخوانی به یونیت انجام شد'
        : 'در انتظار فراخوانی',
      targetRoute: 'appointments',
      color: '#B45309',
    },
    {
      id: 'examination',
      order: 5,
      labelFa: 'معاینه و چارت پالمر',
      shortLabelFa: 'معاینه',
      fhirResource: 'Observation',
      state: isCurrentlyInExam
        ? 'current'
        : hasExamination
        ? 'completed'
        : currentStageId === 'examination'
        ? 'current'
        : 'pending',
      detailFa: hasExamination ? 'معاینه و تشخیص ثبت شد' : 'آماده معاینه بالینی',
      targetRoute: 'treatments',
      color: '#0369A1',
    },
    {
      id: 'treatment_planning',
      order: 6,
      labelFa: 'طرح درمان',
      shortLabelFa: 'طرح درمان',
      fhirResource: 'CarePlan',
      state: hasPlannedTreatment
        ? 'completed'
        : currentStageId === 'treatment_planning'
        ? 'current'
        : 'pending',
      detailFa: hasPlannedTreatment
        ? `${encounterScopedTreats.length.toLocaleString('fa-IR')} طرح درمان جلسه`
        : 'بدون طرح درمان در این ویزیت',
      targetRoute: 'treatment_form',
      color: '#5B3CC4',
    },
    {
      id: 'treatment_execution',
      order: 7,
      labelFa: 'اجرای درمان / لابراتوار',
      shortLabelFa: 'اجرای درمان',
      fhirResource: 'Procedure',
      state:
        episodeStatus === 'interrupted'
          ? 'attention'
          : hasActiveExecution
          ? 'current'
          : hasCompletedExecution
          ? 'completed'
          : currentStageId === 'treatment_execution'
          ? 'current'
          : 'pending',
      detailFa:
        episodeStatus === 'interrupted'
          ? 'درمان نیمه‌تمام / متوقف‌شده'
          : hasActiveExecution
          ? 'درمان / لابراتوار در جریان'
          : hasCompletedExecution
          ? 'درمان جلسه تکمیل شد'
          : 'در انتظار شروع درمان',
      targetRoute: 'treatments',
      color: '#7C3AED',
    },
    {
      id: 'billing',
      order: 8,
      labelFa: 'صورتحساب و تسویه مالی',
      shortLabelFa: 'مالی',
      fhirResource: 'Invoice',
      state: hasOverdueInstrument
        ? 'attention'
        : isBillingSettled
        ? 'completed'
        : isBillingActive || currentStageId === 'billing'
        ? 'current'
        : 'pending',
      detailFa: isBillingSettled
        ? 'تسویه کامل'
        : outstandingBalance > 0
        ? `مانده: ${outstandingBalance.toLocaleString('fa-IR')} ت`
        : 'بدون صورتحساب باز',
      targetRoute: 'finance',
      color: outstandingBalance > 0 ? '#AD293C' : '#176B52',
    },
    {
      id: 'follow_up',
      order: 9,
      labelFa: 'پیگیری و یادآوری',
      shortLabelFa: 'پیگیری',
      fhirResource: 'Task',
      state:
        hasCompletedFollowUp || hasFollowUpScheduled
          ? 'completed'
          : currentStageId === 'follow_up'
          ? 'current'
          : 'pending',
      detailFa: hasPendingFollowUp
        ? `${rems.filter((r) => r.status === 'pending').length.toLocaleString('fa-IR')} یادآوری فعال`
        : hasCompletedFollowUp
        ? 'پیگیری انجام شد'
        : 'ثبت یادآوری پیگیری',
      targetRoute: 'reminders',
      color: '#0E7490',
    },
  ];

  const completedStagesCount = stages.filter((s) => s.state === 'completed').length;
  const currentStageNode = stages.find((s) => s.id === currentStageId) ?? stages[0];

  const nextActionByStage: Record<
    ClinicalJourneyStageId,
    { labelFa: string; route: AppRouteId }
  > = {
    reception: { labelFa: 'تکمیل مشخصات پرونده بیمار', route: 'patients' },
    appointment: {
      labelFa: isLatestNoShowOrCancelled
        ? 'تعیین مجدد نوبت (نوبت قبلی لغو/عدم حضور)'
        : 'ثبت نوبت ویزیت جدید',
      route: 'appointment_form',
    },
    check_in: { labelFa: 'ثبت حضور بیمار در مطب', route: 'appointments' },
    waiting: { labelFa: 'فراخوانی بیمار به یونیت درمان', route: 'appointments' },
    examination: { labelFa: 'ثبت معاینه و چارت پالمر', route: 'treatments' },
    treatment_planning: { labelFa: 'تدوین طرح درمان و برآورد هزینه', route: 'treatment_form' },
    treatment_execution: {
      labelFa:
        episodeStatus === 'interrupted'
          ? 'ادامه درمان نیمه‌تمام جلسه قبل'
          : 'تکمیل مراحل درمان / لابراتوار',
      route: 'treatments',
    },
    billing: { labelFa: 'ثبت دریافتی یا تنظیم تقسیط/چک', route: 'finance' },
    follow_up: { labelFa: 'تنظیم یادآوری پیگیری پس از درمان', route: 'reminders' },
  };

  const nextAction = nextActionByStage[currentStageId];

  return {
    patientId: pid,
    stages,
    currentStageId,
    currentStageLabelFa: currentStageNode.labelFa,
    completedStagesCount,
    totalStagesCount: 9,
    progressPercent: Math.round((completedStagesCount / 9) * 100),
    netTreatmentCost,
    totalPaidAmount,
    outstandingBalance,
    nextActionLabelFa: nextAction.labelFa,
    nextActionRoute: nextAction.route,
    activeEncounter,
    longitudinalHistory,
  };
}
