# ADR-005: Append-Only ISO 3950/Palmer Odontogram, Versioned Consent & Encounter-Scoped Clinical Journey

- **Status:** Accepted (V15)
- **Date:** 2026-11-26
- **Related Issue:** `https://github.com/galaxy1364/Dendalcare/issues/4`

## Context

1. Legacy `tooth_conditions` rows stored bare `tooth_number` integers (`1..8`) without a quadrant, making it impossible to distinguish Upper Right (`11..18`), Upper Left (`21..28`), Lower Left (`31..38`), or Lower Right (`41..48`). Furthermore, setting a tooth to `'healthy'` deleted the row, destroying historical dental chart observations.
2. Printing an A4 consent template in `ConsentModal.tsx` did not persist any consent state or distinguish an unsigned printout from a signed clinical consent.
3. `computePatientClinicalJourney` evaluated all patient records globally across time, so a patient returning for a new appointment appeared to have already completed treatment if they had any prior completed treatment or payment.
4. `appointment_command_idempotency` in the staged V14 migration allowed broad tenant-wide reads and lacked a trigger blocking direct PostgREST inserts outside the transactional scheduling RPC.

## Decision

1. **Dual ISO 3950 (FDI) & Palmer Append-Only Odontogram (`src/features/clinical-record/odontogramDomain.ts`)**:
   - All teeth are canonically identified by their two-digit ISO 3950 (FDI) code (`11..48` permanent, `51..85` deciduous) paired with bijective Palmer quadrant/position coordinates.
   - Legacy rows with bare `1..8` and no quadrant metadata are classified as `'ambiguous_requires_reconciliation'` and require explicit clinician selection of the target quadrant.
   - Uncharted teeth default to `'not_examined'`, distinct from `'healthy'`. Confirming `'healthy'` appends an observation (`clinicalStatus: 'healthy'`) without deleting prior records.
2. **Versioned Consent & Clinical Note Lifecycle (`src/features/clinical-record/clinicalRecordService.ts`)**:
   - Printing an unsigned consent records `status: 'printed_unsigned'`. Only an online, authenticated clinician action records `status: 'signed'`, which is immutable in place and can only be withdrawn or superseded by a plan-change invalidation.
   - Clinical notes follow `draft -> signed -> amended`, where amendments create a linked new version rather than overwriting the signed note.
3. **Encounter-Scoped Clinical Journey (`src/features/clinical-journey/patientJourney.ts`)**:
   - The 9-stage journey is scoped to the active `Encounter` (today's or latest active appointment/visit), while prior completed visits and financial balances are reported in `longitudinalHistory`. Payment never implies clinical completion.
4. **Hardened V14 Idempotency Ledger (`supabase/migrations/20261129000000_v14_transactional_scheduling_and_clinical_journey.sql`)**:
   - Restricted `SELECT` RLS on `appointment_command_idempotency` to `actor_id = (SELECT auth.uid())` and added `private.enforce_idempotency_ledger_integrity()` trigger requiring `current_setting('mina.in_appointment_rpc', true) = 'true'`.
