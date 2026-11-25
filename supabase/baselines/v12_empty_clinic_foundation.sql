-- V12 fresh database baseline. Only for an empty Dendalcare development database.
-- Source contract: e7b6b0ecc60796f687fc9d077d2343d786870ead src/lib/supabaseCore.ts. No patient data or accounts.
BEGIN;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') THEN RAISE EXCEPTION 'V12 fresh baseline requires empty public schema'; END IF; END $$;
CREATE TABLE public.clinic_tenants (
 id text PRIMARY KEY CHECK (btrim(id)<>''), name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.clinic_branches (
 tenant_id text NOT NULL REFERENCES public.clinic_tenants(id), id text NOT NULL CHECK (btrim(id)<>''), name text NOT NULL,
 PRIMARY KEY (tenant_id,id)
);
CREATE TABLE public.clinic_memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id),
 tenant_id text NOT NULL, branch_id text NOT NULL, role text NOT NULL CHECK(role IN ('manager','dentist','secretary','assistant')),
 active boolean NOT NULL DEFAULT true, all_branches boolean NOT NULL DEFAULT false CHECK(NOT all_branches OR role='manager'),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,tenant_id,branch_id), FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);
CREATE INDEX clinic_memberships_scope_idx ON public.clinic_memberships(user_id,tenant_id,branch_id) WHERE active;
ALTER TABLE public.clinic_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_memberships FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinic_memberships FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.clinic_memberships TO authenticated;
CREATE POLICY membership_self ON public.clinic_memberships FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));
ALTER TABLE public.clinic_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_branches FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinic_tenants,public.clinic_branches FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.clinic_tenants,public.clinic_branches TO authenticated;
CREATE POLICY tenant_members ON public.clinic_tenants FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.clinic_memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.active AND m.tenant_id=clinic_tenants.id));
CREATE POLICY branch_members ON public.clinic_branches FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.clinic_memberships m WHERE m.user_id=(SELECT auth.uid()) AND m.active AND m.tenant_id=clinic_branches.tenant_id AND (m.branch_id=clinic_branches.id OR (m.role='manager' AND m.all_branches))));
CREATE FUNCTION public.app_resolve_verified_role(target_tenant text,target_branch text) RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT m.role FROM public.clinic_memberships m
 WHERE m.user_id=(SELECT auth.uid()) AND m.active AND m.tenant_id=target_tenant
 AND (m.branch_id=target_branch OR (m.role='manager' AND m.all_branches))
 ORDER BY CASE m.role WHEN 'manager' THEN 1 WHEN 'dentist' THEN 2 WHEN 'secretary' THEN 3 ELSE 4 END LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.app_resolve_verified_role(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_resolve_verified_role(text,text) TO authenticated;
CREATE FUNCTION public.app_authorize_clinic_op(target_tenant text,target_branch text,table_category text,op text,record_owner_user_id uuid DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE r text:=public.app_resolve_verified_role(target_tenant,target_branch);
BEGIN
 IF r IS NULL OR op NOT IN ('SELECT','INSERT','UPDATE','DELETE') THEN RETURN false; END IF;
 RETURN CASE table_category
 WHEN 'ledger' THEN r='manager'
 WHEN 'payroll' THEN r='manager' OR (r='dentist' AND op='SELECT' AND record_owner_user_id=(SELECT auth.uid()))
 WHEN 'billing' THEN r='manager' OR (r='secretary' AND op IN ('SELECT','INSERT'))
 WHEN 'admin' THEN op='SELECT' OR r='manager'
 WHEN 'clinical' THEN op='SELECT' OR (r IN ('manager','dentist') AND op IN ('INSERT','UPDATE')) OR (r='manager' AND op='DELETE')
 WHEN 'operations' THEN op='SELECT' OR (op IN ('INSERT','UPDATE') AND r IN ('manager','dentist','secretary','assistant')) OR (r='manager' AND op='DELETE')
 WHEN 'patients' THEN op='SELECT' OR (op IN ('INSERT','UPDATE') AND r IN ('manager','dentist','secretary')) OR (r='manager' AND op='DELETE')
 ELSE false END;
END $$;
REVOKE ALL ON FUNCTION public.app_authorize_clinic_op(text,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.app_authorize_clinic_op(text,text,text,text,uuid) TO authenticated;


CREATE TABLE public.patients (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 first_name text NOT NULL,
 last_name text NOT NULL,
 national_id text,
 phone text,
 email text,
 address text,
 birth_date date,
 gender text NOT NULL,
 blood_type text,
 allergies text,
 medical_history text,
 medications text,
 insurance_provider text,
 insurance_number text,
 notes text,
 photo_url text,
 status text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.appointments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 patient_id uuid,
 staff_id uuid,
 title text,
 appointment_date date NOT NULL,
 appointment_time time NOT NULL,
 duration_min integer NOT NULL CHECK (duration_min > 0 AND duration_min <= 1440),
 type text NOT NULL,
 status text NOT NULL,
 notes text,
 room text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.treatments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 patient_id uuid,
 appointment_id uuid,
 diagnosis text,
 treatment_plan text,
 tooth_numbers text,
 status text NOT NULL,
 total_cost bigint NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
 paid_amount bigint NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
 doctor_cost bigint NOT NULL DEFAULT 0 CHECK (doctor_cost >= 0),
 lab_cost bigint NOT NULL DEFAULT 0 CHECK (lab_cost >= 0),
 material_cost bigint NOT NULL DEFAULT 0 CHECK (material_cost >= 0),
 other_cost bigint NOT NULL DEFAULT 0 CHECK (other_cost >= 0),
 discount bigint NOT NULL DEFAULT 0 CHECK (discount >= 0),
 notes text,
 performed_at timestamptz,
 completed_at timestamptz,
 cancelled_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.treatment_services (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 treatment_id uuid NOT NULL,
 service_date date NOT NULL,
 tooth_number integer,
 surfaces text,
 procedure_name text NOT NULL,
 quantity numeric(18,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
 unit_fee bigint NOT NULL DEFAULT 0 CHECK (unit_fee >= 0),
 status text NOT NULL,
 notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 patient_id uuid,
 treatment_id uuid,
 amount bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
 payment_method text NOT NULL,
 payment_date date NOT NULL,
 description text,
 status text NOT NULL,
 refunded_at timestamptz,
 voided_at timestamptz,
 reversed_payment_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.lab_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 patient_id uuid,
 lab_name text,
 work_type text NOT NULL,
 tooth_numbers text,
 shade text,
 material text,
 status text NOT NULL,
 sent_date date NOT NULL,
 due_date date,
 received_date date,
 cost bigint NOT NULL DEFAULT 0 CHECK (cost >= 0),
 notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.implants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 patient_id uuid,
 tooth_number integer,
 brand text,
 implant_size text,
 stage text NOT NULL,
 placement_date date,
 osseointegration_date date,
 abutment_date date,
 crown_date date,
 cost bigint NOT NULL DEFAULT 0 CHECK (cost >= 0),
 paid_amount bigint NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
 notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.inventory (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 name text NOT NULL,
 category text NOT NULL,
 sku text,
 quantity numeric(18,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
 unit text NOT NULL,
 min_quantity numeric(18,4) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
 reorder_quantity numeric(18,4) NOT NULL DEFAULT 0 CHECK (reorder_quantity >= 0),
 unit_cost bigint NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
 supplier text,
 location text,
 expiry_date date,
 notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.reminders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 patient_id uuid,
 title text NOT NULL,
 description text,
 reminder_date date NOT NULL,
 reminder_time time NOT NULL,
 category text NOT NULL,
 priority text NOT NULL,
 status text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.finance_transactions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 payment_id uuid,
 treatment_id uuid,
 type text NOT NULL,
 category text NOT NULL,
 amount bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
 transaction_date date NOT NULL,
 description text,
 patient_id uuid,
 payment_method text NOT NULL,
 reference text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.staff (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 first_name text NOT NULL,
 last_name text NOT NULL,
 role text NOT NULL,
 phone text,
 email text,
 color text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.tooth_conditions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 patient_id uuid,
 tooth_number integer NOT NULL,
 condition text NOT NULL,
 surface text,
 notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.installments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 patient_id uuid,
 treatment_id uuid,
 total_amount bigint NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
 paid_amount bigint NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
 monthly_amount bigint NOT NULL DEFAULT 0 CHECK (monthly_amount >= 0),
 total_months integer NOT NULL,
 paid_months integer NOT NULL,
 start_date date NOT NULL,
 next_due_date date,
 status text NOT NULL,
 notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.checks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 patient_id uuid,
 installment_id uuid,
 treatment_id uuid,
 check_number text,
 bank_name text,
 branch text,
 sayad_id text,
 amount bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
 issue_date date,
 due_date date NOT NULL,
 status text NOT NULL,
 type text,
 drawer_name text,
 is_guarantee boolean DEFAULT false,
 notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.safteh (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 patient_id uuid,
 installment_id uuid,
 safteh_number text,
 amount bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
 issue_date date,
 due_date date NOT NULL,
 type text,
 drawer_name text,
 guarantor_name text,
 guarantor_national_id text,
 status text NOT NULL,
 notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.staff_salaries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 staff_id uuid,
 base_salary bigint NOT NULL DEFAULT 0 CHECK (base_salary >= 0),
 bonus bigint NOT NULL DEFAULT 0 CHECK (bonus >= 0),
 deductions bigint NOT NULL DEFAULT 0 CHECK (deductions >= 0),
 total_paid bigint NOT NULL DEFAULT 0 CHECK (total_paid >= 0),
 share_amount bigint NOT NULL DEFAULT 0 CHECK (share_amount >= 0),
 pay_month integer NOT NULL CHECK (pay_month BETWEEN 1 AND 12),
 pay_year integer NOT NULL,
 status text NOT NULL,
 pay_date date,
 notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 auth_user_id uuid REFERENCES auth.users(id),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.staff_shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 staff_id uuid,
 share_type text NOT NULL,
 share_value numeric(18,4) NOT NULL DEFAULT 0 CHECK (share_value >= 0),
 applies_to text NOT NULL,
 min_amount bigint NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
 active boolean NOT NULL DEFAULT true,
 notes text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 auth_user_id uuid REFERENCES auth.users(id),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 from_staff_id uuid,
 to_staff_id uuid,
 subject text NOT NULL,
 body text,
 priority text NOT NULL,
 is_read boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.advertisements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 title text NOT NULL,
 content text,
 image_url text,
 link_url text,
 target_audience text NOT NULL,
 status text NOT NULL,
 start_date date NOT NULL,
 end_date date,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id)
);

CREATE TABLE public.clinic_settings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL,
 branch_id text NOT NULL,
 key text NOT NULL,
 value text,
 category text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,branch_id,id),
 FOREIGN KEY(tenant_id,branch_id) REFERENCES public.clinic_branches(tenant_id,id),
 UNIQUE(tenant_id,branch_id,key)
);

ALTER TABLE public.appointments ADD FOREIGN KEY (tenant_id,branch_id,patient_id) REFERENCES public.patients(tenant_id,branch_id,id);
CREATE INDEX ON public.appointments(tenant_id,branch_id,patient_id);

ALTER TABLE public.appointments ADD FOREIGN KEY (tenant_id,branch_id,staff_id) REFERENCES public.staff(tenant_id,branch_id,id);
CREATE INDEX ON public.appointments(tenant_id,branch_id,staff_id);

ALTER TABLE public.treatments ADD FOREIGN KEY (tenant_id,branch_id,patient_id) REFERENCES public.patients(tenant_id,branch_id,id);
CREATE INDEX ON public.treatments(tenant_id,branch_id,patient_id);

ALTER TABLE public.treatments ADD FOREIGN KEY (tenant_id,branch_id,appointment_id) REFERENCES public.appointments(tenant_id,branch_id,id);
CREATE INDEX ON public.treatments(tenant_id,branch_id,appointment_id);

ALTER TABLE public.treatment_services ADD FOREIGN KEY (tenant_id,branch_id,treatment_id) REFERENCES public.treatments(tenant_id,branch_id,id);
CREATE INDEX ON public.treatment_services(tenant_id,branch_id,treatment_id);

ALTER TABLE public.payments ADD FOREIGN KEY (tenant_id,branch_id,patient_id) REFERENCES public.patients(tenant_id,branch_id,id);
CREATE INDEX ON public.payments(tenant_id,branch_id,patient_id);

ALTER TABLE public.payments ADD FOREIGN KEY (tenant_id,branch_id,treatment_id) REFERENCES public.treatments(tenant_id,branch_id,id);
CREATE INDEX ON public.payments(tenant_id,branch_id,treatment_id);

ALTER TABLE public.payments ADD FOREIGN KEY (tenant_id,branch_id,reversed_payment_id) REFERENCES public.payments(tenant_id,branch_id,id);
CREATE INDEX ON public.payments(tenant_id,branch_id,reversed_payment_id);

ALTER TABLE public.lab_orders ADD FOREIGN KEY (tenant_id,branch_id,patient_id) REFERENCES public.patients(tenant_id,branch_id,id);
CREATE INDEX ON public.lab_orders(tenant_id,branch_id,patient_id);

ALTER TABLE public.implants ADD FOREIGN KEY (tenant_id,branch_id,patient_id) REFERENCES public.patients(tenant_id,branch_id,id);
CREATE INDEX ON public.implants(tenant_id,branch_id,patient_id);

ALTER TABLE public.reminders ADD FOREIGN KEY (tenant_id,branch_id,patient_id) REFERENCES public.patients(tenant_id,branch_id,id);
CREATE INDEX ON public.reminders(tenant_id,branch_id,patient_id);

ALTER TABLE public.finance_transactions ADD FOREIGN KEY (tenant_id,branch_id,payment_id) REFERENCES public.payments(tenant_id,branch_id,id);
CREATE INDEX ON public.finance_transactions(tenant_id,branch_id,payment_id);

ALTER TABLE public.finance_transactions ADD FOREIGN KEY (tenant_id,branch_id,treatment_id) REFERENCES public.treatments(tenant_id,branch_id,id);
CREATE INDEX ON public.finance_transactions(tenant_id,branch_id,treatment_id);

ALTER TABLE public.finance_transactions ADD FOREIGN KEY (tenant_id,branch_id,patient_id) REFERENCES public.patients(tenant_id,branch_id,id);
CREATE INDEX ON public.finance_transactions(tenant_id,branch_id,patient_id);

ALTER TABLE public.tooth_conditions ADD FOREIGN KEY (tenant_id,branch_id,patient_id) REFERENCES public.patients(tenant_id,branch_id,id);
CREATE INDEX ON public.tooth_conditions(tenant_id,branch_id,patient_id);

ALTER TABLE public.installments ADD FOREIGN KEY (tenant_id,branch_id,patient_id) REFERENCES public.patients(tenant_id,branch_id,id);
CREATE INDEX ON public.installments(tenant_id,branch_id,patient_id);

ALTER TABLE public.installments ADD FOREIGN KEY (tenant_id,branch_id,treatment_id) REFERENCES public.treatments(tenant_id,branch_id,id);
CREATE INDEX ON public.installments(tenant_id,branch_id,treatment_id);

ALTER TABLE public.checks ADD FOREIGN KEY (tenant_id,branch_id,patient_id) REFERENCES public.patients(tenant_id,branch_id,id);
CREATE INDEX ON public.checks(tenant_id,branch_id,patient_id);

ALTER TABLE public.checks ADD FOREIGN KEY (tenant_id,branch_id,installment_id) REFERENCES public.installments(tenant_id,branch_id,id);
CREATE INDEX ON public.checks(tenant_id,branch_id,installment_id);

ALTER TABLE public.checks ADD FOREIGN KEY (tenant_id,branch_id,treatment_id) REFERENCES public.treatments(tenant_id,branch_id,id);
CREATE INDEX ON public.checks(tenant_id,branch_id,treatment_id);

ALTER TABLE public.safteh ADD FOREIGN KEY (tenant_id,branch_id,patient_id) REFERENCES public.patients(tenant_id,branch_id,id);
CREATE INDEX ON public.safteh(tenant_id,branch_id,patient_id);

ALTER TABLE public.safteh ADD FOREIGN KEY (tenant_id,branch_id,installment_id) REFERENCES public.installments(tenant_id,branch_id,id);
CREATE INDEX ON public.safteh(tenant_id,branch_id,installment_id);

ALTER TABLE public.staff_salaries ADD FOREIGN KEY (tenant_id,branch_id,staff_id) REFERENCES public.staff(tenant_id,branch_id,id);
CREATE INDEX ON public.staff_salaries(tenant_id,branch_id,staff_id);

ALTER TABLE public.staff_shares ADD FOREIGN KEY (tenant_id,branch_id,staff_id) REFERENCES public.staff(tenant_id,branch_id,id);
CREATE INDEX ON public.staff_shares(tenant_id,branch_id,staff_id);

ALTER TABLE public.messages ADD FOREIGN KEY (tenant_id,branch_id,from_staff_id) REFERENCES public.staff(tenant_id,branch_id,id);
CREATE INDEX ON public.messages(tenant_id,branch_id,from_staff_id);

ALTER TABLE public.messages ADD FOREIGN KEY (tenant_id,branch_id,to_staff_id) REFERENCES public.staff(tenant_id,branch_id,id);
CREATE INDEX ON public.messages(tenant_id,branch_id,to_staff_id);

ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.patients FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.patients TO authenticated;

CREATE POLICY patients_select ON public.patients FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'patients','SELECT'));

CREATE POLICY patients_insert ON public.patients FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'patients','INSERT'));

CREATE POLICY patients_update ON public.patients FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'patients','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'patients','UPDATE'));

CREATE POLICY patients_delete ON public.patients FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'patients','DELETE'));

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.appointments FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.appointments TO authenticated;

