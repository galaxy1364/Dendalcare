import type {
  AuthoritativeReleaseManifest,
  PinnedPublicKey,
  ReleaseAssetEntry,
  ReleasePointer,
  UpdateErrorCode,
  UpdateProgress,
} from './contracts';
import { UPDATE_TIMING_POLICY, computeJitteredDelayMs } from './policy';
import {
  computeSha256Hex,
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

async function fetchWithIndependentTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  parentSignal?: AbortSignal
): Promise<{ response?: Response; timedOut?: boolean; aborted?: boolean; networkError?: unknown }> {
  if (parentSignal?.aborted) return { aborted: true };
  const attemptController = new AbortController();
  let timedOut = false;

  const onParentAbort = () => attemptController.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });

  const timer = setTimeout(() => {
    timedOut = true;
    attemptController.abort();
  }, timeoutMs);

  try {
    const response = await fetchFn(url, {
      ...init,
      signal: attemptController.signal,
    });
    return { response };
  } catch (err) {
    if (parentSignal?.aborted) return { aborted: true };
    if (timedOut) return { timedOut: true };
    return { networkError: err };
  } finally {
    clearTimeout(timer);
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
}): Promise<
  | { ok: true; notModified: true; status: 304; etag: string | null }
  | { ok: true; notModified: false; status: number; etag: string | null; data: unknown }
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

    const resWrap = await fetchWithIndependentTimeout(
      input.fetchFn,
      input.url,
      { method: 'GET', cache: 'no-store', headers },
      input.timeoutMs,
      input.signal
    );

    if (resWrap.aborted) {
      return { ok: false, errorCode: 'TIMEOUT', status: null, detail: 'Request cancelled by caller' };
    }

    if (resWrap.timedOut) {
      lastCode = 'TIMEOUT';
      lastStatus = null;
      lastDetail = `Request timed out after ${input.timeoutMs}ms`;
    } else if (resWrap.networkError) {
      lastCode = 'HTTP_ERROR';
      lastStatus = null;
      lastDetail =
        resWrap.networkError instanceof Error
          ? resWrap.networkError.message
          : String(resWrap.networkError);
    } else if (resWrap.response) {
      const res = resWrap.response;
      const responseEtag = res.headers.get('etag');
      if (res.status === 304) {
        return { ok: true, notModified: true, status: 304, etag: responseEtag ?? input.etag ?? null };
      }
      if (res.status >= 200 && res.status < 300) {
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('text/html')) {
          return {
            ok: false,
            errorCode: 'SCHEMA_INVALID',
            status: res.status,
            detail: `Expected JSON manifest but received text/html from ${input.url}`,
          };
        }
        try {
          const data = await res.json();
          return { ok: true, notModified: false, status: res.status, etag: responseEtag, data };
        } catch (parseErr) {
          return {
            ok: false,
            errorCode: 'SCHEMA_INVALID',
            status: res.status,
            detail: `Malformed JSON from ${input.url}: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
          };
        }
      }

      lastStatus = res.status;
      lastCode = 'HTTP_ERROR';
      lastDetail = `HTTP ${res.status} from ${input.url}`;
      // Do not retry deterministic 4xx (except 429)
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return { ok: false, errorCode: 'HTTP_ERROR', status: res.status, detail: lastDetail };
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
 * with ETag support, 304 handling, bounded retries, independent timeout, strict schema validation,
 * and cryptographic signature verification.
 *
 * CRITICAL: Offline or 5xx/timeout errors NEVER become UP_TO_DATE!
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

  // Cryptographic signature verification
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
  };
}

/**
 * Verifies every required asset listed in the authoritative manifest:
 * - Real HTTP 200 status (no 404/partial deploy)
 * - Valid MIME (rejects unexpected text/html returned for .js/.css)
 * - Real SHA-256 content digest against manifest.assets[].sha256
 * - Real byte-based download progress (or determinate=false if sizes are missing/zero)
 */
export async function verifyReleaseAssets(input: {
  manifest: AuthoritativeReleaseManifest;
  baseUrl: string;
  verifyAllAssets?: boolean;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: UpdateProgress) => void;
}): Promise<
  | { ok: true; verifiedCount: number; totalBytes: number }
  | { ok: false; errorCode: UpdateErrorCode; detail: string; failedAssetPath: string }
> {
  const fetchFn = input.fetchFn ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = input.timeoutMs ?? UPDATE_TIMING_POLICY.ASSET_TIMEOUT_MS;
  const targetAssets: ReleaseAssetEntry[] = input.verifyAllAssets
    ? input.manifest.assets
    : input.manifest.assets.filter((a) => a.critical || a.path.endsWith('.js') || a.path.endsWith('.css'));

  const assetsToCheck = targetAssets.length > 0 ? targetAssets : input.manifest.assets;
  const knownTotalBytes = assetsToCheck.every((a) => a.size > 0)
    ? assetsToCheck.reduce((sum, a) => sum + a.size, 0)
    : null;

  let loadedBytes = 0;
  let completedAssets = 0;

  for (const asset of assetsToCheck) {
    const assetUrl = resolveAgainstBase(asset.path, input.baseUrl);
    input.onProgress?.({
      phase: 'download',
      determinate: knownTotalBytes !== null && knownTotalBytes > 0,
      percent:
        knownTotalBytes && knownTotalBytes > 0
          ? Math.min(99, Math.round((loadedBytes / knownTotalBytes) * 100))
          : null,
      bytesLoaded: knownTotalBytes !== null ? loadedBytes : null,
      bytesTotal: knownTotalBytes,
      completedAssets,
      totalAssets: assetsToCheck.length,
      label: `دریافت و بررسی فایل‌های نسخه ${input.manifest.semver} (${completedAssets + 1}/${assetsToCheck.length})...`,
    });

    const resWrap = await fetchWithIndependentTimeout(
      fetchFn,
      assetUrl,
      { method: 'GET', cache: 'no-store' },
      timeoutMs,
      input.signal
    );

    if (resWrap.aborted) {
      return {
        ok: false,
        errorCode: 'TIMEOUT',
        detail: 'Asset verification aborted',
        failedAssetPath: asset.path,
      };
    }
    if (resWrap.timedOut || resWrap.networkError || !resWrap.response) {
      return {
        ok: false,
        errorCode: resWrap.timedOut ? 'TIMEOUT' : 'ASSET_VERIFICATION_FAILED',
        detail: `Failed to fetch asset ${asset.path}`,
        failedAssetPath: asset.path,
      };
    }

    const res = resWrap.response;
    if (res.status !== 200) {
      return {
        ok: false,
        errorCode: 'ASSET_VERIFICATION_FAILED',
        detail: `Asset ${asset.path} returned HTTP ${res.status}`,
        failedAssetPath: asset.path,
      };
    }

    const ct = res.headers.get('content-type') || '';
    if (!isValidMimeForAssetPath(asset.path, ct)) {
      return {
        ok: false,
        errorCode: 'ASSET_VERIFICATION_FAILED',
        detail: `Invalid MIME "${ct}" returned for asset ${asset.path}`,
        failedAssetPath: asset.path,
      };
    }

    const buffer = await res.arrayBuffer();
    const actualSha = await computeSha256Hex(buffer);
    if (actualSha !== asset.sha256.toLowerCase()) {
      return {
        ok: false,
        errorCode: 'DIGEST_MISMATCH',
        detail: `SHA-256 mismatch for ${asset.path}: expected ${asset.sha256}, got ${actualSha}`,
        failedAssetPath: asset.path,
      };
    }

    loadedBytes += buffer.byteLength;
    completedAssets += 1;

    input.onProgress?.({
      phase: 'verify',
      determinate: knownTotalBytes !== null && knownTotalBytes > 0,
      percent:
        knownTotalBytes && knownTotalBytes > 0
          ? Math.min(100, Math.round((loadedBytes / knownTotalBytes) * 100))
          : null,
      bytesLoaded: knownTotalBytes !== null ? loadedBytes : null,
      bytesTotal: knownTotalBytes,
      completedAssets,
      totalAssets: assetsToCheck.length,
      label: `تأیید یکپارچگی SHA-256 (${completedAssets}/${assetsToCheck.length})...`,
    });
  }

  return {
    ok: true,
    verifiedCount: completedAssets,
    totalBytes: loadedBytes,
  };
}
