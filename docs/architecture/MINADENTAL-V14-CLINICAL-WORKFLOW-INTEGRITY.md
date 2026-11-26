# MinaDental V14 — Clinical Workflow Integrity, Transactional Scheduling & Fail-Closed Authorization Contract
Date: 2026-11-26 | Preserved in Permanent Architecture Memory
Reviewed Baseline Commit: `466e6360834ddbc83c69fde9504566a1c1529690` / `2b8fb4bff7e8adff429b668f7c51aa3166252d1e`
Authoritative Coordination Reference: https://github.com/galaxy1364/Dendalcare/issues/4

## 1. Zero-Fallback Runtime Authorization (`resolveStrictMembershipRole` & `AppProviders`)
- **Blocker Resolved**: `AppProviders.tsx` previously imported and invoked legacy `resolveEffectiveRole`, which degraded `'unauthorized'` sessions to `'assistant'` and authenticated sessions without `serverVerifiedRole` to `'secretary'`.
- **Mandatory V14 Policy (OWASP ASVS 5.0 V4 Access Control)**:
  - `AppProviders.tsx` and the entire runtime shell (`AppShell`, `AppRouter`, `NavigationProvider`, `FloatingDock`, `NavigationRail`) MUST compute `effectiveRole` via `resolveStrictMembershipRole`.
  - When `verifiedSession.status === 'unauthorized'` (e.g., Supabase Auth user exists or JWT has stale `app_metadata`, but `clinic_memberships` is missing, inactive/revoked, or branch-mismatched) or when `verifiedSession.status === 'authenticated'` without a valid `serverVerifiedRole`, `effectiveRole` MUST resolve strictly to `'unauthorized'`.
  - When `effectiveRole === 'unauthorized'`, `canAccessRoute(effectiveRole, route)` and `canPerformAction(effectiveRole, action)` return `false` for **every** route and action (zero fallback to `'assistant'` or `'secretary'`).
  - `supabaseGuardian.ts` MUST check active runtime authorization before executing or queuing any table mutation: if the active session is `'unauthorized'`, all mutations (`INSERT`, `UPDATE`, `UPSERT`, `DELETE`) are rejected immediately with `403 MINA_AUTH_REVOKED` and are **never** enqueued into the offline queue.
  - `processOfflineQueue` MUST verify that the runtime session is not `'unauthorized'` before replaying queued offline mutations.

## 2. Authoritative Transactional Scheduling & Trigger Enforcement in PostgreSQL (`v14_transactional_scheduling_and_clinical_journey.sql`)
- **Blocker Resolved**: `appointmentCommandService` previously relied only on client-side conflict checks and a 4-second in-memory `Map` idempotency guard, while direct `INSERT`/`UPDATE` on `public.appointments` could bypass scheduling invariants and `assistant` (via `operations` category) could mutate appointments directly.
- **Mandatory V14 Database Contract**:
  - Do **NOT** replay the three already-applied V12 migrations (`20261125213357`, `20261125213523`, `20261125213554`).
  - Add incremental, idempotent migration `supabase/migrations/20261129000000_v14_transactional_scheduling_and_clinical_journey.sql`:
    1. **Persistent Idempotency Ledger (`public.appointment_command_idempotency`)**:
       - Stores `(tenant_id, branch_id, client_request_id)` primary key, `appointment_id`, `actor_id`, `operation`, `payload_hash`, `response_payload`, and `created_at` with `FORCE ROW LEVEL SECURITY`.
    2. **Trigger-Enforced Table Invariants (`private.enforce_appointment_invariants`)**:
       - Runs `BEFORE INSERT OR UPDATE ON public.appointments` so direct PostgREST/API writes cannot bypass scheduling rules.
       - Verifies server-side role via `public.app_resolve_verified_role(NEW.tenant_id, NEW.branch_id) IN ('manager', 'dentist', 'secretary')` (blocks `'assistant'` and revoked/unauthorized users from direct table writes).
       - Acquires transaction-scoped advisory xact lock `pg_advisory_xact_lock(hashtext(NEW.tenant_id || ':' || NEW.branch_id || ':' || NEW.appointment_date::text))` to serialize concurrent bookings for the same clinic branch and date.
       - Enforces valid integer `duration_min BETWEEN 5 AND 480`, canonical status values (`scheduled`, `confirmed`, `arrived`, `waiting`, `in_progress`, `completed`, `cancelled`, `no_show`), and legal status state-machine transitions on `UPDATE`.
       - Enforces conflict-free scheduling across active appointments (`status NOT IN ('cancelled', 'no_show')`) on the same `(tenant_id, branch_id, appointment_date)` for overlapping time windows `[appointment_time, appointment_time + duration_min * interval '1 minute')` when sharing the same `room`, `staff_id`, or `patient_id`.
    3. **Authoritative Transactional RPCs**:
       - `public.book_or_update_appointment_v14(...)`: executes transactional idempotency check, advisory lock, conflict check, and `INSERT`/`UPDATE ... RETURNING to_jsonb(appointments.*)`, recording the canonical response in `appointment_command_idempotency`.
       - `public.transition_appointment_status_v14(...)`: validates legal status transition and updates the row with exact row-count verification (`FOUND`).

