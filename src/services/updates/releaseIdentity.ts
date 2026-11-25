import type {
  AuthoritativeReleaseManifest,
  PinnedPublicKey,
  ReleaseAssetEntry,
  ReleaseChannel,
  ReleaseComparisonOutcome,
  ReleasePlatform,
  ReleasePointer,
  RuntimeReleaseIdentity,
} from './contracts';

export const RELEASE_ID_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z._-]+)?-[0-9a-f]{10}$/;
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

const VALID_CHANNELS = new Set<ReleaseChannel>(['stable', 'staging', 'canary']);
const VALID_PLATFORMS = new Set<ReleasePlatform>(['web', 'pwa', 'android', 'ios', 'windows']);

export const DEFAULT_ALLOWED_RELEASE_ORIGINS: readonly string[] = [
  'https://galaxy1364.github.io',
  'https://minadental.ir',
  'https://app.minadental.ir',
  'https://play.google.com',
  'https://apps.apple.com',
];

export function isValidReleaseId(value: unknown): value is string {
  return typeof value === 'string' && RELEASE_ID_PATTERN.test(value.trim());
}

export function compareSemver(a: string, b: string): number {
  const ma = SEMVER_PATTERN.exec(a.trim());
  const mb = SEMVER_PATTERN.exec(b.trim());
  if (!ma || !mb) return 0;
  for (let i = 1; i <= 3; i += 1) {
    const diff = Number(ma[i]) - Number(mb[i]);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function isAllowedReleaseUrl(
  rawUrl: string,
  options?: { currentOrigin?: string; extraAllowedOrigins?: readonly string[] }
): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;

  // Relative same-origin paths (./release-pointer.json, ./assets/...) are safe if no traversal
  if (trimmed.startsWith('./') || trimmed.startsWith('/')) {
    return !trimmed.includes('..') && !trimmed.startsWith('//');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  // Allow localhost / 127.0.0.1 HTTP exclusively for local preview/tests
  const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (isLoopback && (parsed.protocol === 'http:' || parsed.protocol === 'https:')) {
    return true;
  }

  if (parsed.protocol !== 'https:') return false;

  const allowed = new Set<string>([
    ...DEFAULT_ALLOWED_RELEASE_ORIGINS,
    ...(options?.extraAllowedOrigins ?? []),
  ]);
  if (options?.currentOrigin && options.currentOrigin.startsWith('https://')) {
    allowed.add(options.currentOrigin);
  }
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    allowed.add(window.location.origin);
  }

  return allowed.has(parsed.origin);
}

function validateAssetEntry(raw: unknown): ReleaseAssetEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.path !== 'string' || !obj.path.trim() || obj.path.includes('..')) return null;
  if (typeof obj.sha256 !== 'string' || !SHA256_HEX_PATTERN.test(obj.sha256)) return null;
  if (typeof obj.size !== 'number' || !Number.isFinite(obj.size) || obj.size < 0) return null;
  return {
    path: obj.path.trim(),
    sha256: obj.sha256.toLowerCase(),
    size: Math.floor(obj.size),
    critical: Boolean(obj.critical),
    contentType: typeof obj.contentType === 'string' ? obj.contentType : undefined,
  };
}

