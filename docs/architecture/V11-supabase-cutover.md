# V11 Supabase cutover — single source of truth

Target project: npzcweiphmyhtzxxnlov
Public API URL: https://npzcweiphmyhtzxxnlov.supabase.co
Development only, no real patient records. GitHub is the canonical source; AI Studio must import this branch and synchronize changes via a single PR. Do not recreate a separate database or reintroduce the old project.

## Before cutover
- Supabase connector currently cannot manage the new project; obtain explicit authorized organization access first. Do not paste passwords, access tokens or secret keys into chats, frontend or repository.
- Inventory all migrations and every table, view, RPC, column and relation referenced by app code. Verify whether migrations create complete baseline on a fresh database; reconcile dependencies, types, constraints, finance date fields, tenant/branch membership, and grants.
- Build empty baseline using repeatable versioned migrations in supabase/migrations. No production patient data or fake KPI. Explicitly provision a test tenant, branch and authorized test user separately. No automatic privileged user.
- Enforce RLS, deny anonymous access, membership validation per tenant/branch, least privilege, deny unauthorized role and cross-tenant writes. Restrict finance, audit and storage, no public clinical buckets. Verify real authenticated and unauthenticated negative tests. Do not disable security to fix schema errors.
- Use only VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see .env.example). Remove stale VITE_SUPABASE_ANON_KEY and old project environment overrides. Never use sb_secret or service_role in client. Compatibility export supabaseAnonKey contains a publishable key.
- Verify real schema via metadata and API using authorized test sessions. Check patients, appointments, treatments, finance, inventory, lab, implants, staff, reminders, messages, settings, audit and every RPC. Check schema cache, exact columns, types and FK. Empty list is legitimate; migration_required and unauthorized must remain explicit.
- Namespace local offline caches, outbox and stored session by backend project; never replay writes or reuse cached clinical records across backend identities. Preserve old data until explicitly authorized cleanup. Validate upgrade with old service worker, fresh boot, offline and warm boot.
- Run typecheck, build, verify:assets, npm test, real browser E2E and RLS negative matrix before merge. Confirm deployed bundle references only new project and no secrets. Keep main untouched until database migration and tests pass.
- Coordinate with V10 PR #2; merge/rebase only after resolving conflicts. Report evidence, commit SHA, migration versions, target project ref, actual test outcomes and remaining gaps. No claimed completion without remote verification.
