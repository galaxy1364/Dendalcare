/**
 * GE-0007 Verified Signed Android APK Metadata & Safe Downloader
 *
 * Strictly prevents false-positive/corrupt downloads (e.g. HTML 404 saved as .apk):
 * 1. Resolves published CI-signed APK metadata from same-origin `./apk-release.json`
 *    or GitHub Releases tag `android-latest`.
 * 2. Validates HTTP 200, non-HTML MIME type, minimum APK size, and ZIP/APK magic bytes
 *    (`PK\x03\x04` = 0x50 0x4B 0x03 0x04) on same-origin binary downloads.
 * 3. Uses verified direct GitHub Release asset download URLs cleanly without CORS breakage.
 */

export const GITHUB_REPO_SLUG = 'galaxy1364/Dendalcare';
export const GITHUB_ANDROID_RELEASE_TAG = 'android-latest';
export const GITHUB_ANDROID_RELEASE_PAGE = `https://github.com/${GITHUB_REPO_SLUG}/releases/tag/${GITHUB_ANDROID_RELEASE_TAG}`;
export const GITHUB_ANDROID_APK_DIRECT_URL = `https://github.com/${GITHUB_REPO_SLUG}/releases/download/${GITHUB_ANDROID_RELEASE_TAG}/MinaDental-android.apk`;
export const GITHUB_ANDROID_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO_SLUG}/releases/tags/${GITHUB_ANDROID_RELEASE_TAG}`;

const MIN_VALID_APK_BYTES = 100_000;

export interface PublishedApkMetadata {
  available: boolean;
  source: 'local_release_json' | 'github_releases_api' | 'unavailable';
  fileName: string;
  downloadUrl: string;
  releasePageUrl: string;
  versionName?: string;
  versionCode?: number;
  releaseId?: string;
  sizeBytes?: number;
  sha256?: string;
  signingMode?: 'release_upload_keystore' | 'ci_debug_keystore' | string;
  signingCertSha256?: string;
  publishedAt?: string;
  reason?: string;
}

export interface DownloadResult {
  success: boolean;
  error?: string;
  is403Forbidden?: boolean;
  usedDirectReleaseUrl?: boolean;
  metadata?: PublishedApkMetadata;
}

/**
 * Verifies genuine APK/ZIP local file header magic bytes (`PK\x03\x04`).
 */
export function isValidApkMagicBytes(bytes: Uint8Array): boolean {
  if (!bytes || bytes.byteLength < 4) return false;
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function formatApkSizeMb(sizeBytes?: number): string {
  if (!sizeBytes || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return '—';
  const mb = sizeBytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

/**
 * Discovers the currently published CI-signed Android APK without ever guessing or faking availability.
 */
export async function fetchPublishedApkMetadata(): Promise<PublishedApkMetadata> {
  // 1. Check same-origin `./apk-release.json` synced during GitHub Pages deployment
  try {
    const res = await fetch(`./apk-release.json?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (res.ok && ct.includes('json')) {
      const data = await res.json();
      if (
        data &&
        typeof data.downloadUrl === 'string' &&
        data.downloadUrl.startsWith('https://') &&
        typeof data.sizeBytes === 'number' &&
        data.sizeBytes >= MIN_VALID_APK_BYTES &&
        typeof data.sha256 === 'string' &&
        /^[a-f0-9]{64}$/i.test(data.sha256)
      ) {
        return {
          available: true,
          source: 'local_release_json',
          fileName: data.fileName || 'MinaDental-android.apk',
          downloadUrl: data.downloadUrl,
          releasePageUrl: data.releasePageUrl || GITHUB_ANDROID_RELEASE_PAGE,
          versionName: data.versionName,
          versionCode: data.versionCode,
          releaseId: data.releaseId,
          sizeBytes: data.sizeBytes,
          sha256: data.sha256,
          signingMode: data.signingMode,
          signingCertSha256: data.signingCertSha256,
          publishedAt: data.publishedAt,
        };
      }
    }
  } catch {
    // Fall through to GitHub Releases API check
  }

  // 2. Query public GitHub Releases API for `android-latest`
  try {
    const ghRes = await fetch(GITHUB_ANDROID_RELEASE_API, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (ghRes.ok) {
      const release = await ghRes.json();
      const assets: Array<{ name?: string; size?: number; browser_download_url?: string; updated_at?: string }> =
        Array.isArray(release?.assets) ? release.assets : [];
      const apkAsset =
        assets.find((a) => a.name === 'MinaDental-android.apk') ||
        assets.find((a) => String(a.name || '').toLowerCase().endsWith('.apk'));

      if (
        apkAsset &&
        apkAsset.browser_download_url &&
        typeof apkAsset.size === 'number' &&
        apkAsset.size >= MIN_VALID_APK_BYTES
      ) {
        const bodyText = String(release?.body || '');
        const shaMatch = bodyText.match(/APK SHA-256:\s*`?([a-f0-9]{64})`?/i);
        const certMatch = bodyText.match(/Signing Certificate SHA-256:\s*`?([a-f0-9]{64})`?/i);
        const modeMatch = bodyText.match(/Signing mode:\s*([a-z0-9_-]+)/i);
        return {
          available: true,
          source: 'github_releases_api',
          fileName: apkAsset.name || 'MinaDental-android.apk',
          downloadUrl: apkAsset.browser_download_url,
          releasePageUrl: release?.html_url || GITHUB_ANDROID_RELEASE_PAGE,
          sizeBytes: apkAsset.size,
          sha256: shaMatch?.[1],
          signingMode: modeMatch?.[1],
          signingCertSha256: certMatch?.[1],
          publishedAt: apkAsset.updated_at || release?.published_at,
        };
      }
    }
  } catch {
    // Network or offline
  }

  return {
    available: false,
    source: 'unavailable',
    fileName: 'MinaDental-android.apk',
    downloadUrl: GITHUB_ANDROID_APK_DIRECT_URL,
    releasePageUrl: GITHUB_ANDROID_RELEASE_PAGE,
    reason: 'فایل APK امضاشده هنوز در انتشار GitHub Releases (android-latest) منتشر نشده یا دسترسی به سرور برقرار نیست.',
  };
}

