import { CURRENT_APP_BUILD, CURRENT_APP_VERSION } from '@/lib/cloudSyncEngine';
import type {
  AuthoritativeReleaseManifest,
  PlatformUpdateCapabilities,
  ReleasePlatform,
  RuntimeReleaseIdentity,
} from '../contracts';
import { DEFAULT_REMOTE_RELEASE_BASE_URL, UPDATE_TIMING_POLICY } from '../policy';
import { isAllowedReleaseUrl } from '../releaseIdentity';
import type {
  ActivateUpdateResult,
  BootHandshakeResult,
  PlatformUpdateAdapter,
  StageUpdateResult,
} from './types';
import { readDomRuntimeReleaseIdentity } from './webPwaAdapter';

export interface NativeAndroidBridgeInfo {
  packageName: string;
  versionName: string;
  versionCode: number;
  installerPackageName?: string | null;
  playInAppUpdateAvailable?: boolean;
  bundledWebView?: boolean;
}

interface WindowWithNativeBridge extends Window {
  AndroidBridge?: {
    performHaptic?: (kind: string) => void;
    getNativeAppInfo?: () => string;
  };
  webkit?: {
    messageHandlers?: {
      minaNativeUpdate?: { postMessage: (msg: unknown) => void };
    };
  };
}

function readEnvVar(name: string): string | null {
  try {
    const val =
      typeof import.meta !== 'undefined'
        ? (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name]
        : undefined;
    return val && val.trim() ? val.trim() : null;
  } catch {
    return null;
  }
}

export function detectNativeHostPlatform(): ReleasePlatform | null {
  if (typeof window === 'undefined') return null;
  const win = window as WindowWithNativeBridge;
  const ua = navigator.userAgent || '';

  const isAndroidWebView =
    window.location.hostname === 'appassets.androidplatform.net' ||
    (window.location.hostname === '127.0.0.1' && window.location.port === '8765') ||
    /MinaDentalAndroid/i.test(ua) ||
    Boolean(win.AndroidBridge?.getNativeAppInfo);

  if (isAndroidWebView) return 'android';

  if (win.webkit?.messageHandlers?.minaNativeUpdate || /MinaDentalIOS/i.test(ua)) {
    return 'ios';
  }

  return null;
}

function readAndroidBridgeInfo(): NativeAndroidBridgeInfo | null {
  if (typeof window === 'undefined') return null;
  const win = window as WindowWithNativeBridge;
  if (!win.AndroidBridge?.getNativeAppInfo) return null;
  try {
    const raw = win.AndroidBridge.getNativeAppInfo();
    const parsed = JSON.parse(raw) as Partial<NativeAndroidBridgeInfo>;
    if (typeof parsed.versionName === 'string' && typeof parsed.versionCode === 'number') {
      return {
        packageName: parsed.packageName || 'com.aistudio.auditpro.kxmfzq',
        versionName: parsed.versionName,
        versionCode: parsed.versionCode,
        installerPackageName: parsed.installerPackageName ?? null,
        playInAppUpdateAvailable: Boolean(parsed.playInAppUpdateAvailable),
        bundledWebView: parsed.bundledWebView !== false,
      };
    }
  } catch {
    // ignore malformed bridge JSON
  }
  return null;
}

/**
 * Honest Native Platform Adapter (V8 — Android Bundled WebView / Play Store & iOS App Store/TestFlight).
 *
 * CRITICAL REALITY RULES:
 * 1. Bundled native hosts query an EXPLICIT REMOTE HTTPS platform pointer
 *    (`android-release-pointer.json` / `ios-release-pointer.json`), NEVER only local `./release-pointer.json`.
 * 2. NEVER invents unverified Play Store / App Store listing URLs; when no verified store listing URL
 *    is configured, reports `storeUrl: null` and `supportsStoreDeepLink: false` honestly.
 * 3. Zero `REQUEST_INSTALL_PACKAGES`, zero DCL, zero silent APK/IPA install (Google Play & Apple 2.5.2 compliant).
 */
export class NativePlatformUpdateAdapter implements PlatformUpdateAdapter {
  private readonly platform: ReleasePlatform;
  private readonly overrideBridgeInfo?: NativeAndroidBridgeInfo | null;
  private readonly remoteBaseUrl: string;
  private readonly verifiedStoreUrl: string | null;

  constructor(
    platform: ReleasePlatform,
    overrideBridgeInfo?: NativeAndroidBridgeInfo | null,
    options?: { remoteBaseUrl?: string; verifiedStoreUrl?: string | null }
  ) {
    this.platform = platform;
    this.overrideBridgeInfo = overrideBridgeInfo;
    this.remoteBaseUrl = (options?.remoteBaseUrl || DEFAULT_REMOTE_RELEASE_BASE_URL).replace(
      /\/?$/,
      '/'
    );
    this.verifiedStoreUrl =
      options?.verifiedStoreUrl !== undefined
        ? options.verifiedStoreUrl
        : platform === 'android'
        ? readEnvVar('VITE_ANDROID_VERIFIED_STORE_URL') || readEnvVar('VITE_ANDROID_PLAY_STORE_URL')
        : platform === 'ios'
        ? readEnvVar('VITE_IOS_VERIFIED_STORE_URL') || readEnvVar('VITE_IOS_APP_STORE_URL')
        : null;
  }

  public getDefaultPointerUrl(): string {
    if (this.platform === 'android') {
      return `${this.remoteBaseUrl}android-release-pointer.json`;
    }
    if (this.platform === 'ios') {
      return `${this.remoteBaseUrl}ios-release-pointer.json`;
    }
    return `${this.remoteBaseUrl}release-pointer.json`;
  }

