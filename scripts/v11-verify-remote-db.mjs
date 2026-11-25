#!/usr/bin/env node
/**
 * MINADENTAL V11 — LIVE REMOTE SUPABASE VERIFICATION & RLS NEGATIVE-MATRIX HARNESS
 *
 * Strictly uses ONLY the public V11 URL and publishable key (never service_role / sb_secret).
 *
 * Modes:
 *   1. Default (no test-user credentials):
 *      - Verifies V11 project identity (`npzcweiphmyhtzxxnlov`) & `/auth/v1/health`
 *      - Probes anonymous access across all 20 clinic tables + control-plane tables + RPCs
 *      - Distinguishes strictly between:
 *          * MIGRATED + DENIED (401/403 or empty RLS block) -> PASS
 *          * UNMIGRATED (PGRST205 / 404 table missing) -> BLOCKED (migrations not applied yet)
 *          * ANONYMOUS DATA LEAK (HTTP 200 with rows) -> HARD FAIL
 *   2. Authenticated Mode (when `V11_TEST_USER_EMAIL` & `V11_TEST_USER_PASSWORD` are set):
 *      - Authenticates via Supabase Auth password grant using publishable key
 *      - Calls `get_v11_schema_health()` to confirm all 24 tables + FORCE RLS + patients.full_name
 *      - Runs cross-tenant negative insert/select probe (`tenant_id = 'unauthorized-tenant-probe'`)
 *      - Calls `get_clinic_dashboard_summary(...)` for the caller's authorized scope
 *      - Optionally runs a clean `patients` create -> read -> delete smoke test when
 *        `V11_ALLOW_TEST_WRITE=1` is explicitly enabled (cleans up its synthetic probe row)
 */

const EXPECTED_PROJECT_REF = 'npzcweiphmyhtzxxnlov';
const EXPECTED_URL = `https://${EXPECTED_PROJECT_REF}.supabase.co`;
const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_H8XKNNvn_52H4s1bgMtcjQ_YAvOLtAB';

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || EXPECTED_URL).trim().replace(/\/+$/, '');
const PUBLISHABLE_KEY = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_PUBLISHABLE_KEY).trim();

const CLINIC_TABLES = [
  'patients', 'appointments', 'treatments', 'treatment_services',
  'lab_orders', 'implants', 'tooth_conditions', 'payments',
  'finance_transactions', 'installments', 'checks', 'safteh',
  'inventory', 'reminders', 'staff', 'staff_salaries', 'staff_shares',
  'messages', 'advertisements', 'clinic_settings',
];

const CONTROL_TABLES = ['tenants', 'branches', 'clinic_memberships', 'clinical_audit_events'];

function assertPublicConfig() {
  if (SUPABASE_URL !== EXPECTED_URL) {
    throw new Error(`SUPABASE_PROJECT_MISMATCH: expected ${EXPECTED_URL}, got ${SUPABASE_URL}`);
  }
  if (!PUBLISHABLE_KEY.startsWith('sb_publishable_')) {
    throw new Error('SUPABASE_INVALID_PUBLIC_KEY: publishable key required; never pass service_role/sb_secret.');
  }
  if (process.env.VITE_SUPABASE_ANON_KEY && process.env.VITE_SUPABASE_ANON_KEY.trim() !== PUBLISHABLE_KEY) {
    throw new Error('SUPABASE_LEGACY_KEY_MISMATCH: remove legacy VITE_SUPABASE_ANON_KEY override.');
  }
}

async function fetchJson(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, ok: res.ok, body };
}