CREATE POLICY appointments_select ON public.appointments FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','SELECT'));

CREATE POLICY appointments_insert ON public.appointments FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','INSERT'));

CREATE POLICY appointments_update ON public.appointments FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','UPDATE'));

CREATE POLICY appointments_delete ON public.appointments FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','DELETE'));

ALTER TABLE public.treatments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.treatments FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.treatments TO authenticated;

CREATE POLICY treatments_select ON public.treatments FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','SELECT'));

CREATE POLICY treatments_insert ON public.treatments FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','INSERT'));

CREATE POLICY treatments_update ON public.treatments FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','UPDATE'));

CREATE POLICY treatments_delete ON public.treatments FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','DELETE'));

ALTER TABLE public.treatment_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treatment_services FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.treatment_services FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.treatment_services TO authenticated;

CREATE POLICY treatment_services_select ON public.treatment_services FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','SELECT'));

CREATE POLICY treatment_services_insert ON public.treatment_services FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','INSERT'));

CREATE POLICY treatment_services_update ON public.treatment_services FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','UPDATE'));

CREATE POLICY treatment_services_delete ON public.treatment_services FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','DELETE'));

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.payments FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.payments TO authenticated;

CREATE POLICY payments_select ON public.payments FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','SELECT'));

CREATE POLICY payments_insert ON public.payments FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','INSERT'));

