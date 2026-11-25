-- ============================================================================
-- MINADENTAL — THIRD AUDIT FIX 01: CRITICAL FAIL-CLOSED RLS HARDENING
-- Corrective, Non-Destructive Security Migration (Idempotent)
--
-- Security Guarantees:
-- 1. Zero destructive table drops or data deletion; pre-flight audit log records
--    existing row counts and NULL tenant/branch diagnostics before policy swap.
-- 2. Default-DENY whenever auth.uid(), tenant_id, branch_id, or verified role
--    is missing (removes all permissive COALESCE fallbacks & self-tautologies).
-- 3. Explicit per-operation (SELECT, INSERT, UPDATE, DELETE) policies enforced
--    via server-side membership table (`clinic_memberships`) + JWT `app_metadata`.
-- 4. Strict Financial & Payroll Isolation:
--    - `finance_transactions` (accounting ledger): manager ONLY.
--    - `staff_salaries`, `staff_shares` (payroll): manager full; dentist own SELECT;
--      secretary & assistant DENIED.
--    - `payments`, `installments`, `checks`, `safteh`: manager full; secretary
--      scoped branch SELECT/INSERT only (no UPDATE/DELETE); assistant & dentist DENIED.
-- 5. Dynamically drops ALL legacy / permissive policies on every clinic table
--    and enables `FORCE ROW LEVEL SECURITY`.
-- ============================================================================

BEGIN;

-- 1. Non-destructive migration audit log (preserves pre-migration diagnostics)
CREATE TABLE IF NOT EXISTS public.rls_migration_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_name text NOT NULL,
  table_name text NOT NULL,
  total_rows bigint NOT NULL DEFAULT 0,
  null_tenant_rows bigint NOT NULL DEFAULT 0,
  null_branch_rows bigint NOT NULL DEFAULT 0,
  audited_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rls_migration_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rls_migration_audit_log FORCE ROW LEVEL SECURITY;

-- 2. Authoritative server-side membership table (replaces client localStorage trust)
CREATE TABLE IF NOT EXISTS public.clinic_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('manager', 'dentist', 'secretary', 'assistant')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_clinic_memberships_user_tenant
  ON public.clinic_memberships (user_id, tenant_id)
  WHERE active = true;

ALTER TABLE public.clinic_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_memberships FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clinic_memberships_select_self" ON public.clinic_memberships;
CREATE POLICY "clinic_memberships_select_self" ON public.clinic_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 3. Ensure required schema columns exist non-destructively (no data dropped)
DO $$
DECLARE
  tbl text;
  all_tables text[] := ARRAY[
    'patients', 'appointments', 'treatments', 'treatment_services',
    'lab_orders', 'implants', 'tooth_conditions', 'payments',
    'finance_transactions', 'installments', 'checks', 'safteh',
    'inventory', 'reminders', 'staff', 'staff_salaries', 'staff_shares',
    'messages', 'advertisements', 'clinic_settings'
  ];
  v_total bigint;
  v_null_tenant bigint;
  v_null_branch bigint;
BEGIN
  FOREACH tbl IN ARRAY all_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id text;', tbl);
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS branch_id text;', tbl);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id, branch_id);', 'idx_' || tbl || '_tenant_branch', tbl);

      EXECUTE format('SELECT count(*), count(*) FILTER (WHERE tenant_id IS NULL OR btrim(tenant_id) = ''''), count(*) FILTER (WHERE branch_id IS NULL OR btrim(branch_id) = '''') FROM public.%I', tbl)
        INTO v_total, v_null_tenant, v_null_branch;

      INSERT INTO public.rls_migration_audit_log (migration_name, table_name, total_rows, null_tenant_rows, null_branch_rows)
      VALUES ('20261126_rls_hardening', tbl, v_total, v_null_tenant, v_null_branch);
    END IF;
  END LOOP;
END $$;

-- Ensure deterministic foreign-key accounting link columns exist non-destructively
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'finance_transactions') THEN
    ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS payment_id uuid;
    ALTER TABLE public.finance_transactions ADD COLUMN IF NOT EXISTS treatment_id uuid;
    CREATE INDEX IF NOT EXISTS idx_finance_tx_payment_id ON public.finance_transactions (payment_id);
    CREATE INDEX IF NOT EXISTS idx_finance_tx_treatment_id ON public.finance_transactions (treatment_id);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'checks') THEN
    ALTER TABLE public.checks ADD COLUMN IF NOT EXISTS is_guarantee boolean NOT NULL DEFAULT false;
    ALTER TABLE public.checks ADD COLUMN IF NOT EXISTS treatment_id uuid;
    ALTER TABLE public.checks ADD COLUMN IF NOT EXISTS installment_id uuid;
    CREATE INDEX IF NOT EXISTS idx_checks_is_guarantee ON public.checks (is_guarantee);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'installments') THEN
    ALTER TABLE public.installments ADD COLUMN IF NOT EXISTS treatment_id uuid;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'staff_salaries') THEN
    ALTER TABLE public.staff_salaries ADD COLUMN IF NOT EXISTS auth_user_id uuid;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'staff_shares') THEN
    ALTER TABLE public.staff_shares ADD COLUMN IF NOT EXISTS auth_user_id uuid;
  END IF;
