export type TargetPlatform = 'android' | 'ios' | 'ipad' | 'windows' | 'macos' | 'web';
export type FormFactor = 'mobile' | 'tablet' | 'desktop';

export interface PlatformInfo {
  platform: TargetPlatform;
  formFactor: FormFactor;
  labelFa: string;
  isTouch: boolean;
  isStandalone: boolean;
  isIosNonSafari: boolean;
  supportsKeyboardShortcuts: boolean;
}

export function detectPlatformFromUA(
  userAgent: string,
  opts?: {
    platformStr?: string;
    maxTouchPoints?: number;
    viewportWidth?: number;
    isStandalone?: boolean;
  }
): PlatformInfo {
  const ua = userAgent || '';
  const uaLower = ua.toLowerCase();
  const maxTouch = opts?.maxTouchPoints ?? 0;
  const platStr = opts?.platformStr ?? '';
  const width = opts?.viewportWidth ?? 1280;
  const isStandalone = Boolean(opts?.isStandalone);

  const isIpad =
    /ipad/.test(uaLower) ||
    (platStr === 'MacIntel' && maxTouch > 1) ||
    (/macintosh/.test(uaLower) && maxTouch > 1);
  const isIphone = /iphone|ipod/.test(uaLower);
  const isAndroid = /android/.test(uaLower);
  const isWindows = /windows|win32|win64|wow64/.test(uaLower);
  const isMac = !isIpad && /macintosh|mac os x/.test(uaLower);

  const isIosNonSafari =
    (isIphone || isIpad) &&
    /CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV|Telegram|WhatsApp/i.test(ua);

  let platform: TargetPlatform = 'web';
  // Adaptive layout prioritizes actual viewport dimensions first
  let formFactor: FormFactor = width >= 1024 ? 'desktop' : width >= 768 ? 'tablet' : 'mobile';
  let labelFa = 'وب دسکتاپ';

  if (isIpad) {
    platform = 'ipad';
    formFactor = width >= 1024 ? 'desktop' : width >= 768 ? 'tablet' : 'mobile';
    labelFa = 'آیپد (iPadOS)';
  } else if (isIphone) {
    platform = 'ios';
    formFactor = width >= 768 ? 'tablet' : 'mobile';
    labelFa = 'آیفون (iOS)';
  } else if (isAndroid) {
    platform = 'android';
    formFactor = width >= 1024 ? 'desktop' : width >= 768 ? 'tablet' : 'mobile';
    labelFa = formFactor === 'tablet' ? 'تبلت اندروید' : 'اندروید';
  } else if (isWindows) {
    platform = 'windows';
    formFactor = width >= 1024 ? 'desktop' : width >= 768 ? 'tablet' : 'mobile';
    labelFa = 'ویندوز دسکتاپ';
  } else if (isMac) {
    platform = 'macos';
    formFactor = width >= 1024 ? 'desktop' : width >= 768 ? 'tablet' : 'mobile';
    labelFa = 'مک دسکتاپ';
  }

  return {
    platform,
    formFactor,
    labelFa,
    isTouch: isIphone || isIpad || isAndroid || maxTouch > 0,
    isStandalone,
    isIosNonSafari,
    supportsKeyboardShortcuts: formFactor === 'desktop' || formFactor === 'tablet',
  };
}

export interface PlatformCapabilities {
  runtimeKind: 'android_webview_apk' | 'ios_native_wrapper' | 'standalone_pwa' | 'mobile_web' | 'desktop_web' | 'ssr';
  androidNativeHapticsBridge: boolean;
  iosNativeHapticsBridge: boolean;
  webVibrationApi: boolean;
  webAudioTactileSynth: boolean;
  webNotificationsApi: boolean;
  serviceWorkerSupported: boolean;
  prefersDarkColorScheme: boolean;
  prefersReducedMotion: boolean;
  cssBlurApproximation: boolean;
  nativeLiquidGlassAvailable: boolean;
  nativeCoreHapticsAvailable: boolean;
  honestPlatformNoteFa: string;
}