CREATE POLICY payments_update ON public.payments FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','UPDATE'));

CREATE POLICY payments_delete ON public.payments FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','DELETE'));

ALTER TABLE public.lab_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_orders FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.lab_orders FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.lab_orders TO authenticated;

CREATE POLICY lab_orders_select ON public.lab_orders FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','SELECT'));

CREATE POLICY lab_orders_insert ON public.lab_orders FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','INSERT'));

CREATE POLICY lab_orders_update ON public.lab_orders FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','UPDATE'));

CREATE POLICY lab_orders_delete ON public.lab_orders FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','DELETE'));

ALTER TABLE public.implants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.implants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.implants FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.implants TO authenticated;

CREATE POLICY implants_select ON public.implants FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','SELECT'));

CREATE POLICY implants_insert ON public.implants FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','INSERT'));

CREATE POLICY implants_update ON public.implants FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','UPDATE'));

CREATE POLICY implants_delete ON public.implants FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','DELETE'));

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.inventory FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.inventory TO authenticated;

CREATE POLICY inventory_select ON public.inventory FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','SELECT'));

CREATE POLICY inventory_insert ON public.inventory FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','INSERT'));

CREATE POLICY inventory_update ON public.inventory FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','UPDATE'));

CREATE POLICY inventory_delete ON public.inventory FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','DELETE'));

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.reminders FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.reminders TO authenticated;

