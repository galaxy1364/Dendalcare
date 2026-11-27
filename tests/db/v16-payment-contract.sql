-- Disposable CI only: synthetic records, real PostgreSQL execution.
BEGIN;
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
INSERT INTO public.clinic_tenants(id,name) VALUES ('ci-tenant','Synthetic QA');
INSERT INTO public.clinic_branches(tenant_id,id,name) VALUES ('ci-tenant','main','Main QA'),('ci-tenant','other','Other QA');
INSERT INTO public.clinic_memberships(user_id,tenant_id,branch_id,role) VALUES ('00000000-0000-4000-8000-000000000001','ci-tenant','main','manager');
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
INSERT INTO public.patients(id,tenant_id,branch_id,first_name,last_name,gender,status) VALUES
 ('00000000-0000-4000-8000-000000000011','ci-tenant','main','Synthetic','QA','male','active'),
 ('00000000-0000-4000-8000-000000000012','ci-tenant','other','Synthetic','Other','male','active');
INSERT INTO public.treatments(id,tenant_id,branch_id,patient_id,status,total_cost,paid_amount,discount)
 VALUES ('00000000-0000-4000-8000-000000000021','ci-tenant','main','00000000-0000-4000-8000-000000000011','completed',1000,0,0);
DO $$ BEGIN
 IF has_function_privilege('anon','public.post_patient_payment_v16(text,text,uuid,bigint,text,date,text,jsonb,text,uuid,jsonb)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.post_patient_payment_v16(text,text,uuid,bigint,text,date,text,jsonb,text,uuid,jsonb)','EXECUTE') THEN
  RAISE EXCEPTION 'RPC grants incorrect';
 END IF;
END $$;
SET LOCAL ROLE authenticated;
DO $$
DECLARE a jsonb; b jsonb;
BEGIN
 a := public.post_patient_payment_v16('ci-tenant','main','00000000-0000-4000-8000-000000000011',400,'cash','2026-11-27','ci-payment','[{"chargeId":"00000000-0000-4000-8000-000000000021","amount":300}]'::jsonb);
 b := public.post_patient_payment_v16('ci-tenant','main','00000000-0000-4000-8000-000000000011',400,'cash','2026-11-27','ci-payment','[{"chargeId":"00000000-0000-4000-8000-000000000021","amount":300}]'::jsonb);
 IF a->>'ok' IS DISTINCT FROM 'true' OR b->>'idempotentReplay' IS DISTINCT FROM 'true' OR a->>'paymentId' IS DISTINCT FROM b->>'paymentId' THEN RAISE EXCEPTION 'Payment replay contract failed'; END IF;
 BEGIN
   PERFORM public.post_patient_payment_v16('ci-tenant','main','00000000-0000-4000-8000-000000000011',401,'cash','2026-11-27','ci-payment','[{"chargeId":"00000000-0000-4000-8000-000000000021","amount":300}]'::jsonb);
   RAISE EXCEPTION 'Changed payload accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
   PERFORM public.post_patient_payment_v16('ci-tenant','other','00000000-0000-4000-8000-000000000012',100,'cash','2026-11-27','ci-cross-branch');
   RAISE EXCEPTION 'Cross-branch payment accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
 BEGIN
   PERFORM public.post_patient_payment_v16('ci-tenant','main','00000000-0000-4000-8000-000000000011',100,'cash','2026-11-27','ci-no-membership');
   RAISE EXCEPTION 'Unauthorized user accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.payments) <> 1 OR (SELECT count(*) FROM public.finance_transactions) <> 1
 OR (SELECT count(*) FROM public.finance_command_idempotency) <> 1
 OR (SELECT sum(amount) FROM public.payment_allocations) IS DISTINCT FROM 300::numeric
 OR (SELECT paid_amount FROM public.treatments WHERE id='00000000-0000-4000-8000-000000000021') IS DISTINCT FROM 300::bigint
 OR (SELECT unapplied_amount FROM public.payments) IS DISTINCT FROM 100::bigint
 OR (SELECT sum(debit_toman) FROM public.journal_lines) IS DISTINCT FROM 400::numeric
 OR (SELECT sum(credit_toman) FROM public.journal_lines) IS DISTINCT FROM 400::numeric THEN
 RAISE EXCEPTION 'Actual payment/ledger reconciliation failed';
 END IF;
END $$;
ROLLBACK;