export function detectPlatformCapabilities(overrides?: {
  userAgent?: string;
  hasAndroidBridge?: boolean;
  hasIosBridge?: boolean;
  hasVibrate?: boolean;
  hasAudioContext?: boolean;
  hasNotification?: boolean;
  hasServiceWorker?: boolean;
  prefersDark?: boolean;
  prefersReducedMotion?: boolean;
  isStandalone?: boolean;
  viewportWidth?: number;
}): PlatformCapabilities {
  const hasWindow = typeof window !== 'undefined';
  const hasNav = typeof navigator !== 'undefined';

  const ua = overrides?.userAgent ?? (hasNav ? navigator.userAgent : '');
  const info = detectPlatformFromUA(ua, {
    platformStr: hasNav ? navigator.platform : '',
    maxTouchPoints: hasNav ? navigator.maxTouchPoints : 0,
    viewportWidth: overrides?.viewportWidth ?? (hasWindow ? window.innerWidth : 1280),
    isStandalone: overrides?.isStandalone,
  });

  const androidNativeHapticsBridge =
    overrides?.hasAndroidBridge ??
    Boolean(
      hasWindow &&
        (window as unknown as { AndroidBridge?: { performHaptic?: unknown } }).AndroidBridge
          ?.performHaptic
    );

  const iosNativeHapticsBridge =
    overrides?.hasIosBridge ??
    Boolean(
      hasWindow &&
        (window as unknown as {
          webkit?: { messageHandlers?: { minaHaptics?: unknown } };
        }).webkit?.messageHandlers?.minaHaptics
    );

  const webVibrationApi =
    overrides?.hasVibrate ?? Boolean(hasNav && typeof navigator.vibrate === 'function');

  const webAudioTactileSynth =
    overrides?.hasAudioContext ??
    Boolean(
      hasWindow &&
        (window.AudioContext ||
          (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)
    );

  const webNotificationsApi =
    overrides?.hasNotification ?? Boolean(hasWindow && 'Notification' in window);

  const serviceWorkerSupported =
    overrides?.hasServiceWorker ?? Boolean(hasNav && 'serviceWorker' in navigator);

  const prefersDarkColorScheme =
    overrides?.prefersDark ??
    Boolean(hasWindow && window.matchMedia?.('(prefers-color-scheme: dark)').matches);

  const prefersReducedMotion =
    overrides?.prefersReducedMotion ??
    Boolean(hasWindow && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  const cssBlurApproximation =
    hasWindow && typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
      ? CSS.supports('backdrop-filter', 'blur(8px)') ||
        CSS.supports('-webkit-backdrop-filter', 'blur(8px)')
      : false;

  let runtimeKind: PlatformCapabilities['runtimeKind'] = 'ssr';
  if (hasWindow || overrides) {
    if (androidNativeHapticsBridge) {
      runtimeKind = 'android_webview_apk';
    } else if (iosNativeHapticsBridge) {
      runtimeKind = 'ios_native_wrapper';
    } else if (info.isStandalone || overrides?.isStandalone) {
      runtimeKind = 'standalone_pwa';
    } else if (info.formFactor === 'mobile') {
      runtimeKind = 'mobile_web';
    } else {
      runtimeKind = 'desktop_web';
    }
  }

  // Strictly honest capability flags: Web/PWA/WebView do NOT possess native SwiftUI Liquid Glass.
  // CoreHaptics / Taptic Engine is only reported when an actual native iOS wrapper bridge is present.
  const nativeLiquidGlassAvailable = false;
  const nativeCoreHapticsAvailable = iosNativeHapticsBridge;

  const honestPlatformNoteFa =
    runtimeKind === 'android_webview_apk'
      ? 'در حال اجرا در پوسته اندروید (WebView APK) با هپتیک بومی اندروید؛ جلوه شفافیت صرفاً تقریب بصری CSS Blur است و کنترل‌های SwiftUI Liquid Glass یا CoreHaptics در محیط اندروید وجود ندارند.'
      : runtimeKind === 'ios_native_wrapper'
      ? 'متصل به پوسته بومی iOS با پل هپتیک؛ لایه وب از CSS Blur به‌عنوان تقریب بصری استفاده می‌کند و کنترل‌های کامل SwiftUI Liquid Glass نیازمند رندر بومی Xcode است.'
      : 'در حال اجرا روی وب / PWA؛ از CSS Blur به‌عنوان تقریب بصری و Web Vibration/Audio (در صورت پشتیبانی مرورگر) استفاده می‌شود. در PWA آیفون موتور Taptic Engine / CoreHaptics و Liquid Glass بومی اپل در دسترس نیستند.';

  return {
    runtimeKind,
    androidNativeHapticsBridge,
    iosNativeHapticsBridge,
    webVibrationApi,
    webAudioTactileSynth,
    webNotificationsApi,
    serviceWorkerSupported,
    prefersDarkColorScheme,
    prefersReducedMotion,
    cssBlurApproximation,
    nativeLiquidGlassAvailable,
    nativeCoreHapticsAvailable,
    honestPlatformNoteFa,
  };
}

export function getCurrentPlatformInfo(): PlatformInfo {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      platform: 'web',
      formFactor: 'desktop',
      labelFa: 'وب دسکتاپ',
      isTouch: false,
      isStandalone: false,
      isIosNonSafari: false,
      supportsKeyboardShortcuts: true,
    };
  }

  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    document.referrer.includes('android-app://');

  return detectPlatformFromUA(navigator.userAgent, {
    platformStr: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    viewportWidth: window.innerWidth,
    isStandalone: Boolean(standalone),
  });
}