CREATE POLICY reminders_select ON public.reminders FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','SELECT'));

CREATE POLICY reminders_insert ON public.reminders FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','INSERT'));

CREATE POLICY reminders_update ON public.reminders FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','UPDATE'));

CREATE POLICY reminders_delete ON public.reminders FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','DELETE'));

ALTER TABLE public.finance_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_transactions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_transactions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.finance_transactions TO authenticated;

CREATE POLICY finance_transactions_select ON public.finance_transactions FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'ledger','SELECT'));

CREATE POLICY finance_transactions_insert ON public.finance_transactions FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'ledger','INSERT'));

CREATE POLICY finance_transactions_update ON public.finance_transactions FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'ledger','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'ledger','UPDATE'));

CREATE POLICY finance_transactions_delete ON public.finance_transactions FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'ledger','DELETE'));

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.staff TO authenticated;

CREATE POLICY staff_select ON public.staff FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'admin','SELECT'));

CREATE POLICY staff_insert ON public.staff FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'admin','INSERT'));

CREATE POLICY staff_update ON public.staff FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'admin','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'admin','UPDATE'));

CREATE POLICY staff_delete ON public.staff FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'admin','DELETE'));

ALTER TABLE public.tooth_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tooth_conditions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.tooth_conditions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.tooth_conditions TO authenticated;

