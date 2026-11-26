/**
 * MinaDental V7/V8 — Verified Release Assurance & Autonomous Update Engine Contracts
 * Single source of truth for release identity, authoritative manifest schema v2,
 * typed state machine, separate ledger records, safe-point consensus, and boot attestation.
 */

export type ReleaseChannel = 'stable' | 'staging' | 'canary';

export type ReleasePlatform = 'web' | 'pwa' | 'android' | 'ios' | 'windows';

export type UpdateState =
  | 'IDLE'
  | 'CHECKING'
  | 'UP_TO_DATE'
  | 'AVAILABLE'
  | 'CHECK_FAILED'
  | 'OFFLINE'
  | 'DOWNLOADING'
  | 'VERIFYING'
  | 'READY_TO_ACTIVATE'
  | 'WAITING_FOR_SAFE_POINT'
  | 'ACTIVATING'
  | 'BOOT_VERIFYING'
  | 'INSTALLED'
  | 'FAILED'
  | 'ROLLBACK_PENDING'
  | 'ROLLED_BACK'
  | 'NATIVE_STORE_REQUIRED';

export type UpdateErrorCode =
  | 'OFFLINE'
  | 'TIMEOUT'
  | 'HTTP_ERROR'
  | 'SCHEMA_INVALID'
  | 'ORIGIN_NOT_ALLOWED'
  | 'SIGNATURE_INVALID'
  | 'DIGEST_MISMATCH'
  | 'SIZE_MISMATCH'
  | 'STORAGE_QUOTA_EXCEEDED'
  | 'SEQUENCE_CONFLICT'
  | 'DOWNGRADE_REJECTED'
  | 'REPLAY_REJECTED'
  | 'RELEASE_REVOKED'
  | 'MIGRATION_REQUIRED'
  | 'NATIVE_UPDATE_REQUIRED'
  | 'ASSET_VERIFICATION_FAILED'
  | 'ACTIVATION_TIMEOUT'
  | 'BOOT_MISMATCH'
  | 'RECOVERY_VERIFICATION_FAILED'
  | 'RELOAD_LIMIT_REACHED'
  | 'CLIENT_PUBLISH_FORBIDDEN'
  | 'UNSUPPORTED_PLATFORM'
  | 'UNKNOWN';

export type CheckTriggerSource =
  | 'startup'
  | 'manual'
  | 'poll'
  | 'visibility'
  | 'online'
  | 'realtime_hint'
  | 'sw_event';

export type SignatureVerificationStatus =
  | 'verified'
  | 'unsigned_web_origin_only'
  | 'invalid';

export interface ReleaseAssetEntry {
  path: string;
  sha256: string;
  size: number;
  critical: boolean;
  contentType?: string;
}

export interface ReleaseRollbackPolicy {
  strategy: 'forward_release';
  minRollbackSequence: number;
  schemaBackwardCompatible: boolean;
  preserveUserData: true;
}

export interface AuthoritativeReleaseManifest {
  schemaVersion: 2;
  /** Immutable content-derived short identity, e.g. v4.9.6-a1b2c3d4e5 */
  releaseId: string;
  /** Full 64-hex SHA-256 content digest across canonical assets + shell + SW + metadata */
  contentDigest?: string;
  /** Monotonic CI-assigned release sequence (>0 for official releases; 0 for local unreleased builds) */
  releaseSequence: number;
  /** Unified SemVer aligned across package.json, manifest, and native versionName */
  semver: string;
  gitCommit: string;
  channel: ReleaseChannel;
  platform: ReleasePlatform;
  minNativeVersion: string;
  minSchemaVersion: number;
  publishedAt: string;
  /** Optional ISO expiry timestamp for replay protection on signed distribution channels */
  expiresAt?: string;
  releaseNotes: string;
  entryScripts: string[];
  entryStyles: string[];
  assets: ReleaseAssetEntry[];
  urgency?: 'standard' | 'critical';
  revoked?: boolean;
  revokedReason?: string;
  /** Base64 ECDSA P-256 signature over canonical manifest payload (required for custom/non-Play packages) */
  signature?: string;
  /** Pinned public verification key identifier */
  keyId?: string;
  /** HTTPS-allowlisted download/store URL for native distribution */
  downloadUrl?: string;
  /** Distinguishes CI-published authoritative release from local dev build */
  origin?: 'ci_pipeline' | 'local_unreleased';
  rollbackPolicy: ReleaseRollbackPolicy;
}

export interface ReleasePointer {
  schemaVersion: 2;
  channel: ReleaseChannel;
  platform: ReleasePlatform;
  currentReleaseId: string;
  releaseSequence: number;
  manifestUrl: string;
  updatedAt: string;
  revokedReleaseIds?: string[];
  minSupportedSequence?: number;
}

export interface UpdateProgress {
  phase: 'download' | 'verify' | 'activate';
  /** True only when real byte totals or verified asset sizes are known */
  determinate: boolean;
  /** 0..100 when determinate=true, otherwise null (NEVER fabricated) */
  percent: number | null;
  bytesLoaded: number | null;
  bytesTotal: number | null;
  completedAssets: number;
  totalAssets: number;
  label: string;
}

export interface LastCheckRecord {
  checkedAt: string;
  source: CheckTriggerSource;
  outcome: 'up_to_date' | 'available' | 'offline' | 'failed' | 'native_store_required' | 'not_modified';
  httpStatus: number | null;
  etag: string | null;
  endpointUrl: string | null;
  errorCode: UpdateErrorCode | null;
  errorMessage: string | null;
  correlationId: string;
  candidateReleaseId: string | null;
  candidateSequence: number | null;
}

