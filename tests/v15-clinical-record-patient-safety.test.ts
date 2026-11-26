import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_CANONICAL_FDI_NUMBERS,
  isValidFdiToothNumber,
  fdiToToothCoordinate,
  palmerToFdiTooth,
  classifyLegacyToothRecord,
  appendOdontogramObservationCommand,
  reconcileAmbiguousLegacyToothCommand,
  projectOdontogramCurrentState,
  clearOdontogramLedgerForTesting,
} from '../src/features/clinical-record/odontogramDomain';
import {
  assessPatientAllergySafety,
  recordStructuredAllergyReviewCommand,
  recordPrintedUnsignedConsentCommand,
  signPatientConsentCommand,
  attemptInPlaceConsentEditCommand,
  withdrawPatientConsentCommand,
  invalidateConsentOnPlanChangeCommand,
  createClinicalNoteDraftCommand,
  signClinicalNoteCommand,
  amendSignedClinicalNoteCommand,
  archiveOrDeletePatientCommand,
  clearClinicalRecordLedgersForTesting,
} from '../src/features/clinical-record/clinicalRecordService';
import { computePatientClinicalJourney } from '../src/features/clinical-journey/patientJourney';
import {
  saveAppointmentCommand,
  clearAppointmentIdempotencyLedger,
} from '../src/features/appointments/appointmentCommandService';
import { PERMANENT_PROJECT_ROADMAP } from '../src/lib/memPalace';
import type { Patient, Appointment, Treatment, Payment } from '../src/lib/supabase';

export interface V15TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

