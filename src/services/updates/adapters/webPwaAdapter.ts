import { CURRENT_APP_BUILD, CURRENT_APP_VERSION } from '@/lib/cloudSyncEngine';
import type {
  AuthoritativeReleaseManifest,
  PlatformUpdateCapabilities,
  ReleasePlatform,
  RuntimeReleaseIdentity,
  UpdateProgress,
} from '../contracts';
import { verifyReleaseAssets } from '../manifestClient';
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

export function readDomRuntimeReleaseIdentity(
  platformOverride?: ReleasePlatform
): RuntimeReleaseIdentity {
  let releaseId = 'dev-local';
  let releaseSequence = CURRENT_APP_BUILD;
  let semver = CURRENT_APP_VERSION;
  let origin: 'ci_pipeline' | 'local_unreleased' = 'local_unreleased';

  if (typeof window !== 'undefined' && typeof window.__minaBuildId === 'string' && window.__minaBuildId) {
    releaseId = window.__minaBuildId;
  }
  if (typeof document !== 'undefined') {
    const metaId = document.querySelector('meta[name="minadental-build-id"]')?.getAttribute('content');
    if (metaId && !metaId.startsWith('__MINA_')) {
      releaseId = metaId;
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
    releaseSequence,
    semver,
    channel: 'stable',
    platform: platformOverride ?? detectWebPlatform(),
    schemaVersion: UPDATE_TIMING_POLICY.CLIENT_SCHEMA_VERSION,
    nativeVersion: semver,
    origin,
  };
}

export function queryWorkerIdentity(
  worker: ServiceWorker | null | undefined,
  timeoutMs = 2500
): Promise<{ buildId: string | null; cacheName: string | null }> {
  if (!worker || typeof MessageChannel === 'undefined') {
    return Promise.resolve({ buildId: null, cacheName: null });
  }
  return new Promise((resolve) => {
    let settled = false;
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ buildId: null, cacheName: null });
    }, timeoutMs);

    channel.port1.onmessage = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const data = event.data as { buildId?: string; cacheName?: string } | undefined;
      resolve({
        buildId: typeof data?.buildId === 'string' ? data.buildId : null,
        cacheName: typeof data?.cacheName === 'string' ? data.cacheName : null,
      });
    };

    try {
      worker.postMessage({ type: 'GET_BUILD_ID' }, [channel.port2]);
    } catch {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ buildId: null, cacheName: null });
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
  queryWorkerIdentityFn?: (worker: ServiceWorker | null | undefined) => Promise<{ buildId: string | null; cacheName: string | null }>;
}

/**
 * Web & Installed PWA (including iOS PWA & Windows PWA) Update Adapter.
 * - Verifies manifest assets over HTTP (200, MIME, SHA-256) BEFORE any activation.
 * - Coordinates Service Worker reg.update() & worker identity verification.
 * - NEVER deletes active or waiting caches before verified post-boot handshake.
 * - Triggers at-most-once controlled reload on activation preserving URL & drafts.
 */
export class WebPwaUpdateAdapter implements PlatformUpdateAdapter {
  private readonly deps: WebPwaAdapterDeps;