export interface CandidateReleaseRecord {
  manifest: AuthoritativeReleaseManifest;
  manifestUrl?: string | null;
  discoveredAt: string;
  source: CheckTriggerSource;
  verifiedAssetsCount: number;
  totalAssetsCount: number;
  integrityVerified: boolean;
  signatureVerified: boolean;
  signatureStatus?: SignatureVerificationStatus;
  workerVerified?: boolean;
  stagingStrategy?: 'service_worker' | 'browser_navigation';
  deferredUntil: string | null;
  generationId?: number;
}

export interface PendingActivationJournal {
  targetReleaseId: string;
  targetContentDigest?: string | null;
  targetSequence: number;
  targetSemver: string;
  previousReleaseId: string;
  previousSequence: number;
  attemptCount: number;
  maxAttempts: number;
  reloadedForAttempt: number | null;
  startedAt: string;
  returnUrl: string;
  requireWorkerMatch?: boolean;
  status: 'activating' | 'awaiting_boot_verify' | 'failed' | 'rollback_pending';
}

export interface InstalledReleaseRecord {
  releaseId: string;
  contentDigest?: string | null;
  releaseSequence: number;
  semver: string;
  channel: ReleaseChannel;
  platform: ReleasePlatform;
  verifiedAt: string | null;
  runtimeBuildId: string;
  workerBuildId: string | null;
  releaseNotes: string;
  /** Only set once a build actually passes health/boot proof (never unverified!) */
  lastKnownGoodReleaseId: string | null;
  lastKnownGoodSequence: number | null;
}

export interface SafePointBlocker {
  id: string;
  reason: string;
  tabId: string;
  updatedAt?: number;
}

export interface SafePointEvaluation {
  isSafe: boolean;
  blockers: SafePointBlocker[];
}

export interface UpdateErrorInfo {
  code: UpdateErrorCode;
  messageFa: string;
  technicalDetail: string;
  retryable: boolean;
  occurredAt: string;
  correlationId: string;
}

export interface UpdateDiagnosticEvent {
  timestamp: string;
  correlationId: string;
  event: string;
  state: UpdateState;
  runtimeReleaseId: string;
  candidateReleaseId: string | null;
  errorCode: UpdateErrorCode | null;
  detail: string;
}

export interface UpdateMetricsSnapshot {
  checksTotal: number;
  checksSucceeded: number;
  checksFailed: number;
  downloadsStarted: number;
  downloadsVerified: number;
  activationsAttempted: number;
  bootVerifiedSuccesses: number;
  bootFailures: number;
  recoveryCount: number;
  reloadLoopsBlocked: number;
  lastTimeToReadyMs: number | null;
  lastDiscoveryDurationMs: number | null;
}

export interface PlatformUpdateCapabilities {
  platform: ReleasePlatform;
  supportsWebSwUpdates: boolean;
  supportsInAppBinaryInstall: boolean;
  supportsStoreDeepLink: boolean;
  isBundledWebView: boolean;
  nativeVersionName: string | null;
  nativeVersionCode: number | null;
  packageName: string | null;
  storeUrl: string | null;
  remotePointerUrl?: string | null;
  honestLimitationFa: string | null;
}

export interface UpdateSnapshot {
  state: UpdateState;
  isOnline: boolean;
  autoUpdateEnabled: boolean;
  channel: ReleaseChannel;
  platform: ReleasePlatform;
  capabilities: PlatformUpdateCapabilities;
  installed: InstalledReleaseRecord;
  lastCheck: LastCheckRecord | null;
  candidate: CandidateReleaseRecord | null;
  pendingActivation: PendingActivationJournal | null;
  progress: UpdateProgress | null;
  safePoint: SafePointEvaluation;
  error: UpdateErrorInfo | null;
  metrics: UpdateMetricsSnapshot;
  recentDiagnostics: UpdateDiagnosticEvent[];
}

export interface PinnedPublicKey {
  keyId: string;
  algorithm: 'ECDSA-P256-SHA256';
  /** Raw JWK public key coordinates (safe to embed in client; private key stays strictly in CI/KMS) */
  jwk: JsonWebKey;
  status: 'active' | 'rotated' | 'revoked';
  validFrom: string;
  validUntil?: string;
}

export interface RuntimeReleaseIdentity {
  releaseId: string;
  contentDigest?: string | null;
  releaseSequence: number;
  semver: string;
  embeddedSemver?: string;
  embeddedSequence?: number;
  channel: ReleaseChannel;
  platform: ReleasePlatform;
  schemaVersion: number;
  nativeVersion: string;
  origin: 'ci_pipeline' | 'local_unreleased';
}

export type ReleaseComparisonOutcome =
  | { kind: 'SAME_ARTIFACT' }
  | { kind: 'UPGRADE'; reason: 'sequence_advanced' | 'content_changed_same_semver' }
  | { kind: 'SEQUENCE_CONFLICT'; detail: string }
  | { kind: 'DOWNGRADE_REJECTED'; detail: string }
  | { kind: 'REPLAY_REJECTED'; detail: string }
  | { kind: 'RELEASE_REVOKED'; detail: string }
  | { kind: 'MIGRATION_REQUIRED'; detail: string }
  | { kind: 'NATIVE_STORE_REQUIRED'; detail: string };
