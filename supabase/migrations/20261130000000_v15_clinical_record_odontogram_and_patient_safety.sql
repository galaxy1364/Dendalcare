-- ============================================================================
-- MINADENTAL V15 — CLINICAL RECORD, APPEND-ONLY ODONTOGRAM, ENCOUNTER SCOPE,
-- STRUCTURED ALLERGY REVIEW, VERSIONED CONSENT & RETENTION PROTECTION
--
-- Target Supabase Project: npzcweiphmyhtzxxnlov
-- Prerequisite Migrations:
--   - V12 foundation (20261125213357, 20261125213523, 20261125213554) — already applied
--   - V14 transactional scheduling (20261129000000) — staged incremental
--
-- Enforces:
--   1. Encounter separation (`public.clinical_encounters`) so historical completed
--      visits never mark a new encounter completed (CL-04).
--   2. Append-only ISO 3950 (FDI) Odontogram Observation Ledger
--      (`public.odontogram_observations`) with explicit dentition, surface set,
--      finding code, optimistic concurrency version, supersedes chain, and
--      trigger preventing destructive DELETE or in-place overwrite (CL-01, CL-02).
--   3. Structured 4-State Allergy & Medical History Verification
--      (`public.patient_allergy_reviews`: 'not_asked' | 'unknown' | 'no_known' | 'present')
--      requiring explicit clinician review rather than inferring no-allergy from
--      empty free text (CL-06).
--   4. Clinical Notes (`public.clinical_notes`: 'draft' -> 'signed' -> 'amended')
--      where signed notes are immutable and only authorized clinicians
--      ('manager' | 'dentist') may sign or append an amendment.
--   5. Versioned Informed Consent Ledger (`public.patient_consents`) distinguishing
--      'printed_unsigned', 'signed', 'withdrawn', and 'superseded_by_plan_change'
--      with attributable signer/witness metadata (CL-03).
--   6. Patient Retention Protection Trigger on `public.patients` blocking casual
--      hard-deletion when clinical history exists (CL-05).
-- ============================================================================

BEGIN;

-- 1. Clinical Encounters (Separating longitudinal patient chart from active care episodes — CL-04)
CREATE TABLE IF NOT EXISTS public.clinical_encounters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  provider_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  encounter_type text NOT NULL DEFAULT 'routine'
    CHECK (encounter_type IN ('routine', 'emergency_walk_in', 'follow_up', 'consultation', 'surgery')),
  status text NOT NULL DEFAULT 'arrived'
    CHECK (status IN ('planned', 'arrived', 'waiting', 'in_examination', 'in_treatment', 'completed', 'interrupted', 'cancelled', 'no_show')),
  chief_complaint text,
  walk_in_reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_by uuid NOT NULL DEFAULT (SELECT auth.uid()),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.clinic_branches(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS clinical_encounters_patient_idx
  ON public.clinical_encounters(tenant_id, branch_id, patient_id, started_at DESC);

ALTER TABLE public.clinical_encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_encounters FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinical_encounters FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.clinical_encounters TO authenticated;

DROP POLICY IF EXISTS clinical_encounters_select ON public.clinical_encounters;
CREATE POLICY clinical_encounters_select
  ON public.clinical_encounters
  FOR SELECT TO authenticated
  USING (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary', 'assistant')
  );

DROP POLICY IF EXISTS clinical_encounters_insert ON public.clinical_encounters;
CREATE POLICY clinical_encounters_insert
  ON public.clinical_encounters
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary')
  );

DROP POLICY IF EXISTS clinical_encounters_update ON public.clinical_encounters;
CREATE POLICY clinical_encounters_update
  ON public.clinical_encounters
  FOR UPDATE TO authenticated
  USING (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary')
  )
  WITH CHECK (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary')
  );

