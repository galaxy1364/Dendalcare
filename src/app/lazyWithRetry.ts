import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { isChunkLoadError } from '@/components/ErrorBoundary';

export interface LazyRetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  importTimeoutMs?: number;
  delayFn?: (ms: number) => Promise<void>;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  reloadFn?: () => void;
  buildId?: string;
}

const DEFAULT_IMPORT_TIMEOUT_MS = 12_000;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRuntimeBuildId(): string {
  if (typeof window !== 'undefined' && typeof window.__minaBuildId === 'string' && window.__minaBuildId) {
    return window.__minaBuildId;
  }
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="minadental-build-id"]');
    const content = meta?.getAttribute('content');
    if (content && !content.startsWith('__MINA_')) {
      return content;
    }
  }
  return 'dev-local';
}

function withAttemptDeadline<T>(promise: Promise<T>, timeoutMs: number, chunkName: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Chunk load timeout (${timeoutMs}ms): ${chunkName}`));
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Pure dynamic-import executor with per-attempt hanging deadline + bounded retries +
 * at-most-once controlled reload on chunk/version mismatch (exported for direct unit testing).
 */
export async function importWithRetry<T>(
  importer: () => Promise<T>,
  chunkName: string,
  options?: LazyRetryOptions
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 2;
  const baseDelayMs = options?.baseDelayMs ?? 300;
  const importTimeoutMs = options?.importTimeoutMs ?? DEFAULT_IMPORT_TIMEOUT_MS;
  const delayFn = options?.delayFn ?? defaultDelay;
  const buildId = options?.buildId ?? getRuntimeBuildId();
  const storage =
    options?.storage !== undefined
      ? options.storage
      : typeof window !== 'undefined'
      ? window.sessionStorage
      : null;
  const reloadFn =
    options?.reloadFn ??
    (() => {
      if (typeof window !== 'undefined') {
        window.location.reload();
      }
    });

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const mod = await withAttemptDeadline(importer(), importTimeoutMs, chunkName);
      // Clear reload guard once chunk loads cleanly
      try {
        storage?.setItem(`minadental_chunk_reload_${buildId}_${chunkName}`, '0');
      } catch {
        // ignore storage errors
      }
      return mod;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await delayFn(baseDelayMs * (attempt + 1));
      }
    }
  }

  // On chunk/version mismatch, allow AT MOST ONE controlled reload per build+chunk
  if (isChunkLoadError(lastError)) {
    const reloadKey = `minadental_chunk_reload_${buildId}_${chunkName}`;
    let alreadyReloaded = false;
    try {
      alreadyReloaded = storage?.getItem(reloadKey) === '1';
      if (!alreadyReloaded) {
        storage?.setItem(reloadKey, '1');
      }
    } catch {
      alreadyReloaded = true;
    }

    if (!alreadyReloaded) {
      reloadFn();
      // Keep promise pending briefly while browser navigates so boundary doesn't flash prematurely
      await delayFn(2000);
    }
  }

  throw lastError;
}

/**
 * Drop-in replacement for React.lazy with bounded network retry, hanging-import timeout,
 * and single controlled version-mismatch recovery so stale chunk hashes never brick route transitions.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
  chunkName: string,
  options?: LazyRetryOptions
): LazyExoticComponent<T> {
  return lazy(() => importWithRetry(importer, chunkName, options));
}
