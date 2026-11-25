import { CURRENT_APP_BUILD, CURRENT_APP_VERSION } from '@/lib/cloudSyncEngine';
import type {
  AuthoritativeReleaseManifest,
  PlatformUpdateCapabilities,
  ReleasePlatform,
  RuntimeReleaseIdentity,
} from '../contracts';
import { UPDATE_TIMING_POLICY } from '../policy';
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
 * Honest Native Platform Adapter (Android Bundled WebView / Play Store & iOS App Store/TestFlight).
 *
 * CRITICAL REALITY RULES:
 * 1. Bundled Android WebView (`127.0.0.1:8765` / `appassets.androidplatform.net`) CANNOT upgrade
 *    its APK by clearing WebView cache — doing so NEVER mutates installed ledger.
 * 2. No silent APK/IPA install is claimed or attempted; respects Google Play policies
 *    (zero REQUEST_INSTALL_PACKAGES, zero dynamic executable loading) and Apple Guideline 2.5.2.
 * 3. Directs user to official store / verified distribution channel (`NATIVE_STORE_REQUIRED`).
 */
export class NativePlatformUpdateAdapter implements PlatformUpdateAdapter {
  private readonly platform: ReleasePlatform;
  private readonly overrideBridgeInfo?: NativeAndroidBridgeInfo | null;

  constructor(platform: ReleasePlatform, overrideBridgeInfo?: NativeAndroidBridgeInfo | null) {
    this.platform = platform;
    this.overrideBridgeInfo = overrideBridgeInfo;
  }

  private getBridgeInfo(): NativeAndroidBridgeInfo | null {
    if (this.overrideBridgeInfo !== undefined) return this.overrideBridgeInfo;
    return this.platform === 'android' ? readAndroidBridgeInfo() : null;
  }

  public getCapabilities(): PlatformUpdateCapabilities {
    const bridge = this.getBridgeInfo();

    if (this.platform === 'android') {
      return {
        platform: 'android',
        supportsWebSwUpdates: false,
        supportsInAppBinaryInstall: Boolean(bridge?.playInAppUpdateAvailable),
        supportsStoreDeepLink: true,
        isBundledWebView: bridge?.bundledWebView ?? true,
        nativeVersionName: bridge?.versionName ?? CURRENT_APP_VERSION,
        nativeVersionCode: bridge?.versionCode ?? CURRENT_APP_BUILD,
        packageName: bridge?.packageName ?? 'com.aistudio.auditpro.kxmfzq',
        storeUrl: `https://play.google.com/store/apps/details?id=${bridge?.packageName ?? 'com.aistudio.auditpro.kxmfzq'}`,
        honestLimitationFa:
          'بسته داخلی APK اندروید با پاک‌سازی کش WebView ارتقا نمی‌یابد. ارتقای نسخه بومی فقط از طریق فروشگاه Google Play (Play Core) یا نصب تأییدشده توسط کاربر از بسته رسمی امضاشده انجام می‌شود.',
      };
    }

    if (this.platform === 'ios') {
      return {
        platform: 'ios',
        supportsWebSwUpdates: false,
        supportsInAppBinaryInstall: false,
        supportsStoreDeepLink: true,
        isBundledWebView: true,
        nativeVersionName: CURRENT_APP_VERSION,
        nativeVersionCode: CURRENT_APP_BUILD,
        packageName: 'ir.minadental.app',
        storeUrl: 'https://apps.apple.com/',
        honestLimitationFa:
          'طبق قوانین App Store (بند 2.5.2)، ارتقای نسخه بومی iOS/iPadOS فقط از طریق App Store یا TestFlight انجام می‌شود و نصب خاموش IPA پشتیبانی نمی‌شود.',
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
      semver: bridge?.versionName ?? domIdentity.semver,
      nativeVersion: bridge?.versionName ?? domIdentity.nativeVersion,
      releaseSequence: bridge?.versionCode ?? domIdentity.releaseSequence,
      schemaVersion: UPDATE_TIMING_POLICY.CLIENT_SCHEMA_VERSION,
    };
  }

  public async stageAndVerify(): Promise<StageUpdateResult> {
    // Native bundled binaries cannot stage web SW assets to replace APK/IPA binaries
    return {
      ok: false,
      verifiedAssetsCount: 0,
      waitingWorkerBuildId: null,
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
