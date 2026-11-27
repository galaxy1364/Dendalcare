-- GE-0024I: read-only release preflight for the exact configured database.
-- A false result blocks release; do not treat this catalog check as a functional test.
WITH expected(signature) AS (
  VALUES
    ('public.post_patient_payment_v16(text,text,uuid,bigint,text,date,text,jsonb,text,uuid,jsonb)'),
    ('public.reverse_or_refund_payment_v16(text,text,uuid,bigint,date,text,text)'),
    ('public.reconcile_day_close_v16(text,text,date,bigint,bigint,text,text)')
), resolved AS (
  SELECT signature, to_regprocedure(signature) AS oid FROM expected
)
SELECT signature, oid IS NOT NULL AS installed,
       CASE WHEN oid IS NOT NULL THEN has_function_privilege('authenticated', oid, 'EXECUTE') ELSE false END AS authenticated_execute,
       CASE WHEN oid IS NOT NULL THEN NOT has_function_privilege('anon', oid, 'EXECUTE') ELSE false END AS anonymous_denied
FROM resolved ORDER BY signature;
