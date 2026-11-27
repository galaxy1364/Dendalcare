-- ============================================================================
-- MINADENTAL V16 — FINANCIAL INTELLIGENCE, ATOMIC DOUBLE-ENTRY LEDGER,
-- CHARGE ALLOCATIONS, IDEMPOTENT PAYMENT COMMANDS & DAILY RECONCILIATION
--
-- Target Supabase Project: npzcweiphmyhtzxxnlov
-- Prerequisite Migrations:
--   - V12 foundation (20261125213357, 20261125213523, 20261125213554) — live
--   - V14 transactional scheduling (20261129000000) — staged forward
--   - V15 clinical record & safety (20261130000000) — staged forward
--
-- Do NOT replay V12 migrations. This migration is strictly additive & forward.
-- Currency Contract: IRR_TOMAN (exact integer numeric(18,0) / bigint; zero floats).
-- Timezone Contract: Asia/Tehran for clinic business_date boundaries.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 1. Financial Accounts & Chart of Accounts
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  code text NOT NULL CHECK (btrim(code) <> ''),
  name_fa text NOT NULL CHECK (btrim(name_fa) <> ''),
  account_kind text NOT NULL CHECK (account_kind IN ('cash_drawer', 'bank_pos', 'bank_transfer', 'petty_cash')),
  currency_unit text NOT NULL DEFAULT 'IRR_TOMAN' CHECK (currency_unit IN ('IRR_TOMAN', 'IRR_RIAL')),
  opening_balance bigint NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, code),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.clinic_branches(tenant_id, id) ON DELETE RESTRICT
);

ALTER TABLE public.financial_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_accounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.financial_accounts TO authenticated;
GRANT INSERT, UPDATE ON public.financial_accounts TO authenticated;

DROP POLICY IF EXISTS financial_accounts_select ON public.financial_accounts;
CREATE POLICY financial_accounts_select ON public.financial_accounts
  FOR SELECT TO authenticated
  USING (public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary'));

DROP POLICY IF EXISTS financial_accounts_manager_write ON public.financial_accounts;
CREATE POLICY financial_accounts_manager_write ON public.financial_accounts
  FOR ALL TO authenticated
  USING (public.app_resolve_verified_role(tenant_id, branch_id) = 'manager')
  WITH CHECK (public.app_resolve_verified_role(tenant_id, branch_id) = 'manager');

CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  code text NOT NULL CHECK (btrim(code) <> ''),
  name_fa text NOT NULL CHECK (btrim(name_fa) <> ''),
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'contra_revenue', 'expense')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id) REFERENCES public.clinic_tenants(id) ON DELETE RESTRICT
);

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.chart_of_accounts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chart_of_accounts TO authenticated;

DROP POLICY IF EXISTS chart_of_accounts_select ON public.chart_of_accounts;
CREATE POLICY chart_of_accounts_select ON public.chart_of_accounts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clinic_memberships m
      WHERE m.user_id = (SELECT auth.uid())
        AND m.tenant_id = chart_of_accounts.tenant_id
        AND m.active = true
        AND m.role IN ('manager', 'secretary')
    )
  );

-- ----------------------------------------------------------------------------
-- 2. Service Charges (Separates Estimates/Plans from Posted A/R Charges)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  encounter_id uuid,
  treatment_id uuid REFERENCES public.treatments(id) ON DELETE RESTRICT,
  provider_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  procedure_title text NOT NULL CHECK (btrim(procedure_title) <> ''),
  fdi_teeth text,
  charge_status text NOT NULL DEFAULT 'posted'
    CHECK (charge_status IN ('estimate', 'draft', 'posted', 'reversed')),
  currency_unit text NOT NULL DEFAULT 'IRR_TOMAN' CHECK (currency_unit = 'IRR_TOMAN'),
  gross_amount bigint NOT NULL CHECK (gross_amount >= 0),
  discount_amount bigint NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  approved_adjustment bigint NOT NULL DEFAULT 0,
  net_amount bigint GENERATED ALWAYS AS (GREATEST(0, gross_amount - discount_amount + approved_adjustment)) STORED,
  allocated_paid_amount bigint NOT NULL DEFAULT 0 CHECK (allocated_paid_amount >= 0),
  performed_at date,
  due_date date,
  posted_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL DEFAULT (SELECT auth.uid()),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.clinic_branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_service_charges_patient_scope
  ON public.service_charges (tenant_id, branch_id, patient_id, charge_status);
CREATE INDEX IF NOT EXISTS idx_service_charges_treatment
  ON public.service_charges (treatment_id);

ALTER TABLE public.service_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_charges FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_charges FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.service_charges TO authenticated;