export function validateReleaseManifest(
  raw: unknown
): { ok: true; manifest: AuthoritativeReleaseManifest } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Manifest payload is not an object' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== 2) {
    return { ok: false, reason: `Unsupported manifest schemaVersion: ${String(obj.schemaVersion)}` };
  }
  if (!isValidReleaseId(obj.releaseId)) {
    return { ok: false, reason: `Invalid releaseId format: ${String(obj.releaseId)}` };
  }
  if (
    typeof obj.releaseSequence !== 'number' ||
    !Number.isInteger(obj.releaseSequence) ||
    obj.releaseSequence < 0
  ) {
    return { ok: false, reason: `Invalid releaseSequence: ${String(obj.releaseSequence)}` };
  }
  if (typeof obj.semver !== 'string' || !SEMVER_PATTERN.test(obj.semver)) {
    return { ok: false, reason: `Invalid semver: ${String(obj.semver)}` };
  }
  if (typeof obj.gitCommit !== 'string' || obj.gitCommit.trim().length < 4) {
    return { ok: false, reason: 'Missing gitCommit in manifest' };
  }
  if (!VALID_CHANNELS.has(obj.channel as ReleaseChannel)) {
    return { ok: false, reason: `Invalid channel: ${String(obj.channel)}` };
  }
  if (!VALID_PLATFORMS.has(obj.platform as ReleasePlatform)) {
    return { ok: false, reason: `Invalid platform: ${String(obj.platform)}` };
  }
  if (typeof obj.minNativeVersion !== 'string' || !SEMVER_PATTERN.test(obj.minNativeVersion)) {
    return { ok: false, reason: 'Invalid minNativeVersion' };
  }
  if (
    typeof obj.minSchemaVersion !== 'number' ||
    !Number.isInteger(obj.minSchemaVersion) ||
    obj.minSchemaVersion < 1
  ) {
    return { ok: false, reason: 'Invalid minSchemaVersion' };
  }
  if (typeof obj.publishedAt !== 'string' || Number.isNaN(Date.parse(obj.publishedAt))) {
    return { ok: false, reason: 'Invalid publishedAt ISO timestamp' };
  }
  if (!Array.isArray(obj.assets) || obj.assets.length === 0) {
    return { ok: false, reason: 'Manifest assets list must be non-empty' };
  }

  const assets: ReleaseAssetEntry[] = [];
  for (const item of obj.assets) {
    const valid = validateAssetEntry(item);
    if (!valid) {
      return { ok: false, reason: 'Manifest contains invalid asset entry or SHA-256 digest' };
    }
    if (valid.path.includes('assets/aistudio')) {
      return { ok: false, reason: 'Manifest illegally references dev-only assets/aistudio artifact' };
    }
    assets.push(valid);
  }

  const entryScripts = Array.isArray(obj.entryScripts)
    ? obj.entryScripts.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];
  const entryStyles = Array.isArray(obj.entryStyles)
    ? obj.entryStyles.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    : [];

  if (obj.downloadUrl !== undefined && !isAllowedReleaseUrl(String(obj.downloadUrl))) {
    return { ok: false, reason: 'downloadUrl is outside HTTPS allowlist' };
  }

  const rp = (obj.rollbackPolicy && typeof obj.rollbackPolicy === 'object'
    ? obj.rollbackPolicy
    : {}) as Record<string, unknown>;

  const manifest: AuthoritativeReleaseManifest = {
    schemaVersion: 2,
    releaseId: obj.releaseId.trim(),
    releaseSequence: obj.releaseSequence,
    semver: obj.semver.trim(),
    gitCommit: obj.gitCommit.trim(),
    channel: obj.channel as ReleaseChannel,
    platform: obj.platform as ReleasePlatform,
    minNativeVersion: obj.minNativeVersion.trim(),
    minSchemaVersion: obj.minSchemaVersion,
    publishedAt: obj.publishedAt,
    releaseNotes: typeof obj.releaseNotes === 'string' ? obj.releaseNotes : '',
    entryScripts,
    entryStyles,
    assets,
    urgency: obj.urgency === 'critical' ? 'critical' : 'standard',
    revoked: Boolean(obj.revoked),
    revokedReason: typeof obj.revokedReason === 'string' ? obj.revokedReason : undefined,
    signature: typeof obj.signature === 'string' ? obj.signature : undefined,
    keyId: typeof obj.keyId === 'string' ? obj.keyId : undefined,
    downloadUrl: typeof obj.downloadUrl === 'string' ? obj.downloadUrl : undefined,
    origin: obj.origin === 'local_unreleased' ? 'local_unreleased' : 'ci_pipeline',
    rollbackPolicy: {
      strategy: 'forward_release',
      minRollbackSequence:
        typeof rp.minRollbackSequence === 'number' && Number.isInteger(rp.minRollbackSequence)
          ? rp.minRollbackSequence
          : Math.max(1, obj.releaseSequence),
      schemaBackwardCompatible: rp.schemaBackwardCompatible !== false,
      preserveUserData: true,
    },
  };

  return { ok: true, manifest };
}

