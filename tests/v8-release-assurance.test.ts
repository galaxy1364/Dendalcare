import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {
  UpdateCoordinator,
  UpdateLedger,
  WebPwaUpdateAdapter,
  NativePlatformUpdateAdapter,
  compareReleases,
  isAllowedReleaseUrl,
  type AuthoritativeReleaseManifest,
  type ReleasePointer,
  type RuntimeReleaseIdentity,
  type StorageLike,
} from '../src/services/updates';
import {
  appBootstrap,
  markModuleEvaluated,
  markRouteRendered,
  markShellCommitted,
} from '../src/app/bootstrapState';
import {
  computeMonotonicSequence,
  parseStrictPositiveInt,
  verifyRemoteDeployment,
} from '../scripts/ci-release-gate.mjs';

export interface V8TestResult {
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

function sha256Hex(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function buildBundle(opts: {
  semver: string;
  releaseSequence: number;
  seed: string;
  channel?: 'stable' | 'staging' | 'canary';
  expiresAt?: string;
  contentDigestOverride?: string;
  assetSizeMismatch?: boolean;
}) {
  const entryJs = Buffer.from(`console.log("mina-v8-${opts.seed}-${opts.releaseSequence}");\n`, 'utf8');
  const entryCss = Buffer.from(`:root{--v8:"${opts.seed}"}\n`, 'utf8');
  const indexHtml = Buffer.from(
    `<!doctype html><html lang="fa" dir="rtl"><head><title>MinaDental</title></head><body><div id="root"></div></body></html>`,
    'utf8'
  );
  const contentDigest = opts.contentDigestOverride ?? sha256Hex(`${opts.semver}:${opts.seed}`);
  const shortHash = contentDigest.slice(0, 10);
  const releaseId = `v${opts.semver}-${shortHash}`;
  const jsPath = `./assets/index-${shortHash}.js`;
  const cssPath = `./assets/index-${shortHash}.css`;
  const channel = opts.channel ?? 'stable';

  const manifest: AuthoritativeReleaseManifest = {
    schemaVersion: 2,
    releaseId,
    releaseSequence: opts.releaseSequence,
    semver: opts.semver,
    gitCommit: sha256Hex(opts.seed).slice(0, 40),
    channel,
    platform: 'web',
    minNativeVersion: '4.9.0',
    minSchemaVersion: 4,
    publishedAt: new Date().toISOString(),
    ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
    contentDigest,
    releaseNotes: `انتشار V8 ${opts.semver} (#${opts.releaseSequence})`,
    entryScripts: [jsPath],
    entryStyles: [cssPath],
    assets: [
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
        size: opts.assetSizeMismatch ? entryJs.byteLength + 99 : entryJs.byteLength,
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
    ],
    urgency: 'standard',
    revoked: false,
    origin: 'ci_pipeline',
    rollbackPolicy: {
      strategy: 'forward_release',
      minRollbackSequence: opts.releaseSequence,
      schemaBackwardCompatible: true,
      preserveUserData: true,
    },
  };

  const pointer: ReleasePointer = {
    schemaVersion: 2,
    channel,
    platform: 'web',
    currentReleaseId: releaseId,
    releaseSequence: opts.releaseSequence,
    manifestUrl: `./releases/${releaseId}/release-manifest.json`,
    updatedAt: manifest.publishedAt,
    revokedReleaseIds: [],
    minSupportedSequence: 1,
  };

  const files: Record<string, { body: Buffer; contentType: string }> = {
    '/release-pointer.json': {
      body: Buffer.from(JSON.stringify(pointer, null, 2), 'utf8'),
      contentType: 'application/json; charset=utf-8',
    },
    [`/releases/${releaseId}/release-manifest.json`]: {
      body: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
      contentType: 'application/json; charset=utf-8',
    },
    [`/releases/${releaseId}/index.html`]: {
      body: indexHtml,
      contentType: 'text/html; charset=utf-8',
    },
    [`/releases/${releaseId}/assets/index-${shortHash}.js`]: {
      body: entryJs,
      contentType: 'application/javascript; charset=utf-8',
    },
    [`/releases/${releaseId}/assets/index-${shortHash}.css`]: {
      body: entryCss,
      contentType: 'text/css; charset=utf-8',
    },
    '/index.html': {
      body: indexHtml,
      contentType: 'text/html; charset=utf-8',
    },
    [`/assets/index-${shortHash}.js`]: {
      body: entryJs,
      contentType: 'application/javascript; charset=utf-8',
    },
    [`/assets/index-${shortHash}.css`]: {
      body: entryCss,
      contentType: 'text/css; charset=utf-8',
    },
  };

  return { pointer, manifest, files, etag: `"${releaseId}-${opts.releaseSequence}"` };
}

async function startCustomServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export async function runAllV8ReleaseAssuranceTests(): Promise<V8TestResult[]> {
  const results: V8TestResult[] = [];

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

  // V8-01: Autonomous end-to-end auto-update vs Manual mode
  await runCase('V8-01: Autonomous auto-update transitions A->B->BOOT_VERIFYING when idle; manual mode stops at AVAILABLE', async () => {
    const bundleA = buildBundle({ semver: '4.9.6', releaseSequence: 70, seed: 'auto-A' });
    const bundleB = buildBundle({ semver: '4.9.7', releaseSequence: 71, seed: 'auto-B' });

    const srv = await startCustomServer((req, res) => {
      const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      const file = bundleB.files[pathname];
      if (!file) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': file.contentType });
      res.end(file.body);
    });

    try {
      const runtimeA: RuntimeReleaseIdentity = {
        releaseId: bundleA.manifest.releaseId,
        releaseSequence: 70,
        semver: '4.9.6',
        channel: 'stable',
        platform: 'web',
        schemaVersion: 4,
        nativeVersion: '4.9.6',
        contentDigest: bundleA.manifest.contentDigest,
        origin: 'ci_pipeline',
      };

      // Autonomous mode ON -> poll automatically checks, downloads, verifies, and activates!
      let autoReloads = 0;
      const autoCoord = new UpdateCoordinator({
        storage: new MemoryStorage(),
        adapter: new WebPwaUpdateAdapter({
          getRuntimeIdentityFn: () => runtimeA,
          reloadFn: () => {
            autoReloads += 1;
          },
        }),
        baseUrl: srv.baseUrl,
        manifestClient: { pointerUrl: `${srv.baseUrl}release-pointer.json`, maxRetries: 0 },
        getOfflineQueueCount: () => 0,
      });
      autoCoord.setAutoUpdateEnabled(true);
      const autoSnap = await autoCoord.checkForUpdates('poll');
      assert.equal(autoSnap.state, 'BOOT_VERIFYING', 'Autonomous mode must reach BOOT_VERIFYING without manual click');
      assert.equal(autoReloads, 1, 'Autonomous mode must trigger single controlled reload');
      assert.equal(autoSnap.pendingActivation?.targetReleaseId, bundleB.manifest.releaseId);

      // Manual mode OFF -> poll stops at AVAILABLE (zero automatic reload)
      let manualReloads = 0;
      const manualCoord = new UpdateCoordinator({
        storage: new MemoryStorage(),
        adapter: new WebPwaUpdateAdapter({
          getRuntimeIdentityFn: () => runtimeA,
          reloadFn: () => {
            manualReloads += 1;
          },
        }),
        baseUrl: srv.baseUrl,
        manifestClient: { pointerUrl: `${srv.baseUrl}release-pointer.json`, maxRetries: 0 },
        getOfflineQueueCount: () => 0,
      });
      manualCoord.setAutoUpdateEnabled(false);
      const manualSnap = await manualCoord.checkForUpdates('poll');
      assert.equal(manualSnap.state, 'AVAILABLE', 'Manual mode must stop at AVAILABLE');
      assert.equal(manualReloads, 0);
    } finally {
      await srv.close();
    }
  });

  // V8-02: Safe-point unblock auto-resume & defer expiry auto-resume
  await runCase('V8-02: Auto-update pauses while dirty clinical form is active and auto-activates when form clears', async () => {
    const bundleA = buildBundle({ semver: '4.9.6', releaseSequence: 70, seed: 'resume-A' });
    const bundleB = buildBundle({ semver: '4.9.7', releaseSequence: 71, seed: 'resume-B' });

    const srv = await startCustomServer((req, res) => {
      const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      const file = bundleB.files[pathname];
      if (!file) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': file.contentType });
      res.end(file.body);
    });

    try {
      let reloads = 0;
      const runtimeA: RuntimeReleaseIdentity = {
        releaseId: bundleA.manifest.releaseId,
        releaseSequence: 70,
        semver: '4.9.6',
        channel: 'stable',
        platform: 'web',
        schemaVersion: 4,
        nativeVersion: '4.9.6',
        origin: 'ci_pipeline',
      };
      const coord = new UpdateCoordinator({
        storage: new MemoryStorage(),
        adapter: new WebPwaUpdateAdapter({
          getRuntimeIdentityFn: () => runtimeA,
          reloadFn: () => {
            reloads += 1;
          },
        }),
        baseUrl: srv.baseUrl,
        manifestClient: { pointerUrl: `${srv.baseUrl}release-pointer.json`, maxRetries: 0 },
        getOfflineQueueCount: () => 0,
      });
      coord.setAutoUpdateEnabled(true);

      const releaseGuard = coord.registerBusyGuard('patient_form_dirty', 'فرم بیمار باز است');
      const blockedSnap = await coord.checkForUpdates('poll');
      assert.equal(blockedSnap.state, 'WAITING_FOR_SAFE_POINT');
      assert.equal(reloads, 0, 'Must NOT reload while clinical form is dirty');

      // Releasing clinical form guard must automatically resume and activate!
      releaseGuard();
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(coord.getSnapshot().state, 'BOOT_VERIFYING');
      assert.equal(reloads, 1);
    } finally {
      await srv.close();
    }
  });

  // V8-03: Cross-tab fencing-token lease collision & renewal
  await runCase('V8-03: Cross-tab leader lease uses monotonic fencing token and rejects colliding tab', () => {
    const storage = new MemoryStorage();
    const ledger = new UpdateLedger(storage);

    const lease1 = ledger.tryAcquireLeaderLeaseWithFence('tab-1', 5_000, 'global', 1_000);
    assert.equal(lease1.acquired, true, 'First tab should acquire lease');
    assert.equal(lease1.fencingToken, 1);

    const collide = ledger.tryAcquireLeaderLeaseWithFence('tab-2', 5_000, 'global', 2_000);
    assert.equal(collide.acquired, false, 'Second tab must be blocked while first lease is live');

    assert.equal(ledger.renewLeaderLease('tab-1', lease1.fencingToken, 5_000, 'global', 3_000), true);
    assert.equal(ledger.renewLeaderLease('tab-1', 999, 5_000, 'global', 3_500), false, 'Wrong fencing token cannot renew');

    // After expiry, tab-2 acquires with higher fencing token
    const lease2 = ledger.tryAcquireLeaderLeaseWithFence('tab-2', 5_000, 'global', 10_000);
    assert.equal(lease2.acquired, true);
    assert.ok(lease2.fencingToken > lease1.fencingToken, 'Fencing token must strictly increase');
  });

  // V8-04: Body-read stall timeout (headers sent immediately, body hangs)
  await runCase('V8-04: Streaming body-read stall after HTTP 200 headers aborts cleanly with TIMEOUT', async () => {
    const bundleB = buildBundle({ semver: '4.9.7', releaseSequence: 71, seed: 'body-stall' });
    const jsPath = bundleB.manifest.entryScripts[0].replace(/^\./, '');

    const srv = await startCustomServer((req, res) => {
      const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      if (pathname.endsWith(jsPath)) {
        // Send HTTP 200 headers immediately, then NEVER finish body!
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        res.write('console.log("partial');
        req.on('close', () => {
          try {
            res.end();
          } catch {
            // ignore
          }
        });
        return;
      }
      const file = bundleB.files[pathname];
      if (!file) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': file.contentType });
      res.end(file.body);
    });

    try {
      const bundleA = buildBundle({ semver: '4.9.6', releaseSequence: 70, seed: 'body-stall-A' });
      const coord = new UpdateCoordinator({
        storage: new MemoryStorage(),
        adapter: new WebPwaUpdateAdapter({
          getRuntimeIdentityFn: () => ({
            releaseId: bundleA.manifest.releaseId,
            releaseSequence: 70,
            semver: '4.9.6',
            channel: 'stable',
            platform: 'web',
            schemaVersion: 4,
            nativeVersion: '4.9.6',
            origin: 'ci_pipeline',
          }),
        }),
        baseUrl: srv.baseUrl,
        manifestClient: {
          pointerUrl: `${srv.baseUrl}release-pointer.json`,
          timeoutMs: 180,
          stageTotalDeadlineMs: 800,
          maxRetries: 0,
          delayFn: async () => {},
        },
      });
      coord.setAutoUpdateEnabled(false);

      const avail = await coord.checkForUpdates('manual');
      assert.equal(avail.state, 'AVAILABLE');
      const staged = await coord.downloadAndVerifyCandidate();
      assert.equal(staged.state, 'FAILED');
      assert.equal(staged.error?.code, 'TIMEOUT', 'Body-read stall must terminate with TIMEOUT');
    } finally {
      await srv.close();
    }
  });

  // V8-05: Byte-size mismatch, QuotaExceededError, cross-origin redirect, double percent-encoded traversal
  await runCase('V8-05: SIZE_MISMATCH, STORAGE_QUOTA_EXCEEDED, cross-origin redirect, and %252e%252e traversal rejected', async () => {
    // 1. Double percent-encoded traversal
    assert.equal(isAllowedReleaseUrl('./releases/%252e%252e/secret.json', 'https://galaxy1364.github.io/Dendalcare/'), false);
    assert.equal(isAllowedReleaseUrl('./releases/%2e%2e/secret.json', 'https://galaxy1364.github.io/Dendalcare/'), false);
    assert.equal(isAllowedReleaseUrl('./releases/v4.9.7-abcdef0123/release-manifest.json', 'https://galaxy1364.github.io/Dendalcare/'), true);

    // 2. SIZE_MISMATCH
    const sizeBad = buildBundle({ semver: '4.9.7', releaseSequence: 71, seed: 'size-bad', assetSizeMismatch: true });
    const srvSize = await startCustomServer((req, res) => {
      const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      const file = sizeBad.files[pathname];
      if (!file) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': file.contentType });
      res.end(file.body);
    });

    try {
      const runtimeA: RuntimeReleaseIdentity = {
        releaseId: 'v4.9.6-0000000001',
        releaseSequence: 70,
        semver: '4.9.6',
        channel: 'stable',
        platform: 'web',
        schemaVersion: 4,
        nativeVersion: '4.9.6',
        origin: 'ci_pipeline',
      };
      const coordSize = new UpdateCoordinator({
        storage: new MemoryStorage(),
        adapter: new WebPwaUpdateAdapter({ getRuntimeIdentityFn: () => runtimeA }),
        baseUrl: srvSize.baseUrl,
        manifestClient: { pointerUrl: `${srvSize.baseUrl}release-pointer.json`, maxRetries: 0 },
      });
      coordSize.setAutoUpdateEnabled(false);
      await coordSize.checkForUpdates('manual');
      const stageRes = await coordSize.downloadAndVerifyCandidate();
      assert.equal(stageRes.state, 'FAILED');
      assert.equal(stageRes.error?.code, 'SIZE_MISMATCH');

      // 3. QuotaExceededError during candidate asset persistence
      const goodBundle = buildBundle({ semver: '4.9.7', releaseSequence: 72, seed: 'quota-test' });
      const srvQuota = await startCustomServer((req, res) => {
        const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
        const file = goodBundle.files[pathname];
        if (!file) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'Content-Type': file.contentType });
        res.end(file.body);
      });
      try {
        const quotaCacheStorage = {
          open: async () =>
            ({
              put: async () => {
                const err = new Error('Storage quota exceeded');
                err.name = 'QuotaExceededError';
                throw err;
              },
              match: async () => undefined,
              delete: async () => true,
            }) as unknown as Cache,
          keys: async () => [],
          delete: async () => true,
          has: async () => false,
          match: async () => undefined,
        } as unknown as CacheStorage;
        const quotaAdapter = new WebPwaUpdateAdapter({
          getRuntimeIdentityFn: () => runtimeA,
          cacheStorage: quotaCacheStorage,
        });
        const coordQuota = new UpdateCoordinator({
          storage: new MemoryStorage(),
          adapter: quotaAdapter,
          baseUrl: srvQuota.baseUrl,
          manifestClient: { pointerUrl: `${srvQuota.baseUrl}release-pointer.json`, maxRetries: 0 },
        });
        coordQuota.setAutoUpdateEnabled(false);
        await coordQuota.checkForUpdates('manual');
        const qRes = await coordQuota.downloadAndVerifyCandidate();
        assert.equal(qRes.state, 'FAILED');
        assert.equal(qRes.error?.code, 'STORAGE_QUOTA_EXCEEDED');
      } finally {
        await srvQuota.close();
      }
    } finally {
      await srvSize.close();
    }
  });

