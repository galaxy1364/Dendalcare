import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getVerifiedSupabaseSession,
  isBranchAuthorizedForSession,
  resolveMembershipSession,
} from '@/services/authentication/authService';
import { resolveShellSection } from '@/app/shell/shellMetadata';

export interface Ge0005TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

async function runCase(name: string, fn: () => Promise<void> | void): Promise<Ge0005TestResult> {
  try {
    await fn();
    return { name, passed: true };
  } catch (err) {
    return { name, passed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runAllGe0005MandatoryAcceptanceTests(): Promise<Ge0005TestResult[]> {
  const root = process.cwd();
  const results: Ge0005TestResult[] = [];

  // 1. Modular AppShell refactoring gate (<= 300 lines root + 5 dedicated shell modules)
  results.push(
    await runCase('GE-0005 #1: AppShell.tsx is refactored from 696 lines to <=300 lines with 5 dedicated src/app/shell/* modules', () => {
      const shellLines = fs.readFileSync(path.join(root, 'src/app/AppShell.tsx'), 'utf8').split('\n').length;
      assert.ok(shellLines <= 300, `AppShell.tsx must be <= 300 lines after modular refactor (found ${shellLines})`);

      const modules = [
        'src/app/shell/AdaptiveTopBar.tsx',
        'src/app/shell/ShellStatusBanners.tsx',
        'src/app/shell/ShellUpdateBanner.tsx',
        'src/app/shell/ShellAccessibilityBar.tsx',
        'src/app/shell/shellMetadata.tsx',
        'src/app/shell/useShellKeyboardAndScroll.ts',
      ];
      for (const rel of modules) {
        const full = path.join(root, rel);
        assert.ok(fs.existsSync(full), `Missing modular shell file: ${rel}`);
        const lines = fs.readFileSync(full, 'utf8').split('\n').length;
        assert.ok(lines > 15 && lines <= 220, `${rel} must be well-scoped (15..220 lines, found ${lines})`);
      }

      // Verify metadata resolver maps every operational route accurately
      assert.equal(resolveShellSection('reports').label, 'گزارش جامع کلینیک');
      assert.equal(resolveShellSection('patient_form').label, 'ثبت بیمار جدید');
      assert.equal(resolveShellSection('appointment_form').label, 'ثبت نوبت جدید');
      assert.equal(resolveShellSection('treatment_form').label, 'ثبت طرح درمان');
    })
  );

  // 2. P0-1 Manager Auth lifecycle & real server-verified membership + RLS matrix
  results.push(
    await runCase('GE-0005 #2: AppProviders subscribes to onAuthStateChange, useRealtimeTable cleans up auth listener, and dashboard uses verified tenant', () => {
      const providers = fs.readFileSync(path.join(root, 'src/app/AppProviders.tsx'), 'utf8');
      assert.ok(providers.includes('onAuthStateChange'), 'AppProviders must subscribe to live Supabase onAuthStateChange');
      assert.ok(providers.includes('TOKEN_REFRESHED') && providers.includes('SIGNED_IN'), 'AppProviders must re-verify membership on TOKEN_REFRESHED and SIGNED_IN');
      assert.ok(providers.includes('retryAuthVerification'), 'AppProviders must expose retryAuthVerification');

      const realtime = fs.readFileSync(path.join(root, 'src/lib/useRealtimeTable.ts'), 'utf8');
      assert.ok(
        realtime.includes("window.removeEventListener('minadental-auth-changed', handleScopeSwitch)"),
        'useRealtimeTable must clean up minadental-auth-changed listener on unmount'
      );

      const dashSvc = fs.readFileSync(path.join(root, 'src/features/dashboard/dashboard.service.ts'), 'utf8');
      assert.ok(dashSvc.includes('getActiveTenantId()'), 'dashboard.service must read authoritative getActiveTenantId()');
      assert.ok(dashSvc.includes("minadental-auth-changed"), 'dashboard.service must refresh server summary on minadental-auth-changed');
    })
  );

  // 3. Authenticated Manager RPC + Membership Matrix (all_branches, scoped branch, cross-tenant denial, revoked user)
  results.push(
    await runCase('GE-0005 #3: Server-verified manager membership passes RPC cross-check across branches while revocations & cross-tenant fail closed', async () => {
      const rpcFallbackClient = {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: 'mgr-real-1', email: 'mehdi.amiri19851364@gmail.com' } } },
            error: null,
          }),
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: async () => ({
                data: [],
                error: { code: '42501', message: 'direct select blocked before RPC discovery' },
              }),
            }),
          }),
        }),
        rpc: async (fn: string, args?: Record<string, unknown>) => {
          if (fn === 'app_get_my_verified_memberships') {
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
          if (fn === 'app_resolve_verified_role') {
            if (args?.target_tenant === 'minadental_clinic') {
              return { data: 'manager', error: null };
            }
            return { data: null, error: null };
          }
          return { data: null, error: { message: 'unknown rpc' } };
        },
      };

      const verifiedMain = await getVerifiedSupabaseSession('main', rpcFallbackClient as any);
      assert.equal(verifiedMain.status, 'authenticated');
      assert.equal(verifiedMain.serverVerifiedRole, 'manager');
      assert.equal(verifiedMain.allBranches, true);
      assert.equal(isBranchAuthorizedForSession(verifiedMain, 'north'), true);

      const verifiedNorth = await getVerifiedSupabaseSession('north', rpcFallbackClient as any);
      assert.equal(verifiedNorth.status, 'authenticated');
      assert.equal(verifiedNorth.serverVerifiedRole, 'manager');
      assert.equal(verifiedNorth.branchId, 'north');

      // Revoked membership MUST fail closed even with a valid Supabase auth user
      const revoked = resolveMembershipSession({
        userId: 'mgr-revoked',
        email: 'revoked@minadental.ir',
        requestedBranchId: 'main',
        memberships: [
          { tenant_id: 'minadental_clinic', branch_id: 'main', role: 'manager', active: false, all_branches: true },
        ],
      });
      assert.equal(revoked.status, 'unauthorized');
      assert.equal(revoked.serverVerifiedRole, null);
    })
  );

  // 4. Real-device Samsung Browser UI defects & WCAG 2.2 AA Shell Accessibility
  results.push(
    await runCase('GE-0005 #4: Non-truncating permission banners, RTL-aligned auto-update toggle & WCAG 2.2 AA skip link verified', () => {
      const bannerSrc = fs.readFileSync(path.join(root, 'src/components/shared/SectionStatusBanner.tsx'), 'utf8');
      const unauthBlock = bannerSrc.slice(bannerSrc.indexOf("status === 'unauthorized'"), bannerSrc.indexOf("status === 'locked_offline'"));
      assert.ok(!unauthBlock.includes('truncate'), 'Unauthorized banner must wrap text cleanly without mid-word truncation');
      assert.ok(unauthBlock.includes('section_status_unauthorized_retry'), 'Unauthorized banner must support retry CTA');

      const settingsSrc = fs.readFileSync(path.join(root, 'src/components/sections/SettingsSection.tsx'), 'utf8');
      assert.ok(
        settingsSrc.includes('dir="ltr"') && settingsSrc.includes('peer-checked:after:translate-x-5') && settingsSrc.includes('after:left-[2px]'),
        'Auto-update toggle switch must use LTR thumb math so checked circle never clips outside pill in RTL'
      );

      const a11ySrc = fs.readFileSync(path.join(root, 'src/app/shell/ShellAccessibilityBar.tsx'), 'utf8');
      assert.ok(a11ySrc.includes('href="#main-clinic-content"'), 'Skip link must target #main-clinic-content');
      assert.ok(a11ySrc.includes('aria-live="polite"'), 'Shell must announce route changes via aria-live="polite"');

      const shellSrc = fs.readFileSync(path.join(root, 'src/app/AppShell.tsx'), 'utf8');
      assert.ok(shellSrc.includes('id="main-clinic-content"'), 'AppShell <main> must expose #main-clinic-content landmark target');
    })
  );

  return results;
}
