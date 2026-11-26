-- ============================================================================
-- MINADENTAL GE-0004 — AUTHORITATIVE MANAGER AUTH, MEMBERSHIP, TENANT/BRANCH
--                      AUTHORIZATION & FAIL-CLOSED RLS RECOVERY
--
-- File: 20261202000000_ge0004_manager_auth_membership_rls_recovery.sql
-- Target Supabase Project: npzcweiphmyhtzxxnlov (development)
-- Prerequisite Applied V11/V12/V14/V15/V16 Migrations (DO NOT REPLAY):
--   - 20261124000000_v11_unified_schema_baseline.sql
--   - 20261125213357 / 20261125213523 / 20261125213554 (V12 foundation)
--   - 20261126_rls_hardening.sql
--   - 20261128000000_v11_rls_grants_storage_and_triggers.sql
--   - 20261129000000_v14_transactional_scheduling_and_clinical_journey.sql
--   - 20261130000000_v15_clinical_record_and_patient_safety.sql
--   - 20261201000000_v16_financial_intelligence_ledger.sql
--
-- Security Guarantees:
--   1. Strictly membership-backed `public.app_resolve_verified_role(target_tenant, target_branch)`:
--      ZERO JWT `app_metadata` fallback; requires an active `clinic_memberships` row
--      for `auth.uid()` within `target_tenant`.
--   2. Respects `all_branches`: a verified `manager` with `all_branches = true`
--      receives full manager authorization across all branches of their verified
--      `target_tenant`; a branch-scoped manager is strictly restricted to their
--      assigned `branch_id`. Cross-tenant access is always denied.
--   3. Deterministic privilege precedence (`manager` > `dentist` > `secretary` > `assistant`)
--      prevents a manager with multiple active rows from being downgraded.
--   4. Updates `public.app_authorize_clinic_op(...)` so verified managers retain full
--      SELECT/INSERT/UPDATE/DELETE authority across clinical, admin, billing, ledger,
--      and payroll domains strictly within `(target_tenant, target_branch)` without
--      bypassing server security or weakening non-manager isolation.
--   5. Removes legacy JWT fallback from `tenants_member_select` and
--      `public.app_stamp_verified_scope()`.
--   6. Exposes `public.app_get_my_verified_memberships()` (`SECURITY DEFINER`,
--      revoked from PUBLIC/anon, granted strictly to `authenticated`) for
--      deterministic, recursion-safe client session & branch scope discovery.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Strict Membership-Only Role Resolution (Respects all_branches + Precedence)
-- ----------------------------------------------------------------------------
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
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NULL;
  END IF;

  IF target_tenant IS NULL OR btrim(target_tenant) = '' OR
     target_branch IS NULL OR btrim(target_branch) = '' THEN
    RETURN NULL;
  END IF;

  -- Strictly membership-backed resolution (ZERO JWT app_metadata fallback).
  -- Managers with all_branches = true are authorized across all branches of their
  -- own tenant; branch-scoped managers and all non-manager roles require exact branch match.
  SELECT cm.role
    INTO v_role
  FROM public.clinic_memberships cm
  WHERE cm.user_id = v_uid
    AND cm.active = true
    AND cm.tenant_id = target_tenant
    AND (
      cm.branch_id = target_branch
      OR (cm.role = 'manager' AND COALESCE(cm.all_branches, false) = true)
    )
  ORDER BY CASE cm.role
    WHEN 'manager' THEN 1
    WHEN 'dentist' THEN 2
    WHEN 'secretary' THEN 3
    WHEN 'assistant' THEN 4
    ELSE 9
  END,
  CASE WHEN cm.branch_id = target_branch THEN 0 ELSE 1 END,
  cm.created_at ASC
  LIMIT 1;

  IF v_role IN ('manager', 'dentist', 'secretary', 'assistant') THEN
    RETURN v_role;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.app_resolve_verified_role(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_resolve_verified_role(text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Authoritative Domain/Operation RBAC Matrix (Full Manager Access in Scope)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_authorize_clinic_op(
  target_tenant text,
  target_branch text,
  domain text,
  op text,
  record_owner uuid DEFAULT NULL
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

  -- Verified manager has complete scoped authority within (target_tenant, target_branch)
  IF v_role = 'manager' THEN
    RETURN domain IN ('clinical', 'admin', 'billing', 'ledger', 'payroll')
       AND op IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  END IF;

  IF domain = 'clinical' THEN
    IF op = 'SELECT' THEN
      RETURN v_role IN ('dentist', 'secretary', 'assistant');
    ELSIF op IN ('INSERT', 'UPDATE') THEN
      RETURN v_role IN ('dentist', 'secretary', 'assistant');
    ELSIF op = 'DELETE' THEN
      RETURN false;
    END IF;
  ELSIF domain = 'billing' THEN
    IF op IN ('SELECT', 'INSERT', 'UPDATE') THEN
      RETURN v_role = 'secretary';
    ELSIF op = 'DELETE' THEN
      RETURN false;
    END IF;
  ELSIF domain = 'ledger' THEN
    IF op IN ('SELECT', 'INSERT') THEN
      RETURN v_role = 'secretary';
    ELSE
      RETURN false;
    END IF;
  ELSIF domain = 'payroll' THEN
    IF op = 'SELECT' THEN
      RETURN v_role = 'dentist' AND record_owner IS NOT NULL AND record_owner = auth.uid();
    ELSE
      RETURN false;
    END IF;
  ELSIF domain = 'admin' THEN
    IF op = 'SELECT' THEN
      RETURN v_role IN ('dentist', 'secretary', 'assistant');
    ELSE
      RETURN false;
    END IF;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.app_authorize_clinic_op(text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_authorize_clinic_op(text, text, text, text, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Remove Legacy JWT Fallback from Tenants Select Policy
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenants_member_select" ON public.tenants;
CREATE POLICY "tenants_member_select" ON public.tenants
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.clinic_memberships cm
      WHERE cm.user_id = auth.uid()
        AND cm.active = true
        AND cm.tenant_id = tenants.id
    )
  );

-- ----------------------------------------------------------------------------
-- 4. Tighten Scope-Stamping Trigger (Membership-Only, Zero JWT Fallback)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_stamp_verified_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_default_tenant text;
  v_default_branch text;
  v_has_created_by boolean;
  v_has_updated_by boolean;
BEGIN
  IF TG_OP = 'INSERT' AND (
    NEW.tenant_id IS NULL OR btrim(NEW.tenant_id) = '' OR
    NEW.branch_id IS NULL OR btrim(NEW.branch_id) = ''
  ) THEN
    IF v_uid IS NOT NULL THEN
      SELECT cm.tenant_id, cm.branch_id
        INTO v_default_tenant, v_default_branch
      FROM public.clinic_memberships cm
      WHERE cm.user_id = v_uid
        AND cm.active = true
      ORDER BY CASE cm.role
        WHEN 'manager' THEN 1
        WHEN 'dentist' THEN 2
        WHEN 'secretary' THEN 3
        WHEN 'assistant' THEN 4
        ELSE 9
      END, cm.created_at ASC
      LIMIT 1;

      IF v_default_tenant IS NULL OR v_default_branch IS NULL THEN
        RAISE EXCEPTION 'MINA_MEMBERSHIP_REQUIRED: Active clinic membership is required to stamp record scope'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.tenant_id IS NULL OR btrim(NEW.tenant_id) = '' THEN
        NEW.tenant_id := v_default_tenant;
      END IF;
      IF NEW.branch_id IS NULL OR btrim(NEW.branch_id) = '' THEN
        NEW.branch_id := v_default_branch;
      END IF;
    END IF;
  END IF;

  -- Prevent cross-tenant/branch relocation unless caller is verified manager in BOTH old and new scope
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id) THEN
    IF v_uid IS NOT NULL AND (
      public.app_resolve_verified_role(OLD.tenant_id, OLD.branch_id) IS DISTINCT FROM 'manager'
      OR public.app_resolve_verified_role(NEW.tenant_id, NEW.branch_id) IS DISTINCT FROM 'manager'
    ) THEN
      RAISE EXCEPTION 'Only verified clinic manager within both source and target branches may relocate record scope'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = TG_TABLE_SCHEMA AND table_name = TG_TABLE_NAME AND column_name = 'created_by'
    ),
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = TG_TABLE_SCHEMA AND table_name = TG_TABLE_NAME AND column_name = 'updated_by'
    )
  INTO v_has_created_by, v_has_updated_by;

  IF v_uid IS NOT NULL THEN
    IF TG_OP = 'INSERT' AND v_has_created_by THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object('created_by', v_uid));
    END IF;
    IF v_has_updated_by THEN
      NEW := jsonb_populate_record(NEW, jsonb_build_object('updated_by', v_uid));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 5. Deterministic Authenticated Membership Discovery RPC
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_get_my_verified_memberships()
RETURNS TABLE (
  tenant_id text,
  branch_id text,
  role text,
  active boolean,
  all_branches boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cm.tenant_id,
    cm.branch_id,
    cm.role,
    cm.active,
    COALESCE(cm.all_branches, false) AS all_branches
  FROM public.clinic_memberships cm
  WHERE auth.uid() IS NOT NULL
    AND cm.user_id = auth.uid()
    AND cm.active = true
  ORDER BY CASE cm.role
    WHEN 'manager' THEN 1
    WHEN 'dentist' THEN 2
    WHEN 'secretary' THEN 3
    WHEN 'assistant' THEN 4
    ELSE 9
  END, cm.created_at ASC;
$$;

REVOKE ALL ON FUNCTION public.app_get_my_verified_memberships() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_get_my_verified_memberships() TO authenticated;

COMMIT;
