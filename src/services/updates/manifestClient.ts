import type {
  AuthoritativeReleaseManifest,
  PinnedPublicKey,
  ReleaseAssetEntry,
  ReleasePointer,
  SignatureVerificationStatus,
  UpdateErrorCode,
  UpdateProgress,
} from './contracts';
import { UPDATE_TIMING_POLICY, computeJitteredDelayMs } from './policy';
import {
  computeSha256Hex,
  hasUnsafePathTraversal,
  isAllowedReleaseUrl,
  validateReleaseManifest,
  validateReleasePointer,
  verifyManifestSignature,
} from './releaseIdentity';

export interface ManifestFetchResult {
  ok: true;
  notModified: boolean;
  etag: string | null;
  httpStatus: number;
  endpointUrl: string;
  pointer: ReleasePointer | null;
  manifest: AuthoritativeReleaseManifest | null;
  signatureVerified: boolean;
  signatureStatus: SignatureVerificationStatus;
}

export interface ManifestFetchFailure {
  ok: false;
  errorCode: UpdateErrorCode;
  httpStatus: number | null;
  endpointUrl: string;
  detail: string;
}

export type FetchAuthoritativeReleaseResult = ManifestFetchResult | ManifestFetchFailure;

export interface ManifestClientOptions {
  pointerUrl?: string;
  manifestFallbackUrl?: string;
  currentOrigin?: string;
  extraAllowedOrigins?: readonly string[];
  pinnedKeys?: readonly PinnedPublicKey[];
  requireSignature?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  fetchFn?: typeof fetch;
  delayFn?: (ms: number) => Promise<void>;
  randomFn?: () => number;
  isOnlineFn?: () => boolean;
}

export interface VerifiedAssetPayload {
  asset: ReleaseAssetEntry;
  resolvedUrl: string;
  contentType: string;
  buffer: ArrayBuffer;
  sha256: string;
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveAgainstBase(ref: string, baseUrl: string): string {
  try {
    return new URL(ref, baseUrl).toString();
  } catch {
    return ref;
  }
}

function isSameOriginUrl(urlA: string, urlB: string): boolean {
  try {
    return new URL(urlA).origin === new URL(urlB).origin;
  } catch {
    return false;
  }
}

function isValidMimeForAssetPath(assetPath: string, contentType: string): boolean {
  const ct = (contentType || '').toLowerCase();
  const lower = assetPath.toLowerCase();
  if (lower.endsWith('.html') || lower === './' || lower.endsWith('/')) {
    return ct.includes('text/html');
  }
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) {
    return ct.includes('javascript') && !ct.includes('text/html');
  }
  if (lower.endsWith('.css')) {
    return ct.includes('text/css') && !ct.includes('text/html');
  }
  if (lower.endsWith('.json') || lower.endsWith('.webmanifest')) {
    return ct.includes('json') && !ct.includes('text/html');
  }
  if (lower.endsWith('.svg')) {
    return ct.includes('image/svg') && !ct.includes('text/html');
  }
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.ico')
  ) {
    return ct.includes('image/') && !ct.includes('text/html');
  }
  return !ct.includes('text/html');
}

/**
 * Runs an async fetch + body-consumption operation under a SINGLE independent deadline
 * so stalled headers, stalled body streams, OR stalled digest ops can NEVER hang forever!
 */
