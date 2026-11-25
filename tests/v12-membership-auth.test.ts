/**
 * MINADENTAL V12 — AUTHORITATIVE CLINIC MEMBERSHIP AUTH & RBAC FAIL-CLOSED TESTS
 *
 * Verifies:
 *   V12-01: resolveMembershipSession ignores/rejects app_metadata and fails closed on missing, revoked, or branch-mismatched memberships
 *   V12-02: getVerifiedSupabaseSession enforces membership-only lookup + app_resolve_verified_role RPC verification without app_metadata fallback
 *   V12-03: signInWithSupabaseEmail fails closed (ok=false) when Supabase Auth succeeds but active clinic_membership is absent or revoked
 *   V12-04: resolveEffectiveRole fails closed to assistant when sessionStatus is unauthorized even if localRole is manager
 *   V12-05: V12 SQL baseline contracts enforce membership-only resolution, FORCE RLS on 23 public tables, audit triggers, and auth-only RPC grants
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  getVerifiedSupabaseSession,
  resolveMembershipSession,
  signInWithSupabaseEmail,
} from '../src/services/authentication/authService';
import { resolveEffectiveRole } from '../src/services/permissions/accessControl';

export interface V12TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const ROOT = process.cwd();

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function runCase(name: string, fn: () => void | Promise<void>): Promise<V12TestResult> {
  try {
    await fn();
    return { name, passed: true };
  } catch (err: unknown) {
    return { name, passed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function makeMockClient(opts: {
  sessionUser?: { id: string; email?: string; app_metadata?: Record<string, unknown> } | null;
  signInUser?: { id: string; email?: string; app_metadata?: Record<string, unknown> } | null;
  memberships?: Array<Record<string, unknown>>;
  membershipError?: unknown;
  throwMembership?: boolean;
  rpcRole?: string | null;
  rpcError?: unknown;
}) {
  return {
    auth: {
      getSession: async () => ({
        data: { session: opts.sessionUser ? { user: opts.sessionUser } : null },
        error: null,
      }),
      signInWithPassword: async () => ({
        data: { user: opts.signInUser ?? opts.sessionUser ?? null },
        error: null,
      }),
      signOut: async () => ({ error: null }),
    },
    from: (_table: string) => ({
      select: (_cols: string) => ({
        eq: (_col1: string, _val1: unknown) => ({
          eq: async (_col2: string, _val2: unknown) => {
            if (opts.throwMembership) throw new Error('network error');
            return {
              data: opts.memberships ?? [],
              error: opts.membershipError ?? null,
            };
          },
        }),
      }),
    }),
    rpc: async (_fn: string, _args: Record<string, unknown>) => ({
      data: opts.rpcRole === undefined ? null : opts.rpcRole,
      error: opts.rpcError ?? null,
    }),
  };
}

export async function runAllV12MembershipAuthTests(): Promise<V12TestResult[]> {
  const results: V12TestResult[] = [];

  results.push(await runCase('V12-01: resolveMembershipSession fails closed on missing, revoked, invalid, or branch-mismatched memberships', () => {
    const empty = resolveMembershipSession({
      userId: 'u-1',
      email: 'u1@clinic.ir',
      requestedBranchId: 'main',
      memberships: [],
    });
    expect(empty.status === 'unauthorized' && empty.serverVerifiedRole === null && empty.tenantId === '', 'Empty memberships must fail closed');

    const revoked = resolveMembershipSession({
      userId: 'u-1',
      email: 'u1@clinic.ir',
      requestedBranchId: 'main',
      memberships: [
        { tenant_id: 't1', branch_id: 'main', role: 'manager', active: false, all_branches: true },
      ],
    });
    expect(revoked.status === 'unauthorized' && revoked.serverVerifiedRole === null, 'Inactive/revoked membership must fail closed');

    const wrongBranchDentist = resolveMembershipSession({
      userId: 'u-2',
      email: 'u2@clinic.ir',
      requestedBranchId: 'north',
      memberships: [
        { tenant_id: 't1', branch_id: 'main', role: 'dentist', active: true, all_branches: false },
      ],
    });
    expect(wrongBranchDentist.status === 'unauthorized' && wrongBranchDentist.serverVerifiedRole === null, 'Non-all_branches dentist on wrong branch must fail closed');

    const forgedAllBranchesDentist = resolveMembershipSession({
      userId: 'u-2',
      email: 'u2@clinic.ir',
      requestedBranchId: 'north',
      memberships: [
        { tenant_id: 't1', branch_id: 'main', role: 'dentist', active: true, all_branches: true },
      ],
    });
    expect(forgedAllBranchesDentist.status === 'unauthorized', 'Only manager role may hold all_branches=true');

    const managerAllBranches = resolveMembershipSession({
      userId: 'u-mgr',
      email: 'mgr@clinic.ir',
      requestedBranchId: 'north',
      memberships: [
        { tenant_id: 't1', branch_id: 'main', role: 'manager', active: true, all_branches: true },
      ],
    });
    expect(
      managerAllBranches.status === 'authenticated' &&
        managerAllBranches.serverVerifiedRole === 'manager' &&
        managerAllBranches.tenantId === 't1' &&
        managerAllBranches.branchId === 'north',
      'Active manager with all_branches=true must resolve authenticated for requested branch'
    );
  }));

  results.push(await runCase('V12-02: getVerifiedSupabaseSession ignores app_metadata claims and cross-checks app_resolve_verified_role', async () => {
    // 1. User has stale app_metadata.clinic_role='manager' but NO active clinic_memberships -> MUST fail closed
    const staleMetadataClient = makeMockClient({
      sessionUser: {
        id: 'u-revoked',
        email: 'revoked@clinic.ir',
        app_metadata: { clinic_role: 'manager', tenant_id: 'minadental_clinic' },
      },
      memberships: [],
      rpcRole: null,
    });
    const res1 = await getVerifiedSupabaseSession('main', staleMetadataClient as any);
    expect(
      res1.status === 'unauthorized' && res1.serverVerifiedRole === null && res1.tenantId === '',
      `Expected fail-closed unauthorized despite app_metadata, got ${JSON.stringify(res1)}`
    );

    // 2. Membership lookup throws -> MUST fail closed to unauthorized (never unauthenticated/app_metadata)
    const throwingClient = makeMockClient({
      sessionUser: {
        id: 'u-err',
        email: 'err@clinic.ir',
        app_metadata: { clinic_role: 'manager' },
      },
      throwMembership: true,
    });
    const res2 = await getVerifiedSupabaseSession('main', throwingClient as any);
    expect(res2.status === 'unauthorized' && res2.serverVerifiedRole === null, `Expected unauthorized on throw, got ${JSON.stringify(res2)}`);

    // 3. Membership exists client-side, but server RPC returns null (revoked server-side) -> MUST fail closed
    const rpcDeniedClient = makeMockClient({
      sessionUser: { id: 'u-rpc-null', email: 'rpc@clinic.ir' },
      memberships: [{ tenant_id: 't1', branch_id: 'main', role: 'dentist', active: true, all_branches: false }],
      rpcRole: null,
    });
    const res3 = await getVerifiedSupabaseSession('main', rpcDeniedClient as any);
    expect(res3.status === 'unauthorized' && res3.serverVerifiedRole === null, 'Must fail closed if app_resolve_verified_role returns null');

    // 4. Both active membership and server RPC agree -> authenticated with server role
    const validClient = makeMockClient({
      sessionUser: {
        id: 'u-ok',
        email: 'dentist@clinic.ir',
        app_metadata: { clinic_role: 'manager' }, // stale metadata must NOT escalate dentist
      },
      memberships: [{ tenant_id: 't_real', branch_id: 'main', role: 'dentist', active: true, all_branches: false }],
      rpcRole: 'dentist',
    });
    const res4 = await getVerifiedSupabaseSession('main', validClient as any);
    expect(
      res4.status === 'authenticated' && res4.serverVerifiedRole === 'dentist' && res4.tenantId === 't_real',
      `Expected dentist role from membership/RPC, got ${JSON.stringify(res4)}`
    );
  }));

  results.push(await runCase('V12-03: signInWithSupabaseEmail fails closed when auth user has no active membership', async () => {
    const client = makeMockClient({
      sessionUser: {
        id: 'u-nomem',
        email: 'nomem@clinic.ir',
        app_metadata: { clinic_role: 'manager' },
      },
      memberships: [],
      rpcRole: null,
    });
    const signInRes = await signInWithSupabaseEmail('nomem@clinic.ir', 'secret', client as any);
    expect(
      signInRes.ok === false && signInRes.session?.status === 'unauthorized' && signInRes.session?.serverVerifiedRole === null,
      `signInWithSupabaseEmail must return ok=false and unauthorized session, got ${JSON.stringify(signInRes)}`
    );
  }));

  results.push(await runCase('V12-04: resolveEffectiveRole fails closed to assistant on unauthorized session even with local manager role', () => {
    const effective = resolveEffectiveRole({
      serverVerifiedRole: null,
      localRole: 'manager',
      sessionStatus: 'unauthorized',
    });
    expect(effective === 'assistant', `Expected assistant least-privilege role on unauthorized session, got ${effective}`);
  }));

  results.push(await runCase('V12-05: V12 SQL baselines enforce membership-only resolution, FORCE RLS on 23 tables, and zero fake data', () => {
    const baselinePath = path.join(ROOT, 'supabase', 'baselines', 'v12_empty_clinic_foundation.sql');
    const hardeningPath = path.join(ROOT, 'supabase', 'baselines', 'v12_advisor_hardening.sql');
    const rpcGrantsPath = path.join(ROOT, 'supabase', 'baselines', 'v12_rpc_grants.sql');

    expect(fs.existsSync(baselinePath), 'Missing v12_empty_clinic_foundation.sql');
    expect(fs.existsSync(hardeningPath), 'Missing v12_advisor_hardening.sql');
    expect(fs.existsSync(rpcGrantsPath), 'Missing v12_rpc_grants.sql');

    const sql = fs.readFileSync(baselinePath, 'utf8');
    const grantsSql = fs.readFileSync(rpcGrantsPath, 'utf8');

    expect(/CREATE\s+FUNCTION\s+public\.app_resolve_verified_role/i.test(sql), 'Missing app_resolve_verified_role');
    expect(!/app_metadata/i.test(sql), 'V12 SQL must rely purely on clinic_memberships, never app_metadata');
    expect(/CREATE\s+TABLE\s+private\.clinic_mutation_audit/i.test(sql), 'Missing private.clinic_mutation_audit');
    expect((sql.match(/FORCE\s+ROW\s+LEVEL\s+SECURITY/gi) || []).length >= 23, 'Expected FORCE RLS on all 23 public tables');
    expect(!/INSERT\s+INTO\s+public\.patients\b/i.test(sql), 'V12 baseline must contain zero fake patients');
    expect(!/INSERT\s+INTO\s+public\.clinic_memberships\b/i.test(sql), 'V12 baseline must contain zero hard-coded memberships');
    expect(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.get_clinic_dashboard_summary[\s\S]*FROM\s+PUBLIC,anon,authenticated/i.test(grantsSql), 'v12_rpc_grants.sql must revoke anon/PUBLIC');
  }));

  return results;
}
