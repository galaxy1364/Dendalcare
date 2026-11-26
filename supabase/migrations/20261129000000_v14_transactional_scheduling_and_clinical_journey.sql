-- ============================================================================
-- MINADENTAL V14 — AUTHORITATIVE TRANSACTIONAL SCHEDULING, TRIGGER INVARIANTS
-- & PERSISTENT IDEMPOTENCY MIGRATION
--
-- Target Supabase Project: npzcweiphmyhtzxxnlov
-- Prerequisite Applied V12 Migrations (DO NOT REPLAY):
--   - 20261125213357 v12_empty_clinic_foundation
--   - 20261125213523 v12_advisor_hardening
--   - 20261125213554 v12_rpc_grants
--
-- Enforces:
--   1. Server-authoritative appointment write permission (manager, dentist, secretary only; blocks assistant & unauthorized).
--   2. Persistent idempotency ledger (`public.appointment_command_idempotency`) with FORCE RLS.
--   3. Transaction-scoped advisory locking (`pg_advisory_xact_lock`) & trigger-level conflict/duration/status transition enforcement on `public.appointments` so direct PostgREST writes cannot bypass scheduling invariants.
--   4. Atomic transactional RPCs (`public.book_or_update_appointment_v14`, `public.transition_appointment_status_v14`) returning canonical row representations and affected row counts.
-- ============================================================================

BEGIN;

-- 1. Persistent Idempotency Ledger for Transactional Scheduling Commands
CREATE TABLE IF NOT EXISTS public.appointment_command_idempotency (
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  client_request_id text NOT NULL CHECK (btrim(client_request_id) <> '' AND char_length(client_request_id) <= 200),
  appointment_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'TRANSITION')),
  payload_hash text NOT NULL,
  response_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, branch_id, client_request_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.clinic_branches(tenant_id, id)
);

CREATE INDEX IF NOT EXISTS appointment_cmd_idemp_created_idx
  ON public.appointment_command_idempotency(tenant_id, branch_id, created_at DESC);

ALTER TABLE public.appointment_command_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_command_idempotency FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.appointment_command_idempotency FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.appointment_command_idempotency TO authenticated;

DROP POLICY IF EXISTS appointment_cmd_idemp_select ON public.appointment_command_idempotency;
CREATE POLICY appointment_cmd_idemp_select
  ON public.appointment_command_idempotency
  FOR SELECT TO authenticated
  USING (
    actor_id = (SELECT auth.uid())
    AND public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary')
  );

DROP POLICY IF EXISTS appointment_cmd_idemp_insert ON public.appointment_command_idempotency;

-- 1b. Trigger preventing direct API forgery or cross-actor tampering on appointment_command_idempotency
CREATE OR REPLACE FUNCTION private.enforce_idempotency_ledger_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_appt_exists boolean;
BEGIN
  IF current_setting('mina.in_appointment_rpc', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'MINA_IDEMPOTENCY_DIRECT_WRITE_FORBIDDEN: Idempotency ledger rows may only be written by authoritative scheduling RPC'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.actor_id IS DISTINCT FROM (SELECT auth.uid()) THEN
    RAISE EXCEPTION 'MINA_IDEMPOTENCY_ACTOR_MISMATCH: actor_id must equal authenticated user'
      USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.id = NEW.appointment_id
      AND a.tenant_id = NEW.tenant_id
      AND a.branch_id = NEW.branch_id
  ) INTO v_appt_exists;

  IF NOT COALESCE(v_appt_exists, false) THEN
    RAISE EXCEPTION 'MINA_IDEMPOTENCY_ORPHAN_RECORD: Referenced appointment % does not exist in scope',
      NEW.appointment_id
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_idempotency_ledger_integrity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS appointment_cmd_idemp_enforce_integrity ON public.appointment_command_idempotency;
CREATE TRIGGER appointment_cmd_idemp_enforce_integrity
  BEFORE INSERT OR UPDATE OR DELETE ON public.appointment_command_idempotency
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_idempotency_ledger_integrity();

