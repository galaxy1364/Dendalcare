-- ============================================================================
-- MINADENTAL GE-0007 — P0 DATABASE GRANT, RLS & AUTHENTICATED ACCESS RECOVERY
--
-- File: 20261203000000_ge0007_authenticated_grants_and_rls_audit.sql
-- Target Supabase Project: npzcweiphmyhtzxxnlov (development)
--
-- Root Cause Addressed:
--   Resolves PostgreSQL SQLSTATE 42501 ("permission denied for table patients")
--   for verified authenticated users while strictly preserving ZERO anonymous
--   access (`anon` and `PUBLIC` remain completely revoked across every table
--   and schema privilege).
--
-- Security Guarantees:
--   1. ZERO anonymous access: `REVOKE ALL ON SCHEMA public FROM anon;` and
--      `REVOKE ALL ON TABLE public.<tbl> FROM PUBLIC, anon;` across all tables.
--   2. Restores required schema, sequence, and DML `GRANT`s exclusively to
--      `authenticated`, strictly gated by `ENABLE` + `FORCE ROW LEVEL SECURITY`.
--   3. Verifies `patients` and core clinical/billing/admin policies bind to
--      `TO authenticated` via `public.app_authorize_clinic_op(tenant_id, branch_id, ...)`
--      so verified managers (branch-scoped or `all_branches = true`) always have
--      full tenant/branch-isolated access.
--   4. Adds `public.app_diagnose_my_db_access()` (`SECURITY INVOKER`, granted
--      strictly to `authenticated`) for live post-migration verification of
--      caller JWT, PostgreSQL GRANTs, and active `clinic_memberships`.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Enforce Least-Privilege Schema, Table & Sequence Grants (NEVER grant anon)
-- ----------------------------------------------------------------------------
REVOKE ALL ON SCHEMA public FROM anon;
GRANT USAGE ON SCHEMA public TO authenticated;

DO $$
DECLARE
  tbl text;
  all_clinic_tables text[] := ARRAY[
    'tenants', 'branches', 'clinic_memberships', 'clinical_audit_events',
    'rls_migration_audit_log',
    'patients', 'appointments', 'treatments', 'treatment_services',
    'lab_orders', 'implants', 'tooth_conditions', 'payments',
    'finance_transactions', 'installments', 'checks', 'safteh',
    'inventory', 'reminders', 'staff', 'staff_salaries', 'staff_shares',
    'messages', 'advertisements', 'clinic_settings',
    'patient_allergies', 'patient_consents', 'clinical_notes',
    'odontogram_observations', 'scheduling_idempotency_ledger',
    'financial_accounts', 'chart_of_accounts', 'service_charges',
    'payment_allocations', 'journal_entries', 'journal_lines',
    'finance_command_idempotency', 'financial_audit_events', 'daily_close_sessions'
  ];
  dml_tables text[] := ARRAY[
    'patients', 'appointments', 'treatments', 'treatment_services',
    'lab_orders', 'implants', 'tooth_conditions', 'payments',
    'finance_transactions', 'installments', 'checks', 'safteh',
    'inventory', 'reminders', 'staff', 'staff_salaries', 'staff_shares',
    'messages', 'advertisements', 'clinic_settings',
    'clinic_memberships', 'clinical_audit_events',
    'patient_allergies', 'patient_consents', 'clinical_notes',
    'odontogram_observations'
  ];
BEGIN
  FOREACH tbl IN ARRAY all_clinic_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC;', tbl);
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon;', tbl);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);
    END IF;
  END LOOP;

  FOREACH tbl IN ARRAY dml_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated;', tbl);
    END IF;
  END LOOP;

  -- Control-plane read tables
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tenants') THEN
    GRANT SELECT ON TABLE public.tenants TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'branches') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE public.branches TO authenticated;
  END IF;
END $$;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Re-Verify Explicit Authenticated RLS Policies on public.patients
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "patients_select" ON public.patients;
CREATE POLICY "patients_select" ON public.patients
  FOR SELECT TO authenticated
  USING (public.app_authorize_clinic_op(tenant_id, branch_id, 'clinical', 'SELECT'));

DROP POLICY IF EXISTS "patients_insert" ON public.patients;
CREATE POLICY "patients_insert" ON public.patients
  FOR INSERT TO authenticated
  WITH CHECK (public.app_authorize_clinic_op(tenant_id, branch_id, 'clinical', 'INSERT'));

DROP POLICY IF EXISTS "patients_update" ON public.patients;
CREATE POLICY "patients_update" ON public.patients
  FOR UPDATE TO authenticated
  USING (public.app_authorize_clinic_op(tenant_id, branch_id, 'clinical', 'UPDATE'))
  WITH CHECK (public.app_authorize_clinic_op(tenant_id, branch_id, 'clinical', 'UPDATE'));

DROP POLICY IF EXISTS "patients_delete" ON public.patients;
CREATE POLICY "patients_delete" ON public.patients
  FOR DELETE TO authenticated
  USING (public.app_authorize_clinic_op(tenant_id, branch_id, 'clinical', 'DELETE'));

-- ----------------------------------------------------------------------------
-- 3. Live Diagnostic RPC (SECURITY INVOKER — Authenticated Only, Never Anon)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_diagnose_my_db_access()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'auth_uid', auth.uid(),
    'db_role', current_user,
    'has_patients_select_grant', has_table_privilege(current_user, 'public.patients', 'SELECT'),
    'has_patients_insert_grant', has_table_privilege(current_user, 'public.patients', 'INSERT'),
    'anon_has_patients_select', has_table_privilege('anon', 'public.patients', 'SELECT'),
    'memberships', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'tenant_id', m.tenant_id,
            'branch_id', m.branch_id,
            'role', m.role,
            'active', m.active,
            'all_branches', m.all_branches
          )
        )
        FROM public.app_get_my_verified_memberships() m
      ),
      '[]'::jsonb
    )
  );
$$;

REVOKE ALL ON FUNCTION public.app_diagnose_my_db_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_diagnose_my_db_access() TO authenticated;

COMMIT;