async function runWithDeadline<T>(
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
  fn: (attemptSignal: AbortSignal) => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; timedOut?: boolean; aborted?: boolean; error?: unknown }> {
  if (parentSignal?.aborted) return { ok: false, aborted: true };

  const attemptController = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onParentAbort = () => attemptController.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      attemptController.abort();
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const value = await Promise.race([fn(attemptController.signal), timeoutPromise]);
    return { ok: true, value };
  } catch (err) {
    if (parentSignal?.aborted) return { ok: false, aborted: true };
    if (timedOut) return { ok: false, timedOut: true };
    return { ok: false, error: err };
  } finally {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

async function fetchJsonWithRetry(input: {
  url: string;
  etag?: string | null;
  timeoutMs: number;
  maxRetries: number;
  baseBackoffMs: number;
  fetchFn: typeof fetch;
  delayFn: (ms: number) => Promise<void>;
  randomFn: () => number;
  signal?: AbortSignal;
  currentOrigin?: string;
  extraAllowedOrigins?: readonly string[];
}): Promise<
  | { ok: true; notModified: true; status: 304; etag: string | null }
  | { ok: true; notModified: false; status: number; etag: string | null; data: unknown; finalUrl: string }
  | { ok: false; errorCode: UpdateErrorCode; status: number | null; detail: string }
> {
  let lastCode: UpdateErrorCode = 'HTTP_ERROR';
  let lastStatus: number | null = null;
  let lastDetail = 'Unknown fetch failure';

  for (let attempt = 0; attempt <= input.maxRetries; attempt += 1) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    };
    if (input.etag) {
      headers['If-None-Match'] = input.etag;
    }

    const wrapped = await runWithDeadline(input.timeoutMs, input.signal, async (attemptSignal) => {
      const res = await input.fetchFn(input.url, {
        method: 'GET',
        cache: 'no-store',
        headers,
        signal: attemptSignal,
      });

      // Reject cross-origin redirects outside allowlist
      const finalUrl = res.url || input.url;
      if (
        res.redirected &&
        !isAllowedReleaseUrl(finalUrl, {
          currentOrigin: input.currentOrigin,
          extraAllowedOrigins: input.extraAllowedOrigins,
        })
      ) {
        return { kind: 'redirect_blocked' as const, finalUrl };
      }

      const responseEtag = res.headers.get('etag');
      if (res.status === 304) {
        return { kind: 'not_modified' as const, etag: responseEtag ?? input.etag ?? null };
      }
      if (res.status >= 200 && res.status < 300) {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('text/html')) {
          return { kind: 'html_response' as const, status: res.status };
        }
        const data = await res.json();
        return { kind: 'json' as const, status: res.status, etag: responseEtag, data, finalUrl };
      }
      return { kind: 'http_error' as const, status: res.status };
    });

    if (!wrapped.ok) {
      if (wrapped.aborted) {
        return { ok: false, errorCode: 'TIMEOUT', status: null, detail: 'Request cancelled by caller' };
      }
      if (wrapped.timedOut) {
        lastCode = 'TIMEOUT';
        lastStatus = null;
        lastDetail = `Request timed out after ${input.timeoutMs}ms`;
      } else {
        const err = wrapped.error;
        if (err instanceof SyntaxError) {
          return {
            ok: false,
            errorCode: 'SCHEMA_INVALID',
            status: 200,
            detail: `Malformed JSON from ${input.url}: ${err.message}`,
          };
        }
        lastCode = 'HTTP_ERROR';
        lastStatus = null;
        lastDetail = err instanceof Error ? err.message : String(err);
      }
    } else {
      const v = wrapped.value;
      if (v.kind === 'redirect_blocked') {
        return {
          ok: false,
          errorCode: 'ORIGIN_NOT_ALLOWED',
          status: null,
          detail: `Cross-origin redirect blocked: ${v.finalUrl}`,
        };
      }
      if (v.kind === 'not_modified') {
        return { ok: true, notModified: true, status: 304, etag: v.etag };
      }
      if (v.kind === 'html_response') {
        return {
          ok: false,
          errorCode: 'SCHEMA_INVALID',
          status: v.status,
          detail: `Expected JSON manifest but received text/html from ${input.url}`,
        };
      }
      if (v.kind === 'json') {
        return {
          ok: true,
          notModified: false,
          status: v.status,
          etag: v.etag,
          data: v.data,
          finalUrl: v.finalUrl,
        };
      }
      lastStatus = v.status;
      lastCode = 'HTTP_ERROR';
      lastDetail = `HTTP ${v.status} from ${input.url}`;
      if (v.status >= 400 && v.status < 500 && v.status !== 429) {
        return { ok: false, errorCode: 'HTTP_ERROR', status: v.status, detail: lastDetail };
      }
    }

    if (attempt < input.maxRetries) {
      const delay = computeJitteredDelayMs(
        input.baseBackoffMs * Math.pow(2, attempt),
        Math.round(input.baseBackoffMs * 0.5),
        input.randomFn
      );
      await input.delayFn(delay);
    }
  }

  return { ok: false, errorCode: lastCode, status: lastStatus, detail: lastDetail };
}

