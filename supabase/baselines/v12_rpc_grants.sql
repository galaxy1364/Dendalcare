BEGIN;
REVOKE ALL ON FUNCTION public.get_clinic_dashboard_summary(text,text,date,date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_clinic_dashboard_summary(text,text,date,date,date) TO authenticated;
COMMIT;