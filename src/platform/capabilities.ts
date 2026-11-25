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
