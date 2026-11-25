import { CURRENT_APP_BUILD, CURRENT_APP_VERSION } from '@/lib/cloudSyncEngine';
import { appBootstrap } from '@/app/bootstrapState';
import type {
  AuthoritativeReleaseManifest,
  PlatformUpdateCapabilities,
  ReleaseChannel,
  ReleasePlatform,
  RuntimeReleaseIdentity,
  UpdateProgress,
} from '../contracts';
import { verifyReleaseAssets, type VerifiedAssetPayload } from '../manifestClient';
import { UPDATE_TIMING_POLICY } from '../policy';
import type {
  ActivateUpdateResult,
  BootHandshakeResult,
  PlatformUpdateAdapter,
  StageUpdateResult,
} from './types';

function detectWebPlatform(): ReleasePlatform {
  if (typeof window === 'undefined') return 'web';
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  if (isStandalone) return 'pwa';
  return 'web';
}

function getEmbeddedBuildInfo(): {
  semver: string;
  sequence: number;
  channel: ReleaseChannel;
  schemaVersion: number;
} {
  const embeddedSemver =
    typeof __MINA_EMBEDDED_SEMVER__ === 'string' && __MINA_EMBEDDED_SEMVER__
      ? __MINA_EMBEDDED_SEMVER__
      : CURRENT_APP_VERSION;
  const embeddedSequence =
    typeof __MINA_EMBEDDED_SEQUENCE__ === 'number' && Number.isInteger(__MINA_EMBEDDED_SEQUENCE__)
      ? __MINA_EMBEDDED_SEQUENCE__
      : CURRENT_APP_BUILD;
  const rawChannel =
    typeof __MINA_EMBEDDED_CHANNEL__ === 'string' ? __MINA_EMBEDDED_CHANNEL__ : 'stable';
  const channel: ReleaseChannel =
    rawChannel === 'staging' || rawChannel === 'canary' ? rawChannel : 'stable';
  const schemaVersion =
    typeof __MINA_EMBEDDED_SCHEMA_VERSION__ === 'number'
      ? __MINA_EMBEDDED_SCHEMA_VERSION__
      : UPDATE_TIMING_POLICY.CLIENT_SCHEMA_VERSION;
  return { semver: embeddedSemver, sequence: embeddedSequence, channel, schemaVersion };
}

export function readDomRuntimeReleaseIdentity(
  platformOverride?: ReleasePlatform
): RuntimeReleaseIdentity {
  const embedded = getEmbeddedBuildInfo();
  let releaseId = 'dev-local';
  let contentDigest: string | null = null;
  let releaseSequence = embedded.sequence;
  let semver = embedded.semver;
  let origin: 'ci_pipeline' | 'local_unreleased' = 'local_unreleased';

  if (typeof window !== 'undefined') {
    if (typeof window.__minaBuildId === 'string' && window.__minaBuildId) {
      releaseId = window.__minaBuildId;
    }
    if (typeof window.__minaContentDigest === 'string' && /^[0-9a-f]{64}$/i.test(window.__minaContentDigest)) {
      contentDigest = window.__minaContentDigest.toLowerCase();
    }
  }
  if (typeof document !== 'undefined') {
    const metaId = document.querySelector('meta[name="minadental-build-id"]')?.getAttribute('content');
    if (metaId && !metaId.startsWith('__MINA_')) {
      releaseId = metaId;
    }
    const metaDigest = document.querySelector('meta[name="minadental-content-digest"]')?.getAttribute('content');
    if (metaDigest && /^[0-9a-f]{64}$/i.test(metaDigest)) {
      contentDigest = metaDigest.toLowerCase();
    }
    const metaSeq = document.querySelector('meta[name="minadental-release-seq"]')?.getAttribute('content');
    if (metaSeq && /^\d+$/.test(metaSeq)) {
      const parsed = Number(metaSeq);
      if (Number.isInteger(parsed) && parsed > 0) {
        releaseSequence = parsed;
        origin = 'ci_pipeline';
      }
    }
    const metaSemver = document.querySelector('meta[name="minadental-semver"]')?.getAttribute('content');
    if (metaSemver && !metaSemver.startsWith('__MINA_')) {
      semver = metaSemver;
    }
  }

  return {
    releaseId,
    contentDigest,
    releaseSequence,
    semver,
    embeddedSemver: embedded.semver,
    embeddedSequence: embedded.sequence,
    channel: embedded.channel,
    platform: platformOverride ?? detectWebPlatform(),
    schemaVersion: embedded.schemaVersion,
    nativeVersion: semver,
    origin,
  };
}