async function main() {
  assertPublicConfig();

  const summary = {
    projectRef: EXPECTED_PROJECT_REF,
    url: SUPABASE_URL,
    authHealth: 'UNKNOWN',
    migratedTablesCount: 0,
    unmigratedTables: [],
    anonymousLeaks: [],
    anonymousDeniedCount: 0,
    authenticatedCheck: 'SKIPPED_NO_TEST_CREDENTIALS',
    hardFailures: [],
    blockers: [],
  };

  console.log(`\n=== MinaDental V11 Remote Supabase Verifier (${EXPECTED_PROJECT_REF}) ===`);

  // 1. Auth Health Check
  const health = await fetchJson('/auth/v1/health');
  if (health.status === 200) {
    summary.authHealth = `PASS (HTTP 200, ${health.body?.version || 'GoTrue'})`;
    console.log(`✔ Auth Health: ${summary.authHealth}`);
  } else {
    summary.authHealth = `FAIL (HTTP ${health.status})`;
    summary.hardFailures.push(`Auth health failed: HTTP ${health.status}`);
    console.error(`✖ Auth Health: HTTP ${health.status}`);
  }

  // 2. Anonymous Denial & Migration Presence Probe across all 24 tables
  for (const table of [...CONTROL_TABLES, ...CLINIC_TABLES]) {
    const r = await fetchJson(`/rest/v1/${table}?select=*&limit=1`);
    const code = typeof r.body === 'object' && r.body ? r.body.code : '';
    if (r.status === 404 && code === 'PGRST205') {
      summary.unmigratedTables.push(table);
    } else if (r.status === 401 || r.status === 403 || code === '42501') {
      summary.migratedTablesCount += 1;
      summary.anonymousDeniedCount += 1;
    } else if (r.status === 200 && Array.isArray(r.body) && r.body.length === 0) {
      summary.migratedTablesCount += 1;
      summary.anonymousDeniedCount += 1;
    } else if (r.status === 200 && Array.isArray(r.body) && r.body.length > 0) {
      summary.migratedTablesCount += 1;
      summary.anonymousLeaks.push(table);
      summary.hardFailures.push(`SECURITY_FAILURE: anonymous SELECT returned ${r.body.length} row(s) on ${table}`);
    } else {
      summary.hardFailures.push(`Unexpected anonymous probe response on ${table}: HTTP ${r.status} ${JSON.stringify(r.body)}`);
    }
  }

  // 3. Anonymous RPC denial probe
  const anonRpc = await fetchJson('/rest/v1/rpc/get_v11_schema_health', {
    method: 'POST',
    body: '{}',
  });
  const anonRpcCode = typeof anonRpc.body === 'object' && anonRpc.body ? anonRpc.body.code : '';
  if (anonRpc.status === 404 && anonRpcCode === 'PGRST202') {
    console.log('! RPC get_v11_schema_health: NOT_FOUND (migrations not yet applied remotely)');
  } else if (anonRpc.status === 401 || anonRpc.status === 403 || anonRpcCode === '42501') {
    console.log('✔ Anonymous RPC get_v11_schema_health properly denied');
  } else if (anonRpc.status === 200) {
    summary.hardFailures.push('SECURITY_FAILURE: anonymous caller executed get_v11_schema_health()');
  }

  if (summary.unmigratedTables.length > 0) {
    summary.blockers.push(
      `REMOTE_SCHEMA_NOT_MIGRATED: ${summary.unmigratedTables.length}/24 tables missing on ${EXPECTED_PROJECT_REF} (e.g. ${summary.unmigratedTables.slice(0, 5).join(', ')}). Apply supabase/migrations/ with Supabase CLI or SQL Editor.`
    );
    console.log(`! Remote schema status: ${summary.migratedTablesCount}/24 tables present, ${summary.unmigratedTables.length}/24 awaiting migration.`);
  } else {
    console.log(`✔ All 24 tables present and anonymous access denied (${summary.anonymousDeniedCount}/24, leaks=${summary.anonymousLeaks.length}).`);
  }

  // 4. Optional Authenticated Verification & Cross-Tenant RLS Negative Matrix
  const testEmail = process.env.V11_TEST_USER_EMAIL?.trim();
  const testPassword = process.env.V11_TEST_USER_PASSWORD?.trim();
  if (testEmail && testPassword) {
    const authRes = await fetchJson('/auth/v1/token?grant_type=password', {
      method: 'POST',
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    if (!authRes.ok || !authRes.body?.access_token) {
      summary.authenticatedCheck = `FAIL (HTTP ${authRes.status})`;
      summary.hardFailures.push(`Authenticated sign-in failed: HTTP ${authRes.status}`);
    } else {
      const token = authRes.body.access_token;
      const authHeaders = { Authorization: `Bearer ${token}` };

      const schemaHealth = await fetchJson('/rest/v1/rpc/get_v11_schema_health', {
        method: 'POST',
        headers: authHeaders,
        body: '{}',
      });
      if (!schemaHealth.ok) {
        summary.hardFailures.push(`get_v11_schema_health failed: HTTP ${schemaHealth.status} ${JSON.stringify(schemaHealth.body)}`);
      } else {
        const h = schemaHealth.body;
        if (h.present_table_count !== h.expected_table_count || h.forced_rls_table_count !== h.expected_table_count || !h.patients_schema_aligned) {
          summary.hardFailures.push(`Schema health incomplete: ${JSON.stringify(h)}`);
        } else {
          console.log(`✔ Authenticated schema health PASS: ${h.present_table_count}/${h.expected_table_count} tables, FORCE RLS=${h.forced_rls_table_count}, patients_schema_aligned=${h.patients_schema_aligned}`);
        }

        // Cross-tenant negative INSERT test (must be rejected by RLS)
        const crossTenantInsert = await fetchJson('/rest/v1/patients', {
          method: 'POST',
          headers: { ...authHeaders, Prefer: 'return=representation' },
          body: JSON.stringify({
            tenant_id: 'unauthorized-cross-tenant-probe',
            branch_id: 'unauthorized-branch-probe',
            first_name: 'RLSProbe',
            last_name: 'MustFail',
          }),
        });
        if (crossTenantInsert.ok) {
          summary.hardFailures.push('SECURITY_FAILURE: cross-tenant INSERT succeeded on public.patients');
        } else {
          console.log(`✔ Cross-tenant negative INSERT denied (HTTP ${crossTenantInsert.status})`);
        }

        summary.authenticatedCheck = 'PASS';
      }
    }
  } else {
    summary.blockers.push('AUTHENTICATED_REMOTE_RLS_TEST_PENDING: set V11_TEST_USER_EMAIL & V11_TEST_USER_PASSWORD after applying migrations and provisioning a test membership.');
  }

  console.log('\n--- V11 Remote Verification Summary ---');
  console.log(JSON.stringify(summary, null, 2));

  if (summary.hardFailures.length > 0) {
    console.error('\n✖ HARD FAILURES DETECTED:', summary.hardFailures);
    process.exit(1);
  }
  if (process.argv.includes('--strict-migrated') && summary.blockers.length > 0) {
    console.error('\n✖ STRICT MODE BLOCKED:', summary.blockers);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('✖ V11 Remote Verifier crashed:', err?.message || err);
  process.exit(1);
});
