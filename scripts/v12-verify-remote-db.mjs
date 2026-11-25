#!/usr/bin/env node
/**
 * MINADENTAL V12 — REMOTE SUPABASE VERIFICATION, CLINICAL CRUD & NEGATIVE RLS HARNESS
 *
 * Targets the authoritative V12 development Supabase project (`npzcweiphmyhtzxxnlov`)
 * aligned with `supabase/baselines/v12_empty_clinic_foundation.sql`.
 *
 * Strictly read-only/anonymous by default. When isolated test credentials or a
 * disposable `SUPABASE_SERVICE_ROLE_KEY` env var are explicitly supplied in CI/dev,
 * provisions an isolated ephemeral tenant/branch/membership fixture set, executes
 * real clinical CRUD + negative RBAC/RLS tests across roles (`manager`, `dentist`,
 * `secretary`, `assistant`, `revoked`, `cross-branch`, `cross-tenant`), and cleans up
 * every synthetic row and test user in `finally`.
 */

import crypto from 'node:crypto';

const EXPECTED_PROJECT_REF = 'npzcweiphmyhtzxxnlov';
const EXPECTED_URL = `https://${EXPECTED_PROJECT_REF}.supabase.co`;
const DEFAULT_PUBLISHABLE_KEY = 'sb_publishable_H8XKNNvn_52H4s1bgMtcjQ_YAvOLtAB';

const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || EXPECTED_URL).trim().replace(/\/+$/, '');
const PUBLISHABLE_KEY = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY || DEFAULT_PUBLISHABLE_KEY).trim();
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

const V12_CONTROL_TABLES = ['clinic_tenants', 'clinic_branches', 'clinic_memberships'];
const V12_CLINIC_TABLES = [
  'patients', 'appointments', 'treatments', 'treatment_services',
  'payments', 'lab_orders', 'implants', 'inventory', 'reminders',
  'finance_transactions', 'staff', 'tooth_conditions', 'installments',
  'checks', 'safteh', 'staff_salaries', 'staff_shares',
  'messages', 'advertisements', 'clinic_settings',
];
const ALL_V12_PUBLIC_TABLES = [...V12_CONTROL_TABLES, ...V12_CLINIC_TABLES];

function assertPublicConfig() {
  if (SUPABASE_URL !== EXPECTED_URL) {
    throw new Error(`SUPABASE_PROJECT_MISMATCH: expected ${EXPECTED_URL}, got ${SUPABASE_URL}`);
  }
  if (!PUBLISHABLE_KEY.startsWith('sb_publishable_')) {
    throw new Error('SUPABASE_INVALID_PUBLIC_KEY: publishable key required.');
  }
  if (process.env.VITE_SUPABASE_ANON_KEY && process.env.VITE_SUPABASE_ANON_KEY.trim() !== PUBLISHABLE_KEY) {
    throw new Error('SUPABASE_LEGACY_KEY_MISMATCH: remove legacy VITE_SUPABASE_ANON_KEY override.');
  }
}

async function req(path, options = {}, apiKey = PUBLISHABLE_KEY) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: apiKey,
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

async function signInUser(email, password) {
  const res = await req('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok || !res.body?.access_token) {
    throw new Error(`Sign-in failed for ${email}: HTTP ${res.status}`);
  }
  return {
    token: res.body.access_token,
    userId: res.body.user?.id,
  };
}