  // V8-06: SW activation fail-closed + public/sw.js has zero FORCE_UPDATE handler
  await runCase('V8-06: SW activation fails closed on worker mismatch/missing inventory and sw.js forbids FORCE_UPDATE', async () => {
    const swSrc = fs.readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8');
    assert.ok(!/['"]FORCE_UPDATE['"]/.test(swSrc), 'public/sw.js must NEVER retain a FORCE_UPDATE message branch');
    assert.ok(swSrc.includes('VERIFY_CACHE_INVENTORY'), 'public/sw.js must implement VERIFY_CACHE_INVENTORY');
    assert.ok(swSrc.includes('targetReleaseId'), 'public/sw.js SKIP_WAITING must require exact targetReleaseId');
    assert.ok(swSrc.includes('CLIENT_RELEASE_LEASE'), 'public/sw.js must implement client-aware cache retention');

    const bundleA = buildBundle({ semver: '4.9.6', releaseSequence: 70, seed: 'sw-A' });
    const bundleB = buildBundle({ semver: '4.9.7', releaseSequence: 71, seed: 'sw-B' });
    const srv = await startCustomServer((req, res) => {
      const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      const file = bundleB.files[pathname];
      if (!file) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': file.contentType });
      res.end(file.body);
    });

    try {
      let reloads = 0;
      const fakeReg = {
        waiting: { postMessage: () => {} },
        installing: null,
        active: { postMessage: () => {} },
        update: async () => {
          throw new Error('SW update network error');
        },
      } as unknown as ServiceWorkerRegistration;

      const failingSwAdapter = new WebPwaUpdateAdapter({
        getRuntimeIdentityFn: () => ({
          releaseId: bundleA.manifest.releaseId,
          releaseSequence: 70,
          semver: '4.9.6',
          channel: 'stable',
          platform: 'web',
          schemaVersion: 4,
          nativeVersion: '4.9.6',
          origin: 'ci_pipeline',
        }),
        getRegistrationFn: async () => fakeReg,
        reloadFn: () => {
          reloads += 1;
        },
      });

      const coord = new UpdateCoordinator({
        storage: new MemoryStorage(),
        adapter: failingSwAdapter,
        baseUrl: srv.baseUrl,
        manifestClient: { pointerUrl: `${srv.baseUrl}release-pointer.json`, maxRetries: 0 },
        getOfflineQueueCount: () => 0,
      });
      coord.setAutoUpdateEnabled(false);
      await coord.checkForUpdates('manual');
      await coord.downloadAndVerifyCandidate();
      const actSnap = await coord.activateVerifiedCandidate({ allowReload: true });
      assert.equal(actSnap.state, 'FAILED', 'Failed reg.update() MUST fail closed');
      assert.ok(
        actSnap.error?.code === 'ASSET_VERIFICATION_FAILED' || actSnap.error?.code === 'ACTIVATION_TIMEOUT',
        `Expected fail-closed verification/activation error code, got ${actSnap.error?.code}`
      );
      assert.equal(reloads, 0, 'Must NOT trigger reload when SW activation fails');
    } finally {
      await srv.close();
    }
  });

  // V8-07: Guarded rollback refuses unverified LKG baseline and passes verified LKG baseline
  await runCase('V8-07: Unverified LKG refuses fake ROLLED_BACK; verified LKG passes live handshake into ROLLED_BACK', async () => {
    const bundleA = buildBundle({ semver: '4.9.6', releaseSequence: 70, seed: 'lkg-A' });
    const bundleB = buildBundle({ semver: '4.9.7', releaseSequence: 71, seed: 'lkg-B' });
    const srv = await startCustomServer((req, res) => {
      const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      const file = bundleB.files[pathname];
      if (!file) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': file.contentType });
      res.end(file.body);
    });

    try {
      const runtimeA: RuntimeReleaseIdentity = {
        releaseId: bundleA.manifest.releaseId,
        releaseSequence: 70,
        semver: '4.9.6',
        channel: 'stable',
        platform: 'web',
        schemaVersion: 4,
        nativeVersion: '4.9.6',
        origin: 'ci_pipeline',
      };

      // Case 1: NO prior verifyPostBoot() => lastKnownGoodReleaseId is null => MUST refuse ROLLED_BACK!
      const unverifiedCoord = new UpdateCoordinator({
        storage: new MemoryStorage(),
        adapter: new WebPwaUpdateAdapter({ getRuntimeIdentityFn: () => runtimeA, reloadFn: () => {} }),
        baseUrl: srv.baseUrl,
        manifestClient: { pointerUrl: `${srv.baseUrl}release-pointer.json`, maxRetries: 0 },
        getOfflineQueueCount: () => 0,
      });
      unverifiedCoord.setAutoUpdateEnabled(false);
      await unverifiedCoord.checkForUpdates('manual');
      await unverifiedCoord.downloadAndVerifyCandidate();
      await unverifiedCoord.activateVerifiedCandidate({ allowReload: true });
      const failBoot = await unverifiedCoord.verifyPostBoot();
      assert.equal(failBoot.state, 'ROLLBACK_PENDING');

      const refusedRollback = await unverifiedCoord.acknowledgeRollbackToLastKnownGood();
      assert.notEqual(refusedRollback.state, 'ROLLED_BACK', 'Must NOT claim ROLLED_BACK without verified LKG baseline');
      assert.equal(refusedRollback.state, 'ROLLBACK_PENDING');
      assert.equal(refusedRollback.error?.code, 'RECOVERY_VERIFICATION_FAILED');

      // Case 2: Prior verifyPostBoot() verified A as LKG => rollback verifies live A and transitions to ROLLED_BACK!
      const verifiedCoord = new UpdateCoordinator({
        storage: new MemoryStorage(),
        adapter: new WebPwaUpdateAdapter({ getRuntimeIdentityFn: () => runtimeA, reloadFn: () => {} }),
        baseUrl: srv.baseUrl,
        manifestClient: { pointerUrl: `${srv.baseUrl}release-pointer.json`, maxRetries: 0 },
        getOfflineQueueCount: () => 0,
      });
      verifiedCoord.setAutoUpdateEnabled(false);
      await verifiedCoord.verifyPostBoot(); // Establishes verified LKG A
      await verifiedCoord.checkForUpdates('manual');
      await verifiedCoord.downloadAndVerifyCandidate();
      await verifiedCoord.activateVerifiedCandidate({ allowReload: true });
      await verifiedCoord.verifyPostBoot(); // Fails boot -> ROLLBACK_PENDING
      const okRollback = await verifiedCoord.acknowledgeRollbackToLastKnownGood();
      assert.equal(okRollback.state, 'ROLLED_BACK');
      assert.equal(okRollback.installed.releaseId, bundleA.manifest.releaseId);
    } finally {
      await srv.close();
    }
  });

  // V8-08: Channel isolation, expired manifest, and contentDigest conflict
  await runCase('V8-08: Channel mismatch, expired manifest, and contentDigest conflict rejected cleanly', () => {
    const runtimeA: RuntimeReleaseIdentity = {
      releaseId: 'v4.9.6-aaaaaaaaaa',
      releaseSequence: 70,
      semver: '4.9.6',
      channel: 'stable',
      platform: 'web',
      schemaVersion: 4,
      nativeVersion: '4.9.6',
      contentDigest: 'a'.repeat(64),
      origin: 'ci_pipeline',
    };

    const stagingBundle = buildBundle({ semver: '4.9.7', releaseSequence: 71, seed: 'stg', channel: 'staging' });
    const stagingRes = compareReleases(runtimeA, stagingBundle.manifest);
    assert.equal(stagingRes.kind, 'REPLAY_REJECTED');
    if (stagingRes.kind === 'REPLAY_REJECTED') {
      assert.ok(stagingRes.detail.includes('Channel mismatch'));
    }

    const expiredBundle = buildBundle({
      semver: '4.9.7',
      releaseSequence: 71,
      seed: 'exp',
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    const expRes = compareReleases(runtimeA, expiredBundle.manifest);
    assert.equal(expRes.kind, 'REPLAY_REJECTED');
    if (expRes.kind === 'REPLAY_REJECTED') {
      assert.ok(expRes.detail.includes('Manifest expired'));
    }

    const digestConflict = buildBundle({
      semver: '4.9.6',
      releaseSequence: 70,
      seed: 'same-id-different-digest',
      contentDigestOverride: 'b'.repeat(64),
    });
    const forgedSameId = { ...digestConflict.manifest, releaseId: runtimeA.releaseId };
    assert.equal(compareReleases(runtimeA, forgedSameId).kind, 'SEQUENCE_CONFLICT');
  });

  // V8-09: Native adapters query explicit remote HTTPS platform pointers (never local WebView)
  await runCase('V8-09: Android and iOS adapters default to explicit remote HTTPS platform pointers and honest storeUrl', () => {
    const androidAdapter = new NativePlatformUpdateAdapter('android');
    const iosAdapter = new NativePlatformUpdateAdapter('ios');

    assert.equal(
      androidAdapter.getDefaultPointerUrl?.(),
      'https://galaxy1364.github.io/Dendalcare/android-release-pointer.json'
    );
    assert.equal(
      iosAdapter.getDefaultPointerUrl?.(),
      'https://galaxy1364.github.io/Dendalcare/ios-release-pointer.json'
    );
    assert.equal(androidAdapter.getCapabilities().supportsStoreDeepLink, false);
    assert.equal(iosAdapter.getCapabilities().supportsStoreDeepLink, false);
  });

  // V8-10: V8.1 Incident P0 boot resilience (independent #boot-error, early listener, watchdog cancellation, milestones, auth timeout)
  await runCase('V8-10: V8.1 Boot recovery outside #app-splash, early listener order, watchdog cancel, milestones & auth timeout', () => {
    const rootHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    const splashOpenIdx = rootHtml.indexOf('<div id="app-splash"');
    const bootErrorIdx = rootHtml.indexOf('<div id="boot-error"');
    const rootDivIdx = rootHtml.indexOf('<div id="root"></div>');
    const preReactScriptIdx = rootHtml.indexOf('window.__minaShowBootRecovery');
    const moduleScriptIdx = rootHtml.indexOf('<script type="module" src="./src/main.tsx">');

    assert.ok(splashOpenIdx > 0 && bootErrorIdx > splashOpenIdx, 'index.html must define #app-splash before #boot-error');
    const betweenSplashAndError = rootHtml.slice(splashOpenIdx, bootErrorIdx);
    const openDivs = (betweenSplashAndError.match(/<div\b/g) || []).length;
    const closeDivs = (betweenSplashAndError.match(/<\/div>/g) || []).length;
    assert.equal(openDivs, closeDivs, '#app-splash MUST be completely closed before #boot-error starts');
    assert.ok(rootDivIdx > bootErrorIdx, '#boot-error MUST be outside #root');
    assert.ok(
      preReactScriptIdx > 0 && preReactScriptIdx < moduleScriptIdx,
      'Pre-React error handler MUST be registered BEFORE <script type="module" src="./src/main.tsx">'
    );
    assert.ok(rootHtml.includes('__minaCancelBootWatchdog'), 'index.html must expose cancellable watchdog helper');
    assert.ok(rootHtml.includes('minadental-content-digest'), 'index.html must stamp minadental-content-digest meta tag');

    // Verify bootstrap milestones record cleanly
    markModuleEvaluated();
    markShellCommitted();
    markRouteRendered('dashboard');
    const snap = appBootstrap.getSnapshot();
    assert.ok(snap.moduleEvaluatedAt, 'moduleEvaluatedAt must be recorded');
    assert.ok(snap.shellCommittedAt, 'shellCommittedAt must be recorded');
    assert.ok(snap.routeRenderedAt, 'routeRenderedAt must be recorded');
    assert.equal(snap.renderedRoute, 'dashboard');

    // Verify authService has explicit timeout bound
    const authSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/authentication/authService.ts'), 'utf8');
    assert.ok(authSrc.includes('AUTH_SESSION_TIMEOUT_MS'), 'authService must enforce bounded session timeout');
  });

  // V8-11: CI Release Gate script validates monotonic sequence & catches raw src/main.tsx deployment leak
  await runCase('V8-11: ci-release-gate rejects injection/decreasing sequence and detects raw src/main.tsx remote deploy leak', async () => {
    // Reject non-integer / shell-injection override
    assert.throws(() => parseStrictPositiveInt('70; rm -rf /', 'release_sequence'));
    assert.throws(() => parseStrictPositiveInt('0', 'release_sequence'));
    assert.equal(parseStrictPositiveInt('72', 'release_sequence'), 72);

    // Monotonicity against remote pointer
    const remotePtrBundle = buildBundle({ semver: '4.9.6', releaseSequence: 80, seed: 'remote-ptr' });
    const ptrSrv = await startCustomServer((req, res) => {
      const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      if (pathname === '/release-pointer.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(remotePtrBundle.files['/release-pointer.json'].body);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    try {
      const nextAuto = await computeMonotonicSequence({
        baseSequence: 65,
        runNumber: 5,
        remotePointerUrl: `${ptrSrv.baseUrl}release-pointer.json`,
      });
      assert.equal(nextAuto.sequence, 81, 'Auto sequence must exceed deployed remote sequence #80');

      await assert.rejects(
        () =>
          computeMonotonicSequence({
            baseSequence: 65,
            runNumber: 5,
            overrideInput: '80',
            remotePointerUrl: `${ptrSrv.baseUrl}release-pointer.json`,
          }),
        /Non-monotonic release_sequence/
      );
    } finally {
      await ptrSrv.close();
    }

    // Regression: only a confirmed 404 pointer and a real legacy root can auto-bootstrap.
    const scenarios = [
      { status: 404, rootStatus: 200, body: '<script type="module" src="./src/main.tsx"></script>', auto: true, explicit: false, expected: true },
      { status: 404, rootStatus: 200, body: '<meta name="minadental-build-id" content="v4.9.6-1234567890"><script type="module" src="./assets/index.js"></script>', auto: true, explicit: true, expected: false },
      { status: 404, rootStatus: 200, body: '<p>src/main.tsx</p>', auto: true, explicit: false, expected: false },
      { status: 503, rootStatus: 200, body: '<script type="module" src="./src/main.tsx"></script>', auto: true, explicit: true, expected: false },
      { status: 200, rootStatus: 200, body: '<script type="module" src="./src/main.tsx"></script>', auto: true, explicit: true, expected: false },
      { status: 404, rootStatus: 404, body: '', auto: false, explicit: true, expected: true },
      { status: 404, rootStatus: 404, body: '', auto: true, explicit: false, expected: false },
    ];
    for (const scenario of scenarios) {
      const srv = await startCustomServer((req, res) => {
        if (req.url?.startsWith('/release-pointer.json')) {
          res.writeHead(scenario.status, { 'Content-Type': 'text/html' });
          res.end('Not a release pointer');
          return;
        }
        res.writeHead(scenario.rootStatus, { 'Content-Type': 'text/html' });
        res.end(scenario.body);
      });
      try {
        const opts = {
          baseSequence: 65, runNumber: 32,
          remotePointerUrl: `${srv.baseUrl}release-pointer.json`,
          requireRemotePointer: true,
          bootstrapFirstRelease: scenario.explicit,
          allowLegacyRootMigration: scenario.auto,
        };
        if (scenario.expected) {
          const result = await computeMonotonicSequence(opts);
          assert.equal(result.bootstrapped, true);
          assert.equal(result.sequence, 97);
          await assert.rejects(() => computeMonotonicSequence({ ...opts, overrideInput: '65' }), /Non-monotonic/);
        } else {
          await assert.rejects(() => computeMonotonicSequence(opts), /Fail-closed monotonic sequence guard/);
        }
      } finally {
        await srv.close();
      }
    }

    // Remote health gate MUST fail loudly if server serves dev index.html containing src/main.tsx!
    const brokenDeploySrv = await startCustomServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body><script type="module" src="./src/main.tsx"></script></body></html>');
    });
    try {
      await assert.rejects(
        () => verifyRemoteDeployment(brokenDeploySrv.baseUrl),
        /src\/main\.tsx/
      );
    } finally {
      await brokenDeploySrv.close();
    }
  });

  return results;
}