DROP POLICY IF EXISTS service_charges_select ON public.service_charges;
CREATE POLICY service_charges_select ON public.service_charges
  FOR SELECT TO authenticated
  USING (
    public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'secretary')
    OR (
      public.app_resolve_verified_role(tenant_id, branch_id) = 'dentist'
      AND EXISTS (
        SELECT 1 FROM public.staff s
        WHERE s.id = service_charges.provider_staff_id
          AND s.tenant_id = service_charges.tenant_id
      )
    )
  );

DROP POLICY IF EXISTS service_charges_write ON public.service_charges;
CREATE POLICY service_charges_write ON public.service_charges
  FOR INSERT TO authenticated
  WITH CHECK (public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'dentist', 'secretary'));

DROP POLICY IF EXISTS service_charges_update ON public.service_charges;
CREATE POLICY service_charges_update ON public.service_charges
  FOR UPDATE TO authenticated
  USING (public.app_resolve_verified_role(tenant_id, branch_id) = 'manager')
  WITH CHECK (public.app_resolve_verified_role(tenant_id, branch_id) = 'manager');

-- ----------------------------------------------------------------------------
-- 3. Extend Legacy Financial Tables Safely (Idempotent ALTERs)
-- ----------------------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS currency_unit text NOT NULL DEFAULT 'IRR_TOMAN',
  ADD COLUMN IF NOT EXISTS unapplied_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cleared_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS provider_staff_id uuid,
  ADD COLUMN IF NOT EXISTS financial_account_id uuid,
  ADD COLUMN IF NOT EXISTS reversal_reason text;

ALTER TABLE public.finance_transactions
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS posting_status text NOT NULL DEFAULT 'posted'
    CHECK (posting_status IN ('draft', 'posted', 'reversed')),
  ADD COLUMN IF NOT EXISTS reversal_of_tx_id uuid REFERENCES public.finance_transactions(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS journal_entry_id uuid,
  ADD COLUMN IF NOT EXISTS currency_unit text NOT NULL DEFAULT 'IRR_TOMAN',
  ADD COLUMN IF NOT EXISTS source_account_id uuid,
  ADD COLUMN IF NOT EXISTS destination_account_id uuid;

ALTER TABLE public.checks
  ADD COLUMN IF NOT EXISTS instrument_purpose text NOT NULL DEFAULT 'collectible'
    CHECK (instrument_purpose IN ('collectible', 'guarantee')),
  ADD COLUMN IF NOT EXISTS clearing_payment_id uuid REFERENCES public.payments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS returned_reversal_tx_id uuid REFERENCES public.finance_transactions(id) ON DELETE RESTRICT;

-- Guard posted finance_transactions against silent in-place edit or DELETE
CREATE OR REPLACE FUNCTION private.prevent_posted_finance_tx_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.posting_status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'MINA_FIN_POSTED_IMMUTABLE: Posted transaction % cannot be deleted; issue a reversal entry', OLD.id
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.posting_status IN ('posted', 'reversed') THEN
    -- Allow marking a posted row as reversed ONLY alongside a verified reversal command
    IF NEW.posting_status = 'reversed'
       AND OLD.posting_status = 'posted'
       AND NEW.amount = OLD.amount
       AND NEW.type = OLD.type
       AND NEW.transaction_date = OLD.transaction_date THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'MINA_FIN_POSTED_IMMUTABLE: Posted transaction % cannot be edited in place; post an adjustment or reversal', OLD.id
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_posted_finance_tx_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS finance_transactions_posted_immutability_guard ON public.finance_transactions;
CREATE TRIGGER finance_transactions_posted_immutability_guard
  BEFORE UPDATE OR DELETE ON public.finance_transactions
  FOR EACH ROW
  EXECUTE FUNCTION private.prevent_posted_finance_tx_mutation();

-- ----------------------------------------------------------------------------
-- 4. Payment Allocations (Paysplits / Charge Reconciliation)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES public.payments(id) ON DELETE RESTRICT,
  charge_id uuid NOT NULL REFERENCES public.service_charges(id) ON DELETE RESTRICT,
  provider_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  allocation_kind text NOT NULL DEFAULT 'payment' CHECK (allocation_kind IN ('payment', 'credit_apply', 'reversal')),
  reversal_of_allocation_id uuid REFERENCES public.payment_allocations(id) ON DELETE RESTRICT,
  stable_key text NOT NULL,
  created_by uuid NOT NULL DEFAULT (SELECT auth.uid()),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, stable_key),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.clinic_branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment
  ON public.payment_allocations (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_charge
  ON public.payment_allocations (charge_id);

ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_allocations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_allocations TO authenticated;

DROP POLICY IF EXISTS payment_allocations_select ON public.payment_allocations;
CREATE POLICY payment_allocations_select ON public.payment_allocations
  FOR SELECT TO authenticated
  USING (public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'secretary'));