-- 2. Structured 4-State Allergy & Medical History Reviews (CL-06)
CREATE TABLE IF NOT EXISTS public.patient_allergy_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  encounter_id uuid REFERENCES public.clinical_encounters(id) ON DELETE SET NULL,
  allergy_status text NOT NULL DEFAULT 'not_asked'
    CHECK (allergy_status IN ('not_asked', 'unknown', 'no_known', 'present')),
  substance_agent text,
  reaction_description text,
  severity text CHECK (severity IS NULL OR severity IN ('mild', 'moderate', 'life_threatening')),
  certainty text NOT NULL DEFAULT 'unconfirmed'
    CHECK (certainty IN ('unconfirmed', 'suspected', 'confirmed_by_clinician')),
  source_statement text,
  reviewed_by uuid NOT NULL DEFAULT (SELECT auth.uid()),
  reviewer_role text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.clinic_branches(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS patient_allergy_reviews_patient_idx
  ON public.patient_allergy_reviews(tenant_id, branch_id, patient_id, reviewed_at DESC);

ALTER TABLE public.patient_allergy_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_allergy_reviews FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_allergy_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.patient_allergy_reviews TO authenticated;

DROP POLICY IF EXISTS patient_allergy_reviews_select ON public.patient_allergy_reviews;
CREATE POLICY patient_allergy_reviews_select
  ON public.patient_allergy_reviews
  FOR SELECT TO authenticated
  USING (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary', 'assistant')
  );

DROP POLICY IF EXISTS patient_allergy_reviews_insert ON public.patient_allergy_reviews;
CREATE POLICY patient_allergy_reviews_insert
  ON public.patient_allergy_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    reviewed_by = (SELECT auth.uid())
    AND public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary')
    AND (
      certainty <> 'confirmed_by_clinician'
      OR public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist')
    )
  );

-- 3. Append-Only ISO 3950 (FDI) Odontogram Observation Ledger (CL-01, CL-02)
CREATE TABLE IF NOT EXISTS public.odontogram_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  encounter_id uuid REFERENCES public.clinical_encounters(id) ON DELETE SET NULL,
  dentition text NOT NULL CHECK (dentition IN ('permanent', 'deciduous')),
  fdi_tooth_number integer NOT NULL CHECK (
    (dentition = 'permanent' AND fdi_tooth_number IN (
      11,12,13,14,15,16,17,18,
      21,22,23,24,25,26,27,28,
      31,32,33,34,35,36,37,38,
      41,42,43,44,45,46,47,48
    ))
    OR
    (dentition = 'deciduous' AND fdi_tooth_number IN (
      51,52,53,54,55,
      61,62,63,64,65,
      71,72,73,74,75,
      81,82,83,84,85
    ))
  ),
  palmer_quadrant text NOT NULL CHECK (palmer_quadrant IN ('UR', 'UL', 'LL', 'LR')),
  palmer_code text NOT NULL CHECK (btrim(palmer_code) <> ''),
  scope_level text NOT NULL DEFAULT 'whole_tooth' CHECK (scope_level IN ('whole_tooth', 'surface')),
  surface_code text CHECK (
    (scope_level = 'whole_tooth' AND surface_code IS NULL)
    OR (scope_level = 'surface' AND surface_code IN ('o', 'm', 'd', 'b', 'l', 'c'))
  ),
  finding_code text NOT NULL CHECK (finding_code IN (
    'not_examined',
    'healthy',
    'caries',
    'filled',
    'existing_restoration',
    'crown',
    'bridge',
    'implant',
    'extracted',
    'missing',
    'unerupted',
    'impacted',
    'root_canal',
    'fracture',
    'planned_procedure',
    'other'
  )),
  clinical_status text NOT NULL DEFAULT 'active'
    CHECK (clinical_status IN ('active', 'superseded', 'entered_in_error')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  supersedes_observation_id uuid REFERENCES public.odontogram_observations(id) ON DELETE RESTRICT,
  amendment_reason text,
  provenance_source text NOT NULL DEFAULT 'clinician_direct'
    CHECK (provenance_source IN ('clinician_direct', 'legacy_reconciled', 'assistant_draft')),
  notes text,
  authored_by uuid NOT NULL DEFAULT (SELECT auth.uid()),
  authored_role text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.clinic_branches(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS odontogram_obs_patient_tooth_idx
  ON public.odontogram_observations(tenant_id, branch_id, patient_id, fdi_tooth_number, recorded_at DESC);

ALTER TABLE public.odontogram_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odontogram_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.odontogram_observations FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.odontogram_observations TO authenticated;

DROP POLICY IF EXISTS odontogram_observations_select ON public.odontogram_observations;
CREATE POLICY odontogram_observations_select
  ON public.odontogram_observations
  FOR SELECT TO authenticated
  USING (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary', 'assistant')
  );

DROP POLICY IF EXISTS odontogram_observations_insert ON public.odontogram_observations;
CREATE POLICY odontogram_observations_insert
  ON public.odontogram_observations
  FOR INSERT TO authenticated
  WITH CHECK (
    authored_by = (SELECT auth.uid())
    AND public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'assistant')
  );

-- Enforce append-only immutability on odontogram_observations (no destructive DELETE or UPDATE)
CREATE OR REPLACE FUNCTION private.prevent_odontogram_destructive_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'MINA_ODONTOGRAM_APPEND_ONLY: Destructive % on odontogram_observations is forbidden; append a superseding observation instead',
    TG_OP
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_odontogram_destructive_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS odontogram_obs_append_only_guard ON public.odontogram_observations;
CREATE TRIGGER odontogram_obs_append_only_guard
  BEFORE UPDATE OR DELETE ON public.odontogram_observations
  FOR EACH ROW
  EXECUTE FUNCTION private.prevent_odontogram_destructive_mutation();

-- 4. Clinical Notes with Draft -> Signed -> Amended Lifecycle
CREATE TABLE IF NOT EXISTS public.clinical_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  encounter_id uuid REFERENCES public.clinical_encounters(id) ON DELETE SET NULL,
  note_status text NOT NULL DEFAULT 'draft'
    CHECK (note_status IN ('draft', 'signed', 'amended')),
  subjective_findings text,
  objective_findings text,
  assessment_diagnosis text NOT NULL,
  procedure_narrative text,
  fdi_teeth_scope text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  parent_note_id uuid REFERENCES public.clinical_notes(id) ON DELETE RESTRICT,
  amendment_reason text,
  authored_by uuid NOT NULL DEFAULT (SELECT auth.uid()),
  signed_by uuid,
  signer_role text,
  signed_at timestamptz,
  content_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.clinic_branches(tenant_id, id)
);