export type AdaptiveWindowClass = 'compact' | 'medium' | 'expanded' | 'wide';

export function getAdaptiveBreakpoint(viewportWidth: number): AdaptiveWindowClass {
  const safeWidth = Number.isFinite(viewportWidth) ? viewportWidth : 390;
  if (safeWidth < 600) return 'compact';
  if (safeWidth < 1024) return 'medium';
  if (safeWidth < 1440) return 'expanded';
  return 'wide';
}

export type PlatformFeatureAvailability =
  | 'supported'
  | 'permission_required'
  | 'unavailable'
  | 'disabled'
  | 'restricted';

export type PlatformCapabilitySource =
  | 'android_bridge'
  | 'ios_wkwebview'
  | 'web_api'
  | 'css_approximation'
  | 'not_provisioned';

export interface CapabilityStatus {
  availability: PlatformFeatureAvailability;
  reason: string;
  source: PlatformCapabilitySource;
  hostVersion?: string;
}

export interface PlatformBridgeHandshake {
  protocolVersion: 'v13.1';
  platform: TargetPlatform | 'ssr';
  runtimeKind: PlatformCapabilities['runtimeKind'];
  hostVersion: string;
  verifiedOrigin: boolean;
  allowedOrigin: string;
  capabilities: string[];
  timedOut: boolean;
}

export interface PlatformCapabilityMatrix {
  runtimeKind: PlatformCapabilities['runtimeKind'];
  windowClass: AdaptiveWindowClass;
  navigationGlass: CapabilityStatus;
  haptics: CapabilityStatus;
  notifications: CapabilityStatus;
  biometrics: CapabilityStatus;
  widgetsLiveActivities: CapabilityStatus;
  appIntentsShortcuts: CapabilityStatus;
  cameraCapture: CapabilityStatus;
  stylusAnnotation: CapabilityStatus;
  sharePrintExport: CapabilityStatus;
  backgroundSync: CapabilityStatus;
  packagingInstall: CapabilityStatus;
}

const BRIDGE_ALLOWED_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  'appassets.androidplatform.net',
  'galaxy1364.github.io',
]);

