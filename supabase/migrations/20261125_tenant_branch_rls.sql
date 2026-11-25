-- ============================================================================
-- MINADENTAL — BASE TENANT & BRANCH COLUMNS + FAIL-CLOSED RLS MIGRATION
-- Hardened in Third Audit (superseded/extended by 20261126_rls_hardening.sql)
-- Guarantees default-DENY when tenant_id, branch_id, or clinic_role is missing.
-- ============================================================================

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
BEGIN
  FOREACH tbl IN ARRAY clinic_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS tenant_id text;', tbl);
      EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS branch_id text;', tbl);
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id, branch_id);', 'idx_' || tbl || '_tenant_branch', tbl);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);
    END IF;
  END LOOP;
END $$;

-- Accounting link columns for deterministic deduplication & guarantee check isolation
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
END $$;

-- Strict fail-closed policies (NO permissive COALESCE default-allow fallbacks)
DO $$
DECLARE
  tbl text;
  pol record;
  clinical_tables text[] := ARRAY[
    'patients', 'appointments', 'treatments', 'treatment_services',
    'lab_orders', 'implants', 'tooth_conditions', 'inventory',
    'reminders', 'staff', 'messages', 'advertisements', 'clinic_settings'
  ];
  billing_tables text[] := ARRAY[
    'payments', 'installments', 'checks', 'safteh'
  ];
  restricted_financial_tables text[] := ARRAY[
    'finance_transactions', 'staff_salaries', 'staff_shares'
  ];
BEGIN
  FOREACH tbl IN ARRAY clinical_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol.policyname, tbl);
      END LOOP;

      EXECUTE format('
        CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
        USING (
          auth.uid() IS NOT NULL
          AND tenant_id IS NOT NULL AND branch_id IS NOT NULL
          AND (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'') = tenant_id
          AND (
            (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') = ''manager''
            OR (
              (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') IN (''dentist'', ''secretary'', ''assistant'')
              AND (auth.jwt() -> ''app_metadata'' ->> ''branch_id'') = branch_id
            )
          )
        );', tbl || '_tenant_branch_select', tbl);

      EXECUTE format('
        CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
        WITH CHECK (
          auth.uid() IS NOT NULL
          AND tenant_id IS NOT NULL AND branch_id IS NOT NULL
          AND (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'') = tenant_id
          AND (
            (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') = ''manager''
            OR (
              (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') IN (''dentist'', ''secretary'', ''assistant'')
              AND (auth.jwt() -> ''app_metadata'' ->> ''branch_id'') = branch_id
            )
          )
        );', tbl || '_tenant_branch_insert', tbl);

      EXECUTE format('
        CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
        USING (
          auth.uid() IS NOT NULL
          AND tenant_id IS NOT NULL AND branch_id IS NOT NULL
          AND (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'') = tenant_id
          AND (
            (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') = ''manager''
            OR (
              (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') IN (''dentist'', ''secretary'', ''assistant'')
              AND (auth.jwt() -> ''app_metadata'' ->> ''branch_id'') = branch_id
            )
          )
        )
        WITH CHECK (
          auth.uid() IS NOT NULL
          AND tenant_id IS NOT NULL AND branch_id IS NOT NULL
          AND (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'') = tenant_id
          AND (
            (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') = ''manager''
            OR (
              (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') IN (''dentist'', ''secretary'', ''assistant'')
              AND (auth.jwt() -> ''app_metadata'' ->> ''branch_id'') = branch_id
            )
          )
        );', tbl || '_tenant_branch_update', tbl);

      EXECUTE format('
        CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
        USING (
          auth.uid() IS NOT NULL
          AND tenant_id IS NOT NULL AND branch_id IS NOT NULL
          AND (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'') = tenant_id
          AND (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') = ''manager''
        );', tbl || '_tenant_branch_delete', tbl);
    END IF;
  END LOOP;

  FOREACH tbl IN ARRAY billing_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol.policyname, tbl);
      END LOOP;

      EXECUTE format('
        CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
        USING (
          auth.uid() IS NOT NULL
          AND tenant_id IS NOT NULL AND branch_id IS NOT NULL
          AND (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'') = tenant_id
          AND (
            (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') = ''manager''
            OR (
              (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') = ''secretary''
              AND (auth.jwt() -> ''app_metadata'' ->> ''branch_id'') = branch_id
            )
          )
        );', tbl || '_billing_select', tbl);

      EXECUTE format('
        CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
        WITH CHECK (
          auth.uid() IS NOT NULL
          AND tenant_id IS NOT NULL AND branch_id IS NOT NULL
          AND (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'') = tenant_id
          AND (
            (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') = ''manager''
            OR (
              (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') = ''secretary''
              AND (auth.jwt() -> ''app_metadata'' ->> ''branch_id'') = branch_id
            )
          )
        );', tbl || '_billing_insert', tbl);

      EXECUTE format('
        CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
        USING (
          auth.uid() IS NOT NULL
          AND tenant_id IS NOT NULL AND branch_id IS NOT NULL
          AND (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'') = tenant_id
          AND (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') = ''manager''
        )
        WITH CHECK (
          auth.uid() IS NOT NULL
          AND tenant_id IS NOT NULL AND branch_id IS NOT NULL
          AND (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'') = tenant_id
          AND (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') = ''manager''
        );', tbl || '_billing_update', tbl);

      EXECUTE format('
        CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
        USING (
          auth.uid() IS NOT NULL
          AND tenant_id IS NOT NULL AND branch_id IS NOT NULL
          AND (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'') = tenant_id
          AND (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') = ''manager''
        );', tbl || '_billing_delete', tbl);
    END IF;
  END LOOP;

  FOREACH tbl IN ARRAY restricted_financial_tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', pol.policyname, tbl);
      END LOOP;

      EXECUTE format('
        CREATE POLICY %I ON public.%I FOR ALL TO authenticated
        USING (
          auth.uid() IS NOT NULL
          AND tenant_id IS NOT NULL AND branch_id IS NOT NULL
          AND (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'') = tenant_id
          AND (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') = ''manager''
        )
        WITH CHECK (
          auth.uid() IS NOT NULL
          AND tenant_id IS NOT NULL AND branch_id IS NOT NULL
          AND (auth.jwt() -> ''app_metadata'' ->> ''tenant_id'') = tenant_id
          AND (auth.jwt() -> ''app_metadata'' ->> ''clinic_role'') = ''manager''
        );', tbl || '_manager_only', tbl);
    END IF;
  END LOOP;
END $$;
