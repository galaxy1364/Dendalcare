import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fetchAuthoritativeRelease, verifyReleaseAssets } from '../src/services/updates/manifestClient';
import { serializeCanonicalManifestPayload } from '../src/services/updates/releaseIdentity';
import type { AuthoritativeReleaseManifest, PinnedPublicKey, ReleasePointer } from '../src/services/updates/contracts';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const ROOT = process.cwd();

async function runCase(name: string, fn: () => Promise<void> | void): Promise<TestResult> {
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

function canonicalPayloadForSigning(manifest: AuthoritativeReleaseManifest): string {
  // Verify vite.config.ts implements the exact same recursive sorted-key canonicalizer
  const viteSrc = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
  assert.ok(
    viteSrc.includes('const sortKeysDeep = (val: unknown): unknown =>') &&
      viteSrc.includes('const { signature: _omit, ...rest } = manifest;'),
    'vite.config.ts canonicalManifestPayloadForSigning must match releaseIdentity.ts sortKeysDeep'
  );
  return serializeCanonicalManifestPayload(manifest);
}

export async function runAllGe0006ReleaseRecoveryTests(): Promise<TestResult[]> {
  const results: TestResult[] = [];

  results.push(
    await runCase('GE-0006 #1: All GitHub Actions workflows pin ubuntu-24.04 (preventing Playwright 1.52 ubuntu-latest failure) and enforce --verify-parity', () => {
      for (const wf of ['deploy.yml', 'ci.yml', 'release.yml']) {
        const content = fs.readFileSync(path.join(ROOT, '.github', 'workflows', wf), 'utf8');
        assert.ok(
          !content.includes('runs-on: ubuntu-latest'),
          `${wf} must pin runs-on: ubuntu-24.04 instead of floating ubuntu-latest`
        );
        assert.ok(content.includes('runs-on: ubuntu-24.04'), `${wf} missing runs-on: ubuntu-24.04`);
        assert.ok(content.includes('--verify-parity'), `${wf} must enforce --verify-parity cross-target check`);
        assert.ok(content.includes('npm run verify:assets'), `${wf} missing verify:assets gate`);
        assert.ok(content.includes('npm test'), `${wf} missing npm test gate`);
        assert.ok(content.includes('npm run test:e2e'), `${wf} missing Playwright E2E gate`);
      }
    })
  );

  results.push(
    await runCase('GE-0006 #2: Web (dist, gh-pages-dist, root version.json) and Android (app/src/main/assets/www + build.gradle.kts) share ONE reconciled build identity >= #167', () => {
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
      const gradle = fs.readFileSync(path.join(ROOT, 'app', 'build.gradle.kts'), 'utf8');
      const vc = Number(gradle.match(/versionCode\s*=\s*(\d+)/)?.[1] || 0);
      const vn = gradle.match(/versionName\s*=\s*"([^"]+)"/)?.[1];

      assert.ok(vc >= 167, `Android versionCode must be >= 167 (got ${vc})`);
      assert.equal(vn, pkg.version, `Android versionName (${vn}) must match package.json (${pkg.version})`);

      const distVerPath = path.join(ROOT, 'dist', 'version.json');
      assert.ok(fs.existsSync(distVerPath), 'dist/version.json must exist after build');
      const distVer = JSON.parse(fs.readFileSync(distVerPath, 'utf8'));
      assert.ok(distVer.releaseSequence >= 167, `dist releaseSequence must be >= 167 (got ${distVer.releaseSequence})`);

      for (const rel of [
        'version.json',
        'gh-pages-dist/version.json',
        'app/src/main/assets/www/version.json',
      ]) {
        const targetPath = path.join(ROOT, rel);
        assert.ok(fs.existsSync(targetPath), `Missing synchronized build target: ${rel}`);
        const targetVer = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
        assert.equal(targetVer.releaseId, distVer.releaseId, `releaseId drift in ${rel}: ${targetVer.releaseId} !== ${distVer.releaseId}`);
        assert.equal(targetVer.contentDigest, distVer.contentDigest, `contentDigest drift in ${rel}`);
        assert.equal(targetVer.releaseSequence, distVer.releaseSequence, `releaseSequence drift in ${rel}`);
      }
    })
  );

  results.push(
    await runCase('GE-0006 #3: Real ECDSA P-256 signed A->B update (#166 -> #168) verifies signature, exact bytes & SHA-256, and rejects tampered manifest/asset', async () => {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const pubJwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;
      const pinnedKey: PinnedPublicKey = {
        keyId: 'mina-ci-2026-p256',
        algorithm: 'ECDSA-P256-SHA256',
        jwk: pubJwk,
      };

      const htmlBody = Buffer.from('<!doctype html><html dir="rtl"><meta name="minadental-build-id" content="v4.17.0-a1b2c3d4e5"></html>', 'utf8');
      const jsBody = Buffer.from('console.log("minadental-v4.17.0");', 'utf8');
      const htmlSha = crypto.createHash('sha256').update(htmlBody).digest('hex');
      const jsSha = crypto.createHash('sha256').update(jsBody).digest('hex');
      const contentDigest = crypto.createHash('sha256').update('ge0006-ab-signed').digest('hex');
      const releaseId = `v4.17.0-${contentDigest.slice(0, 10)}`;

      const unsignedManifest: AuthoritativeReleaseManifest = {
        schemaVersion: 2,
        releaseId,
        releaseSequence: 168,
        semver: '4.17.0',
        gitCommit: '0123456789abcdef0123456789abcdef01234567',
        channel: 'stable',
        platform: 'web',
        minNativeVersion: '4.9.0',
        minSchemaVersion: 4,
        publishedAt: '2026-11-26T18:00:00.000Z',
        expiresAt: '2027-11-26T18:00:00.000Z',
        contentDigest,
        releaseNotes: 'Signed GE-0006 A->B release test',
        entryScripts: ['./assets/app-ge0006.js'],
        entryStyles: [],
        assets: [
          { path: './index.html', sha256: htmlSha, size: htmlBody.byteLength, critical: true, contentType: 'text/html; charset=utf-8' },
          { path: './assets/app-ge0006.js', sha256: jsSha, size: jsBody.byteLength, critical: true, contentType: 'application/javascript; charset=utf-8' },
        ],
        urgency: 'standard',
        revoked: false,
        origin: 'ci_pipeline',
        rollbackPolicy: {
          strategy: 'forward_release',
          minRollbackSequence: 168,
          schemaBackwardCompatible: true,
          preserveUserData: true,
        },
        keyId: pinnedKey.keyId,
      };

      const sigBuf = crypto.sign('sha256', Buffer.from(canonicalPayloadForSigning(unsignedManifest), 'utf8'), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      });
      const signedManifest: AuthoritativeReleaseManifest = {
        ...unsignedManifest,
        signature: sigBuf.toString('base64'),
      };

      const pointer: ReleasePointer = {
        schemaVersion: 2,
        channel: 'stable',
        platform: 'web',
        currentReleaseId: releaseId,
        releaseSequence: 168,
        manifestUrl: `./releases/${releaseId}/release-manifest.json`,
        updatedAt: '2026-11-26T18:00:00.000Z',
        revokedReleaseIds: [],
        minSupportedSequence: 1,
      };

      const base = 'https://galaxy1364.github.io/Dendalcare/';
      const mockFetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/release-pointer.json')) {
          return new Response(JSON.stringify(pointer), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.endsWith(`/releases/${releaseId}/release-manifest.json`)) {
          return new Response(JSON.stringify(signedManifest), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.endsWith(`/releases/${releaseId}/index.html`)) {
          return new Response(htmlBody, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
        }
        if (url.endsWith(`/releases/${releaseId}/assets/app-ge0006.js`)) {
          return new Response(jsBody, { status: 200, headers: { 'content-type': 'application/javascript; charset=utf-8' } });
        }
        return new Response('Not Found', { status: 404 });
      }) as typeof fetch;

      // 1. Valid signed fetch + immutable asset verification must PASS
      const fetchRes = await fetchAuthoritativeRelease({
        pointerUrl: `${base}release-pointer.json`,
        currentOrigin: 'https://galaxy1364.github.io',
        pinnedKeys: [pinnedKey],
        requireSignature: true,
        fetchFn: mockFetch,
        isOnlineFn: () => true,
      });
      assert.equal(fetchRes.ok, true, `Signed release fetch failed: ${!fetchRes.ok ? fetchRes.detail : ''}`);
      if (!fetchRes.ok || !fetchRes.manifest) throw new Error('Expected signed manifest');
      assert.equal(fetchRes.signatureVerified, true);
      assert.equal(fetchRes.manifest.releaseSequence, 168);

      const stagedPaths: string[] = [];
      const verifyRes = await verifyReleaseAssets({
        manifest: fetchRes.manifest,
        manifestUrl: fetchRes.endpointUrl,
        baseUrl: base,
        verifyAllAssets: true,
        fetchFn: mockFetch,
        onVerifiedAsset: (p) => {
          stagedPaths.push(p.asset.path);
        },
      });
      assert.equal(verifyRes.ok, true, `Asset verification failed: ${!verifyRes.ok ? verifyRes.detail : ''}`);
      assert.equal(stagedPaths.length, 2);

      // 2. Tampered manifest must fail closed with SIGNATURE_INVALID
      const tamperedManifest = { ...signedManifest, releaseNotes: 'TAMPERED PAYLOAD' };
      const tamperedFetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/release-pointer.json')) {
          return new Response(JSON.stringify(pointer), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify(tamperedManifest), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch;

      const badSigRes = await fetchAuthoritativeRelease({
        pointerUrl: `${base}release-pointer.json`,
        currentOrigin: 'https://galaxy1364.github.io',
        pinnedKeys: [pinnedKey],
        requireSignature: true,
        fetchFn: tamperedFetch,
        isOnlineFn: () => true,
      });
      assert.equal(badSigRes.ok, false);
      if (!badSigRes.ok) assert.equal(badSigRes.errorCode, 'SIGNATURE_INVALID');

      // 3. Tampered asset bytes must fail closed with SIZE_MISMATCH (never silently accepted)
      const corruptedAssetFetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith(`/releases/${releaseId}/assets/app-ge0006.js`)) {
          return new Response(Buffer.from('corrupted', 'utf8'), {
            status: 200,
            headers: { 'content-type': 'application/javascript; charset=utf-8' },
          });
        }
        return mockFetch(input);
      }) as typeof fetch;

      const badAssetRes = await verifyReleaseAssets({
        manifest: fetchRes.manifest,
        manifestUrl: fetchRes.endpointUrl,
        baseUrl: base,
        verifyAllAssets: true,
        fetchFn: corruptedAssetFetch,
      });
      assert.equal(badAssetRes.ok, false);
      if (!badAssetRes.ok) assert.equal(badAssetRes.errorCode, 'SIZE_MISMATCH');
    })
  );

  results.push(
    await runCase('GE-0006 #4: SettingsSection install card reads authoritative runtime installedWeb releaseSequence (zero static #116 drift)', () => {
      const settingsSrc = fs.readFileSync(
        path.join(ROOT, 'src', 'components', 'sections', 'SettingsSection.tsx'),
        'utf8'
      );
      assert.ok(
        settingsSrc.includes('updateSnap.versionReport.installedWeb.releaseSequence'),
        'SettingsSection install card must display runtime installedWeb.releaseSequence'
      );
      assert.ok(
        !settingsSrc.includes('نسخه v{CURRENT_APP_VERSION} (#{CURRENT_APP_BUILD})'),
        'SettingsSection must not hardcode static CURRENT_APP_BUILD in device install card'
      );
    })
  );

  results.push(
    await runCase('GE-0006 #5: Manager RLS migration enforces strict server-verified clinic_memberships without JWT fallback and supports all_branches', () => {
      const sql = fs.readFileSync(
        path.join(ROOT, 'supabase', 'migrations', '20261202000000_ge0004_manager_auth_membership_rls_recovery.sql'),
        'utf8'
      );
      assert.ok(sql.includes('app_resolve_verified_role'), 'Missing app_resolve_verified_role');
      assert.ok(sql.includes('app_get_my_verified_memberships'), 'Missing app_get_my_verified_memberships RPC');
      assert.ok(sql.includes('all_branches'), 'Missing manager all_branches scope handling');
      assert.ok(!sql.includes("auth.jwt() -> 'app_metadata'"), 'SQL must never fall back to JWT app_metadata for role authorization');
    })
  );

  results.push(
    await runCase('GE-0006 #6: WebPwaUpdateAdapter uses window.location.reload() on same-document hash URLs (prevents silent no-op reload on Samsung Browser/Safari)', () => {
      const adapterSrc = fs.readFileSync(
        path.join(ROOT, 'src', 'services', 'updates', 'adapters', 'webPwaAdapter.ts'),
        'utf8'
      );
      assert.ok(
        adapterSrc.includes('window.location.reload()'),
        'WebPwaUpdateAdapter must call window.location.reload() for same-document hash URLs'
      );
      assert.ok(
        adapterSrc.includes('targetUrl.pathname === window.location.pathname'),
        'WebPwaUpdateAdapter must detect identical origin/pathname/search before reload'
      );
    })
  );

  return results;
}
