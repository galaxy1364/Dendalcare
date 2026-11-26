import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  GITHUB_ANDROID_RELEASE_PAGE,
  isValidApkMagicBytes,
} from '../src/lib/downloadHelper';

export interface Ge0007TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

function readWorkspaceFile(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

export async function runAllGe0007UniversalInstallTests(): Promise<Ge0007TestResult[]> {
  const tests: Array<{ name: string; fn: () => Promise<void> | void }> = [
    {
      name: 'GE-0007 P0-PWA: dist/index.html links root ./manifest.json (never Vite-hashed /assets/manifest-*.json) with valid 192 & 512 PNG icons',
      fn: () => {
        const distIndex = readWorkspaceFile('dist/index.html');
        const linkMatch = distIndex.match(/<link\b[^>]*rel=["']manifest["'][^>]*>/i);
        assert.ok(linkMatch, 'dist/index.html must include <link rel="manifest">');
        assert.ok(
          /href=["']\.\/manifest\.json["']/.test(linkMatch[0]),
          `dist/index.html manifest link must point to ./manifest.json, got: ${linkMatch[0]}`
        );
        assert.ok(
          !/crossorigin=["']use-credentials["']/i.test(linkMatch[0]),
          'manifest link must not force use-credentials on static GitHub Pages host'
        );

        const distAssetsDir = path.resolve(process.cwd(), 'dist/assets');
        if (fs.existsSync(distAssetsDir)) {
          const hashedManifests = fs
            .readdirSync(distAssetsDir)
            .filter((f) => /^manifest-.*\.json$/i.test(f));
          assert.equal(hashedManifests.length, 0, `Stray Vite-hashed manifest in dist/assets/: ${hashedManifests.join(', ')}`);
        }

        const manifest = JSON.parse(readWorkspaceFile('dist/manifest.json'));
        assert.equal(manifest.scope, './');
        assert.equal(manifest.start_url, './');
        assert.equal(manifest.display, 'standalone');
        assert.ok(typeof manifest.id === 'string' && manifest.id.length > 0);

        for (const [iconRel, expectedDim] of [
          ['icon-192.png', '192x192'],
          ['icon-512.png', '512x512'],
        ]) {
          const buf = fs.readFileSync(path.resolve(process.cwd(), 'dist', iconRel));
          assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${iconRel} must be valid PNG`);
          const dim = `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
          assert.equal(dim, expectedDim, `${iconRel} IHDR mismatch`);
        }
      },
    },
    {
      name: 'GE-0007 P0-APK: android-apk.yml builds, signs, verifies with apksigner & publishes to GitHub Releases android-latest',
      fn: () => {
        const wf = readWorkspaceFile('.github/workflows/android-apk.yml');
        assert.ok(wf.includes('gradle ${{ steps.sign_mode.outputs.gradle_task }}'), 'Workflow must assemble APK via Gradle');
        assert.ok(wf.includes('apksigner'), 'Workflow must verify APK signature via apksigner');
        assert.ok(wf.includes('sha256sum'), 'Workflow must compute exact APK SHA-256');
        assert.ok(wf.includes('504b0304'), 'Workflow must verify PK\\x03\\x04 ZIP/APK header');
        assert.ok(wf.includes('gh release upload android-latest') || wf.includes('gh release create android-latest'), 'Workflow must publish to android-latest GitHub Release');
        assert.ok(wf.includes('apk-release.json'), 'Workflow must emit machine-readable apk-release.json');
      },
    },
    {
      name: 'GE-0007 P0-APK: downloadHelper verifies PK\\x03\\x04 magic bytes, rejects HTML 404, and targets GitHub Releases android-latest',
      fn: () => {
        assert.equal(GITHUB_ANDROID_RELEASE_PAGE, 'https://github.com/galaxy1364/Dendalcare/releases/tag/android-latest');
        assert.equal(isValidApkMagicBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])), true);
        assert.equal(isValidApkMagicBytes(new Uint8Array([0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54])), false); // <!DOCT (HTML)
        assert.equal(isValidApkMagicBytes(new Uint8Array([0x50, 0x4b])), false);

        const helperSrc = readWorkspaceFile('src/lib/downloadHelper.ts');
        assert.ok(helperSrc.includes("contentType.includes('text/html')"), 'downloadHelper must reject HTML responses');
        assert.ok(helperSrc.includes('isValidApkMagicBytes'), 'downloadHelper must verify APK magic bytes');
      },
    },
    {
      name: 'GE-0007 P0-DATABASE: SQL migration revokes anon, restores authenticated DML grants with FORCE RLS & adds app_diagnose_my_db_access()',
      fn: () => {
        const sql = readWorkspaceFile('supabase/migrations/20261203000000_ge0007_authenticated_grants_and_rls_audit.sql');
        assert.ok(sql.includes('REVOKE ALL ON SCHEMA public FROM anon'), 'Migration must keep anon revoked');
        assert.ok(sql.includes('GRANT USAGE ON SCHEMA public TO authenticated'), 'Migration must grant schema usage to authenticated');
        assert.ok(sql.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated'), 'Migration must grant table DML to authenticated');
        assert.ok(sql.includes('FORCE ROW LEVEL SECURITY'), 'Migration must enforce FORCE ROW LEVEL SECURITY');
        assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.app_diagnose_my_db_access()'), 'Migration must define authenticated diagnostics function');
        assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.app_diagnose_my_db_access() FROM PUBLIC, anon'), 'Diagnostics RPC must never be granted to anon');

        const bannerSrc = readWorkspaceFile('src/components/shared/SectionStatusBanner.tsx');
        assert.ok(bannerSrc.includes('section_status_open_auth_btn'), 'SectionStatusBanner must provide 1-click sign-in CTA on 42501 unauthorized error');
      },
    },
    {
      name: 'GE-0007 P1-UX: Eliminates duplicate floating notification bell, unclips SmartBrief & Settings capabilities, and removes false-positive manifest fallback',
      fn: () => {
        const shellSrc = readWorkspaceFile('src/app/AppShell.tsx');
        assert.ok(!shellSrc.includes('<DraggableNotificationHandle'), 'AppShell must not render duplicate floating bell');
        assert.ok(!shellSrc.includes('pr-9 pl-2.5'), 'AppShell main must use balanced horizontal padding');

        const modalSrc = readWorkspaceFile('src/components/ui/InstallAppModal.tsx');
        assert.ok(modalSrc.includes('scopeContained'), 'InstallAppModal must verify real manifest scope containment');
        assert.ok(modalSrc.includes('iconsValid'), 'InstallAppModal must probe real 192 & 512 icon HTTP status');
        assert.ok(!modalSrc.includes('manifestValid = Boolean(linkEl)'), 'InstallAppModal must never fall back to false-positive link tag check');
      },
    },
  ];

  const results: Ge0007TestResult[] = [];
  for (const t of tests) {
    try {
      await t.fn();
      results.push({ name: t.name, passed: true });
    } catch (err) {
      results.push({
        name: t.name,
        passed: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
