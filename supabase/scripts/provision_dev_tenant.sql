-- ============================================================================
-- MINADENTAL V11 — MANUAL DEV/STAGING TENANT & MEMBERSHIP PROVISIONING SCRIPT
-- File: supabase/scripts/provision_dev_tenant.sql
--
-- IMPORTANT:
--   - This file is intentionally OUTSIDE `supabase/migrations/`.
--   - Migrations NEVER create automatic privileged users or fake patient rows.
--   - Run this manually as a privileged database operator AFTER applying
--     `supabase/migrations/` AND creating real Supabase Auth users in the
--     Supabase Auth dashboard or Admin API.
--   - Replace the placeholder UUIDs below with actual `auth.users.id` UUIDs
--     before executing.
-- ============================================================================

BEGIN;

-- 1. Provision development clinic tenant & branches (ZERO patient data)
INSERT INTO public.tenants (id, name, slug, status)
VALUES ('clinic-default', 'مینادنتال — محیط توسعه V11', 'minadental-v11-dev', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.branches (id, tenant_id, name, code, is_default, status)
VALUES
  ('main',  'clinic-default', 'شعبه مرکزی (توسعه)', 'MAIN',  true,  'active'),
  ('north', 'clinic-default', 'شعبه شمال (توسعه)',  'NORTH', false, 'active')
ON CONFLICT (tenant_id, id) DO NOTHING;

-- 2. Bind explicitly created Supabase Auth users into `public.clinic_memberships`.
--    Uncomment and replace each UUID with the real `auth.users.id` from Supabase Auth:
--
-- INSERT INTO public.clinic_memberships (user_id, tenant_id, branch_id, role, all_branches, active)
-- VALUES
--   ('<MANAGER_AUTH_USER_UUID>'::uuid,   'clinic-default', 'main', 'manager',   true,  true),
--   ('<DENTIST_AUTH_USER_UUID>'::uuid,   'clinic-default', 'main', 'dentist',   false, true),
--   ('<SECRETARY_AUTH_USER_UUID>'::uuid, 'clinic-default', 'main', 'secretary', false, true),
--   ('<ASSISTANT_AUTH_USER_UUID>'::uuid, 'clinic-default', 'main', 'assistant', false, true)
-- ON CONFLICT (user_id, tenant_id, branch_id) DO UPDATE
--   SET role = EXCLUDED.role,
--       all_branches = EXCLUDED.all_branches,
--       active = EXCLUDED.active;

COMMIT;