-- ----------------------------------------------------------------------------
-- 5. Balanced Double-Entry Journal (Header + Lines + Balance Constraint Trigger)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  origin_module text NOT NULL CHECK (origin_module IN ('payment', 'refund', 'charge', 'adjustment', 'transfer', 'check_clear', 'check_return', 'day_close')),
  origin_record_id uuid,
  business_date date NOT NULL,
  currency_unit text NOT NULL DEFAULT 'IRR_TOMAN' CHECK (currency_unit = 'IRR_TOMAN'),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  memo text,
  created_by uuid NOT NULL DEFAULT (SELECT auth.uid()),
  posted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.clinic_branches(tenant_id, id) ON DELETE RESTRICT
);

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.journal_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.journal_entries TO authenticated;

DROP POLICY IF EXISTS journal_entries_select ON public.journal_entries;
CREATE POLICY journal_entries_select ON public.journal_entries
  FOR SELECT TO authenticated
  USING (public.app_resolve_verified_role(tenant_id, branch_id) = 'manager');

CREATE TABLE IF NOT EXISTS public.journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE RESTRICT,
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  account_code text NOT NULL,
  debit_toman bigint NOT NULL DEFAULT 0 CHECK (debit_toman >= 0),
  credit_toman bigint NOT NULL DEFAULT 0 CHECK (credit_toman >= 0),
  patient_id uuid REFERENCES public.patients(id) ON DELETE RESTRICT,
  provider_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  CHECK ((debit_toman > 0 AND credit_toman = 0) OR (credit_toman > 0 AND debit_toman = 0)),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.clinic_branches(tenant_id, id) ON DELETE RESTRICT
);

ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_lines FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.journal_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.journal_lines TO authenticated;

DROP POLICY IF EXISTS journal_lines_select ON public.journal_lines;
CREATE POLICY journal_lines_select ON public.journal_lines
  FOR SELECT TO authenticated
  USING (public.app_resolve_verified_role(tenant_id, branch_id) = 'manager');

CREATE OR REPLACE FUNCTION private.verify_journal_entry_balanced()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_debit bigint;
  v_credit bigint;
  v_entry_id uuid;
BEGIN
  v_entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  SELECT COALESCE(SUM(debit_toman), 0), COALESCE(SUM(credit_toman), 0)
  INTO v_debit, v_credit
  FROM public.journal_lines
  WHERE journal_entry_id = v_entry_id;

  IF v_debit <= 0 OR v_debit <> v_credit THEN
    RAISE EXCEPTION 'MINA_FIN_JOURNAL_UNBALANCED: Journal entry % unbalanced (debit=% credit=%)', v_entry_id, v_debit, v_credit
      USING ERRCODE = '22023';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.verify_journal_entry_balanced() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS journal_lines_balance_constraint ON public.journal_lines;
CREATE CONSTRAINT TRIGGER journal_lines_balance_constraint
  AFTER INSERT OR UPDATE OR DELETE ON public.journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION private.verify_journal_entry_balanced();

-- ----------------------------------------------------------------------------
-- 6. Protected Finance Command Idempotency Ledger & Audit Events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.finance_command_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  actor_id uuid NOT NULL,
  command_name text NOT NULL,
  idempotency_key text NOT NULL,
  payload_sha256 text NOT NULL,
  response_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, command_name, idempotency_key),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.clinic_branches(tenant_id, id) ON DELETE RESTRICT
);

ALTER TABLE public.finance_command_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_command_idempotency FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_command_idempotency FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.finance_command_idempotency TO authenticated;

DROP POLICY IF EXISTS finance_idempotency_select_own ON public.finance_command_idempotency;
CREATE POLICY finance_idempotency_select_own ON public.finance_command_idempotency
  FOR SELECT TO authenticated
  USING (
    actor_id = (SELECT auth.uid())
    AND public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'secretary')
  );

