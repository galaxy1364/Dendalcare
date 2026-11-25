-- ============================================================================
-- MINADENTAL V11 — LEAST-PRIVILEGE GRANTS, SERVER TRIGGERS, PRIVATE STORAGE
--                  & SCHEMA HEALTH VERIFICATION RPC
-- File: 20261128000000_v11_rls_grants_storage_and_triggers.sql
--
-- Security Guarantees:
--   1. Revokes ALL privileges from `PUBLIC` and `anon` across every clinic,
--      tenant, membership, and audit table; grants strictly to `authenticated`
--      subject to `FORCE ROW LEVEL SECURITY`.
--   2. Enforces fail-closed RLS on `tenants`, `branches`, `clinic_memberships`,
--      and `clinical_audit_events`.
--   3. Adds server-authoritative `BEFORE INSERT` scope-stamping trigger
--      `app_stamp_verified_scope()` across all 20 clinic tables so omitted
--      `tenant_id`/`branch_id` are derived strictly from the caller's verified
--      membership (fail-closed if none) and `created_by`/`updated_by` are
--      stamped from `auth.uid()`.
--   4. Adds DB-level financial price-lock trigger `app_enforce_financial_price_lock()`
--      preventing non-manager roles from altering persisted monetary columns
--      even if a client bypasses the UI or Guardian proxy.
--   5. Provisions private storage bucket `clinical-attachments` (`public = false`)
--      with fail-closed tenant/branch path policies (no public clinical bucket).
--   6. Registers all 20 clinic tables in `supabase_realtime` publication.
--   7. Exposes `public.get_v11_schema_health()` (`SECURITY INVOKER`, granted
--      exclusively to `authenticated`) for post-migration verification.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Least-Privilege Grants: Deny PUBLIC and anon completely
-- ----------------------------------------------------------------------------
REVOKE ALL ON SCHEMA public FROM anon;
GRANT USAGE ON SCHEMA public TO authenticated;

DO $$
DECLARE
  tbl text;
  all_public_tables text[] := ARRAY[
    'tenants', 'branches', 'clinic_memberships', 'clinical_audit_events',
    'rls_migration_audit_log',
    'patients', 'appointments', 'treatments', 'treatment_services',
    'lab_orders', 'implants', 'tooth_conditions', 'payments',
    'finance_transactions', 'installments', 'checks', 'safteh',
    'inventory', 'reminders', 'staff', 'staff_salaries', 'staff_shares',
    'messages', 'advertisements', 'clinic_settings'
  ];
BEGIN
  FOREACH tbl IN ARRAY all_public_tables LOOP
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

  -- Authenticated role receives DML rights strictly gated by FORCE RLS
  FOREACH tbl IN ARRAY ARRAY[
    'patients', 'appointments', 'treatments', 'treatment_services',
    'lab_orders', 'implants', 'tooth_conditions', 'payments',
    'finance_transactions', 'installments', 'checks', 'safteh',
    'inventory', 'reminders', 'staff', 'staff_salaries', 'staff_shares',
    'messages', 'advertisements', 'clinic_settings',
    'clinic_memberships', 'clinical_audit_events'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated;', tbl);
    END IF;
  END LOOP;

  -- Control-plane read tables (managers can also manage branches within their tenant)
  GRANT SELECT ON TABLE public.tenants TO authenticated;
  GRANT SELECT, INSERT, UPDATE ON TABLE public.branches TO authenticated;
  GRANT SELECT ON TABLE public.rls_migration_audit_log TO authenticated;
END $$;

REVOKE ALL ON FUNCTION public.app_jwt_tenant_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_jwt_branch_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_jwt_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_resolve_verified_role(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.app_authorize_clinic_op(text, text, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_clinic_dashboard_summary(text, text, date, date, date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.app_jwt_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_jwt_branch_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_jwt_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_resolve_verified_role(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_authorize_clinic_op(text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_clinic_dashboard_summary(text, text, date, date, date) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Strict Fail-Closed RLS on Control Plane & Audit Tables
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenants_member_select" ON public.tenants;
CREATE POLICY "tenants_member_select" ON public.tenants
  FOR SELECT TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM public.clinic_memberships cm
        WHERE cm.user_id = auth.uid()
          AND cm.active = true
          AND cm.tenant_id = tenants.id
      )
      OR (
        NOT EXISTS (SELECT 1 FROM public.clinic_memberships cm WHERE cm.user_id = auth.uid())
        AND public.app_jwt_tenant_id() = tenants.id
      )
    )
  );

DROP POLICY IF EXISTS "branches_member_select" ON public.branches;
CREATE POLICY "branches_member_select" ON public.branches
  FOR SELECT TO authenticated
  USING (public.app_resolve_verified_role(tenant_id, id) IS NOT NULL);

DROP POLICY IF EXISTS "branches_manager_insert" ON public.branches;
CREATE POLICY "branches_manager_insert" ON public.branches
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.clinic_memberships cm
      WHERE cm.user_id = auth.uid()
        AND cm.active = true
        AND cm.tenant_id = branches.tenant_id
        AND cm.role = 'manager'
        AND cm.all_branches = true
    )
  );

DROP POLICY IF EXISTS "branches_manager_update" ON public.branches;
CREATE POLICY "branches_manager_update" ON public.branches
  FOR UPDATE TO authenticated
  USING (public.app_resolve_verified_role(tenant_id, id) = 'manager')
  WITH CHECK (public.app_resolve_verified_role(tenant_id, id) = 'manager');

-- Managers may view and administer memberships strictly within their own tenant
DROP POLICY IF EXISTS "clinic_memberships_manager_select" ON public.clinic_memberships;
CREATE POLICY "clinic_memberships_manager_select" ON public.clinic_memberships
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.app_resolve_verified_role(tenant_id, branch_id) = 'manager'
  );