export function queryWorkerIdentity(
  worker: ServiceWorker | null | undefined,
  timeoutMs = 2500
): Promise<{ buildId: string | null; cacheName: string | null; origin?: string | null }> {
  if (!worker || typeof MessageChannel === 'undefined') {
    return Promise.resolve({ buildId: null, cacheName: null, origin: null });
  }
  return new Promise((resolve) => {
    let settled = false;
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ buildId: null, cacheName: null, origin: null });
    }, timeoutMs);

    channel.port1.onmessage = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const data = event.data as { buildId?: string; cacheName?: string; origin?: string } | undefined;
      resolve({
        buildId: typeof data?.buildId === 'string' ? data.buildId : null,
        cacheName: typeof data?.cacheName === 'string' ? data.cacheName : null,
        origin: typeof data?.origin === 'string' ? data.origin : null,
      });
    };

    try {
      worker.postMessage({ type: 'GET_BUILD_ID' }, [channel.port2]);
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ buildId: null, cacheName: null, origin: null });
      }
    }
  });
}

export function queryWorkerCacheInventory(
  worker: ServiceWorker | null | undefined,
  timeoutMs = 3000
): Promise<{ ok: boolean; buildId: string | null; missing: string[] }> {
  if (!worker || typeof MessageChannel === 'undefined') {
    return Promise.resolve({ ok: false, buildId: null, missing: ['no-worker'] });
  }
  return new Promise((resolve) => {
    let settled = false;
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, buildId: null, missing: ['timeout'] });
    }, timeoutMs);

    channel.port1.onmessage = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const data = event.data as { ok?: boolean; buildId?: string; missing?: string[] } | undefined;
      resolve({
        ok: Boolean(data?.ok),
        buildId: typeof data?.buildId === 'string' ? data.buildId : null,
        missing: Array.isArray(data?.missing) ? data.missing : [],
      });
    };

    try {
      worker.postMessage({ type: 'VERIFY_CACHE_INVENTORY' }, [channel.port2]);
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, buildId: null, missing: ['postMessage-error'] });
      }
    }
  });
}

async function waitForInstallingWorker(
  reg: ServiceWorkerRegistration,
  timeoutMs = 8000
): Promise<ServiceWorker | null> {
  if (reg.waiting) return reg.waiting;
  const installing = reg.installing;
  if (!installing) return null;

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(reg.waiting ?? null);
    }, timeoutMs);

    const onStateChange = () => {
      if (settled) return;
      if (installing.state === 'installed') {
        settled = true;
        clearTimeout(timer);
        resolve(reg.waiting ?? installing);
      } else if (installing.state === 'redundant') {
        settled = true;
        clearTimeout(timer);
        resolve(null);
      }
    };
    installing.addEventListener('statechange', onStateChange);
  });
}

export interface WebPwaAdapterDeps {
  fetchFn?: typeof fetch;
  reloadFn?: (returnUrl: string) => void;
  getRegistrationFn?: () => Promise<ServiceWorkerRegistration | undefined>;
  getRuntimeIdentityFn?: () => RuntimeReleaseIdentity;
  queryWorkerIdentityFn?: (
    worker: ServiceWorker | null | undefined
  ) => Promise<{ buildId: string | null; cacheName: string | null; origin?: string | null }>;
  queryWorkerInventoryFn?: (
    worker: ServiceWorker | null | undefined
  ) => Promise<{ ok: boolean; buildId: string | null; missing: string[] }>;
  isRouteRenderedFn?: () => boolean;
  cacheStorage?: CacheStorage | null;
  assetTimeoutMs?: number;
  stageTotalDeadlineMs?: number;
}

/**
 * Web & Installed PWA Update Adapter (V8 Verified Release Assurance).
 * - Downloads and verifies assets with SHA-256 + byte size + MIME and binds the EXACT verified bytes
 *   directly into `minadental-shell-<releaseId>` CacheStorage (zero TOCTOU).
 * - When a Service Worker registration is active, fails closed if `reg.update()` fails, worker buildId
 *   mismatches manifest.releaseId, or worker cache inventory is incomplete.
 * - Re-queries active controller after `controllerchange` and runs `beforeReload()` BEFORE location.replace.
 * - Independently attests embedded JS identity + DOM identity + controlling worker + route commit on boot.
 */