CREATE POLICY tooth_conditions_select ON public.tooth_conditions FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','SELECT'));

CREATE POLICY tooth_conditions_insert ON public.tooth_conditions FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','INSERT'));

CREATE POLICY tooth_conditions_update ON public.tooth_conditions FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','UPDATE'));

CREATE POLICY tooth_conditions_delete ON public.tooth_conditions FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'clinical','DELETE'));

ALTER TABLE public.installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.installments FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.installments TO authenticated;

CREATE POLICY installments_select ON public.installments FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','SELECT'));

CREATE POLICY installments_insert ON public.installments FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','INSERT'));

CREATE POLICY installments_update ON public.installments FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','UPDATE'));

CREATE POLICY installments_delete ON public.installments FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','DELETE'));

ALTER TABLE public.checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checks FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.checks FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.checks TO authenticated;

CREATE POLICY checks_select ON public.checks FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','SELECT'));

CREATE POLICY checks_insert ON public.checks FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','INSERT'));

CREATE POLICY checks_update ON public.checks FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','UPDATE'));

CREATE POLICY checks_delete ON public.checks FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','DELETE'));

ALTER TABLE public.safteh ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safteh FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.safteh FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.safteh TO authenticated;

CREATE POLICY safteh_select ON public.safteh FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','SELECT'));