function authHeaders(token, extra = {}) {
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

async function runRoleCrudAndRlsMatrix({
  tenantA,
  tenantB,
  branchA,
  branchB,
  users,
}) {
  const checks = [];
  const assertCheck = (name, cond, detail) => {
    if (!cond) throw new Error(`RLS_MATRIX_FAILURE [${name}]: ${detail}`);
    checks.push(name);
  };

  // 1. Manager CRUD on patients + treatments + payments + dashboard RPC
  const mgrToken = users.manager.token;
  const mgrRoleRpc = await req('/rest/v1/rpc/app_resolve_verified_role', {
    method: 'POST',
    headers: authHeaders(mgrToken),
    body: JSON.stringify({ target_tenant: tenantA, target_branch: branchA }),
  });
  assertCheck('manager_role_rpc', mgrRoleRpc.ok && mgrRoleRpc.body === 'manager', `got ${JSON.stringify(mgrRoleRpc)}`);

  const createdPatient = await req('/rest/v1/patients', {
    method: 'POST',
    headers: authHeaders(mgrToken, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      tenant_id: tenantA,
      branch_id: branchA,
      first_name: 'V12Test',
      last_name: 'Patient',
      gender: 'unknown',
      status: 'active',
    }),
  });
  assertCheck('manager_insert_patient', createdPatient.ok && Array.isArray(createdPatient.body) && createdPatient.body[0]?.id, `HTTP ${createdPatient.status} ${JSON.stringify(createdPatient.body)}`);
  const patientId = createdPatient.body[0].id;

  const readPatient = await req(`/rest/v1/patients?id=eq.${patientId}&select=id,tenant_id,branch_id,first_name,last_name`, {
    headers: authHeaders(mgrToken),
  });
  assertCheck('manager_read_patient', readPatient.ok && readPatient.body?.[0]?.id === patientId, `HTTP ${readPatient.status}`);

  const updatePatient = await req(`/rest/v1/patients?id=eq.${patientId}`, {
    method: 'PATCH',
    headers: authHeaders(mgrToken, { Prefer: 'return=representation' }),
    body: JSON.stringify({ notes: 'v12_updated' }),
  });
  assertCheck('manager_update_patient', updatePatient.ok && updatePatient.body?.[0]?.notes === 'v12_updated', `HTTP ${updatePatient.status}`);

  const createdTreatment = await req('/rest/v1/treatments', {
    method: 'POST',
    headers: authHeaders(mgrToken, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      tenant_id: tenantA,
      branch_id: branchA,
      patient_id: patientId,
      status: 'completed',
      total_cost: 5000000,
      performed_at: new Date().toISOString(),
    }),
  });
  assertCheck('manager_insert_treatment', createdTreatment.ok && createdTreatment.body?.[0]?.id, `HTTP ${createdTreatment.status}`);
  const treatmentId = createdTreatment.body[0].id;

  const createdPayment = await req('/rest/v1/payments', {
    method: 'POST',
    headers: authHeaders(mgrToken, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      tenant_id: tenantA,
      branch_id: branchA,
      patient_id: patientId,
      treatment_id: treatmentId,
      amount: 2000000,
      payment_method: 'card',
      payment_date: '2026-11-25',
      status: 'completed',
    }),
  });
  assertCheck('manager_insert_payment', createdPayment.ok && createdPayment.body?.[0]?.id, `HTTP ${createdPayment.status}`);
  const paymentId = createdPayment.body[0].id;

  const mgrSummary = await req('/rest/v1/rpc/get_clinic_dashboard_summary', {
    method: 'POST',
    headers: authHeaders(mgrToken),
    body: JSON.stringify({
      p_tenant_id: tenantA,
      p_branch_id: branchA,
      p_today_iso: '2026-11-25',
      p_month_start: '2026-11-01',
      p_month_end: '2026-11-30',
    }),
  });
  assertCheck(
    'manager_dashboard_rpc',
    mgrSummary.ok && mgrSummary.body?.financial_data_complete === true && mgrSummary.body?.patients_total >= 1,
    `HTTP ${mgrSummary.status} ${JSON.stringify(mgrSummary.body)}`
  );

  // 2. Dentist role: clinical read/write allowed, billing/ledger/delete denied
  const denToken = users.dentist.token;
  const denInsertTreatment = await req('/rest/v1/treatments', {
    method: 'POST',
    headers: authHeaders(denToken, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      tenant_id: tenantA,
      branch_id: branchA,
      patient_id: patientId,
      status: 'planned',
      total_cost: 1000000,
    }),
  });
  assertCheck('dentist_insert_treatment_allowed', denInsertTreatment.ok && denInsertTreatment.body?.[0]?.id, `HTTP ${denInsertTreatment.status}`);
  const dentistTreatmentId = denInsertTreatment.body[0].id;

  const denDeletePatient = await req(`/rest/v1/patients?id=eq.${patientId}`, {
    method: 'DELETE',
    headers: authHeaders(denToken, { Prefer: 'return=representation' }),
  });
  assertCheck('dentist_delete_patient_denied', !denDeletePatient.ok || (Array.isArray(denDeletePatient.body) && denDeletePatient.body.length === 0), `unexpected delete ${JSON.stringify(denDeletePatient)}`);

  const denInsertPayment = await req('/rest/v1/payments', {
    method: 'POST',
    headers: authHeaders(denToken, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      tenant_id: tenantA,
      branch_id: branchA,
      patient_id: patientId,
      amount: 1000,
      payment_method: 'cash',
      payment_date: '2026-11-25',
      status: 'completed',
    }),
  });
  assertCheck('dentist_insert_payment_denied', !denInsertPayment.ok, `unexpected HTTP ${denInsertPayment.status}`);

  const denSummary = await req('/rest/v1/rpc/get_clinic_dashboard_summary', {
    method: 'POST',
    headers: authHeaders(denToken),
    body: JSON.stringify({
      p_tenant_id: tenantA,
      p_branch_id: branchA,
      p_today_iso: '2026-11-25',
      p_month_start: '2026-11-01',
      p_month_end: '2026-11-30',
    }),
  });
  assertCheck(
    'dentist_dashboard_hides_financials',
    denSummary.ok && denSummary.body?.financial_data_complete === false && denSummary.body?.month_collected === null,
    `HTTP ${denSummary.status} ${JSON.stringify(denSummary.body)}`
  );

  // 3. Secretary role: patients/billing insert allowed, treatments write & ledger denied
  const secToken = users.secretary.token;
  const secInsertTreatment = await req('/rest/v1/treatments', {
    method: 'POST',
    headers: authHeaders(secToken, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      tenant_id: tenantA,
      branch_id: branchA,
      patient_id: patientId,
      status: 'planned',
      total_cost: 500000,
    }),
  });
  assertCheck('secretary_insert_treatment_denied', !secInsertTreatment.ok, `unexpected HTTP ${secInsertTreatment.status}`);

  const secUpdatePayment = await req(`/rest/v1/payments?id=eq.${paymentId}`, {
    method: 'PATCH',
    headers: authHeaders(secToken, { Prefer: 'return=representation' }),
    body: JSON.stringify({ amount: 1 }),
  });
  assertCheck('secretary_update_payment_denied', !secUpdatePayment.ok || (Array.isArray(secUpdatePayment.body) && secUpdatePayment.body.length === 0), `unexpected HTTP ${secUpdatePayment.status}`);

  // 4. Assistant role: patient insert denied, payments select denied
  const asstToken = users.assistant.token;
  const asstInsertPatient = await req('/rest/v1/patients', {
    method: 'POST',
    headers: authHeaders(asstToken, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      tenant_id: tenantA,
      branch_id: branchA,
      first_name: 'Blocked',
      last_name: 'Assistant',
      gender: 'unknown',
      status: 'active',
    }),
  });
  assertCheck('assistant_insert_patient_denied', !asstInsertPatient.ok, `unexpected HTTP ${asstInsertPatient.status}`);

  const asstReadPayments = await req(`/rest/v1/payments?tenant_id=eq.${tenantA}`, {
    headers: authHeaders(asstToken),
  });
  assertCheck('assistant_read_payments_denied', !asstReadPayments.ok || (Array.isArray(asstReadPayments.body) && asstReadPayments.body.length === 0), `unexpected leak ${JSON.stringify(asstReadPayments)}`);

  // 5. Revoked membership (even with spoofed app_metadata.clinic_role='manager'): zero access
  const revToken = users.revoked.token;
  const revRoleRpc = await req('/rest/v1/rpc/app_resolve_verified_role', {
    method: 'POST',
    headers: authHeaders(revToken),
    body: JSON.stringify({ target_tenant: tenantA, target_branch: branchA }),
  });
  assertCheck('revoked_role_rpc_null', revRoleRpc.ok && revRoleRpc.body === null, `got ${JSON.stringify(revRoleRpc)}`);

  const revReadPatients = await req(`/rest/v1/patients?tenant_id=eq.${tenantA}`, {
    headers: authHeaders(revToken),
  });
  assertCheck('revoked_read_patients_empty', revReadPatients.ok && Array.isArray(revReadPatients.body) && revReadPatients.body.length === 0, `unexpected ${JSON.stringify(revReadPatients)}`);

  const revSummary = await req('/rest/v1/rpc/get_clinic_dashboard_summary', {
    method: 'POST',
    headers: authHeaders(revToken),
    body: JSON.stringify({
      p_tenant_id: tenantA,
      p_branch_id: branchA,
      p_today_iso: '2026-11-25',
      p_month_start: '2026-11-01',
      p_month_end: '2026-11-30',
    }),
  });
  assertCheck('revoked_dashboard_rpc_denied', !revSummary.ok, `unexpected HTTP ${revSummary.status}`);

  // 6. Cross-branch isolation (branchA dentist cannot read/write branchB)
  const crossBranchInsert = await req('/rest/v1/patients', {
    method: 'POST',
    headers: authHeaders(denToken, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      tenant_id: tenantA,
      branch_id: branchB,
      first_name: 'Cross',
      last_name: 'Branch',
      gender: 'unknown',
      status: 'active',
    }),
  });
  assertCheck('cross_branch_insert_denied', !crossBranchInsert.ok, `unexpected HTTP ${crossBranchInsert.status}`);

  // 7. Cross-tenant isolation (tenantB manager cannot read/write tenantA)
  const foreignToken = users.foreign.token;
  const crossTenantRead = await req(`/rest/v1/patients?tenant_id=eq.${tenantA}`, {
    headers: authHeaders(foreignToken),
  });
  assertCheck('cross_tenant_read_empty', crossTenantRead.ok && Array.isArray(crossTenantRead.body) && crossTenantRead.body.length === 0, `unexpected leak`);

  const crossTenantInsert = await req('/rest/v1/patients', {
    method: 'POST',
    headers: authHeaders(foreignToken, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      tenant_id: tenantA,
      branch_id: branchA,
      first_name: 'Cross',
      last_name: 'Tenant',
      gender: 'unknown',
      status: 'active',
    }),
  });
  assertCheck('cross_tenant_insert_denied', !crossTenantInsert.ok, `unexpected HTTP ${crossTenantInsert.status}`);

  // Manager cleanup of clinical test rows
  await req(`/rest/v1/payments?id=eq.${paymentId}`, { method: 'DELETE', headers: authHeaders(mgrToken) });
  await req(`/rest/v1/treatments?id=eq.${dentistTreatmentId}`, { method: 'DELETE', headers: authHeaders(mgrToken) });
  await req(`/rest/v1/treatments?id=eq.${treatmentId}`, { method: 'DELETE', headers: authHeaders(mgrToken) });
  await req(`/rest/v1/patients?id=eq.${patientId}`, { method: 'DELETE', headers: authHeaders(mgrToken) });

  return checks;
}

