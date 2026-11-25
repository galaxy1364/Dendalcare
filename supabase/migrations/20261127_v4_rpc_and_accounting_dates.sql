-- ============================================================================
-- MINADENTAL — V4 ENGINEERING RELEASE GATE MIGRATION (ADDITIVE & IDEMPOTENT)
-- File: 20261127_v4_rpc_and_accounting_dates.sql
--
-- Scope (P0 Data Integrity, Accounting Recognition Dates & Strict Branch Membership):
-- 1. Non-destructively adds independent clinical/accounting lifecycle timestamps:
--    - `treatments.performed_at`, `treatments.completed_at`, `treatments.cancelled_at`
--    - `payments.refunded_at`, `payments.voided_at`, `payments.reversed_payment_id`
--    (Zero destructive drops; never fabricates dates on legacy rows.)
-- 2. Tightens multi-branch manager authorization in `clinic_memberships`:
--    - Adds `all_branches boolean NOT NULL DEFAULT false`
--    - Updates `app_resolve_verified_role` so even `manager` accounts require an
--      explicit matching `branch_id` membership (or explicit `all_branches = true`).
-- 3. Creates `public.get_clinic_dashboard_summary(...)` (`SECURITY INVOKER`, RLS-enforced):
--    - Computes full-dataset server-side aggregates (no 500-row client truncation)
--    - Uses integer Toman base units (`bigint`) — zero floating-point drift
--    - Recognizes accrual production ONLY on `status = 'completed'` with real
--      `COALESCE(performed_at, completed_at)` inside `[p_month_start, p_month_end]`
--    - Separately reports `unverified_completion_date_count` for completed treatments
--      lacking both `performed_at` and `completed_at` (never falls back to `created_at`)
--    - Handles refunded/voided payments, linked direct-cost expense dedup,
--      deterministic `payment_id` income dedup, and guarantee check isolation.
--
-- Rollback Plan (non-destructive):
--   DROP FUNCTION IF EXISTS public.get_clinic_dashboard_summary(text, text, date, date, date);
--   (Added nullable timestamp columns & `all_branches` default false are backward-compatible
--    and do not require destructive column drops on rollback.)
-- ============================================================================

BEGIN;

-- 1. Additive accounting & clinical recognition timestamps (idempotent)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'treatments'
  ) THEN
    ALTER TABLE public.treatments ADD COLUMN IF NOT EXISTS performed_at timestamptz;
    ALTER TABLE public.treatments ADD COLUMN IF NOT EXISTS completed_at timestamptz;
    ALTER TABLE public.treatments ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
    CREATE INDEX IF NOT EXISTS idx_treatments_performed_at
      ON public.treatments (tenant_id, branch_id, performed_at)
      WHERE status = 'completed';
    CREATE INDEX IF NOT EXISTS idx_treatments_completed_at
      ON public.treatments (tenant_id, branch_id, completed_at)
      WHERE status = 'completed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'payments'
  ) THEN
    ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
    ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS voided_at timestamptz;
    ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS reversed_payment_id uuid;
    CREATE INDEX IF NOT EXISTS idx_payments_tenant_branch_date
      ON public.payments (tenant_id, branch_id, payment_date);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'clinic_memberships'
  ) THEN
    ALTER TABLE public.clinic_memberships
      ADD COLUMN IF NOT EXISTS all_branches boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- 2. Strict branch-scoped membership check (managers must hold explicit branch membership or all_branches = true)
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
  v_jwt_all_branches boolean;
