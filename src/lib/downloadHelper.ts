/**
 * Safe APK & Asset Downloader
 * Handles browser downloads while intercepting 403 Forbidden errors
 * commonly caused by Google AI Studio's authenticated proxy.
 */

export interface DownloadResult {
  success: boolean;
  error?: string;
  is403Forbidden?: boolean;
}

export async function downloadApkSafely(
  filename: string = 'DentalCare.apk',
  onProgress?: (percent: number) => void
): Promise<DownloadResult> {
  try {
    const targetUrl = `./${filename}?v=${Date.now()}`;
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.android.package-archive,application/octet-stream,*/*'
      }
    });

    if (response.status === 403) {
      return {
        success: false,
        error: 'خطای ۴۰۳ (عدم دسترسی به فایل از طریق پراکسی گوگل استودیو)',
        is403Forbidden: true
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: `خطای سرور (${response.status} ${response.statusText})`,
        is403Forbidden: response.status === 403
      };
    }

    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    let blob: Blob;

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
          onProgress(Math.min(99, Math.round((receivedBytes / totalBytes) * 100)));
        }
      }

      blob = new Blob(chunks as BlobPart[], { type: 'application/vnd.android.package-archive' });
      onProgress(100);
    } else {
      blob = await response.blob();
      if (onProgress) onProgress(100);
    }

    // Trigger local memory blob download
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clean up
    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 60000);

    return { success: true };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    const is403 = errMsg.includes('403') || errMsg.includes('Forbidden');
    return {
      success: false,
      error: errMsg,
      is403Forbidden: is403
    };
  }
}