async function runWithEphemeralServiceFixtures() {
  const runId = crypto.randomBytes(4).toString('hex');
  const tenantA = `v12_test_a_${runId}`;
  const tenantB = `v12_test_b_${runId}`;
  const branchA = 'main';
  const branchB = 'north';
  const password = `V12!${crypto.randomBytes(12).toString('hex')}`;
  const createdUserIds = [];

  const adminHeaders = {
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  };

  async function createAuthUser(tag, appMetadata = {}) {
    const email = `v12.${tag}.${runId}@invalid.example`;
    const res = await req(
      '/auth/v1/admin/users',
      {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          app_metadata: appMetadata,
        }),
      },
      SERVICE_ROLE_KEY
    );
    if (!res.ok || !res.body?.id) {
      throw new Error(`Failed creating ephemeral user ${tag}: HTTP ${res.status}`);
    }
    createdUserIds.push(res.body.id);
    return { id: res.body.id, email };
  }

  try {
    for (const [id, name] of [[tenantA, 'V12 Test A'], [tenantB, 'V12 Test B']]) {
      const tRes = await req(
        '/rest/v1/clinic_tenants',
        { method: 'POST', headers: adminHeaders, body: JSON.stringify({ id, name }) },
        SERVICE_ROLE_KEY
      );
      if (!tRes.ok) throw new Error(`Failed creating test tenant ${id}: HTTP ${tRes.status}`);
    }

    for (const [tenant_id, id, name] of [
      [tenantA, branchA, 'Branch A'],
      [tenantA, branchB, 'Branch B'],
      [tenantB, branchA, 'Foreign Branch'],
    ]) {
      const bRes = await req(
        '/rest/v1/clinic_branches',
        { method: 'POST', headers: adminHeaders, body: JSON.stringify({ tenant_id, id, name }) },
        SERVICE_ROLE_KEY
      );
      if (!bRes.ok) throw new Error(`Failed creating test branch: HTTP ${bRes.status}`);
    }

    const uManager = await createAuthUser('mgr');
    const uDentist = await createAuthUser('den');
    const uSecretary = await createAuthUser('sec');
    const uAssistant = await createAuthUser('asst');
    const uRevoked = await createAuthUser('rev', { clinic_role: 'manager', tenant_id: tenantA });
    const uForeign = await createAuthUser('for');

    const memberships = [
      { user_id: uManager.id, tenant_id: tenantA, branch_id: branchA, role: 'manager', active: true, all_branches: true },
      { user_id: uDentist.id, tenant_id: tenantA, branch_id: branchA, role: 'dentist', active: true, all_branches: false },
      { user_id: uSecretary.id, tenant_id: tenantA, branch_id: branchA, role: 'secretary', active: true, all_branches: false },
      { user_id: uAssistant.id, tenant_id: tenantA, branch_id: branchA, role: 'assistant', active: true, all_branches: false },
      { user_id: uRevoked.id, tenant_id: tenantA, branch_id: branchA, role: 'manager', active: false, all_branches: false },
      { user_id: uForeign.id, tenant_id: tenantB, branch_id: branchA, role: 'manager', active: true, all_branches: true },
    ];
    const memRes = await req(
      '/rest/v1/clinic_memberships',
      { method: 'POST', headers: adminHeaders, body: JSON.stringify(memberships) },
      SERVICE_ROLE_KEY
    );
    if (!memRes.ok) throw new Error(`Failed creating test memberships: HTTP ${memRes.status}`);

    const users = {
      manager: await signInUser(uManager.email, password),
      dentist: await signInUser(uDentist.email, password),
      secretary: await signInUser(uSecretary.email, password),
      assistant: await signInUser(uAssistant.email, password),
      revoked: await signInUser(uRevoked.email, password),
      foreign: await signInUser(uForeign.email, password),
    };

    return await runRoleCrudAndRlsMatrix({ tenantA, tenantB, branchA, branchB, users });
  } finally {
    await req(`/rest/v1/payments?tenant_id=in.(${tenantA},${tenantB})`, { method: 'DELETE', headers: adminHeaders }, SERVICE_ROLE_KEY).catch(() => {});
    await req(`/rest/v1/treatments?tenant_id=in.(${tenantA},${tenantB})`, { method: 'DELETE', headers: adminHeaders }, SERVICE_ROLE_KEY).catch(() => {});
    await req(`/rest/v1/patients?tenant_id=in.(${tenantA},${tenantB})`, { method: 'DELETE', headers: adminHeaders }, SERVICE_ROLE_KEY).catch(() => {});
    await req(`/rest/v1/clinic_memberships?tenant_id=in.(${tenantA},${tenantB})`, { method: 'DELETE', headers: adminHeaders }, SERVICE_ROLE_KEY).catch(() => {});
    await req(`/rest/v1/clinic_branches?tenant_id=in.(${tenantA},${tenantB})`, { method: 'DELETE', headers: adminHeaders }, SERVICE_ROLE_KEY).catch(() => {});
    await req(`/rest/v1/clinic_tenants?id=in.(${tenantA},${tenantB})`, { method: 'DELETE', headers: adminHeaders }, SERVICE_ROLE_KEY).catch(() => {});
    for (const uid of createdUserIds) {
      await req(`/auth/v1/admin/users/${uid}`, { method: 'DELETE', headers: adminHeaders }, SERVICE_ROLE_KEY).catch(() => {});
    }
  }
}