BEGIN
  IF v_uid IS NULL
     OR target_tenant IS NULL OR btrim(target_tenant) = ''
     OR target_branch IS NULL OR btrim(target_branch) = '' THEN
    RETURN NULL;
  END IF;

  -- Primary authoritative source: server-managed `clinic_memberships`
  SELECT cm.role
    INTO v_member_role
  FROM public.clinic_memberships cm
  WHERE cm.user_id = v_uid
    AND cm.active = true
    AND cm.tenant_id = target_tenant
    AND (
      cm.branch_id = target_branch
      OR (cm.role = 'manager' AND cm.all_branches = true)
    )
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

  -- If user exists in `clinic_memberships` (e.g., revoked or assigned to another branch), fail closed
  IF EXISTS (SELECT 1 FROM public.clinic_memberships cm WHERE cm.user_id = v_uid) THEN
    RETURN NULL;
  END IF;

  -- Fallback strictly to server-signed JWT `app_metadata` with explicit branch match
  v_jwt_tenant := public.app_jwt_tenant_id();
  v_jwt_branch := public.app_jwt_branch_id();
  v_jwt_role   := public.app_jwt_role();
  v_jwt_all_branches := COALESCE((auth.jwt() -> 'app_metadata' ->> 'all_branches')::boolean, false);

  IF v_jwt_tenant IS NULL OR v_jwt_role IS NULL OR v_jwt_tenant <> target_tenant THEN
    RETURN NULL;
  END IF;

  IF v_jwt_role = 'manager' AND v_jwt_all_branches = true THEN
    RETURN 'manager';
  END IF;

  IF v_jwt_branch IS NULL OR v_jwt_branch <> target_branch THEN
    RETURN NULL;
  END IF;

  RETURN v_jwt_role;
END;
$$;