export function validateReleasePointer(
  raw: unknown,
  options?: { currentOrigin?: string; extraAllowedOrigins?: readonly string[] }
): { ok: true; pointer: ReleasePointer } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'Release pointer payload is not an object' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== 2) {
    return { ok: false, reason: `Unsupported pointer schemaVersion: ${String(obj.schemaVersion)}` };
  }
  if (!VALID_CHANNELS.has(obj.channel as ReleaseChannel)) {
    return { ok: false, reason: `Invalid pointer channel: ${String(obj.channel)}` };
  }
  if (!VALID_PLATFORMS.has(obj.platform as ReleasePlatform)) {
    return { ok: false, reason: `Invalid pointer platform: ${String(obj.platform)}` };
  }
  if (!isValidReleaseId(obj.currentReleaseId)) {
    return { ok: false, reason: `Invalid pointer currentReleaseId: ${String(obj.currentReleaseId)}` };
  }
  if (
    typeof obj.releaseSequence !== 'number' ||
    !Number.isInteger(obj.releaseSequence) ||
    obj.releaseSequence < 0
  ) {
    return { ok: false, reason: `Invalid pointer releaseSequence: ${String(obj.releaseSequence)}` };
  }
  if (typeof obj.manifestUrl !== 'string' || !isAllowedReleaseUrl(obj.manifestUrl, options)) {
    return { ok: false, reason: `Pointer manifestUrl is invalid or outside allowlist: ${String(obj.manifestUrl)}` };
  }
  if (typeof obj.updatedAt !== 'string' || Number.isNaN(Date.parse(obj.updatedAt))) {
    return { ok: false, reason: 'Invalid pointer updatedAt timestamp' };
  }

  return {
    ok: true,
    pointer: {
      schemaVersion: 2,
      channel: obj.channel as ReleaseChannel,
      platform: obj.platform as ReleasePlatform,
      currentReleaseId: obj.currentReleaseId.trim(),
      releaseSequence: obj.releaseSequence,
      manifestUrl: obj.manifestUrl.trim(),
      updatedAt: obj.updatedAt,
      revokedReleaseIds: Array.isArray(obj.revokedReleaseIds)
        ? obj.revokedReleaseIds.filter((id): id is string => typeof id === 'string')
        : [],
      minSupportedSequence:
        typeof obj.minSupportedSequence === 'number' && Number.isInteger(obj.minSupportedSequence)
          ? obj.minSupportedSequence
          : undefined,
    },
  };
}

/**
 * Compares currently running release identity against a verified authoritative candidate manifest.
 * Enforces:
 * - Revocation checks
 * - Sequence conflict detection (same sequence + different digest => ERROR, never success)
 * - Downgrade & replay rejection
 * - Schema & native version compatibility
 * - Content-changed upgrade even when semver stays identical (provided sequence increased)
 */
export function compareReleases(
  current: RuntimeReleaseIdentity,
  candidate: AuthoritativeReleaseManifest,
  options?: {
    revokedReleaseIds?: readonly string[];
    highestSeenSequence?: number;
    maxStaleAgeMs?: number;
    nowMs?: number;
  }
): ReleaseComparisonOutcome {
  const revokedSet = new Set(options?.revokedReleaseIds ?? []);
  if (candidate.revoked || revokedSet.has(candidate.releaseId)) {
    return {
      kind: 'RELEASE_REVOKED',
      detail: candidate.revokedReason || `Release ${candidate.releaseId} has been revoked by release authority`,
    };
  }

  // Same immutable releaseId & same sequence => idempotent no-op
  if (
    candidate.releaseId === current.releaseId &&
    candidate.releaseSequence === current.releaseSequence
  ) {
    return { kind: 'SAME_ARTIFACT' };
  }

  // CRITICAL V7 Rule: same sequence with DIFFERENT content digest is a release integrity error!
  if (
    candidate.releaseSequence === current.releaseSequence &&
    candidate.releaseId !== current.releaseId
  ) {
    return {
      kind: 'SEQUENCE_CONFLICT',
      detail: `Sequence #${candidate.releaseSequence} digest mismatch: running ${current.releaseId} vs candidate ${candidate.releaseId}`,
    };
  }

  // Replay protection: reject older sequence than highest verified sequence ever seen
  const highWatermark = Math.max(current.releaseSequence, options?.highestSeenSequence ?? 0);
  if (candidate.releaseSequence < current.releaseSequence) {
    return {
      kind: 'DOWNGRADE_REJECTED',
      detail: `Candidate sequence #${candidate.releaseSequence} is lower than active #${current.releaseSequence}`,
    };
  }
  if (candidate.releaseSequence < highWatermark) {
    return {
      kind: 'REPLAY_REJECTED',
      detail: `Candidate sequence #${candidate.releaseSequence} is older than high-watermark #${highWatermark}`,
    };
  }

  // Optional stale manifest replay window check
  if (options?.maxStaleAgeMs && options.maxStaleAgeMs > 0) {
    const publishedMs = Date.parse(candidate.publishedAt);
    const nowMs = options.nowMs ?? Date.now();
    if (Number.isFinite(publishedMs) && nowMs - publishedMs > options.maxStaleAgeMs && candidate.releaseSequence <= highWatermark) {
      return {
        kind: 'REPLAY_REJECTED',
        detail: `Stale manifest publishedAt=${candidate.publishedAt} rejected`,
      };
    }
  }

  // Schema compatibility check
  if (candidate.minSchemaVersion > current.schemaVersion) {
    return {
      kind: 'MIGRATION_REQUIRED',
      detail: `Candidate requires DB schema v${candidate.minSchemaVersion}, client supports v${current.schemaVersion}`,
    };
  }

  // Native binary compatibility check
  if (
    (current.platform === 'android' || current.platform === 'ios') &&
    compareSemver(current.nativeVersion, candidate.minNativeVersion) < 0
  ) {
    return {
      kind: 'NATIVE_STORE_REQUIRED',
      detail: `Native app v${current.nativeVersion} is below required minNativeVersion v${candidate.minNativeVersion}`,
    };
  }

  return {
    kind: 'UPGRADE',
    reason: candidate.semver === current.semver ? 'content_changed_same_semver' : 'sequence_advanced',
  };
}