CREATE OR REPLACE FUNCTION private.guard_finance_idempotency_direct_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'MINA_FIN_IDEMPOTENCY_IMMUTABLE: Ledger rows cannot be modified or deleted'
      USING ERRCODE = '42501';
  END IF;
  IF current_setting('minadental.internal_finance_rpc', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'MINA_FIN_IDEMPOTENCY_DIRECT_WRITE_FORBIDDEN: Write via authoritative RPC only'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_finance_idempotency_direct_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS finance_idempotency_write_guard ON public.finance_command_idempotency;
CREATE TRIGGER finance_idempotency_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.finance_command_idempotency
  FOR EACH ROW
  EXECUTE FUNCTION private.guard_finance_idempotency_direct_write();

CREATE OR REPLACE FUNCTION private.record_finance_command_idempotency_v16(
  p_tenant_id text,
  p_branch_id text,
  p_actor_id uuid,
  p_command_name text,
  p_idempotency_key text,
  p_payload_sha256 text,
  p_response_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM set_config('minadental.internal_finance_rpc', '1', true);
  INSERT INTO public.finance_command_idempotency (
    tenant_id, branch_id, actor_id, command_name, idempotency_key, payload_sha256, response_payload
  ) VALUES (
    p_tenant_id, p_branch_id, p_actor_id, p_command_name, p_idempotency_key, p_payload_sha256, p_response_payload
  );
END;
$$;

REVOKE ALL ON FUNCTION private.record_finance_command_idempotency_v16(text, text, uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.financial_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  actor_user_id uuid NOT NULL DEFAULT (SELECT auth.uid()),
  actor_role text NOT NULL,
  operation text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  prior_reference text,
  new_reference text,
  reason text,
  correlation_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.clinic_branches(tenant_id, id) ON DELETE RESTRICT
);

ALTER TABLE public.financial_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_audit_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.financial_audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.financial_audit_events TO authenticated;

DROP POLICY IF EXISTS financial_audit_events_select ON public.financial_audit_events;
CREATE POLICY financial_audit_events_select ON public.financial_audit_events
  FOR SELECT TO authenticated
  USING (public.app_resolve_verified_role(tenant_id, branch_id) = 'manager');

-- ----------------------------------------------------------------------------
-- 7. Daily Close & Period Lock Sessions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_close_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  business_date date NOT NULL,
  currency_unit text NOT NULL DEFAULT 'IRR_TOMAN',
  opening_balance bigint NOT NULL DEFAULT 0,
  expected_cash bigint NOT NULL DEFAULT 0,
  expected_card bigint NOT NULL DEFAULT 0,
  expected_transfer bigint NOT NULL DEFAULT 0,
  expected_refunds bigint NOT NULL DEFAULT 0,
  counted_cash bigint NOT NULL DEFAULT 0,
  variance_amount bigint NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  exception_notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'reopened')),
  closed_by uuid,
  closed_at timestamptz,
  reopened_by uuid,
  reopened_at timestamptz,
  reopen_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, business_date),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.clinic_branches(tenant_id, id) ON DELETE RESTRICT
);

ALTER TABLE public.daily_close_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_close_sessions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_close_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.daily_close_sessions TO authenticated;

DROP POLICY IF EXISTS daily_close_select ON public.daily_close_sessions;
CREATE POLICY daily_close_select ON public.daily_close_sessions
  FOR SELECT TO authenticated
  USING (public.app_resolve_verified_role(tenant_id, branch_id) IN ('manager', 'secretary'));