-- 3. Authoritative Server-Side Dashboard Aggregation RPC (SECURITY INVOKER -> enforces table RLS)
CREATE OR REPLACE FUNCTION public.get_clinic_dashboard_summary(
  p_tenant_id text,
  p_branch_id text,
  p_today_iso date,
  p_month_start date,
  p_month_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_can_read_billing boolean := false;
  v_can_read_ledger boolean := false;

  v_patients_total bigint := 0;
  v_today_appts bigint := 0;
  v_confirmed_appts bigint := 0;
  v_active_today_slots bigint := 0;
  v_planned_treat_count bigint := 0;
  v_completed_treat_count bigint := 0;
  v_active_treat_count bigint := 0;
  v_accepted_treat_count bigint := 0;
  v_unverified_completion_count bigint := 0;
  v_pending_lab_count bigint := 0;
  v_active_implant_count bigint := 0;
  v_low_stock_count bigint := 0;
  v_pending_rem_count bigint := 0;
  v_overdue_rem_count bigint := 0;

  v_today_collected bigint := NULL;
  v_month_collected bigint := NULL;
  v_month_refunded bigint := NULL;
  v_month_extra_income bigint := NULL;
  v_month_cash_expense bigint := NULL;
  v_month_operating_expense bigint := NULL;
  v_month_production bigint := NULL;
  v_month_planned_production bigint := NULL;
  v_month_direct_costs bigint := NULL;
  v_month_net_profit bigint := NULL;
  v_month_cash_flow bigint := NULL;
  v_collection_checks_pending bigint := NULL;
  v_guarantee_checks_pending bigint := NULL;
  v_total_receivables bigint := NULL;
  v_overdue_checks bigint := 0;
  v_overdue_guarantee_checks bigint := 0;
  v_overdue_installments bigint := 0;
  v_overdue_safteh bigint := 0;
BEGIN
  IF p_tenant_id IS NULL OR btrim(p_tenant_id) = ''
     OR p_branch_id IS NULL OR btrim(p_branch_id) = ''
     OR p_today_iso IS NULL OR p_month_start IS NULL OR p_month_end IS NULL THEN
    RAISE EXCEPTION 'Invalid tenant, branch, or date range' USING ERRCODE = '22023';
  END IF;

  v_role := public.app_resolve_verified_role(p_tenant_id, p_branch_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Unauthorized tenant/branch scope' USING ERRCODE = '42501';
  END IF;

  v_can_read_billing := public.app_authorize_clinic_op(p_tenant_id, p_branch_id, 'billing', 'SELECT');
  v_can_read_ledger  := public.app_authorize_clinic_op(p_tenant_id, p_branch_id, 'ledger', 'SELECT');

  -- Clinical counts (full dataset, never truncated at 500)
  SELECT count(*) INTO v_patients_total
  FROM public.patients
  WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id;

  SELECT
    count(*),
    count(*) FILTER (WHERE status IN ('confirmed', 'scheduled')),
    count(*) FILTER (WHERE status NOT IN ('cancelled', 'no_show'))
  INTO v_today_appts, v_confirmed_appts, v_active_today_slots
  FROM public.appointments
  WHERE tenant_id = p_tenant_id
    AND branch_id = p_branch_id
    AND appointment_date::date = p_today_iso;

  SELECT
    count(*) FILTER (WHERE status = 'planned'),
    count(*) FILTER (WHERE status = 'completed'),
    count(*) FILTER (WHERE status IN ('in_progress', 'planned')),
    count(*) FILTER (WHERE status IN ('in_progress', 'completed')),
    count(*) FILTER (WHERE status = 'completed' AND COALESCE(performed_at, completed_at) IS NULL)
  INTO
    v_planned_treat_count,
    v_completed_treat_count,
    v_active_treat_count,
    v_accepted_treat_count,
    v_unverified_completion_count
  FROM public.treatments
  WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id;

  SELECT count(*) INTO v_pending_lab_count
  FROM public.lab_orders
  WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id
    AND status IN ('sent', 'in_progress');

  SELECT count(*) INTO v_active_implant_count
  FROM public.implants
  WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id
    AND stage NOT IN ('completed', 'failed');

  SELECT count(*) INTO v_low_stock_count
  FROM public.inventory
  WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id
    AND COALESCE(min_quantity, 0) > 0
    AND COALESCE(quantity, 0) <= COALESCE(min_quantity, 0);

  SELECT
    count(*) FILTER (WHERE status = 'pending'),
    count(*) FILTER (WHERE status = 'pending' AND reminder_date::date < p_today_iso)
  INTO v_pending_rem_count, v_overdue_rem_count
  FROM public.reminders
  WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id;

  -- Financial aggregates ONLY when caller is authorized for BOTH billing and ledger
  IF v_can_read_billing AND v_can_read_ledger THEN
    -- Realized completed production strictly by performed_at / completed_at (Tehran date)
    SELECT
      COALESCE(SUM(GREATEST(0, ROUND(COALESCE(total_cost, 0) - COALESCE(discount, 0))::bigint)), 0),
      COALESCE(SUM(
        ROUND(
          COALESCE(doctor_cost, 0) + COALESCE(lab_cost, 0) +
          COALESCE(material_cost, 0) + COALESCE(other_cost, 0)
        )::bigint
      ), 0)
    INTO v_month_production, v_month_direct_costs
    FROM public.treatments
    WHERE tenant_id = p_tenant_id
      AND branch_id = p_branch_id
      AND status = 'completed'
      AND COALESCE(performed_at, completed_at) IS NOT NULL
      AND (COALESCE(performed_at, completed_at) AT TIME ZONE 'Asia/Tehran')::date BETWEEN p_month_start AND p_month_end;

    -- Separate planned pipeline value
    SELECT COALESCE(SUM(GREATEST(0, ROUND(COALESCE(total_cost, 0) - COALESCE(discount, 0))::bigint)), 0)
    INTO v_month_planned_production
    FROM public.treatments
    WHERE tenant_id = p_tenant_id
      AND branch_id = p_branch_id
      AND status IN ('planned', 'in_progress')
      AND (created_at AT TIME ZONE 'Asia/Tehran')::date BETWEEN p_month_start AND p_month_end;

    -- Net payments (completed minus refunded/reversed; voided/cancelled excluded)
    SELECT
      COALESCE(SUM(
        CASE
          WHEN status = 'completed' AND voided_at IS NULL THEN ROUND(COALESCE(amount, 0))::bigint
          WHEN status IN ('refunded', 'reversed') THEN -ABS(ROUND(COALESCE(amount, 0))::bigint)
          ELSE 0
        END
      ) FILTER (WHERE COALESCE(refunded_at::date, payment_date::date) = p_today_iso), 0),
      COALESCE(SUM(
        CASE
          WHEN status = 'completed' AND voided_at IS NULL THEN ROUND(COALESCE(amount, 0))::bigint
          WHEN status IN ('refunded', 'reversed') THEN -ABS(ROUND(COALESCE(amount, 0))::bigint)
          ELSE 0
        END
      ) FILTER (WHERE COALESCE(refunded_at::date, payment_date::date) BETWEEN p_month_start AND p_month_end), 0),
      COALESCE(SUM(ABS(ROUND(COALESCE(amount, 0))::bigint)) FILTER (
        WHERE status IN ('refunded', 'reversed')
          AND COALESCE(refunded_at::date, payment_date::date) BETWEEN p_month_start AND p_month_end
      ), 0)
    INTO v_today_collected, v_month_collected, v_month_refunded
    FROM public.payments
    WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id;

    -- Extra non-payment income (strict payment_id / exact ID dedup)
    SELECT COALESCE(SUM(ROUND(COALESCE(f.amount, 0))::bigint), 0)
    INTO v_month_extra_income
    FROM public.finance_transactions f
    WHERE f.tenant_id = p_tenant_id
      AND f.branch_id = p_branch_id
      AND f.type = 'income'
      AND f.transaction_date::date BETWEEN p_month_start AND p_month_end
      AND NOT EXISTS (
        SELECT 1 FROM public.payments p
        WHERE p.tenant_id = p_tenant_id
          AND p.branch_id = p_branch_id
          AND p.status = 'completed'
          AND (
            f.payment_id = p.id
            OR upper(btrim(COALESCE(f.reference, ''))) IN (
              upper(p.id::text),
              'PAY:' || upper(p.id::text),
              'PAYMENT_' || upper(p.id::text)
            )
          )
      );

    -- Cash outflow vs deduplicated operating expense (excludes expenses linked to completed treatment direct costs)
    SELECT
      COALESCE(SUM(ROUND(COALESCE(f.amount, 0))::bigint), 0),
      COALESCE(SUM(ROUND(COALESCE(f.amount, 0))::bigint) FILTER (
        WHERE NOT EXISTS (
          SELECT 1 FROM public.treatments t
          WHERE t.tenant_id = p_tenant_id
            AND t.branch_id = p_branch_id
            AND t.status = 'completed'
            AND (COALESCE(t.doctor_cost, 0) + COALESCE(t.lab_cost, 0) + COALESCE(t.material_cost, 0) + COALESCE(t.other_cost, 0)) > 0
            AND (
              f.treatment_id = t.id
              OR upper(btrim(COALESCE(f.reference, ''))) IN (
                'TREAT:' || upper(t.id::text),
                'DIRECT_COST:' || upper(t.id::text)
              )
            )
        )
      ), 0)
    INTO v_month_cash_expense, v_month_operating_expense
    FROM public.finance_transactions f
    WHERE f.tenant_id = p_tenant_id
      AND f.branch_id = p_branch_id
      AND f.type = 'expense'
      AND f.transaction_date::date BETWEEN p_month_start AND p_month_end;

    v_month_cash_flow  := v_month_collected + v_month_extra_income - v_month_cash_expense;
    v_month_net_profit := v_month_production + v_month_extra_income - v_month_direct_costs - v_month_operating_expense;

    -- Checks & overdue instruments (strict guarantee isolation)
    SELECT
      COALESCE(SUM(ROUND(COALESCE(amount, 0))::bigint) FILTER (WHERE status = 'pending' AND NOT (COALESCE(is_guarantee, false) OR lower(COALESCE(type, '')) = 'guarantee' OR COALESCE(notes, '') ~ 'ضمانت')), 0),
      COALESCE(SUM(ROUND(COALESCE(amount, 0))::bigint) FILTER (WHERE status = 'pending' AND (COALESCE(is_guarantee, false) OR lower(COALESCE(type, '')) = 'guarantee' OR COALESCE(notes, '') ~ 'ضمانت')), 0),
      count(*) FILTER (WHERE status = 'pending' AND due_date::date < p_today_iso AND NOT (COALESCE(is_guarantee, false) OR lower(COALESCE(type, '')) = 'guarantee' OR COALESCE(notes, '') ~ 'ضمانت')),
      count(*) FILTER (WHERE status = 'pending' AND due_date::date < p_today_iso AND (COALESCE(is_guarantee, false) OR lower(COALESCE(type, '')) = 'guarantee' OR COALESCE(notes, '') ~ 'ضمانت'))
    INTO v_collection_checks_pending, v_guarantee_checks_pending, v_overdue_checks, v_overdue_guarantee_checks
    FROM public.checks
    WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id;

    SELECT count(*) INTO v_overdue_installments
    FROM public.installments
    WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id
      AND status IN ('active', 'overdue')
      AND next_due_date IS NOT NULL
      AND next_due_date::date < p_today_iso;

    SELECT count(*) INTO v_overdue_safteh
    FROM public.safteh
    WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id
      AND status = 'pending'
      AND due_date::date < p_today_iso;

    -- Reconciled A/R (treatments + standalone installments + standalone collectible checks)
    SELECT
      COALESCE((
        SELECT SUM(GREATEST(0, GREATEST(0, ROUND(COALESCE(total_cost, 0) - COALESCE(discount, 0))::bigint) - ROUND(COALESCE(paid_amount, 0))::bigint))
        FROM public.treatments
        WHERE tenant_id = p_tenant_id AND branch_id = p_branch_id
          AND status IN ('completed', 'in_progress')
      ), 0)
      + COALESCE((
        SELECT SUM(GREATEST(0, ROUND(COALESCE(i.total_amount, 0))::bigint - ROUND(COALESCE(i.paid_amount, 0))::bigint))
        FROM public.installments i
        WHERE i.tenant_id = p_tenant_id AND i.branch_id = p_branch_id
          AND i.status IN ('active', 'overdue')
          AND (i.treatment_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.treatments t
            WHERE t.id = i.treatment_id AND t.tenant_id = p_tenant_id AND t.branch_id = p_branch_id
              AND t.status NOT IN ('cancelled', 'planned')
          ))
      ), 0)
      + COALESCE((
        SELECT SUM(ROUND(COALESCE(c.amount, 0))::bigint)
        FROM public.checks c
        WHERE c.tenant_id = p_tenant_id AND c.branch_id = p_branch_id
          AND c.status = 'pending'
          AND NOT (COALESCE(c.is_guarantee, false) OR lower(COALESCE(c.type, '')) = 'guarantee' OR COALESCE(c.notes, '') ~ 'ضمانت')
          AND (c.treatment_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.treatments t
            WHERE t.id = c.treatment_id AND t.tenant_id = p_tenant_id AND t.branch_id = p_branch_id
              AND t.status NOT IN ('cancelled', 'planned')
          ))
          AND (c.installment_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.installments i
            WHERE i.id = c.installment_id AND i.tenant_id = p_tenant_id AND i.branch_id = p_branch_id
              AND i.status IN ('active', 'overdue')
          ))
      ), 0)
    INTO v_total_receivables;
  END IF;

  RETURN jsonb_build_object(
    'schema_version', 'v4',
    'currency_unit', 'IRR_TOMAN',
    'snapshot_at', now(),
    'tenant_id', p_tenant_id,
    'branch_id', p_branch_id,
    'financial_data_complete', (v_can_read_billing AND v_can_read_ledger),
    'patients_total', v_patients_total,
    'today_appts_count', v_today_appts,
    'confirmed_appts_count', v_confirmed_appts,
    'active_today_slots', v_active_today_slots,
    'planned_treat_count', v_planned_treat_count,
    'completed_treat_count', v_completed_treat_count,
    'active_treat_count', v_active_treat_count,
    'accepted_treat_count', v_accepted_treat_count,
    'unverified_completion_date_count', v_unverified_completion_count,
    'pending_lab_count', v_pending_lab_count,
    'active_implant_count', v_active_implant_count,
    'low_stock_count', v_low_stock_count,
    'pending_reminders_count', v_pending_rem_count,
    'overdue_reminders_count', v_overdue_rem_count,
    'today_collected', v_today_collected,
    'month_collected', v_month_collected,
    'month_refunded', v_month_refunded,
    'month_extra_income', v_month_extra_income,
    'month_cash_expense', v_month_cash_expense,
    'month_operating_expense', v_month_operating_expense,
    'month_treatment_production', v_month_production,
    'month_planned_production', v_month_planned_production,
    'month_direct_costs', v_month_direct_costs,
    'month_net_profit', v_month_net_profit,
    'month_cash_flow', v_month_cash_flow,
    'collection_checks_pending_amount', v_collection_checks_pending,
    'guarantee_checks_pending_amount', v_guarantee_checks_pending,
    'total_receivables', v_total_receivables,
    'overdue_checks_count', v_overdue_checks,
    'overdue_guarantee_checks_count', v_overdue_guarantee_checks,
    'overdue_installments_count', v_overdue_installments,
    'overdue_safteh_count', v_overdue_safteh
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_clinic_dashboard_summary(text, text, date, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_clinic_dashboard_summary(text, text, date, date, date) TO authenticated;

COMMIT;