DROP POLICY IF EXISTS "clinic_memberships_manager_write" ON public.clinic_memberships;
CREATE POLICY "clinic_memberships_manager_write" ON public.clinic_memberships
  FOR INSERT TO authenticated
  WITH CHECK (public.app_resolve_verified_role(tenant_id, branch_id) = 'manager');

DROP POLICY IF EXISTS "clinic_memberships_manager_update" ON public.clinic_memberships;
CREATE POLICY "clinic_memberships_manager_update" ON public.clinic_memberships
  FOR UPDATE TO authenticated
  USING (public.app_resolve_verified_role(tenant_id, branch_id) = 'manager')
  WITH CHECK (public.app_resolve_verified_role(tenant_id, branch_id) = 'manager');

DROP POLICY IF EXISTS "clinic_memberships_manager_delete" ON public.clinic_memberships;
CREATE POLICY "clinic_memberships_manager_delete" ON public.clinic_memberships
  FOR DELETE TO authenticated
  USING (public.app_resolve_verified_role(tenant_id, branch_id) = 'manager');

-- Audit events: append-only for active branch members, readable ONLY by managers, immutable (no UPDATE/DELETE)
DROP POLICY IF EXISTS "clinical_audit_events_manager_select" ON public.clinical_audit_events;
CREATE POLICY "clinical_audit_events_manager_select" ON public.clinical_audit_events
  FOR SELECT TO authenticated
  USING (public.app_resolve_verified_role(tenant_id, branch_id) = 'manager');