CREATE OR REPLACE FUNCTION private.record_appointment_idempotency_v14(
  p_tenant_id text,
  p_branch_id text,
  p_client_request_id text,
  p_appointment_id uuid,
  p_actor_id uuid,
  p_operation text,
  p_payload_hash text,
  p_response_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF current_setting('mina.in_appointment_rpc', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'MINA_IDEMPOTENCY_DIRECT_WRITE_FORBIDDEN: Direct ledger write prohibited'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.appointment_command_idempotency (
    tenant_id,
    branch_id,
    client_request_id,
    appointment_id,
    actor_id,
    operation,
    payload_hash,
    response_payload
  ) VALUES (
    p_tenant_id,
    p_branch_id,
    p_client_request_id,
    p_appointment_id,
    p_actor_id,
    p_operation,
    p_payload_hash,
    p_response_payload
  );
END;
$$;

REVOKE ALL ON FUNCTION private.record_appointment_idempotency_v14(
  text, text, text, uuid, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated;

-- 2. Tighten Direct RLS Policies on public.appointments
-- Only manager, dentist, and secretary may INSERT or UPDATE appointments; only manager may DELETE.
DROP POLICY IF EXISTS appointments_insert ON public.appointments;
CREATE POLICY appointments_insert
  ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary')
  );

DROP POLICY IF EXISTS appointments_update ON public.appointments;
CREATE POLICY appointments_update
  ON public.appointments
  FOR UPDATE TO authenticated
  USING (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary')
  )
  WITH CHECK (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary')
  );

-- 3. Legal Appointment Status Transition Helper
CREATE OR REPLACE FUNCTION public.app_is_legal_appointment_transition(
  p_from_status text,
  p_to_status text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_from_status IS NULL OR p_to_status IS NULL THEN false
    WHEN p_from_status = p_to_status THEN true
    WHEN p_from_status = 'scheduled'   AND p_to_status IN ('confirmed', 'arrived', 'cancelled', 'no_show') THEN true
    WHEN p_from_status = 'confirmed'   AND p_to_status IN ('arrived', 'waiting', 'in_progress', 'cancelled', 'no_show') THEN true
    WHEN p_from_status = 'arrived'     AND p_to_status IN ('waiting', 'in_progress', 'cancelled', 'no_show') THEN true
    WHEN p_from_status = 'waiting'     AND p_to_status IN ('in_progress', 'cancelled', 'no_show') THEN true
    WHEN p_from_status = 'in_progress' AND p_to_status IN ('completed', 'cancelled') THEN true
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.app_is_legal_appointment_transition(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.app_is_legal_appointment_transition(text, text) TO authenticated;

-- 4. Trigger Enforcing Scheduling Invariants on Direct & RPC Writes
CREATE OR REPLACE FUNCTION private.enforce_appointment_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_new_start_min integer;
  v_new_end_min integer;
  v_conflict_id uuid;
  v_conflict_reason text;
BEGIN
  -- 4a. Immutable tenant/branch scope on UPDATE
  IF TG_OP = 'UPDATE' AND (
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
  ) THEN
    RAISE EXCEPTION 'MINA_APPT_IMMUTABLE_SCOPE: tenant_id and branch_id cannot be changed after creation'
      USING ERRCODE = '42501';
  END IF;

  -- 4b. Server-side role authorization check
  v_role := public.app_resolve_verified_role(NEW.tenant_id, NEW.branch_id);
  IF v_role IS NULL OR v_role NOT IN ('manager', 'dentist', 'secretary') THEN
    RAISE EXCEPTION 'MINA_APPT_UNAUTHORIZED: Role % is not authorized to mutate appointments in tenant % branch %',
      COALESCE(v_role, 'unauthorized'), NEW.tenant_id, NEW.branch_id
      USING ERRCODE = '42501';
  END IF;

  -- 4c. Canonical duration, midnight boundary & status domain check
  IF NEW.duration_min IS NULL OR NEW.duration_min < 5 OR NEW.duration_min > 480 THEN
    RAISE EXCEPTION 'MINA_APPT_INVALID_DURATION: duration_min must be an integer between 5 and 480 minutes (got %)',
      NEW.duration_min
      USING ERRCODE = '22023';
  END IF;

  v_new_start_min := EXTRACT(HOUR FROM NEW.appointment_time)::integer * 60
                   + EXTRACT(MINUTE FROM NEW.appointment_time)::integer;
  v_new_end_min := v_new_start_min + NEW.duration_min;
  IF v_new_start_min < 0 OR v_new_end_min > 1440 THEN
    RAISE EXCEPTION 'MINA_APPT_MIDNIGHT_OVERFLOW: Appointment window (% + % min) crosses midnight boundary',
      NEW.appointment_time, NEW.duration_min
      USING ERRCODE = '22023';
  END IF;

  IF NEW.status IS NULL OR NEW.status NOT IN (
    'scheduled', 'confirmed', 'arrived', 'waiting', 'in_progress', 'completed', 'cancelled', 'no_show'
  ) THEN
    RAISE EXCEPTION 'MINA_APPT_INVALID_STATUS: Invalid appointment status %',
      NEW.status
      USING ERRCODE = '22023';
  END IF;

  IF NEW.type IS NULL OR btrim(NEW.type) = '' THEN
    RAISE EXCEPTION 'MINA_APPT_INVALID_TYPE: Appointment service type is required'
      USING ERRCODE = '22023';
  END IF;

  -- 4d. Legal status transition check on UPDATE
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT public.app_is_legal_appointment_transition(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'MINA_APPT_ILLEGAL_TRANSITION: Illegal status transition from % to %',
        OLD.status, NEW.status
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 4e. Transaction-scoped advisory locks across branch date + resource dimensions
  PERFORM pg_advisory_xact_lock(
    hashtext('mina_appt_v14:' || NEW.tenant_id || ':' || NEW.branch_id || ':' || NEW.appointment_date::text)
  );

  -- 4f. Conflict check for active appointments
  IF NEW.status NOT IN ('cancelled', 'no_show') THEN
    SELECT
      a.id,
      CASE
        WHEN NEW.room IS NOT NULL AND btrim(NEW.room) <> '' AND a.room = NEW.room THEN 'ROOM_CONFLICT'
        WHEN NEW.staff_id IS NOT NULL AND a.staff_id = NEW.staff_id THEN 'STAFF_CONFLICT'
        WHEN NEW.patient_id IS NOT NULL AND a.patient_id = NEW.patient_id THEN 'PATIENT_CONFLICT'
        ELSE 'SLOT_CONFLICT'
      END
    INTO v_conflict_id, v_conflict_reason
    FROM public.appointments a
    WHERE a.tenant_id = NEW.tenant_id
      AND a.branch_id = NEW.branch_id
      AND a.appointment_date = NEW.appointment_date
      AND a.id IS DISTINCT FROM NEW.id
      AND a.status NOT IN ('cancelled', 'no_show')
      AND (
        (NEW.room IS NOT NULL AND btrim(NEW.room) <> '' AND a.room = NEW.room)
        OR (NEW.staff_id IS NOT NULL AND a.staff_id = NEW.staff_id)
        OR (NEW.patient_id IS NOT NULL AND a.patient_id = NEW.patient_id)
      )
      AND (
        v_new_start_min < (
          EXTRACT(HOUR FROM a.appointment_time)::integer * 60
          + EXTRACT(MINUTE FROM a.appointment_time)::integer
          + a.duration_min
        )
        AND (
          EXTRACT(HOUR FROM a.appointment_time)::integer * 60
          + EXTRACT(MINUTE FROM a.appointment_time)::integer
        ) < v_new_end_min
      )
    LIMIT 1;

    IF v_conflict_id IS NOT NULL THEN
      RAISE EXCEPTION 'MINA_APPT_CONFLICT:%: Conflicting active appointment % exists in requested window',
        v_conflict_reason, v_conflict_id
        USING ERRCODE = '23P01';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.enforce_appointment_invariants() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS appointments_enforce_v14_invariants ON public.appointments;
CREATE TRIGGER appointments_enforce_v14_invariants
  BEFORE INSERT OR UPDATE ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION private.enforce_appointment_invariants();

-- 5. Authoritative Transactional Booking & Update RPC with Persistent Idempotency
CREATE OR REPLACE FUNCTION public.book_or_update_appointment_v14(
  p_tenant_id text,
  p_branch_id text,
  p_client_request_id text,
  p_appointment_id uuid DEFAULT NULL,
  p_patient_id uuid DEFAULT NULL,
  p_staff_id uuid DEFAULT NULL,
  p_title text DEFAULT NULL,
  p_appointment_date date DEFAULT NULL,
  p_appointment_time time DEFAULT NULL,
  p_duration_min integer DEFAULT 30,
  p_type text DEFAULT 'checkup',
  p_status text DEFAULT 'confirmed',
  p_room text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_role text;
  v_payload_hash text;
  v_existing_idem record;
  v_saved public.appointments%ROWTYPE;
  v_affected integer := 0;
  v_response jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MINA_APPT_UNAUTHENTICATED: Authenticated session required' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_resolve_verified_role(p_tenant_id, p_branch_id);
  IF v_role IS NULL OR v_role NOT IN ('manager', 'dentist', 'secretary') THEN
    RAISE EXCEPTION 'MINA_APPT_UNAUTHORIZED: Active manager, dentist, or secretary membership required' USING ERRCODE = '42501';
  END IF;

  IF p_client_request_id IS NULL OR btrim(p_client_request_id) = '' THEN
    RAISE EXCEPTION 'MINA_APPT_MISSING_REQUEST_ID: client_request_id is required for idempotent scheduling' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('mina.in_appointment_rpc', 'true', true);

  PERFORM pg_advisory_xact_lock(
    hashtext('mina_appt_idemp:' || p_tenant_id || ':' || p_branch_id || ':' || btrim(p_client_request_id))
  );

  v_payload_hash := md5(
    COALESCE(p_appointment_id::text, 'new') || '|' ||
    COALESCE(p_patient_id::text, '') || '|' ||
    COALESCE(p_staff_id::text, '') || '|' ||
    COALESCE(p_appointment_date::text, '') || '|' ||
    COALESCE(p_appointment_time::text, '') || '|' ||
    COALESCE(p_duration_min::text, '') || '|' ||
    COALESCE(p_type, '') || '|' ||
    COALESCE(p_status, '') || '|' ||
    COALESCE(p_room, '')
  );

  SELECT appointment_id, actor_id, payload_hash, response_payload
  INTO v_existing_idem
  FROM public.appointment_command_idempotency
  WHERE tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND client_request_id = btrim(p_client_request_id);

  IF FOUND THEN
    IF v_existing_idem.actor_id IS DISTINCT FROM v_actor_id THEN
      RAISE EXCEPTION 'MINA_APPT_IDEMPOTENCY_ACTOR_MISMATCH: client_request_id % belongs to a different authenticated actor',
        p_client_request_id
        USING ERRCODE = '42501';
    END IF;
    IF v_existing_idem.payload_hash <> v_payload_hash THEN
      RAISE EXCEPTION 'MINA_APPT_IDEMPOTENCY_CONFLICT: client_request_id % was already used with different parameters',
        p_client_request_id
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing_idem.response_payload || jsonb_build_object('idempotentReplay', true);
  END IF;

  IF p_appointment_id IS NOT NULL THEN
    UPDATE public.appointments
    SET
      patient_id = p_patient_id,
      staff_id = p_staff_id,
      title = p_title,
      appointment_date = p_appointment_date,
      appointment_time = p_appointment_time,
      duration_min = p_duration_min,
      type = p_type,
      status = p_status,
      room = p_room,
      notes = p_notes
    WHERE id = p_appointment_id
      AND tenant_id = p_tenant_id
      AND branch_id = p_branch_id
    RETURNING * INTO v_saved;

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    IF v_affected = 0 THEN
      RAISE EXCEPTION 'MINA_APPT_ZERO_ROWS: Appointment % not found or not accessible in tenant % branch %',
        p_appointment_id, p_tenant_id, p_branch_id
        USING ERRCODE = 'P0002';
    END IF;
  ELSE
    INSERT INTO public.appointments (
      tenant_id,
      branch_id,
      patient_id,
      staff_id,
      title,
      appointment_date,
      appointment_time,
      duration_min,
      type,
      status,
      room,
      notes
    ) VALUES (
      p_tenant_id,
      p_branch_id,
      p_patient_id,
      p_staff_id,
      p_title,
      p_appointment_date,
      p_appointment_time,
      p_duration_min,
      p_type,
      p_status,
      p_room,
      p_notes
    )
    RETURNING * INTO v_saved;

    GET DIAGNOSTICS v_affected = ROW_COUNT;
  END IF;

  v_response := jsonb_build_object(
    'ok', true,
    'affectedRows', v_affected,
    'idempotentReplay', false,
    'clientRequestId', btrim(p_client_request_id),
    'appointment', to_jsonb(v_saved)
  );

  PERFORM private.record_appointment_idempotency_v14(
    p_tenant_id,
    p_branch_id,
    btrim(p_client_request_id),
    v_saved.id,
    v_actor_id,
    CASE WHEN p_appointment_id IS NULL THEN 'INSERT' ELSE 'UPDATE' END,
    v_payload_hash,
    v_response
  );

  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION public.book_or_update_appointment_v14(
  text, text, text, uuid, uuid, uuid, text, date, time, integer, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_or_update_appointment_v14(
  text, text, text, uuid, uuid, uuid, text, date, time, integer, text, text, text, text
) TO authenticated;

-- 6. Authoritative Status Transition RPC with Exact Affected-Row Check
CREATE OR REPLACE FUNCTION public.transition_appointment_status_v14(
  p_tenant_id text,
  p_branch_id text,
  p_appointment_id uuid,
  p_expected_status text,
  p_next_status text,
  p_client_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_actor_id uuid := (SELECT auth.uid());
  v_role text;
  v_saved public.appointments%ROWTYPE;
  v_affected integer := 0;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'MINA_APPT_UNAUTHENTICATED: Authenticated session required' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_resolve_verified_role(p_tenant_id, p_branch_id);
  IF v_role IS NULL OR v_role NOT IN ('manager', 'dentist', 'secretary') THEN
    RAISE EXCEPTION 'MINA_APPT_UNAUTHORIZED: Active manager, dentist, or secretary membership required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.app_is_legal_appointment_transition(p_expected_status, p_next_status) THEN
    RAISE EXCEPTION 'MINA_APPT_ILLEGAL_TRANSITION: Transition from % to % is not allowed',
      p_expected_status, p_next_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.appointments
  SET status = p_next_status
  WHERE id = p_appointment_id
    AND tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND status = p_expected_status
  RETURNING * INTO v_saved;

  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected = 0 THEN
    RAISE EXCEPTION 'MINA_APPT_ZERO_ROWS: Appointment % status transition matched 0 rows (stale status or unauthorized scope)',
      p_appointment_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'affectedRows', v_affected,
    'clientRequestId', p_client_request_id,
    'appointment', to_jsonb(v_saved)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_appointment_status_v14(
  text, text, uuid, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_appointment_status_v14(
  text, text, uuid, text, text, text
) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
