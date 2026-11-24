// =========================================================================
// MinaDental Cross-Platform Adaptive Runtime & Package Engine
// Dedicated support for iPhone (iOS), Android, iPad (iPadOS), and Windows
// =========================================================================

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
  let formFactor: FormFactor = width >= 1024 ? 'desktop' : width >= 768 ? 'tablet' : 'mobile';
  let labelFa = 'وب دسکتاپ';

  if (isIpad) {
    platform = 'ipad';
    formFactor = 'tablet';
    labelFa = 'آیپد (iPadOS)';
  } else if (isIphone) {
    platform = 'ios';
    formFactor = 'mobile';
    labelFa = 'آیفون (iOS)';
  } else if (isAndroid) {
    platform = 'android';
    formFactor = width >= 768 && !/mobile/.test(uaLower) ? 'tablet' : 'mobile';
    labelFa = formFactor === 'tablet' ? 'تبلت اندروید' : 'اندروید';
  } else if (isWindows) {
    platform = 'windows';
    formFactor = 'desktop';
    labelFa = 'ویندوز دسکتاپ';
  } else if (isMac) {
    platform = 'macos';
    formFactor = 'desktop';
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

export function getCurrentPlatformInfo(): PlatformInfo {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      platform: 'windows',
      formFactor: 'desktop',
      labelFa: 'ویندوز دسکتاپ',
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

/**
 * Generates a real, zero-dependency Windows 10/11 App-Mode Launcher (.cmd)
 * that opens MinaDental in a dedicated frameless desktop window via Edge or Chrome.
 */
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
    (window.location.protocol === 'https:' ? window.location.origin + window.location.pathname : 'https://galaxy1364.github.io/Dendalcare/');
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
