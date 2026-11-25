-- MinaDental Tenant & Branch Isolation + Role-Based RLS Migration
-- Trace ID: TRC-MINA-SECOND-AUDIT-9013-M (FIX 08)

DO $$
DECLARE
  tbl TEXT;
  clinic_tables TEXT[] := ARRAY[
    'patients',
    'appointments',
    'treatments',
    'treatment_services',
    'payments',
    'lab_orders',
    'implants',
    'inventory',
    'reminders',
    'finance_transactions',
    'staff',
    'tooth_conditions',
    'installments',
    'checks',
    'safteh',
    'staff_salaries',
    'staff_shares',
    'messages',
    'advertisements',
    'clinic_settings'
  ];
BEGIN
  FOREACH tbl IN ARRAY clinic_tables LOOP
    EXECUTE format(
      'ALTER TABLE IF EXISTS public.%I ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT ''minadental_clinic'';',
      tbl
    );
    EXECUTE format(
      'ALTER TABLE IF EXISTS public.%I ADD COLUMN IF NOT EXISTS branch_id TEXT NOT NULL DEFAULT ''main'';',
      tbl
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (tenant_id, branch_id);',
      'idx_' || tbl || '_tenant_branch',
      tbl
    );
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY;', tbl);

    -- Read policy scoped to JWT tenant_id and branch_id claims
    EXECUTE format('DROP POLICY IF EXISTS mina_tenant_branch_select ON public.%I;', tbl);
    EXECUTE format(
      $pol$
      CREATE POLICY mina_tenant_branch_select ON public.%I
      FOR SELECT
      TO authenticated
      USING (
        tenant_id = COALESCE((auth.jwt() -> 'app_metadata' ->> 'tenant_id'), 'minadental_clinic')
        AND (
          branch_id = COALESCE((auth.jwt() -> 'app_metadata' ->> 'branch_id'), branch_id)
          OR COALESCE((auth.jwt() -> 'app_metadata' ->> 'clinic_role'), '') = 'manager'
        )
      );
      $pol$,
      tbl
    );

    -- Insert/Update policy scoped to tenant + branch + clinical role
    EXECUTE format('DROP POLICY IF EXISTS mina_tenant_branch_insert ON public.%I;', tbl);
    EXECUTE format(
      $pol$
      CREATE POLICY mina_tenant_branch_insert ON public.%I
      FOR INSERT
      TO authenticated
      WITH CHECK (
        tenant_id = COALESCE((auth.jwt() -> 'app_metadata' ->> 'tenant_id'), 'minadental_clinic')
        AND COALESCE((auth.jwt() -> 'app_metadata' ->> 'clinic_role'), 'secretary') IN ('manager', 'dentist', 'secretary', 'assistant')
      );
      $pol$,
      tbl
    );

    EXECUTE format('DROP POLICY IF EXISTS mina_tenant_branch_update ON public.%I;', tbl);
    EXECUTE format(
      $pol$
      CREATE POLICY mina_tenant_branch_update ON public.%I
      FOR UPDATE
      TO authenticated
      USING (
        tenant_id = COALESCE((auth.jwt() -> 'app_metadata' ->> 'tenant_id'), 'minadental_clinic')
      )
      WITH CHECK (
        tenant_id = COALESCE((auth.jwt() -> 'app_metadata' ->> 'tenant_id'), 'minadental_clinic')
      );
      $pol$,
      tbl
    );

    -- Manager-only DELETE policy (Zero-Delete Vault protection)
    EXECUTE format('DROP POLICY IF EXISTS mina_manager_only_delete ON public.%I;', tbl);
    EXECUTE format(
      $pol$
      CREATE POLICY mina_manager_only_delete ON public.%I
      FOR DELETE
      TO authenticated
      USING (
        tenant_id = COALESCE((auth.jwt() -> 'app_metadata' ->> 'tenant_id'), 'minadental_clinic')
        AND COALESCE((auth.jwt() -> 'app_metadata' ->> 'clinic_role'), '') = 'manager'
      );
      $pol$,
      tbl
    );
  END LOOP;
END $$;

-- Link payment_id on finance_transactions for strict accrual/cash accounting deduplication
ALTER TABLE IF EXISTS public.finance_transactions
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_finance_transactions_payment_id
  ON public.finance_transactions (payment_id);