export class WebPwaUpdateAdapter implements PlatformUpdateAdapter {
  private readonly deps: WebPwaAdapterDeps;

  constructor(deps: WebPwaAdapterDeps = {}) {
    this.deps = deps;
  }

  public getDefaultPointerUrl(): string {
    return './release-pointer.json';
  }

  public getCapabilities(): PlatformUpdateCapabilities {
    const platform = detectWebPlatform();
    const swSupported =
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof window !== 'undefined' &&
      window.location.protocol.startsWith('http');

    return {
      platform,
      supportsWebSwUpdates: swSupported,
      supportsInAppBinaryInstall: false,
      supportsStoreDeepLink: false,
      isBundledWebView: false,
      nativeVersionName: null,
      nativeVersionCode: null,
      packageName: null,
      storeUrl: null,
      remotePointerUrl: './release-pointer.json',
      honestLimitationFa:
        'در نسخه وب و PWA، بررسی خودکار فقط در زمان باز بودن برنامه و اتصال اینترنت انجام می‌شود و اجرای پس‌زمینه پس از بسته شدن کامل تب توسط مرورگر تضمین نمی‌شود.',
    };
  }

  public getCurrentRuntimeIdentity(): RuntimeReleaseIdentity {
    return this.deps.getRuntimeIdentityFn
      ? this.deps.getRuntimeIdentityFn()
      : readDomRuntimeReleaseIdentity();
  }

  private getCacheStorage(): CacheStorage | null {
    if (this.deps.cacheStorage !== undefined) return this.deps.cacheStorage;
    if (typeof window !== 'undefined' && 'caches' in window) return window.caches;
    return null;
  }