CREATE POLICY safteh_insert ON public.safteh FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','INSERT'));

CREATE POLICY safteh_update ON public.safteh FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','UPDATE'));

CREATE POLICY safteh_delete ON public.safteh FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'billing','DELETE'));

ALTER TABLE public.staff_salaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_salaries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_salaries FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.staff_salaries TO authenticated;

CREATE POLICY staff_salaries_select ON public.staff_salaries FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'payroll','SELECT',auth_user_id));

CREATE POLICY staff_salaries_insert ON public.staff_salaries FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'payroll','INSERT',auth_user_id));

CREATE POLICY staff_salaries_update ON public.staff_salaries FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'payroll','UPDATE',auth_user_id)) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'payroll','UPDATE',auth_user_id));

CREATE POLICY staff_salaries_delete ON public.staff_salaries FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'payroll','DELETE',auth_user_id));

ALTER TABLE public.staff_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_shares FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_shares FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.staff_shares TO authenticated;

CREATE POLICY staff_shares_select ON public.staff_shares FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'payroll','SELECT',auth_user_id));

CREATE POLICY staff_shares_insert ON public.staff_shares FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'payroll','INSERT',auth_user_id));

CREATE POLICY staff_shares_update ON public.staff_shares FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'payroll','UPDATE',auth_user_id)) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'payroll','UPDATE',auth_user_id));

