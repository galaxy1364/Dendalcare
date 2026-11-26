# MinaDental V15 — Clinical Record, Odontogram & Patient Safety Specification

**Status:** Canonical Engineering & Clinical Safety Specification (Active in Codebase; SQL Migrations Staged Pending Live DB Application)  
**Target Supabase Project:** `npzcweiphmyhtzxxnlov`  
**Canonical Repository:** `https://github.com/galaxy1364/Dendalcare`  
**Coordination Record:** `https://github.com/galaxy1364/Dendalcare/issues/4`

---

## 1. Executive Summary & Honest Live-Database Reconciliation

MinaDental V15 establishes clinical record integrity, unambiguous ISO 3950 (FDI) & Palmer dental charting, append-only odontogram history, attributable informed consent, encounter-scoped clinical workflow state, structured 4-state allergy verification, and governed patient record retention.

### Honest Database Migration Status (`npzcweiphmyhtzxxnlov`)
- **Live Applied Migrations (3):**
  1. `20261125213357_v12_foundation_extensions_and_core_tables.sql`
  2. `20261125213523_v12_security_helpers_triggers_and_rls.sql`
  3. `20261125213554_v12_storage_and_schema_health_rpc.sql`
- **Staged Incremental Migrations in Repository (Pending Live Application):**
  4. `20261129000000_v14_transactional_scheduling_and_clinical_journey.sql` (Hardened in V15 with idempotency ledger direct-write trigger protection, actor-scoped RLS, midnight boundary enforcement, and immutable tenant/branch scope)
  5. `20261130000000_v15_clinical_record_odontogram_and_patient_safety.sql` (Defines `clinical_encounters`, `patient_allergy_reviews`, `odontogram_observations`, `clinical_notes`, `patient_consents`, and patient retention archival trigger)

---

## 2. Clinical Risk Management & Hazard Log (ISO 14971 / NHS DCB0129)

| Hazard ID | Clinical Description | Root Cause in Legacy Implementation | Risk Control & V15 Mitigation | Verification Test |
|---|---|---|---|---|
| **CL-01** | Wrong-tooth / wrong-quadrant treatment due to bare `1..8` numbering | `PalmerChart.tsx` stored `tooth_number: 1..8` without quadrant (`UR/UL/LR/LL`), causing all four quadrants to collide | Canonical ISO 3950 (FDI) 2-digit code (`11..48`, `51..85`) + explicit Palmer quadrant/arch/position. Bare `1..8` rows are flagged `'ambiguous_requires_reconciliation'` and blocked from auto-mapping until clinician reconciliation | `V15-CL01-01`, `V15-CL01-02` |
| **CL-02** | Loss of dental history when marking a tooth `'healthy'` | Marking a tooth `'healthy'` executed `DELETE FROM tooth_conditions`, erasing prior restorations/Notes | Append-only `odontogram_observations` ledger with explicit `'not_examined'` vs `'healthy'` state, surface-level merge, and optimistic concurrency (`expectedVersion`) | `V15-CL02-01`, `V15-CL02-02` |
| **CL-03** | Unsigned printed A4 template treated as valid legal consent | `ConsentModal.tsx` only called `window.print()` with zero persistence or attribution | Versioned `patient_consents` lifecycle separating `'printed_unsigned'` from online-confirmed `'signed'`, locking signed consent against in-place edits, and supporting withdrawal & plan-change invalidation | `V15-CL03-01`, `V15-CL03-02` |
| **CL-04** | Past completed treatment or payment falsely completes a new visit | `patientJourney.ts` aggregated all lifetime records without encounter boundaries | Active `Encounter` scoping (`activeEncounter` vs `longitudinalHistory`). Payment is never evidence of clinical treatment completion | `V15-CL04-01`, `V15-CL04-02` |
| **CL-05** | Casual hard-deletion of patient records with clinical/financial history | `Patients.tsx` executed raw `DELETE FROM patients` | `archiveOrDeletePatientCommand` + DB trigger `patients_retention_protection_guard` blocks physical deletion when clinical/financial history exists and archives (`status = 'inactive'`) | `V15-CL05-01` |
| **CL-06** | Empty free-text allergy field misinterpreted as "No Known Allergies" | Empty `patient.allergies` showed no warning badge | 4-state `AllergyVerificationStatus` (`'not_asked' | 'unknown' | 'no_known' | 'present'`). Empty free text defaults to `'not_asked'` with explicit clinician verification prompt | `V15-CL06-01` |
| **CL-07** | Monolithic UI files with unverified mutation outcomes | `Patients.tsx` (1,660 lines) and `PalmerChart.tsx` (524 lines) | Modularized into `<500` line modules (`Patients.tsx`, `PatientClinicalTabs.tsx`, `PatientFinanceAndSpecialtyTabs.tsx`, `PalmerChart.tsx`) with `getMutationOutcome` checks | `V15-CL07-01` |

---

## 3. HL7 FHIR R4 Interoperability Mapping

- **Patient & Lifecycle:** `Patient` (`active` vs `inactive` governed archival)
- **Active Visit / Episode:** `Encounter` (`planned`, `arrived`, `triaged`, `in-progress`, `onleave`, `finished`, `cancelled`)
- **Allergy Safety:** `AllergyIntolerance` (`verificationStatus`: `unconfirmed` / `confirmed` / `refuted`)
- **Odontogram Findings:** `Observation` + `BodyStructure` (ISO 3950 FDI bodySite code + tooth surfaces `M/D/O/I/B/F/L/P/C/R`)
- **Clinical Documentation:** `DocumentReference` / `Composition` (`preliminary` -> `final` -> `amended`)
- **Informed Consent:** `Consent` (`draft` / `printed_unsigned` -> `active` / `signed` -> `rejected` / `withdrawn` / `entered-in-error` / `invalidated_by_plan_change`)