  private getBridgeInfo(): NativeAndroidBridgeInfo | null {
    if (this.overrideBridgeInfo !== undefined) return this.overrideBridgeInfo;
    return this.platform === 'android' ? readAndroidBridgeInfo() : null;
  }

  public getCapabilities(): PlatformUpdateCapabilities {
    const bridge = this.getBridgeInfo();
    const remotePointerUrl = this.getDefaultPointerUrl();

    if (this.platform === 'android') {
      const hasVerifiedStore = Boolean(this.verifiedStoreUrl && isAllowedReleaseUrl(this.verifiedStoreUrl));
      return {
        platform: 'android',
        supportsWebSwUpdates: false,
        supportsInAppBinaryInstall: Boolean(bridge?.playInAppUpdateAvailable),
        supportsStoreDeepLink: hasVerifiedStore,
        isBundledWebView: bridge?.bundledWebView ?? true,
        nativeVersionName: bridge?.versionName ?? CURRENT_APP_VERSION,
        nativeVersionCode: bridge?.versionCode ?? CURRENT_APP_BUILD,
        packageName: bridge?.packageName ?? 'com.aistudio.auditpro.kxmfzq',
        storeUrl: hasVerifiedStore ? this.verifiedStoreUrl : null,
        remotePointerUrl,
        honestLimitationFa: hasVerifiedStore
          ? 'بسته داخلی APK اندروید با پاک‌سازی کش WebView ارتقا نمی‌یابد. ارتقا فقط از طریق کانال رسمی تأییدشده فروشگاه انجام می‌شود.'
          : 'بسته داخلی APK اندروید از طریق کش WebView ارتقا نمی‌یابد و شناسه فروشگاه Google Play هنوز ثبت نشده است؛ برای دریافت نسخه جدید، APK رسمی امضاشده را نصب کنید.',
      };
    }

    if (this.platform === 'ios') {
      const hasVerifiedStore = Boolean(this.verifiedStoreUrl && isAllowedReleaseUrl(this.verifiedStoreUrl));
      return {
        platform: 'ios',
        supportsWebSwUpdates: false,
        supportsInAppBinaryInstall: false,
        supportsStoreDeepLink: hasVerifiedStore,
        isBundledWebView: true,
        nativeVersionName: CURRENT_APP_VERSION,
        nativeVersionCode: CURRENT_APP_BUILD,
        packageName: 'ir.minadental.app',
        storeUrl: hasVerifiedStore ? this.verifiedStoreUrl : null,
        remotePointerUrl,
        honestLimitationFa: hasVerifiedStore
          ? 'طبق قوانین App Store (بند 2.5.2)، ارتقای نسخه بومی iOS/iPadOS فقط از طریق App Store یا TestFlight انجام می‌شود.'
          : 'طبق قوانین App Store (بند 2.5.2)، نصب خاموش IPA مجاز نیست و لینک اختصاصی App Store/TestFlight هنوز پیکربندی نشده است.',
      };
    }

    return {
      platform: this.platform,
      supportsWebSwUpdates: false,
      supportsInAppBinaryInstall: false,
      supportsStoreDeepLink: false,
      isBundledWebView: false,
      nativeVersionName: CURRENT_APP_VERSION,
      nativeVersionCode: CURRENT_APP_BUILD,
      packageName: null,
      storeUrl: null,
      remotePointerUrl,
      honestLimitationFa:
        'این پلتفرم کانال نصب بومی امضاشده فعال ندارد و وضعیت نصب هرگز به‌صورت نمایشی تغییر داده نمی‌شود.',
    };
  }

  public getCurrentRuntimeIdentity(): RuntimeReleaseIdentity {
    const domIdentity = readDomRuntimeReleaseIdentity(this.platform);
    const bridge = this.getBridgeInfo();
    return {
      ...domIdentity,
      platform: this.platform,
      // GE-0004: Strictly separate installed web bundle identity from native package versionName/versionCode
      semver: domIdentity.semver,
      releaseSequence: domIdentity.releaseSequence,
      nativeVersion: bridge?.versionName ?? domIdentity.nativeVersion,
      schemaVersion: UPDATE_TIMING_POLICY.CLIENT_SCHEMA_VERSION,
    };
  }

  public async stageAndVerify(): Promise<StageUpdateResult> {
    return {
      ok: false,
      verifiedAssetsCount: 0,
      waitingWorkerBuildId: null,
      workerVerified: false,
      errorCode: 'NATIVE_UPDATE_REQUIRED',
      detail: 'Native binary update must be installed via official store or signed platform installer',
    };
  }

  public async activateTargetRelease(): Promise<ActivateUpdateResult> {
    return {
      ok: false,
      reloadTriggered: false,
      errorCode: 'NATIVE_UPDATE_REQUIRED',
      detail: 'Silent native binary installation is unsupported; user must update through official channel',
    };
  }

  public async verifyPostBootHandshake(expectedReleaseId: string): Promise<BootHandshakeResult> {
    const runtime = this.getCurrentRuntimeIdentity();
    const verified = runtime.releaseId === expectedReleaseId;
    return {
      verified,
      runtimeBuildId: runtime.releaseId,
      workerBuildId: null,
      reason: verified
        ? undefined
        : `Native bundle identity (${runtime.releaseId}) does not match expected (${expectedReleaseId})`,
    };
  }

  public async cleanupObsoleteCaches(): Promise<void> {
    // No-op for bundled WebView native host
  }

  public openStoreAction(manifest: AuthoritativeReleaseManifest): void {
    if (typeof window === 'undefined') return;
    const caps = this.getCapabilities();
    const target = manifest.downloadUrl || caps.storeUrl;
    if (target && isAllowedReleaseUrl(target)) {
      window.open(target, '_blank', 'noopener,noreferrer');
    }
  }
}
