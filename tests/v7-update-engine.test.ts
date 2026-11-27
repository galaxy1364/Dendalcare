import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {
  UpdateCoordinator,
  UpdateLedger,
  WebPwaUpdateAdapter,
  NativePlatformUpdateAdapter,
  compareReleases,
  computeSha256Hex,
  serializeCanonicalManifestPayload,
  verifyManifestSignature,
  isAllowedReleaseUrl,
  ALLOWED_UPDATE_TRANSITIONS,
  canTransitionUpdateState,
  type AuthoritativeReleaseManifest,
  type PinnedPublicKey,
  type ReleasePointer,
  type RuntimeReleaseIdentity,
  type StorageLike,
  type UpdateProgress,
} from '../src/services/updates';
import { broadcastNewAppBuild } from '../src/lib/updateManager';
import { CURRENT_APP_BUILD } from '../src/lib/cloudSyncEngine';

export interface V7TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

class MemoryStorage implements StorageLike {
  private readonly store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

interface RealReleaseBundle {
  pointer: ReleasePointer;
  manifest: AuthoritativeReleaseManifest;
  files: Record<string, { body: Buffer; contentType: string }>;
  etag: string;
}

function sha256Hex(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function createEcdsaKeyPair(keyId: string, status: 'active' | 'rotated' | 'revoked' = 'active'): Promise<{
  privateKey: CryptoKey;
  pinnedKey: PinnedPublicKey;
}> {
  const pair = await globalThis.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const publicJwk = await globalThis.crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    privateKey: pair.privateKey,
    pinnedKey: {
      keyId,
      algorithm: 'ECDSA-P256-SHA256',
      jwk: publicJwk,
      status,
      validFrom: '2026-01-01T00:00:00.000Z',
    },
  };
}

async function signManifest(
  manifest: AuthoritativeReleaseManifest,
  privateKey: CryptoKey,
  keyId: string
): Promise<AuthoritativeReleaseManifest> {
  const unsigned: AuthoritativeReleaseManifest = {
    ...manifest,
    keyId,
    signature: undefined,
  };
  const payload = new TextEncoder().encode(serializeCanonicalManifestPayload(unsigned));
  const sigBuf = await globalThis.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    payload
  );
  return {
    ...unsigned,
    signature: Buffer.from(sigBuf).toString('base64'),
  };
}

async function buildRealReleaseBundle(opts: {
  semver: string;
  releaseSequence: number;
  contentSeed: string;
  platform?: 'web' | 'pwa' | 'android' | 'ios' | 'windows';
  minNativeVersion?: string;
  minSchemaVersion?: number;
  urgency?: 'standard' | 'critical';
  revoked?: boolean;
  revokedReleaseIds?: string[];
  signingKey?: { privateKey: CryptoKey; keyId: string };
  corruptAssetPath?: string;
  omitAssetPath?: string;
  htmlForJsPath?: string;
}): Promise<RealReleaseBundle> {
  const entryJs = Buffer.from(`console.log("minadental-bundle-${opts.contentSeed}-seq-${opts.releaseSequence}");\n`, 'utf8');
  const entryCss = Buffer.from(`:root { --mina-seed: "${opts.contentSeed}"; }\n`, 'utf8');
  const indexHtml = Buffer.from(
    `<!doctype html><html lang="fa" dir="rtl"><head><title>MinaDental ${opts.semver}</title></head><body><div id="root"></div></body></html>`,
    'utf8'
  );

  const hash = crypto.createHash('sha256');
  hash.update(opts.semver);
  hash.update(entryJs);
  hash.update(entryCss);
  const shortHash = hash.digest('hex').slice(0, 10);
  const releaseId = `v${opts.semver}-${shortHash}`;

  const jsPath = `./assets/index-${shortHash}.js`;
  const cssPath = `./assets/index-${shortHash}.css`;

  const assets = [
    {
      path: './index.html',
      sha256: sha256Hex(indexHtml),
      size: indexHtml.byteLength,
      critical: true,
      contentType: 'text/html; charset=utf-8',
    },
    {
      path: jsPath,
      sha256: sha256Hex(entryJs),
      size: entryJs.byteLength,
      critical: true,
      contentType: 'application/javascript; charset=utf-8',
    },
    {
      path: cssPath,
      sha256: sha256Hex(entryCss),
      size: entryCss.byteLength,
      critical: true,
      contentType: 'text/css; charset=utf-8',
    },
  ];

  let manifest: AuthoritativeReleaseManifest = {
    schemaVersion: 2,
    releaseId,
    releaseSequence: opts.releaseSequence,
    semver: opts.semver,
    gitCommit: sha256Hex(opts.contentSeed).slice(0, 40),
    channel: 'stable',
    platform: opts.platform ?? 'web',
    minNativeVersion: opts.minNativeVersion ?? '4.9.0',
    minSchemaVersion: opts.minSchemaVersion ?? 4,
    publishedAt: new Date().toISOString(),
    releaseNotes: `انتشار واقعی ${opts.semver} (#${opts.releaseSequence})`,
    entryScripts: [jsPath],
    entryStyles: [cssPath],
    assets,
    urgency: opts.urgency ?? 'standard',
    revoked: opts.revoked ?? false,
    origin: 'ci_pipeline',
    rollbackPolicy: {
      strategy: 'forward_release',
      minRollbackSequence: opts.releaseSequence,
      schemaBackwardCompatible: true,
      preserveUserData: true,
    },
  };

  if (opts.signingKey) {
    manifest = await signManifest(manifest, opts.signingKey.privateKey, opts.signingKey.keyId);
  }

  const pointer: ReleasePointer = {
    schemaVersion: 2,
    channel: 'stable',
    platform: opts.platform ?? 'web',
    currentReleaseId: releaseId,
    releaseSequence: opts.releaseSequence,
    manifestUrl: `./releases/${releaseId}/release-manifest.json`,
    updatedAt: manifest.publishedAt,
    revokedReleaseIds: opts.revokedReleaseIds ?? [],
    minSupportedSequence: 1,
  };

  const files: Record<string, { body: Buffer; contentType: string }> = {
    '/index.html': { body: indexHtml, contentType: 'text/html; charset=utf-8' },
    [`/assets/index-${shortHash}.js`]: {
      body: opts.corruptAssetPath === jsPath
        ? Buffer.from(
            entryJs.toString('utf8').replace('minadental', 'TAMPERED_X'),
            'utf8'
          )
        : opts.htmlForJsPath === jsPath
        ? Buffer.from('<!doctype html><html><body>404 SPA fallback</body></html>', 'utf8')
        : entryJs,
      contentType:
        opts.htmlForJsPath === jsPath
          ? 'text/html; charset=utf-8'
          : 'application/javascript; charset=utf-8',
    },
    [`/assets/index-${shortHash}.css`]: {
      body: entryCss,
      contentType: 'text/css; charset=utf-8',
    },
    [`/releases/${releaseId}/release-manifest.json`]: {
      body: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
      contentType: 'application/json; charset=utf-8',
    },
    '/release-pointer.json': {
      body: Buffer.from(JSON.stringify(pointer, null, 2), 'utf8'),
      contentType: 'application/json; charset=utf-8',
    },
  };

  if (opts.omitAssetPath) {
    delete files[opts.omitAssetPath.replace(/^\./, '')];
  }

  return {
    pointer,
    manifest,
    files,
    etag: `"${releaseId}-seq-${opts.releaseSequence}"`,
  };
}

