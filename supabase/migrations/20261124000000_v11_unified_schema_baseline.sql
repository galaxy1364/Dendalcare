-- ============================================================================
-- MINADENTAL V11 — UNIFIED DATABASE FOUNDATION (EMPTY-DATABASE BASELINE)
-- File: 20261124000000_v11_unified_schema_baseline.sql
--
-- Purpose:
--   Repeatable, idempotent PostgreSQL baseline that constructs the complete
--   MinaDental schema from an empty Supabase database BEFORE the subsequent
--   tenant/branch RLS hardening (20261125, 20261126), V4 accounting RPC
--   (20261127), and V11 grants/triggers/storage hardening (20261128).
--
-- Guarantees:
--   1. Resolves the legacy `patients` schema mismatch at the database level
--      (first_name, last_name, STORED generated full_name, file_number,
--      national_id, insurance_number, medical fields, tenant_id, branch_id).
--   2. Establishes relational foreign keys across tenants, branches,
--      clinic_memberships, patients, appointments, treatments, services,
--      payments, installments, checks, safteh, finance_transactions,
--      lab_orders, implants, tooth_conditions, inventory, reminders, staff,
--      staff_salaries, staff_shares, messages, advertisements, clinic_settings,
--      and clinical_audit_events.
--   3. Contains ZERO fabricated patient records, ZERO fake KPIs, ZERO hardcoded
--      credentials, and ZERO automatic privileged user accounts.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 0. Shared trigger helper: deterministic updated_at timestamp maintenance
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. Multi-Tenant & Branch Control Plane
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenants (
  id text PRIMARY KEY CHECK (btrim(id) <> ''),
  name text NOT NULL CHECK (btrim(name) <> ''),
  slug text UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  timezone text NOT NULL DEFAULT 'Asia/Tehran',
  currency_unit text NOT NULL DEFAULT 'IRR_TOMAN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.branches (
  id text NOT NULL CHECK (btrim(id) <> ''),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (btrim(name) <> ''),
  code text,
  phone text,
  address text,
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_branches_tenant_status
  ON public.branches (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.clinic_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('manager', 'dentist', 'secretary', 'assistant')),
  all_branches boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id, branch_id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_clinic_memberships_user_tenant
  ON public.clinic_memberships (user_id, tenant_id)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.clinical_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  actor_user_id uuid,
  actor_role text,
  action text NOT NULL CHECK (btrim(action) <> ''),
  entity_table text NOT NULL CHECK (btrim(entity_table) <> ''),
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_clinical_audit_events_scope_time
  ON public.clinical_audit_events (tenant_id, branch_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 2. Clinic Personnel Directory
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  auth_user_id uuid,
  first_name text NOT NULL CHECK (btrim(first_name) <> ''),
  last_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'dentist' CHECK (role IN ('manager', 'dentist', 'secretary', 'assistant', 'admin', 'hygienist', 'receptionist')),
  phone text,
  email text,
  color text NOT NULL DEFAULT '#4F46E5',
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_staff_tenant_branch ON public.staff (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_auth_user_id ON public.staff (auth_user_id) WHERE auth_user_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Patients (Resolves V11 patients schema mismatch at the database level)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  first_name text NOT NULL CHECK (btrim(first_name) <> ''),
  last_name text NOT NULL DEFAULT '',
  full_name text GENERATED ALWAYS AS (btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))) STORED,
  file_number text,
  national_id text,
  phone text,
  email text,
  address text,
  birth_date date,
  gender text NOT NULL DEFAULT 'unknown' CHECK (gender IN ('male', 'female', 'unknown', 'other')),
  blood_type text,
  allergies text,
  medical_history text,
  medications text,
  insurance_provider text,
  insurance_number text,
  notes text,
  photo_url text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_patients_tenant_branch ON public.patients (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_patients_phone ON public.patients (tenant_id, branch_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patients_national_id ON public.patients (tenant_id, branch_id, national_id) WHERE national_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_patients_file_number ON public.patients (tenant_id, branch_id, file_number) WHERE file_number IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. Appointments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  title text,
  appointment_date date NOT NULL,
  appointment_time text NOT NULL DEFAULT '09:00',
  duration_min integer NOT NULL DEFAULT 30 CHECK (duration_min > 0 AND duration_min <= 720),
  type text NOT NULL DEFAULT 'checkup',
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'waiting')),
  notes text,
  room text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_branch_date
  ON public.appointments (tenant_id, branch_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON public.appointments (patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_staff_id ON public.appointments (staff_id);

-- ----------------------------------------------------------------------------
-- 5. Treatments & Treatment Services (with V4 accounting recognition dates)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.treatments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  diagnosis text,
  treatment_plan text,
  tooth_numbers text,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  total_cost numeric(18, 2) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  paid_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  doctor_cost numeric(18, 2) NOT NULL DEFAULT 0 CHECK (doctor_cost >= 0),
  lab_cost numeric(18, 2) NOT NULL DEFAULT 0 CHECK (lab_cost >= 0),
  material_cost numeric(18, 2) NOT NULL DEFAULT 0 CHECK (material_cost >= 0),
  other_cost numeric(18, 2) NOT NULL DEFAULT 0 CHECK (other_cost >= 0),
  discount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  notes text,
  performed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_treatments_tenant_branch ON public.treatments (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_treatments_patient_id ON public.treatments (patient_id);
CREATE INDEX IF NOT EXISTS idx_treatments_performed_at
  ON public.treatments (tenant_id, branch_id, performed_at)
  WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS idx_treatments_completed_at
  ON public.treatments (tenant_id, branch_id, completed_at)
  WHERE status = 'completed';

CREATE TABLE IF NOT EXISTS public.treatment_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  treatment_id uuid NOT NULL REFERENCES public.treatments(id) ON DELETE CASCADE,
  service_date date NOT NULL DEFAULT CURRENT_DATE,
  tooth_number integer,
  surfaces text,
  procedure_name text NOT NULL CHECK (btrim(procedure_name) <> ''),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_fee numeric(18, 2) NOT NULL DEFAULT 0 CHECK (unit_fee >= 0),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'cancelled')),
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_treatment_services_tenant_branch ON public.treatment_services (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_treatment_services_treatment_id ON public.treatment_services (treatment_id);

-- ----------------------------------------------------------------------------
-- 6. Dental Chart (Palmer / FDI Tooth Conditions)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tooth_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE CASCADE,
  tooth_number integer NOT NULL,
  condition text NOT NULL CHECK (btrim(condition) <> ''),
  surface text,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_tooth_conditions_tenant_branch ON public.tooth_conditions (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_tooth_conditions_patient_tooth ON public.tooth_conditions (patient_id, tooth_number);

-- ----------------------------------------------------------------------------
-- 7. Laboratory Orders & Implants Pipeline
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lab_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  treatment_id uuid REFERENCES public.treatments(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  lab_name text,
  work_type text NOT NULL CHECK (btrim(work_type) <> ''),
  tooth_numbers text,
  shade text,
  material text,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'in_progress', 'try_in', 'received', 'delivered', 'cancelled')),
  sent_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  received_date date,
  cost numeric(18, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_lab_orders_tenant_branch ON public.lab_orders (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_lab_orders_patient_id ON public.lab_orders (patient_id);

CREATE TABLE IF NOT EXISTS public.implants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  treatment_id uuid REFERENCES public.treatments(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  tooth_number integer,
  brand text,
  implant_size text,
  lot_number text,
  serial_number text,
  stage text NOT NULL DEFAULT 'planning' CHECK (stage IN ('planning', 'surgery', 'placed', 'healing', 'osseointegration', 'impression', 'abutment', 'lab_order', 'crown', 'completed', 'failed')),
  placement_date date,
  osseointegration_date date,
  abutment_date date,
  crown_date date,
  cost numeric(18, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  paid_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_implants_tenant_branch ON public.implants (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_implants_patient_id ON public.implants (patient_id);

-- ----------------------------------------------------------------------------
-- 8. Billing & Financial Ledger (Payments, Installments, Checks, Safteh, Ledger)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  treatment_id uuid REFERENCES public.treatments(id) ON DELETE SET NULL,
  amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payment_method text NOT NULL DEFAULT 'card',
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  description text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'refunded', 'reversed', 'voided', 'cancelled')),
  refunded_at timestamptz,
  voided_at timestamptz,
  reversed_payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_payments_tenant_branch_date
  ON public.payments (tenant_id, branch_id, payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_patient_id ON public.payments (patient_id);
CREATE INDEX IF NOT EXISTS idx_payments_treatment_id ON public.payments (treatment_id);

CREATE TABLE IF NOT EXISTS public.installments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  treatment_id uuid REFERENCES public.treatments(id) ON DELETE SET NULL,
  total_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  paid_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  monthly_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (monthly_amount >= 0),
  total_months integer NOT NULL DEFAULT 1 CHECK (total_months > 0),
  paid_months integer NOT NULL DEFAULT 0 CHECK (paid_months >= 0),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  next_due_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'overdue', 'cancelled')),
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_installments_tenant_branch ON public.installments (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_installments_patient_id ON public.installments (patient_id);

CREATE TABLE IF NOT EXISTS public.checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  installment_id uuid REFERENCES public.installments(id) ON DELETE SET NULL,
  treatment_id uuid REFERENCES public.treatments(id) ON DELETE SET NULL,
  check_number text,
  bank_name text,
  branch text,
  sayad_id text,
  amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  issue_date date,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cleared', 'cashed', 'bounced', 'returned', 'cancelled', 'endorsed')),
  type text NOT NULL DEFAULT 'received',
  drawer_name text,
  is_guarantee boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_checks_tenant_branch ON public.checks (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_checks_is_guarantee ON public.checks (is_guarantee);
CREATE INDEX IF NOT EXISTS idx_checks_due_date ON public.checks (tenant_id, branch_id, due_date);

CREATE TABLE IF NOT EXISTS public.safteh (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  installment_id uuid REFERENCES public.installments(id) ON DELETE SET NULL,
  safteh_number text,
  amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  issue_date date,
  due_date date NOT NULL,
  type text NOT NULL DEFAULT 'guarantee',
  drawer_name text,
  guarantor_name text,
  guarantor_national_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cleared', 'returned', 'protested', 'cancelled')),
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_safteh_tenant_branch ON public.safteh (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_safteh_due_date ON public.safteh (tenant_id, branch_id, due_date);

CREATE TABLE IF NOT EXISTS public.finance_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  treatment_id uuid REFERENCES public.treatments(id) ON DELETE SET NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
  category text NOT NULL DEFAULT 'general',
  amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  description text,
  payment_method text NOT NULL DEFAULT 'card',
  reference text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_finance_transactions_tenant_branch_date
  ON public.finance_transactions (tenant_id, branch_id, transaction_date);
CREATE INDEX IF NOT EXISTS idx_finance_tx_payment_id ON public.finance_transactions (payment_id);
CREATE INDEX IF NOT EXISTS idx_finance_tx_treatment_id ON public.finance_transactions (treatment_id);

-- ----------------------------------------------------------------------------
-- 9. Payroll & Doctor Share Rules
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_salaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  auth_user_id uuid,
  base_salary numeric(18, 2) NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
  bonus numeric(18, 2) NOT NULL DEFAULT 0 CHECK (bonus >= 0),
  deductions numeric(18, 2) NOT NULL DEFAULT 0 CHECK (deductions >= 0),
  total_paid numeric(18, 2) NOT NULL DEFAULT 0 CHECK (total_paid >= 0),
  share_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (share_amount >= 0),
  pay_month integer NOT NULL CHECK (pay_month BETWEEN 1 AND 12),
  pay_year integer NOT NULL CHECK (pay_year BETWEEN 1300 AND 2200),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'cancelled')),
  pay_date date,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_staff_salaries_tenant_branch ON public.staff_salaries (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_salaries_staff_id ON public.staff_salaries (staff_id);

CREATE TABLE IF NOT EXISTS public.staff_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  auth_user_id uuid,
  share_type text NOT NULL CHECK (share_type IN ('percentage', 'fixed', 'net_half_after_lab')),
  share_value numeric(18, 2) NOT NULL DEFAULT 0 CHECK (share_value >= 0),
  applies_to text NOT NULL DEFAULT 'all',
  min_amount numeric(18, 2) NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_staff_shares_tenant_branch ON public.staff_shares (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_staff_shares_staff_id ON public.staff_shares (staff_id);

-- ----------------------------------------------------------------------------
-- 10. Inventory, Reminders, Internal Messages, Advertisements & Clinic Settings
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  category text NOT NULL DEFAULT 'consumables',
  sku text,
  quantity numeric(14, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit text NOT NULL DEFAULT 'عدد',
  min_quantity numeric(14, 2) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  reorder_quantity numeric(14, 2) NOT NULL DEFAULT 0 CHECK (reorder_quantity >= 0),
  unit_cost numeric(18, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  supplier text,
  location text,
  expiry_date date,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_inventory_tenant_branch ON public.inventory (tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS public.reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text,
  reminder_date date NOT NULL DEFAULT CURRENT_DATE,
  reminder_time text NOT NULL DEFAULT '09:00',
  category text NOT NULL DEFAULT 'general',
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'completed', 'dismissed', 'snoozed')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_reminders_tenant_branch_date
  ON public.reminders (tenant_id, branch_id, reminder_date);

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  from_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  to_staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  subject text NOT NULL CHECK (btrim(subject) <> ''),
  body text,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  is_read boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_messages_tenant_branch ON public.messages (tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS public.advertisements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  title text NOT NULL CHECK (btrim(title) <> ''),
  content text,
  image_url text,
  link_url text,
  target_audience text NOT NULL DEFAULT 'all',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'completed', 'archived')),
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_advertisements_tenant_branch ON public.advertisements (tenant_id, branch_id);

CREATE TABLE IF NOT EXISTS public.clinic_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  branch_id text NOT NULL,
  key text NOT NULL CHECK (btrim(key) <> ''),
  value text,
  category text NOT NULL DEFAULT 'general',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_id, key),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_clinic_settings_tenant_branch ON public.clinic_settings (tenant_id, branch_id);

-- ----------------------------------------------------------------------------
-- 11. Attach updated_at triggers across all mutable tables
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  tbl text;
  mutable_tables text[] := ARRAY[
    'tenants', 'branches', 'clinic_memberships',
    'patients', 'appointments', 'treatments', 'treatment_services',
    'lab_orders', 'implants', 'tooth_conditions', 'payments',
    'finance_transactions', 'installments', 'checks', 'safteh',
    'inventory', 'reminders', 'staff', 'staff_salaries', 'staff_shares',
    'messages', 'advertisements', 'clinic_settings'
  ];
BEGIN
  FOREACH tbl IN ARRAY mutable_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I;', 'trg_' || tbl || '_updated_at', tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
      'trg_' || tbl || '_updated_at',
      tbl
    );
  END LOOP;
END $$;

COMMIT;