DROP POLICY IF EXISTS "clinical_audit_events_member_insert" ON public.clinical_audit_events;
CREATE POLICY "clinical_audit_events_member_insert" ON public.clinical_audit_events
  FOR INSERT TO authenticated
  WITH CHECK (
    public.app_resolve_verified_role(tenant_id, branch_id) IS NOT NULL
    AND (actor_user_id IS NULL OR actor_user_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 3. Server-Authoritative Scope & Actor Stamping Trigger (all 20 clinic tables)
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
  -- If an authenticated client omits tenant_id or branch_id on INSERT,
  -- derive strictly from their active verified membership (never from arbitrary defaults).
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
        ELSE 5
      END, cm.created_at ASC
      LIMIT 1;

      IF v_default_tenant IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.clinic_memberships cm WHERE cm.user_id = v_uid
      ) THEN
        v_default_tenant := public.app_jwt_tenant_id();
        v_default_branch := public.app_jwt_branch_id();
      END IF;

      IF NEW.tenant_id IS NULL OR btrim(NEW.tenant_id) = '' THEN
        NEW.tenant_id := v_default_tenant;
      END IF;
      IF NEW.branch_id IS NULL OR btrim(NEW.branch_id) = '' THEN
        NEW.branch_id := v_default_branch;
      END IF;
    END IF;
  END IF;

  -- Prevent cross-tenant/branch relocation by non-managers on UPDATE
  IF TG_OP = 'UPDATE' AND (NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id) THEN
    IF public.app_resolve_verified_role(OLD.tenant_id, OLD.branch_id) <> 'manager' THEN
      RAISE EXCEPTION 'Only clinic manager may relocate record tenant/branch scope' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Stamp actor metadata when columns exist
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
-- 4. Server-Authoritative Financial Price-Lock Trigger (DB-level RBAC)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.app_enforce_financial_price_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_old_json jsonb := to_jsonb(OLD);
  v_new_json jsonb := to_jsonb(NEW);
  v_col text;
  locked_cols text[] := ARRAY[
    'total_cost', 'discount', 'doctor_cost', 'lab_cost', 'material_cost',
    'other_cost', 'unit_fee', 'amount', 'total_amount', 'monthly_amount',
    'base_salary', 'bonus', 'deductions', 'total_paid', 'share_amount',
    'share_value', 'share_type'
  ];
BEGIN
  -- Service-role / SQL migrations without auth.uid() are managed out-of-band by DB admins
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_role := public.app_resolve_verified_role(OLD.tenant_id, OLD.branch_id);
  IF v_role = 'manager' THEN
    RETURN NEW;
  END IF;

  FOREACH v_col IN ARRAY locked_cols LOOP
    IF (v_old_json ? v_col) AND (v_old_json -> v_col) IS DISTINCT FROM (v_new_json -> v_col) THEN
      RAISE EXCEPTION 'PRICE_LOCK_VIOLATION: Only clinic manager may modify persisted monetary column % on %', v_col, TG_TABLE_NAME
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tbl text;
  clinic_tables text[] := ARRAY[
    'patients', 'appointments', 'treatments', 'treatment_services',
    'lab_orders', 'implants', 'tooth_conditions', 'payments',
    'finance_transactions', 'installments', 'checks', 'safteh',
    'inventory', 'reminders', 'staff', 'staff_salaries', 'staff_shares',
    'messages', 'advertisements', 'clinic_settings'
  ];
  price_locked_tables text[] := ARRAY[
    'treatments', 'treatment_services', 'payments', 'installments',
    'checks', 'safteh', 'finance_transactions', 'staff_salaries', 'staff_shares'
  ];
BEGIN
  FOREACH tbl IN ARRAY clinic_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I;', 'trg_' || tbl || '_v11_scope', tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.app_stamp_verified_scope();',
      'trg_' || tbl || '_v11_scope',
      tbl
    );
  END LOOP;

  FOREACH tbl IN ARRAY price_locked_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I;', 'trg_' || tbl || '_v11_price_lock', tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.app_enforce_financial_price_lock();',
      'trg_' || tbl || '_v11_price_lock',
      tbl
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Private Clinical Storage Bucket + Fail-Closed Storage RLS
--    Path convention: <tenant_id>/<branch_id>/<patient_or_entity_id>/<filename>
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'clinical-attachments',
      'clinical-attachments',
      false,
      15728640,
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    )
    ON CONFLICT (id) DO UPDATE
      SET public = false,
          file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'objects'
  ) THEN
    DROP POLICY IF EXISTS "clinical_attachments_select" ON storage.objects;
    CREATE POLICY "clinical_attachments_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'clinical-attachments'
        AND array_length(storage.foldername(name), 1) >= 2
        AND public.app_resolve_verified_role((storage.foldername(name))[1], (storage.foldername(name))[2]) IS NOT NULL
      );

    DROP POLICY IF EXISTS "clinical_attachments_insert" ON storage.objects;
    CREATE POLICY "clinical_attachments_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'clinical-attachments'
        AND array_length(storage.foldername(name), 1) >= 2
        AND public.app_resolve_verified_role((storage.foldername(name))[1], (storage.foldername(name))[2]) IN ('manager', 'dentist', 'secretary', 'assistant')
      );

    DROP POLICY IF EXISTS "clinical_attachments_delete" ON storage.objects;
    CREATE POLICY "clinical_attachments_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'clinical-attachments'
        AND array_length(storage.foldername(name), 1) >= 2
        AND public.app_resolve_verified_role((storage.foldername(name))[1], (storage.foldername(name))[2]) = 'manager'
      );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. Supabase Realtime Publication Membership (Idempotent)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  realtime_tables text[] := ARRAY[
    'patients', 'appointments', 'treatments', 'treatment_services',
    'lab_orders', 'implants', 'tooth_conditions', 'payments',
    'finance_transactions', 'installments', 'checks', 'safteh',
    'inventory', 'reminders', 'staff', 'staff_salaries', 'staff_shares',
    'messages', 'advertisements', 'clinic_settings'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH tbl IN ARRAY realtime_tables LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = tbl
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I;', tbl);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. V11 Schema Health Verification RPC (Authenticated-only, SECURITY INVOKER)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_v11_schema_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_expected_tables text[] := ARRAY[
    'tenants', 'branches', 'clinic_memberships', 'clinical_audit_events',
    'patients', 'appointments', 'treatments', 'treatment_services',
    'lab_orders', 'implants', 'tooth_conditions', 'payments',
    'finance_transactions', 'installments', 'checks', 'safteh',
    'inventory', 'reminders', 'staff', 'staff_salaries', 'staff_shares',
    'messages', 'advertisements', 'clinic_settings'
  ];
  v_present_count integer;
  v_forced_rls_count integer;
  v_patients_has_full_name boolean;
  v_memberships jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_present_count
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = ANY(v_expected_tables);

  SELECT count(*) INTO v_forced_rls_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = ANY(v_expected_tables)
    AND c.relrowsecurity = true
    AND c.relforcerowsecurity = true;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'patients'
      AND column_name = 'full_name'
  ) INTO v_patients_has_full_name;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'tenant_id', cm.tenant_id,
    'branch_id', cm.branch_id,
    'role', cm.role,
    'all_branches', cm.all_branches,
    'active', cm.active
  )), '[]'::jsonb)
  INTO v_memberships
  FROM public.clinic_memberships cm
  WHERE cm.user_id = auth.uid()
    AND cm.active = true;

  RETURN jsonb_build_object(
    'schema_version', 'v11',
    'expected_table_count', array_length(v_expected_tables, 1),
    'present_table_count', v_present_count,
    'forced_rls_table_count', v_forced_rls_count,
    'patients_schema_aligned', v_patients_has_full_name,
    'caller_memberships', v_memberships,
    'checked_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_v11_schema_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_v11_schema_health() TO authenticated;

COMMIT;
