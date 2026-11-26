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
 * MINADENTAL V14 — UNIFIED 9-STAGE CLINICAL PATIENT JOURNEY
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

export function computePatientClinicalJourney(
  input: ComputePatientJourneyInput
): PatientClinicalJourneySummary {
  const pid = input.patient.id;
  const appts = (input.appointments ?? []).filter(
    (a) => a.patient_id === pid && a.status !== 'cancelled' && a.status !== 'no_show'
  );
  const treats = (input.treatments ?? []).filter(
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

  // 1. Reception
  const hasReception = Boolean(pid && input.patient.first_name);

  // 2. Appointment booked / scheduled / confirmed
  const hasAppointment = appts.length > 0 || treats.length > 0;
  const hasScheduledOrConfirmedAppt = appts.some(
    (a) => a.status === 'scheduled' || a.status === 'confirmed'
  );

  // 3. Check-in (arrived or further along)
  const hasArrivedAppt = appts.some((a) =>
    ['arrived', 'waiting', 'in_progress', 'completed'].includes(a.status)
  );
  const isCurrentlyCheckedIn = appts.some((a) => a.status === 'arrived');

  // 4. Waiting room / unit queue
  const hasReachedWaitingOrChair =
    appts.some((a) => ['waiting', 'in_progress', 'completed'].includes(a.status)) ||
    treats.length > 0;
  const isCurrentlyWaiting = appts.some((a) => a.status === 'waiting');

  // 5. Examination & Palmer tooth chart / diagnosis
  const hasExamination =
    (input.toothConditionsCount ?? 0) > 0 ||
    treats.some((t) => Boolean(t.diagnosis?.trim() || t.tooth_numbers?.trim())) ||
    appts.some((a) => a.status === 'in_progress' || a.status === 'completed');
  const isCurrentlyInExam =
    appts.some((a) => a.status === 'in_progress') && treats.length === 0;

  // 6. Treatment planning
  const hasPlannedTreatment = treats.some((t) =>
    ['planned', 'in_progress', 'completed'].includes(t.status)
  );
  const hasOnlyPlannedTreatment =
    treats.length > 0 && treats.every((t) => t.status === 'planned');

  // 7. Treatment execution (chairside procedure + lab + implants)
  const hasActiveExecution =
    treats.some((t) => t.status === 'in_progress') ||
    labs.some((l) => l.status !== 'delivered_to_patient') ||
    imps.some((im) => im.stage !== 'completed');
  const hasCompletedExecution =
    treats.some((t) => t.status === 'completed') && !hasActiveExecution;

  // 8. Billing & financial settlement
  const netTreatmentCost = treats.reduce(
    (sum, t) => sum + Math.max(0, Math.round(Number(t.total_cost || 0) - Number(t.discount || 0))),
    0
  );
  const totalPaidAmount = pays.reduce((sum, p) => sum + Math.max(0, Math.round(Number(p.amount || 0))), 0);
  const outstandingBalance = Math.max(0, netTreatmentCost - totalPaidAmount);
  const hasOverdueInstrument = insts.some((i) => i.status === 'overdue');
  const isBillingSettled =
    netTreatmentCost > 0 && outstandingBalance === 0 && !hasOverdueInstrument;
  const isBillingActive =
    netTreatmentCost > 0 && (outstandingBalance > 0 || insts.length > 0 || chks.length > 0);

  // 9. Follow-up & recall reminder
  const hasFollowUpScheduled = rems.length > 0;
  const hasCompletedFollowUp =
    rems.length > 0 && rems.every((r) => r.status === 'completed' || r.status === 'done');
  const hasPendingFollowUp = rems.some((r) => r.status === 'pending');

  // Determine canonical current stage
  let currentStageId: ClinicalJourneyStageId = 'reception';
  if (!hasAppointment) {
    currentStageId = 'appointment';
  } else if (hasScheduledOrConfirmedAppt && !hasArrivedAppt && treats.length === 0) {
    currentStageId = 'check_in';
  } else if (isCurrentlyCheckedIn) {
    currentStageId = 'waiting';
  } else if (isCurrentlyWaiting || isCurrentlyInExam) {
    currentStageId = 'examination';
  } else if (!hasPlannedTreatment) {
    currentStageId = 'treatment_planning';
  } else if (hasOnlyPlannedTreatment || hasActiveExecution) {
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
      state: hasAppointment
        ? 'completed'
        : currentStageId === 'appointment'
        ? 'current'
        : 'pending',
      detailFa: hasAppointment
        ? `${appts.length.toLocaleString('fa-IR')} نوبت ثبت‌شده`
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
        hasArrivedAppt || treats.length > 0
          ? 'completed'
          : currentStageId === 'check_in'
          ? 'current'
          : 'pending',
      detailFa:
        hasArrivedAppt || treats.length > 0 ? 'حضور ثبت شد' : 'در انتظار حضور بیمار',
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
        ? `${treats.length.toLocaleString('fa-IR')} طرح درمان`
        : 'بدون طرح درمان',
      targetRoute: 'treatment_form',
      color: '#5B3CC4',
    },
    {
      id: 'treatment_execution',
      order: 7,
      labelFa: 'اجرای درمان / لابراتوار',
      shortLabelFa: 'اجرای درمان',
      fhirResource: 'Procedure',
      state: hasActiveExecution
        ? 'current'
        : hasCompletedExecution
        ? 'completed'
        : currentStageId === 'treatment_execution'
        ? 'current'
        : 'pending',
      detailFa: hasActiveExecution
        ? 'درمان / لابراتوار در جریان'
        : hasCompletedExecution
        ? 'درمان تکمیل شد'
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
    appointment: { labelFa: 'ثبت نوبت ویزیت جدید', route: 'appointment_form' },
    check_in: { labelFa: 'ثبت حضور بیمار در مطب', route: 'appointments' },
    waiting: { labelFa: 'فراخوانی بیمار به یونیت درمان', route: 'appointments' },
    examination: { labelFa: 'ثبت معاینه و چارت پالمر', route: 'treatments' },
    treatment_planning: { labelFa: 'تدوین طرح درمان و برآورد هزینه', route: 'treatment_form' },
    treatment_execution: { labelFa: 'تکمیل مراحل درمان / لابراتوار', route: 'treatments' },
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
  };
}