/**
 * Safely downloads the verified signed Android APK.
 * Rejects HTML 404 responses and verifies APK ZIP header (`PK\x03\x04`) for local fetches.
 */
export async function downloadApkSafely(
  filename: string = 'MinaDental-android.apk',
  onProgress?: (percent: number) => void,
  prefetchedMeta?: PublishedApkMetadata | null
): Promise<DownloadResult> {
  try {
    if (onProgress) onProgress(10);
    const meta = prefetchedMeta && prefetchedMeta.available ? prefetchedMeta : await fetchPublishedApkMetadata();

    // 1. Prefer verified CI-published GitHub Release APK (native browser download avoids S3 redirect CORS)
    if (meta.available && meta.downloadUrl.startsWith('https://')) {
      if (onProgress) onProgress(85);
      const link = document.createElement('a');
      link.href = meta.downloadUrl;
      link.download = meta.fileName || filename;
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (onProgress) onProgress(100);
      return {
        success: true,
        usedDirectReleaseUrl: true,
        metadata: meta,
      };
    }

    // 2. Fallback: verify same-origin APK binary (only if genuinely served with valid PK\x03\x04 header)
    const targetUrl = `./${filename}?v=${Date.now()}`;
    const response = await fetch(targetUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.android.package-archive,application/octet-stream,*/*',
      },
    });

    if (response.status === 403) {
      return {
        success: false,
        error: 'خطای ۴۰۳ (عدم دسترسی مستقیم به فایل APK از این مسیر)',
        is403Forbidden: true,
        metadata: meta,
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error:
          meta.reason ||
          `فایل APK روی سرور یافت نشد (HTTP ${response.status}). لطفاً پس از اتمام ساخت خودکار CI از صفحه GitHub Releases دانلود کنید.`,
        is403Forbidden: false,
        metadata: meta,
      };
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/json') || contentType.includes('text/plain')) {
      return {
        success: false,
        error: 'پاسخ سرور فایل نصبی APK معتبر نیست (صفحه خطا/HTML بازگشت داده شد). از انتشار رسمی GitHub Releases دریافت کنید.',
        metadata: meta,
      };
    }

    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    let rawBytes: Uint8Array;
    if (response.body && totalBytes > 0 && onProgress) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          receivedBytes += value.length;
          onProgress(Math.min(95, Math.round((receivedBytes / totalBytes) * 100)));
        }
      }

      rawBytes = new Uint8Array(receivedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        rawBytes.set(chunk, offset);
        offset += chunk.length;
      }
    } else {
      const buf = await response.arrayBuffer();
      rawBytes = new Uint8Array(buf);
    }

    if (rawBytes.byteLength < MIN_VALID_APK_BYTES || !isValidApkMagicBytes(rawBytes)) {
      return {
        success: false,
        error: 'فایل دریافتی ساختار معتبر بسته اندروید (APK / PK header) ندارد و دانلود متوقف شد.',
        metadata: meta,
      };
    }

    const blob = new Blob([rawBytes as unknown as BlobPart], {
      type: 'application/vnd.android.package-archive',
    });
    if (onProgress) onProgress(100);

    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 60_000);

    return { success: true, metadata: meta };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    const is403 = errMsg.includes('403') || errMsg.includes('Forbidden');
    return {
      success: false,
      error: errMsg,
      is403Forbidden: is403,
    };
  }
}
