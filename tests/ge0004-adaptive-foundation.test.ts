import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getVerifiedSupabaseSession,
  isBranchAuthorizedForSession,
  resolveMembershipSession,
} from '@/services/authentication/authService';
import { CURRENT_APP_BUILD, CURRENT_APP_VERSION } from '@/lib/cloudSyncEngine';
import { NativePlatformUpdateAdapter } from '@/services/updates/adapters/nativePlatformAdapter';
import { UpdateCoordinator } from '@/services/updates/coordinator';
import { resolveSurfaceTokens } from '@/design-system/tokens/surfaces';

export interface Ge0004TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

async function runCase(name: string, fn: () => void | Promise<void>): Promise<Ge0004TestResult> {
  try {
    await fn();
    return { name, passed: true };
  } catch (err) {
    return {
      name,
      passed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runAllGe0004AdaptiveFoundationTests(): Promise<Ge0004TestResult[]> {
  const results: Ge0004TestResult[] = [];
  const root = process.cwd();

  // 1. P0-1: Real Manager Authorization (all_branches vs branch-scoped vs unauthorized) & RPC fallback
  results.push(
    await runCase('GE-0004 P0-1: all_branches manager accesses every tenant branch; branch-scoped manager stays isolated', async () => {
      const allBranchSession = resolveMembershipSession({
        userId: 'mgr-all-1',
        email: 'manager@minadental.ir',
        requestedBranchId: 'north',
        memberships: [
          {
            tenant_id: 'minadental_clinic',
            branch_id: 'main',
            role: 'manager',
            active: true,
            all_branches: true,
          },
        ],
      });
      assert.equal(allBranchSession.status, 'authenticated');
      assert.equal(allBranchSession.serverVerifiedRole, 'manager');
      assert.equal(allBranchSession.allBranches, true);
      assert.equal(isBranchAuthorizedForSession(allBranchSession, 'main'), true);
      assert.equal(isBranchAuthorizedForSession(allBranchSession, 'north'), true);

      const singleBranchSession = resolveMembershipSession({
        userId: 'mgr-main-only',
        email: 'branchmgr@minadental.ir',
        requestedBranchId: 'main',
        memberships: [
          {
            tenant_id: 'minadental_clinic',
            branch_id: 'main',
            role: 'manager',
            active: true,
            all_branches: false,
          },
        ],
      });
      assert.equal(singleBranchSession.status, 'authenticated');
      assert.equal(singleBranchSession.allBranches, false);
      assert.equal(isBranchAuthorizedForSession(singleBranchSession, 'main'), true);
      assert.equal(isBranchAuthorizedForSession(singleBranchSession, 'north'), false);

      const crossBranchDenied = resolveMembershipSession({
        userId: 'mgr-main-only',
        email: 'branchmgr@minadental.ir',
        requestedBranchId: 'north',
        memberships: [
          {
            tenant_id: 'minadental_clinic',
            branch_id: 'main',
            role: 'manager',
            active: true,
            all_branches: false,
          },
        ],
      });
      assert.equal(crossBranchDenied.status, 'unauthorized');
      assert.equal(crossBranchDenied.serverVerifiedRole, null);

      // Verify recursion-safe RPC fallback (`app_get_my_verified_memberships`) recovers real manager without bypassing auth
      const fakeClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: 'mgr-rpc-1', email: 'dr.amiri@minadental.ir' } } },
            error: null,
          }),
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: [], error: { message: 'direct select blocked' } }),
            }),
          }),
        }),
        rpc: async (fnName: string, args?: Record<string, unknown>) => {
          if (fnName === 'app_get_my_verified_memberships') {
            return {
              data: [
                {
                  tenant_id: 'minadental_clinic',
                  branch_id: 'main',
                  role: 'manager',
                  active: true,
                  all_branches: true,
                },
              ],
              error: null,
            };
          }
          if (fnName === 'app_resolve_verified_role') {
            assert.equal(args?.target_tenant, 'minadental_clinic');
            assert.equal(args?.target_branch, 'north');
            return { data: 'manager', error: null };
          }
          return { data: null, error: { message: 'unknown rpc' } };
        },
      };
      const verifiedViaRpc = await getVerifiedSupabaseSession('north', fakeClient as never);
      assert.equal(verifiedViaRpc.status, 'authenticated');
      assert.equal(verifiedViaRpc.serverVerifiedRole, 'manager');
      assert.equal(verifiedViaRpc.tenantId, 'minadental_clinic');
      assert.equal(verifiedViaRpc.branchId, 'north');
      assert.equal(verifiedViaRpc.allBranches, true);
    })
  );

  // 2. P0-1: Additive SQL migration enforces membership-only RLS & zero JWT fallback
  results.push(
    await runCase('GE-0004 P0-1: GE-0004 SQL migration removes JWT fallback and defines app_get_my_verified_memberships', () => {
      const sqlPath = path.join(
        root,
        'supabase',
        'migrations',
        '20261202000000_ge0004_manager_auth_membership_rls_recovery.sql'
      );
      assert.ok(fs.existsSync(sqlPath), 'GE-0004 additive migration must exist');
      const sql = fs.readFileSync(sqlPath, 'utf8');
      assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.app_resolve_verified_role'), 'Must redefine app_resolve_verified_role');
      assert.ok(sql.includes('COALESCE(cm.all_branches, false) = true'), 'Must enforce all_branches strictly for managers');
      assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.app_get_my_verified_memberships'), 'Must provide deterministic membership RPC');
      assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.app_get_my_verified_memberships() FROM PUBLIC, anon'), 'Must revoke anon/PUBLIC execute');
      assert.ok(!sql.includes('app_jwt_tenant_id()'), 'Must not reintroduce JWT app_metadata fallback');
      assert.ok(!sql.includes('app_jwt_branch_id()'), 'Must not reintroduce JWT branch fallback');
    })
  );

  // 3. P0-2: Monotonic sequence reconciliation (> 166 -> 167, v4.17.0) across all config files
  results.push(
    await runCase('GE-0004 P0-2: Sequence reconciled monotonically past live #166 to #167 (v4.17.0) across repo & workflows', () => {
      assert.ok(CURRENT_APP_BUILD > 166, `CURRENT_APP_BUILD (${CURRENT_APP_BUILD}) must be strictly > 166`);
      assert.equal(CURRENT_APP_BUILD, 167);
      assert.equal(CURRENT_APP_VERSION, '4.17.0');

      const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      assert.equal(pkg.version, '4.17.0');

      const pubVer = JSON.parse(fs.readFileSync(path.join(root, 'public', 'version.json'), 'utf8'));
      assert.equal(pubVer.semver, '4.17.0');
      assert.equal(pubVer.releaseSequence, 167);

      const gradle = fs.readFileSync(path.join(root, 'app', 'build.gradle.kts'), 'utf8');
      assert.ok(gradle.includes('versionCode = 167'), 'Android versionCode must be 167');
      assert.ok(gradle.includes('versionName = "4.17.0"'), 'Android versionName must be 4.17.0');

      const deployYml = fs.readFileSync(path.join(root, '.github', 'workflows', 'deploy.yml'), 'utf8');
      const releaseYml = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
      assert.ok(deployYml.includes("MINA_BASE_SEQUENCE: '167'"), 'deploy.yml must reconcile base sequence to 167');
      assert.ok(releaseYml.includes("MINA_BASE_SEQUENCE: '167'"), 'release.yml must reconcile base sequence to 167');
    })
  );

  // 4. P0-2: Clean 3-way version separation (installedWeb vs availableRelease vs nativePackage)
  results.push(
    await runCase('GE-0004 P0-2: UpdateCoordinator & NativePlatformUpdateAdapter strictly separate web, server, and native versions', () => {
      const adapter = new NativePlatformUpdateAdapter('android', {
        packageName: 'com.aistudio.auditpro.kxmfzq',
        versionName: '4.17.0-native',
        versionCode: 205,
        bundledWebView: true,
      });
      const runtime = adapter.getCurrentRuntimeIdentity();
      // Native versionCode (205) MUST NOT overwrite web releaseSequence (167)
      assert.equal(runtime.releaseSequence, CURRENT_APP_BUILD);
      assert.equal(runtime.nativeVersion, '4.17.0-native');

      const coordinator = new UpdateCoordinator({ adapter, storage: null });
      const snap = coordinator.getSnapshot();
      assert.ok(snap.versionReport, 'UpdateSnapshot must expose versionReport');
      assert.equal(snap.versionReport.installedWeb.releaseSequence, CURRENT_APP_BUILD);
      assert.equal(snap.versionReport.availableRelease, null);
      assert.equal(snap.versionReport.nativePackage.present, true);
      assert.equal(snap.versionReport.nativePackage.channel, 'android_apk');
      assert.equal(snap.versionReport.nativePackage.versionCode, 205);
      assert.equal(snap.versionReport.nativePackage.versionName, '4.17.0-native');
    })
  );

  // 5. P1: Semantic layered surface tokens, 200% text scaling, Bento Grid & Progressive Disclosure
  results.push(
    await runCase('GE-0004 P1: Semantic surfaces (Liquid Glass/M3/Fluent), 200% scaling, Bento Grid, and Progressive Disclosure verified', () => {
      for (const design of ['apple', 'material', 'fluent'] as const) {
        for (const theme of ['light', 'dark'] as const) {
          const tok = resolveSurfaceTokens(design, theme);
          assert.ok(tok.glassBg && tok.glassBorder && tok.specularHighlight && tok.blurRadius);
        }
      }
      const appearanceSrc = fs.readFileSync(path.join(root, 'src', 'design-system', 'themes', 'appearance.ts'), 'utf8');
      assert.ok(appearanceSrc.includes("double: '32px'"), 'appearance.ts must define 200% (32px) font scaling');
      assert.ok(appearanceSrc.includes('data-text-scale-200'), 'appearance.ts must apply data-text-scale-200 attribute');

      const dashSrc = fs.readFileSync(path.join(root, 'src', 'features', 'dashboard', 'DashboardPage.tsx'), 'utf8');
      assert.ok(dashSrc.includes('dashboard_adaptive_bento_grid'), 'DashboardPage must implement responsive Bento Grid');

      const settingsSrc = fs.readFileSync(path.join(root, 'src', 'components', 'sections', 'SettingsSection.tsx'), 'utf8');
      assert.ok(settingsSrc.includes('settings_version_separation_card'), 'SettingsSection must display 3-way version separation');
      assert.ok(settingsSrc.includes('settings_technical_disclosure_toggle'), 'SettingsSection must apply Progressive Disclosure for technical controls');
      assert.ok(
        settingsSrc.includes("id: 'double'") && settingsSrc.includes('appearance_font_${id}'),
        'SettingsSection must offer 200% text scaling control'
      );
    })
  );

  return results;
}