interface MockReleaseServer {
  baseUrl: string;
  setBundle: (bundle: RealReleaseBundle) => void;
  setMode: (mode: 'normal' | 'http503' | 'hang') => void;
  close: () => Promise<void>;
}

async function startReleaseHttpServer(initialBundle: RealReleaseBundle): Promise<MockReleaseServer> {
  let activeBundle = initialBundle;
  let mode: 'normal' | 'http503' | 'hang' = 'normal';

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;

    if (mode === 'http503') {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('Service Unavailable');
      return;
    }

    if (mode === 'hang') {
      // Intentionally never respond until client AbortController times out
      req.on('close', () => {
        try {
          res.end();
        } catch {
          // ignore
        }
      });
      return;
    }

    if (pathname === '/release-pointer.json') {
      const inm = req.headers['if-none-match'];
      if (inm && inm === activeBundle.etag) {
        res.writeHead(304, { ETag: activeBundle.etag });
        res.end();
        return;
      }
      const entry = activeBundle.files[pathname];
      res.writeHead(200, {
        'Content-Type': entry.contentType,
        ETag: activeBundle.etag,
        'Cache-Control': 'no-store',
      });
      res.end(entry.body);
      return;
    }

    const entry = activeBundle.files[pathname];
    if (!entry) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': entry.contentType,
      'Content-Length': String(entry.body.byteLength),
    });
    res.end(entry.body);
  });

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}/`,
    setBundle: (bundle) => {
      activeBundle = bundle;
    },
    setMode: (nextMode) => {
      mode = nextMode;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function runAllV7UpdateEngineTests(): Promise<V7TestResult[]> {
  const results: V7TestResult[] = [];

  async function runCase(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      results.push({ name, passed: true });
    } catch (err) {
      results.push({
        name,
        passed: false,
        error: err instanceof Error ? err.stack || err.message : String(err),
      });
    }
  }

  // 1. Real A -> B signed release upgrade + real byte progress + controlled single reload + post-boot handshake
  await runCase('V7-01: Real A -> B upgrade with ECDSA P-256 signature, SHA-256 byte progress, single reload & post-boot INSTALLED', async () => {
    const key1 = await createEcdsaKeyPair('minadental-ci-2026-v1', 'active');
    const releaseA = await buildRealReleaseBundle({
      semver: '4.9.6',
      releaseSequence: 65,
      contentSeed: 'release-A',
      signingKey: { privateKey: key1.privateKey, keyId: key1.pinnedKey.keyId },
    });
    const releaseB = await buildRealReleaseBundle({
      semver: '4.9.7',
      releaseSequence: 66,
      contentSeed: 'release-B',
      signingKey: { privateKey: key1.privateKey, keyId: key1.pinnedKey.keyId },
    });

    const server = await startReleaseHttpServer(releaseA);
    try {
      const storage = new MemoryStorage();
      let currentRuntime: RuntimeReleaseIdentity = {
        releaseId: releaseA.manifest.releaseId,
        releaseSequence: releaseA.manifest.releaseSequence,
        semver: releaseA.manifest.semver,
        channel: 'stable',
        platform: 'web',
        schemaVersion: 4,
        nativeVersion: releaseA.manifest.semver,
        origin: 'ci_pipeline',
      };
      let currentWorkerBuildId = releaseA.manifest.releaseId;
      let reloadCount = 0;

      const makeAdapter = () =>
        new WebPwaUpdateAdapter({
          getRuntimeIdentityFn: () => currentRuntime,
          queryWorkerIdentityFn: async () => ({
            buildId: currentWorkerBuildId,
            cacheName: `minadental-shell-${currentWorkerBuildId}`,
          }),
          reloadFn: () => {
            reloadCount += 1;
          },
        });

      const coordinator1 = new UpdateCoordinator({
        storage,
        adapter: makeAdapter(),
        baseUrl: server.baseUrl,
        pinnedKeys: [key1.pinnedKey],
        requireSignature: true,
        manifestClient: {
          pointerUrl: `${server.baseUrl}release-pointer.json`,
          maxRetries: 0,
        },
        getOfflineQueueCount: () => 0,
      });

      // Baseline check on Release A -> UP_TO_DATE, verifiedAt NOT mutated!
      const baselineBefore = coordinator1.getSnapshot().installed.verifiedAt;
      const upToDateSnap = await coordinator1.checkForUpdates('manual');
      assert.equal(upToDateSnap.state, 'UP_TO_DATE');
      assert.equal(upToDateSnap.installed.verifiedAt, baselineBefore);
      assert.equal(upToDateSnap.lastCheck?.outcome, 'up_to_date');

      // ETag 304 check on automatic poll -> not_modified & still UP_TO_DATE
      const notModSnap = await coordinator1.checkForUpdates('poll');
      assert.equal(notModSnap.state, 'UP_TO_DATE');
      assert.equal(notModSnap.lastCheck?.outcome, 'not_modified');
      assert.equal(notModSnap.lastCheck?.httpStatus, 304);

      // Publish Release B on server
      server.setBundle(releaseB);
      const availSnap = await coordinator1.checkForUpdates('manual');
      assert.equal(availSnap.state, 'AVAILABLE');
      assert.equal(availSnap.candidate?.manifest.releaseId, releaseB.manifest.releaseId);
      assert.equal(availSnap.candidate?.signatureVerified, true);

      // Stage & verify with real byte progress
      const seenProgress: UpdateProgress[] = [];
      const unsub = coordinator1.subscribe((s) => {
        if (s.progress) seenProgress.push(s.progress);
      });
      const readySnap = await coordinator1.downloadAndVerifyCandidate();
      unsub();
      assert.equal(readySnap.state, 'READY_TO_ACTIVATE');
      assert.equal(readySnap.candidate?.integrityVerified, true);
      assert.ok(seenProgress.some((p) => p.determinate && (p.bytesTotal ?? 0) > 0), 'Must report real byte progress');

      // Activate -> controlled single reload, state MUST be BOOT_VERIFYING (NOT INSTALLED yet!)
      const actSnap = await coordinator1.activateVerifiedCandidate({ allowReload: true });
      assert.equal(actSnap.state, 'BOOT_VERIFYING');
      assert.equal(reloadCount, 1, 'Must trigger at-most-once controlled reload');
      assert.equal(actSnap.installed.releaseId, releaseA.manifest.releaseId, 'Must NOT claim B is installed before post-boot handshake');

      // Simulate reboot into Release B runtime + worker
      currentRuntime = {
        ...currentRuntime,
        releaseId: releaseB.manifest.releaseId,
        releaseSequence: releaseB.manifest.releaseSequence,
        semver: releaseB.manifest.semver,
        nativeVersion: releaseB.manifest.semver,
      };
      currentWorkerBuildId = releaseB.manifest.releaseId;

      let bootVerifiedCallbackFired = false;
      const coordinator2 = new UpdateCoordinator({
        storage,
        adapter: makeAdapter(),
        baseUrl: server.baseUrl,
        pinnedKeys: [key1.pinnedKey],
        requireSignature: true,
        manifestClient: {
          pointerUrl: `${server.baseUrl}release-pointer.json`,
          maxRetries: 0,
        },
        getOfflineQueueCount: () => 0,
        onBootVerifiedInstalled: () => {
          bootVerifiedCallbackFired = true;
        },
      });

      const postBootSnap = await coordinator2.verifyPostBoot();
      assert.equal(postBootSnap.state, 'INSTALLED');
      assert.equal(postBootSnap.installed.releaseId, releaseB.manifest.releaseId);
      assert.equal(postBootSnap.installed.releaseSequence, 66);
      assert.ok(postBootSnap.installed.verifiedAt, 'verifiedAt must be set ONLY after post-boot handshake');
      assert.equal(postBootSnap.pendingActivation, null);
      assert.equal(bootVerifiedCallbackFired, true);
    } finally {
      await server.close();
    }
  });

  // 2. Same SemVer + changed content + higher releaseSequence => valid UPGRADE; Same sequence + different digest => SEQUENCE_CONFLICT
  await runCase('V7-02: Same SemVer content upgrade passes; same sequence with different digest fails with SEQUENCE_CONFLICT', async () => {
    const releaseA = await buildRealReleaseBundle({ semver: '4.9.6', releaseSequence: 65, contentSeed: 'v1-content' });
    const releaseSameSemverNewSeq = await buildRealReleaseBundle({ semver: '4.9.6', releaseSequence: 66, contentSeed: 'v2-content-same-semver' });
    const releaseSameSeqConflict = await buildRealReleaseBundle({ semver: '4.9.6', releaseSequence: 65, contentSeed: 'conflicting-digest-same-seq' });

    const runtimeA: RuntimeReleaseIdentity = {
      releaseId: releaseA.manifest.releaseId,
      releaseSequence: 65,
      semver: '4.9.6',
      channel: 'stable',
      platform: 'web',
      schemaVersion: 4,
      nativeVersion: '4.9.6',
      origin: 'ci_pipeline',
    };

    const sameSemverOutcome = compareReleases(runtimeA, releaseSameSemverNewSeq.manifest);
    assert.equal(sameSemverOutcome.kind, 'UPGRADE');
    if (sameSemverOutcome.kind === 'UPGRADE') {
      assert.equal(sameSemverOutcome.reason, 'content_changed_same_semver');
    }

    const conflictOutcome = compareReleases(runtimeA, releaseSameSeqConflict.manifest);
    assert.equal(conflictOutcome.kind, 'SEQUENCE_CONFLICT');

    // Verify UpdateCoordinator surfaces SEQUENCE_CONFLICT as CHECK_FAILED (never UP_TO_DATE or AVAILABLE)
    const server = await startReleaseHttpServer(releaseSameSeqConflict);
    try {
      const coord = new UpdateCoordinator({
        storage: new MemoryStorage(),
        adapter: new WebPwaUpdateAdapter({ getRuntimeIdentityFn: () => runtimeA }),
        baseUrl: server.baseUrl,
        manifestClient: { pointerUrl: `${server.baseUrl}release-pointer.json`, maxRetries: 0 },
      });
      const snap = await coord.checkForUpdates('manual');
      assert.equal(snap.state, 'CHECK_FAILED');
      assert.equal(snap.error?.code, 'SEQUENCE_CONFLICT');
    } finally {
      await server.close();
    }
  });

  // 3. Offline, HTTP 503, and timeout MUST NEVER return UP_TO_DATE
  await runCase('V7-03: Offline, HTTP 503, and request timeout return OFFLINE / CHECK_FAILED (never UP_TO_DATE)', async () => {
    const releaseA = await buildRealReleaseBundle({ semver: '4.9.6', releaseSequence: 65, contentSeed: 'net-test' });
    const server = await startReleaseHttpServer(releaseA);
    try {
      const runtimeA: RuntimeReleaseIdentity = {
        releaseId: releaseA.manifest.releaseId,
        releaseSequence: 65,
        semver: '4.9.6',
        channel: 'stable',
        platform: 'web',
        schemaVersion: 4,
        nativeVersion: '4.9.6',
        origin: 'ci_pipeline',
      };

      // Offline
      let online = false;
      const coord = new UpdateCoordinator({
        storage: new MemoryStorage(),
        adapter: new WebPwaUpdateAdapter({ getRuntimeIdentityFn: () => runtimeA }),
        baseUrl: server.baseUrl,
        isOnlineFn: () => online,
        manifestClient: {
          pointerUrl: `${server.baseUrl}release-pointer.json`,
          timeoutMs: 120,
          maxRetries: 0,
          delayFn: async () => {},
        },
      });
      const offSnap = await coord.checkForUpdates('manual');
      assert.equal(offSnap.state, 'OFFLINE');
      assert.equal(offSnap.error?.code, 'OFFLINE');

      // HTTP 503
      online = true;
      server.setMode('http503');
      const err503Snap = await coord.checkForUpdates('manual');
      assert.equal(err503Snap.state, 'CHECK_FAILED');
      assert.equal(err503Snap.error?.code, 'HTTP_ERROR');
      assert.equal(err503Snap.lastCheck?.httpStatus, 503);

      // Timeout
      server.setMode('hang');
      const timeoutSnap = await coord.checkForUpdates('manual');
      assert.equal(timeoutSnap.state, 'CHECK_FAILED');
      assert.equal(timeoutSnap.error?.code, 'TIMEOUT');
    } finally {
      await server.close();
    }
  });

  // 4. Missing asset (404), HTML returned for JS MIME, and tampered SHA-256 digest => FAILED (active preserved)
  await runCase('V7-04: Missing asset 404, HTML-for-JS MIME, and SHA-256 tamper fail closed without corrupting active release', async () => {
    const baseA = await buildRealReleaseBundle({ semver: '4.9.6', releaseSequence: 65, contentSeed: 'active-A' });
    const runtimeA: RuntimeReleaseIdentity = {
      releaseId: baseA.manifest.releaseId,
      releaseSequence: 65,
      semver: '4.9.6',
      channel: 'stable',
      platform: 'web',
      schemaVersion: 4,
      nativeVersion: '4.9.6',
      origin: 'ci_pipeline',
    };

    const tamperedProbe = await buildRealReleaseBundle({ semver: '4.9.7', releaseSequence: 66, contentSeed: 'tamper-B' });
    const jsEntry = tamperedProbe.manifest.entryScripts[0];

    const scenarios: Array<{ label: string; bundle: RealReleaseBundle; expectedCode: string }> = [
      {
        label: 'SHA-256 mismatch',
        bundle: await buildRealReleaseBundle({
          semver: '4.9.7',
          releaseSequence: 66,
          contentSeed: 'tamper-B',
          corruptAssetPath: jsEntry,
        }),
        expectedCode: 'DIGEST_MISMATCH',
      },
      {
        label: 'Missing 404 asset (partial deploy)',
        bundle: await buildRealReleaseBundle({
          semver: '4.9.7',
          releaseSequence: 66,
          contentSeed: 'tamper-B',
          omitAssetPath: jsEntry,
        }),
        expectedCode: 'ASSET_VERIFICATION_FAILED',
      },
      {
        label: 'HTML fallback returned for JS asset',
        bundle: await buildRealReleaseBundle({
          semver: '4.9.7',
          releaseSequence: 66,
          contentSeed: 'tamper-B',
          htmlForJsPath: jsEntry,
        }),
        expectedCode: 'ASSET_VERIFICATION_FAILED',
      },
    ];

    for (const sc of scenarios) {
      const server = await startReleaseHttpServer(sc.bundle);
      try {
        const coord = new UpdateCoordinator({
          storage: new MemoryStorage(),
          adapter: new WebPwaUpdateAdapter({ getRuntimeIdentityFn: () => runtimeA }),
          baseUrl: server.baseUrl,
          manifestClient: { pointerUrl: `${server.baseUrl}release-pointer.json`, maxRetries: 0 },
        });
        const checkSnap = await coord.checkForUpdates('manual');
        assert.equal(checkSnap.state, 'AVAILABLE', sc.label);

        const stageSnap = await coord.downloadAndVerifyCandidate();
        assert.equal(stageSnap.state, 'FAILED', sc.label);
        assert.equal(stageSnap.error?.code, sc.expectedCode, sc.label);
        assert.equal(stageSnap.installed.releaseId, baseA.manifest.releaseId, `${sc.label}: active release must stay intact`);
      } finally {
        await server.close();
      }
    }
  });

  // 5. Cryptographic signature verification: bad signature, unpinned key, revoked key, and HTTPS allowlist
  await runCase('V7-05: Bad signature, unpinned/revoked key, and untrusted HTTP/origin URLs rejected', async () => {
    const activeKey = await createEcdsaKeyPair('key-active', 'active');
    const revokedKey = await createEcdsaKeyPair('key-revoked', 'revoked');
    const rogueKey = await createEcdsaKeyPair('key-rogue', 'active');

    const signed = await buildRealReleaseBundle({
      semver: '4.9.7',
      releaseSequence: 66,
      contentSeed: 'sig-test',
      signingKey: { privateKey: activeKey.privateKey, keyId: activeKey.pinnedKey.keyId },
    });

    // Valid signature passes
    const validRes = await verifyManifestSignature(signed.manifest, [activeKey.pinnedKey], { requireSignature: true });
    assert.equal(validRes.ok, true);

    // Tampered manifest fails verification
    const tampered = { ...signed.manifest, releaseNotes: 'TAMPERED' };
    const tamperedRes = await verifyManifestSignature(tampered, [activeKey.pinnedKey], { requireSignature: true });
    assert.equal(tamperedRes.ok, false);

    // Revoked key fails
    const signedByRevoked = await buildRealReleaseBundle({
      semver: '4.9.7',
      releaseSequence: 66,
      contentSeed: 'sig-revoked',
      signingKey: { privateKey: revokedKey.privateKey, keyId: revokedKey.pinnedKey.keyId },
    });
    const revokedRes = await verifyManifestSignature(signedByRevoked.manifest, [revokedKey.pinnedKey], { requireSignature: true });
    assert.equal(revokedRes.ok, false);

    // Unpinned rogue key fails
    const signedByRogue = await buildRealReleaseBundle({
      semver: '4.9.7',
      releaseSequence: 66,
      contentSeed: 'sig-rogue',
      signingKey: { privateKey: rogueKey.privateKey, keyId: rogueKey.pinnedKey.keyId },
    });
    const rogueRes = await verifyManifestSignature(signedByRogue.manifest, [activeKey.pinnedKey], { requireSignature: true });
    assert.equal(rogueRes.ok, false);

    // HTTPS allowlist
    assert.equal(isAllowedReleaseUrl('https://galaxy1364.github.io/Dendalcare/release-pointer.json'), true);
    assert.equal(isAllowedReleaseUrl('http://galaxy1364.github.io/Dendalcare/release-pointer.json'), false);
    assert.equal(isAllowedReleaseUrl('https://evil.example.com/release-pointer.json'), false);
    assert.equal(isAllowedReleaseUrl('../etc/passwd'), false);
  });

  // 6. Safe-point consensus: dirty clinical form & non-empty offline payment queue defer activation with zero data loss
  await runCase('V7-06: Safe-point consensus blocks activation while dirty form or offline queue exists and resumes cleanly', async () => {
    const releaseA = await buildRealReleaseBundle({ semver: '4.9.6', releaseSequence: 65, contentSeed: 'safe-A' });
    const releaseB = await buildRealReleaseBundle({ semver: '4.9.7', releaseSequence: 66, contentSeed: 'safe-B' });
    const server = await startReleaseHttpServer(releaseB);
    try {
      let offlineQueueCount = 2;
      const runtimeA: RuntimeReleaseIdentity = {
        releaseId: releaseA.manifest.releaseId,
        releaseSequence: 65,
        semver: '4.9.6',
        channel: 'stable',
        platform: 'web',
        schemaVersion: 4,
        nativeVersion: '4.9.6',
        origin: 'ci_pipeline',
      };

      const coord = new UpdateCoordinator({
        storage: new MemoryStorage(),
        adapter: new WebPwaUpdateAdapter({ getRuntimeIdentityFn: () => runtimeA }),
        baseUrl: server.baseUrl,
        manifestClient: { pointerUrl: `${server.baseUrl}release-pointer.json`, maxRetries: 0 },
        getOfflineQueueCount: () => offlineQueueCount,
      });
      coord.setAutoUpdateEnabled(false);

      const releaseFormGuard = coord.registerBusyGuard('patient-treatment-form', 'ثبت پرونده درمان بیمار');
      await coord.checkForUpdates('manual');
      const staged = await coord.downloadAndVerifyCandidate();
      assert.equal(staged.state, 'WAITING_FOR_SAFE_POINT');
      assert.equal(staged.safePoint.isSafe, false);
      assert.ok(staged.safePoint.blockers.length >= 2);

      // Attempting activation without force stays in WAITING_FOR_SAFE_POINT
      const deferredAct = await coord.activateVerifiedCandidate();
      assert.equal(deferredAct.state, 'WAITING_FOR_SAFE_POINT');

      // Clear queue and release dirty form guard -> automatically transitions to READY_TO_ACTIVATE
      offlineQueueCount = 0;
      releaseFormGuard();
      await new Promise((r) => setTimeout(r, 15));
      assert.equal(coord.getSnapshot().state, 'READY_TO_ACTIVATE');
      assert.equal(coord.getSnapshot().safePoint.isSafe, true);
    } finally {
      await server.close();
    }
  });

  // 7. Post-boot mismatch -> ROLLBACK_PENDING -> ROLLED_BACK + Reload Cap blocks infinite reload loops
  await runCase('V7-07: Boot mismatch enters ROLLBACK_PENDING -> ROLLED_BACK and reload cap prevents infinite loops', async () => {
    const releaseA = await buildRealReleaseBundle({ semver: '4.9.6', releaseSequence: 65, contentSeed: 'rbk-A' });
    const releaseB = await buildRealReleaseBundle({ semver: '4.9.7', releaseSequence: 66, contentSeed: 'rbk-B' });
    const server = await startReleaseHttpServer(releaseB);
    try {
      const storage = new MemoryStorage();
      const runtimeA: RuntimeReleaseIdentity = {
        releaseId: releaseA.manifest.releaseId,
        releaseSequence: 65,
        semver: '4.9.6',
        channel: 'stable',
        platform: 'web',
        schemaVersion: 4,
        nativeVersion: '4.9.6',
        origin: 'ci_pipeline',
      };

      let reloads = 0;
      const adapter = new WebPwaUpdateAdapter({
        getRuntimeIdentityFn: () => runtimeA,
        reloadFn: () => {
          reloads += 1;
        },
      });

      const coord = new UpdateCoordinator({
        storage,
        adapter,
        baseUrl: server.baseUrl,
        manifestClient: { pointerUrl: `${server.baseUrl}release-pointer.json`, maxRetries: 0 },
        getOfflineQueueCount: () => 0,
      });

      // Establish verified LKG baseline on Release A before attempting upgrade to B
      await coord.verifyPostBoot();

      await coord.checkForUpdates('manual');
      await coord.downloadAndVerifyCandidate();

      // Attempt 1 activates (reloads=1), then reboot still runs A -> BOOT_MISMATCH -> ROLLBACK_PENDING
      await coord.activateVerifiedCandidate({ allowReload: true });
      assert.equal(reloads, 1);

      const postBootFail = await coord.verifyPostBoot();
      assert.equal(postBootFail.state, 'ROLLBACK_PENDING');
      assert.equal(postBootFail.error?.code, 'BOOT_MISMATCH');
      assert.equal(postBootFail.installed.releaseId, releaseA.manifest.releaseId);

      // Attempt 2 activates (reloads=2), Attempt 3 MUST be blocked by RELOAD_LIMIT_REACHED!
      await coord.activateVerifiedCandidate({ allowReload: true });
      assert.equal(reloads, 2);
      const cappedSnap = await coord.activateVerifiedCandidate({ allowReload: true });
      assert.equal(cappedSnap.state, 'FAILED');
      assert.equal(cappedSnap.error?.code, 'RELOAD_LIMIT_REACHED');
      assert.equal(reloads, 2, 'Reload cap MUST prevent a 3rd reload loop');

      // Acknowledge rollback cleanly verifies live LKG handshake and returns to ROLLED_BACK
      const rolledSnap = await coord.acknowledgeRollbackToLastKnownGood();
      assert.equal(rolledSnap.state, 'ROLLED_BACK');
      assert.equal(rolledSnap.pendingActivation, null);
    } finally {
      await server.close();
    }
  });

  // 8. Downgrade, replay, revocation, forward-rollback, and schema migration checks
  await runCase('V7-08: Downgrade, replay, revocation, schema mismatch rejected; forward rollback release accepted', async () => {
    const r65 = await buildRealReleaseBundle({ semver: '4.9.6', releaseSequence: 65, contentSeed: 'r65' });
    const r64 = await buildRealReleaseBundle({ semver: '4.9.5', releaseSequence: 64, contentSeed: 'r64' });
    const r66Revoked = await buildRealReleaseBundle({ semver: '4.9.7', releaseSequence: 66, contentSeed: 'r66', revoked: true });
    const r67Schema5 = await buildRealReleaseBundle({ semver: '5.0.0', releaseSequence: 67, contentSeed: 'r67', minSchemaVersion: 5 });
    const r68ForwardRollback = await buildRealReleaseBundle({ semver: '4.9.6', releaseSequence: 68, contentSeed: 'r65-hotfix-rollback' });

    const runtime65: RuntimeReleaseIdentity = {
      releaseId: r65.manifest.releaseId,
      releaseSequence: 65,
      semver: '4.9.6',
      channel: 'stable',
      platform: 'web',
      schemaVersion: 4,
      nativeVersion: '4.9.6',
      origin: 'ci_pipeline',
    };

    assert.equal(compareReleases(runtime65, r64.manifest).kind, 'DOWNGRADE_REJECTED');
    assert.equal(compareReleases(runtime65, r65.manifest, { highestSeenSequence: 67 }).kind, 'SAME_ARTIFACT');
    assert.equal(
      compareReleases(runtime65, { ...r68ForwardRollback.manifest, releaseSequence: 66 }, { highestSeenSequence: 67 }).kind,
      'REPLAY_REJECTED'
    );
    assert.equal(compareReleases(runtime65, r66Revoked.manifest).kind, 'RELEASE_REVOKED');
    assert.equal(
      compareReleases(runtime65, r68ForwardRollback.manifest, { revokedReleaseIds: [r68ForwardRollback.manifest.releaseId] }).kind,
      'RELEASE_REVOKED'
    );
    assert.equal(compareReleases(runtime65, r67Schema5.manifest).kind, 'MIGRATION_REQUIRED');
    assert.equal(compareReleases(runtime65, r68ForwardRollback.manifest).kind, 'UPGRADE');
  });

  // 9. Untrusted Realtime hint without releaseId is ignored; client broadcast never mutates installed ledger
  await runCase('V7-09: Untrusted Realtime hint without valid releaseId is ignored and client broadcast never claims install authority', async () => {
    const releaseA = await buildRealReleaseBundle({ semver: '4.9.6', releaseSequence: 65, contentSeed: 'hint-A' });
    const storage = new MemoryStorage();
    const ledger = new UpdateLedger(storage);
    const runtimeA: RuntimeReleaseIdentity = {
      releaseId: releaseA.manifest.releaseId,
      releaseSequence: 65,
      semver: '4.9.6',
      channel: 'stable',
      platform: 'web',
      schemaVersion: 4,
      nativeVersion: '4.9.6',
      origin: 'ci_pipeline',
    };

    const coord = new UpdateCoordinator({
      storage,
      ledger,
      adapter: new WebPwaUpdateAdapter({ getRuntimeIdentityFn: () => runtimeA }),
    });

    const beforeChecks = coord.getSnapshot().metrics.checksTotal;
    await coord.handleRealtimeHint({ version: '9.9.9', build: 999 }); // Missing releaseId!
    const afterSnap = coord.getSnapshot();
    assert.equal(afterSnap.metrics.checksTotal, beforeChecks, 'Untrusted push without releaseId must NOT trigger check');
    assert.ok(afterSnap.recentDiagnostics.some((d) => d.event === 'REALTIME_HINT_IGNORED_INVALID_RELEASE_ID'));

    // Legacy client broadcast helper must NOT write installed release ledger
    const installedBefore = ledger.getInstalledRelease(runtimeA).verifiedAt;
    await broadcastNewAppBuild({ version: '4.9.6', build: 65, notes: 'hint-only' });
    assert.equal(ledger.getInstalledRelease(runtimeA).verifiedAt, installedBefore);
  });

  // 10. Honest Native Android & iOS adapters require store update (NEVER fake INSTALLED)
  await runCase('V7-10: Android WebView & iOS App Store adapters report NATIVE_STORE_REQUIRED with zero fake install', async () => {
    const releaseB = await buildRealReleaseBundle({
      semver: '5.0.0',
      releaseSequence: Math.max(70, CURRENT_APP_BUILD + 5),
      contentSeed: 'native-B',
      minNativeVersion: '5.0.0',
    });
    const server = await startReleaseHttpServer(releaseB);
    try {
      for (const nativePlatform of ['android', 'ios'] as const) {
        const unconfiguredAdapter = new NativePlatformUpdateAdapter(nativePlatform);
        const unconfiguredCaps = unconfiguredAdapter.getCapabilities();
        assert.equal(unconfiguredCaps.supportsInAppBinaryInstall, false, `${nativePlatform} must NOT claim in-app silent APK/IPA install`);
        assert.equal(unconfiguredCaps.supportsStoreDeepLink, false, `${nativePlatform} must report supportsStoreDeepLink=false until store URL is configured`);

        const configuredStoreUrl =
          nativePlatform === 'android'
            ? 'https://play.google.com/store/apps/details?id=com.minadental.app'
            : 'https://apps.apple.com/app/id1234567890';
        const nativeAdapter = new NativePlatformUpdateAdapter(nativePlatform, null, {
          verifiedStoreUrl: configuredStoreUrl,
        });
        const caps = nativeAdapter.getCapabilities();
        assert.equal(caps.supportsStoreDeepLink, true);

        const coord = new UpdateCoordinator({
          storage: new MemoryStorage(),
          adapter: nativeAdapter,
          baseUrl: server.baseUrl,
          manifestClient: { pointerUrl: `${server.baseUrl}release-pointer.json`, maxRetries: 0 },
        });

        const snap = await coord.checkForUpdates('manual');
        assert.equal(snap.state, 'NATIVE_STORE_REQUIRED', `${nativePlatform} must transition to NATIVE_STORE_REQUIRED (error: ${JSON.stringify(snap.error)})`);
        const stageSnap = await coord.downloadAndVerifyCandidate();
        assert.equal(stageSnap.state, 'NATIVE_STORE_REQUIRED');
        assert.notEqual(stageSnap.state, 'INSTALLED');
      }
    } finally {
      await server.close();
    }
  });

  // 11. Cache hygiene + SHA-256 helper + State transition table integrity + Zero PII in diagnostics
  await runCase('V7-11: State transition table strictness, SHA-256 parity, and zero PII/token leakage in diagnostics', async () => {
    assert.equal(canTransitionUpdateState('IDLE', 'INSTALLED'), false, 'IDLE -> INSTALLED shortcut MUST be forbidden');
    assert.equal(canTransitionUpdateState('AVAILABLE', 'INSTALLED'), false, 'AVAILABLE -> INSTALLED shortcut MUST be forbidden');
    assert.equal(canTransitionUpdateState('BOOT_VERIFYING', 'INSTALLED'), true, 'Only BOOT_VERIFYING -> INSTALLED allowed');
    assert.ok(ALLOWED_UPDATE_TRANSITIONS.BOOT_VERIFYING.includes('ROLLBACK_PENDING'));

    const digest = await computeSha256Hex(new TextEncoder().encode('minadental-v7'));
    assert.equal(digest, sha256Hex('minadental-v7'));

    // Verify diagnostics scrub Bearer tokens & phone numbers
    const coord = new UpdateCoordinator({
      storage: new MemoryStorage(),
      manifestClient: {
        pointerUrl: 'http://evil.invalid/token=eyJhbGciOiJIUzI1NiJ9.secret.sig',
      },
    });
    const snap = await coord.checkForUpdates('manual');
    assert.equal(snap.state, 'CHECK_FAILED');
    assert.equal(snap.error?.code, 'ORIGIN_NOT_ALLOWED');
    const serializedDiag = JSON.stringify(snap.recentDiagnostics);
    assert.ok(!serializedDiag.includes('eyJhbGciOiJIUzI1NiJ9'), 'JWT must be redacted from update diagnostics');
  });

  return results;
}