ALTER TABLE public.clinical_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_notes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinical_notes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.clinical_notes TO authenticated;

DROP POLICY IF EXISTS clinical_notes_select ON public.clinical_notes;
CREATE POLICY clinical_notes_select
  ON public.clinical_notes
  FOR SELECT TO authenticated
  USING (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary', 'assistant')
  );

DROP POLICY IF EXISTS clinical_notes_insert ON public.clinical_notes;
CREATE POLICY clinical_notes_insert
  ON public.clinical_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    authored_by = (SELECT auth.uid())
    AND public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'assistant')
    AND (
      note_status = 'draft'
      OR public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist')
    )
  );

DROP POLICY IF EXISTS clinical_notes_update ON public.clinical_notes;
CREATE POLICY clinical_notes_update
  ON public.clinical_notes
  FOR UPDATE TO authenticated
  USING (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist')
  )
  WITH CHECK (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist')
  );

CREATE OR REPLACE FUNCTION private.enforce_clinical_note_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := public.app_resolve_verified_role(NEW.tenant_id, NEW.branch_id);
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'MINA_CLINICAL_NOTE_IMMUTABLE: Clinical notes cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.note_status IN ('signed', 'amended') AND (v_role IS NULL OR v_role NOT IN ('manager', 'dentist')) THEN
    RAISE EXCEPTION 'MINA_CLINICAL_SIGN_FORBIDDEN: Only verified dentist or manager may sign or amend clinical notes'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.note_status = 'signed' THEN
    RAISE EXCEPTION 'MINA_CLINICAL_NOTE_LOCKED: Signed clinical note % cannot be edited in place; create an amended addendum row',
      OLD.id
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_clinical_note_lifecycle() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS clinical_notes_lifecycle_guard ON public.clinical_notes;
CREATE TRIGGER clinical_notes_lifecycle_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.clinical_notes
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_clinical_note_lifecycle();