  constructor(deps: WebPwaAdapterDeps = {}) {
    this.deps = deps;
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
      honestLimitationFa:
        'در نسخه وب و PWA، بررسی خودکار فقط در زمان باز بودن برنامه و اتصال اینترنت انجام می‌شود و اجرای پس‌زمینه پس از بسته شدن کامل تب توسط مرورگر تضمین نمی‌شود.',
    };
  }

  public getCurrentRuntimeIdentity(): RuntimeReleaseIdentity {
    return this.deps.getRuntimeIdentityFn
      ? this.deps.getRuntimeIdentityFn()
      : readDomRuntimeReleaseIdentity();
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

  public async stageAndVerify(input: {
    manifest: AuthoritativeReleaseManifest;
    baseUrl: string;
    signal?: AbortSignal;
    onProgress?: (progress: UpdateProgress) => void;
  }): Promise<StageUpdateResult> {
    // 1. Verify critical + entry + required lazy assets (HTTP 200, valid MIME, real SHA-256)
    const assetRes = await verifyReleaseAssets({
      manifest: input.manifest,
      baseUrl: input.baseUrl,
      fetchFn: this.deps.fetchFn,
      signal: input.signal,
      onProgress: input.onProgress,
    });

    if (!assetRes.ok) {
      return {
        ok: false,
        verifiedAssetsCount: 0,
        waitingWorkerBuildId: null,
        errorCode: assetRes.errorCode,
        detail: assetRes.detail,
      };
    }

    // 2. Ask Service Worker to fetch and stage the updated worker (NEVER calling SKIP_WAITING yet)
    let waitingWorkerBuildId: string | null = null;
    const reg = await this.getRegistration();
    if (reg) {
      try {
        await reg.update();
        const candidateWorker = await waitForInstallingWorker(reg, 6000);
        const targetWorker = candidateWorker ?? reg.waiting ?? reg.active;
        const identityFn = this.deps.queryWorkerIdentityFn ?? queryWorkerIdentity;
        const workerId = await identityFn(targetWorker);
        waitingWorkerBuildId = workerId.buildId;
      } catch {
        // SW update might not be supported or offline; asset verification already passed
      }
    }

    return {
      ok: true,
      verifiedAssetsCount: assetRes.verifiedCount,
      waitingWorkerBuildId,
    };
  }

  public async activateTargetRelease(input: {
    targetReleaseId: string;
    returnUrl: string;
    allowReload: boolean;
  }): Promise<ActivateUpdateResult> {
    const reg = await this.getRegistration();
    const identityFn = this.deps.queryWorkerIdentityFn ?? queryWorkerIdentity;

    // If a waiting SW exists, confirm its identity matches targetReleaseId before SKIP_WAITING
    if (reg?.waiting) {
      const waitingIdentity = await identityFn(reg.waiting);
      if (
        waitingIdentity.buildId &&
        waitingIdentity.buildId !== 'dev-local' &&
        waitingIdentity.buildId !== input.targetReleaseId
      ) {
        return {
          ok: false,
          reloadTriggered: false,
          errorCode: 'BOOT_MISMATCH',
          detail: `Waiting worker build (${waitingIdentity.buildId}) does not match target (${input.targetReleaseId})`,
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
    }

    if (!input.allowReload) {
      return { ok: true, reloadTriggered: false };
    }

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

  public async verifyPostBootHandshake(expectedReleaseId: string): Promise<BootHandshakeResult> {
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

    if (runtime.releaseId !== expectedReleaseId) {
      return {
        verified: false,
        runtimeBuildId: runtime.releaseId,
        workerBuildId,
        reason: `Runtime releaseId (${runtime.releaseId}) != expected (${expectedReleaseId})`,
      };
    }

    if (
      workerBuildId &&
      workerBuildId !== 'dev-local' &&
      workerBuildId !== expectedReleaseId
    ) {
      return {
        verified: false,
        runtimeBuildId: runtime.releaseId,
        workerBuildId,
        reason: `Active Service Worker (${workerBuildId}) != expected (${expectedReleaseId})`,
      };
    }

    return {
      verified: true,
      runtimeBuildId: runtime.releaseId,
      workerBuildId,
    };
  }

  /**
   * Prunes ONLY obsolete `minadental-shell-*` caches AFTER post-boot verification succeeds.
   * NEVER deletes active or waiting caches and NEVER touches IndexedDB, localStorage, or third-party caches.
   */
  public async cleanupObsoleteCaches(activeReleaseId: string): Promise<void> {
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
        });
        return;
      } catch {
        // fallback to direct CacheStorage cleanup below
      }
    }

    if (typeof window === 'undefined' || !('caches' in window)) return;
    const activeCacheName = `minadental-shell-${activeReleaseId}`;
    let waitingCacheName: string | null = null;
    if (reg?.waiting) {
      const identityFn = this.deps.queryWorkerIdentityFn ?? queryWorkerIdentity;
      const wInfo = await identityFn(reg.waiting);
      waitingCacheName = wInfo.cacheName;
    }

    const keys = await window.caches.keys();
    await Promise.all(
      keys
        .filter(
          (k) =>
            k.startsWith('minadental-shell-') &&
            k !== activeCacheName &&
            k !== waitingCacheName
        )
        .map((k) => window.caches.delete(k))
    );
  }
}
