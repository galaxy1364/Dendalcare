-- CI disposable PostgreSQL ONLY. Minimal test adapter, not Supabase authentication.
DO $$ BEGIN
 IF current_database() <> 'minadental_ci' OR inet_server_addr() IS NULL THEN
   RAISE EXCEPTION 'Disposable CI database required';
 END IF;
END $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT NULLIF(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated;