async function runCase(
  results: V15TestResult[],
  name: string,
  fn: () => Promise<void> | void,
): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true });
  } catch (err) {
    results.push({
      name,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function runAllV15ClinicalRecordPatientSafetyTests(): Promise<V15TestResult[]> {
  const results: V15TestResult[] = [];
  const rootDir = process.cwd();

  // -------------------------------------------------------------------------
  // V15-P0-01: V14 Carry-Forward — Idempotency Ledger Direct-Write Protection,
  // Actor Ownership, Missing Schema Fail-Closed & Ambiguous Network Timeout
  // -------------------------------------------------------------------------
  await runCase(
    results,
    'V15-P0-01: V14 scheduling idempotency ledger enforces actor ownership, blocks missing schema in production, and flags network timeouts as unknown',
    async () => {
      const v14Sql = fs.readFileSync(
        path.join(rootDir, 'supabase/migrations/20261129000000_v14_transactional_scheduling_and_clinical_journey.sql'),
        'utf8',
      );
      assert.ok(v14Sql.includes('MINA_IDEMPOTENCY_DIRECT_WRITE_FORBIDDEN'));
      assert.ok(v14Sql.includes('MINA_IDEMPOTENCY_ACTOR_MISMATCH'));
      assert.ok(v14Sql.includes('MINA_APPT_MIDNIGHT_OVERFLOW'));
      assert.ok(v14Sql.includes('MINA_APPT_IMMUTABLE_SCOPE'));
      assert.ok(v14Sql.includes('actor_id = (SELECT auth.uid())'));

      clearAppointmentIdempotencyLedger();

      const mockConfirmedClient = {
        rpc: async (_name: string, args: Record<string, unknown>) => ({
          data: {
            ok: true,
            affectedRows: 1,
            idempotentReplay: false,
            appointment: { id: 'appt-v15-1', ...args },
          },
          error: null,
        }),
      };

      const first = await saveAppointmentCommand({
        actorRole: 'secretary',
        actorId: 'actor-A',
        idempotencyKey: 'shared-idemp-key-v15',
        existingAppointments: [],
        client: mockConfirmedClient,
        draft: {
          patient_id: 'pat-1',
          appointment_date: '2026-12-01',
          appointment_time: '09:00',
          duration_min: 30,
          type: 'checkup',
          status: 'scheduled',
        },
      });
      assert.equal(first.ok, true);
      assert.equal(first.resolutionStatus, 'confirmed');

      const crossActorReplay = await saveAppointmentCommand({
        actorRole: 'dentist',
        actorId: 'actor-B',
        idempotencyKey: 'shared-idemp-key-v15',
        existingAppointments: [],
        client: mockConfirmedClient,
        draft: {
          patient_id: 'pat-1',
          appointment_date: '2026-12-01',
          appointment_time: '09:00',
          duration_min: 30,
          type: 'checkup',
          status: 'scheduled',
        },
      });
      assert.equal(crossActorReplay.ok, false);
      assert.equal(crossActorReplay.errorCode, 'MINA_APPT_IDEMPOTENCY_ACTOR_MISMATCH');
      assert.equal(crossActorReplay.resolutionStatus, 'rejected');

      const missingSchemaRes = await saveAppointmentCommand({
        actorRole: 'secretary',
        actorId: 'actor-A',
        blockOnMissingSchema: true,
        existingAppointments: [],
        client: {
          rpc: async () => ({
            data: null,
            error: { message: 'Could not find the function public.book_or_update_appointment_v14 in the schema cache' },
          }),
        },
        draft: {
          patient_id: 'pat-1',
          appointment_date: '2026-12-01',
          appointment_time: '10:00',
          duration_min: 30,
          type: 'checkup',
          status: 'scheduled',
        },
      });
      assert.equal(missingSchemaRes.ok, false);
      assert.equal(missingSchemaRes.errorCode, 'MINA_APPT_SCHEMA_MISSING');

      const timeoutRes = await saveAppointmentCommand({
        actorRole: 'secretary',
        actorId: 'actor-A',
        existingAppointments: [],
        client: {
          rpc: async () => {
            throw new Error('Network request timeout while waiting for gateway response');
          },
        },
        draft: {
          patient_id: 'pat-1',
          appointment_date: '2026-12-01',
          appointment_time: '11:00',
          duration_min: 30,
          type: 'checkup',
          status: 'scheduled',
        },
      });
      assert.equal(timeoutRes.ok, false);
      assert.equal(timeoutRes.errorCode, 'MINA_APPT_AMBIGUOUS_COMMIT');
      assert.equal(timeoutRes.resolutionStatus, 'unknown');
    },
  );

  // -------------------------------------------------------------------------
  // V15-CL01-01 & V15-CL01-02: ISO 3950 (FDI) & Palmer Tooth Numbering +
  // Legacy Ambiguous 1..8 Detection & Clinician Reconciliation
  // -------------------------------------------------------------------------
  await runCase(
    results,
    'V15-CL01-01: ISO 3950 (FDI) and Palmer coordinates convert bijectively across all 32 permanent and 20 deciduous teeth',
    () => {
      assert.equal(ALL_CANONICAL_FDI_NUMBERS.length, 52);

      for (const fdiNum of ALL_CANONICAL_FDI_NUMBERS) {
        assert.equal(isValidFdiToothNumber(fdiNum), true);
        const coord = fdiToToothCoordinate(fdiNum);
        assert.ok(coord);
        const roundTripCode = palmerToFdiTooth(coord.palmerCode);
        assert.equal(roundTripCode?.fdi, fdiNum);
        const roundTripDisplay = palmerToFdiTooth(coord.palmerDisplay);
        assert.equal(roundTripDisplay?.fdi, fdiNum);
      }

      // Bare 1..8 are NOT valid FDI codes and are rejected by palmerToFdiTooth
      for (let n = 1; n <= 8; n++) {
        assert.equal(isValidFdiToothNumber(n), false);
        assert.equal(palmerToFdiTooth(String(n)), null);
      }
    },
  );

  await runCase(
    results,
    'V15-CL01-02: Bare legacy tooth_number 1..8 rows without quadrant are flagged ambiguous_requires_reconciliation and never auto-guessed',
    () => {
      clearOdontogramLedgerForTesting('pat-101');
      const legacyAmbiguous = classifyLegacyToothRecord({
        id: 'legacy-tooth-6',
        patient_id: 'pat-101',
        tooth_number: 6,
        condition: 'caries',
        surface: null,
        notes: 'پوسیدگی عمیق',
        updated_at: '2026-11-20T09:00:00Z',
      });
      assert.equal(legacyAmbiguous.validCoordinate, null);
      assert.equal(legacyAmbiguous.ambiguous?.status, 'ambiguous_requires_reconciliation');
      assert.deepEqual(legacyAmbiguous.ambiguous?.candidateFdiTeeth, [16, 26, 36, 46]);

      const legacyExplicitFdi = classifyLegacyToothRecord({
        id: 'legacy-tooth-26',
        patient_id: 'pat-101',
        tooth_number: 26,
        condition: 'crown',
        surface: null,
        notes: 'روکش زیرکونیا',
        updated_at: '2026-11-20T09:00:00Z',
      });
      assert.equal(legacyExplicitFdi.validCoordinate?.fdi, 26);
      assert.equal(legacyExplicitFdi.ambiguous, null);

      const recRes = reconcileAmbiguousLegacyToothCommand({
        patientId: 'pat-101',
        legacyRow: {
          id: 'legacy-tooth-6',
          patient_id: 'pat-101',
          tooth_number: 6,
          condition: 'caries',
          surface: null,
          notes: 'پوسیدگی عمیق',
          updated_at: '2026-11-20T09:00:00Z',
        },
        confirmedFdi: 26,
        authoredBy: 'دکتر مهدی امیری',
        authoredRole: 'manager',
      });
      assert.equal(recRes.ok, true);
      assert.equal(recRes.event?.fdi, 26);
      assert.equal(recRes.event?.provenanceSource, 'legacy_reconciled');
    },
  );

  // -------------------------------------------------------------------------
  // V15-CL02-01: Append-Only Odontogram History, not_examined vs healthy,
  // Surface Merge & Optimistic Concurrency
  // -------------------------------------------------------------------------
  await runCase(
    results,
    'V15-CL02-01: Uncharted teeth default to not_examined; marking a tooth healthy appends an observation without deleting history and merges concurrent surface findings',
    () => {
      clearOdontogramLedgerForTesting('pat-202');
      const initialProj = projectOdontogramCurrentState({ patientId: 'pat-202' });
      assert.equal(initialProj.teethByFdi[16].examinationState, 'not_examined');
      assert.equal(initialProj.teethByFdi[16].primaryFinding, 'not_examined');

      // Step 1: Record caries on Mesial ('m') surface of tooth 16
      const obs1 = appendOdontogramObservationCommand({
        patientId: 'pat-202',
        activeContextPatientId: 'pat-202',
        fdi: 16,
        scopeLevel: 'surface',
        surfaceCode: 'm',
        findingCode: 'caries',
        authoredBy: 'دکتر مهدی امیری',
        authoredRole: 'manager',
      });
      assert.equal(obs1.ok, true);

      // Step 2: Concurrent edit on Distal ('d') surface of tooth 16 preserves Mesial ('m')
      const obs2 = appendOdontogramObservationCommand({
        patientId: 'pat-202',
        activeContextPatientId: 'pat-202',
        fdi: 16,
        scopeLevel: 'surface',
        surfaceCode: 'd',
        findingCode: 'filled',
        authoredBy: 'دکتر سارا احمدی',
        authoredRole: 'dentist',
      });
      assert.equal(obs2.ok, true);
      assert.equal(obs2.projection?.surfaceFindings.m, 'caries');
      assert.equal(obs2.projection?.surfaceFindings.d, 'filled');

      // Step 3: Update Mesial ('m') to 'filled' (version 2), then test stale expectedVersion (1) conflict
      const obs3 = appendOdontogramObservationCommand({
        patientId: 'pat-202',
        activeContextPatientId: 'pat-202',
        fdi: 16,
        scopeLevel: 'surface',
        surfaceCode: 'm',
        findingCode: 'filled',
        expectedVersion: 1,
        authoredBy: 'دکتر مهدی امیری',
        authoredRole: 'manager',
      });
      assert.equal(obs3.ok, true);
      assert.equal(obs3.event?.version, 2);

      const staleConflict = appendOdontogramObservationCommand({
        patientId: 'pat-202',
        activeContextPatientId: 'pat-202',
        fdi: 16,
        scopeLevel: 'surface',
        surfaceCode: 'm',
        findingCode: 'root_canal',
        expectedVersion: 1,
        authoredBy: 'دکتر سارا احمدی',
        authoredRole: 'dentist',
      });
      assert.equal(staleConflict.ok, false);
      assert.equal(staleConflict.errorCode, 'MINA_ODONTOGRAM_VERSION_CONFLICT');

      // Step 4: Whole-tooth 'caries' then amended to 'healthy' retains full append-only history
      appendOdontogramObservationCommand({
        patientId: 'pat-202',
        activeContextPatientId: 'pat-202',
        fdi: 16,
        scopeLevel: 'whole_tooth',
        findingCode: 'caries',
        authoredBy: 'دکتر مهدی امیری',
        authoredRole: 'manager',
      });
      const healthyObs = appendOdontogramObservationCommand({
        patientId: 'pat-202',
        activeContextPatientId: 'pat-202',
        fdi: 16,
        scopeLevel: 'whole_tooth',
        findingCode: 'healthy',
        authoredBy: 'دکتر مهدی امیری',
        authoredRole: 'manager',
      });
      assert.equal(healthyObs.ok, true);
      assert.equal(healthyObs.projection?.examinationState, 'examined');
      assert.equal(healthyObs.projection?.historyCount, 5);
    },
  );

  // -------------------------------------------------------------------------
  // V15-CL03-01: Versioned Informed Consent Lifecycle
  // -------------------------------------------------------------------------
  await runCase(
    results,
    'V15-CL03-01: Printed unsigned consent is distinct from signed consent; signed consent requires online clinician confirmation, locks against in-place edits, and invalidates on plan change',
    () => {
      clearClinicalRecordLedgersForTesting();

      const printed = recordPrintedUnsignedConsentCommand({
        patientId: 'pat-303',
        activeContextPatientId: 'pat-303',
        consentType: 'implant',
        procedureScope: 'جراحی ایمپلنت دندان ۳۶',
        fdiTeethScope: '36',
        actorName: 'خانم رضایی',
        actorRole: 'secretary',
      });
      assert.equal(printed.ok, true);
      assert.equal(printed.record?.status, 'printed_unsigned');
      assert.equal(printed.record?.signedAt, null);

      const offlineSign = signPatientConsentCommand({
        patientId: 'pat-303',
        activeContextPatientId: 'pat-303',
        consentType: 'implant',
        procedureScope: 'جراحی ایمپلنت دندان ۳۶',
        fdiTeethScope: '36',
        risksDiscussed: true,
        alternativesDiscussed: true,
        signatureMethod: 'in_person_witnessed_electronic',
        signerFullName: 'علی رضایی',
        attendingClinicianName: 'دکتر مهدی امیری',
        actorName: 'دکتر مهدی امیری',
        actorRole: 'manager',
        isOffline: true,
      });
      assert.equal(offlineSign.ok, false);
      assert.equal(offlineSign.errorCode, 'MINA_CONSENT_ONLINE_REQUIRED');

      const signed = signPatientConsentCommand({
        patientId: 'pat-303',
        activeContextPatientId: 'pat-303',
        consentType: 'implant',
        procedureScope: 'جراحی ایمپلنت دندان ۳۶',
        fdiTeethScope: '36',
        risksDiscussed: true,
        alternativesDiscussed: true,
        signatureMethod: 'in_person_witnessed_electronic',
        signerFullName: 'علی رضایی',
        attendingClinicianName: 'دکتر مهدی امیری',
        actorName: 'دکتر مهدی امیری',
        actorRole: 'manager',
        isOffline: false,
      });
      assert.equal(signed.ok, true);
      assert.equal(signed.record?.status, 'signed');

      const inPlaceEdit = attemptInPlaceConsentEditCommand({
        patientId: 'pat-303',
        consentId: signed.record!.id,
        newProcedureScope: 'تغییر غیرمجاز درجا',
      });
      assert.equal(inPlaceEdit.ok, false);
      assert.equal(inPlaceEdit.errorCode, 'MINA_CONSENT_LOCKED_IMMUTABLE');

      const planChanged = invalidateConsentOnPlanChangeCommand({
        patientId: 'pat-303',
        consentId: signed.record!.id,
        planChangeReason: 'افزودن پیوند استخوان سینوس به طرح درمان',
      });
      assert.equal(planChanged.ok, true);
      assert.equal(planChanged.record?.status, 'superseded_by_plan_change');

      const withdrawn = withdrawPatientConsentCommand({
        patientId: 'pat-303',
        consentId: signed.record!.id,
        reason: 'انصراف بیمار پیش از شروع جراحی',
        actorRole: 'manager',
      });
      assert.equal(withdrawn.ok, true);
      assert.equal(withdrawn.record?.status, 'withdrawn');
    },
  );

  // -------------------------------------------------------------------------
  // V15-CL04-01: Encounter-Scoped Clinical Journey vs Longitudinal History
  // -------------------------------------------------------------------------
  await runCase(
    results,
    'V15-CL04-01: Past completed treatments or payments never falsely complete a newly scheduled, arrived, waiting, no-show, cancelled, or interrupted encounter',
    () => {
      const patient: Patient = {
        id: 'pat-404',
        first_name: 'نگار',
        last_name: 'شریفی',
        phone: '09123334455',
        national_id: '0011223344',
        birth_date: null,
        gender: 'female',
        blood_type: 'O+',
        allergies: null,
        medical_history: null,
        medications: null,
        insurance_provider: 'آزاد',
        insurance_number: '1405',
        address: null,
        email: null,
        notes: '[پرونده: 1405]',
        status: 'active',
        created_at: '2026-01-10T08:00:00Z',
        updated_at: '2026-01-10T08:00:00Z',
      };

      const oldCompletedAppointment: Appointment = {
        id: 'appt-old-1',
        patient_id: 'pat-404',
        appointment_date: '2026-05-01',
        appointment_time: '10:00',
        duration_minutes: 60,
        type: 'root_canal',
        status: 'completed',
        notes: null,
        created_at: '2026-05-01T09:00:00Z',
        updated_at: '2026-05-01T11:00:00Z',
      };
      const oldTreatment: Treatment = {
        id: 'treat-old-1',
        patient_id: 'pat-404',
        diagnosis: 'پالپیت دندان ۱۶ (۶ ماه پیش)',
        treatment_plan: 'عصب‌کشی کامل',
        tooth_numbers: '16',
        total_cost: 4_500_000,
        paid_amount: 4_500_000,
        status: 'completed',
        created_at: '2026-05-01T10:00:00Z',
        updated_at: '2026-05-01T11:00:00Z',
      };
      const oldPayment: Payment = {
        id: 'pay-old-1',
        patient_id: 'pat-404',
        treatment_id: 'treat-old-1',
        amount: 4_500_000,
        payment_method: 'card',
        payment_date: '2026-05-01',
        description: 'تسویه کامل ۶ ماه پیش',
        status: 'completed',
        created_at: '2026-05-01T11:10:00Z',
      };

      const newScheduledAppointment: Appointment = {
        id: 'appt-new-today',
        patient_id: 'pat-404',
        appointment_date: '2026-11-30',
        appointment_time: '10:30',
        duration_minutes: 30,
        type: 'checkup',
        status: 'scheduled',
        notes: 'معاینه جدید',
        created_at: '2026-11-30T07:00:00Z',
        updated_at: '2026-11-30T07:00:00Z',
      };

      const journeyScheduled = computePatientClinicalJourney({
        patient,
        appointments: [oldCompletedAppointment, newScheduledAppointment],
        treatments: [oldTreatment],
        payments: [oldPayment],
      });

      assert.equal(journeyScheduled.currentStageId, 'check_in');
      assert.equal(journeyScheduled.activeEncounter.episodeStatus, 'scheduled');
      assert.equal(journeyScheduled.activeEncounter.isNewEpisodeAfterHistoricalCompletion, true);
      assert.equal(journeyScheduled.longitudinalHistory.historicalCompletedTreatmentsCount, 1);

      const journeyArrived = computePatientClinicalJourney({
        patient,
        appointments: [oldCompletedAppointment, { ...newScheduledAppointment, status: 'arrived' }],
        treatments: [oldTreatment],
        payments: [oldPayment],
      });
      assert.equal(journeyArrived.currentStageId, 'waiting');
      assert.equal(journeyArrived.activeEncounter.episodeStatus, 'checked_in');

      const journeyNoShow = computePatientClinicalJourney({
        patient,
        appointments: [oldCompletedAppointment, { ...newScheduledAppointment, status: 'no_show' }],
        treatments: [oldTreatment],
        payments: [oldPayment],
      });
      assert.equal(journeyNoShow.activeEncounter.episodeStatus, 'no_show');
      assert.equal(journeyNoShow.currentStageId, 'appointment');

      // Payment during today's encounter WITHOUT completing today's treatment NEVER marks treatment_execution completed
      const todayAdvancePayment: Payment = {
        id: 'pay-today-advance',
        patient_id: 'pat-404',
        treatment_id: null,
        amount: 2_000_000,
        payment_method: 'card',
        payment_date: '2026-11-30',
        description: 'پیش‌پرداخت',
        status: 'completed',
        created_at: '2026-11-30T10:35:00Z',
      };
      const journeyPaidBeforeTreatment = computePatientClinicalJourney({
        patient,
        appointments: [oldCompletedAppointment, { ...newScheduledAppointment, status: 'in_progress' }],
        treatments: [oldTreatment],
        payments: [oldPayment, todayAdvancePayment],
      });
      assert.equal(journeyPaidBeforeTreatment.currentStageId, 'examination');
    },
  );

  // -------------------------------------------------------------------------
  // V15-CL05-01 & V15-CL06-01: Governed Patient Retention, Wrong-Patient
  // Context Guard, 4-State Allergy Verification & Clinical Note Amendment
  // -------------------------------------------------------------------------
  await runCase(
    results,
    'V15-CL05-01: Patients with clinical/financial history cannot be hard-deleted (archived instead); clinical notes follow draft -> signed -> amended without overwriting signed notes',
    async () => {
      clearClinicalRecordLedgersForTesting();

      const mockSupabase = {
        from: () => ({
          update: () => ({
            eq: () => ({
              select: async () => ({
                data: [{ id: 'pat-505', status: 'inactive' }],
                error: null,
              }),
            }),
          }),
        }),
      };

      const retentionRes = await archiveOrDeletePatientCommand({
        actorRole: 'manager',
        patientId: 'pat-505',
        treatments: [
          {
            id: 't-1',
            patient_id: 'pat-505',
            diagnosis: 'پوسیدگی',
            treatment_plan: null,
            tooth_numbers: '36',
            total_cost: 1_500_000,
            paid_amount: 0,
            status: 'completed',
            created_at: '2026-11-25T10:00:00Z',
            updated_at: '2026-11-25T10:00:00Z',
          },
        ],
        appointments: [],
        payments: [],
        supabaseClient: mockSupabase,
      });
      assert.equal(retentionRes.ok, true);
      assert.equal(retentionRes.actionTaken, 'archived');

      // Wrong-patient context guard blocks writes targeting another patient
      const wrongContextDraft = createClinicalNoteDraftCommand({
        patientId: 'pat-505',
        activeContextPatientId: 'pat-999-different',
        assessmentDiagnosis: 'تشخیص اشتباه',
        procedureNarrative: 'یادداشت اشتباه',
        authoredBy: 'دکتر مهدی امیری',
        authoredRole: 'manager',
      });
      assert.equal(wrongContextDraft.ok, false);
      assert.equal(wrongContextDraft.errorCode, 'MINA_WRONG_PATIENT_CONTEXT');

      // Clinical Note draft -> signed -> amended preserves original signed note
      const draftRes = createClinicalNoteDraftCommand({
        patientId: 'pat-505',
        activeContextPatientId: 'pat-505',
        fdiTeethScope: '36',
        assessmentDiagnosis: 'پوسیدگی عمیق دندان ۳۶',
        procedureNarrative: 'بی‌حسی بلاک فک پایین و تراش پوسیدگی دندان ۳۶',
        authoredBy: 'دکتر مهدی امیری',
        authoredRole: 'manager',
      });
      assert.equal(draftRes.ok, true);
      assert.equal(draftRes.note?.status, 'draft');

      const signedRes = signClinicalNoteCommand({
        patientId: 'pat-505',
        noteId: draftRes.note!.id,
        signerName: 'دکتر مهدی امیری',
        signerRole: 'manager',
        isOffline: false,
      });
      assert.equal(signedRes.ok, true);
      assert.equal(signedRes.note?.status, 'signed');

      const amendedRes = amendSignedClinicalNoteCommand({
        patientId: 'pat-505',
        parentNoteId: signedRes.note!.id,
        amendedDiagnosis: 'پوسیدگی عمیق دندان ۳۶ با نزدیک‌شدن به شاخک پالپ',
        amendedNarrative: 'بی‌حسی بلاک فک پایین، تراش پوسیدگی دندان ۳۶ و قرارگیری کف‌بندی کلسیم هیدروکساید',
        amendmentReason: 'افزودن جزئیات کف‌بندی پس از امضا',
        signerName: 'دکتر مهدی امیری',
        signerRole: 'manager',
        isOffline: false,
      });
      assert.equal(amendedRes.ok, true);
      assert.equal(amendedRes.amendmentNote?.status, 'amended');
      assert.equal(amendedRes.amendmentNote?.parentNoteId, signedRes.note!.id);
      assert.equal(amendedRes.originalNote?.procedureNarrative, 'بی‌حسی بلاک فک پایین و تراش پوسیدگی دندان ۳۶');
    },
  );

  await runCase(
    results,
    'V15-CL06-01: Empty free-text allergy field defaults to not_asked (never no_known), and structured 4-state allergy verification distinguishes not_asked, unknown, no_known, and present',
    () => {
      clearClinicalRecordLedgersForTesting();

      const emptyAllergyPatient = {
        id: 'pat-606',
        allergies: null,
        medical_history: null,
        medications: null,
      } as unknown as Patient;

      const initialAssessment = assessPatientAllergySafety(emptyAllergyPatient);
      assert.equal(initialAssessment.verificationStatus, 'not_asked');
      assert.equal(initialAssessment.requiresClinicalInquiry, true);

      const nkaReview = recordStructuredAllergyReviewCommand({
        patientId: 'pat-606',
        activeContextPatientId: 'pat-606',
        status: 'no_known',
        certainty: 'confirmed_by_clinician',
        reviewedBy: 'دکتر مهدی امیری',
        reviewerRole: 'manager',
      });
      assert.equal(nkaReview.ok, true);
      const afterNka = assessPatientAllergySafety(emptyAllergyPatient);
      assert.equal(afterNka.verificationStatus, 'no_known');
      assert.equal(afterNka.requiresClinicalInquiry, false);

      const invalidPresent = recordStructuredAllergyReviewCommand({
        patientId: 'pat-606',
        activeContextPatientId: 'pat-606',
        status: 'present',
        substanceAgent: '',
        reviewedBy: 'دکتر مهدی امیری',
        reviewerRole: 'manager',
      });
      assert.equal(invalidPresent.ok, false);
      assert.equal(invalidPresent.errorCode, 'MINA_ALLERGY_AGENT_REQUIRED');
    },
  );

  // -------------------------------------------------------------------------
  // V15-CL07-01: Modularity (<500 lines) & Architecture Artifacts
  // -------------------------------------------------------------------------
  await runCase(
    results,
    'V15-CL07-01: Patients.tsx and PalmerChart.tsx are modularized under 500 lines and V15 architecture artifacts and milestone-17 exist',
    () => {
      const patientsLines = fs
        .readFileSync(path.join(rootDir, 'src/components/sections/Patients.tsx'), 'utf8')
        .split('\n').length;
      const palmerLines = fs
        .readFileSync(path.join(rootDir, 'src/components/PalmerChart.tsx'), 'utf8')
        .split('\n').length;
      const clinicalTabsLines = fs
        .readFileSync(path.join(rootDir, 'src/features/patients/PatientClinicalTabs.tsx'), 'utf8')
        .split('\n').length;
      const financeTabsLines = fs
        .readFileSync(path.join(rootDir, 'src/features/patients/PatientFinanceAndSpecialtyTabs.tsx'), 'utf8')
        .split('\n').length;

      const specialtyTabsLines = fs
        .readFileSync(path.join(rootDir, 'src/features/patients/PatientSpecialtyTabs.tsx'), 'utf8')
        .split('\n').length;
      const detailHubLines = fs
        .readFileSync(path.join(rootDir, 'src/features/patients/PatientDetailHub.tsx'), 'utf8')
        .split('\n').length;

      assert.ok(patientsLines <= 500, `Expected Patients.tsx <= 500 lines, got ${patientsLines}`);
      assert.ok(palmerLines <= 500, `Expected PalmerChart.tsx <= 500 lines, got ${palmerLines}`);
      assert.ok(clinicalTabsLines <= 500, `Expected PatientClinicalTabs.tsx <= 500 lines, got ${clinicalTabsLines}`);
      assert.ok(
        financeTabsLines <= 500,
        `Expected PatientFinanceAndSpecialtyTabs.tsx <= 500 lines, got ${financeTabsLines}`,
      );
      assert.ok(specialtyTabsLines <= 500, `Expected PatientSpecialtyTabs.tsx <= 500 lines, got ${specialtyTabsLines}`);
      assert.ok(detailHubLines <= 500, `Expected PatientDetailHub.tsx <= 500 lines, got ${detailHubLines}`);

      assert.ok(
        fs.existsSync(
          path.join(rootDir, 'supabase/migrations/20261130000000_v15_clinical_record_odontogram_and_patient_safety.sql'),
        ),
      );
      assert.ok(
        fs.existsSync(path.join(rootDir, 'docs/architecture/V15-clinical-record-odontogram-and-patient-safety.md')),
      );
      assert.ok(
        fs.existsSync(
          path.join(rootDir, 'docs/architecture/ADR-005-clinical-record-append-only-odontogram-and-encounter-scope.md'),
        ),
      );
      assert.ok(
        PERMANENT_PROJECT_ROADMAP.some(
          (m) => m.id === 'milestone-17' && m.traceId === 'TRC-MINA-V15-CLINICAL-SAFETY-9017-P' && m.locked,
        ),
      );
    },
  );

  return results;
}