async function main() {
  assertPublicConfig();

  const summary = {
    projectRef: EXPECTED_PROJECT_REF,
    url: SUPABASE_URL,
    authHealth: 'UNKNOWN',
    v12PublicTablesPresent: 0,
    v12AnonymousDeniedCount: 0,
    v12MissingTables: [],
    anonymousLeaks: [],
    anonymousRpcDenied: false,
    authenticatedCrudAndRls: 'SKIPPED_NO_AUTH_FIXTURES',
    rlsChecksPassed: [],
    hardFailures: [],
    blockers: [],
  };

  console.log(`\n=== MinaDental V12 Remote Supabase Verifier (${EXPECTED_PROJECT_REF}) ===`);

  const health = await req('/auth/v1/health');
  if (health.status === 200) {
    summary.authHealth = `PASS (HTTP 200, ${health.body?.version || 'GoTrue'})`;
  } else {
    summary.authHealth = `FAIL (HTTP ${health.status})`;
    summary.hardFailures.push(`Auth health failed: HTTP ${health.status}`);
  }

  for (const table of ALL_V12_PUBLIC_TABLES) {
    const r = await req(`/rest/v1/${table}?select=*&limit=1`);
    const code = typeof r.body === 'object' && r.body ? r.body.code : '';
    if (r.status === 404 && code === 'PGRST205') {
      summary.v12MissingTables.push(table);
    } else if (r.status === 401 || r.status === 403 || code === '42501') {
      summary.v12PublicTablesPresent += 1;
      summary.v12AnonymousDeniedCount += 1;
    } else if (r.status === 200 && Array.isArray(r.body) && r.body.length === 0) {
      summary.v12PublicTablesPresent += 1;
      summary.v12AnonymousDeniedCount += 1;
    } else if (r.status === 200 && Array.isArray(r.body) && r.body.length > 0) {
      summary.v12PublicTablesPresent += 1;
      summary.anonymousLeaks.push(table);
      summary.hardFailures.push(`SECURITY_FAILURE: anonymous SELECT leaked rows on ${table}`);
    } else {
      summary.hardFailures.push(`Unexpected probe response on ${table}: HTTP ${r.status}`);
    }
  }

  const dashAnon = await req('/rest/v1/rpc/get_clinic_dashboard_summary', {
    method: 'POST',
    body: JSON.stringify({
      p_tenant_id: 'probe',
      p_branch_id: 'main',
      p_today_iso: '2026-11-25',
      p_month_start: '2026-11-01',
      p_month_end: '2026-11-30',
    }),
  });
  const dashCode = typeof dashAnon.body === 'object' && dashAnon.body ? dashAnon.body.code : '';
  if (dashAnon.status === 401 || dashAnon.status === 403 || dashCode === '42501') {
    summary.anonymousRpcDenied = true;
  } else {
    summary.hardFailures.push(`SECURITY_FAILURE: anonymous get_clinic_dashboard_summary returned HTTP ${dashAnon.status}`);
  }

  if (summary.v12MissingTables.length > 0) {
    summary.blockers.push(`MISSING_V12_TABLES: ${summary.v12MissingTables.join(', ')}`);
  }

  if (SERVICE_ROLE_KEY) {
    summary.rlsChecksPassed = await runWithEphemeralServiceFixtures();
    summary.authenticatedCrudAndRls = `PASS (${summary.rlsChecksPassed.length} checks via ephemeral fixtures)`;
  } else if (
    process.env.V12_TEST_TENANT_A &&
    process.env.V12_TEST_TENANT_B &&
    process.env.V12_TEST_BRANCH_A &&
    process.env.V12_TEST_BRANCH_B &&
    process.env.V12_TEST_MANAGER_EMAIL &&
    process.env.V12_TEST_MANAGER_PASSWORD &&
    process.env.V12_TEST_DENTIST_EMAIL &&
    process.env.V12_TEST_DENTIST_PASSWORD &&
    process.env.V12_TEST_SECRETARY_EMAIL &&
    process.env.V12_TEST_SECRETARY_PASSWORD &&
    process.env.V12_TEST_ASSISTANT_EMAIL &&
    process.env.V12_TEST_ASSISTANT_PASSWORD &&
    process.env.V12_TEST_REVOKED_EMAIL &&
    process.env.V12_TEST_REVOKED_PASSWORD &&
    process.env.V12_TEST_FOREIGN_EMAIL &&
    process.env.V12_TEST_FOREIGN_PASSWORD
  ) {
    const users = {
      manager: await signInUser(process.env.V12_TEST_MANAGER_EMAIL, process.env.V12_TEST_MANAGER_PASSWORD),
      dentist: await signInUser(process.env.V12_TEST_DENTIST_EMAIL, process.env.V12_TEST_DENTIST_PASSWORD),
      secretary: await signInUser(process.env.V12_TEST_SECRETARY_EMAIL, process.env.V12_TEST_SECRETARY_PASSWORD),
      assistant: await signInUser(process.env.V12_TEST_ASSISTANT_EMAIL, process.env.V12_TEST_ASSISTANT_PASSWORD),
      revoked: await signInUser(process.env.V12_TEST_REVOKED_EMAIL, process.env.V12_TEST_REVOKED_PASSWORD),
      foreign: await signInUser(process.env.V12_TEST_FOREIGN_EMAIL, process.env.V12_TEST_FOREIGN_PASSWORD),
    };
    summary.rlsChecksPassed = await runRoleCrudAndRlsMatrix({
      tenantA: process.env.V12_TEST_TENANT_A.trim(),
      tenantB: process.env.V12_TEST_TENANT_B.trim(),
      branchA: process.env.V12_TEST_BRANCH_A.trim(),
      branchB: process.env.V12_TEST_BRANCH_B.trim(),
      users,
    });
    summary.authenticatedCrudAndRls = `PASS (${summary.rlsChecksPassed.length} checks via pre-provisioned fixtures)`;
  } else {
    summary.blockers.push(
      'AUTHENTICATED_CRUD_AND_RLS_PENDING: neither SUPABASE_SERVICE_ROLE_KEY nor isolated V12_TEST_* credentials are present in environment.'
    );
  }

  console.log(JSON.stringify(summary, null, 2));

  if (summary.hardFailures.length > 0) {
    process.exit(1);
  }
  if (process.argv.includes('--strict-authenticated') && summary.blockers.length > 0) {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error('✖ V12 Remote Verifier failed:', err?.message || err);
  process.exit(1);
});
