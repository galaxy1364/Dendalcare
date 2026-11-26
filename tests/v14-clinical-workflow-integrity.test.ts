import fs from 'node:fs';
import path from 'node:path';
import {
  canAccessRoute,
  canPerformAction,
  resolveEffectiveRole,
  resolveStrictMembershipRole,
} from '../src/services/permissions/accessControl';
import {
  getRuntimeAuthStatus,
  getRuntimeServerVerifiedRole,
  setRuntimeAuthSnapshot,
} from '../src/services/authentication/authService';
import {
  createGuardedSupabaseClient,
  evaluateMutationGuard,
  getMutationOutcome,
  hasZeroAffectedRows,
  verifyServerMutation,
} from '../src/lib/supabaseGuardian';
import {
  clearOfflineQueue,
  enqueueOfflineMutation,
  getOfflineQueue,
  processOfflineQueue,
} from '../src/lib/offlineQueue';
import {
  clearAppointmentIdempotencyWindow,
  deleteAppointmentCommand,
  saveAppointmentCommand,
  transitionAppointmentStatusCommand,
} from '../src/features/appointments/appointmentCommandService';
import {
  CANONICAL_CLINICAL_JOURNEY_STAGE_IDS,
  computePatientClinicalJourney,
} from '../src/features/clinical-journey/patientJourney';

export interface V14TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const ROOT = process.cwd();