/**
 * Deterministic canonical string serialization for cryptographic manifest signing & verification.
 * Excludes `signature` so the signed payload is strictly reproducible across CI and browser WebCrypto.
 */
export function serializeCanonicalManifestPayload(manifest: AuthoritativeReleaseManifest): string {
  const { signature: _omit, ...rest } = manifest;
  const sortKeysDeep = (val: unknown): unknown => {
    if (Array.isArray(val)) return val.map(sortKeysDeep);
    if (val && typeof val === 'object') {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        const v = (val as Record<string, unknown>)[k];
        if (v !== undefined) sorted[k] = sortKeysDeep(v);
      }
      return sorted;
    }
    return val;
  };
  return JSON.stringify(sortKeysDeep(rest));
}

export async function computeSha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = globalThis.atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

/**
 * Verifies an ECDSA P-256 SHA-256 manifest signature against pinned public verification keys.
 * - If `requireSignature` is true (custom updater / non-Play APK), missing signature fails closed.
 * - If `signature` is present even on web, it MUST verify against a non-revoked pinned key.
 */
export async function verifyManifestSignature(
  manifest: AuthoritativeReleaseManifest,
  pinnedKeys: readonly PinnedPublicKey[],
  options?: { requireSignature?: boolean }
): Promise<{ ok: true; verified: boolean; keyId: string | null } | { ok: false; reason: string }> {
  const hasSignature = Boolean(manifest.signature);
  if (!hasSignature) {
    if (options?.requireSignature) {
      return { ok: false, reason: 'Signature is required for this distribution channel but missing' };
    }
    return { ok: true, verified: false, keyId: null };
  }

  if (!manifest.keyId) {
    return { ok: false, reason: 'Signed manifest is missing keyId' };
  }

  const pinned = pinnedKeys.find((k) => k.keyId === manifest.keyId);
  if (!pinned) {
    return { ok: false, reason: `Unknown or unpinned verification keyId: ${manifest.keyId}` };
  }
  if (pinned.status === 'revoked') {
    return { ok: false, reason: `Verification keyId ${manifest.keyId} has been revoked` };
  }

  try {
    const cryptoKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      pinned.jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    );
    const payloadBytes = new TextEncoder().encode(serializeCanonicalManifestPayload(manifest));
    const sigBytes = base64ToBytes(manifest.signature!);
    const sigBuf = new Uint8Array(sigBytes.byteLength);
    sigBuf.set(sigBytes);
    const payloadBuf = new Uint8Array(payloadBytes.byteLength);
    payloadBuf.set(payloadBytes);

    const valid = await globalThis.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      cryptoKey,
      sigBuf.buffer,
      payloadBuf.buffer
    );

    if (!valid) {
      return { ok: false, reason: `Cryptographic signature verification failed for keyId=${manifest.keyId}` };
    }
    return { ok: true, verified: true, keyId: pinned.keyId };
  } catch (err) {
    return {
      ok: false,
      reason: `Signature verification error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
