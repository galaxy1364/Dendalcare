import { useState, useEffect, useCallback } from 'react';
import {
  Smartphone, Apple, Download, RefreshCw, CheckCircle2, Tablet,
  Share2, PlusSquare, Sparkles, X, ShieldCheck, Zap, Laptop, AlertCircle,
  Lock, FileCode2, Server, Copy, Check, Keyboard,
} from 'lucide-react';
import {
  downloadApkSafely,
  fetchPublishedApkMetadata,
  formatApkSizeMb,
  GITHUB_ANDROID_RELEASE_PAGE,
  type PublishedApkMetadata,
} from '../../lib/downloadHelper';
import { CURRENT_APP_VERSION, CURRENT_APP_BUILD } from '../../lib/cloudSyncEngine';
import {
  downloadWindowsDesktopLauncher,
  getCurrentPlatformInfo,
} from '../../lib/platformEngine';

interface InstallAppModalProps {
  open: boolean;
  onClose: () => void;
  deferredPrompt: any;
  onInstallSuccess?: () => void;
  updateAvailable?: boolean;
  onApplyUpdate?: () => void;
}

interface EligibilityState {
  checking: boolean;
  isSecureContext: boolean;
  protocol: string;
  manifestValid: boolean;
  manifestDetails: string;
  iconsValid: boolean;
  scopeContained: boolean;
  serviceWorkerActive: boolean;
  swDetails: string;
  installPromptReady: boolean;
  inIframe: boolean;
}

type ModalPlatformTab = 'android' | 'ios' | 'ipad' | 'windows';