-- 5. Persisted Versioned Informed Consent Ledger (CL-03)
CREATE TABLE IF NOT EXISTS public.patient_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  encounter_id uuid REFERENCES public.clinical_encounters(id) ON DELETE SET NULL,
  treatment_id uuid REFERENCES public.treatments(id) ON DELETE SET NULL,
  consent_type text NOT NULL CHECK (consent_type IN ('implant', 'endo', 'surgery', 'prostho', 'general')),
  template_version text NOT NULL DEFAULT 'v15.1-fa',
  procedure_scope text NOT NULL,
  fdi_teeth_scope text,
  risks_discussed boolean NOT NULL DEFAULT false,
  alternatives_discussed boolean NOT NULL DEFAULT false,
  consent_status text NOT NULL DEFAULT 'draft'
    CHECK (consent_status IN ('draft', 'printed_unsigned', 'signed', 'withdrawn', 'superseded_by_plan_change')),
  signature_method text NOT NULL DEFAULT 'none'
    CHECK (signature_method IN ('none', 'printed_paper_pending', 'scanned_signed_attachment', 'in_person_witnessed_electronic')),
  signer_full_name text,
  signer_relationship text NOT NULL DEFAULT 'self'
    CHECK (signer_relationship IN ('self', 'legal_guardian')),
  witness_full_name text,
  attending_clinician_id uuid,
  signed_at timestamptz,
  withdrawn_at timestamptz,
  withdrawal_reason text,
  created_by uuid NOT NULL DEFAULT (SELECT auth.uid()),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.clinic_branches(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS patient_consents_patient_idx
  ON public.patient_consents(tenant_id, branch_id, patient_id, created_at DESC);

ALTER TABLE public.patient_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_consents FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.patient_consents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.patient_consents TO authenticated;

DROP POLICY IF EXISTS patient_consents_select ON public.patient_consents;
CREATE POLICY patient_consents_select
  ON public.patient_consents
  FOR SELECT TO authenticated
  USING (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary', 'assistant')
  );

DROP POLICY IF EXISTS patient_consents_insert ON public.patient_consents;
CREATE POLICY patient_consents_insert
  ON public.patient_consents
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary')
  );

DROP POLICY IF EXISTS patient_consents_update ON public.patient_consents;
CREATE POLICY patient_consents_update
  ON public.patient_consents
  FOR UPDATE TO authenticated
  USING (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist')
  )
  WITH CHECK (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist')
  );

CREATE OR REPLACE FUNCTION private.enforce_patient_consent_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'MINA_CONSENT_IMMUTABLE: Consent records cannot be deleted'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.consent_status = 'signed' THEN
    IF NEW.signature_method IN ('none', 'printed_paper_pending')
       OR NEW.signer_full_name IS NULL OR btrim(NEW.signer_full_name) = ''
       OR NOT NEW.risks_discussed
       OR NOT NEW.alternatives_discussed THEN
      RAISE EXCEPTION 'MINA_CONSENT_EVIDENCE_REQUIRED: Cannot mark consent signed without attributable signer name, risks/alternatives confirmation, and verified signature method'
        USING ERRCODE = '22023';
    END IF;
    IF NEW.signed_at IS NULL THEN
      NEW.signed_at := now();
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.consent_status = 'signed' THEN
    IF NEW.consent_status NOT IN ('withdrawn', 'superseded_by_plan_change')
       OR NEW.procedure_scope IS DISTINCT FROM OLD.procedure_scope
       OR NEW.signer_full_name IS DISTINCT FROM OLD.signer_full_name THEN
      RAISE EXCEPTION 'MINA_CONSENT_LOCKED: Signed consent % cannot be edited in place; only status transition to withdrawn or superseded_by_plan_change is allowed',
        OLD.id
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_patient_consent_invariants() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS patient_consents_enforce_invariants ON public.patient_consents;
CREATE TRIGGER patient_consents_enforce_invariants
  BEFORE INSERT OR UPDATE OR DELETE ON public.patient_consents
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_patient_consent_invariants();

-- 6. Patient Clinical Retention Protection Trigger on public.patients (CL-05)
CREATE OR REPLACE FUNCTION private.prevent_patient_hard_delete_with_clinical_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_has_history boolean;
BEGIN
  SELECT (
    EXISTS (SELECT 1 FROM public.treatments t WHERE t.patient_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.appointments a WHERE a.patient_id = OLD.id AND a.status = 'completed')
    OR EXISTS (SELECT 1 FROM public.payments p WHERE p.patient_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.tooth_conditions tc WHERE tc.patient_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.odontogram_observations oo WHERE oo.patient_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.clinical_notes cn WHERE cn.patient_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.patient_consents pc WHERE pc.patient_id = OLD.id)
  ) INTO v_has_history;

  IF COALESCE(v_has_history, false) THEN
    RAISE EXCEPTION 'MINA_PATIENT_RETENTION_PROTECTED: Patient % has clinical or financial history and cannot be hard-deleted; archive the record (status=inactive) instead',
      OLD.id
      USING ERRCODE = '23503';
  END IF;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_patient_hard_delete_with_clinical_history() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS patients_retention_protection_guard ON public.patients;
CREATE TRIGGER patients_retention_protection_guard
  BEFORE DELETE ON public.patients
  FOR EACH ROW
  EXECUTE FUNCTION private.prevent_patient_hard_delete_with_clinical_history();

NOTIFY pgrst, 'reload schema';

COMMIT;
