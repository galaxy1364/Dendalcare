BEGIN;
-- Revoke client execution of the platform's DDL event-trigger helper; event trigger itself stays intact.
DO $$ BEGIN IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
 REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC,anon,authenticated;
END IF; END $$;
CREATE INDEX clinic_memberships_branch_fk_idx ON public.clinic_memberships(tenant_id,branch_id);
CREATE INDEX staff_salaries_auth_user_fk_idx ON public.staff_salaries(auth_user_id);
CREATE INDEX staff_shares_auth_user_fk_idx ON public.staff_shares(auth_user_id);
COMMIT;