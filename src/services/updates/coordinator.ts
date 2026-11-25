import { getOfflineQueue } from '@/lib/offlineQueue';
import { sanitizeLogMessage } from '@/app/bootstrapState';
import type {
  AuthoritativeReleaseManifest,
  CandidateReleaseRecord,
  CheckTriggerSource,
  LastCheckRecord,
  PendingActivationJournal,
  PinnedPublicKey,
  SafePointBlocker,
  UpdateErrorCode,
  UpdateErrorInfo,
  UpdateProgress,
  UpdateSnapshot,
  UpdateState,
} from './contracts';
import type { PlatformUpdateAdapter } from './adapters/types';
import { WebPwaUpdateAdapter } from './adapters/webPwaAdapter';
import { NativePlatformUpdateAdapter, detectNativeHostPlatform } from './adapters/nativePlatformAdapter';
import { UpdateLedger, type StorageLike } from './ledger';
import { fetchAuthoritativeRelease, type ManifestClientOptions } from './manifestClient';
import {
  PINNED_RELEASE_PUBLIC_KEYS,
  UPDATE_TIMING_POLICY,
  canTransitionUpdateState,
  computeJitteredDelayMs,
  evaluateSafePoint,
  getPersianUpdateErrorMessage,
  isRetryableUpdateError,
} from './policy';
import { compareReleases, isValidReleaseId } from './releaseIdentity';
import { UpdateTelemetryStore, createCorrelationId } from './telemetry';

export interface UpdateCoordinatorConfig {
  adapter?: PlatformUpdateAdapter;
  ledger?: UpdateLedger;
  storage?: StorageLike | null;
  manifestClient?: ManifestClientOptions;
  pinnedKeys?: readonly PinnedPublicKey[];
  requireSignature?: boolean;
  pollIntervalMs?: number;
  pollJitterMaxMs?: number;
  minAutoDebounceMs?: number;
  getOfflineQueueCount?: () => number;
  isOnlineFn?: () => boolean;
  isDocumentVisibleFn?: () => boolean;
  onBootVerifiedInstalled?: (snapshot: UpdateSnapshot) => void;
  baseUrl?: string;
}

interface BroadcastMessage {
  type: 'STATE_SYNC' | 'BUSY_UPDATE' | 'CHECK_TRIGGERED';
  tabId: string;
  blockers?: SafePointBlocker[];
  state?: UpdateState;
}

const BROADCAST_CHANNEL_NAME = 'minadental_v7_update_bus';

function createDefaultAdapter(): PlatformUpdateAdapter {
  const nativePlatform = detectNativeHostPlatform();
  if (nativePlatform) {
    return new NativePlatformUpdateAdapter(nativePlatform);
  }
  return new WebPwaUpdateAdapter();
}