CREATE POLICY staff_shares_delete ON public.staff_shares FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'payroll','DELETE',auth_user_id));

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.messages FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.messages TO authenticated;

CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','SELECT'));

CREATE POLICY messages_insert ON public.messages FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','INSERT'));

CREATE POLICY messages_update ON public.messages FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','UPDATE'));

CREATE POLICY messages_delete ON public.messages FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'operations','DELETE'));

ALTER TABLE public.advertisements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advertisements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.advertisements FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.advertisements TO authenticated;

CREATE POLICY advertisements_select ON public.advertisements FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'admin','SELECT'));

CREATE POLICY advertisements_insert ON public.advertisements FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'admin','INSERT'));

CREATE POLICY advertisements_update ON public.advertisements FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'admin','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'admin','UPDATE'));

CREATE POLICY advertisements_delete ON public.advertisements FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'admin','DELETE'));

ALTER TABLE public.clinic_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.clinic_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.clinic_settings TO authenticated;

CREATE POLICY clinic_settings_select ON public.clinic_settings FOR SELECT TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'admin','SELECT'));

CREATE POLICY clinic_settings_insert ON public.clinic_settings FOR INSERT TO authenticated WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'admin','INSERT'));

CREATE POLICY clinic_settings_update ON public.clinic_settings FOR UPDATE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'admin','UPDATE')) WITH CHECK (public.app_authorize_clinic_op(tenant_id,branch_id,'admin','UPDATE'));

CREATE POLICY clinic_settings_delete ON public.clinic_settings FOR DELETE TO authenticated USING (public.app_authorize_clinic_op(tenant_id,branch_id,'admin','DELETE'));

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC,anon,authenticated;
CREATE TABLE private.clinic_mutation_audit (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, occurred_at timestamptz NOT NULL DEFAULT now(),
 actor_id uuid, table_name text NOT NULL, operation text NOT NULL, tenant_id text NOT NULL, branch_id text NOT NULL, record_id uuid NOT NULL
);
ALTER TABLE private.clinic_mutation_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.clinic_mutation_audit FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.clinic_mutation_audit FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.audit_mutation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rec record;
BEGIN
 IF TG_OP='DELETE' THEN rec:=OLD; ELSE rec:=NEW; END IF;
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated actor required for clinical mutation'; END IF;
 INSERT INTO private.clinic_mutation_audit(actor_id,table_name,operation,tenant_id,branch_id,record_id)
 VALUES(auth.uid(),TG_TABLE_NAME,TG_OP,rec.tenant_id,rec.branch_id,rec.id);
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
REVOKE ALL ON FUNCTION private.audit_mutation() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION private.touch_record() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Record identity and scope are immutable'; END IF;
 NEW.updated_at:=now(); RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.touch_record() FROM PUBLIC,anon,authenticated;