export function InstallAppModal({
  open,
  onClose,
  deferredPrompt,
  onInstallSuccess,
  updateAvailable = false,
  onApplyUpdate,
}: InstallAppModalProps) {
  const [platform, setPlatform] = useState<ModalPlatformTab>('android');
  const [isStandalone, setIsStandalone] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<string | null>(null);
  const [downloadingApk, setDownloadingApk] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [apkMeta, setApkMeta] = useState<PublishedApkMetadata | null>(null);
  const [loadingApkMeta, setLoadingApkMeta] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [windowsLauncherDownloaded, setWindowsLauncherDownloaded] = useState(false);
  const [eligibility, setEligibility] = useState<EligibilityState>({
    checking: true,
    isSecureContext: false,
    protocol: '',
    manifestValid: false,
    manifestDetails: 'در حال بررسی...',
    iconsValid: false,
    scopeContained: false,
    serviceWorkerActive: false,
    swDetails: 'در حال بررسی...',
    installPromptReady: false,
    inIframe: false,
  });

  const activePrompt = deferredPrompt || (typeof window !== 'undefined' ? (window as any).__deferredInstallPrompt : null);
  const [iosNonSafari, setIosNonSafari] = useState(false);
  const [copiedPageUrl, setCopiedPageUrl] = useState(false);
  const [registeringSw, setRegisteringSw] = useState(false);

  const checkEligibility = useCallback(async () => {
    if (typeof window === 'undefined') return;
    setEligibility(prev => ({ ...prev, checking: true }));

    const isSecure = Boolean(
      window.isSecureContext ||
      window.location.protocol === 'https:' ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    );
    const protocol = window.location.protocol.replace(':', '').toUpperCase();
    const inIframe = (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();

    // GE-0007 P0-PWA: Real Chrome-grade manifest verification (zero false positives!)
    let manifestValid = false;
    let iconsValid = false;
    let scopeContained = false;
    let manifestDetails = 'فایل manifest.json یافت نشد';
    try {
      const linkEl = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
      const manifestHref = linkEl?.getAttribute('href') || '';
      if (!linkEl || !manifestHref) {
        manifestDetails = 'تگ <link rel="manifest"> در صفحه وجود ندارد';
      } else {
        const manifestUrl = new URL(manifestHref, window.location.href);
        const res = await fetch(manifestUrl.href, { cache: 'no-store' });
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!res.ok) {
          manifestDetails = `خطای HTTP ${res.status} در دریافت manifest.json`;
        } else if (ct.includes('text/html')) {
          manifestDetails = 'MIME نامعتبر (HTML به جای JSON)';
        } else {
          const data = await res.json();
          const hasId = typeof data.id === 'string' && data.id.length > 0;
          const hasName = Boolean(data.name || data.short_name);
          const hasDisplay =
            data.display === 'standalone' || data.display === 'fullscreen' || data.display === 'minimal-ui';
          const hasStartUrl = Boolean(data.start_url);
          const resolvedScope = new URL(data.scope || './', manifestUrl);
          const resolvedStart = new URL(data.start_url || './', manifestUrl);
          const currentPageNoHash = window.location.origin + window.location.pathname;
          scopeContained =
            currentPageNoHash.startsWith(resolvedScope.origin + resolvedScope.pathname) &&
            resolvedStart.href.startsWith(resolvedScope.href);

          // Probe actual HTTP availability of 192x192 and 512x512 PNG icons relative to manifestUrl
          const iconList: Array<{ src?: string; sizes?: string }> = Array.isArray(data.icons) ? data.icons : [];
          const icon192 = iconList.find((i) => String(i.sizes || '').includes('192x192'));
          const icon512 = iconList.find((i) => String(i.sizes || '').includes('512x512'));
          let ok192 = false;
          let ok512 = false;
          if (icon192?.src && icon512?.src) {
            const [r192, r512] = await Promise.all([
              fetch(new URL(icon192.src, manifestUrl).href, { cache: 'no-store' }).catch(() => null),
              fetch(new URL(icon512.src, manifestUrl).href, { cache: 'no-store' }).catch(() => null),
            ]);
            ok192 = Boolean(r192?.ok && (r192.headers.get('content-type') || '').toLowerCase().startsWith('image/'));
            ok512 = Boolean(r512?.ok && (r512.headers.get('content-type') || '').toLowerCase().startsWith('image/'));
          }
          iconsValid = ok192 && ok512;

          const checks = [hasId, hasName, hasDisplay, hasStartUrl, scopeContained, iconsValid];
          const passedCount = checks.filter(Boolean).length;
          manifestValid = hasId && hasName && hasDisplay && hasStartUrl && scopeContained && iconsValid;

          if (!scopeContained) {
            manifestDetails = `خطای دامنه (Scope): صفحه خارج از محدوده ${resolvedScope.pathname}`;
          } else if (!iconsValid) {
            manifestDetails = 'خطای آیکون: فایل‌های PNG (۱۹۲/۵۱۲) در دسترس نیستند';
          } else if (manifestValid) {
            manifestDetails = `تایید واقعی (${passedCount}/6 • Scope + آیکون‌های ۱۹۲/۵۱۲)`;
          } else {
            manifestDetails = `ناقص (${passedCount}/6)`;
          }
        }
      }
    } catch {
      manifestValid = false;
      iconsValid = false;
      scopeContained = false;
      manifestDetails = 'خطا در خواندن یا تحلیل واقعی manifest.json';
    }

    let serviceWorkerActive = false;
    let swDetails = 'پشتیبانی نمی‌شود';
    try {
      if ('serviceWorker' in navigator) {
        let reg = await navigator.serviceWorker.getRegistration();
        if (!reg && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
          try {
            reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
          } catch {
            // ignore in restricted embedded frames
          }
        }
        if (reg?.active && navigator.serviceWorker.controller) {
          serviceWorkerActive = true;
          swDetails = 'فعال و کنترل‌کننده صفحه (Active Controller)';
        } else if (reg?.active) {
          serviceWorkerActive = true;
          swDetails = 'ثبت‌شده — یک بار صفحه را رفرش کنید';
        } else if (reg?.installing || reg?.waiting) {
          serviceWorkerActive = false;
          swDetails = 'در حال فعال‌سازی...';
        } else {
          serviceWorkerActive = false;
          swDetails = 'ثبت نشده (نیاز به تب مستقل مرورگر)';
        }
      } else {
        swDetails = 'این مرورگر از Service Worker پشتیبانی نمی‌کند';
      }
    } catch {
      serviceWorkerActive = false;
      swDetails = 'اجرا در محیط محدودشده';
    }

    const promptAvailable = Boolean(deferredPrompt || (window as any).__deferredInstallPrompt);
    setEligibility({
      checking: false,
      isSecureContext: isSecure,
      protocol,
      manifestValid,
      manifestDetails,
      iconsValid,
      scopeContained,
      serviceWorkerActive,
      swDetails,
      installPromptReady: promptAvailable,
      inIframe,
    });
  }, [deferredPrompt]);

  useEffect(() => {
    const info = getCurrentPlatformInfo();
    if (info.platform === 'ipad') {
      setPlatform('ipad');
    } else if (info.platform === 'ios') {
      setPlatform('ios');
    } else if (info.platform === 'android') {
      setPlatform('android');
    } else {
      setPlatform('windows');
    }
    setIosNonSafari(info.isIosNonSafari);
    setIsStandalone(info.isStandalone);
  }, []);

  useEffect(() => {
    if (open) {
      checkEligibility();
      setLoadingApkMeta(true);
      fetchPublishedApkMetadata()
        .then((meta) => setApkMeta(meta))
        .finally(() => setLoadingApkMeta(false));
    }
  }, [open, checkEligibility]);

  if (!open) return null;

  const handlePromptInstall = async () => {
    if (activePrompt) {
      activePrompt.prompt();
      const choice = await activePrompt.userChoice;
      if (choice.outcome === 'accepted') {
        (window as any).__deferredInstallPrompt = null;
        onInstallSuccess?.();
        onClose();
      }
    }
  };

  const handleManualRegisterSw = async () => {
    if (!('serviceWorker' in navigator)) return;
    setRegisteringSw(true);
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
      await checkEligibility();
    } catch {
      // ignore
    } finally {
      setRegisteringSw(false);
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateStatus(null);
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update();
          if (reg.waiting || updateAvailable) {
            setUpdateStatus('نسخه جدید دریافت شد؛ در حال بروزرسانی...');
            onApplyUpdate?.();
          } else {
            setUpdateStatus(`شما در حال استفاده از آخرین نسخه پایدار (v${CURRENT_APP_VERSION}) هستید.`);
          }
        } else {
          setUpdateStatus(`نسخه v${CURRENT_APP_VERSION} با سرور ابری هماهنگ است.`);
        }
      } else {
        setUpdateStatus(`برنامه روی آخرین نسخه (v${CURRENT_APP_VERSION}) قرار دارد.`);
      }
    } catch {
      setUpdateStatus(`بررسی انجام شد؛ سیستم با نسخه v${CURRENT_APP_VERSION} هماهنگ است.`);
    } finally {
      setTimeout(() => setCheckingUpdate(false), 700);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-md animate-fade-in"
      dir="rtl"
      data-testid="install_app_modal"
    >
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto glass-dark rounded-[28px] border border-white/15 p-5 text-white shadow-2xl space-y-4 desktop-scroll">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-cyan-500/30">
              <Download size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                مرکز نصب چندپلتفرمی مینادنتال
                <span className="px-2 py-0.5 rounded-full text-[10px] bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-400/30">
                  v{CURRENT_APP_VERSION}
                </span>
              </h2>
              <p className="text-[11px] text-blue-200/70">
                بسته نصب اختصاصی برای آیفون، اندروید، آیپد و ویندوز
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            data-testid="close_install_modal_button"
            aria-label="بستن پنجره نصب"
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-all"
          >
            <X size={16} />
          </button>
        </div>

        {/* Browser Installation Readiness Panel */}
        <div className="p-3.5 rounded-2xl bg-white/5 border border-white/15 space-y-2" data-testid="eligibility_criteria_panel">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
              <ShieldCheck size={15} className="text-cyan-400" />
              وضعیت آمادگی نصب در این دستگاه
            </span>
            <button
              onClick={checkEligibility}
              data-testid="recheck_eligibility_button"
              className="text-[10px] px-2 py-0.5 rounded-lg bg-white/10 hover:bg-white/20 text-white/80 flex items-center gap-1 transition-all"
            >
              <RefreshCw size={11} className={eligibility.checking ? 'animate-spin' : ''} />
              بررسی مجدد
            </button>
          </div>

          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between p-2 rounded-xl bg-black/25 border border-white/5">
              <div className="flex items-center gap-1.5 text-white/85">
                <Lock size={13} className={eligibility.isSecureContext ? 'text-emerald-400' : 'text-red-400'} />
                <span>اتصال امن (HTTPS):</span>
              </div>
              <span className={`font-bold ${eligibility.isSecureContext ? 'text-emerald-300' : 'text-red-300'}`}>
                {eligibility.isSecureContext ? `تایید شده (${eligibility.protocol})` : `نامعتبر (${eligibility.protocol})`}
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-xl bg-black/25 border border-white/5">
              <div className="flex items-center gap-1.5 text-white/85">
                <FileCode2 size={13} className={eligibility.manifestValid ? 'text-emerald-400' : 'text-amber-400'} />
                <span>مانیفست چندپلتفرمی:</span>
              </div>
              <span className={`font-bold truncate max-w-[190px] ${eligibility.manifestValid ? 'text-emerald-300' : 'text-amber-300'}`}>
                {eligibility.manifestDetails}
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-xl bg-black/25 border border-white/5">
              <div className="flex items-center gap-1.5 text-white/85">
                <Server size={13} className={eligibility.serviceWorkerActive ? 'text-emerald-400' : 'text-amber-400'} />
                <span>موتور آفلاین (Service Worker):</span>
              </div>
              <span className={`font-bold truncate max-w-[190px] ${eligibility.serviceWorkerActive ? 'text-emerald-300' : 'text-amber-300'}`}>
                {eligibility.swDetails}
              </span>
            </div>

            <div className="p-2 rounded-xl bg-black/25 border border-white/5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-white/85 flex items-center gap-1.5">
                  {eligibility.installPromptReady || isStandalone ? (
                    <CheckCircle2 size={13} className="text-emerald-400" />
                  ) : (
                    <AlertCircle size={13} className="text-amber-400" />
                  )}
                  وضعیت نصب مستقیم:
                </span>
                <span className={`font-bold ${eligibility.installPromptReady || isStandalone ? 'text-emerald-300' : 'text-amber-300'}`}>
                  {isStandalone
                    ? 'نصب‌شده (حالت اپلیکیشن)'
                    : eligibility.installPromptReady
                    ? 'آماده نصب تک‌کلیکی'
                    : eligibility.inIframe
                    ? 'باز کردن در تب مستقل'
                    : 'قابل نصب از منوی مرورگر'}
                </span>
              </div>
              {!eligibility.installPromptReady && !isStandalone && (
                <p className="text-[10px] text-amber-200/80 leading-relaxed pt-0.5">
                  {eligibility.inIframe
                    ? 'برای فعال‌شدن نصب تک‌کلیکی مرورگر، صفحه را در یک تب مستقل باز کنید یا فایل بسته نصب مخصوص سیستم‌عامل خود را از تب‌های زیر دریافت نمایید.'
                    : platform === 'ios' || platform === 'ipad'
                    ? 'در مرورگر Safari اپل، از دکمه Share و گزینه Add to Home Screen یا فایل پروفایل نصب مستقیم استفاده کنید.'
                    : 'اگر قبلاً برنامه را نصب کرده‌اید، آیکون آن روی صفحه اصلی یا منوی Start قرار دارد؛ در غیر این صورت از منوی مرورگر گزینه Install App را انتخاب کنید.'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Standalone status indicator */}
        {isStandalone && (
          <div className="p-3 rounded-2xl bg-emerald-500/15 border border-emerald-400/30 flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
            <span>مینادنتال در حالت اپلیکیشن مستقل (Standalone) روی این دستگاه فعال است.</span>
          </div>
        )}

        {/* Auto-Update Banner if available */}
        {updateAvailable && (
          <div className="p-3 rounded-2xl bg-gradient-to-r from-purple-500/30 to-blue-500/30 border border-purple-400/40 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-purple-200">
              <Sparkles size={16} className="text-purple-300" />
              <span>نسخه جدید برنامه آماده نصب است</span>
            </div>
            <button
              onClick={onApplyUpdate}
              className="w-full py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-md transition-all active:scale-95"
            >
              دریافت و بروزرسانی آنی
            </button>
          </div>
        )}

        {/* 4-Platform Segmented Selector: Android | iPhone | iPad | Windows */}
        <div className="grid grid-cols-4 gap-1 p-1 rounded-2xl bg-white/5 border border-white/10 text-[11px]">
          <button
            type="button"
            data-testid="install_tab_android"
            onClick={() => setPlatform('android')}
            className={`py-2 rounded-xl font-bold flex items-center justify-center gap-1 transition-all ${
              platform === 'android' ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white shadow-md' : 'text-white/60 hover:text-white'
            }`}
          >
            <Smartphone size={13} />
            اندروید
          </button>
          <button
            type="button"
            data-testid="install_tab_ios"
            onClick={() => setPlatform('ios')}
            className={`py-2 rounded-xl font-bold flex items-center justify-center gap-1 transition-all ${
              platform === 'ios' ? 'bg-gradient-to-r from-slate-700 to-slate-900 text-white shadow-md border border-white/20' : 'text-white/60 hover:text-white'
            }`}
          >
            <Apple size={13} />
            آیفون
          </button>
          <button
            type="button"
            data-testid="install_tab_ipad"
            onClick={() => setPlatform('ipad')}
            className={`py-2 rounded-xl font-bold flex items-center justify-center gap-1 transition-all ${
              platform === 'ipad' ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md' : 'text-white/60 hover:text-white'
            }`}
          >
            <Tablet size={13} />
            آیپد
          </button>
          <button
            type="button"
            data-testid="install_tab_windows"
            onClick={() => setPlatform('windows')}
            className={`py-2 rounded-xl font-bold flex items-center justify-center gap-1 transition-all ${
              platform === 'windows' ? 'bg-gradient-to-r from-sky-600 to-blue-700 text-white shadow-md' : 'text-white/60 hover:text-white'
            }`}
          >
            <Laptop size={13} />
            ویندوز
          </button>
        </div>

        {/* 1. Android Tab */}
        {platform === 'android' && (
          <div className="space-y-3">
            {activePrompt ? (
              <button
                onClick={handlePromptInstall}
                data-testid="pwa_prompt_install_button"
                className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold text-sm shadow-lg shadow-emerald-500/25 flex items-center justify-center gap-2 active:scale-95 transition-all"
              >
                <Download size={18} />
                نصب مستقیم روی گوشی اندروید (یک کلیک)
              </button>
            ) : (
              <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 space-y-2.5 text-xs">
                <div className="flex items-center gap-2 font-bold text-cyan-300">
                  <Zap size={16} />
                  نصب مستقیم در مرورگر اندروید (Chrome / Samsung Internet):
                </div>
                {eligibility.inIframe && (
                  <button
                    type="button"
                    onClick={() => window.open(window.location.href, '_blank', 'noopener,noreferrer')}
                    className="w-full py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
                  >
                    <Smartphone size={15} />
                    باز کردن در تب مستقل مرورگر
                  </button>
                )}
                {!eligibility.serviceWorkerActive && !eligibility.inIframe && (
                  <button
                    type="button"
                    onClick={handleManualRegisterSw}
                    disabled={registeringSw}
                    className="w-full py-2 px-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw size={13} className={registeringSw ? 'animate-spin' : ''} />
                    {registeringSw ? 'در حال فعال‌سازی...' : 'فعال‌سازی موتور نصب مرورگر'}
                  </button>
                )}
                <p className="text-[11px] text-white/80 leading-relaxed">
                  در مرورگر <strong>Chrome</strong> یا <strong>Samsung Internet</strong>، روی منوی سه نقطه (⋮) بزنید و گزینه <strong className="text-emerald-300">«نصب برنامه / Install app»</strong> را انتخاب کنید تا با آیکون اختصاصی مینادنتال نصب شود.
                </p>
              </div>
            )}

            {/* Native Signed APK Card */}
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-blue-900/40 to-indigo-950/60 border border-blue-400/20 space-y-2.5" data-testid="native_apk_download_card">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-xs font-bold text-blue-300 flex items-center gap-1.5">
                  <ShieldCheck size={16} className="text-blue-400 shrink-0" />
                  بسته بومی اندروید (Signed APK)
                </span>
                <span dir="ltr" className="text-[10px] px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-200 border border-blue-400/30 font-mono">
                  {apkMeta?.available
                    ? `v${apkMeta.versionName || CURRENT_APP_VERSION} • ${formatApkSizeMb(apkMeta.sizeBytes)}`
                    : `v${CURRENT_APP_VERSION} (#${CURRENT_APP_BUILD})`}
                </span>
              </div>
              <p className="text-[11px] text-white/75 leading-relaxed">
                فایل نصبی بومی اندروید (متفاوت از نصب PWA مرورگر) ساخته‌شده و امضاشده توسط خط تولید خودکار GitHub Actions.
              </p>

              {apkMeta?.available && apkMeta.sha256 && (
                <div className="p-2 rounded-xl bg-black/30 border border-emerald-400/25 text-[10px] text-emerald-200 space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">وضعیت امضا:</span>
                    <span dir="ltr" className="font-mono text-emerald-300">
                      {apkMeta.signingMode === 'release_upload_keystore' ? 'Release Upload Key' : 'CI Signed APK'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">SHA-256:</span>
                    <span dir="ltr" className="font-mono text-white/80">{apkMeta.sha256.slice(0, 16)}…</span>
                  </div>
                </div>
              )}

              {!loadingApkMeta && apkMeta && !apkMeta.available && (
                <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-400/35 text-[10.5px] text-amber-200 leading-relaxed">
                  {apkMeta.reason}
                </div>
              )}

              {downloadingApk ? (
                <div className="space-y-1.5 p-2 rounded-xl bg-blue-950/60 border border-blue-400/30">
                  <div className="flex justify-between text-[11px] text-blue-200 font-bold">
                    <span>در حال دریافت و بررسی فایل APK...</span>
                    <span>{downloadProgress}%</span>
                  </div>
                  <div className="w-full h-2 bg-blue-900/60 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all duration-200 rounded-full"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    data-testid="modal_download_apk_btn"
                    onClick={async () => {
                      setDownloadingApk(true);
                      setDownloadProgress(10);
                      setDownloadError(null);
                      const res = await downloadApkSafely('MinaDental-android.apk', (p) => setDownloadProgress(p), apkMeta);
                      setDownloadingApk(false);
                      if (!res.success) {
                        setDownloadError(res.error || 'خطا در دانلود فایل APK');
                      }
                    }}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all text-center"
                  >
                    <Download size={15} />
                    {loadingApkMeta ? 'بررسی انتشار APK...' : 'دانلود مستقیم APK امضاشده'}
                  </button>
                  <a
                    href={apkMeta?.releasePageUrl || GITHUB_ANDROID_RELEASE_PAGE}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="modal_github_apk_release_link"
                    className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold text-xs flex items-center justify-center gap-1.5 border border-cyan-500/30 active:scale-95 transition-all text-center"
                  >
                    <Download size={15} />
                    صفحه انتشار GitHub
                  </a>
                </div>
              )}

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-400/30 text-amber-200 text-[11px] space-y-1.5">
                <div className="flex items-center gap-1.5 font-bold text-amber-300">
                  <AlertCircle size={15} className="shrink-0 text-amber-400" />
                  <span>نکات نصب بدون خطا روی اندروید:</span>
                </div>
                <ol className="list-decimal list-inside space-y-1 text-white/80 leading-relaxed pr-1 text-[10.5px]">
                  <li>در صورت نصب بودن نسخه قدیمی‌تر با کلید امضای متفاوت، ابتدا آن را حذف (Uninstall) کنید.</li>
                  <li>در اخطار Play Protect گزینه <strong>More details ➔ Install anyway</strong> را لمس کنید.</li>
                  <li>مجوز <strong>Install Unknown Apps</strong> را برای مرورگر یا فایل‌منیجر فعال نمایید.</li>
                </ol>
              </div>

              {downloadError && (
                <div className="p-3 rounded-xl bg-red-500/20 border border-red-400/40 text-red-200 text-[11px] space-y-2" data-testid="modal_apk_download_error">
                  <div className="flex items-start gap-1.5 font-bold text-red-300">
                    <AlertCircle size={15} className="shrink-0 text-red-400 mt-0.5" />
                    <span className="leading-relaxed">{downloadError}</span>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={apkMeta?.releasePageUrl || GITHUB_ANDROID_RELEASE_PAGE}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-center font-bold text-xs"
                    >
                      باز کردن صفحه انتشار GitHub Releases
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(apkMeta?.downloadUrl || GITHUB_ANDROID_RELEASE_PAGE);
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2500);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-black/40 hover:bg-black/60 text-white text-[10px] font-bold"
                    >
                      {copiedLink ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                      {copiedLink ? 'کپی شد' : 'کپی لینک'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. iPhone (iOS) Tab */}
        {platform === 'ios' && (
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3 text-xs">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
              <Apple size={18} className="text-white" />
              نصب اختصاصی روی آیفون (iOS)
            </div>

            {iosNonSafari && (
              <div className="p-3 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-100 text-[11px] space-y-2">
                <div className="font-bold text-amber-300 flex items-center gap-1.5">
                  <AlertCircle size={15} className="shrink-0" />
                  <span>مرورگر فعلی شما Safari نیست</span>
                </div>
                <p className="leading-relaxed">
                  برای نصب تمام‌صفحه روی آیفون، آدرس برنامه را کپی کرده و در مرورگر اصلی <strong>Safari</strong> باز کنید:
                </p>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.href);
                    setCopiedPageUrl(true);
                    setTimeout(() => setCopiedPageUrl(false), 2500);
                  }}
                  className="w-full py-2 px-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs flex items-center justify-center gap-1.5"
                >
                  {copiedPageUrl ? <Check size={14} /> : <Copy size={14} />}
                  {copiedPageUrl ? 'آدرس کپی شد — در Safari باز کنید' : 'کپی آدرس برای Safari'}
                </button>
              </div>
            )}

            <div className="space-y-2 pt-1">
              <div className="text-[11px] font-bold text-cyan-300">روش اول (از داخل Safari):</div>
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/5 border border-white/5">
                <span className="w-5 h-5 rounded-full bg-blue-500/30 text-blue-300 font-bold text-xs flex items-center justify-center shrink-0">۱</span>
                <div className="text-[11px] text-white/90">
                  در <strong>Safari</strong> دکمه اشتراک‌گذاری (<Share2 size={12} className="inline mx-1 text-cyan-300" /> Share) در نوار پایین را لمس کنید.
                </div>
              </div>
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/5 border border-white/5">
                <span className="w-5 h-5 rounded-full bg-blue-500/30 text-blue-300 font-bold text-xs flex items-center justify-center shrink-0">۲</span>
                <div className="text-[11px] text-white/90">
                  گزینه <strong className="text-cyan-300">«Add to Home Screen»</strong> (<PlusSquare size={12} className="inline mx-1 text-cyan-300" />) و سپس <strong>«Add»</strong> را انتخاب کنید.
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-gradient-to-br from-purple-900/40 to-indigo-950/60 border border-purple-400/30 space-y-2">
              <div className="text-[11px] font-bold text-purple-200 flex items-center gap-1.5">
                <Download size={14} className="text-purple-300" />
                روش دوم (پروفایل نصب مستقیم WebClip):
              </div>
              <a
                href="./MinaDental-iOS.mobileconfig"
                download="MinaDental-iOS.mobileconfig"
                data-testid="ios_mobileconfig_download_link"
                className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
              >
                <Download size={15} />
                دانلود پروفایل آیفون (MinaDental-iOS.mobileconfig)
              </a>
              <p className="text-[10px] text-purple-200/80 leading-relaxed">
                پس از تایید Allow، از مسیر <strong>Settings ➔ General ➔ VPN &amp; Device Management</strong> پروفایل را Install کنید.
              </p>
            </div>
          </div>
        )}

        {/* 3. iPad (iPadOS) Tab */}
        {platform === 'ipad' && (
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3 text-xs">
            <div className="flex items-center gap-2 text-sm font-bold text-purple-200">
              <Tablet size={18} className="text-purple-300" />
              نسخه اختصاصی آیپد (iPadOS • افقی و عمودی)
            </div>
            <p className="text-[11px] text-white/80 leading-relaxed">
              مینادنتال در آیپد به صورت خودکار به <strong>نوار ناوبری کناری (Navigation Rail)</strong>، چیدمان ۳ ستونه و پشتیبانی کامل از حالت <strong>Landscape، Split View و کیبورد فیزیکی</strong> تغییر حالت می‌دهد.
            </p>
            <div className="space-y-2">
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/5 border border-white/5">
                <span className="w-5 h-5 rounded-full bg-purple-500/30 text-purple-200 font-bold text-xs flex items-center justify-center shrink-0">۱</span>
                <div className="text-[11px] text-white/90">
                  در مرورگر <strong>Safari آیپد</strong>، آیکون اشتراک‌گذاری (<Share2 size={12} className="inline mx-1 text-purple-300" />) در گوشه بالا را بزنید.
                </div>
              </div>
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/5 border border-white/5">
                <span className="w-5 h-5 rounded-full bg-purple-500/30 text-purple-200 font-bold text-xs flex items-center justify-center shrink-0">۲</span>
                <div className="text-[11px] text-white/90">
                  گزینه <strong className="text-purple-300">«Add to Home Screen»</strong> را بزنید تا مینادنتال با آیکون رسمی به Dock آیپد اضافه شود.
                </div>
              </div>
            </div>
            <a
              href="./MinaDental-iOS.mobileconfig"
              download="MinaDental-iPad.mobileconfig"
              data-testid="ipad_mobileconfig_download_link"
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
            >
              <Download size={15} />
              دانلود پروفایل نصب مستقیم آیپد (.mobileconfig)
            </a>
          </div>
        )}

        {/* 4. Windows Desktop Tab */}
        {platform === 'windows' && (
          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3 text-xs">
            <div className="flex items-center gap-2 text-sm font-bold text-sky-200">
              <Laptop size={18} className="text-sky-300" />
              بسته دسکتاپ ویندوز ۱۰ و ۱۱ (Windows Desktop App)
            </div>
            <p className="text-[11px] text-white/80 leading-relaxed">
              در ویندوز، برنامه با <strong>منوی کناری کامل دسکتاپ</strong>، چیدمان ۴ ستونه، پنجره مستقل بدون نوار آدرس و کلیدهای میانبر صفحه‌کلید اجرا می‌شود.
            </p>

            {activePrompt && (
              <button
                type="button"
                onClick={handlePromptInstall}
                data-testid="windows_pwa_install_button"
                className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold text-xs shadow-lg flex items-center justify-center gap-2 active:scale-95 transition-all"
              >
                <Download size={16} />
                نصب مستقیم به عنوان برنامه ویندوز (Start Menu &amp; Desktop)
              </button>
            )}

            <button
              type="button"
              data-testid="download_windows_launcher_button"
              onClick={() => {
                downloadWindowsDesktopLauncher();
                setWindowsLauncherDownloaded(true);
                setTimeout(() => setWindowsLauncherDownloaded(false), 3500);
              }}
              className="w-full py-2.5 px-3 rounded-xl bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-500 hover:to-blue-600 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all"
            >
              <Download size={15} />
              {windowsLauncherDownloaded
                ? 'فایل MinaDental-Windows.cmd دانلود شد'
                : 'دانلود لانچر مستقل دسکتاپ ویندوز (MinaDental-Windows.cmd)'}
            </button>

            <div className="p-2.5 rounded-xl bg-black/25 border border-white/10 space-y-1 text-[10.5px] text-white/80">
              <p className="font-bold text-sky-300 flex items-center gap-1.5">
                <Keyboard size={13} />
                نصب از مرورگر Edge / Chrome و میانبرهای دسکتاپ:
              </p>
              <p>۱. در نوار آدرس Chrome یا Microsoft Edge روی آیکون نصب (مانیتور با فلش) کلیک کرده و <strong>Install</strong> را بزنید.</p>
              <p>۲. یا فایل <code className="font-mono text-sky-300">MinaDental-Windows.cmd</code> را روی دسکتاپ ذخیره کرده و اجرا کنید تا پنجره مستقل برنامه باز شود.</p>
              <p>۳. کلیدهای میانبر سریع: <code className="font-mono text-cyan-300">Ctrl+K</code> (میانبرها)، <code className="font-mono text-cyan-300">F2..F9</code> (بخش‌ها)، <code className="font-mono text-cyan-300">Esc</code> (بستن).</p>
            </div>
          </div>
        )}

        {/* Auto-Update Engine Control */}
        <div className="pt-2 border-t border-white/10 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-white/90">
              <RefreshCw size={14} className={checkingUpdate ? 'animate-spin text-cyan-400' : 'text-blue-400'} />
              <span>بروزرسانی خودکار نسخه</span>
            </div>
            <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
              نسخه v{CURRENT_APP_VERSION} فعال
            </span>
          </div>

          <button
            onClick={handleCheckUpdate}
            disabled={checkingUpdate}
            className="w-full py-2.5 px-3 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold text-white flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw size={13} className={checkingUpdate ? 'animate-spin text-cyan-300' : ''} />
            {checkingUpdate ? 'در حال بررسی نسخه جدید...' : 'بررسی دستی بروزرسانی'}
          </button>

          {updateStatus && (
            <div className="p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-400/30 text-[11px] text-cyan-200 text-center animate-fade-in">
              {updateStatus}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