function createTabId(): string {
  return `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Single Authoritative UpdateCoordinator for MinaDental V7.
 *
 * Guarantees:
 * - Strictly typed state machine transitions (`ALLOWED_UPDATE_TRANSITIONS`).
 * - Single-flight in-process mutex + Web Locks API (when supported) + cross-tab lease fallback.
 * - Multi-tab safe-point consensus via BroadcastChannel (dirty forms / pending payments / offline queue).
 * - Zero fake progress, zero silent catch turning errors into UP_TO_DATE, zero client-authority installs.
 * - `INSTALLED` is ONLY reached after real post-boot runtime + worker identity verification.
 * - Zero reload loops (at-most-once reload per releaseId + attempt).
 */
export class UpdateCoordinator {
  private readonly tabId = createTabId();
  private readonly adapter: PlatformUpdateAdapter;
  private readonly ledger: UpdateLedger;
  private readonly telemetry = new UpdateTelemetryStore();
  private readonly config: UpdateCoordinatorConfig;

  private state: UpdateState = 'IDLE';
  private progress: UpdateProgress | null = null;
  private error: UpdateErrorInfo | null = null;
  private lastCheck: LastCheckRecord | null = null;
  private candidate: CandidateReleaseRecord | null = null;
  private pendingActivation: PendingActivationJournal | null = null;

  private readonly localBlockers = new Map<string, SafePointBlocker>();
  private readonly remoteTabBlockers = new Map<string, SafePointBlocker[]>();
  private readonly listeners = new Set<(snapshot: UpdateSnapshot) => void>();

  private activeCheckPromise: Promise<UpdateSnapshot> | null = null;
  private activeStagePromise: Promise<UpdateSnapshot> | null = null;
  private activeActivatePromise: Promise<UpdateSnapshot> | null = null;
  private activeAbortController: AbortController | null = null;

  private lastAutoCheckAtMs = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private broadcastChannel: BroadcastChannel | null = null;

  private boundVisibilityHandler: (() => void) | null = null;
  private boundOnlineHandler: (() => void) | null = null;
  private boundOfflineHandler: (() => void) | null = null;
  private boundSwUpdateHandler: ((ev: Event) => void) | null = null;
  private boundStorageQueueHandler: (() => void) | null = null;

  constructor(config: UpdateCoordinatorConfig = {}) {
    this.config = config;
    this.adapter = config.adapter ?? createDefaultAdapter();
    this.ledger = config.ledger ?? new UpdateLedger(config.storage);

    this.lastCheck = this.ledger.getLastCheck();
    this.candidate = this.ledger.getCandidate();
    this.pendingActivation = this.ledger.getPendingActivation();

    if (!this.isOnline()) {
      this.state = 'OFFLINE';
    }
  }

  private isOnline(): boolean {
    if (this.config.isOnlineFn) return this.config.isOnlineFn();
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  }

  private isDocumentVisible(): boolean {
    if (this.config.isDocumentVisibleFn) return this.config.isDocumentVisibleFn();
    return typeof document === 'undefined' ? true : document.visibilityState === 'visible';
  }

  private getOfflineQueueCount(): number {
    if (this.config.getOfflineQueueCount) return this.config.getOfflineQueueCount();
    try {
      return getOfflineQueue().length;
    } catch {
      return 0;
    }
  }

  private getBaseUrl(): string {
    if (this.config.baseUrl) return this.config.baseUrl;
    if (typeof window !== 'undefined') return window.location.href;
    return 'http://127.0.0.1/';
  }

  private transition(
    next: UpdateState,
    correlationId: string,
    event: string,
    detail?: unknown,
    errorCode: UpdateErrorCode | null = null
  ): boolean {
    if (!canTransitionUpdateState(this.state, next)) {
      this.telemetry.record({
        correlationId,
        event: `INVALID_TRANSITION_BLOCKED:${this.state}->${next}`,
        state: this.state,
        runtimeReleaseId: this.adapter.getCurrentRuntimeIdentity().releaseId,
        candidateReleaseId: this.candidate?.manifest.releaseId ?? null,
        errorCode,
        detail,
      });
      return false;
    }
    this.state = next;
    this.telemetry.record({
      correlationId,
      event,
      state: next,
      runtimeReleaseId: this.adapter.getCurrentRuntimeIdentity().releaseId,
      candidateReleaseId: this.candidate?.manifest.releaseId ?? null,
      errorCode,
      detail,
    });
    this.emit();
    return true;
  }

  private setError(code: UpdateErrorCode, technicalDetail: string, correlationId: string): UpdateErrorInfo {
    const info: UpdateErrorInfo = {
      code,
      messageFa: getPersianUpdateErrorMessage(code),
      technicalDetail: sanitizeLogMessage(technicalDetail),
      retryable: isRetryableUpdateError(code),
      occurredAt: new Date().toISOString(),
      correlationId,
    };
    this.error = info;
    return info;
  }

  public getSafePointEvaluation() {
    const remote: SafePointBlocker[] = [];
    this.remoteTabBlockers.forEach((list) => remote.push(...list));
    return evaluateSafePoint({
      localBlockers: Array.from(this.localBlockers.values()),
      remoteTabBlockers: remote,
      offlineQueueCount: this.getOfflineQueueCount(),
      activeTabId: this.tabId,
    });
  }

  public getSnapshot(): UpdateSnapshot {
    const runtime = this.adapter.getCurrentRuntimeIdentity();
    const installed = this.ledger.getInstalledRelease(runtime);
    return {
      state: this.state,
      isOnline: this.isOnline(),
      autoUpdateEnabled: this.ledger.isAutoUpdateEnabled(),
      channel: runtime.channel,
      platform: runtime.platform,
      capabilities: this.adapter.getCapabilities(),
      installed,
      lastCheck: this.lastCheck,
      candidate: this.candidate,
      pendingActivation: this.pendingActivation,
      progress: this.progress,
      safePoint: this.getSafePointEvaluation(),
      error: this.error,
      metrics: this.telemetry.getMetrics(),
      recentDiagnostics: this.telemetry.getRecentEvents(),
    };
  }

  public subscribe(listener: (snapshot: UpdateSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.getSnapshot();
    this.listeners.forEach((fn) => {
      try {
        fn(snap);
      } catch {
        // isolate subscriber errors
      }
    });
  }

  public setAutoUpdateEnabled(enabled: boolean): UpdateSnapshot {
    this.ledger.setAutoUpdateEnabled(enabled);
    this.emit();
    return this.getSnapshot();
  }

  /**
   * Registers a safe-point blocker (e.g., dirty clinical form, unsaved treatment/payment editor).
   * Broadcasts busy status across tabs so no sibling tab forces a mid-transaction reload.
   */
  public registerBusyGuard(id: string, reason: string): () => void {
    this.localBlockers.set(id, { id, reason, tabId: this.tabId });
    this.broadcastBusyState();
    this.emit();
    return () => {
      this.localBlockers.delete(id);
      this.broadcastBusyState();
      this.emit();
      void this.tryResumeDeferredActivation();
    };
  }

  public deferCandidate(minutes = 30): UpdateSnapshot {
    if (!this.candidate) return this.getSnapshot();
    const until = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    this.candidate = {
      ...this.candidate,
      deferredUntil: until,
    };
    this.ledger.saveCandidate(this.candidate);
    this.emit();
    return this.getSnapshot();
  }

  private broadcastBusyState(): void {
    if (!this.broadcastChannel) return;
    try {
      const msg: BroadcastMessage = {
        type: 'BUSY_UPDATE',
        tabId: this.tabId,
        blockers: Array.from(this.localBlockers.values()),
      };
      this.broadcastChannel.postMessage(msg);
    } catch {
      // ignore closed channel
    }
  }

  private async runWithCrossTabLock<T>(lockName: string, fn: () => Promise<T>): Promise<T | null> {
    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
      return navigator.locks.request(lockName, { ifAvailable: true }, async (lock) => {
        if (!lock) return null;
        return fn();
      });
    }
    const acquired = this.ledger.tryAcquireLeaderLease(
      this.tabId,
      UPDATE_TIMING_POLICY.LEADER_LEASE_MS
    );
    if (!acquired) return null;
    try {
      return await fn();
    } finally {
      this.ledger.releaseLeaderLease(this.tabId);
    }
  }

  /**
   * Runs post-boot verification after shell commit.
   * ONLY this path can transition to `INSTALLED` and commit the verified installed release ledger!
   */
  public async verifyPostBoot(): Promise<UpdateSnapshot> {
    const pending = this.ledger.getPendingActivation();
    if (!pending) {
      // Ensure installed ledger tracks current verified baseline without fabricating a new install event
      const runtime = this.adapter.getCurrentRuntimeIdentity();
      if (runtime.origin === 'ci_pipeline' && runtime.releaseSequence > 0) {
        this.ledger.recordHighestVerifiedSequence(runtime.releaseSequence);
      }
      return this.getSnapshot();
    }

    const correlationId = createCorrelationId('boot');
    this.state = 'IDLE';
    this.transition('BOOT_VERIFYING', correlationId, 'POST_BOOT_HANDSHAKE_START', {
      targetReleaseId: pending.targetReleaseId,
    });

    const handshake = await this.adapter.verifyPostBootHandshake(pending.targetReleaseId);
    const runtime = this.adapter.getCurrentRuntimeIdentity();

    if (handshake.verified) {
      const candidateNotes =
        this.candidate?.manifest.releaseId === pending.targetReleaseId
          ? this.candidate.manifest.releaseNotes
          : `نسخه v${pending.targetSemver} با موفقیت نصب و تأیید شد.`;

      this.ledger.commitVerifiedInstalledRelease({
        releaseId: pending.targetReleaseId,
        releaseSequence: pending.targetSequence,
        semver: pending.targetSemver,
        channel: runtime.channel,
        platform: runtime.platform,
        runtimeBuildId: handshake.runtimeBuildId,
        workerBuildId: handshake.workerBuildId,
        releaseNotes: candidateNotes,
      });

      this.pendingActivation = null;
      this.candidate = null;
      this.progress = null;
      this.error = null;
      this.ledger.savePendingActivation(null);
      this.ledger.saveCandidate(null);
      this.telemetry.increment('bootVerifiedSuccesses');

      await this.adapter.cleanupObsoleteCaches(pending.targetReleaseId).catch(() => {});

      this.transition(
        'INSTALLED',
        correlationId,
        'POST_BOOT_HANDSHAKE_VERIFIED',
        `Verified runtime=${handshake.runtimeBuildId} worker=${handshake.workerBuildId ?? 'none'}`
      );

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('minadental-release-upgraded', {
            detail: this.getSnapshot().installed,
          })
        );
      }
      this.config.onBootVerifiedInstalled?.(this.getSnapshot());
      return this.getSnapshot();
    }

    // Boot verification failed: record failure, enter ROLLBACK_PENDING, NEVER loop reloads!
    this.telemetry.increment('bootFailures');
    this.telemetry.increment('recoveryCount');
    const updatedJournal: PendingActivationJournal = {
      ...pending,
      status: 'rollback_pending',
    };
    this.pendingActivation = updatedJournal;
    this.ledger.savePendingActivation(updatedJournal);
    this.setError(
      'BOOT_MISMATCH',
      handshake.reason || `Expected ${pending.targetReleaseId}, running ${handshake.runtimeBuildId}`,
      correlationId
    );
    this.transition('ROLLBACK_PENDING', correlationId, 'POST_BOOT_MISMATCH', handshake.reason, 'BOOT_MISMATCH');
    return this.getSnapshot();
  }

  /**
   * Completes rollback acknowledgement back to the verified running last-known-good build
   * (without performing an insecure downgrade or wiping user data).
   */
  public acknowledgeRollbackToLastKnownGood(): UpdateSnapshot {
    const correlationId = createCorrelationId('rbk');
    const runtime = this.adapter.getCurrentRuntimeIdentity();
    this.pendingActivation = null;
    this.candidate = null;
    this.progress = null;
    this.ledger.savePendingActivation(null);
    this.ledger.saveCandidate(null);
    this.telemetry.increment('recoveryCount');
    if (this.state !== 'ROLLBACK_PENDING') {
      this.transition('ROLLBACK_PENDING', correlationId, 'ROLLBACK_INITIATED', runtime.releaseId);
    }
    this.error = null;
    this.transition('ROLLED_BACK', correlationId, 'ROLLBACK_CONFIRMED_LKG', runtime.releaseId);
    return this.getSnapshot();
  }

  /**
   * Authoritative discovery check.
   * - Single-flight per process + cross-tab leader lock for automatic background checks.
   * - Debounces automatic checks (>=30s) while always allowing immediate manual checks.
   * - NEVER mutates `installed.verifiedAt` and NEVER fires `release-upgraded`.
   * - Offline / 5xx / timeout / schema / signature failures NEVER become UP_TO_DATE!
   */
  public async checkForUpdates(source: CheckTriggerSource = 'manual'): Promise<UpdateSnapshot> {
    if (this.activeCheckPromise) return this.activeCheckPromise;

    const isAutomatic = source !== 'manual';
    const minDebounce =
      this.config.minAutoDebounceMs ?? UPDATE_TIMING_POLICY.MIN_AUTO_CHECK_DEBOUNCE_MS;
    if (isAutomatic && Date.now() - this.lastAutoCheckAtMs < minDebounce) {
      return this.getSnapshot();
    }

    const execute = async (): Promise<UpdateSnapshot> => {
      const correlationId = createCorrelationId('chk');
      const startedAtMs = Date.now();
      this.telemetry.increment('checksTotal');

      if (!this.isOnline()) {
        this.lastCheck = {
          checkedAt: new Date().toISOString(),
          source,
          outcome: 'offline',
          httpStatus: null,
          etag: this.lastCheck?.etag ?? null,
          endpointUrl: this.config.manifestClient?.pointerUrl ?? './release-pointer.json',
          errorCode: 'OFFLINE',
          errorMessage: getPersianUpdateErrorMessage('OFFLINE'),
          correlationId,
          candidateReleaseId: null,
          candidateSequence: null,
        };
        this.ledger.saveLastCheck(this.lastCheck);
        this.setError('OFFLINE', 'Device offline', correlationId);
        this.transition('OFFLINE', correlationId, 'CHECK_OFFLINE', source, 'OFFLINE');
        return this.getSnapshot();
      }

      if (isAutomatic) {
        this.lastAutoCheckAtMs = Date.now();
      }

      this.error = null;
      this.activeAbortController?.abort();
      this.activeAbortController = new AbortController();

      // Allow restarting check from terminal states cleanly
      if (this.state !== 'CHECKING') {
        if (!canTransitionUpdateState(this.state, 'CHECKING')) {
          this.state = 'IDLE';
        }
        this.transition('CHECKING', correlationId, 'CHECK_STARTED', source);
      }

      const fetchRes = await fetchAuthoritativeRelease({
        ...this.config.manifestClient,
        pinnedKeys: this.config.pinnedKeys ?? PINNED_RELEASE_PUBLIC_KEYS,
        requireSignature: this.config.requireSignature,
        etag: source === 'manual' ? null : this.lastCheck?.etag ?? null,
        signal: this.activeAbortController.signal,
        isOnlineFn: () => this.isOnline(),
      });

      const elapsedMs = Date.now() - startedAtMs;
      this.telemetry.setTiming('lastDiscoveryDurationMs', elapsedMs);

      if (!fetchRes.ok) {
        this.telemetry.increment('checksFailed');
        const nextState: UpdateState = fetchRes.errorCode === 'OFFLINE' ? 'OFFLINE' : 'CHECK_FAILED';
        this.lastCheck = {
          checkedAt: new Date().toISOString(),
          source,
          outcome: fetchRes.errorCode === 'OFFLINE' ? 'offline' : 'failed',
          httpStatus: fetchRes.httpStatus,
          etag: this.lastCheck?.etag ?? null,
          endpointUrl: fetchRes.endpointUrl,
          errorCode: fetchRes.errorCode,
          errorMessage: getPersianUpdateErrorMessage(fetchRes.errorCode),
          correlationId,
          candidateReleaseId: null,
          candidateSequence: null,
        };
        this.ledger.saveLastCheck(this.lastCheck);
        this.setError(fetchRes.errorCode, fetchRes.detail, correlationId);
        this.transition(nextState, correlationId, 'CHECK_FAILED', fetchRes.detail, fetchRes.errorCode);
        return this.getSnapshot();
      }

      this.telemetry.increment('checksSucceeded');

      // 304 Not Modified: pointer unchanged since previous valid ETag
      if (fetchRes.notModified) {
        this.lastCheck = {
          checkedAt: new Date().toISOString(),
          source,
          outcome: 'not_modified',
          httpStatus: 304,
          etag: fetchRes.etag,
          endpointUrl: fetchRes.endpointUrl,
          errorCode: null,
          errorMessage: null,
          correlationId,
          candidateReleaseId: this.candidate?.manifest.releaseId ?? null,
          candidateSequence: this.candidate?.manifest.releaseSequence ?? null,
        };
        this.ledger.saveLastCheck(this.lastCheck);
        const nextState: UpdateState = this.candidate ? 'AVAILABLE' : 'UP_TO_DATE';
        this.transition(nextState, correlationId, 'CHECK_NOT_MODIFIED', 'HTTP 304');
        return this.getSnapshot();
      }

      const manifest = fetchRes.manifest!;
      const pointer = fetchRes.pointer!;
      const runtime = this.adapter.getCurrentRuntimeIdentity();
      const comparison = compareReleases(runtime, manifest, {
        revokedReleaseIds: pointer.revokedReleaseIds,
        highestSeenSequence: this.ledger.getHighestVerifiedSequence(),
      });

      if (comparison.kind === 'SAME_ARTIFACT') {
        this.candidate = null;
        this.ledger.saveCandidate(null);
        this.lastCheck = {
          checkedAt: new Date().toISOString(),
          source,
          outcome: 'up_to_date',
          httpStatus: fetchRes.httpStatus,
          etag: fetchRes.etag,
          endpointUrl: fetchRes.endpointUrl,
          errorCode: null,
          errorMessage: null,
          correlationId,
          candidateReleaseId: null,
          candidateSequence: null,
        };
        this.ledger.saveLastCheck(this.lastCheck);
        this.transition('UP_TO_DATE', correlationId, 'CHECK_UP_TO_DATE', runtime.releaseId);
        return this.getSnapshot();
      }

      if (
        comparison.kind === 'SEQUENCE_CONFLICT' ||
        comparison.kind === 'DOWNGRADE_REJECTED' ||
        comparison.kind === 'REPLAY_REJECTED' ||
        comparison.kind === 'RELEASE_REVOKED' ||
        comparison.kind === 'MIGRATION_REQUIRED'
      ) {
        const codeMap: Record<typeof comparison.kind, UpdateErrorCode> = {
          SEQUENCE_CONFLICT: 'SEQUENCE_CONFLICT',
          DOWNGRADE_REJECTED: 'DOWNGRADE_REJECTED',
          REPLAY_REJECTED: 'REPLAY_REJECTED',
          RELEASE_REVOKED: 'RELEASE_REVOKED',
          MIGRATION_REQUIRED: 'MIGRATION_REQUIRED',
        };
        const errCode = codeMap[comparison.kind];
        this.lastCheck = {
          checkedAt: new Date().toISOString(),
          source,
          outcome: 'failed',
          httpStatus: fetchRes.httpStatus,
          etag: fetchRes.etag,
          endpointUrl: fetchRes.endpointUrl,
          errorCode: errCode,
          errorMessage: getPersianUpdateErrorMessage(errCode),
          correlationId,
          candidateReleaseId: manifest.releaseId,
          candidateSequence: manifest.releaseSequence,
        };
        this.ledger.saveLastCheck(this.lastCheck);
        this.setError(errCode, comparison.detail, correlationId);
        this.transition('CHECK_FAILED', correlationId, `POLICY_REJECTED:${errCode}`, comparison.detail, errCode);
        return this.getSnapshot();
      }

      const caps = this.adapter.getCapabilities();
      const requiresNativeStore =
        comparison.kind === 'NATIVE_STORE_REQUIRED' ||
        (caps.isBundledWebView && !caps.supportsWebSwUpdates);

      this.candidate = {
        manifest,
        discoveredAt: new Date().toISOString(),
        source,
        verifiedAssetsCount: 0,
        totalAssetsCount: manifest.assets.length,
        integrityVerified: false,
        signatureVerified: fetchRes.signatureVerified,
        deferredUntil: null,
      };
      this.ledger.saveCandidate(this.candidate);

      this.lastCheck = {
        checkedAt: new Date().toISOString(),
        source,
        outcome: requiresNativeStore ? 'native_store_required' : 'available',
        httpStatus: fetchRes.httpStatus,
        etag: fetchRes.etag,
        endpointUrl: fetchRes.endpointUrl,
        errorCode: requiresNativeStore ? 'NATIVE_UPDATE_REQUIRED' : null,
        errorMessage: requiresNativeStore
          ? getPersianUpdateErrorMessage('NATIVE_UPDATE_REQUIRED')
          : null,
        correlationId,
        candidateReleaseId: manifest.releaseId,
        candidateSequence: manifest.releaseSequence,
      };
      this.ledger.saveLastCheck(this.lastCheck);

      if (requiresNativeStore) {
        this.transition(
          'NATIVE_STORE_REQUIRED',
          correlationId,
          'NATIVE_STORE_UPDATE_REQUIRED',
          `${manifest.releaseId} (#${manifest.releaseSequence})`
        );
        return this.getSnapshot();
      }

      this.transition(
        'AVAILABLE',
        correlationId,
        'RELEASE_AVAILABLE',
        `${manifest.releaseId} (#${manifest.releaseSequence}, reason=${comparison.reason})`
      );

      if (this.ledger.isAutoUpdateEnabled() && source !== 'manual') {
        void this.downloadAndVerifyCandidate();
      }

      return this.getSnapshot();
    };

    const runGuarded = async () => {
      if (isAutomatic) {
        const lockedResult = await this.runWithCrossTabLock('minadental_v7_check_lock', execute);
        return lockedResult ?? this.getSnapshot();
      }
      return execute();
    };

    this.activeCheckPromise = runGuarded().finally(() => {
      this.activeCheckPromise = null;
    });
    return this.activeCheckPromise;
  }

  /**
   * Downloads and verifies all critical + required lazy assets against SHA-256 digests & MIME rules.
   * Moves AVAILABLE -> DOWNLOADING -> VERIFYING -> READY_TO_ACTIVATE | WAITING_FOR_SAFE_POINT | FAILED.
   */
  public async downloadAndVerifyCandidate(): Promise<UpdateSnapshot> {
    if (this.activeStagePromise) return this.activeStagePromise;
    if (!this.candidate) return this.getSnapshot();

    const execute = async (): Promise<UpdateSnapshot> => {
      const correlationId = createCorrelationId('stg');
      const manifest = this.candidate!.manifest;
      const startedAtMs = Date.now();
      this.telemetry.increment('downloadsStarted');

      if (!this.isOnline()) {
        this.setError('OFFLINE', 'Offline before staging', correlationId);
        this.transition('OFFLINE', correlationId, 'STAGE_OFFLINE', manifest.releaseId, 'OFFLINE');
        return this.getSnapshot();
      }

      if (this.adapter.getCapabilities().isBundledWebView && !this.adapter.getCapabilities().supportsWebSwUpdates) {
        this.transition('NATIVE_STORE_REQUIRED', correlationId, 'STAGE_NATIVE_REQUIRED', manifest.releaseId);
        return this.getSnapshot();
      }

      this.error = null;
      this.transition('DOWNLOADING', correlationId, 'STAGE_DOWNLOAD_STARTED', manifest.releaseId);

      const stageRes = await this.adapter.stageAndVerify({
        manifest,
        baseUrl: this.getBaseUrl(),
        signal: this.activeAbortController?.signal,
        onProgress: (p) => {
          this.progress = p;
          if (p.phase === 'verify' && this.state === 'DOWNLOADING') {
            this.transition('VERIFYING', correlationId, 'STAGE_VERIFYING', manifest.releaseId);
          } else {
            this.emit();
          }
        },
      });

      if (!stageRes.ok) {
        const errCode = stageRes.errorCode ?? 'ASSET_VERIFICATION_FAILED';
        this.progress = null;
        this.setError(errCode, stageRes.detail || 'Staging failed', correlationId);
        this.transition('FAILED', correlationId, 'STAGE_FAILED', stageRes.detail, errCode);
        return this.getSnapshot();
      }

      if (this.state === 'DOWNLOADING') {
        this.transition('VERIFYING', correlationId, 'STAGE_VERIFY_COMPLETE', manifest.releaseId);
      }

      this.candidate = {
        ...this.candidate!,
        verifiedAssetsCount: stageRes.verifiedAssetsCount,
        integrityVerified: true,
      };
      this.ledger.saveCandidate(this.candidate);
      this.progress = null;
      this.telemetry.increment('downloadsVerified');
      this.telemetry.setTiming('lastTimeToReadyMs', Date.now() - startedAtMs);

      const safe = this.getSafePointEvaluation();
      if (!safe.isSafe) {
        this.transition(
          'WAITING_FOR_SAFE_POINT',
          correlationId,
          'STAGED_WAITING_SAFE_POINT',
          `Blockers: ${safe.blockers.map((b) => b.id).join(', ')}`
        );
        return this.getSnapshot();
      }

      this.transition(
        'READY_TO_ACTIVATE',
        correlationId,
        'STAGED_READY_TO_ACTIVATE',
        `${manifest.releaseId} (${stageRes.verifiedAssetsCount} assets verified)`
      );
      return this.getSnapshot();
    };

    this.activeStagePromise = execute().finally(() => {
      this.activeStagePromise = null;
    });
    return this.activeStagePromise;
  }

  /**
   * Activates a verified candidate ONLY when safe-point consensus passes (or explicitly forced
   * by user after reviewing warning). Writes `PendingActivationJournal` BEFORE switching SW,
   * enforces reload cap (0 reload loops), and NEVER marks `INSTALLED` prematurely!
   */
  public async activateVerifiedCandidate(options?: {
    forceEvenIfBusy?: boolean;
    allowReload?: boolean;
  }): Promise<UpdateSnapshot> {
    if (this.activeActivatePromise) return this.activeActivatePromise;

    const execute = async (): Promise<UpdateSnapshot> => {
      const correlationId = createCorrelationId('act');
      if (!this.candidate) return this.getSnapshot();

      if (!this.candidate.integrityVerified) {
        const staged = await this.downloadAndVerifyCandidate();
        if (staged.state !== 'READY_TO_ACTIVATE' && staged.state !== 'WAITING_FOR_SAFE_POINT') {
          return staged;
        }
      }

      const safe = this.getSafePointEvaluation();
      if (!safe.isSafe && !options?.forceEvenIfBusy) {
        this.transition(
          'WAITING_FOR_SAFE_POINT',
          correlationId,
          'ACTIVATION_DEFERRED_SAFE_POINT',
          safe.blockers.map((b) => b.id).join(',')
        );
        return this.getSnapshot();
      }

      const manifest = this.candidate!.manifest;
      const runtime = this.adapter.getCurrentRuntimeIdentity();
      const existingPending = this.ledger.getPendingActivation();

      // Reload loop cap: never exceed MAX_ACTIVATION_ATTEMPTS for the same targetReleaseId
      const nextAttempt =
        existingPending && existingPending.targetReleaseId === manifest.releaseId
          ? existingPending.attemptCount + 1
          : 1;

      if (nextAttempt > UPDATE_TIMING_POLICY.MAX_ACTIVATION_ATTEMPTS) {
        this.telemetry.increment('reloadLoopsBlocked');
        this.setError(
          'RELOAD_LIMIT_REACHED',
          `Reload cap reached (${UPDATE_TIMING_POLICY.MAX_ACTIVATION_ATTEMPTS}) for ${manifest.releaseId}`,
          correlationId
        );
        this.transition('FAILED', correlationId, 'RELOAD_CAP_ENFORCED', manifest.releaseId, 'RELOAD_LIMIT_REACHED');
        return this.getSnapshot();
      }

      const returnUrl =
        typeof window !== 'undefined' ? window.location.href : this.getBaseUrl();

      const journal: PendingActivationJournal = {
        targetReleaseId: manifest.releaseId,
        targetSequence: manifest.releaseSequence,
        targetSemver: manifest.semver,
        previousReleaseId: runtime.releaseId,
        previousSequence: runtime.releaseSequence,
        attemptCount: nextAttempt,
        maxAttempts: UPDATE_TIMING_POLICY.MAX_ACTIVATION_ATTEMPTS,
        reloadedForAttempt: null,
        startedAt: new Date().toISOString(),
        returnUrl,
        status: 'activating',
      };
      this.pendingActivation = journal;
      this.ledger.savePendingActivation(journal);
      this.telemetry.increment('activationsAttempted');

      this.progress = {
        phase: 'activate',
        determinate: false,
        percent: null,
        bytesLoaded: null,
        bytesTotal: null,
        completedAssets: this.candidate!.verifiedAssetsCount,
        totalAssets: this.candidate!.totalAssetsCount,
        label: `در حال فعال‌سازی کنترل‌شده نسخه v${manifest.semver}...`,
      };
      this.transition('ACTIVATING', correlationId, 'ACTIVATION_STARTED', manifest.releaseId);

      const actRes = await this.adapter.activateTargetRelease({
        targetReleaseId: manifest.releaseId,
        returnUrl,
        allowReload: options?.allowReload !== false,
      });

      if (!actRes.ok) {
        const code = actRes.errorCode ?? 'ACTIVATION_TIMEOUT';
        this.progress = null;
        this.pendingActivation = { ...journal, status: 'failed' };
        this.ledger.savePendingActivation(this.pendingActivation);
        this.setError(code, actRes.detail || 'Activation failed', correlationId);
        this.transition('FAILED', correlationId, 'ACTIVATION_FAILED', actRes.detail, code);
        return this.getSnapshot();
      }

      const awaitingJournal: PendingActivationJournal = {
        ...journal,
        reloadedForAttempt: actRes.reloadTriggered ? nextAttempt : null,
        status: 'awaiting_boot_verify',
      };
      this.pendingActivation = awaitingJournal;
      this.ledger.savePendingActivation(awaitingJournal);
      this.progress = null;
      this.transition('BOOT_VERIFYING', correlationId, 'AWAITING_POST_BOOT_VERIFY', manifest.releaseId);
      return this.getSnapshot();
    };

    this.activeActivatePromise = execute().finally(() => {
      this.activeActivatePromise = null;
    });
    return this.activeActivatePromise;
  }

  /**
   * Handles Supabase Realtime `OTA_UPDATE_PUSH` strictly as an untrusted HINT.
   * Pushes without a valid releaseId are ignored; valid hints trigger an authoritative manifest fetch.
   */
  public async handleRealtimeHint(hint: {
    releaseId?: string;
    version?: string;
    build?: number;
  }): Promise<UpdateSnapshot> {
    const correlationId = createCorrelationId('hint');
    if (!isValidReleaseId(hint?.releaseId)) {
      this.telemetry.record({
        correlationId,
        event: 'REALTIME_HINT_IGNORED_INVALID_RELEASE_ID',
        state: this.state,
        runtimeReleaseId: this.adapter.getCurrentRuntimeIdentity().releaseId,
        detail: 'Ignored untrusted Realtime push lacking valid releaseId',
      });
      return this.getSnapshot();
    }

    const runtime = this.adapter.getCurrentRuntimeIdentity();
    if (hint.releaseId === runtime.releaseId) {
      return this.getSnapshot();
    }

    this.telemetry.record({
      correlationId,
      event: 'REALTIME_HINT_ACCEPTED',
      state: this.state,
      runtimeReleaseId: runtime.releaseId,
      candidateReleaseId: hint.releaseId,
      detail: 'Triggering authoritative manifest check from Realtime hint',
    });
    return this.checkForUpdates('realtime_hint');
  }

  public openNativeStoreAction(): void {
    if (!this.candidate) return;
    this.adapter.openStoreAction?.(this.candidate.manifest);
  }

  private async tryResumeDeferredActivation(): Promise<void> {
    if (this.state !== 'WAITING_FOR_SAFE_POINT' || !this.candidate?.integrityVerified) return;
    const safe = this.getSafePointEvaluation();
    if (!safe.isSafe) return;
    const correlationId = createCorrelationId('safe');
    this.transition('READY_TO_ACTIVATE', correlationId, 'SAFE_POINT_REACHED', this.candidate.manifest.releaseId);
  }

  private scheduleNextPoll(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (!this.started || !this.isDocumentVisible()) return;

    const baseMs = this.config.pollIntervalMs ?? UPDATE_TIMING_POLICY.DEFAULT_POLL_INTERVAL_MS;
    const jitterMs = this.config.pollJitterMaxMs ?? UPDATE_TIMING_POLICY.POLL_JITTER_MAX_MS;
    const delay = computeJitteredDelayMs(baseMs, jitterMs);

    this.pollTimer = setTimeout(() => {
      if (!this.started) return;
      if (this.isDocumentVisible() && this.isOnline()) {
        void this.checkForUpdates('poll').finally(() => this.scheduleNextPoll());
      } else {
        this.scheduleNextPoll();
      }
    }, delay);
  }

  /**
   * Starts automatic discovery lifecycle AFTER shell commit:
   * - Post-boot handshake verification
   * - Initial startup check
   * - Foreground-only jittered 5-min polling (paused in background)
   * - visibilitychange, online/offline, SW update event, and multi-tab BroadcastChannel
   */
  public start(): () => void {
    if (this.started) return () => this.stop();
    this.started = true;

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        this.broadcastChannel.onmessage = (ev: MessageEvent<BroadcastMessage>) => {
          const msg = ev.data;
          if (!msg || msg.tabId === this.tabId) return;
          if (msg.type === 'BUSY_UPDATE') {
            if (msg.blockers && msg.blockers.length > 0) {
              this.remoteTabBlockers.set(msg.tabId, msg.blockers);
            } else {
              this.remoteTabBlockers.delete(msg.tabId);
            }
            this.emit();
            void this.tryResumeDeferredActivation();
          }
        };
      } catch {
        this.broadcastChannel = null;
      }
    }

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      this.boundVisibilityHandler = () => {
        if (document.visibilityState === 'visible') {
          this.scheduleNextPoll();
          void this.checkForUpdates('visibility');
        } else if (this.pollTimer) {
          clearTimeout(this.pollTimer);
          this.pollTimer = null;
        }
      };
      this.boundOnlineHandler = () => {
        this.emit();
        void this.checkForUpdates('online');
      };
      this.boundOfflineHandler = () => {
        const correlationId = createCorrelationId('net');
        if (canTransitionUpdateState(this.state, 'OFFLINE')) {
          this.transition('OFFLINE', correlationId, 'NETWORK_OFFLINE', 'navigator.onLine=false', 'OFFLINE');
        } else {
          this.emit();
        }
      };
      this.boundSwUpdateHandler = () => {
        void this.checkForUpdates('sw_event');
      };
      this.boundStorageQueueHandler = () => {
        this.emit();
        void this.tryResumeDeferredActivation();
      };

      document.addEventListener('visibilitychange', this.boundVisibilityHandler);
      window.addEventListener('online', this.boundOnlineHandler);
      window.addEventListener('offline', this.boundOfflineHandler);
      window.addEventListener('minadental:sw-update-available', this.boundSwUpdateHandler);
      window.addEventListener('minadental-offline-queue-changed', this.boundStorageQueueHandler);
    }

    // Post-boot verification first, then startup discovery check
    void this.verifyPostBoot().finally(() => {
      if (!this.started) return;
      void this.checkForUpdates('startup');
      this.scheduleNextPoll();
    });

    return () => this.stop();
  }

  public stop(): void {
    this.started = false;
    this.activeAbortController?.abort();
    this.activeAbortController = null;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (typeof document !== 'undefined' && this.boundVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
    }
    if (typeof window !== 'undefined') {
      if (this.boundOnlineHandler) window.removeEventListener('online', this.boundOnlineHandler);
      if (this.boundOfflineHandler) window.removeEventListener('offline', this.boundOfflineHandler);
      if (this.boundSwUpdateHandler) {
        window.removeEventListener('minadental:sw-update-available', this.boundSwUpdateHandler);
      }
      if (this.boundStorageQueueHandler) {
        window.removeEventListener('minadental-offline-queue-changed', this.boundStorageQueueHandler);
      }
    }
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch {
        // ignore
      }
      this.broadcastChannel = null;
    }
    this.ledger.releaseLeaderLease(this.tabId);
  }
}