END $$;

-- 4. Fail-Closed Server-Side Security Helper Functions (ZERO default-allow COALESCE fallbacks)

CREATE OR REPLACE FUNCTION public.app_jwt_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(btrim(COALESCE(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')), '');
$$;

CREATE OR REPLACE FUNCTION public.app_jwt_branch_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(btrim(COALESCE(auth.jwt() -> 'app_metadata' ->> 'branch_id', '')), '');
$$;

CREATE OR REPLACE FUNCTION public.app_jwt_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN (auth.jwt() -> 'app_metadata' ->> 'clinic_role') IN ('manager', 'dentist', 'secretary', 'assistant')
      THEN (auth.jwt() -> 'app_metadata' ->> 'clinic_role')
    ELSE NULL
  END;
$$;

/**
 * Resolves the caller's authoritative role for `(target_tenant, target_branch)`.
 * Returns NULL (default DENY) if:
 *   - Caller is unauthenticated (`auth.uid() IS NULL`)
 *   - Row lacks a non-empty `target_tenant` or `target_branch`
 *   - Caller has neither an active matching row in `clinic_memberships`
 *     nor valid non-null server-signed JWT `app_metadata` claims matching tenant & branch.
 */
CREATE OR REPLACE FUNCTION public.app_resolve_verified_role(
  target_tenant text,
  target_branch text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_member_role text;
  v_jwt_tenant text;
  v_jwt_branch text;
  v_jwt_role text;
BEGIN
  IF v_uid IS NULL
     OR target_tenant IS NULL OR btrim(target_tenant) = ''
     OR target_branch IS NULL OR btrim(target_branch) = '' THEN
    RETURN NULL;
  END IF;

  -- Primary authoritative source: server-managed `clinic_memberships` table
  SELECT cm.role
    INTO v_member_role
  FROM public.clinic_memberships cm
  WHERE cm.user_id = v_uid
    AND cm.active = true
    AND cm.tenant_id = target_tenant
    AND (cm.role = 'manager' OR cm.branch_id = target_branch)
  ORDER BY CASE cm.role
    WHEN 'manager' THEN 1
    WHEN 'dentist' THEN 2
    WHEN 'secretary' THEN 3
    WHEN 'assistant' THEN 4
    ELSE 5
  END
  LIMIT 1;

  IF v_member_role IS NOT NULL THEN
    RETURN v_member_role;
  END IF;

  -- Secondary authoritative source: server-signed JWT `app_metadata` (ONLY if user has no explicit revoked membership)
  IF EXISTS (SELECT 1 FROM public.clinic_memberships cm WHERE cm.user_id = v_uid) THEN
    RETURN NULL;
  END IF;

  v_jwt_tenant := public.app_jwt_tenant_id();
  v_jwt_branch := public.app_jwt_branch_id();
  v_jwt_role   := public.app_jwt_role();

  IF v_jwt_tenant IS NULL OR v_jwt_role IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_jwt_tenant <> target_tenant THEN
    RETURN NULL;
  END IF;

  IF v_jwt_role = 'manager' THEN
    RETURN 'manager';
  END IF;

  IF v_jwt_branch IS NULL OR v_jwt_branch <> target_branch THEN
    RETURN NULL;
  END IF;

  RETURN v_jwt_role;
END;
$$;

/**
 * Centralized fail-closed authorization predicate for (category, operation).
 * Categories:
 *   - 'clinical': patients, appointments, treatments, treatment_services, lab_orders,
 *                 implants, tooth_conditions, reminders, inventory, messages, advertisements
 *   - 'admin':    clinic_settings, staff
 *   - 'billing':  payments, installments, checks, safteh
 *   - 'ledger':   finance_transactions (accounting ledger)
 *   - 'payroll':  staff_salaries, staff_shares
 */
CREATE OR REPLACE FUNCTION public.app_authorize_clinic_op(
  target_tenant text,
  target_branch text,
  table_category text,
  op text,
  record_owner_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := public.app_resolve_verified_role(target_tenant, target_branch);
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  IF table_category = 'ledger' THEN
    -- Accounting ledger (`finance_transactions`): manager ONLY (reception/assistant DENIED)
    RETURN v_role = 'manager';
  END IF;

  IF table_category = 'payroll' THEN
    -- Staff salaries & doctor shares: manager full; dentist read-only on own rows; secretary/assistant DENIED
    IF v_role = 'manager' THEN
      RETURN true;
    END IF;
    IF v_role = 'dentist' AND op = 'SELECT' AND record_owner_user_id IS NOT NULL AND record_owner_user_id = auth.uid() THEN
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  IF table_category = 'billing' THEN
    -- Billing tables (`payments`, `installments`, `checks`, `safteh`):
    -- manager: full access; secretary: scoped SELECT + INSERT only (no UPDATE/DELETE); assistant & dentist: DENIED
    IF v_role = 'manager' THEN
      RETURN true;
    END IF;
    IF v_role = 'secretary' AND op IN ('SELECT', 'INSERT') THEN
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  IF table_category = 'admin' THEN
    -- Clinic settings & staff directory: all active branch members may SELECT; only manager may INSERT/UPDATE/DELETE
    IF op = 'SELECT' THEN
      RETURN true;
    END IF;
    RETURN v_role = 'manager';
  END IF;

  IF table_category = 'clinical' THEN
    IF op = 'SELECT' THEN
      RETURN true;
    END IF;
    IF op = 'INSERT' THEN
      RETURN v_role IN ('manager', 'dentist', 'secretary', 'assistant');
    END IF;
    IF op = 'UPDATE' THEN
      RETURN v_role IN ('manager', 'dentist', 'secretary', 'assistant');
    END IF;
    IF op = 'DELETE' THEN
      RETURN v_role = 'manager';
    END IF;
  END IF;

  RETURN false;
END;
$$;

-- Audit log is readable only by authenticated managers
DROP POLICY IF EXISTS "rls_audit_log_manager_select" ON public.rls_migration_audit_log;
CREATE POLICY "rls_audit_log_manager_select" ON public.rls_migration_audit_log
  FOR SELECT TO authenticated
  USING (public.app_jwt_role() = 'manager');

-- 5. Dynamically DROP ALL old/permissive policies and apply strict fail-closed policies per table
DO $$
DECLARE
  rec record;
  pol record;
BEGIN
  FOR rec IN
    SELECT * FROM (VALUES
      ('patients',             'clinical'),
      ('appointments',         'clinical'),
      ('treatments',           'clinical'),
      ('treatment_services',   'clinical'),
      ('lab_orders',           'clinical'),
      ('implants',             'clinical'),
      ('tooth_conditions',     'clinical'),
      ('reminders',            'clinical'),
      ('inventory',            'clinical'),
      ('messages',             'clinical'),
      ('advertisements',       'clinical'),
      ('clinic_settings',      'admin'),
      ('staff',                'admin'),
      ('payments',             'billing'),
      ('installments',         'billing'),
      ('checks',               'billing'),
      ('safteh',               'billing'),
      ('finance_transactions', 'ledger'),
      ('staff_salaries',       'payroll'),
      ('staff_shares',         'payroll')
    ) AS t(tbl, category)
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = rec.tbl
    ) THEN
      -- Enable & FORCE RLS on table
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', rec.tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', rec.tbl);

      -- Drop EVERY pre-existing policy (eliminates any legacy permissive `USING (true)` policies)
      FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = rec.tbl
      LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol.policyname, rec.tbl);
      END LOOP;

      IF rec.category = 'payroll' THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id, branch_id, %L, ''SELECT'', auth_user_id));',
          rec.tbl || '_strict_select', rec.tbl, rec.category
        );
      ELSE
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id, branch_id, %L, ''SELECT''));',
          rec.tbl || '_strict_select', rec.tbl, rec.category
        );
      END IF;

      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id, branch_id, %L, ''INSERT''));',
        rec.tbl || '_strict_insert', rec.tbl, rec.category
      );

      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id, branch_id, %L, ''UPDATE'')) WITH CHECK (public.app_authorize_clinic_op(tenant_id, branch_id, %L, ''UPDATE''));',
        rec.tbl || '_strict_update', rec.tbl, rec.category, rec.category
      );

      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id, branch_id, %L, ''DELETE''));',
        rec.tbl || '_strict_delete', rec.tbl, rec.category
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