function expect(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function runCase(name: string, fn: () => void | Promise<void>): Promise<V14TestResult> {
  try {
    await fn();
    return { name, passed: true };
  } catch (err) {
    return {
      name,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runAllV14ClinicalWorkflowIntegrityTests(): Promise<V14TestResult[]> {
  const results: V14TestResult[] = [];

  results.push(
    await runCase(
      'V14-01: AppProviders uses resolveStrictMembershipRole and eliminates all permissive role fallbacks across runtime, guardian, and offline replay',
      async () => {
        const providersPath = path.join(ROOT, 'src', 'app', 'AppProviders.tsx');
        const providersSrc = fs.readFileSync(providersPath, 'utf8');
        expect(
          providersSrc.includes('resolveStrictMembershipRole') &&
            !providersSrc.includes('resolveEffectiveRole'),
          'AppProviders.tsx must import and use resolveStrictMembershipRole with zero legacy resolveEffectiveRole references'
        );

        // 1. Revoked / unauthorized session or authenticated session without serverVerifiedRole -> 'unauthorized'
        for (const resolver of [resolveStrictMembershipRole, resolveEffectiveRole]) {
          expect(
            resolver({
              serverVerifiedRole: null,
              localRole: 'manager',
              sessionStatus: 'unauthorized',
            }) === 'unauthorized',
            'Revoked membership session must resolve to unauthorized, never assistant or manager'
          );
          expect(
            resolver({
              serverVerifiedRole: null,
              localRole: 'manager',
              sessionStatus: 'authenticated',
            }) === 'unauthorized',
            'Authenticated session without server-verified role must resolve to unauthorized, never secretary'
          );
          expect(
            resolver({
              serverVerifiedRole: 'invalid_role',
              localRole: 'manager',
              sessionStatus: 'authenticated',
            }) === 'unauthorized',
            'Invalid server role must resolve to unauthorized'
          );
          expect(
            resolver({
              serverVerifiedRole: 'dentist',
              localRole: 'manager',
              sessionStatus: 'authenticated',
            }) === 'dentist',
            'Valid server role must take precedence over local role'
          );
        }

        // 2. Every route and action must be denied for 'unauthorized'
        for (const route of [
          'dashboard',
          'appointments',
          'patients',
          'treatments',
          'finance',
          'reports',
          'settings',
          'appointment_form',
        ]) {
          expect(!canAccessRoute('unauthorized', route), `Route ${route} must be denied for unauthorized`);
        }
        for (const action of [
          'appointment_create',
          'appointment_edit',
          'appointment_status_transition',
          'appointment_delete',
          'patient_create',
          'treatment_create',
          'payment_create',
        ] as const) {
          expect(!canPerformAction('unauthorized', action), `Action ${action} must be denied for unauthorized`);
        }

        // 3. evaluateMutationGuard and createGuardedSupabaseClient must block mutations on unauthorized sessions without queuing offline
        const guardRes = evaluateMutationGuard({
          table: 'patients',
          operation: 'INSERT',
          payload: { first_name: 'Revoked' },
          actor: {
            role: 'unauthorized',
            fullName: 'کاربر تعلیق‌شده',
            canEditPricesAfterSave: false,
            canDeleteCriticalRecords: false,
            sessionStatus: 'unauthorized',
          },
        });
        expect(!guardRes.allowed, 'evaluateMutationGuard must reject unauthorized session actor');

        setRuntimeAuthSnapshot({ status: 'unauthorized', serverVerifiedRole: null });
        expect(getRuntimeAuthStatus() === 'unauthorized', 'Runtime auth status must reflect unauthorized');
        expect(getRuntimeServerVerifiedRole() === null, 'Runtime server role must be null when unauthorized');

        let backendCalledOnUnauthorized = false;
        const mockRawClient: any = {
          from: () => ({
            insert: () => ({
              select: () => ({
                then: (resolve: any) => {
                  backendCalledOnUnauthorized = true;
                  resolve({ data: [{ id: 'should-not-run' }], error: null, status: 201 });
                },
              }),
              then: (resolve: any) => {
                backendCalledOnUnauthorized = true;
                resolve({ data: [{ id: 'should-not-run' }], error: null, status: 201 });
              },
            }),
          }),
        };
        const guarded = createGuardedSupabaseClient(mockRawClient);
        const deniedWrite: any = await (guarded.from('patients') as any).insert({
          first_name: 'Blocked',
          last_name: 'Patient',
        });
        expect(
          !backendCalledOnUnauthorized && deniedWrite.status === 403 && deniedWrite.queuedOffline === false,
          `Guarded client must reject unauthorized session with 403 and zero offline queue, got ${JSON.stringify(deniedWrite)}`
        );

        // 4. processOfflineQueue must block replay when session is 'unauthorized'
        clearOfflineQueue();
        enqueueOfflineMutation('patients', 'INSERT', { id: 'p-queued-1', first_name: 'Queued' });
        expect(getOfflineQueue().length === 1, 'Expected 1 queued offline mutation');
        const replayRes = await processOfflineQueue();
        expect(
          replayRes.processed === 0 &&
            replayRes.blocked === 1 &&
            replayRes.errors.includes('UNAUTHORIZED_SESSION_REPLAY_BLOCKED') &&
            getOfflineQueue().length === 1,
          `Offline replay must be blocked while session is unauthorized, got ${JSON.stringify(replayRes)}`
        );
        clearOfflineQueue();
        setRuntimeAuthSnapshot({ status: 'unauthenticated', serverVerifiedRole: null });
      }
    )
  );

  results.push(
    await runCase(
      'V14-02: Incremental V14 PostgreSQL migration enforces transactional scheduling, persistent idempotency, advisory locking, direct-API trigger protection, and legal transitions without replaying V12 migrations',
      () => {
        const migDir = path.join(ROOT, 'supabase', 'migrations');
        const baselinesDir = path.join(ROOT, 'supabase', 'baselines');
        const v14MigPath = path.join(
          migDir,
          '20261129000000_v14_transactional_scheduling_and_clinical_journey.sql'
        );
        expect(fs.existsSync(v14MigPath), 'Missing V14 PostgreSQL migration file');

        // Verify the 3 V12 baseline files remain intact and are not duplicated into V14
        const v12Baselines = fs.readdirSync(baselinesDir).filter((f) => f.startsWith('v12_'));
        expect(v12Baselines.length === 3, `Expected 3 V12 baseline files, found ${v12Baselines.length}`);

        const sql = fs.readFileSync(v14MigPath, 'utf8');
        expect(
          /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.appointment_command_idempotency/i.test(sql) &&
            /ALTER\s+TABLE\s+public\.appointment_command_idempotency\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql),
          'V14 migration must create appointment_command_idempotency with FORCE ROW LEVEL SECURITY'
        );
        expect(
          /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.app_is_legal_appointment_transition/i.test(sql),
          'V14 migration must define app_is_legal_appointment_transition'
        );
        expect(
          /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+private\.enforce_appointment_invariants/i.test(sql) &&
            /CREATE\s+TRIGGER\s+appointments_enforce_v14_invariants\s+BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.appointments/i.test(
              sql
            ),
          'V14 migration must attach BEFORE INSERT OR UPDATE trigger appointments_enforce_v14_invariants to prevent direct API bypass'
        );
        expect(
          /pg_advisory_xact_lock/i.test(sql),
          'V14 trigger must acquire transaction-scoped advisory lock (pg_advisory_xact_lock) for concurrent booking protection'
        );
        expect(
          /ROOM_CONFLICT/i.test(sql) &&
            /STAFF_CONFLICT/i.test(sql) &&
            /PATIENT_CONFLICT/i.test(sql) &&
            /MINA_APPT_CONFLICT/i.test(sql),
          'V14 trigger must enforce room, staff, and patient overlap detection server-side'
        );
        expect(
          /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.book_or_update_appointment_v14/i.test(sql) &&
            /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.transition_appointment_status_v14/i.test(sql),
          'V14 migration must define transactional RPCs book_or_update_appointment_v14 and transition_appointment_status_v14'
        );
        expect(
          /GET\s+DIAGNOSTICS\s+v_affected\s*=\s*ROW_COUNT/i.test(sql),
          'V14 RPCs must verify actual affected rows via GET DIAGNOSTICS ROW_COUNT'
        );
        expect(
          /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.book_or_update_appointment_v14[\s\S]*FROM\s+PUBLIC,\s*anon/i.test(
            sql
          ),
          'V14 RPCs must revoke PUBLIC and anon execution privileges'
        );
      }
    )
  );

  results.push(
    await runCase(
      'V14-03: appointmentCommandService enforces concurrency deduplication, persistent idempotency conflict detection, transactional RPC execution, zero-row update rejection, and honest offline queueing',
      async () => {
        setRuntimeAuthSnapshot({ status: 'authenticated', serverVerifiedRole: 'secretary' });
        clearAppointmentIdempotencyWindow();

        // 1. Unauthorized session or assistant role is rejected fail-closed before touching DB
        setRuntimeAuthSnapshot({ status: 'unauthorized', serverVerifiedRole: null });
        const revokedRes = await saveAppointmentCommand({
          actorRole: 'manager',
          existingAppointments: [],
          draft: {
            patient_id: '00000000-0000-0000-0000-000000000101',
            title: 'ویزیت',
            appointment_date: '2026-11-30',
            appointment_time: '09:00',
            duration_min: 30,
            type: 'checkup',
            room: 'یونیت ۱',
          },
        });
        expect(
          !revokedRes.ok &&
            revokedRes.errorCode === 'MINA_APPT_UNAUTHORIZED' &&
            revokedRes.affectedRows === 0,
          `Revoked session must fail closed with MINA_APPT_UNAUTHORIZED and 0 affected rows, got ${JSON.stringify(revokedRes)}`
        );

        setRuntimeAuthSnapshot({ status: 'authenticated', serverVerifiedRole: 'secretary' });

        // 2. Concurrent booking requests with same idempotencyKey execute RPC exactly once and return persisted result on subsequent replay
        let rpcCallCount = 0;
        const mockRpcClient: any = {
          rpc: async (fnName: string, args: Record<string, unknown>) => {
            expect(fnName === 'book_or_update_appointment_v14', `Unexpected RPC name ${fnName}`);
            rpcCallCount += 1;
            await new Promise((r) => setTimeout(r, 25));
            return {
              data: {
                ok: true,
                idempotent_replay: false,
                affected_rows: 1,
                appointment_id: '00000000-0000-0000-0000-000000000777',
                record: {
                  id: '00000000-0000-0000-0000-000000000777',
                  patient_id: args.p_patient_id,
                  title: args.p_title,
                  appointment_date: args.p_appointment_date,
                  appointment_time: args.p_appointment_time,
                  duration_min: args.p_duration_min,
                  room: args.p_room,
                  status: args.p_status,
                },
              },
              error: null,
              status: 200,
            };
          },
        };

        const draftPayload = {
          tenant_id: 'minadental_clinic',
          branch_id: 'main',
          patient_id: '00000000-0000-0000-0000-000000000101',
          title: 'جراحی ایمپلنت',
          appointment_date: '2026-11-30',
          appointment_time: '10:00',
          duration_min: 45,
          type: 'implant',
          room: 'یونیت ۱',
        };

        const [concurrentA, concurrentB] = await Promise.all([
          saveAppointmentCommand({
            actorRole: 'secretary',
            existingAppointments: [],
            draft: draftPayload,
            idempotencyKey: 'idem-v14-concurrent-1',
            supabaseClient: mockRpcClient,
          }),
          saveAppointmentCommand({
            actorRole: 'secretary',
            existingAppointments: [],
            draft: draftPayload,
            idempotencyKey: 'idem-v14-concurrent-1',
            supabaseClient: mockRpcClient,
          }),
        ]);

        expect(
          concurrentA.ok &&
            concurrentB.ok &&
            rpcCallCount === 1 &&
            concurrentA.affectedRows === 1 &&
            (concurrentA.data as any)?.id === '00000000-0000-0000-0000-000000000777',
          `Concurrent identical requests must deduplicate to 1 RPC call and return 1 affected row, got rpcCallCount=${rpcCallCount}, res=${JSON.stringify(concurrentA)}`
        );

        // Subsequent replay with same idempotencyKey and same payload returns persisted idempotent replay without re-hitting RPC
        const replaySame = await saveAppointmentCommand({
          actorRole: 'secretary',
          existingAppointments: [],
          draft: draftPayload,
          idempotencyKey: 'idem-v14-concurrent-1',
          supabaseClient: mockRpcClient,
        });
        expect(
          replaySame.ok &&
            replaySame.idempotentReplay === true &&
            rpcCallCount === 1 &&
            replaySame.affectedRows === 1,
          `Persisted idempotency replay must return idempotentReplay=true without extra RPC call, got ${JSON.stringify(replaySame)}`
        );

        // Reusing the same idempotencyKey with a DIFFERENT payload must be rejected with MINA_APPT_IDEMPOTENCY_CONFLICT
        const replayConflict = await saveAppointmentCommand({
          actorRole: 'secretary',
          existingAppointments: [],
          draft: { ...draftPayload, appointment_time: '11:30' },
          idempotencyKey: 'idem-v14-concurrent-1',
          supabaseClient: mockRpcClient,
        });
        expect(
          !replayConflict.ok && replayConflict.errorCode === 'MINA_APPT_IDEMPOTENCY_CONFLICT',
          `Idempotency key reuse with different payload must fail with MINA_APPT_IDEMPOTENCY_CONFLICT, got ${JSON.stringify(replayConflict)}`
        );

        // 3. Zero-row update/transition/delete must NEVER be reported as confirmed
        expect(
          hasZeroAffectedRows({ data: [], error: null }) === true &&
            verifyServerMutation({ data: [], error: null }) === false &&
            getMutationOutcome({ data: [], error: null }) === 'error',
          'Empty array data: [] must be detected as zero affected rows and outcome=error'
        );

        const zeroRowRpcClient: any = {
          rpc: async () => ({
            data: {
              ok: true,
              affected_rows: 0,
              record: null,
            },
            error: null,
            status: 200,
          }),
        };

        const zeroUpdateRes = await saveAppointmentCommand({
          actorRole: 'secretary',
          editingId: '00000000-0000-0000-0000-000000000999',
          currentStatus: 'confirmed',
          existingAppointments: [],
          draft: { ...draftPayload, appointment_time: '14:00' },
          idempotencyKey: 'idem-v14-zero-row-update',
          supabaseClient: zeroRowRpcClient,
        });
        expect(
          !zeroUpdateRes.ok &&
            zeroUpdateRes.outcome === 'error' &&
            zeroUpdateRes.errorCode === 'MINA_APPT_ZERO_ROWS' &&
            zeroUpdateRes.affectedRows === 0,
          `Zero-row appointment update must fail with MINA_APPT_ZERO_ROWS, got ${JSON.stringify(zeroUpdateRes)}`
        );

        const zeroTransitionRes = await transitionAppointmentStatusCommand({
          actorRole: 'secretary',
          appointmentId: '00000000-0000-0000-0000-000000000999',
          fromStatus: 'confirmed',
          toStatus: 'arrived',
          supabaseClient: zeroRowRpcClient,
        });
        expect(
          !zeroTransitionRes.ok &&
            zeroTransitionRes.outcome === 'error' &&
            zeroTransitionRes.errorCode === 'MINA_APPT_ZERO_ROWS' &&
            zeroTransitionRes.affectedRows === 0,
          `Zero-row status transition must fail with MINA_APPT_ZERO_ROWS, got ${JSON.stringify(zeroTransitionRes)}`
        );

        const zeroDeleteClient: any = {
          from: () => ({
            delete: () => ({
              eq: () => ({
                select: async () => ({ data: [], error: null, status: 200 }),
              }),
            }),
          }),
        };
        const zeroDeleteRes = await deleteAppointmentCommand({
          actorRole: 'manager',
          appointmentId: '00000000-0000-0000-0000-000000000999',
          supabaseClient: zeroDeleteClient,
        });
        expect(
          !zeroDeleteRes.ok &&
            zeroDeleteRes.outcome === 'error' &&
            zeroDeleteRes.errorCode === 'MINA_APPT_ZERO_ROWS' &&
            zeroDeleteRes.affectedRows === 0,
          `Zero-row delete must fail with MINA_APPT_ZERO_ROWS, got ${JSON.stringify(zeroDeleteRes)}`
        );

        // 4. Queued offline operations must report outcome='queued_offline' and affectedRows=0 (never 'confirmed')
        const offlineMockClient: any = {
          from: () => ({
            insert: () => ({
              select: async () => ({
                data: [{ id: 'queued-temp' }],
                error: null,
                status: 202,
                queuedOffline: true,
                serverConfirmed: false,
              }),
            }),
          }),
        };
        const offlineSaveRes = await saveAppointmentCommand({
          actorRole: 'secretary',
          existingAppointments: [],
          draft: { ...draftPayload, appointment_time: '16:00' },
          idempotencyKey: 'idem-v14-offline-1',
          supabaseClient: offlineMockClient,
        });
        expect(
          offlineSaveRes.ok === true &&
            offlineSaveRes.outcome === 'queued_offline' &&
            offlineSaveRes.affectedRows === 0,
          `Offline queued appointment must return outcome=queued_offline and affectedRows=0, got ${JSON.stringify(offlineSaveRes)}`
        );

        clearAppointmentIdempotencyWindow();
        setRuntimeAuthSnapshot({ status: 'unauthenticated', serverVerifiedRole: null });
      }
    )
  );

  results.push(
    await runCase(
      'V14-04: Unified 9-Stage Clinical Patient Journey connects reception -> appointment -> check_in -> waiting -> examination -> treatment_planning -> treatment_execution -> billing -> follow_up with exact financial math and HL7 FHIR R4 mapping',
      () => {
        expect(
          CANONICAL_CLINICAL_JOURNEY_STAGE_IDS.length === 9 &&
            CANONICAL_CLINICAL_JOURNEY_STAGE_IDS.join(',') ===
              'reception,appointment,check_in,waiting,examination,treatment_planning,treatment_execution,billing,follow_up',
          `Expected 9 canonical clinical journey stages, got ${CANONICAL_CLINICAL_JOURNEY_STAGE_IDS.join(',')}`
        );

        const patient: any = {
          id: 'pt-v14-1',
          first_name: 'مریم',
          last_name: 'محمدی',
          phone: '09121112233',
          status: 'active',
        };

        // Stage 1: New patient registered at reception -> reception completed, appointment active
        const j1 = computePatientClinicalJourney({
          patient,
          appointments: [],
          treatments: [],
          payments: [],
        });
        expect(
          j1.stages[0].id === 'reception' &&
            j1.stages[0].state === 'completed' &&
            j1.currentStageId === 'appointment' &&
            j1.nextActionRoute === 'appointment_form',
          `New patient journey should be at appointment booking stage, got ${JSON.stringify(j1)}`
        );

        // Stage 3/4: Patient arrived and waiting in lobby
        const jWaiting = computePatientClinicalJourney({
          patient,
          appointments: [
            {
              id: 'ap-1',
              patient_id: 'pt-v14-1',
              title: 'معاینه',
              appointment_date: '2026-11-30',
              appointment_time: '10:00',
              duration_min: 30,
              type: 'checkup',
              status: 'waiting',
              room: 'یونیت ۱',
              notes: null,
              staff_id: null,
              created_at: '2026-11-30T06:00:00Z',
            },
          ],
          treatments: [],
          payments: [],
        });
        expect(
          jWaiting.stages.find((s) => s.id === 'check_in')?.state === 'completed' &&
            jWaiting.stages.find((s) => s.id === 'waiting')?.state === 'current' &&
            jWaiting.currentStageId === 'examination',
          `Waiting patient should advance currentStageId to examination, got ${jWaiting.currentStageId}`
        );

        // Stage 7 -> 8: Treatment completed with remaining balance -> billing active
        const jBilling = computePatientClinicalJourney({
          patient,
          appointments: [
            {
              id: 'ap-1',
              patient_id: 'pt-v14-1',
              title: 'درمان ریشه',
              appointment_date: '2026-11-30',
              appointment_time: '10:00',
              duration_min: 60,
              type: 'treatment',
              status: 'completed',
              room: 'یونیت ۱',
              notes: null,
              staff_id: null,
              created_at: '2026-11-30T06:00:00Z',
            },
          ],
          treatments: [
            {
              id: 'tr-1',
              patient_id: 'pt-v14-1',
              appointment_id: 'ap-1',
              staff_id: null,
              diagnosis: 'پالپیت برگشت‌ناپذیر دندان ۶ بالا راست',
              treatment_plan: 'درمان ریشه ۳ کاناله + بیلدآپ کامپوزیت',
              tooth_numbers: 'UR6',
              status: 'completed',
              total_cost: 6_000_000,
              discount: 500_000,
              paid_amount: 2_500_000,
              doctor_cost: 0,
              lab_cost: 0,
              material_cost: 0,
              other_cost: 0,
              notes: null,
              performed_at: '2026-11-30T07:00:00Z',
              completed_at: '2026-11-30T07:30:00Z',
              created_at: '2026-11-30T06:30:00Z',
            },
          ],
          payments: [
            {
              id: 'pay-1',
              patient_id: 'pt-v14-1',
              treatment_id: 'tr-1',
              amount: 2_500_000,
              payment_method: 'card',
              payment_date: '2026-11-30',
              reference_number: '1001',
              notes: null,
              created_at: '2026-11-30T07:35:00Z',
            },
          ],
        });
        expect(
          jBilling.netTreatmentCost === 5_500_000 &&
            jBilling.totalPaidAmount === 2_500_000 &&
            jBilling.outstandingBalance === 3_000_000 &&
            jBilling.currentStageId === 'billing' &&
            jBilling.nextActionRoute === 'finance',
          `Expected net=5,500,000, paid=2,500,000, balance=3,000,000 and currentStage=billing, got ${JSON.stringify(jBilling)}`
        );

        // Stage 9: Full payment + follow-up reminder -> all 9 stages completed (100%)
        const jComplete = computePatientClinicalJourney({
          patient,
          appointments: [
            {
              id: 'ap-1',
              patient_id: 'pt-v14-1',
              title: 'درمان ریشه',
              appointment_date: '2026-11-30',
              appointment_time: '10:00',
              duration_min: 60,
              type: 'treatment',
              status: 'completed',
              room: 'یونیت ۱',
              notes: null,
              staff_id: null,
              created_at: '2026-11-30T06:00:00Z',
            },
          ],
          treatments: [
            {
              id: 'tr-1',
              patient_id: 'pt-v14-1',
              appointment_id: 'ap-1',
              staff_id: null,
              diagnosis: 'پالپیت برگشت‌ناپذیر دندان ۶ بالا راست',
              treatment_plan: 'درمان ریشه ۳ کاناله + بیلدآپ کامپوزیت',
              tooth_numbers: 'UR6',
              status: 'completed',
              total_cost: 6_000_000,
              discount: 500_000,
              paid_amount: 5_500_000,
              doctor_cost: 0,
              lab_cost: 0,
              material_cost: 0,
              other_cost: 0,
              notes: null,
              performed_at: '2026-11-30T07:00:00Z',
              completed_at: '2026-11-30T07:30:00Z',
              created_at: '2026-11-30T06:30:00Z',
            },
          ],
          payments: [
            {
              id: 'pay-1',
              patient_id: 'pt-v14-1',
              treatment_id: 'tr-1',
              amount: 5_500_000,
              payment_method: 'card',
              payment_date: '2026-11-30',
              reference_number: '1001',
              notes: null,
              created_at: '2026-11-30T07:35:00Z',
            },
          ],
          reminders: [
            {
              id: 'rem-1',
              patient_id: 'pt-v14-1',
              title: 'چکاپ ۶ ماهه پس از درمان ریشه',
              description: null,
              due_date: '2027-05-30',
              due_time: '10:00',
              category: 'follow_up',
              priority: 'medium',
              status: 'pending',
              lead_days: 3,
              auto_generated: false,
              source_id: 'tr-1',
              created_at: '2026-11-30T07:40:00Z',
            },
          ],
        });
        expect(
          jComplete.progressPercent === 100 &&
            jComplete.outstandingBalance === 0 &&
            jComplete.stages.every((s) => s.state === 'completed' && s.fhirResource.length > 0),
          `Expected 100% completion across all 9 stages with HL7 FHIR resource mappings, got ${JSON.stringify(jComplete)}`
        );
      }
    )
  );

  return results;
}