export function isBridgeOriginAllowed(originOrHost?: string | null): boolean {
  if (!originOrHost) return false;
  try {
    const parsed = originOrHost.includes('://') ? new URL(originOrHost) : new URL(`https://${originOrHost}`);
    return BRIDGE_ALLOWED_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function negotiatePlatformBridgeHandshake(opts?: {
  timeoutMs?: number;
  origin?: string;
  userAgent?: string;
  viewportWidth?: number;
  androidNativeAppInfo?: () => string | Promise<string>;
  hasAndroidBridge?: boolean;
  hasIosBridge?: boolean;
}): Promise<PlatformBridgeHandshake> {
  const hasWindow = typeof window !== 'undefined';
  const origin = opts?.origin ?? (hasWindow ? window.location.origin : '');
  const verifiedOrigin = isBridgeOriginAllowed(origin);
  const caps = detectPlatformCapabilities({
    userAgent: opts?.userAgent,
    viewportWidth: opts?.viewportWidth,
    hasAndroidBridge: opts?.hasAndroidBridge,
    hasIosBridge: opts?.hasIosBridge,
  });
  const info = detectPlatformFromUA(
    opts?.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
    { viewportWidth: opts?.viewportWidth ?? (hasWindow ? window.innerWidth : 1280) }
  );

  if (!verifiedOrigin) {
    return {
      protocolVersion: 'v13.1',
      platform: hasWindow || opts ? info.platform : 'ssr',
      runtimeKind: caps.runtimeKind,
      hostVersion: 'web',
      verifiedOrigin: false,
      allowedOrigin: origin || 'untrusted',
      capabilities: caps.serviceWorkerSupported ? ['web_pwa_fallback'] : [],
      timedOut: false,
    };
  }

  const readAndroidInfoFn =
    opts?.androidNativeAppInfo ??
    (hasWindow
      ? (window as unknown as { AndroidBridge?: { getNativeAppInfo?: () => string } }).AndroidBridge
          ?.getNativeAppInfo
      : undefined);

  let hostVersion = 'web';
  let timedOut = false;
  const capabilities: string[] = [];

  if (caps.androidNativeHapticsBridge && typeof readAndroidInfoFn === 'function') {
    const timeoutMs = Math.max(50, opts?.timeoutMs ?? 250);
    try {
      const raw = await Promise.race<string | null>([
        Promise.resolve().then(() => readAndroidInfoFn()),
        new Promise<null>((resolve) =>
          setTimeout(() => {
            timedOut = true;
            resolve(null);
          }, timeoutMs)
        ),
      ]);
      if (typeof raw === 'string' && raw.trim().startsWith('{')) {
        const parsed = JSON.parse(raw) as { versionName?: unknown; versionCode?: unknown };
        if (typeof parsed.versionName === 'string' && parsed.versionName.length > 0) {
          hostVersion = `${parsed.versionName}${typeof parsed.versionCode === 'number' ? `+${parsed.versionCode}` : ''}`;
          capabilities.push('android_haptics', 'android_file_chooser');
        }
      }
    } catch {
      // Fail closed to web capabilities without spoofing native features
    }
  } else if (caps.iosNativeHapticsBridge) {
    hostVersion = 'ios_wkwebview';
    capabilities.push('ios_haptics');
  }

  if (caps.serviceWorkerSupported) capabilities.push('pwa_service_worker');
  if (caps.webNotificationsApi) capabilities.push('web_notifications');
  if (caps.webVibrationApi) capabilities.push('web_vibration');

  return {
    protocolVersion: 'v13.1',
    platform: hasWindow || opts ? info.platform : 'ssr',
    runtimeKind: caps.runtimeKind,
    hostVersion,
    verifiedOrigin: true,
    allowedOrigin: origin,
    capabilities,
    timedOut,
  };
}

export function buildPlatformCapabilityMatrix(overrides?: {
  userAgent?: string;
  hasAndroidBridge?: boolean;
  hasIosBridge?: boolean;
  hasVibrate?: boolean;
  hasAudioContext?: boolean;
  hasNotification?: boolean;
  notificationPermission?: 'granted' | 'denied' | 'default';
  hasServiceWorker?: boolean;
  hasWebAuthn?: boolean;
  hasWebShare?: boolean;
  isSecureContext?: boolean;
  prefersDark?: boolean;
  prefersReducedMotion?: boolean;
  isStandalone?: boolean;
  viewportWidth?: number;
}): PlatformCapabilityMatrix {
  const hasWindow = typeof window !== 'undefined';
  const hasNav = typeof navigator !== 'undefined';
  const width = overrides?.viewportWidth ?? (hasWindow ? window.innerWidth : 1280);
  const windowClass = getAdaptiveBreakpoint(width);
  const ua = overrides?.userAgent ?? (hasNav ? navigator.userAgent : '');
  const info = detectPlatformFromUA(ua, {
    platformStr: hasNav ? navigator.platform : '',
    maxTouchPoints: hasNav ? navigator.maxTouchPoints : 0,
    viewportWidth: width,
    isStandalone: overrides?.isStandalone,
  });
  const caps = detectPlatformCapabilities(overrides);

  const notifPermission =
    overrides?.notificationPermission ??
    (hasWindow && 'Notification' in window ? Notification.permission : 'default');
  const webAuthnAvailable =
    overrides?.hasWebAuthn ??
    Boolean(hasWindow && 'PublicKeyCredential' in window && (overrides?.isSecureContext ?? window.isSecureContext));
  const webShareAvailable =
    overrides?.hasWebShare ?? Boolean(hasNav && typeof navigator.share === 'function');
  const isIosBrowser = (info.platform === 'ios' || info.platform === 'ipad') && !caps.iosNativeHapticsBridge;

  const navigationGlass: CapabilityStatus = caps.cssBlurApproximation
    ? {
        availability: 'supported',
        reason: 'CSS backdrop-filter approximation active with opaque fallback; native SwiftUI Liquid Glass requires native Xcode UI.',
        source: 'css_approximation',
      }
    : {
        availability: 'disabled',
        reason: 'CSS backdrop-filter unsupported or disabled; using solid high-contrast surfaces.',
        source: 'css_approximation',
      };

  const haptics: CapabilityStatus = caps.androidNativeHapticsBridge
    ? {
        availability: 'supported',
        reason: 'Android View HapticFeedback bridge is active.',
        source: 'android_bridge',
      }
    : caps.iosNativeHapticsBridge
    ? {
        availability: 'supported',
        reason: 'Native iOS WKWebView haptic handler is connected.',
        source: 'ios_wkwebview',
      }
    : isIosBrowser
    ? {
        availability: 'unavailable',
        reason: 'Apple Taptic Engine / CoreHaptics is unavailable in Safari PWA.',
        source: 'not_provisioned',
      }
    : caps.webVibrationApi
    ? {
        availability: 'supported',
        reason: 'Browser navigator.vibrate API available (requires user gesture).',
        source: 'web_api',
      }
    : {
        availability: 'unavailable',
        reason: 'Hardware vibration/haptics bridge is unavailable in this runtime.',
        source: 'not_provisioned',
      };

  const notifications: CapabilityStatus = !caps.webNotificationsApi
    ? {
        availability: 'unavailable',
        reason: isIosBrowser && !info.isStandalone
          ? 'iOS Web Push requires Home Screen installation on iOS 16.4+.'
          : 'Notification API is unavailable in this environment.',
        source: 'not_provisioned',
      }
    : notifPermission === 'granted'
    ? {
        availability: 'supported',
        reason: 'Browser notification permission is granted.',
        source: 'web_api',
      }
    : notifPermission === 'denied'
    ? {
        availability: 'disabled',
        reason: 'Notification permission was denied by the user.',
        source: 'web_api',
      }
    : {
        availability: 'permission_required',
        reason: 'User permission prompt required before displaying system notifications.',
        source: 'web_api',
      };

  const biometrics: CapabilityStatus = webAuthnAvailable
    ? {
        availability: 'permission_required',
        reason: 'Passkey/WebAuthn device check supported for local session unlock; clinical signatures stay server-verified.',
        source: 'web_api',
      }
    : {
        availability: 'unavailable',
        reason: 'WebAuthn / native LocalAuthentication bridge is unavailable in this host.',
        source: 'not_provisioned',
      };

  const widgetsLiveActivities: CapabilityStatus = {
    availability: 'unavailable',
    reason: 'Native WidgetKit / ActivityKit / Android AppWidget extensions are not bundled in the current host.',
    source: 'not_provisioned',
  };

  const appIntentsShortcuts: CapabilityStatus =
    caps.runtimeKind === 'standalone_pwa' || caps.runtimeKind === 'desktop_web'
      ? {
          availability: 'supported',
          reason: 'PWA manifest shortcuts & keyboard command shortcuts available (no Siri App Intents without native iOS target).',
          source: 'web_api',
        }
      : {
          availability: 'unavailable',
          reason: 'Native Siri App Intents / OS assistant shortcuts are unprovisioned.',
          source: 'not_provisioned',
        };

  const cameraCapture: CapabilityStatus =
    hasWindow && (Boolean(hasNav && navigator.mediaDevices?.getUserMedia) || typeof document !== 'undefined')
      ? {
          availability: 'permission_required',
          reason: 'Standard file/photo picker and media capture require runtime user gesture and OS permission.',
          source: caps.androidNativeHapticsBridge ? 'android_bridge' : 'web_api',
        }
      : {
          availability: 'unavailable',
          reason: 'Camera/file picker requires interactive browser or device host.',
          source: 'not_provisioned',
        };

  const stylusAnnotation: CapabilityStatus = {
    availability: 'supported',
    reason: 'PointerEvents stroke capture with keyboard/touch alternative (no PencilKit native canvas on web).',
    source: 'web_api',
  };

  const sharePrintExport: CapabilityStatus = {
    availability: webShareAvailable || hasWindow ? 'supported' : 'unavailable',
    reason: webShareAvailable
      ? 'Web Share API and browser print/JSON export available.'
      : 'Browser print and file export available (Web Share unsupported in this host).',
    source: 'web_api',
  };

  const backgroundSync: CapabilityStatus = caps.serviceWorkerSupported
    ? {
        availability: 'supported',
        reason: 'Service Worker asset lifecycle and project-namespaced IndexedDB outbox active (no guaranteed OS background fetch on iOS).',
        source: 'web_api',
      }
    : {
        availability: 'unavailable',
        reason: 'Service Worker unsupported; local outbox flushes while app stays open.',
        source: 'not_provisioned',
      };

  const packagingInstall: CapabilityStatus =
    caps.runtimeKind === 'android_webview_apk'
      ? {
          availability: 'supported',
          reason: 'Running inside maintained Android Kotlin/Compose WebView host; signed store AAB requires CI/owner keystore.',
          source: 'android_bridge',
        }
      : info.platform === 'ios' || info.platform === 'ipad'
      ? {
          availability: 'restricted',
          reason: 'Safari WebClip PWA installable; signed App Store / TestFlight IPA requires macOS/Xcode build host (not present in workspace).',
          source: 'not_provisioned',
        }
      : info.platform === 'windows'
      ? {
          availability: 'supported',
          reason: 'Edge/Chrome PWA and MinaDental-Windows.cmd launcher available; MSIX requires Windows signing.',
          source: 'web_api',
        }
      : {
          availability: 'supported',
          reason: 'Installable PWA with verified release-manifest integrity.',
          source: 'web_api',
        };

  return {
    runtimeKind: caps.runtimeKind,
    windowClass,
    navigationGlass,
    haptics,
    notifications,
    biometrics,
    widgetsLiveActivities,
    appIntentsShortcuts,
    cameraCapture,
    stylusAnnotation,
    sharePrintExport,
    backgroundSync,
    packagingInstall,
  };
}

export function buildWindowsLauncherScript(appUrl: string): string {
  const safeUrl = (appUrl || 'https://galaxy1364.github.io/Dendalcare/').replace(/["^&|<>]/g, '');
  return [
    '@echo off',
    'title MinaDental Clinic Suite',
    `set "APP_URL=${safeUrl}"`,
    'if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" (',
    '  start "" "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" --app="%APP_URL%" --window-size=1280,840',
    '  exit /b 0',
    ')',
    'if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" (',
    '  start "" "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" --app="%APP_URL%" --window-size=1280,840',
    '  exit /b 0',
    ')',
    'if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" (',
    '  start "" "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" --app="%APP_URL%" --window-size=1280,840',
    '  exit /b 0',
    ')',
    'start "" "%APP_URL%"',
    'exit /b 0',
  ].join('\r\n');
}

export function downloadWindowsDesktopLauncher(customUrl?: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const targetUrl =
    customUrl ||
    (window.location.protocol === 'https:'
      ? window.location.origin + window.location.pathname
      : 'https://galaxy1364.github.io/Dendalcare/');
  const content = buildWindowsLauncherScript(targetUrl);
  const blob = new Blob([content], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'MinaDental-Windows.cmd';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
