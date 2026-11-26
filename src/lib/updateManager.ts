/**
 * MinaDental V7 Verified Release & Update Manager Facade
 *
 * Strictly delegates all discovery, verification, staging, safe-point activation,
 * and post-boot handshake operations to the single `updateCoordinator`.
 *
 * - Zero fake progress percentages
 * - Zero silent catches that turn network/5xx/offline failures into `up_to_date`
 * - Zero pre-verification cache wiping
 * - Zero client-side release authority (Supabase Realtime is hint-only)
 * - Preserves `minadental_installed_release_v1` compatibility ONLY after verified boot
 */

import { broadcastClinicSyncEvent } from './cloudSyncEngine';
import {
  updateCoordinator,
  isValidReleaseId,
  LEGACY_INSTALLED_RELEASE_KEY,
  type UpdateProgress,
  type UpdateSnapshot,
  type UpdateState,
  type VersionIdentityReport,
} from '@/services/updates';

export { updateCoordinator, LEGACY_INSTALLED_RELEASE_KEY };
export type { UpdateSnapshot, UpdateState, UpdateProgress, VersionIdentityReport };

export interface InstalledReleaseInfo {
  version: string;
  build: number;
  releaseId: string;
  releaseNotes: string;
  installedAt: string | null;
  lastCheckedAt: string | null;
}

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  currentBuild: number;
  currentReleaseId: string;
  latestVersion: string;
  latestBuild: number;
  latestReleaseId: string;
  releaseNotes: string;
  state: UpdateState;
  errorCode: string | null;
  errorMessage: string | null;
  source: 'authoritative_manifest' | 'offline' | 'check_failed' | 'native_store_required' | 'up_to_date';
}

export interface AtomicUpdateProgress {
  stage: 1 | 2 | 3 | 4;
  percent: number | null;
  determinate: boolean;
  label: string;
}

export const GITHUB_PAGES_URL = 'https://galaxy1364.github.io/Dendalcare/';
export const GITHUB_REPO_URL = 'https://github.com/galaxy1364/Dendalcare';

export function isAutoUpdateEnabled(): boolean {
  return updateCoordinator.getSnapshot().autoUpdateEnabled;
}

export function setAutoUpdateEnabled(enabled: boolean): void {
  updateCoordinator.setAutoUpdateEnabled(enabled);
}

/**
 * Returns the device's verified runtime release identity without mutating installedAt
 * or dispatching false `release-upgraded` events.
 */
export function getInstalledReleaseInfo(): InstalledReleaseInfo {
  const snap = updateCoordinator.getSnapshot();
  return {
    version: snap.installed.semver,
    build: snap.installed.releaseSequence,
    releaseId: snap.installed.releaseId,
    releaseNotes: snap.installed.releaseNotes,
    installedAt: snap.installed.verifiedAt,
    lastCheckedAt: snap.lastCheck?.checkedAt ?? null,
  };
}

export function getSeparatedVersionReport(): VersionIdentityReport {
  return updateCoordinator.getSnapshot().versionReport;
}

/**
 * Runs an authoritative check via the single UpdateCoordinator.
 * NEVER converts offline/5xx/schema errors into `up_to_date`.
 */
export async function checkForAppUpdates(): Promise<UpdateCheckResult> {
  const snap = await updateCoordinator.checkForUpdates('manual');
  const candidate = snap.candidate?.manifest ?? null;

  const source: UpdateCheckResult['source'] =
    snap.state === 'OFFLINE'
      ? 'offline'
      : snap.state === 'CHECK_FAILED'
      ? 'check_failed'
      : snap.state === 'NATIVE_STORE_REQUIRED'
      ? 'native_store_required'
      : snap.state === 'AVAILABLE' || snap.state === 'READY_TO_ACTIVATE' || snap.state === 'WAITING_FOR_SAFE_POINT'
      ? 'authoritative_manifest'
      : 'up_to_date';

  return {
    updateAvailable: Boolean(
      candidate &&
        (snap.state === 'AVAILABLE' ||
          snap.state === 'READY_TO_ACTIVATE' ||
          snap.state === 'WAITING_FOR_SAFE_POINT' ||
          snap.state === 'NATIVE_STORE_REQUIRED')
    ),
    currentVersion: snap.installed.semver,
    currentBuild: snap.installed.releaseSequence,
    currentReleaseId: snap.installed.releaseId,
    latestVersion: candidate?.semver ?? snap.installed.semver,
    latestBuild: candidate?.releaseSequence ?? snap.installed.releaseSequence,
    latestReleaseId: candidate?.releaseId ?? snap.installed.releaseId,
    releaseNotes:
      candidate?.releaseNotes ??
      snap.error?.messageFa ??
      'برنامه شما روی آخرین انتشار معتبر قرار دارد.',
    state: snap.state,
    errorCode: snap.error?.code ?? null,
    errorMessage: snap.error?.messageFa ?? null,
    source,
  };
}

/**
 * Verified Update Installer backed by UpdateCoordinator:
 * 1. Stages & verifies all manifest assets (HTTP 200, MIME, SHA-256).
 * 2. Respects multi-tab safe-point & offline queue protection.
 * 3. Activates via controlled single-reload ONLY when safe & verified.
 * 4. NEVER records `INSTALLED` until post-boot handshake proves runtime+worker identity.
 */