  private async getRegistration(): Promise<ServiceWorkerRegistration | undefined> {
    if (this.deps.getRegistrationFn) {
      return this.deps.getRegistrationFn();
    }
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return undefined;
    }
    try {
      return await navigator.serviceWorker.getRegistration();
    } catch {
      return undefined;
    }
  }

  public reportClientReleaseLease(tabId: string, buildId: string): void {
    void this.getRegistration().then((reg) => {
      const worker =
        (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) ||
        reg?.active ||
        null;
      if (worker) {
        try {
          worker.postMessage({ type: 'CLIENT_RELEASE_LEASE', tabId, buildId });
        } catch {
          // ignore closed worker
        }
      }
    });
  }

  public async stageAndVerify(input: {
    manifest: AuthoritativeReleaseManifest;
    baseUrl: string;
    signal?: AbortSignal;
    onProgress?: (progress: UpdateProgress) => void;
  }): Promise<StageUpdateResult> {
    const cacheStorage = this.getCacheStorage();
    const candidateCacheName = `minadental-shell-${input.manifest.releaseId}`;
    let candidateCache: Cache | null = null;

    if (cacheStorage) {
      try {
        candidateCache = await cacheStorage.open(candidateCacheName);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isQuota = /quota/i.test(msg) || (err instanceof Error && err.name === 'QuotaExceededError');
        return {
          ok: false,
          verifiedAssetsCount: 0,
          waitingWorkerBuildId: null,
          workerVerified: false,
          errorCode: isQuota ? 'STORAGE_QUOTA_EXCEEDED' : 'ASSET_VERIFICATION_FAILED',
          detail: `Unable to open candidate cache ${candidateCacheName}: ${msg}`,
        };
      }
    }

    // 1. Download, verify SHA-256 + byte length + MIME, and write the EXACT verified bytes into candidateCache!
    const writeVerifiedAsset = async (payload: VerifiedAssetPayload) => {
      if (!candidateCache) return;
      const response = new Response(payload.buffer.slice(0), {
        status: 200,
        headers: {
          'Content-Type': payload.contentType || payload.asset.contentType || 'application/octet-stream',
          'X-Mina-Verified-Sha256': payload.sha256,
          'X-Mina-Release-Id': input.manifest.releaseId,
        },
      });
      await candidateCache.put(payload.asset.path, response);
    };

    const assetRes = await verifyReleaseAssets({
      manifest: input.manifest,
      baseUrl: input.baseUrl,
      fetchFn: this.deps.fetchFn,
      timeoutMs: this.deps.assetTimeoutMs,
      totalDeadlineMs: this.deps.stageTotalDeadlineMs,
      signal: input.signal,
      onProgress: input.onProgress,
      onVerifiedAsset: candidateCache ? writeVerifiedAsset : undefined,
    });

    if (!assetRes.ok) {
      // Remove incomplete candidate cache on verification failure (never touching active/LKG cache!)
      if (cacheStorage) {
        await cacheStorage.delete(candidateCacheName).catch(() => {});
      }
      return {
        ok: false,
        verifiedAssetsCount: 0,
        waitingWorkerBuildId: null,
        workerVerified: false,
        errorCode: assetRes.errorCode,
        detail: assetRes.detail,
      };
    }

    // 2. Service Worker staging & identity attestation (V8-04: NEVER silently pass broken/mismatched SW!)
    const reg = await this.getRegistration();
    const runtime = this.getCurrentRuntimeIdentity();

    if (!reg) {
      // Installed standalone PWA MUST have a Service Worker; regular browser without SW uses explicit navigation strategy
      if (runtime.platform === 'pwa') {
        return {
          ok: false,
          verifiedAssetsCount: assetRes.verifiedCount,
          waitingWorkerBuildId: null,
          workerVerified: false,
          errorCode: 'ASSET_VERIFICATION_FAILED',
          detail: 'Installed PWA has no active Service Worker registration to verify candidate',
        };
      }
      return {
        ok: true,
        verifiedAssetsCount: assetRes.verifiedCount,
        waitingWorkerBuildId: null,
        workerVerified: false,
        stagingStrategy: 'browser_navigation',
      };
    }

    try {
      await reg.update();
    } catch (swErr) {
      return {
        ok: false,
        verifiedAssetsCount: assetRes.verifiedCount,
        waitingWorkerBuildId: null,
        workerVerified: false,
        errorCode: 'ASSET_VERIFICATION_FAILED',
        detail: `Service Worker reg.update() failed: ${swErr instanceof Error ? swErr.message : String(swErr)}`,
      };
    }

    const candidateWorker = await waitForInstallingWorker(reg, 6000);
    const targetWorker = candidateWorker ?? reg.waiting ?? reg.active;
    const identityFn = this.deps.queryWorkerIdentityFn ?? queryWorkerIdentity;
    const workerId = await identityFn(targetWorker);

    if (!workerId.buildId || workerId.buildId === 'dev-local') {
      return {
        ok: false,
        verifiedAssetsCount: assetRes.verifiedCount,
        waitingWorkerBuildId: workerId.buildId,
        workerVerified: false,
        errorCode: 'BOOT_MISMATCH',
        detail: `Target Service Worker failed to attest valid buildId (got ${String(workerId.buildId)})`,
      };
    }

    if (workerId.buildId !== input.manifest.releaseId) {
      return {
        ok: false,
        verifiedAssetsCount: assetRes.verifiedCount,
        waitingWorkerBuildId: workerId.buildId,
        workerVerified: false,
        errorCode: 'BOOT_MISMATCH',
        detail: `Staged worker buildId (${workerId.buildId}) does not match target manifest (${input.manifest.releaseId})`,
      };
    }

    // Confirm worker's own staged cache inventory when queryable
    const inventoryFn = this.deps.queryWorkerInventoryFn ?? queryWorkerCacheInventory;
    if (this.deps.queryWorkerInventoryFn || typeof MessageChannel !== 'undefined') {
      const inv = await inventoryFn(targetWorker);
      if (!inv.ok) {
        return {
          ok: false,
          verifiedAssetsCount: assetRes.verifiedCount,
          waitingWorkerBuildId: workerId.buildId,
          workerVerified: false,
          errorCode: 'ASSET_VERIFICATION_FAILED',
          detail: `Worker cache inventory incomplete for ${input.manifest.releaseId}: missing ${inv.missing.join(', ')}`,
        };
      }
    }

    return {
      ok: true,
      verifiedAssetsCount: assetRes.verifiedCount,
      waitingWorkerBuildId: workerId.buildId,
      workerVerified: true,
      stagingStrategy: 'service_worker',
    };
  }

  public async activateTargetRelease(input: {
    targetReleaseId: string;
    returnUrl: string;
    allowReload: boolean;
    beforeReload?: () => void;
  }): Promise<ActivateUpdateResult> {
    const reg = await this.getRegistration();
    const identityFn = this.deps.queryWorkerIdentityFn ?? queryWorkerIdentity;

    // If a waiting SW exists, confirm its exact identity BEFORE SKIP_WAITING, then re-query controller AFTER switch
    if (reg?.waiting) {
      const waitingIdentity = await identityFn(reg.waiting);
      if (
        !waitingIdentity.buildId ||
        waitingIdentity.buildId === 'dev-local' ||
        waitingIdentity.buildId !== input.targetReleaseId
      ) {
        return {
          ok: false,
          reloadTriggered: false,
          errorCode: 'BOOT_MISMATCH',
          detail: `Waiting worker build (${String(waitingIdentity.buildId)}) does not match target (${input.targetReleaseId})`,
        };
      }

      const controllerChanged = new Promise<boolean>((resolve) => {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
          resolve(true);
          return;
        }
        let done = false;
        const timer = setTimeout(() => {
          if (!done) {
            done = true;
            resolve(false);
          }
        }, 4500);
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => {
            if (!done) {
              done = true;
              clearTimeout(timer);
              resolve(true);
            }
          },
          { once: true }
        );
      });

      reg.waiting.postMessage({ type: 'SKIP_WAITING', targetReleaseId: input.targetReleaseId });
      const switched = await controllerChanged;
      if (!switched) {
        return {
          ok: false,
          reloadTriggered: false,
          errorCode: 'ACTIVATION_TIMEOUT',
          detail: 'Waiting Service Worker did not take control before timeout',
        };
      }

      // V8-05: Re-query actual controlling worker after controllerchange (never trust arbitrary event!)
      const newController =
        (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) ||
        reg.active ||
        null;
      if (newController) {
        const controllerId = await identityFn(newController);
        if (
          controllerId.buildId &&
          controllerId.buildId !== 'dev-local' &&
          controllerId.buildId !== input.targetReleaseId
        ) {
          return {
            ok: false,
            reloadTriggered: false,
            errorCode: 'BOOT_MISMATCH',
            detail: `New controller (${controllerId.buildId}) does not match target (${input.targetReleaseId})`,
          };
        }
      }
    }

    if (!input.allowReload) {
      return { ok: true, reloadTriggered: false };
    }

    // Persist reload attempt marker strictly BEFORE invoking navigation/reload!
    input.beforeReload?.();

    if (this.deps.reloadFn) {
      this.deps.reloadFn(input.returnUrl);
      return { ok: true, reloadTriggered: true };
    }

    if (typeof window !== 'undefined') {
      const targetUrl = new URL(input.returnUrl || window.location.href);
      targetUrl.searchParams.delete('ota_instant_sync');
      targetUrl.searchParams.delete('v_reload');
      targetUrl.searchParams.delete('hard_reload');
      window.location.replace(targetUrl.toString());
      return { ok: true, reloadTriggered: true };
    }

    return { ok: true, reloadTriggered: false };
  }

  public async verifyPostBootHandshake(
    expectedReleaseId: string,
    options?: {
      expectedContentDigest?: string | null;
      expectedSemver?: string | null;
      requireWorkerMatch?: boolean;
      requireRouteRendered?: boolean;
    }
  ): Promise<BootHandshakeResult> {
    const runtime = this.getCurrentRuntimeIdentity();
    const reg = await this.getRegistration();
    const identityFn = this.deps.queryWorkerIdentityFn ?? queryWorkerIdentity;

    let workerBuildId: string | null = null;
    const activeWorker =
      (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) ||
      reg?.active ||
      null;
    if (activeWorker) {
      const info = await identityFn(activeWorker);
      workerBuildId = info.buildId;
    }

    // 1. Verify runtime releaseId
    if (runtime.releaseId !== expectedReleaseId) {
      return {
        verified: false,
        runtimeBuildId: runtime.releaseId,
        workerBuildId,
        embeddedMatch: false,
        reason: `Runtime releaseId (${runtime.releaseId}) != expected (${expectedReleaseId})`,
      };
    }

    // 2. Verify full contentDigest when both expected & runtime present
    if (
      options?.expectedContentDigest &&
      runtime.contentDigest &&
      runtime.contentDigest !== options.expectedContentDigest
    ) {
      return {
        verified: false,
        runtimeBuildId: runtime.releaseId,
        workerBuildId,
        embeddedMatch: false,
        reason: `Runtime contentDigest mismatch for ${expectedReleaseId}`,
      };
    }

    // 3. Independently verify embedded JS executable semver matches expected semver (not DOM-only!)
    if (
      options?.expectedSemver &&
      runtime.embeddedSemver &&
      runtime.embeddedSemver !== options.expectedSemver
    ) {
      return {
        verified: false,
        runtimeBuildId: runtime.releaseId,
        workerBuildId,
        embeddedMatch: false,
        reason: `Embedded executable JS semver (${runtime.embeddedSemver}) != expected (${options.expectedSemver})`,
      };
    }

    // 4. Verify controlling Service Worker (strict when SW was required or running in PWA mode)
    const mustVerifyWorker = Boolean(options?.requireWorkerMatch || runtime.platform === 'pwa');
    if (mustVerifyWorker) {
      if (!workerBuildId || workerBuildId === 'dev-local' || workerBuildId !== expectedReleaseId) {
        return {
          verified: false,
          runtimeBuildId: runtime.releaseId,
          workerBuildId,
          embeddedMatch: true,
          reason: `Required Service Worker identity (${String(workerBuildId)}) != expected (${expectedReleaseId})`,
        };
      }
    } else if (
      workerBuildId &&
      workerBuildId !== 'dev-local' &&
      workerBuildId !== expectedReleaseId
    ) {
      return {
        verified: false,
        runtimeBuildId: runtime.releaseId,
        workerBuildId,
        embeddedMatch: true,
        reason: `Active Service Worker (${workerBuildId}) != expected (${expectedReleaseId})`,
      };
    }

    // 5. Verify target route actually rendered when checked in browser runtime
    const routeRendered = this.deps.isRouteRenderedFn
      ? this.deps.isRouteRenderedFn()
      : typeof document === 'undefined'
      ? true
      : appBootstrap.getSnapshot().routeRenderedAt !== null;

    if (options?.requireRouteRendered && !routeRendered) {
      return {
        verified: false,
        runtimeBuildId: runtime.releaseId,
        workerBuildId,
        embeddedMatch: true,
        routeRendered: false,
        reason: 'Target route has not committed/rendered after shell mount',
      };
    }

    return {
      verified: true,
      runtimeBuildId: runtime.releaseId,
      workerBuildId,
      embeddedMatch: true,
      routeRendered,
    };
  }

  /**
   * Prunes ONLY obsolete `minadental-shell-*` caches AFTER post-boot attestation succeeds.
   * Retains active + waiting + last-known-good + client-leased builds.
   */
  public async cleanupObsoleteCaches(
    activeReleaseId: string,
    options?: { lastKnownGoodReleaseId?: string | null }
  ): Promise<void> {
    const reg = await this.getRegistration();
    const activeWorker =
      (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) ||
      reg?.active ||
      null;
    if (activeWorker) {
      try {
        activeWorker.postMessage({
          type: 'PRUNE_OBSOLETE_CACHES',
          activeBuildId: activeReleaseId,
          lastKnownGoodBuildId: options?.lastKnownGoodReleaseId ?? null,
        });
        return;
      } catch {
        // fallback below
      }
    }

    const cacheStorage = this.getCacheStorage();
    if (!cacheStorage) return;
    const protectedSet = new Set<string>([`minadental-shell-${activeReleaseId}`]);
    if (options?.lastKnownGoodReleaseId) {
      protectedSet.add(`minadental-shell-${options.lastKnownGoodReleaseId}`);
    }
    if (reg?.waiting) {
      const identityFn = this.deps.queryWorkerIdentityFn ?? queryWorkerIdentity;
      const wInfo = await identityFn(reg.waiting);
      if (wInfo.cacheName) protectedSet.add(wInfo.cacheName);
    }

    const keys = await cacheStorage.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('minadental-shell-') && !protectedSet.has(k))
        .map((k) => cacheStorage.delete(k))
    );
  }
}
