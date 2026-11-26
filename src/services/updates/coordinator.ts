import { getOfflineQueue } from '@/lib/offlineQueue';
import { sanitizeLogMessage } from '@/app/bootstrapState';
import type {
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
  DEFAULT_REQUIRE_RELEASE_SIGNATURE,
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
  peerHeartbeatTtlMs?: number;
  getOfflineQueueCount?: () => number;
  isOnlineFn?: () => boolean;
  isDocumentVisibleFn?: () => boolean;
  onBootVerifiedInstalled?: (snapshot: UpdateSnapshot) => void;
  baseUrl?: string;
}

interface BroadcastMessage {
  type: 'HELLO' | 'BUSY_SNAPSHOT' | 'TAB_CLOSING';
  tabId: string;
  sentAt: number;
  blockers?: SafePointBlocker[];
}

const BROADCAST_CHANNEL_NAME = 'minadental_v8_update_bus';

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
 * Single Authoritative Autonomous UpdateCoordinator (MinaDental V8).
 *
 * V8 Guarantees:
 * - Serialized, generation-bound transaction queue (no check replacing candidate mid-staging, no stale StrictMode commits).
 * - Autonomous end-to-end auto-update: discovery -> verified bytes -> safe point -> single activation -> post-boot attestation.
 * - Safe-point unblock automatically resumes and activates (when autoUpdateEnabled=true and not deferred).
 * - Cross-tab Web Locks / fencing-token lease serialization across check, stage, AND activate.
 * - Peer heartbeat/expiry multi-tab safe-point consensus via BroadcastChannel.
 * - Guarded recovery: ROLLED_BACK is reported ONLY when verified last-known-good build is genuinely running.
 * - All thrown exceptions terminate cleanly in a typed error state.
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

  /** Monotonic generation counter invalidating stale completions on cancel/stop/channel change */
  private operationGeneration = 0;
  private activeOperationPromise: Promise<UpdateSnapshot> | null = null;
  private activeAbortController: AbortController | null = null;

  private lastAutoCheckAtMs = 0;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private deferTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private broadcastChannel: BroadcastChannel | null = null;
  private activeFencingToken: number | null = null;

  private boundVisibilityHandler: (() => void) | null = null;
  private boundOnlineHandler: (() => void) | null = null;
  private boundOfflineHandler: (() => void) | null = null;
  private boundSwUpdateHandler: ((ev: Event) => void) | null = null;
  private boundStorageQueueHandler: (() => void) | null = null;
  private boundPageHideHandler: (() => void) | null = null;

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

  private getResolvedPointerUrl(): string {
    if (this.config.manifestClient?.pointerUrl) return this.config.manifestClient.pointerUrl;
    return this.adapter.getDefaultPointerUrl?.() ?? './release-pointer.json';
  }

  private isCandidateDeferred(nowMs = Date.now()): boolean {
    if (!this.candidate?.deferredUntil) return false;
    const untilMs = Date.parse(this.candidate.deferredUntil);
    return Number.isFinite(untilMs) && nowMs < untilMs;
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

  public getSafePointEvaluation(nowMs = Date.now()) {
    const remote: SafePointBlocker[] = [];
    this.remoteTabBlockers.forEach((list) => remote.push(...list));
    return evaluateSafePoint({
      localBlockers: Array.from(this.localBlockers.values()),
      remoteTabBlockers: remote,
      offlineQueueCount: this.getOfflineQueueCount(),
      activeTabId: this.tabId,
      nowMs,
      peerTtlMs: this.config.peerHeartbeatTtlMs ?? UPDATE_TIMING_POLICY.PEER_HEARTBEAT_TTL_MS,
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
   * Registers a safe-point blocker (dirty clinical form, unsaved payment/lab/implant editor).
   * Broadcasts updated blocker snapshot with heartbeat timestamp across tabs.
   */
  public registerBusyGuard(id: string, reason: string): () => void {
    this.localBlockers.set(id, { id, reason, tabId: this.tabId, updatedAt: Date.now() });
    this.broadcastBusyState('BUSY_SNAPSHOT');
    this.emit();
    return () => {
      this.localBlockers.delete(id);
      this.broadcastBusyState('BUSY_SNAPSHOT');
      this.emit();
      void this.tryResumeDeferredActivation();
    };
  }

  /**
   * Defers automatic activation for `minutes` and schedules automatic revalidation upon expiry.
   */
  public deferCandidate(minutes = 30): UpdateSnapshot {
    if (!this.candidate) return this.getSnapshot();
    const delayMs = Math.max(100, Math.round(minutes * 60 * 1000));
    const until = new Date(Date.now() + delayMs).toISOString();
    this.candidate = {
      ...this.candidate,
      deferredUntil: until,
    };
    this.ledger.saveCandidate(this.candidate);
    if (this.deferTimer) {
      clearTimeout(this.deferTimer);
      this.deferTimer = null;
    }
    this.deferTimer = setTimeout(() => {
      this.deferTimer = null;
      if (this.candidate && !this.isCandidateDeferred()) {
        this.candidate = { ...this.candidate, deferredUntil: null };
        this.ledger.saveCandidate(this.candidate);
        void this.tryResumeDeferredActivation();
      }
    }, Math.min(delayMs, 2_147_483_647));
    this.emit();
    return this.getSnapshot();
  }

  /**
   * Injects or clears a peer tab blocker snapshot (used by BroadcastChannel and multi-tab tests).
   */
  public applyRemoteTabBlockers(peerTabId: string, blockers: SafePointBlocker[]): void {
    if (!peerTabId || peerTabId === this.tabId) return;
    if (blockers.length > 0) {
      this.remoteTabBlockers.set(
        peerTabId,
        blockers.map((b) => ({ ...b, tabId: peerTabId, updatedAt: b.updatedAt ?? Date.now() }))
      );
    } else {
      this.remoteTabBlockers.delete(peerTabId);
    }
    this.emit();
    void this.tryResumeDeferredActivation();
  }

  private broadcastBusyState(type: BroadcastMessage['type'] = 'BUSY_SNAPSHOT'): void {
    if (!this.broadcastChannel) return;
    try {
      const now = Date.now();
      const blockers = Array.from(this.localBlockers.values()).map((b) => ({
        ...b,
        updatedAt: now,
      }));
      const msg: BroadcastMessage = {
        type,
        tabId: this.tabId,
        sentAt: now,
        blockers: type === 'TAB_CLOSING' ? [] : blockers,
      };
      this.broadcastChannel.postMessage(msg);
    } catch {
      // ignore closed channel
    }
  }

  private async runWithCrossTabLock<T>(
    scope: string,
    fn: () => Promise<T>
  ): Promise<{ executed: true; value: T } | { executed: false }> {
    const lockName = `minadental_v8_${scope}`;
    if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
      let executed = false;
      const result = await navigator.locks.request(lockName, { ifAvailable: true }, async (lock) => {
        if (!lock) return undefined as unknown as T;
        executed = true;
        return fn();
      });
      return executed ? { executed: true, value: result } : { executed: false };
    }

    const lease = this.ledger.tryAcquireLeaderLeaseWithFence(
      this.tabId,
      UPDATE_TIMING_POLICY.LEADER_LEASE_MS,
      scope
    );
    if (!lease.acquired) return { executed: false };
    this.activeFencingToken = lease.fencingToken;

    const renewInterval = setInterval(() => {
      if (this.activeFencingToken !== null) {
        this.ledger.renewLeaderLease(
          this.tabId,
          this.activeFencingToken,
          UPDATE_TIMING_POLICY.LEADER_LEASE_MS,
          scope
        );
      }
    }, Math.floor(UPDATE_TIMING_POLICY.LEADER_LEASE_MS / 2));

    try {
      const value = await fn();
      return { executed: true, value };
    } finally {
      clearInterval(renewInterval);
      this.ledger.releaseLeaderLease(this.tabId, scope, lease.fencingToken);
      this.activeFencingToken = null;
    }
  }

  /**
   * Serializes state-mutating operations under a single in-process transaction gate
   * bound to `operationGeneration` so concurrent checks/staging/activations NEVER race.
   */
  private runSerializedOperation(
    op: (gen: number) => Promise<UpdateSnapshot>
  ): Promise<UpdateSnapshot> {
    if (this.activeOperationPromise) return this.activeOperationPromise;
    const gen = ++this.operationGeneration;
    const promise = (async () => {
      try {
        return await op(gen);
      } catch (err) {
        const correlationId = createCorrelationId('err');
        const safeMsg = sanitizeLogMessage(err);
        this.progress = null;
        this.setError('UNKNOWN', safeMsg, correlationId);
        if (canTransitionUpdateState(this.state, 'FAILED')) {
          this.transition('FAILED', correlationId, 'UNCAUGHT_OPERATION_ERROR', safeMsg, 'UNKNOWN');
        } else if (canTransitionUpdateState(this.state, 'CHECK_FAILED')) {
          this.transition('CHECK_FAILED', correlationId, 'UNCAUGHT_CHECK_ERROR', safeMsg, 'UNKNOWN');
        }
        return this.getSnapshot();
      }
    })().finally(() => {
      this.activeOperationPromise = null;
    });
    this.activeOperationPromise = promise;
    return promise;
  }

  /**
   * Runs post-boot attestation after shell commit (and route commit in browser).
   * - On first install (no pending activation): attests baseline health BEFORE recording lastKnownGood.
   * - On pending activation: verifies runtime + embedded JS + worker + route BEFORE committing INSTALLED.
   */
  public async verifyPostBoot(options?: { requireRouteRendered?: boolean }): Promise<UpdateSnapshot> {
    const runtime = this.adapter.getCurrentRuntimeIdentity();
    this.adapter.reportClientReleaseLease?.(this.tabId, runtime.releaseId);

    const pending = this.ledger.getPendingActivation();
    if (!pending) {
      // Attest first-install baseline separately from updates (only set lastKnownGood once healthy!)
      const baselineCheck = await this.adapter.verifyPostBootHandshake(runtime.releaseId, {
        expectedContentDigest: runtime.contentDigest,
        expectedSemver: runtime.semver,
        requireWorkerMatch: runtime.platform === 'pwa',
        requireRouteRendered: options?.requireRouteRendered ?? false,
      });
      if (baselineCheck.verified) {
        this.ledger.commitVerifiedBaseline({
          runtime,
          workerBuildId: baselineCheck.workerBuildId,
        });
      }
      return this.getSnapshot();
    }

    const correlationId = createCorrelationId('boot');
    this.state = 'IDLE';
    this.transition('BOOT_VERIFYING', correlationId, 'POST_BOOT_HANDSHAKE_START', {
      targetReleaseId: pending.targetReleaseId,
    });

    const handshake = await this.adapter.verifyPostBootHandshake(pending.targetReleaseId, {
      expectedContentDigest: pending.targetContentDigest,
      expectedSemver: pending.targetSemver,
      requireWorkerMatch: Boolean(pending.requireWorkerMatch || runtime.platform === 'pwa'),
      requireRouteRendered: options?.requireRouteRendered ?? false,
    });

    if (handshake.verified) {
      const candidateNotes =
        this.candidate?.manifest.releaseId === pending.targetReleaseId
          ? this.candidate.manifest.releaseNotes
          : `نسخه v${pending.targetSemver} با موفقیت نصب و تأیید شد.`;

      const prevLkg = this.ledger.getInstalledRelease(runtime).lastKnownGoodReleaseId;
      this.ledger.commitVerifiedInstalledRelease({
        releaseId: pending.targetReleaseId,
        contentDigest: pending.targetContentDigest ?? runtime.contentDigest ?? null,
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

      // Prune ONLY truly obsolete caches while keeping active + last-known-good + leased client builds!
      await this.adapter
        .cleanupObsoleteCaches(pending.targetReleaseId, {
          lastKnownGoodReleaseId: prevLkg,
        })
        .catch(() => {});

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

    // Boot verification failed: persist rollback_pending journal, NEVER loop reloads!
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
   * V8-06 Guarded Recovery:
   * Transitions to `ROLLED_BACK` ONLY when the actually running verified runtime matches a
   * confirmed last-known-good build (distinct from the failed target release).
   * NEVER clears a failed activation journal blindly or fakes ROLLED_BACK!
   */
  public async acknowledgeRollbackToLastKnownGood(): Promise<UpdateSnapshot> {
    const correlationId = createCorrelationId('rbk');
    const runtime = this.adapter.getCurrentRuntimeIdentity();
    const installed = this.ledger.getInstalledRelease(runtime);
    const pending = this.pendingActivation ?? this.ledger.getPendingActivation();

    const lkgId = installed.lastKnownGoodReleaseId;
    const isRunningDifferentFromFailedTarget =
      !pending || runtime.releaseId !== pending.targetReleaseId;
    const isRunningVerifiedLkg =
      Boolean(lkgId) && runtime.releaseId === lkgId && isRunningDifferentFromFailedTarget;

    if (!isRunningVerifiedLkg) {
      this.setError(
        'RECOVERY_VERIFICATION_FAILED',
        `Cannot mark ROLLED_BACK: running=${runtime.releaseId}, lastKnownGood=${String(lkgId)}, failedTarget=${String(pending?.targetReleaseId ?? 'none')}`,
        correlationId
      );
      if (this.state !== 'ROLLBACK_PENDING' && canTransitionUpdateState(this.state, 'ROLLBACK_PENDING')) {
        this.transition('ROLLBACK_PENDING', correlationId, 'RECOVERY_UNVERIFIED', runtime.releaseId, 'RECOVERY_VERIFICATION_FAILED');
      } else {
        this.emit();
      }
      return this.getSnapshot();
    }

    // Double-check live runtime + worker handshake for the last-known-good build!
    const lkgCheck = await this.adapter.verifyPostBootHandshake(lkgId!, {
      expectedContentDigest: runtime.contentDigest,
      expectedSemver: runtime.semver,
      requireWorkerMatch: runtime.platform === 'pwa',
    });

    if (!lkgCheck.verified) {
      this.setError(
        'RECOVERY_VERIFICATION_FAILED',
        lkgCheck.reason || `LKG handshake failed for ${lkgId}`,
        correlationId
      );
      this.emit();
      return this.getSnapshot();
    }

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
    this.transition('ROLLED_BACK', correlationId, 'ROLLBACK_VERIFIED_LKG', lkgId);
    return this.getSnapshot();
  }

  /**
   * Authoritative discovery check.
   * - Serialized via generation-bound transaction + cross-tab lock.
   * - Manual check NEVER triggers auto-download or auto-activation.
   * - Automatic check with `autoUpdateEnabled=true` orchestrates end-to-end:
   *   discover -> download & verify -> safe-point check -> single controlled activation!
   */
  public async checkForUpdates(source: CheckTriggerSource = 'manual'): Promise<UpdateSnapshot> {
    if (
      this.state === 'DOWNLOADING' ||
      this.state === 'VERIFYING' ||
      this.state === 'ACTIVATING' ||
      this.state === 'BOOT_VERIFYING'
    ) {
      return this.getSnapshot();
    }

    const isAutomatic = source !== 'manual';
    const minDebounce =
      this.config.minAutoDebounceMs ?? UPDATE_TIMING_POLICY.MIN_AUTO_CHECK_DEBOUNCE_MS;
    if (isAutomatic && Date.now() - this.lastAutoCheckAtMs < minDebounce) {
      return this.getSnapshot();
    }

    let shouldAutoOrchestrate = false;

    const snap = await this.runSerializedOperation(async (gen) => {
      const execute = async (): Promise<UpdateSnapshot> => {
        if (gen !== this.operationGeneration) return this.getSnapshot();
        const correlationId = createCorrelationId('chk');
        const startedAtMs = Date.now();
        this.telemetry.increment('checksTotal');
        const pointerUrl = this.getResolvedPointerUrl();

        if (!this.isOnline()) {
          this.lastCheck = {
            checkedAt: new Date().toISOString(),
            source,
            outcome: 'offline',
            httpStatus: null,
            etag: this.lastCheck?.etag ?? null,
            endpointUrl: pointerUrl,
            errorCode: 'OFFLINE',
            errorMessage: getPersianUpdateErrorMessage('OFFLINE'),
            correlationId,
            candidateReleaseId: this.candidate?.manifest.releaseId ?? null,
            candidateSequence: this.candidate?.manifest.releaseSequence ?? null,
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

        if (this.state !== 'CHECKING') {
          if (!canTransitionUpdateState(this.state, 'CHECKING')) {
            this.state = 'IDLE';
          }
          this.transition('CHECKING', correlationId, 'CHECK_STARTED', source);
        }

        // V8: Do NOT send If-None-Match if manual check OR if previous check failed without trustworthy manifest!
        const canUseEtag =
          source !== 'manual' &&
          this.lastCheck?.outcome !== 'failed' &&
          this.lastCheck?.outcome !== 'offline' &&
          Boolean(this.lastCheck?.etag);

        const effectivePinnedKeys = this.config.pinnedKeys ?? PINNED_RELEASE_PUBLIC_KEYS;
        const effectiveRequireSignature =
          this.config.requireSignature ??
          (effectivePinnedKeys.length > 0 ? true : DEFAULT_REQUIRE_RELEASE_SIGNATURE);

        const fetchRes = await fetchAuthoritativeRelease({
          ...this.config.manifestClient,
          pointerUrl,
          pinnedKeys: effectivePinnedKeys,
          requireSignature: effectiveRequireSignature,
          etag: canUseEtag ? this.lastCheck?.etag ?? null : null,
          signal: this.activeAbortController.signal,
          isOnlineFn: () => this.isOnline(),
        });

        if (gen !== this.operationGeneration) return this.getSnapshot();

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
            // Clear stale ETag on failure so next check forces full re-fetch
            etag: null,
            endpointUrl: fetchRes.endpointUrl,
            errorCode: fetchRes.errorCode,
            errorMessage: getPersianUpdateErrorMessage(fetchRes.errorCode),
            correlationId,
            candidateReleaseId: this.candidate?.manifest.releaseId ?? null,
            candidateSequence: this.candidate?.manifest.releaseSequence ?? null,
          };
          this.ledger.saveLastCheck(this.lastCheck);
          this.setError(fetchRes.errorCode, fetchRes.detail, correlationId);
          this.transition(nextState, correlationId, 'CHECK_FAILED', fetchRes.detail, fetchRes.errorCode);
          return this.getSnapshot();
        }

        this.telemetry.increment('checksSucceeded');

        // 304 Not Modified: preserve validated candidate & resumable state
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
          if (
            this.candidate &&
            this.ledger.isAutoUpdateEnabled() &&
            isAutomatic &&
            !this.isCandidateDeferred()
          ) {
            shouldAutoOrchestrate = true;
          }
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
            etag: null,
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

        // Preserve existing deferredUntil if re-discovering the exact same candidate releaseId
        const existingDeferredUntil =
          this.candidate?.manifest.releaseId === manifest.releaseId
            ? this.candidate.deferredUntil
            : null;
        const alreadyVerifiedSame =
          this.candidate?.manifest.releaseId === manifest.releaseId &&
          this.candidate.integrityVerified;

        this.candidate = {
          manifest,
          manifestUrl: fetchRes.endpointUrl,
          discoveredAt: new Date().toISOString(),
          source,
          verifiedAssetsCount: alreadyVerifiedSame ? this.candidate!.verifiedAssetsCount : 0,
          totalAssetsCount: manifest.assets.length,
          integrityVerified: alreadyVerifiedSame,
          signatureVerified: fetchRes.signatureVerified,
          signatureStatus: fetchRes.signatureStatus,
          workerVerified: alreadyVerifiedSame ? this.candidate!.workerVerified : false,
          stagingStrategy: alreadyVerifiedSame ? this.candidate!.stagingStrategy : undefined,
          deferredUntil: existingDeferredUntil,
          generationId: gen,
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

        if (this.ledger.isAutoUpdateEnabled() && isAutomatic && !this.isCandidateDeferred()) {
          shouldAutoOrchestrate = true;
        }

        return this.getSnapshot();
      };

      if (isAutomatic) {
        const locked = await this.runWithCrossTabLock('check', execute);
        return locked.executed ? locked.value : this.getSnapshot();
      }
      return execute();
    });

    // V8-01 Autonomous End-to-End Orchestration:
    // If automatic discovery found a non-deferred candidate and autoUpdateEnabled is ON,
    // stage + verify AND (if safe point passes) activate automatically exactly once!
    if (shouldAutoOrchestrate && snap.state === 'AVAILABLE') {
      const staged = await this.downloadAndVerifyCandidate();
      if (
        staged.state === 'READY_TO_ACTIVATE' &&
        this.ledger.isAutoUpdateEnabled() &&
        !this.isCandidateDeferred()
      ) {
        return this.activateVerifiedCandidate({ allowReload: true });
      }
      return staged;
    }

    return snap;
  }

  /**
   * Downloads and verifies all required assets against SHA-256 + byte length + MIME and worker inventory.
   * Serialized under cross-tab lock & generation token.
   */
  public async downloadAndVerifyCandidate(): Promise<UpdateSnapshot> {
    if (!this.candidate) return this.getSnapshot();

    return this.runSerializedOperation(async (gen) => {
      const locked = await this.runWithCrossTabLock('stage', async () => {
        if (gen !== this.operationGeneration || !this.candidate) return this.getSnapshot();
        const correlationId = createCorrelationId('stg');
        const snapshotCandidate = this.candidate;
        const manifest = snapshotCandidate.manifest;
        const startedAtMs = Date.now();
        this.telemetry.increment('downloadsStarted');

        if (!this.isOnline()) {
          this.setError('OFFLINE', 'Offline before staging', correlationId);
          this.transition('OFFLINE', correlationId, 'STAGE_OFFLINE', manifest.releaseId, 'OFFLINE');
          return this.getSnapshot();
        }

        const caps = this.adapter.getCapabilities();
        if (caps.isBundledWebView && !caps.supportsWebSwUpdates) {
          this.transition('NATIVE_STORE_REQUIRED', correlationId, 'STAGE_NATIVE_REQUIRED', manifest.releaseId);
          return this.getSnapshot();
        }

        this.error = null;
        this.activeAbortController?.abort();
        this.activeAbortController = new AbortController();
        this.transition('DOWNLOADING', correlationId, 'STAGE_DOWNLOAD_STARTED', manifest.releaseId);

        const stageRes = await this.adapter.stageAndVerify({
          manifest,
          manifestUrl: snapshotCandidate.manifestUrl ?? null,
          baseUrl: this.getBaseUrl(),
          signal: this.activeAbortController.signal,
          onProgress: (p) => {
            if (gen !== this.operationGeneration) return;
            this.progress = p;
            if (p.phase === 'verify' && this.state === 'DOWNLOADING') {
              this.transition('VERIFYING', correlationId, 'STAGE_VERIFYING', manifest.releaseId);
            } else {
              this.emit();
            }
          },
        });

        if (gen !== this.operationGeneration) return this.getSnapshot();

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
          ...snapshotCandidate,
          verifiedAssetsCount: stageRes.verifiedAssetsCount,
          integrityVerified: true,
          workerVerified: Boolean(stageRes.workerVerified),
          stagingStrategy: stageRes.stagingStrategy,
          generationId: gen,
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
      });

      return locked.executed ? locked.value : this.getSnapshot();
    });
  }

  /**
   * Activates a verified candidate ONLY when safe-point consensus passes.
   * - Serialized across tabs via cross-tab lock.
   * - NEVER bypasses a non-empty offline payment/clinical queue!
   * - Persists `PendingActivationJournal` + `reloadedForAttempt` BEFORE invoking location.replace!
   */
  public async activateVerifiedCandidate(options?: {
    /** Deprecated clinical force flag: strictly ignored when offline queue is non-empty! */
    forceEvenIfBusy?: boolean;
    /** Explicit interactive confirmation after user approves discarding/saving open draft */
    userConfirmedClinicalSafeOverride?: boolean;
    allowReload?: boolean;
  }): Promise<UpdateSnapshot> {
    if (!this.candidate) return this.getSnapshot();

    if (!this.candidate.integrityVerified) {
      const staged = await this.downloadAndVerifyCandidate();
      if (staged.state !== 'READY_TO_ACTIVATE' && staged.state !== 'WAITING_FOR_SAFE_POINT') {
        return staged;
      }
    }

    return this.runSerializedOperation(async (gen) => {
      const locked = await this.runWithCrossTabLock('activate', async () => {
        if (gen !== this.operationGeneration || !this.candidate) return this.getSnapshot();
        const correlationId = createCorrelationId('act');

        const safe = this.getSafePointEvaluation();
        const hasOfflineQueueBlocker = safe.blockers.some((b) => b.id === 'offline_mutation_queue');
        const allowManualFormOverride =
          Boolean(options?.userConfirmedClinicalSafeOverride) && !hasOfflineQueueBlocker;

        if (!safe.isSafe && !allowManualFormOverride) {
          this.transition(
            'WAITING_FOR_SAFE_POINT',
            correlationId,
            'ACTIVATION_DEFERRED_SAFE_POINT',
            safe.blockers.map((b) => b.id).join(',')
          );
          return this.getSnapshot();
        }

        const snapshotCandidate = this.candidate;
        const manifest = snapshotCandidate.manifest;
        const runtime = this.adapter.getCurrentRuntimeIdentity();
        const existingPending = this.ledger.getPendingActivation();

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
          targetContentDigest: manifest.contentDigest ?? null,
          targetSequence: manifest.releaseSequence,
          targetSemver: manifest.semver,
          previousReleaseId: runtime.releaseId,
          previousSequence: runtime.releaseSequence,
          attemptCount: nextAttempt,
          maxAttempts: UPDATE_TIMING_POLICY.MAX_ACTIVATION_ATTEMPTS,
          reloadedForAttempt: null,
          startedAt: new Date().toISOString(),
          returnUrl,
          requireWorkerMatch: Boolean(snapshotCandidate.workerVerified || runtime.platform === 'pwa'),
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
          completedAssets: snapshotCandidate.verifiedAssetsCount,
          totalAssets: snapshotCandidate.totalAssetsCount,
          label: `در حال فعال‌سازی کنترل‌شده نسخه v${manifest.semver}...`,
        };
        this.transition('ACTIVATING', correlationId, 'ACTIVATION_STARTED', manifest.releaseId);

        const actRes = await this.adapter.activateTargetRelease({
          targetReleaseId: manifest.releaseId,
          returnUrl,
          allowReload: options?.allowReload !== false,
          beforeReload: () => {
            // V8-05: Persist reload marker BEFORE navigation so crashes/reloads are strictly journaled!
            const preReloadJournal: PendingActivationJournal = {
              ...journal,
              reloadedForAttempt: nextAttempt,
              status: 'awaiting_boot_verify',
            };
            this.pendingActivation = preReloadJournal;
            this.ledger.savePendingActivation(preReloadJournal);
          },
        });

        if (gen !== this.operationGeneration) return this.getSnapshot();

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
      });

      return locked.executed ? locked.value : this.getSnapshot();
    });
  }

  /**
   * Handles Supabase Realtime `OTA_UPDATE_PUSH` strictly as an untrusted rate-limited HINT.
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

  /**
   * V8-01 Autonomous Resume:
   * When safe-point blockers clear (or defer deadline expires), transitions to `READY_TO_ACTIVATE`
   * AND automatically triggers `activateVerifiedCandidate()` when autoUpdateEnabled is ON!
   */
  public async tryResumeDeferredActivation(): Promise<UpdateSnapshot> {
    if (!this.candidate?.integrityVerified) return this.getSnapshot();
    if (this.state !== 'WAITING_FOR_SAFE_POINT' && this.state !== 'READY_TO_ACTIVATE') {
      return this.getSnapshot();
    }
    const safe = this.getSafePointEvaluation();
    if (!safe.isSafe) return this.getSnapshot();

    if (this.state === 'WAITING_FOR_SAFE_POINT') {
      const correlationId = createCorrelationId('safe');
      this.transition('READY_TO_ACTIVATE', correlationId, 'SAFE_POINT_REACHED', this.candidate.manifest.releaseId);
    }

    if (this.ledger.isAutoUpdateEnabled() && !this.isCandidateDeferred()) {
      return this.activateVerifiedCandidate({ allowReload: true });
    }
    return this.getSnapshot();
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
   * Starts automatic discovery & multi-tab consensus lifecycle AFTER shell commit.
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
          if (msg.type === 'HELLO') {
            this.broadcastBusyState('BUSY_SNAPSHOT');
            if (msg.blockers && msg.blockers.length > 0) {
              this.applyRemoteTabBlockers(msg.tabId, msg.blockers);
            }
          } else if (msg.type === 'BUSY_SNAPSHOT') {
            this.applyRemoteTabBlockers(msg.tabId, msg.blockers ?? []);
          } else if (msg.type === 'TAB_CLOSING') {
            this.applyRemoteTabBlockers(msg.tabId, []);
          }
        };
        this.broadcastBusyState('HELLO');
      } catch {
        this.broadcastChannel = null;
      }
    }

    // Periodic peer heartbeat so active tabs keep blockers alive and closed/frozen tabs expire safely
    this.heartbeatTimer = setInterval(() => {
      if (!this.started) return;
      this.adapter.reportClientReleaseLease?.(
        this.tabId,
        this.adapter.getCurrentRuntimeIdentity().releaseId
      );
      if (this.localBlockers.size > 0) {
        this.broadcastBusyState('BUSY_SNAPSHOT');
      }
      if (this.state === 'WAITING_FOR_SAFE_POINT' && this.getSafePointEvaluation().isSafe) {
        void this.tryResumeDeferredActivation();
      }
    }, Math.floor((this.config.peerHeartbeatTtlMs ?? UPDATE_TIMING_POLICY.PEER_HEARTBEAT_TTL_MS) / 2));

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
      this.boundPageHideHandler = () => {
        this.broadcastBusyState('TAB_CLOSING');
      };

      document.addEventListener('visibilitychange', this.boundVisibilityHandler);
      window.addEventListener('online', this.boundOnlineHandler);
      window.addEventListener('offline', this.boundOfflineHandler);
      window.addEventListener('minadental:sw-update-available', this.boundSwUpdateHandler);
      window.addEventListener('minadental-offline-queue-changed', this.boundStorageQueueHandler);
      window.addEventListener('pagehide', this.boundPageHideHandler);
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
    this.operationGeneration += 1;
    this.activeAbortController?.abort();
    this.activeAbortController = null;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.deferTimer) {
      clearTimeout(this.deferTimer);
      this.deferTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
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
      if (this.boundPageHideHandler) {
        window.removeEventListener('pagehide', this.boundPageHideHandler);
      }
    }
    if (this.broadcastChannel) {
      try {
        this.broadcastBusyState('TAB_CLOSING');
        this.broadcastChannel.close();
      } catch {
        // ignore
      }
      this.broadcastChannel = null;
    }
    this.ledger.releaseLeaderLease(this.tabId, 'check');
    this.ledger.releaseLeaderLease(this.tabId, 'stage');
    this.ledger.releaseLeaderLease(this.tabId, 'activate');
  }
}