/**
 * Fetches the authoritative release pointer and manifest over HTTPS (or localhost in preview/tests)
 * with ETag support, 304 handling, bounded retries, independent deadline covering body reads,
 * cross-origin redirect rejection, strict schema validation, and cryptographic signature verification.
 */
export async function fetchAuthoritativeRelease(
  options?: ManifestClientOptions & { etag?: string | null; signal?: AbortSignal }
): Promise<FetchAuthoritativeReleaseResult> {
  const isOnlineFn =
    options?.isOnlineFn ??
    (() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));

  const pointerUrl = options?.pointerUrl ?? './release-pointer.json';
  const fetchFn = options?.fetchFn ?? globalThis.fetch.bind(globalThis);
  const delayFn = options?.delayFn ?? defaultDelay;
  const randomFn = options?.randomFn ?? Math.random;
  const timeoutMs = options?.timeoutMs ?? UPDATE_TIMING_POLICY.REQUEST_TIMEOUT_MS;
  const maxRetries = options?.maxRetries ?? UPDATE_TIMING_POLICY.MAX_CHECK_RETRIES;
  const baseBackoffMs = options?.baseBackoffMs ?? UPDATE_TIMING_POLICY.BASE_RETRY_BACKOFF_MS;

  if (!isOnlineFn()) {
    return {
      ok: false,
      errorCode: 'OFFLINE',
      httpStatus: null,
      endpointUrl: pointerUrl,
      detail: 'Browser reports offline state',
    };
  }

  if (
    !isAllowedReleaseUrl(pointerUrl, {
      currentOrigin: options?.currentOrigin,
      extraAllowedOrigins: options?.extraAllowedOrigins,
    })
  ) {
    return {
      ok: false,
      errorCode: 'ORIGIN_NOT_ALLOWED',
      httpStatus: null,
      endpointUrl: pointerUrl,
      detail: `Pointer URL blocked by HTTPS allowlist: ${pointerUrl}`,
    };
  }

  const pointerRes = await fetchJsonWithRetry({
    url: pointerUrl,
    etag: options?.etag,
    timeoutMs,
    maxRetries,
    baseBackoffMs,
    fetchFn,
    delayFn,
    randomFn,
    signal: options?.signal,
    currentOrigin: options?.currentOrigin,
    extraAllowedOrigins: options?.extraAllowedOrigins,
  });

  if (!pointerRes.ok) {
    return {
      ok: false,
      errorCode: pointerRes.errorCode,
      httpStatus: pointerRes.status,
      endpointUrl: pointerUrl,
      detail: pointerRes.detail,
    };
  }

  if (pointerRes.notModified) {
    return {
      ok: true,
      notModified: true,
      etag: pointerRes.etag,
      httpStatus: 304,
      endpointUrl: pointerUrl,
      pointer: null,
      manifest: null,
      signatureVerified: false,
      signatureStatus: 'unsigned_web_origin_only',
    };
  }

  const validatedPointer = validateReleasePointer(pointerRes.data, {
    currentOrigin: options?.currentOrigin,
    extraAllowedOrigins: options?.extraAllowedOrigins,
  });
  if (!validatedPointer.ok) {
    return {
      ok: false,
      errorCode: 'SCHEMA_INVALID',
      httpStatus: pointerRes.status,
      endpointUrl: pointerUrl,
      detail: validatedPointer.reason,
    };
  }

  const pointer = validatedPointer.pointer;
  const baseForManifest =
    pointerUrl.startsWith('http://') || pointerUrl.startsWith('https://')
      ? pointerUrl
      : typeof window !== 'undefined'
      ? window.location.href
      : 'http://127.0.0.1/';
  const resolvedManifestUrl = resolveAgainstBase(pointer.manifestUrl, baseForManifest);

  if (
    !isAllowedReleaseUrl(resolvedManifestUrl, {
      currentOrigin: options?.currentOrigin,
      extraAllowedOrigins: options?.extraAllowedOrigins,
    })
  ) {
    return {
      ok: false,
      errorCode: 'ORIGIN_NOT_ALLOWED',
      httpStatus: null,
      endpointUrl: resolvedManifestUrl,
      detail: `Manifest URL blocked by HTTPS allowlist: ${resolvedManifestUrl}`,
    };
  }

  const manifestRes = await fetchJsonWithRetry({
    url: resolvedManifestUrl,
    timeoutMs,
    maxRetries,
    baseBackoffMs,
    fetchFn,
    delayFn,
    randomFn,
    signal: options?.signal,
    currentOrigin: options?.currentOrigin,
    extraAllowedOrigins: options?.extraAllowedOrigins,
  });

  if (!manifestRes.ok) {
    return {
      ok: false,
      errorCode: manifestRes.errorCode,
      httpStatus: manifestRes.status,
      endpointUrl: resolvedManifestUrl,
      detail: manifestRes.detail,
    };
  }

  if (manifestRes.notModified) {
    return {
      ok: false,
      errorCode: 'SCHEMA_INVALID',
      httpStatus: 304,
      endpointUrl: resolvedManifestUrl,
      detail: 'Unexpected 304 without conditional request on release manifest',
    };
  }

  const validatedManifest = validateReleaseManifest(manifestRes.data);
  if (!validatedManifest.ok) {
    return {
      ok: false,
      errorCode: 'SCHEMA_INVALID',
      httpStatus: manifestRes.status,
      endpointUrl: resolvedManifestUrl,
      detail: validatedManifest.reason,
    };
  }

  const manifest = validatedManifest.manifest;

  // Cross-check pointer vs manifest coherence
  if (
    manifest.releaseId !== pointer.currentReleaseId ||
    manifest.releaseSequence !== pointer.releaseSequence
  ) {
    return {
      ok: false,
      errorCode: 'SEQUENCE_CONFLICT',
      httpStatus: manifestRes.status,
      endpointUrl: resolvedManifestUrl,
      detail: `Pointer (${pointer.currentReleaseId}#${pointer.releaseSequence}) does not match manifest (${manifest.releaseId}#${manifest.releaseSequence})`,
    };
  }

  // Cryptographic signature verification (never claims verified when unsigned)
  const sigCheck = await verifyManifestSignature(manifest, options?.pinnedKeys ?? [], {
    requireSignature: options?.requireSignature,
  });
  if (!sigCheck.ok) {
    return {
      ok: false,
      errorCode: 'SIGNATURE_INVALID',
      httpStatus: manifestRes.status,
      endpointUrl: resolvedManifestUrl,
      detail: sigCheck.reason,
    };
  }

  return {
    ok: true,
    notModified: false,
    etag: pointerRes.etag,
    httpStatus: manifestRes.status,
    endpointUrl: resolvedManifestUrl,
    pointer,
    manifest,
    signatureVerified: sigCheck.verified,
    signatureStatus: sigCheck.status,
  };
}

