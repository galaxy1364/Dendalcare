# ADR-004: V14 Fail-Closed Runtime Authorization, Authoritative PostgreSQL Scheduling & Unified 9-Stage Clinical Journey

- **Status:** Accepted (V14 Clinical Workflow Integrity)
- **Date:** 2026-11-26
- **Reviewed Baseline Commit:** `466e6360834ddbc83c69fde9504566a1c1529690` / `2b8fb4bff7e8adff429b668f7c51aa3166252d1e`
- **Coordination Issue:** https://github.com/galaxy1364/Dendalcare/issues/4

## 1. Context & Independent Audit Findings on Commit `2b8fb4b`
Independent audit of commit `2b8fb4b` identified five critical clinical & security gaps:
1. `AppProviders.tsx` still imported and used legacy `resolveEffectiveRole` instead of `resolveStrictMembershipRole`, allowing revoked/unauthorized sessions to fall back to `'assistant'` and authenticated sessions without a verified role to fall back to `'secretary'`.
2. `appointmentCommandService.ts` relied on client-side conflict checks and a 4-second in-memory `Map` idempotency window without transactional PostgreSQL enforcement or persistent idempotency.
3. Direct table writes to `public.appointments` could bypass scheduling conflict/transition invariants, and `operations` RLS category permitted `'assistant'` to insert/update appointments directly.
4. Zero-row `UPDATE`/`DELETE` outcomes (`data: []`, `error: null`) were not rejected by `getMutationOutcome()`, risking false positive confirmation when a target row was missing or filtered by RLS.
5. Patient cards and appointment workflows needed an explicit, deterministic 9-stage clinical journey state machine connecting reception, appointment, check-in, waiting, examination, treatment planning, treatment execution, billing, and follow-up.

## 2. Architectural Decisions

### 2.1 Zero-Fallback Runtime Authorization (`src/services/permissions/accessControl.ts`, `src/app/AppProviders.tsx`, `src/lib/supabaseGuardian.ts`)
- `AppProviders.tsx` now computes `effectiveRole: EffectiveClinicRole` exclusively via `resolveStrictMembershipRole`.
- `resolveEffectiveRole` now delegates directly to `resolveStrictMembershipRole` so no caller anywhere in the runtime can obtain a permissive `'secretary'` or `'assistant'` fallback when a session is `'unauthorized'` or when an `'authenticated'` session lacks `serverVerifiedRole`.
- When `verifiedSession.status === 'unauthorized'`, `AppShell` and `AppRouter` render an explicit fail-closed authorization barrier (`route_rbac_denied`), `FloatingDock` and `NavigationRail` hide all protected destinations, `supabaseGuardian` blocks all mutations (`403 MINA_AUTH_REVOKED`) without queuing them offline, and `processOfflineQueue` refuses to replay queued mutations while unauthorized.

### 2.2 Transactional PostgreSQL Scheduling & Trigger Guard (`supabase/migrations/20261129000000_v14_transactional_scheduling_and_clinical_journey.sql`)
- Rather than replaying V12 baselines, we provide a versioned, reversible incremental migration (`20261129000000_v14_transactional_scheduling_and_clinical_journey.sql`) that:
  - Creates `public.appointment_command_idempotency` with `FORCE ROW LEVEL SECURITY` to store persistent idempotency keys and canonical responses per `(tenant_id, branch_id, client_request_id)`.
  - Attaches `BEFORE INSERT OR UPDATE` trigger `appointments_enforce_v14_invariants` (`private.enforce_appointment_invariants()`) on `public.appointments`. Any direct PostgREST insert or update is serialized via `pg_advisory_xact_lock`, checked for role permission (`manager`, `dentist`, `secretary` only), checked for duration (`5..480` min), validated against legal status transitions, and checked against overlapping active appointments on the same room, staff member, or patient.
  - Exposes `public.book_or_update_appointment_v14` and `public.transition_appointment_status_v14` RPCs for atomic idempotent scheduling.

### 2.3 Canonical Affected-Row Verification & Durable Client Idempotency (`src/lib/supabaseGuardian.ts`, `src/features/appointments/appointmentCommandService.ts`)
- `getMutationOutcome()` and `verifyServerMutation()` now reject zero-row array responses (`Array.isArray(res.data) && res.data.length === 0`) and explicit `affectedRows === 0` as `'error'` (`ZERO_ROWS_AFFECTED`).
- `appointmentCommandService.ts` chains `.select()` on all table mutations so PostgREST returns the actual affected rows, verifies `rows.length === 1`, and persists idempotency keys in project-namespaced storage (`minadental_appt_idempotency_v14`) with a deterministic request fingerprint.

### 2.4 Unified 9-Stage Clinical Patient Journey (`src/features/clinical-journey/patientJourney.ts`)
- Implements `computePatientClinicalJourney()` mapping real patient, appointment, tooth chart, treatment, lab, implant, payment, installment, check, and reminder records into the 9 canonical clinical workflow stages (`reception` -> `appointment` -> `check_in` -> `waiting` -> `examination` -> `treatment_planning` -> `treatment_execution` -> `billing` -> `follow_up`) aligned with HL7 FHIR R4 resource lifecycle states.

## 3. Consequences
- Revoked or unauthorized sessions fail closed across UI routes, navigation chrome, online mutations, and offline queue replay.
- Concurrent double-bookings, direct API bypasses, and zero-row silent update failures are blocked deterministically at both client command and PostgreSQL trigger/RPC layers.