-- ----------------------------------------------------------------------------
-- 8. Authoritative Transactional RPC: post_patient_payment_v16
--    Commits payment + allocations + service_charges balance + balanced journal
--    + linked finance_transactions + audit + idempotency in ONE transaction.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_patient_payment_v16(
  p_tenant_id text,
  p_branch_id text,
  p_patient_id uuid,
  p_amount_toman bigint,
  p_payment_method text,
  p_business_date date,
  p_idempotency_key text,
  p_allocations jsonb DEFAULT '[]'::jsonb,
  p_description text DEFAULT NULL,
  p_provider_staff_id uuid DEFAULT NULL,
  p_expected_charge_versions jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_role text;
  v_existing public.finance_command_idempotency%ROWTYPE;
  v_payload_hash text;
  v_closed_count integer;
  v_payment_id uuid;
  v_tx_id uuid;
  v_journal_id uuid;
  v_alloc jsonb;
  v_alloc_total bigint := 0;
  v_charge_id uuid;
  v_alloc_amount bigint;
  v_charge public.service_charges%ROWTYPE;
  v_open_balance bigint;
  v_unapplied bigint;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'MINA_FIN_UNAUTHENTICATED: Active session required' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_resolve_verified_role(p_tenant_id, p_branch_id);
  IF v_role IS NULL OR v_role NOT IN ('manager', 'secretary') THEN
    RAISE EXCEPTION 'MINA_FIN_FORBIDDEN: Role % is not permitted to post patient payments', COALESCE(v_role, 'none')
      USING ERRCODE = '42501';
  END IF;

  IF p_amount_toman IS NULL OR p_amount_toman <= 0 THEN
    RAISE EXCEPTION 'MINA_FIN_INVALID_AMOUNT: Payment amount must be positive integer toman' USING ERRCODE = '22023';
  END IF;

  IF p_payment_method NOT IN ('cash', 'card', 'transfer', 'insurance', 'installment') THEN
    RAISE EXCEPTION 'MINA_FIN_INVALID_METHOD: Unsupported payment method %', p_payment_method USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'MINA_FIN_IDEMPOTENCY_REQUIRED: Unique request key is required' USING ERRCODE = '22023';
  END IF;

  -- Check closed business period
  SELECT COUNT(*) INTO v_closed_count
  FROM public.daily_close_sessions
  WHERE tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND business_date = p_business_date
    AND status = 'closed';
  IF v_closed_count > 0 THEN
    RAISE EXCEPTION 'MINA_FIN_PERIOD_CLOSED: Business date % is closed; reopen with manager approval first', p_business_date
      USING ERRCODE = '42501';
  END IF;

  -- Verify patient belongs to tenant/branch
  PERFORM 1 FROM public.patients
  WHERE id = p_patient_id AND tenant_id = p_tenant_id AND branch_id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINA_FIN_SCOPE_MISMATCH: Patient % does not belong to branch %', p_patient_id, p_branch_id
      USING ERRCODE = '22023';
  END IF;

  v_payload_hash := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'patient_id', p_patient_id,
          'amount', p_amount_toman,
          'method', p_payment_method,
          'business_date', p_business_date,
          'allocations', COALESCE(p_allocations, '[]'::jsonb)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT * INTO v_existing
  FROM public.finance_command_idempotency
  WHERE tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND command_name = 'post_patient_payment_v16'
    AND idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.actor_id <> v_actor THEN
      RAISE EXCEPTION 'MINA_FIN_IDEMPOTENCY_ACTOR_MISMATCH: Key owned by another actor' USING ERRCODE = '42501';
    END IF;
    IF v_existing.payload_sha256 <> v_payload_hash THEN
      RAISE EXCEPTION 'MINA_FIN_IDEMPOTENCY_CONFLICT: Idempotency key reused with modified payload' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_set(v_existing.response_payload, '{idempotentReplay}', 'true'::jsonb, true);
  END IF;

  -- Insert payment
  INSERT INTO public.payments (
    tenant_id, branch_id, patient_id, amount, payment_method, payment_date,
    description, status, currency_unit, idempotency_key, provider_staff_id, created_by
  ) VALUES (
    p_tenant_id, p_branch_id, p_patient_id, p_amount_toman, p_payment_method, p_business_date,
    COALESCE(NULLIF(btrim(p_description), ''), 'دریافت وجه بیمار'), 'completed', 'IRR_TOMAN',
    p_idempotency_key, p_provider_staff_id, v_actor
  )
  RETURNING id INTO v_payment_id;

  -- Lock & apply allocations deterministically by charge_id order
  FOR v_alloc IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_allocations, '[]'::jsonb))
    ORDER BY (value->>'chargeId') ASC
  LOOP
    v_charge_id := (v_alloc->>'chargeId')::uuid;
    v_alloc_amount := (v_alloc->>'amount')::bigint;
    IF v_alloc_amount IS NULL OR v_alloc_amount <= 0 THEN
      RAISE EXCEPTION 'MINA_FIN_INVALID_ALLOCATION: Allocation amount must be positive' USING ERRCODE = '22023';
    END IF;
    v_alloc_total := v_alloc_total + v_alloc_amount;
    IF v_alloc_total > p_amount_toman THEN
      RAISE EXCEPTION 'MINA_FIN_OVER_ALLOCATION: Allocations (%) exceed payment (%)', v_alloc_total, p_amount_toman
        USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_charge
    FROM public.service_charges
    WHERE (id = v_charge_id OR treatment_id = v_charge_id)
      AND tenant_id = p_tenant_id
      AND branch_id = p_branch_id
      AND patient_id = p_patient_id
      AND charge_status = 'posted'
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.service_charges (
        tenant_id, branch_id, patient_id, treatment_id, procedure_title, fdi_teeth,
        charge_status, currency_unit, gross_amount, discount_amount, allocated_paid_amount,
        performed_at, posted_at, created_by
      )
      SELECT
        t.tenant_id, t.branch_id, t.patient_id, t.id,
        COALESCE(NULLIF(btrim(t.diagnosis), ''), 'درمان دندانپزشکی'),
        t.tooth_numbers,
        'posted', 'IRR_TOMAN',
        GREATEST(0, ROUND(COALESCE(t.total_cost, 0))::bigint),
        GREATEST(0, ROUND(COALESCE(t.discount, 0))::bigint),
        GREATEST(0, ROUND(COALESCE(t.paid_amount, 0))::bigint),
        t.performed_at, now(), v_actor
      FROM public.treatments t
      WHERE t.id = v_charge_id
        AND t.tenant_id = p_tenant_id
        AND t.branch_id = p_branch_id
        AND t.patient_id = p_patient_id
        AND t.status NOT IN ('planned', 'cancelled')
      RETURNING * INTO v_charge;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'MINA_FIN_CHARGE_NOT_FOUND: Posted charge % not found in patient scope', v_charge_id
        USING ERRCODE = '22023';
    END IF;

    v_open_balance := GREATEST(0, v_charge.net_amount - v_charge.allocated_paid_amount);
    IF v_alloc_amount > v_open_balance THEN
      RAISE EXCEPTION 'MINA_FIN_CHARGE_OVERPAID: Allocation % exceeds charge open balance %', v_alloc_amount, v_open_balance
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.payment_allocations (
      tenant_id, branch_id, patient_id, payment_id, charge_id, provider_staff_id,
      amount, allocation_kind, stable_key, created_by
    ) VALUES (
      p_tenant_id, p_branch_id, p_patient_id, v_payment_id, v_charge.id,
      COALESCE(v_charge.provider_staff_id, p_provider_staff_id),
      v_alloc_amount, 'payment', p_idempotency_key || ':' || v_charge.id::text, v_actor
    );

    UPDATE public.service_charges
    SET allocated_paid_amount = allocated_paid_amount + v_alloc_amount,
        version = version + 1,
        updated_at = now()
    WHERE id = v_charge.id;

    IF v_charge.treatment_id IS NOT NULL THEN
      UPDATE public.treatments
      SET paid_amount = LEAST(GREATEST(0, total_cost - COALESCE(discount, 0)), COALESCE(paid_amount, 0) + v_alloc_amount),
          updated_at = now()
      WHERE id = v_charge.treatment_id;
    END IF;
  END LOOP;

  v_unapplied := p_amount_toman - v_alloc_total;
  UPDATE public.payments SET unapplied_amount = v_unapplied WHERE id = v_payment_id;

  -- Double-entry balanced journal: Dr Cash/Bank (1010); Cr Patient A/R (1200) + Cr Unapplied Credit (2100)
  INSERT INTO public.journal_entries (
    tenant_id, branch_id, origin_module, origin_record_id, business_date, currency_unit, status, memo, created_by
  ) VALUES (
    p_tenant_id, p_branch_id, 'payment', v_payment_id, p_business_date, 'IRR_TOMAN', 'posted',
    COALESCE(p_description, 'دریافت وجه بیمار'), v_actor
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (journal_entry_id, tenant_id, branch_id, account_code, debit_toman, credit_toman, patient_id, provider_staff_id)
  VALUES (v_journal_id, p_tenant_id, p_branch_id, '1010', p_amount_toman, 0, p_patient_id, p_provider_staff_id);

  IF v_alloc_total > 0 THEN
    INSERT INTO public.journal_lines (journal_entry_id, tenant_id, branch_id, account_code, debit_toman, credit_toman, patient_id, provider_staff_id)
    VALUES (v_journal_id, p_tenant_id, p_branch_id, '1200', 0, v_alloc_total, p_patient_id, p_provider_staff_id);
  END IF;

  IF v_unapplied > 0 THEN
    INSERT INTO public.journal_lines (journal_entry_id, tenant_id, branch_id, account_code, debit_toman, credit_toman, patient_id, provider_staff_id)
    VALUES (v_journal_id, p_tenant_id, p_branch_id, '2100', 0, v_unapplied, p_patient_id, NULL);
  END IF;

  -- Linked treasury row (with deterministic payment_id & journal_entry_id linkage)
  INSERT INTO public.finance_transactions (
    tenant_id, branch_id, payment_id, patient_id, type, category, amount,
    transaction_date, description, payment_method, reference, posting_status, journal_entry_id, created_by
  ) VALUES (
    p_tenant_id, p_branch_id, v_payment_id, p_patient_id, 'income', 'patient_payment', p_amount_toman,
    p_business_date, COALESCE(p_description, 'دریافت وجه بیمار'), p_payment_method,
    'PAY:' || v_payment_id::text, 'posted', v_journal_id, v_actor
  )
  RETURNING id INTO v_tx_id;

  INSERT INTO public.financial_audit_events (
    tenant_id, branch_id, actor_user_id, actor_role, operation, entity_type, entity_id,
    new_reference, correlation_id, details
  ) VALUES (
    p_tenant_id, p_branch_id, v_actor, v_role, 'post_patient_payment', 'payments', v_payment_id,
    'PAY:' || v_payment_id::text, p_idempotency_key,
    jsonb_build_object('amount', p_amount_toman, 'allocated', v_alloc_total, 'unapplied', v_unapplied, 'journalId', v_journal_id)
  );

  v_result := jsonb_build_object(
    'ok', true,
    'affectedRows', 1,
    'idempotentReplay', false,
    'paymentId', v_payment_id,
    'transactionId', v_tx_id,
    'journalEntryId', v_journal_id,
    'amountToman', p_amount_toman,
    'allocatedAmountToman', v_alloc_total,
    'unappliedCreditToman', v_unapplied,
    'currency', 'IRR_TOMAN'
  );

  PERFORM private.record_finance_command_idempotency_v16(
    p_tenant_id, p_branch_id, v_actor, 'post_patient_payment_v16', p_idempotency_key, v_payload_hash, v_result
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.post_patient_payment_v16(text, text, uuid, bigint, text, date, text, jsonb, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_patient_payment_v16(text, text, uuid, bigint, text, date, text, jsonb, text, uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Authoritative Transactional RPC: reverse_or_refund_payment_v16
--    Manager-only refund/reversal without mutating original month gross receipt.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reverse_or_refund_payment_v16(
  p_tenant_id text,
  p_branch_id text,
  p_payment_id uuid,
  p_refund_amount_toman bigint,
  p_business_date date,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_role text;
  v_orig public.payments%ROWTYPE;
  v_already_refunded bigint;
  v_refundable bigint;
  v_journal_id uuid;
  v_refund_payment_id uuid;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'MINA_FIN_UNAUTHENTICATED' USING ERRCODE = '42501';
  END IF;

  v_role := public.app_resolve_verified_role(p_tenant_id, p_branch_id);
  IF v_role IS DISTINCT FROM 'manager' THEN
    RAISE EXCEPTION 'MINA_FIN_REFUND_MANAGER_ONLY: Only manager may issue refunds or reversals' USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'MINA_FIN_REASON_REQUIRED: Refund/reversal reason is mandatory' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_orig
  FROM public.payments
  WHERE id = p_payment_id AND tenant_id = p_tenant_id AND branch_id = p_branch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MINA_FIN_PAYMENT_NOT_FOUND: Original payment % not found', p_payment_id USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_already_refunded
  FROM public.payments
  WHERE reversed_payment_id = p_payment_id AND status IN ('refunded', 'reversed');

  v_refundable := GREATEST(0, v_orig.amount::bigint - v_already_refunded);
  IF p_refund_amount_toman <= 0 OR p_refund_amount_toman > v_refundable THEN
    RAISE EXCEPTION 'MINA_FIN_REFUND_EXCEEDS_AVAILABLE: Refund % exceeds available %', p_refund_amount_toman, v_refundable
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payments (
    tenant_id, branch_id, patient_id, amount, payment_method, payment_date,
    description, status, currency_unit, reversed_payment_id, reversal_reason, refunded_at, idempotency_key, created_by
  ) VALUES (
    p_tenant_id, p_branch_id, v_orig.patient_id, p_refund_amount_toman, v_orig.payment_method, p_business_date,
    'استرداد/برگشت وجه: ' || p_reason, 'refunded', 'IRR_TOMAN', p_payment_id, p_reason, now(), p_idempotency_key, v_actor
  )
  RETURNING id INTO v_refund_payment_id;

  INSERT INTO public.journal_entries (
    tenant_id, branch_id, origin_module, origin_record_id, business_date, currency_unit, status, memo, created_by
  ) VALUES (
    p_tenant_id, p_branch_id, 'refund', v_refund_payment_id, p_business_date, 'IRR_TOMAN', 'posted', p_reason, v_actor
  )
  RETURNING id INTO v_journal_id;

  INSERT INTO public.journal_lines (journal_entry_id, tenant_id, branch_id, account_code, debit_toman, credit_toman, patient_id)
  VALUES
    (v_journal_id, p_tenant_id, p_branch_id, '4100', p_refund_amount_toman, 0, v_orig.patient_id),
    (v_journal_id, p_tenant_id, p_branch_id, '1010', 0, p_refund_amount_toman, v_orig.patient_id);

  INSERT INTO public.financial_audit_events (
    tenant_id, branch_id, actor_user_id, actor_role, operation, entity_type, entity_id,
    prior_reference, new_reference, reason, correlation_id
  ) VALUES (
    p_tenant_id, p_branch_id, v_actor, v_role, 'refund_payment', 'payments', v_refund_payment_id,
    'PAY:' || p_payment_id::text, 'REF:' || v_refund_payment_id::text, p_reason, p_idempotency_key
  );

  v_result := jsonb_build_object(
    'ok', true,
    'affectedRows', 1,
    'refundPaymentId', v_refund_payment_id,
    'originalPaymentId', p_payment_id,
    'refundAmountToman', p_refund_amount_toman,
    'journalEntryId', v_journal_id
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_or_refund_payment_v16(text, text, uuid, bigint, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_or_refund_payment_v16(text, text, uuid, bigint, date, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 10. Authoritative Daily Close RPC: reconcile_day_close_v16
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_day_close_v16(
  p_tenant_id text,
  p_branch_id text,
  p_business_date date,
  p_opening_balance bigint,
  p_counted_cash bigint,
  p_action text, -- 'close' | 'reopen'
  p_exception_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_role text;
  v_exp_cash bigint := 0;
  v_exp_card bigint := 0;
  v_exp_transfer bigint := 0;
  v_exp_refunds bigint := 0;
  v_variance bigint := 0;
  v_session public.daily_close_sessions%ROWTYPE;
BEGIN
  v_role := public.app_resolve_verified_role(p_tenant_id, p_branch_id);
  IF v_role IS NULL OR v_role NOT IN ('manager', 'secretary') THEN
    RAISE EXCEPTION 'MINA_FIN_DAYCLOSE_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'reopen' AND v_role <> 'manager' THEN
    RAISE EXCEPTION 'MINA_FIN_REOPEN_MANAGER_ONLY' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'reopen' AND (p_exception_notes IS NULL OR btrim(p_exception_notes) = '') THEN
    RAISE EXCEPTION 'MINA_FIN_REOPEN_REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'cash' THEN amount ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'card' THEN amount ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN status = 'completed' AND payment_method = 'transfer' THEN amount ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN status IN ('refunded', 'reversed') THEN amount ELSE 0 END), 0)::bigint
  INTO v_exp_cash, v_exp_card, v_exp_transfer, v_exp_refunds
  FROM public.payments
  WHERE tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND payment_date = p_business_date;

  v_variance := COALESCE(p_counted_cash, 0) - (COALESCE(p_opening_balance, 0) + v_exp_cash - v_exp_refunds);

  INSERT INTO public.daily_close_sessions (
    tenant_id, branch_id, business_date, opening_balance,
    expected_cash, expected_card, expected_transfer, expected_refunds,
    counted_cash, variance_amount, exception_notes,
    status, closed_by, closed_at, reopened_by, reopened_at, reopen_reason
  ) VALUES (
    p_tenant_id, p_branch_id, p_business_date, COALESCE(p_opening_balance, 0),
    v_exp_cash, v_exp_card, v_exp_transfer, v_exp_refunds,
    COALESCE(p_counted_cash, 0), v_variance, p_exception_notes,
    CASE WHEN p_action = 'reopen' THEN 'reopened' ELSE 'closed' END,
    CASE WHEN p_action = 'close' THEN v_actor ELSE NULL END,
    CASE WHEN p_action = 'close' THEN now() ELSE NULL END,
    CASE WHEN p_action = 'reopen' THEN v_actor ELSE NULL END,
    CASE WHEN p_action = 'reopen' THEN now() ELSE NULL END,
    CASE WHEN p_action = 'reopen' THEN p_exception_notes ELSE NULL END
  )
  ON CONFLICT (tenant_id, branch_id, business_date) DO UPDATE
  SET opening_balance = EXCLUDED.opening_balance,
      expected_cash = EXCLUDED.expected_cash,
      expected_card = EXCLUDED.expected_card,
      expected_transfer = EXCLUDED.expected_transfer,
      expected_refunds = EXCLUDED.expected_refunds,
      counted_cash = EXCLUDED.counted_cash,
      variance_amount = EXCLUDED.variance_amount,
      exception_notes = EXCLUDED.exception_notes,
      status = EXCLUDED.status,
      closed_by = CASE WHEN p_action = 'close' THEN v_actor ELSE daily_close_sessions.closed_by END,
      closed_at = CASE WHEN p_action = 'close' THEN now() ELSE daily_close_sessions.closed_at END,
      reopened_by = CASE WHEN p_action = 'reopen' THEN v_actor ELSE daily_close_sessions.reopened_by END,
      reopened_at = CASE WHEN p_action = 'reopen' THEN now() ELSE daily_close_sessions.reopened_at END,
      reopen_reason = CASE WHEN p_action = 'reopen' THEN p_exception_notes ELSE daily_close_sessions.reopen_reason END,
      updated_at = now()
  RETURNING * INTO v_session;

  INSERT INTO public.financial_audit_events (
    tenant_id, branch_id, actor_user_id, actor_role, operation, entity_type, entity_id, reason, details
  ) VALUES (
    p_tenant_id, p_branch_id, v_actor, v_role, 'day_close_' || p_action, 'daily_close_sessions', v_session.id,
    p_exception_notes, jsonb_build_object('businessDate', p_business_date, 'variance', v_variance)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'affectedRows', 1,
    'sessionId', v_session.id,
    'status', v_session.status,
    'varianceAmountToman', v_variance,
    'expectedCashToman', v_exp_cash,
    'expectedCardToman', v_exp_card,
    'expectedTransferToman', v_exp_transfer,
    'expectedRefundsToman', v_exp_refunds
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_day_close_v16(text, text, date, bigint, bigint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_day_close_v16(text, text, date, bigint, bigint, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