## 3. Canonical Affected-Row Verification & Offline Honesty (`supabaseGuardian.ts` & `appointmentCommandService.ts`)
- **Blocker Resolved**: Zero-row `UPDATE`/`DELETE` responses (where PostgREST returns `data: []` and `error: null` because RLS or a missing ID matched 0 rows) could be misclassified as `'confirmed'`, and queued offline mutations must never be misrepresented as confirmed server bookings.
- **Mandatory V14 Policy**:
  - `verifyServerMutation` and `getMutationOutcome` MUST inspect `affectedRows` / `Array.isArray(res.data)`: when an explicit representation or row verification expects affected rows and `Array.isArray(res.data) && res.data.length === 0` (or `res.affectedRows === 0`), `getMutationOutcome` MUST return `'error'` (`ZERO_ROWS_AFFECTED`) and `verifyServerMutation` MUST return `false`.
  - `saveAppointmentCommand`, `transitionAppointmentStatusCommand`, and `deleteAppointmentCommand` MUST chain `.select()` on mutations (and invoke the transactional RPC when available with safe fallback to `.select()` verification), verify that at least 1 canonical server row was returned on online mutations, and persist `clientRequestId` in a project-namespaced durable idempotency store (`localStorage` + server ledger) so duplicate submissions and offline replays are idempotent.
  - Queued offline operations ALWAYS return `outcome: 'queued_offline'` (`serverConfirmed: false`) and distinct UI feedback.

## 4. Unified 9-Stage Clinical Patient Journey (`src/features/clinical-journey/patientJourney.ts`)
- **HL7 FHIR R4 Workflow Alignment (`Appointment` -> `Encounter` -> `CarePlan` -> `Procedure` -> `Invoice` -> `Task`)**:
  - Connects all 9 canonical stages for every patient across Reception, Appointments, Patients, Treatments, Finance, and Reminders:
    1. `reception` (`پذیرش و تشکیل پرونده` — FHIR `Patient`)
    2. `appointment` (`نوبت‌دهی تاییدشده` — FHIR `Appointment.status = booked`)
    3. `check_in` (`ورود و پذیرش حضوری` — FHIR `Appointment.status = arrived`)
    4. `waiting` (`انتظار یونیت` — FHIR `Encounter.status = arrived`)
    5. `examination` (`معاینه و چارت پالمر` — FHIR `Observation / ClinicalImpression`)
    6. `treatment_planning` (`طرح درمان` — FHIR `CarePlan / ServiceRequest`)
    7. `treatment_execution` (`اجرای درمان و لابراتوار/ایمپلنت` — FHIR `Procedure`)
    8. `billing` (`صدور صورتحساب و تسویه مالی` — FHIR `Invoice / PaymentReconciliation`)
    9. `follow_up` (`یادآوری و پیگیری پس از درمان` — FHIR `Task / CommunicationRequest`)
  - Computes real-time stage status (`completed`, `current`, `pending`, `attention`), next recommended clinical action, and role-safe deep-link navigation without fabricating any clinical or financial records.