CREATE TRIGGER patients_touch BEFORE UPDATE ON public.patients FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER patients_audit AFTER INSERT OR UPDATE OR DELETE ON public.patients FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER appointments_touch BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER appointments_audit AFTER INSERT OR UPDATE OR DELETE ON public.appointments FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER treatments_touch BEFORE UPDATE ON public.treatments FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER treatments_audit AFTER INSERT OR UPDATE OR DELETE ON public.treatments FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER treatment_services_touch BEFORE UPDATE ON public.treatment_services FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER treatment_services_audit AFTER INSERT OR UPDATE OR DELETE ON public.treatment_services FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER payments_touch BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER payments_audit AFTER INSERT OR UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER lab_orders_touch BEFORE UPDATE ON public.lab_orders FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER lab_orders_audit AFTER INSERT OR UPDATE OR DELETE ON public.lab_orders FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER implants_touch BEFORE UPDATE ON public.implants FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER implants_audit AFTER INSERT OR UPDATE OR DELETE ON public.implants FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER inventory_touch BEFORE UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER inventory_audit AFTER INSERT OR UPDATE OR DELETE ON public.inventory FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER reminders_touch BEFORE UPDATE ON public.reminders FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER reminders_audit AFTER INSERT OR UPDATE OR DELETE ON public.reminders FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER finance_transactions_touch BEFORE UPDATE ON public.finance_transactions FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER finance_transactions_audit AFTER INSERT OR UPDATE OR DELETE ON public.finance_transactions FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER staff_touch BEFORE UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER staff_audit AFTER INSERT OR UPDATE OR DELETE ON public.staff FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER tooth_conditions_touch BEFORE UPDATE ON public.tooth_conditions FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER tooth_conditions_audit AFTER INSERT OR UPDATE OR DELETE ON public.tooth_conditions FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER installments_touch BEFORE UPDATE ON public.installments FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER installments_audit AFTER INSERT OR UPDATE OR DELETE ON public.installments FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER checks_touch BEFORE UPDATE ON public.checks FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER checks_audit AFTER INSERT OR UPDATE OR DELETE ON public.checks FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER safteh_touch BEFORE UPDATE ON public.safteh FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER safteh_audit AFTER INSERT OR UPDATE OR DELETE ON public.safteh FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER staff_salaries_touch BEFORE UPDATE ON public.staff_salaries FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER staff_salaries_audit AFTER INSERT OR UPDATE OR DELETE ON public.staff_salaries FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER staff_shares_touch BEFORE UPDATE ON public.staff_shares FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER staff_shares_audit AFTER INSERT OR UPDATE OR DELETE ON public.staff_shares FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER messages_audit AFTER INSERT OR UPDATE OR DELETE ON public.messages FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER advertisements_touch BEFORE UPDATE ON public.advertisements FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER advertisements_audit AFTER INSERT OR UPDATE OR DELETE ON public.advertisements FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

CREATE TRIGGER clinic_settings_touch BEFORE UPDATE ON public.clinic_settings FOR EACH ROW EXECUTE FUNCTION private.touch_record();

CREATE TRIGGER clinic_settings_audit AFTER INSERT OR UPDATE OR DELETE ON public.clinic_settings FOR EACH ROW EXECUTE FUNCTION private.audit_mutation();

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
SET search_path = ''
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



NOTIFY pgrst, 'reload schema';
COMMIT;