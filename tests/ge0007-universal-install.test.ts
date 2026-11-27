import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GITHUB_ANDROID_RELEASE_PAGE,
  isValidApkMagicBytes,
} from '../src/lib/downloadHelper';
import { UpdateLedger } from '../src/services/updates/ledger';

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
      name: 'GE-0007 P0-PWA: SW registers explicit scope ./, serves manifest.json network-first & preserves ignoreSearch offline start_url shell fallback',
      fn: () => {
        const indexSrc = readWorkspaceFile('index.html');
        assert.ok(
          indexSrc.includes("register('./sw.js', { scope: './', updateViaCache: 'none' })"),
          'index.html must explicitly bind SW scope to ./ with updateViaCache: none'
        );
        assert.ok(
          indexSrc.includes('reg.update()'),
          'index.html must proactively poll reg.update() on startup/visibility/online'
        );

        const swSrc = readWorkspaceFile('public/sw.js');
        assert.ok(swSrc.includes('handleManifestRequest'), 'public/sw.js must serve manifest.json via network-first with cache fallback');
        assert.ok(swSrc.includes('ignoreSearch: true'), 'public/sw.js must match cached start_url shell even with query params offline');
      },
    },
    {
      name: 'GE-0007 P0-APK & CI Parity: android-apk.yml uses monotonic MINA_RELEASE_SEQUENCE (>= 224), enforces verify-apk-artifact.mjs & aligns Gradle + Vite',
      fn: () => {
        const pkg = JSON.parse(readWorkspaceFile('package.json'));
        const pubVer = JSON.parse(readWorkspaceFile('public/version.json'));
        const wf = readWorkspaceFile('.github/workflows/android-apk.yml');
        assert.ok(!wf.includes('github.run_number'), 'android-apk.yml must NEVER use github.run_number as MINA_RELEASE_SEQUENCE');
        const deploy = readWorkspaceFile('.github/workflows/deploy.yml');
        const floor = Number(wf.match(/MINA_BASE_SEQUENCE:\s*['"](\d+)['"]/)?.[1]);
        const deployFloor = Number(deploy.match(/MINA_BASE_SEQUENCE:\s*['"](\d+)['"]/)?.[1]);
        assert.ok(Number.isSafeInteger(floor) && floor >= 224 && floor <= pubVer.releaseSequence, 'Android floor must be valid and no higher than allocated sequence');
        assert.equal(floor, deployFloor, 'Android and deploy must share the same release floor');
        assert.ok(wf.includes('scripts/ci-release-gate.mjs --compute-sequence'), 'android-apk.yml must compute monotonic release sequence');
        assert.ok(wf.includes('gradle ${{ steps.sign_mode.outputs.gradle_task }}'), 'Workflow must assemble APK via Gradle');
        assert.ok(wf.includes('scripts/verify-apk-artifact.mjs'), 'Workflow must invoke automated verify-apk-artifact.mjs gate');
        assert.ok(wf.includes('--require-apksigner'), 'CI APK verification gate must strictly require apksigner');
        assert.ok(
          wf.includes('release_tag=android-latest') && (wf.includes('gh release upload "$RELEASE_TAG"') || wf.includes('gh release create "$RELEASE_TAG"')),
          'Workflow must publish to android-latest GitHub Release'
        );
        assert.ok(wf.includes('apk-release.json'), 'Workflow must emit machine-readable apk-release.json');

        const gradleSrc = readWorkspaceFile('app/build.gradle.kts');
        assert.ok(gradleSrc.includes('System.getenv("MINA_RELEASE_SEQUENCE")'), 'app/build.gradle.kts must honor CI MINA_RELEASE_SEQUENCE');
        assert.ok(gradleSrc.includes(`versionCode = ${pubVer.releaseSequence}`), `app/build.gradle.kts must preserve baseline versionCode = ${pubVer.releaseSequence}`);
        assert.ok(gradleSrc.includes(`versionName = "${pkg.version}"`), `app/build.gradle.kts must match package.json versionName ${pkg.version}`);

        const viteSrc = readWorkspaceFile('vite.config.ts');
        assert.ok(viteSrc.includes('readAndroidGradleBaseline'), 'vite.config.ts must verify Web/Android version parity against app/build.gradle.kts');
      },
    },
    {
      name: 'GE-0007 P0-APK Verifier: scripts/verify-apk-artifact.mjs rejects HTML spoof, parses apksigner certs & enforces repo version parity',
      fn: async () => {
        const verifierModule = await import('../scripts/verify-apk-artifact.mjs');
        assert.equal(verifierModule.hasApkZipMagicBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00])), true);
        assert.equal(verifierModule.hasApkZipMagicBytes(Buffer.from('<!DOCTYPE html>')), false);
        assert.equal(verifierModule.looksLikeHtmlOrJsonPayload(Buffer.from('<!DOCTYPE html><html>404</html>')), true);

        const parsedSig = verifierModule.parseApksignerOutput(
          [
            'Verifies',
            'Verified using v1 scheme (JAR signing): true',
            'Verified using v2 scheme (APK Signature Scheme v2): true',
            'Verified using v3 scheme (APK Signature Scheme v3): false',
            'Signer #1 certificate DN: CN=MinaDental CI, O=MinaDental Clinic',
            'Signer #1 certificate SHA-256 digest: ' + 'a'.repeat(64),
          ].join('\n')
        );
        assert.equal(parsedSig.verified, true);
        assert.equal(parsedSig.schemes.v2, true);
        assert.equal(parsedSig.signerCertSha256, 'a'.repeat(64));

        const baseline = verifierModule.readRepoVersionBaseline(process.cwd());
        assert.equal(baseline.packageVersion, baseline.gradleVersionName);
        assert.ok((baseline.gradleVersionCode ?? 0) >= 167);

        // Fail-closed check: HTML spoofed .apk file must throw immediately
        const tmpHtmlApk = path.join(os.tmpdir(), `minadental-fake-${Date.now()}.apk`);
        fs.writeFileSync(tmpHtmlApk, '<!DOCTYPE html><html><body>404 Not Found</body></html>', 'utf8');
        try {
          assert.throws(
            () => verifierModule.verifyApkArtifact({ apkPath: tmpHtmlApk, requireApksigner: false }),
            /HTML\/JSON\/text/i
          );
        } finally {
          fs.rmSync(tmpHtmlApk, { force: true });
        }
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
      name: 'GE-0007 Always-Active Auto-Update: UpdateLedger defaults ON & self-heals invalid values; coordinator immediately handles SW/online/focus & READY_TO_ACTIVATE',
      fn: () => {
        const mem = new Map<string, string>();
        const storage = {
          getItem: (k: string) => mem.get(k) ?? null,
          setItem: (k: string, v: string) => { mem.set(k, v); },
          removeItem: (k: string) => { mem.delete(k); },
        };
        const ledger = new UpdateLedger(storage);
        assert.equal(ledger.isAutoUpdateEnabled(), true, 'Auto-update must default ON');
        mem.set('minadental_auto_update_enabled', 'corrupted-value');
        assert.equal(ledger.isAutoUpdateEnabled(), true, 'Auto-update must self-heal invalid storage values to ON');
        ledger.setAutoUpdateEnabled(false);
        assert.equal(ledger.isAutoUpdateEnabled(), false, 'Explicit false toggle must still be respected');
        ledger.setAutoUpdateEnabled(true);
        assert.equal(ledger.isAutoUpdateEnabled(), true);

        const coordSrc = readWorkspaceFile('src/services/updates/coordinator.ts');
        assert.ok(coordSrc.includes("source === 'sw_event' || source === 'online' || source === 'startup'"), 'SW, online & startup events must bypass debounce');
        assert.ok(coordSrc.includes("this.state === 'WAITING_FOR_SAFE_POINT' || this.state === 'READY_TO_ACTIVATE'"), 'Heartbeat must auto-resume READY_TO_ACTIVATE as well as WAITING_FOR_SAFE_POINT');
        assert.ok(coordSrc.includes("window.addEventListener('focus', this.boundFocusHandler)"), 'Coordinator must listen to window focus for seamless foreground updates');
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