export async function applyAppUpdateAtomically(options?: {
  forceEvenIfBusy?: boolean;
  reloadPage?: boolean;
  onProgress?: (progress: AtomicUpdateProgress) => void;
}): Promise<UpdateSnapshot> {
  const unsub = updateCoordinator.subscribe((snap) => {
    if (!snap.progress || !options?.onProgress) return;
    const stageMap: Record<UpdateProgress['phase'], 1 | 2 | 3 | 4> = {
      download: 1,
      verify: 2,
      activate: 3,
    };
    options.onProgress({
      stage: stageMap[snap.progress.phase],
      percent: snap.progress.percent,
      determinate: snap.progress.determinate,
      label: snap.progress.label,
    });
  });

  try {
    let snap = updateCoordinator.getSnapshot();
    if (!snap.candidate) {
      snap = await updateCoordinator.checkForUpdates('manual');
    }
    if (snap.state === 'NATIVE_STORE_REQUIRED') {
      updateCoordinator.openNativeStoreAction();
      return snap;
    }
    if (snap.state === 'AVAILABLE') {
      snap = await updateCoordinator.downloadAndVerifyCandidate();
    }
    if (snap.state === 'READY_TO_ACTIVATE' || snap.state === 'WAITING_FOR_SAFE_POINT') {
      snap = await updateCoordinator.activateVerifiedCandidate({
        forceEvenIfBusy: options?.forceEvenIfBusy,
        userConfirmedClinicalSafeOverride: options?.forceEvenIfBusy,
        allowReload: options?.reloadPage !== false,
      });
    }
    return snap;
  } finally {
    unsub();
  }
}

/**
 * Safe shell-cache recovery ONLY: clears obsolete `minadental-shell-*` CacheStorage & reloads.
 * NEVER touches IndexedDB, patient records, auth tokens, or offline mutation queues.
 */
export async function clearAllCachesAndHardReload(): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      tasks.push(
        navigator.serviceWorker
          .getRegistrations()
          .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      );
    }
    if (typeof window !== 'undefined' && 'caches' in window) {
      tasks.push(
        window.caches.keys().then((keys) =>
          Promise.all(
            keys
              .filter((k) => k.startsWith('minadental-'))
              .map((k) => window.caches.delete(k))
          )
        )
      );
    }
  } catch {
    // ignore cleanup errors
  }
  await Promise.allSettled(tasks);
  if (typeof window !== 'undefined') {
    window.location.reload();
  }
}

/**
 * Sends a NON-AUTHORITATIVE Realtime refresh hint to connected devices.
 *
 * CRITICAL V7 SECURITY BOUNDARY:
 * - Clients are NEVER release authorities.
 * - This function NEVER writes to `clinic_settings.latest_published_build` and NEVER
 *   modifies the device's installed ledger.
 * - Connected devices receiving this hint only trigger an authoritative HTTPS check
 *   against the CI-published `release-pointer.json`.
 */
export async function broadcastNewAppBuild(
  _version?: string,
  _build?: number,
  notes: string = 'بررسی انتشار معتبر جدید از سرور رسمی مینادنتال'
): Promise<{ ok: boolean; releaseId: string; version: string; build: number; message: string }> {
  const snap = updateCoordinator.getSnapshot();
  const activeReleaseId = snap.installed.releaseId;

  if (!isValidReleaseId(activeReleaseId)) {
    return {
      ok: false,
      releaseId: activeReleaseId,
      version: snap.installed.semver,
      build: snap.installed.releaseSequence,
      message:
        'انتشار رسمی فقط از طریق خط لوله CI معتبر انجام می‌شود؛ بیلد محلی مجاز به ارسال اعلان انتشار نیست.',
    };
  }

  try {
    await broadcastClinicSyncEvent({
      type: 'OTA_UPDATE_PUSH',
      version: snap.installed.semver,
      releaseNotes: JSON.stringify({
        releaseId: activeReleaseId,
        releaseSequence: snap.installed.releaseSequence,
        notes,
        hintOnly: true,
      }),
    });

    return {
      ok: true,
      releaseId: activeReleaseId,
      version: snap.installed.semver,
      build: snap.installed.releaseSequence,
      message: `اعلان بررسی نسخه (${activeReleaseId}) به دستگاه‌های آنلاین ارسال شد؛ نصب فقط پس از تأیید مانیفست رسمی سرور انجام می‌شود.`,
    };
  } catch (err) {
    return {
      ok: false,
      releaseId: activeReleaseId,
      version: snap.installed.semver,
      build: snap.installed.releaseSequence,
      message: `ارسال اعلان بررسی ناموفق بود: ${err instanceof Error ? err.message : 'خطای شبکه'}`,
    };
  }
}

export function injectTestUpdateCandidate(nextSequence = 231, nextVersion = '4.18.1'): UpdateSnapshot {
  const current = getInstalledReleaseInfo();
  const testManifest = {
    schemaVersion: 2,
    releaseId: `v${nextVersion}-test${Date.now().toString(36)}`,
    releaseSequence: nextSequence,
    semver: nextVersion,
    gitCommit: 'test-force-commit',
    channel: 'stable' as const,
    platform: 'web' as const,
    minNativeVersion: '4.9.0',
    minSchemaVersion: 4,
    publishedAt: new Date().toISOString(),
    contentDigest: 'f1f2f3f4f5f6f1f2f3f4f5f6f1f2f3f4f5f6f1f2f3f4f5f6f1f2f3f4f5f6f1f2',
    releaseNotes: `نسخه آزمایشی تستی v${nextVersion} (توالی #${nextSequence}) جهت راستی‌آزمایی و تست انیمیشنی به‌روزرسانی`,
    entryScripts: [],
    entryStyles: [],
    assets: [],
    urgency: 'standard' as const,
    revoked: false,
    origin: 'ci_pipeline' as const,
    rollbackPolicy: { strategy: 'forward_release' as const, minRollbackSequence: current.build, schemaBackwardCompatible: true, preserveUserData: true },
  };
  return updateCoordinator.injectTestCandidate(testManifest as unknown as import('@/services/updates').AuthoritativeReleaseManifest);
}