/**
 * Verifies every required asset listed in the authoritative manifest with V8 guarantees:
 * - Bounded concurrency (default 3) & overall stage deadline + per-asset deadline covering BOTH headers & body reads + SHA-256!
 * - Rejects cross-origin redirects, path traversal, invalid MIME (e.g. HTML for JS), byte-size mismatches, and SHA-256 mismatches.
 * - Enforces per-asset & total byte limits.
 * - Streams each verified `ArrayBuffer` directly to `onVerifiedAsset` so the exact hashed bytes are cached (eliminating TOCTOU!).
 */
export async function verifyReleaseAssets(input: {
  manifest: AuthoritativeReleaseManifest;
  baseUrl: string;
  verifyAllAssets?: boolean;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  totalDeadlineMs?: number;
  maxConcurrency?: number;
  maxSingleAssetBytes?: number;
  maxTotalReleaseBytes?: number;
  signal?: AbortSignal;
  onProgress?: (progress: UpdateProgress) => void;
  onVerifiedAsset?: (payload: VerifiedAssetPayload) => Promise<void> | void;
}): Promise<
  | { ok: true; verifiedCount: number; totalBytes: number }
  | { ok: false; errorCode: UpdateErrorCode; detail: string; failedAssetPath: string }
> {
  const fetchFn = input.fetchFn ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = input.timeoutMs ?? UPDATE_TIMING_POLICY.ASSET_TIMEOUT_MS;
  const totalDeadlineMs = input.totalDeadlineMs ?? UPDATE_TIMING_POLICY.STAGE_TOTAL_DEADLINE_MS;
  const maxConcurrency = Math.max(
    1,
    Math.min(6, input.maxConcurrency ?? UPDATE_TIMING_POLICY.MAX_CONCURRENT_ASSET_DOWNLOADS)
  );
  const maxSingleAssetBytes =
    input.maxSingleAssetBytes ?? UPDATE_TIMING_POLICY.MAX_SINGLE_ASSET_BYTES;
  const maxTotalReleaseBytes =
    input.maxTotalReleaseBytes ?? UPDATE_TIMING_POLICY.MAX_TOTAL_RELEASE_BYTES;

  const targetAssets: ReleaseAssetEntry[] = input.verifyAllAssets
    ? input.manifest.assets
    : input.manifest.assets.filter((a) => a.critical || a.path.endsWith('.js') || a.path.endsWith('.css'));

  const assetsToCheck = targetAssets.length > 0 ? targetAssets : input.manifest.assets;
  const knownTotalBytes = assetsToCheck.every((a) => a.size > 0)
    ? assetsToCheck.reduce((sum, a) => sum + a.size, 0)
    : null;

  if (knownTotalBytes !== null && knownTotalBytes > maxTotalReleaseBytes) {
    return {
      ok: false,
      errorCode: 'SIZE_MISMATCH',
      detail: `Declared release total (${knownTotalBytes} bytes) exceeds policy limit (${maxTotalReleaseBytes})`,
      failedAssetPath: 'release-manifest.json',
    };
  }

  const stageController = new AbortController();
  let stageTimedOut = false;
  const onParentAbort = () => stageController.abort();
  input.signal?.addEventListener('abort', onParentAbort, { once: true });
  const stageTimer = setTimeout(() => {
    stageTimedOut = true;
    stageController.abort();
  }, totalDeadlineMs);

  let loadedBytes = 0;
  let completedAssets = 0;
  let nextIndex = 0;
  const failureBox: {
    current: {
      errorCode: UpdateErrorCode;
      detail: string;
      failedAssetPath: string;
    } | null;
  } = { current: null };

  const reportProgress = (phase: 'download' | 'verify') => {
    input.onProgress?.({
      phase,
      determinate: knownTotalBytes !== null && knownTotalBytes > 0,
      percent:
        knownTotalBytes && knownTotalBytes > 0
          ? Math.min(phase === 'verify' ? 100 : 99, Math.round((loadedBytes / knownTotalBytes) * 100))
          : null,
      bytesLoaded: knownTotalBytes !== null ? loadedBytes : null,
      bytesTotal: knownTotalBytes,
      completedAssets,
      totalAssets: assetsToCheck.length,
      label:
        phase === 'download'
          ? `دریافت و بررسی فایل‌های نسخه ${input.manifest.semver} (${Math.min(completedAssets + 1, assetsToCheck.length)}/${assetsToCheck.length})...`
          : `تأیید یکپارچگی SHA-256 (${completedAssets}/${assetsToCheck.length})...`,
    });
  };

  const verifySingleAsset = async (asset: ReleaseAssetEntry) => {
    if (failureBox.current || stageController.signal.aborted) return;
    if (hasUnsafePathTraversal(asset.path)) {
      failureBox.current = {
        errorCode: 'ORIGIN_NOT_ALLOWED',
        detail: `Unsafe asset path traversal rejected: ${asset.path}`,
        failedAssetPath: asset.path,
      };
      stageController.abort();
      return;
    }
    if (asset.size > maxSingleAssetBytes) {
      failureBox.current = {
        errorCode: 'SIZE_MISMATCH',
        detail: `Declared size for ${asset.path} (${asset.size}) exceeds max single asset limit`,
        failedAssetPath: asset.path,
      };
      stageController.abort();
      return;
    }

    const assetUrl = resolveAgainstBase(asset.path, input.baseUrl);
    if (!isAllowedReleaseUrl(assetUrl) || !isSameOriginUrl(assetUrl, input.baseUrl)) {
      failureBox.current = {
        errorCode: 'ORIGIN_NOT_ALLOWED',
        detail: `Asset URL outside release origin: ${assetUrl}`,
        failedAssetPath: asset.path,
      };
      stageController.abort();
      return;
    }

    reportProgress('download');

    // Single deadline wrapping fetch() + response.arrayBuffer() + SHA-256 digest!
    const wrapped = await runWithDeadline(timeoutMs, stageController.signal, async (attemptSignal) => {
      const res = await fetchFn(assetUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: attemptSignal,
      });

      const finalUrl = res.url || assetUrl;
      if (res.redirected && (!isAllowedReleaseUrl(finalUrl) || !isSameOriginUrl(finalUrl, input.baseUrl))) {
        return { kind: 'redirect_blocked' as const, finalUrl };
      }

      if (res.status !== 200) {
        return { kind: 'http_error' as const, status: res.status };
      }

      const ct = res.headers.get('content-type') || '';
      if (!isValidMimeForAssetPath(asset.path, ct)) {
        return { kind: 'mime_invalid' as const, ct };
      }

      const buffer = await res.arrayBuffer();
      if (buffer.byteLength > maxSingleAssetBytes) {
        return { kind: 'size_limit' as const, actual: buffer.byteLength };
      }
      if (asset.size > 0 && buffer.byteLength !== asset.size) {
        return { kind: 'size_mismatch' as const, expected: asset.size, actual: buffer.byteLength };
      }

      const actualSha = await computeSha256Hex(buffer);
      if (actualSha !== asset.sha256.toLowerCase()) {
        return { kind: 'digest_mismatch' as const, expected: asset.sha256, actual: actualSha };
      }

      return { kind: 'ok' as const, buffer, contentType: ct, sha256: actualSha, finalUrl };
    });

    if (failureBox.current) return;

    if (!wrapped.ok) {
      failureBox.current = {
        errorCode: wrapped.timedOut || stageTimedOut ? 'TIMEOUT' : 'ASSET_VERIFICATION_FAILED',
        detail: wrapped.timedOut
          ? `Asset fetch/body read timed out after ${timeoutMs}ms: ${asset.path}`
          : `Failed to fetch or verify asset ${asset.path}: ${
              wrapped.error instanceof Error ? wrapped.error.message : String(wrapped.error ?? 'aborted')
            }`,
        failedAssetPath: asset.path,
      };
      stageController.abort();
      return;
    }

    const resVal = wrapped.value;
    if (resVal.kind !== 'ok') {
      const failureMap = {
        redirect_blocked: {
          code: 'ORIGIN_NOT_ALLOWED' as UpdateErrorCode,
          detail: `Cross-origin asset redirect rejected for ${asset.path}`,
        },
        http_error: {
          code: 'ASSET_VERIFICATION_FAILED' as UpdateErrorCode,
          detail: `Asset ${asset.path} returned HTTP ${'status' in resVal ? resVal.status : 'error'}`,
        },
        mime_invalid: {
          code: 'ASSET_VERIFICATION_FAILED' as UpdateErrorCode,
          detail: `Invalid MIME "${'ct' in resVal ? resVal.ct : ''}" returned for asset ${asset.path}`,
        },
        size_limit: {
          code: 'SIZE_MISMATCH' as UpdateErrorCode,
          detail: `Asset ${asset.path} exceeded max single asset limit`,
        },
        size_mismatch: {
          code: 'SIZE_MISMATCH' as UpdateErrorCode,
          detail: `Byte length mismatch for ${asset.path}: expected ${'expected' in resVal ? resVal.expected : '?'}, got ${'actual' in resVal ? resVal.actual : '?'}`,
        },
        digest_mismatch: {
          code: 'DIGEST_MISMATCH' as UpdateErrorCode,
          detail: `SHA-256 mismatch for ${asset.path}: expected ${'expected' in resVal ? resVal.expected : '?'}, got ${'actual' in resVal ? resVal.actual : '?'}`,
        },
      }[resVal.kind];

      failureBox.current = {
        errorCode: failureMap.code,
        detail: failureMap.detail,
        failedAssetPath: asset.path,
      };
      stageController.abort();
      return;
    }

    if (loadedBytes + resVal.buffer.byteLength > maxTotalReleaseBytes) {
      failureBox.current = {
        errorCode: 'SIZE_MISMATCH',
        detail: `Cumulative downloaded bytes exceeded release ceiling (${maxTotalReleaseBytes})`,
        failedAssetPath: asset.path,
      };
      stageController.abort();
      return;
    }

    // Bind exact verified bytes into candidate cache (eliminating TOCTOU)
    if (input.onVerifiedAsset) {
      try {
        await input.onVerifiedAsset({
          asset,
          resolvedUrl: resVal.finalUrl,
          contentType: resVal.contentType,
          buffer: resVal.buffer,
          sha256: resVal.sha256,
        });
      } catch (cacheErr) {
        const errName = cacheErr instanceof Error ? cacheErr.name : '';
        const errMsg = cacheErr instanceof Error ? cacheErr.message : String(cacheErr);
        const isQuota =
          errName === 'QuotaExceededError' || /quota/i.test(errMsg);
        failureBox.current = {
          errorCode: isQuota ? 'STORAGE_QUOTA_EXCEEDED' : 'ASSET_VERIFICATION_FAILED',
          detail: `Failed to persist verified asset ${asset.path} into candidate cache: ${errMsg}`,
          failedAssetPath: asset.path,
        };
        stageController.abort();
        return;
      }
    }

    loadedBytes += resVal.buffer.byteLength;
    completedAssets += 1;
    reportProgress('verify');
  };

  try {
    const workerCount = Math.min(maxConcurrency, assetsToCheck.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (!failureBox.current && !stageController.signal.aborted) {
        const idx = nextIndex;
        nextIndex += 1;
        if (idx >= assetsToCheck.length) break;
        await verifySingleAsset(assetsToCheck[idx]);
      }
    });
    await Promise.all(workers);

    if (failureBox.current) {
      return {
        ok: false,
        errorCode: failureBox.current.errorCode,
        detail: failureBox.current.detail,
        failedAssetPath: failureBox.current.failedAssetPath,
      };
    }
    if (stageTimedOut) {
      return {
        ok: false,
        errorCode: 'TIMEOUT',
        detail: `Overall asset staging exceeded deadline (${totalDeadlineMs}ms)`,
        failedAssetPath: 'stage-deadline',
      };
    }

    return {
      ok: true,
      verifiedCount: completedAssets,
      totalBytes: loadedBytes,
    };
  } finally {
    clearTimeout(stageTimer);
    input.signal?.removeEventListener('abort', onParentAbort);
  }
}
